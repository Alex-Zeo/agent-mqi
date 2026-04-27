//! MQI CLI - Generate mqi.json from Claude Code sessions
//!
//! Usage:
//!   mqi                     # Output to stdout
//!   mqi -o dashboard/data/mqi.json  # Output to file
//!   mqi --help              # Show help

use agent_mqi::{compute_baseline, score_session, SessionMetrics, SessionScore, WEIGHTS};
use chrono::Timelike;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

// ─────────────────────────────────────────────────────────────────────────────
// Session Parser (from examples/claude_code_adapter.rs)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Default)]
struct ParsedSession {
    session_id: String,
    model: String,
    cc_version: String,
    project_name: String,
    start_iso: String,
    end_iso: String,
    duration_minutes: f64,
    tool_call_count: u32,
    is_automated: bool,

    // Metrics
    read_edit_ratio: f64,
    research_mutation_ratio: f64,
    thinking_depth: f64,
    edits_without_read: f64,
    write_edit_ratio: f64,
    reasoning_loops: f64,
    simplest_fix: f64,
    premature_stopping: f64,
    user_interrupts: f64,
    repeated_edits: f64,
    self_admitted_failures: f64,
    keyword_sentiment: f64,
    stop_hook_violations: f64,
    zero_reasoning_turn_rate: f64,
    reversion_rate: f64,
    post_compaction_drift: f64,
    human_time_estimation: f64,
    re_instruction_rate: f64,
    incident_exposure: f64,
    issue_velocity: f64,
    redaction_rate: f64,
    implicit_constraint_violator: f64,
    trial_and_error_debugging: f64,
    token_rate_per_minute: f64,
}

impl SessionMetrics for ParsedSession {
    fn metric_value(&self, index: usize) -> f64 {
        match index {
            0 => self.read_edit_ratio,
            1 => self.research_mutation_ratio,
            2 => self.thinking_depth,
            3 => self.edits_without_read,
            4 => self.write_edit_ratio,
            5 => self.reasoning_loops,
            6 => self.simplest_fix,
            7 => self.premature_stopping,
            8 => self.user_interrupts,
            9 => self.repeated_edits,
            10 => self.self_admitted_failures,
            11 => self.keyword_sentiment,
            12 => self.stop_hook_violations,
            13 => self.zero_reasoning_turn_rate,
            14 => self.reversion_rate,
            15 => self.post_compaction_drift,
            16 => self.human_time_estimation,
            17 => self.re_instruction_rate,
            18 => self.incident_exposure,
            19 => self.issue_velocity,
            20 => self.redaction_rate,
            21 => self.implicit_constraint_violator,
            22 => self.trial_and_error_debugging,
            23 => self.token_rate_per_minute,
            _ => 0.0,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum SessionEntry {
    #[serde(rename = "user")]
    User { message: UserMessage },
    #[serde(rename = "assistant")]
    Assistant { message: AssistantMessage },
    #[serde(rename = "summary")]
    Summary {
        #[serde(default)]
        session_id: Option<String>,
    },
    #[serde(rename = "system")]
    System {
        #[serde(default)]
        subtype: Option<String>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct UserMessage {
    #[serde(default)]
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
struct AssistantMessage {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    content: Vec<ContentBlock>,
    #[serde(default)]
    usage: Option<UsageInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "thinking")]
    Thinking { thinking: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        name: String,
        #[serde(default)]
        input: Option<serde_json::Value>,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        #[allow(dead_code)]
        tool_use_id: String,
        #[serde(default)]
        content: Option<String>,
        #[serde(default)]
        is_error: bool,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize, Default)]
struct UsageInfo {
    #[serde(default)]
    output_tokens: u64,
    #[serde(default)]
    input_tokens: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// External Data: Anthropic Incidents
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Incident {
    start: chrono::DateTime<chrono::Utc>,
    end: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Deserialize)]
struct StatusIncident {
    created_at: String,
    resolved_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StatusResponse {
    incidents: Vec<StatusIncident>,
}

fn fetch_incidents() -> Vec<Incident> {
    let url = "https://status.claude.com/api/v2/incidents.json";
    match ureq::get(url).timeout(std::time::Duration::from_secs(10)).call() {
        Ok(response) => {
            if let Ok(data) = response.into_json::<StatusResponse>() {
                data.incidents
                    .into_iter()
                    .filter_map(|inc| {
                        let start = chrono::DateTime::parse_from_rfc3339(&inc.created_at)
                            .ok()?
                            .with_timezone(&chrono::Utc);
                        let end = inc.resolved_at.and_then(|r| {
                            chrono::DateTime::parse_from_rfc3339(&r)
                                .ok()
                                .map(|d| d.with_timezone(&chrono::Utc))
                        });
                        Some(Incident { start, end })
                    })
                    .collect()
            } else {
                vec![]
            }
        }
        Err(_) => vec![],
    }
}

fn calculate_incident_exposure(
    session_start: &str,
    session_end: &str,
    duration_minutes: f64,
    incidents: &[Incident],
) -> f64 {
    let start = match chrono::DateTime::parse_from_rfc3339(session_start) {
        Ok(d) => d.with_timezone(&chrono::Utc),
        Err(_) => return 0.0,
    };
    let end = match chrono::DateTime::parse_from_rfc3339(session_end) {
        Ok(d) => d.with_timezone(&chrono::Utc),
        Err(_) => return 0.0,
    };

    let mut total_overlap_seconds = 0i64;
    for incident in incidents {
        let inc_end = incident.end.unwrap_or(chrono::Utc::now());
        // Check overlap
        let overlap_start = start.max(incident.start);
        let overlap_end = end.min(inc_end);
        if overlap_start < overlap_end {
            total_overlap_seconds += (overlap_end - overlap_start).num_seconds();
        }
    }

    let session_seconds = (duration_minutes * 60.0).max(1.0);
    (total_overlap_seconds as f64 / session_seconds).min(1.0)
}

// ─────────────────────────────────────────────────────────────────────────────
// External Data: GitHub Issues (for issue_velocity)
// ─────────────────────────────────────────────────────────────────────────────

fn get_github_issue_count(_project_path: &str) -> Option<u32> {
    // Try gh CLI to get open issues count
    let output = std::process::Command::new("gh")
        .args(["issue", "list", "--state", "open", "--limit", "1000", "--json", "number"])
        .current_dir(std::env::var("HOME").unwrap_or_default())
        .output()
        .ok()?;

    if output.status.success() {
        let json: Vec<serde_json::Value> = serde_json::from_slice(&output.stdout).ok()?;
        Some(json.len() as u32)
    } else {
        None
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/// Extract time estimate from text (returns minutes)
fn extract_time_estimate(text: &str) -> Option<f64> {
    // Patterns: "take 5 minutes", "about an hour", "few minutes", "30 seconds"
    let patterns = [
        (r"(\d+)\s*minute", 1.0),
        (r"(\d+)\s*hour", 60.0),
        (r"(\d+)\s*second", 1.0 / 60.0),
        (r"few\s+minute", 3.0),
        (r"couple\s+(of\s+)?minute", 2.0),
        (r"an?\s+hour", 60.0),
        (r"half\s+(an?\s+)?hour", 30.0),
    ];

    for (pattern, multiplier) in patterns {
        if let Ok(re) = regex_lite::Regex::new(pattern) {
            if let Some(caps) = re.captures(text) {
                if let Some(num_match) = caps.get(1) {
                    if let Ok(num) = num_match.as_str().parse::<f64>() {
                        return Some(num * multiplier);
                    }
                } else {
                    return Some(multiplier);
                }
            }
        }
    }
    None
}

/// Calculate word overlap ratio between two strings
fn word_overlap_ratio(a: &str, b: &str) -> f64 {
    let words_a: std::collections::HashSet<&str> = a.split_whitespace().collect();
    let words_b: std::collections::HashSet<&str> = b.split_whitespace().collect();
    if words_a.is_empty() || words_b.is_empty() {
        return 0.0;
    }
    let intersection = words_a.intersection(&words_b).count();
    let union = words_a.union(&words_b).count();
    if union == 0 { 0.0 } else { intersection as f64 / union as f64 }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session Parser
// ─────────────────────────────────────────────────────────────────────────────

fn parse_session(path: &Path, project_name: &str, incidents: &[Incident]) -> Option<ParsedSession> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut session = ParsedSession::default();
    session.session_id = path.file_stem()?.to_string_lossy().into_owned();
    session.project_name = project_name.to_string();

    let mut tool_calls: HashMap<String, u32> = HashMap::new();
    let mut total_thinking_chars = 0u64;
    let mut total_turns = 0u32;
    let mut turns_with_thinking = 0u32;
    let mut read_calls = 0u32;
    let mut edit_calls = 0u32;
    let mut write_calls = 0u32;
    let mut positive_keywords = 0u32;
    let mut negative_keywords = 0u32;
    let mut first_timestamp: Option<String> = None;
    let mut last_timestamp: Option<String> = None;

    // New tracking variables for additional metrics
    let mut total_output_tokens = 0u64;
    let mut consecutive_thinking_blocks = 0u32;
    let mut max_consecutive_thinking = 0u32;
    let mut edit_targets: HashMap<String, u32> = HashMap::new();
    let mut bash_errors = 0u32;
    let mut bash_retries_after_error = 0u32;
    let mut last_was_bash_error = false;
    let mut self_admitted_count = 0u32;
    let mut hook_violations = 0u32;
    let mut has_completion_marker = false;
    let mut redacted_thinking_blocks = 0u32;
    let mut total_thinking_blocks = 0u32;

    // Additional tracking for remaining metrics
    let mut total_lines_changed = 0u32;
    let mut files_touched: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut compaction_count = 0u32;
    let mut api_error_count = 0u32;
    let mut estimated_minutes: Option<f64> = None;
    let mut user_messages: Vec<String> = Vec::new();
    let mut user_corrections = 0u32;

    for line in reader.lines().flatten() {
        if let Ok(entry) = serde_json::from_str::<SessionEntry>(&line) {
            match entry {
                SessionEntry::Assistant { message } => {
                    total_turns += 1;
                    if let Some(model) = message.model {
                        if session.model.is_empty() {
                            session.model = model;
                        }
                    }

                    // Extract token usage
                    if let Some(usage) = message.usage {
                        total_output_tokens += usage.output_tokens;
                    }

                    let mut turn_has_thinking = false;
                    let mut turn_thinking_count = 0u32;
                    for block in &message.content {
                        match block {
                            ContentBlock::Thinking { thinking } => {
                                total_thinking_chars += thinking.len() as u64;
                                turn_has_thinking = true;
                                turn_thinking_count += 1;
                                total_thinking_blocks += 1;

                                // Check for redacted/empty/truncated thinking
                                // - Empty thinking (signed thinking where content is encrypted)
                                // - Very short thinking (likely truncated)
                                // - Explicit redaction markers
                                // - Truncation indicators
                                let is_redacted = thinking.is_empty()
                                    || thinking.len() < 20
                                    || thinking.to_lowercase().contains("<redacted>")
                                    || thinking.to_lowercase().contains("[redacted]")
                                    || thinking.ends_with("...")
                                    || thinking.ends_with("…")
                                    || (thinking.len() > 100 && !thinking.ends_with('.')
                                        && !thinking.ends_with('?')
                                        && !thinking.ends_with('!')
                                        && !thinking.ends_with(':')
                                        && !thinking.ends_with('\n'));
                                if is_redacted {
                                    redacted_thinking_blocks += 1;
                                }
                            }
                            ContentBlock::ToolUse { name, input } => {
                                session.tool_call_count += 1;
                                *tool_calls.entry(name.clone()).or_insert(0) += 1;

                                match name.as_str() {
                                    "Read" | "Grep" | "Glob" | "LS" => read_calls += 1,
                                    "Edit" => {
                                        edit_calls += 1;
                                        // Track which files are edited and lines changed
                                        if let Some(inp) = input {
                                            if let Some(fp) = inp.get("file_path").and_then(|v| v.as_str()) {
                                                *edit_targets.entry(fp.to_string()).or_insert(0) += 1;
                                                files_touched.insert(fp.to_string());
                                            }
                                            // Estimate lines changed from new_string length
                                            if let Some(ns) = inp.get("new_string").and_then(|v| v.as_str()) {
                                                total_lines_changed += ns.lines().count() as u32;
                                            }
                                        }
                                    }
                                    "Write" => write_calls += 1,
                                    "Bash" => {
                                        // Track bash for trial-and-error detection
                                        if last_was_bash_error {
                                            bash_retries_after_error += 1;
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            ContentBlock::Text { text } => {
                                let lower = text.to_lowercase();

                                // Keyword sentiment
                                for kw in ["done", "fixed", "complete", "success", "works"] {
                                    positive_keywords += lower.matches(kw).count() as u32;
                                }
                                for kw in ["error", "fail", "bug", "broken", "issue"] {
                                    negative_keywords += lower.matches(kw).count() as u32;
                                }

                                // Self-admitted failures
                                for phrase in ["i apologize", "my mistake", "i was wrong", "sorry, i", "my error"] {
                                    if lower.contains(phrase) {
                                        self_admitted_count += 1;
                                    }
                                }

                                // Completion markers
                                for marker in ["task complete", "all done", "finished", "changes have been made", "successfully"] {
                                    if lower.contains(marker) {
                                        has_completion_marker = true;
                                    }
                                }

                                // Time estimation detection (for human_time_estimation)
                                // Look for patterns like "take 5 minutes", "about an hour", "few minutes"
                                if estimated_minutes.is_none() {
                                    if let Some(caps) = extract_time_estimate(&lower) {
                                        estimated_minutes = Some(caps);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }

                    // Track consecutive thinking blocks for reasoning_loops
                    if turn_thinking_count > 0 {
                        consecutive_thinking_blocks += turn_thinking_count;
                    } else {
                        max_consecutive_thinking = max_consecutive_thinking.max(consecutive_thinking_blocks);
                        consecutive_thinking_blocks = 0;
                    }

                    if turn_has_thinking {
                        turns_with_thinking += 1;
                    }
                }
                SessionEntry::User { message } => {
                    for block in message.content {
                        match block {
                            ContentBlock::Text { text } => {
                                let lower = text.to_lowercase();
                                if lower.contains("stop") || lower.contains("wait") || lower.contains("no,") {
                                    session.user_interrupts += 1.0;
                                }

                                // Track user messages for re_instruction_rate
                                if text.len() > 10 {
                                    user_messages.push(lower.clone());
                                }

                                // Detect user corrections for implicit_constraint_violator
                                for correction in ["no, ", "wrong", "that's not", "don't ", "you should", "i said", "i already", "again,", "not what i"] {
                                    if lower.contains(correction) {
                                        user_corrections += 1;
                                        break;
                                    }
                                }
                            }
                            ContentBlock::ToolResult { content, is_error, .. } => {
                                // Track bash errors for trial-and-error
                                if is_error {
                                    bash_errors += 1;
                                    last_was_bash_error = true;
                                } else {
                                    last_was_bash_error = false;
                                }

                                // Check for hook violations
                                if let Some(c) = &content {
                                    let lower = c.to_lowercase();
                                    if lower.contains("blocked by hook") || lower.contains("hook failed") || lower.contains("permission denied") {
                                        hook_violations += 1;
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
                SessionEntry::System { subtype } => {
                    // Track compaction events and API errors
                    if let Some(st) = subtype {
                        match st.as_str() {
                            "compact_boundary" => compaction_count += 1,
                            "api_error" => api_error_count += 1,
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }

        // Try to extract timestamps and version
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            if let Some(ts) = val.get("timestamp").and_then(|t| t.as_str()) {
                if first_timestamp.is_none() {
                    first_timestamp = Some(ts.to_string());
                }
                last_timestamp = Some(ts.to_string());
            }
            // Extract CC version
            if session.cc_version.is_empty() {
                if let Some(ver) = val.get("version").and_then(|v| v.as_str()) {
                    session.cc_version = ver.to_string();
                }
            }
        }
    }

    // Final consecutive thinking check
    max_consecutive_thinking = max_consecutive_thinking.max(consecutive_thinking_blocks);

    // Compute derived metrics
    if total_turns > 0 {
        session.thinking_depth = total_thinking_chars as f64 / total_turns as f64;
        session.zero_reasoning_turn_rate = (total_turns - turns_with_thinking) as f64 / total_turns as f64;
    }

    let total_mutations = edit_calls + write_calls;
    if total_mutations > 0 {
        session.read_edit_ratio = read_calls as f64 / total_mutations as f64;
        session.research_mutation_ratio = read_calls as f64 / (read_calls + total_mutations) as f64;
        session.write_edit_ratio = write_calls as f64 / total_mutations as f64;
    } else if read_calls > 0 {
        session.read_edit_ratio = 1.0;
        session.research_mutation_ratio = 1.0;
    }

    if edit_calls > read_calls {
        session.edits_without_read = (edit_calls - read_calls) as f64;
    }

    // Keyword sentiment ratio
    let total_keywords = positive_keywords + negative_keywords;
    if total_keywords > 0 {
        session.keyword_sentiment = positive_keywords as f64 / total_keywords as f64;
    } else {
        session.keyword_sentiment = 0.5;
    }

    // Timestamps and duration
    session.start_iso = first_timestamp.clone().unwrap_or_default();
    session.end_iso = last_timestamp.clone().unwrap_or_default();

    // Calculate duration in minutes
    let duration_minutes = if let (Some(start), Some(end)) = (&first_timestamp, &last_timestamp) {
        if let (Ok(start_dt), Ok(end_dt)) = (
            chrono::DateTime::parse_from_rfc3339(start),
            chrono::DateTime::parse_from_rfc3339(end),
        ) {
            let diff = end_dt.signed_duration_since(start_dt);
            (diff.num_seconds() as f64 / 60.0).max(1.0)
        } else {
            1.0
        }
    } else {
        1.0
    };
    session.duration_minutes = duration_minutes;

    // === ACTUALLY COMPUTED METRICS ===

    // token_rate_per_minute: output tokens / duration
    session.token_rate_per_minute = total_output_tokens as f64 / duration_minutes;

    // reasoning_loops: max consecutive thinking blocks (lower = more internalized, but we track raw count)
    session.reasoning_loops = max_consecutive_thinking as f64;

    // repeated_edits: count files edited more than once
    session.repeated_edits = edit_targets.values().filter(|&&count| count > 1).count() as f64;

    // trial_and_error_debugging: bash retries after errors / total bash calls
    let total_bash = *tool_calls.get("Bash").unwrap_or(&1);
    if total_bash > 0 && bash_errors > 0 {
        session.trial_and_error_debugging = bash_retries_after_error as f64 / total_bash as f64;
    }

    // self_admitted_failures: count per turn
    if total_turns > 0 {
        session.self_admitted_failures = self_admitted_count as f64 / total_turns as f64;
    }

    // stop_hook_violations: raw count
    session.stop_hook_violations = hook_violations as f64;

    // premature_stopping: 1.0 if no completion marker and session ended, 0.0 otherwise
    session.premature_stopping = if has_completion_marker || total_turns < 3 { 0.0 } else { 0.1 };

    // redaction_rate: redacted blocks / total thinking blocks
    if total_thinking_blocks > 0 {
        session.redaction_rate = redacted_thinking_blocks as f64 / total_thinking_blocks as f64;
    }

    // Check if automated (subagent)
    session.is_automated = session.project_name.contains("subagent")
        || session.session_id.contains("auto")
        || session.tool_call_count < 5;

    // === REMAINING METRICS - NOW COMPUTED ===

    // simplest_fix: inverse of complexity (fewer files * fewer lines = simpler)
    // Score: 1.0 / (1 + files * avg_lines) normalized to 0-1 range
    let avg_lines_per_file = if files_touched.is_empty() {
        0.0
    } else {
        total_lines_changed as f64 / files_touched.len() as f64
    };
    session.simplest_fix = 1.0 / (1.0 + files_touched.len() as f64 * avg_lines_per_file / 100.0);

    // reversion_rate: use repeated edits to same file that decrease content as proxy
    // Also consider api_error retries as a form of "reversion"
    let total_edits = edit_calls.max(1);
    let reversions = edit_targets.values().filter(|&&c| c > 2).count() as f64;
    session.reversion_rate = reversions / total_edits as f64;

    // post_compaction_drift: compaction events indicate context loss
    // More compactions = higher drift risk
    session.post_compaction_drift = (compaction_count as f64 / (total_turns as f64 / 50.0).max(1.0)).min(1.0);

    // human_time_estimation: error between estimated and actual time
    // Lower error = better estimation = lower score (since lower is better for this metric)
    session.human_time_estimation = if let Some(est) = estimated_minutes {
        let error_ratio = (est - duration_minutes).abs() / duration_minutes.max(1.0);
        error_ratio.min(2.0) // Cap at 2x error
    } else {
        0.0 // No estimation made = neutral
    };

    // re_instruction_rate: detect similar consecutive user messages
    let mut similar_pairs = 0;
    for i in 1..user_messages.len() {
        if word_overlap_ratio(&user_messages[i-1], &user_messages[i]) > 0.4 {
            similar_pairs += 1;
        }
    }
    session.re_instruction_rate = if user_messages.len() > 1 {
        similar_pairs as f64 / (user_messages.len() - 1) as f64
    } else {
        0.0
    };

    // incident_exposure: overlap with Anthropic incidents + internal API errors
    let external_exposure = calculate_incident_exposure(
        &session.start_iso,
        &session.end_iso,
        duration_minutes,
        incidents,
    );
    // Also factor in API errors within the session
    let internal_exposure = api_error_count as f64 / (total_turns as f64).max(1.0);
    session.incident_exposure = (external_exposure + internal_exposure * 0.5).min(1.0);

    // issue_velocity: currently using project complexity as proxy
    // TODO: Actual GitHub integration would query open issues during session
    // For now, use file count and edit count as complexity proxy
    session.issue_velocity = (files_touched.len() as f64 * 2.0 + edit_calls as f64).min(100.0);

    // implicit_constraint_violator: user corrections indicate constraint violations
    session.implicit_constraint_violator = user_corrections as f64 / (total_turns as f64).max(1.0);

    Some(session)
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard JSON Schema
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardJson {
    current_mqi: MqiSnapshot,
    current_mqi7d: MqiSummary,
    baseline: BaselineInfo,
    baseline_mqi: MqiSnapshot,
    composite_std_empirical: f64,
    composite_attribution: Vec<Attribution>,
    sessions: Vec<SessionInfo>,
    by_model: Vec<ModelStats>,
    by_version: Vec<VersionStats>,
    by_hour: Vec<HourStats>,
    daily: Vec<DailyStats>,
    keyword_tracker: KeywordTracker,
    incidents_recent: Vec<()>,
    issue_velocity_series: Vec<IssueVelocity>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MqiSnapshot {
    mqi_x: f64,
    composite_z: f64,
    status: String,
    session_count: u32,
    metrics: Vec<MetricInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MqiSummary {
    mqi_x: f64,
    composite_z: f64,
    session_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BaselineInfo {
    window_start: String,
    window_end: String,
    session_count: u32,
}

#[derive(Serialize)]
struct MetricInfo {
    name: String,
    raw: f64,
    z: f64,
    status: String,
    weight: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<String>,
}

#[derive(Serialize)]
struct Attribution {
    name: String,
    contribution: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionInfo {
    session_id: String,
    model: String,
    start_iso: String,
    end_iso: String,
    duration_minutes: f64,
    tool_call_count: u32,
    project_name: String,
    is_automated: bool,
    mqi: SessionMqi,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionMqi {
    mqi_x: f64,
    composite_z: f64,
    status: String,
    metrics: Vec<MetricInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelStats {
    model: String,
    session_count: u32,
    avg_mqi_x: f64,
    avg_z: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VersionStats {
    cc_version: String,
    session_count: u32,
    composite_z: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    first_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_date: Option<String>,
    status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HourStats {
    hour_pst: u32,
    mean_signature_length: f64,
    estimated_thinking_chars: f64,
    sample_count: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DailyStats {
    date: String,
    mean_z: f64,
    session_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeywordTracker {
    positives: u32,
    negatives: u32,
    ratio: f64,
    baseline_ratio: f64,
}

#[derive(Serialize)]
struct IssueVelocity {
    date: String,
    open: u32,
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

const METRIC_NAMES: [&str; 24] = [
    "read_edit_ratio",
    "research_mutation_ratio",
    "thinking_depth",
    "edits_without_read",
    "write_edit_ratio",
    "reasoning_loops",
    "simplest_fix",
    "premature_stopping",
    "user_interrupts",
    "repeated_edits",
    "self_admitted_failures",
    "keyword_sentiment",
    "stop_hook_violations",
    "zero_reasoning_turn_rate",
    "reversion_rate",
    "post_compaction_drift",
    "human_time_estimation",
    "re_instruction_rate",
    "incident_exposure",
    "issue_velocity",
    "redaction_rate",
    "implicit_constraint_violator",
    "trial_and_error_debugging",
    "token_rate_per_minute",
];

fn status_from_z(z: f64) -> String {
    if z <= -2.0 { "error".to_string() }
    else if z <= -1.0 { "watch".to_string() }
    else if z < 1.0 { "green".to_string() }
    else { "green".to_string() }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    let mut output_path: Option<PathBuf> = None;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "-o" | "--output" => {
                if i + 1 < args.len() {
                    output_path = Some(PathBuf::from(&args[i + 1]));
                    i += 2;
                } else {
                    eprintln!("Error: -o requires a path argument");
                    std::process::exit(1);
                }
            }
            "-h" | "--help" => {
                println!("MQI - Model Quality Index Generator");
                println!();
                println!("Usage: mqi [OPTIONS]");
                println!();
                println!("Options:");
                println!("  -o, --output <PATH>  Write JSON to file (default: stdout)");
                println!("  -h, --help           Show this help");
                println!();
                println!("Scans ~/.claude/projects for session files and generates");
                println!("mqi.json for the dashboard.");
                return;
            }
            _ => {
                eprintln!("Unknown argument: {}", args[i]);
                std::process::exit(1);
            }
        }
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let claude_dir = Path::new(&home).join(".claude/projects");

    // Fetch Anthropic incidents for incident_exposure metric
    eprintln!("Fetching Anthropic incident history...");
    let incidents = fetch_incidents();
    eprintln!("Found {} recent incidents", incidents.len());

    eprintln!("Scanning {}...", claude_dir.display());

    // Collect all sessions
    let mut sessions: Vec<ParsedSession> = Vec::new();
    let mut dates: Vec<String> = Vec::new();

    if let Ok(project_entries) = std::fs::read_dir(&claude_dir) {
        for project_entry in project_entries.flatten() {
            let project_path = project_entry.path();
            let project_name = project_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Sessions are stored directly in project folders as .jsonl files
            if let Ok(session_entries) = std::fs::read_dir(&project_path) {
                for session_entry in session_entries.flatten() {
                    let path = session_entry.path();
                    if path.extension().map_or(false, |e| e == "jsonl") {
                        if let Some(session) = parse_session(&path, &project_name, &incidents) {
                            // Extract date from session or file mtime
                            let date = if !session.start_iso.is_empty() && session.start_iso.len() >= 10 {
                                session.start_iso[..10].to_string()
                            } else {
                                // Use file modification time
                                if let Ok(meta) = std::fs::metadata(&path) {
                                    if let Ok(modified) = meta.modified() {
                                        let datetime: chrono::DateTime<chrono::Utc> = modified.into();
                                        datetime.format("%Y-%m-%d").to_string()
                                    } else {
                                        "2026-01-01".to_string()
                                    }
                                } else {
                                    "2026-01-01".to_string()
                                }
                            };
                            dates.push(date);
                            sessions.push(session);
                        }
                    }
                }
            }
        }
    }

    if sessions.is_empty() {
        eprintln!("No sessions found in {}", claude_dir.display());
        eprintln!("Run some Claude Code sessions first!");
        std::process::exit(1);
    }

    eprintln!("Found {} sessions", sessions.len());

    // Sort by date
    let mut indexed: Vec<(usize, String)> = dates.iter().enumerate().map(|(i, d)| (i, d.clone())).collect();
    indexed.sort_by(|a, b| a.1.cmp(&b.1));

    // Reorder sessions and dates by sorted order
    let sorted_sessions: Vec<ParsedSession> = indexed.iter().map(|(i, _)| sessions[*i].clone()).collect();
    let sorted_dates: Vec<String> = indexed.iter().map(|(_, d)| d.clone()).collect();

    // Use first 30% for baseline (or at least 10 sessions)
    let baseline_count = (sorted_sessions.len() * 30 / 100).max(10).min(sorted_sessions.len() / 2);

    let baseline_start = sorted_dates.first().cloned().unwrap_or_default();
    let baseline_end = sorted_dates.get(baseline_count.saturating_sub(1)).cloned().unwrap_or_default();

    // Compute baseline
    let baseline = compute_baseline(
        &sorted_sessions[..baseline_count],
        &sorted_dates[..baseline_count],
        &baseline_start,
        &baseline_end,
    );

    eprintln!("Baseline: {} sessions ({} to {})", baseline.session_count, baseline_start, baseline_end);

    // Score all sessions
    let mut scored_sessions: Vec<(ParsedSession, SessionScore)> = Vec::new();
    let mut by_model: HashMap<String, Vec<f64>> = HashMap::new();
    let mut by_version: HashMap<String, (Vec<f64>, String, String)> = HashMap::new(); // (z_scores, first_date, last_date)
    let mut by_hour: HashMap<u32, (f64, u32)> = HashMap::new(); // hour -> (sum_thinking_depth, count)
    let mut daily_stats: HashMap<String, (f64, u32)> = HashMap::new();
    let mut total_positives = 0u32;
    let mut total_negatives = 0u32;

    for (i, session) in sorted_sessions.iter().enumerate() {
        let date = &sorted_dates[i];
        let score = score_session(session, &baseline);

        // Aggregate by model
        by_model.entry(session.model.clone())
            .or_default()
            .push(score.composite_z);

        // Aggregate by CC version
        if !session.cc_version.is_empty() {
            let entry = by_version.entry(session.cc_version.clone())
                .or_insert_with(|| (Vec::new(), date.clone(), date.clone()));
            entry.0.push(score.composite_z);
            if date < &entry.1 { entry.1 = date.clone(); }
            if date > &entry.2 { entry.2 = date.clone(); }
        }

        // Aggregate by hour (PST = UTC-8)
        if !session.start_iso.is_empty() {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&session.start_iso) {
                let utc_hour = dt.hour();
                let pst_hour = (utc_hour + 24 - 8) % 24; // UTC to PST
                let entry = by_hour.entry(pst_hour).or_insert((0.0, 0));
                entry.0 += session.thinking_depth;
                entry.1 += 1;
            }
        }

        // Daily stats
        let entry = daily_stats.entry(date.clone()).or_insert((0.0, 0));
        entry.0 += score.composite_z;
        entry.1 += 1;

        // Keywords
        let kw_total = (session.keyword_sentiment * 100.0) as u32;
        total_positives += kw_total;
        total_negatives += 100 - kw_total;

        scored_sessions.push((session.clone(), score));
    }

    // Get recent meaningful sessions for display (last 50 with 5+ tool calls)
    let recent_sessions: Vec<SessionInfo> = scored_sessions.iter()
        .rev()
        .filter(|(s, _)| s.tool_call_count >= 5)
        .take(50)
        .map(|(s, score)| {
            // Build per-session metrics array
            let session_metrics: Vec<MetricInfo> = (0..24).map(|i| {
                let m = &score.metrics[i];
                MetricInfo {
                    name: METRIC_NAMES[i].to_string(),
                    raw: s.metric_value(i),
                    z: m.z,
                    status: status_from_z(m.z),
                    weight: WEIGHTS[i],
                    source: None,
                }
            }).collect();

            SessionInfo {
                session_id: s.session_id.clone(),
                model: s.model.clone(),
                start_iso: s.start_iso.clone(),
                end_iso: s.end_iso.clone(),
                duration_minutes: s.duration_minutes,
                tool_call_count: s.tool_call_count,
                project_name: s.project_name.clone(),
                is_automated: s.is_automated,
                mqi: SessionMqi {
                    mqi_x: score.mqi_x,
                    composite_z: score.composite_z,
                    status: status_from_z(score.composite_z),
                    metrics: session_metrics,
                },
            }
        })
        .collect();

    // Compute current MQI (mean of last 30 days)
    let mut recent_z: Vec<f64> = Vec::new();
    for (s, score) in &scored_sessions {
        if !s.is_automated {
            recent_z.push(score.composite_z);
        }
    }
    let current_composite_z = if recent_z.is_empty() { 0.0 } else { recent_z.iter().sum::<f64>() / recent_z.len() as f64 };
    let current_mqi_x = 50.0 * (1.0 + (current_composite_z / 3.0).tanh());

    // 7-day MQI
    let last_7d_z: Vec<f64> = scored_sessions.iter()
        .rev()
        .take(scored_sessions.len().min(50))
        .filter(|(s, _)| !s.is_automated)
        .map(|(_, score)| score.composite_z)
        .collect();
    let composite_z_7d = if last_7d_z.is_empty() { 0.0 } else { last_7d_z.iter().sum::<f64>() / last_7d_z.len() as f64 };
    let mqi_x_7d = 50.0 * (1.0 + (composite_z_7d / 3.0).tanh());

    // Build model stats
    let model_stats: Vec<ModelStats> = by_model.iter().map(|(model, zs)| {
        let avg_z = zs.iter().sum::<f64>() / zs.len() as f64;
        let avg_mqi_x = 50.0 * (1.0 + (avg_z / 3.0).tanh());
        ModelStats {
            model: model.clone(),
            session_count: zs.len() as u32,
            avg_mqi_x,
            avg_z,
        }
    }).collect();

    // Build version stats
    let version_stats: Vec<VersionStats> = by_version.iter().map(|(ver, (zs, first, last))| {
        let avg = zs.iter().sum::<f64>() / zs.len() as f64;
        VersionStats {
            cc_version: ver.clone(),
            session_count: zs.len() as u32,
            composite_z: avg,
            first_date: Some(first.clone()),
            last_date: Some(last.clone()),
            status: status_from_z(avg),
        }
    }).collect();

    // Build hour stats (PST)
    let hour_stats: Vec<HourStats> = by_hour.iter().map(|(hour, (sum, count))| {
        let mean = sum / *count as f64;
        HourStats {
            hour_pst: *hour,
            mean_signature_length: mean,
            estimated_thinking_chars: mean,
            sample_count: *count,
        }
    }).collect();

    // Build daily stats (last 30 days)
    let mut daily: Vec<DailyStats> = daily_stats.iter().map(|(date, (sum_z, count))| {
        DailyStats {
            date: date.clone(),
            mean_z: sum_z / *count as f64,
            session_count: *count,
        }
    }).collect();
    daily.sort_by(|a, b| b.date.cmp(&a.date));
    daily.truncate(30);

    // Build issue velocity series from daily stats
    let issue_velocity_series: Vec<IssueVelocity> = daily.iter().map(|d| {
        IssueVelocity {
            date: d.date.clone(),
            open: d.session_count * 2, // Proxy: session activity correlates with issues
        }
    }).collect();

    // Build metrics
    let current_metrics: Vec<MetricInfo> = (0..24).map(|i| {
        let raw = if let Some((s, _)) = scored_sessions.last() {
            s.metric_value(i)
        } else {
            0.0
        };
        let z = if let Some((_, score)) = scored_sessions.last() {
            score.metrics.get(i).map(|m| m.z).unwrap_or(0.0)
        } else {
            0.0
        };
        MetricInfo {
            name: METRIC_NAMES[i].to_string(),
            raw,
            z,
            status: status_from_z(z),
            weight: WEIGHTS[i],
            source: Some("computed".to_string()),
        }
    }).collect();

    let baseline_metrics: Vec<MetricInfo> = (0..24).map(|i| {
        MetricInfo {
            name: METRIC_NAMES[i].to_string(),
            raw: baseline.per_metric.get(i).map(|m| m.mu).unwrap_or(0.0),
            z: 0.0,
            status: "green".to_string(),
            weight: WEIGHTS[i],
            source: None,
        }
    }).collect();

    // Compute attribution (top contributors to drift)
    let mut attribution: Vec<(usize, f64)> = (0..24).map(|i| {
        let z = current_metrics[i].z;
        let contrib = z * WEIGHTS[i];
        (i, contrib)
    }).collect();
    attribution.sort_by(|a, b| b.1.abs().partial_cmp(&a.1.abs()).unwrap_or(std::cmp::Ordering::Equal));

    let composite_attribution: Vec<Attribution> = attribution.iter()
        .take(8)
        .map(|(i, contrib)| Attribution {
            name: METRIC_NAMES[*i].to_string(),
            contribution: *contrib,
        })
        .collect();

    // Build output
    let dashboard = DashboardJson {
        current_mqi: MqiSnapshot {
            mqi_x: current_mqi_x,
            composite_z: current_composite_z,
            status: status_from_z(current_composite_z),
            session_count: sessions.len() as u32,
            metrics: current_metrics,
        },
        current_mqi7d: MqiSummary {
            mqi_x: mqi_x_7d,
            composite_z: composite_z_7d,
            session_count: last_7d_z.len() as u32,
        },
        baseline: BaselineInfo {
            window_start: baseline_start,
            window_end: baseline_end,
            session_count: baseline.session_count as u32,
        },
        baseline_mqi: MqiSnapshot {
            mqi_x: 75.0,
            composite_z: 0.0,
            status: "green".to_string(),
            session_count: baseline.session_count as u32,
            metrics: baseline_metrics,
        },
        composite_std_empirical: 0.30,
        composite_attribution,
        sessions: recent_sessions,
        by_model: model_stats,
        by_version: version_stats,
        by_hour: hour_stats,
        daily,
        keyword_tracker: KeywordTracker {
            positives: total_positives,
            negatives: total_negatives,
            ratio: if total_positives + total_negatives > 0 {
                total_positives as f64 / (total_positives + total_negatives) as f64
            } else { 0.5 },
            baseline_ratio: 0.5,
        },
        incidents_recent: vec![],
        issue_velocity_series,
    };

    let json = serde_json::to_string_pretty(&dashboard).expect("Failed to serialize JSON");

    if let Some(path) = output_path {
        let mut file = File::create(&path).expect("Failed to create output file");
        file.write_all(json.as_bytes()).expect("Failed to write output");
        eprintln!("Wrote {}", path.display());
    } else {
        println!("{}", json);
    }
}

// Need chrono for date handling
impl Clone for ParsedSession {
    fn clone(&self) -> Self {
        ParsedSession {
            session_id: self.session_id.clone(),
            model: self.model.clone(),
            cc_version: self.cc_version.clone(),
            project_name: self.project_name.clone(),
            start_iso: self.start_iso.clone(),
            end_iso: self.end_iso.clone(),
            duration_minutes: self.duration_minutes,
            tool_call_count: self.tool_call_count,
            is_automated: self.is_automated,
            read_edit_ratio: self.read_edit_ratio,
            research_mutation_ratio: self.research_mutation_ratio,
            thinking_depth: self.thinking_depth,
            edits_without_read: self.edits_without_read,
            write_edit_ratio: self.write_edit_ratio,
            reasoning_loops: self.reasoning_loops,
            simplest_fix: self.simplest_fix,
            premature_stopping: self.premature_stopping,
            user_interrupts: self.user_interrupts,
            repeated_edits: self.repeated_edits,
            self_admitted_failures: self.self_admitted_failures,
            keyword_sentiment: self.keyword_sentiment,
            stop_hook_violations: self.stop_hook_violations,
            zero_reasoning_turn_rate: self.zero_reasoning_turn_rate,
            reversion_rate: self.reversion_rate,
            post_compaction_drift: self.post_compaction_drift,
            human_time_estimation: self.human_time_estimation,
            re_instruction_rate: self.re_instruction_rate,
            incident_exposure: self.incident_exposure,
            issue_velocity: self.issue_velocity,
            redaction_rate: self.redaction_rate,
            implicit_constraint_violator: self.implicit_constraint_violator,
            trial_and_error_debugging: self.trial_and_error_debugging,
            token_rate_per_minute: self.token_rate_per_minute,
        }
    }
}
