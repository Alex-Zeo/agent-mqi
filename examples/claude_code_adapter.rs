//! Example: Parsing Claude Code CLI sessions and scoring with MQI.
//!
//! Claude Code stores session transcripts at:
//! `~/.claude/projects/<project-hash>/sessions/<session-id>.jsonl`
//!
//! This example shows how to:
//! 1. Parse a session JSONL file
//! 2. Extract the 24 MQI metrics
//! 3. Score against a baseline
//!
//! Run with: `cargo run --example claude_code_adapter`

use agent_mqi::{compute_baseline, score_session, Baseline, MetricStatus, SessionMetrics};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// Parsed Claude Code session with extracted metrics.
#[derive(Debug, Default)]
pub struct ClaudeCodeSession {
    pub session_id: String,
    pub model: String,
    pub date: String,
    pub duration_minutes: f64,

    // Extracted metrics
    pub read_edit_ratio: f64,
    pub research_mutation_ratio: f64,
    pub thinking_depth: f64,
    pub edits_without_read: f64,
    pub write_edit_ratio: f64,
    pub reasoning_loops: f64,
    pub simplest_fix: f64,
    pub premature_stopping: f64,
    pub user_interrupts: f64,
    pub repeated_edits: f64,
    pub self_admitted_failures: f64,
    pub keyword_sentiment: f64,
    pub stop_hook_violations: f64,
    pub zero_reasoning_turn_rate: f64,
    pub reversion_rate: f64,
    pub post_compaction_drift: f64,
    pub human_time_estimation: f64,
    pub re_instruction_rate: f64,
    pub incident_exposure: f64,
    pub issue_velocity: f64,
    pub redaction_rate: f64,
    pub implicit_constraint_violator: f64,
    pub trial_and_error_debugging: f64,
    pub token_rate_per_minute: f64,
}

impl SessionMetrics for ClaudeCodeSession {
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

/// JSONL entry types from Claude Code session files.
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum SessionEntry {
    #[serde(rename = "user")]
    User { message: UserMessage },
    #[serde(rename = "assistant")]
    Assistant { message: AssistantMessage },
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
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "thinking")]
    Thinking { thinking: String },
    #[serde(rename = "tool_use")]
    ToolUse { name: String },
    #[serde(rename = "tool_result")]
    ToolResult {
        #[allow(dead_code)]
        tool_use_id: String,
    },
    #[serde(other)]
    Other,
}

/// Parse a Claude Code session JSONL file and extract MQI metrics.
pub fn parse_session(path: &Path) -> Option<ClaudeCodeSession> {
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut session = ClaudeCodeSession::default();
    session.session_id = path.file_stem()?.to_string_lossy().into_owned();

    let mut tool_calls: HashMap<String, u32> = HashMap::new();
    let mut total_thinking_chars = 0u64;
    let mut total_turns = 0u32;
    let mut turns_with_thinking = 0u32;
    let mut read_calls = 0u32;
    let mut edit_calls = 0u32;
    let mut write_calls = 0u32;

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

                    let mut turn_has_thinking = false;
                    for block in message.content {
                        match block {
                            ContentBlock::Thinking { thinking } => {
                                total_thinking_chars += thinking.len() as u64;
                                turn_has_thinking = true;
                            }
                            ContentBlock::ToolUse { name } => {
                                *tool_calls.entry(name.clone()).or_insert(0) += 1;
                                match name.as_str() {
                                    "Read" | "Grep" | "Glob" => read_calls += 1,
                                    "Edit" => edit_calls += 1,
                                    "Write" => write_calls += 1,
                                    _ => {}
                                }
                            }
                            _ => {}
                        }
                    }
                    if turn_has_thinking {
                        turns_with_thinking += 1;
                    }
                }
                SessionEntry::User { message } => {
                    // Count user interrupts (simplified: any user message is a potential interrupt)
                    // In practice, you'd check for mid-generation interrupts
                    for block in message.content {
                        if let ContentBlock::Text { text } = block {
                            if text.contains("stop") || text.contains("wait") || text.contains("no") {
                                session.user_interrupts += 1.0;
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    // Compute derived metrics
    if total_turns > 0 {
        session.thinking_depth = total_thinking_chars as f64 / total_turns as f64;
        session.zero_reasoning_turn_rate =
            (total_turns - turns_with_thinking) as f64 / total_turns as f64;
    }

    let total_mutations = edit_calls + write_calls;
    if total_mutations > 0 {
        session.read_edit_ratio = read_calls as f64 / total_mutations as f64;
        session.research_mutation_ratio = read_calls as f64 / (read_calls + total_mutations) as f64;
        session.write_edit_ratio = write_calls as f64 / total_mutations as f64;
    } else if read_calls > 0 {
        session.read_edit_ratio = 1.0; // All research, no mutations
        session.research_mutation_ratio = 1.0;
    }

    // Edits without prior reads (simplified: count edits that aren't preceded by reads)
    // In practice, you'd track this per-turn
    if edit_calls > read_calls {
        session.edits_without_read = (edit_calls - read_calls) as f64;
    }

    Some(session)
}

fn main() {
    // Example: Score sessions from a project
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    let claude_dir = Path::new(&home).join(".claude/projects");

    println!("MQI - Model Quality Index Demo");
    println!("==============================\n");

    // Find some session files
    let mut sessions: Vec<ClaudeCodeSession> = Vec::new();
    let mut dates: Vec<String> = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&claude_dir) {
        for project_entry in entries.flatten().take(3) {
            let sessions_dir = project_entry.path().join("sessions");
            if sessions_dir.exists() {
                if let Ok(session_entries) = std::fs::read_dir(&sessions_dir) {
                    for session_entry in session_entries.flatten().take(10) {
                        let path = session_entry.path();
                        if path.extension().map_or(false, |e| e == "jsonl") {
                            if let Some(session) = parse_session(&path) {
                                dates.push("2026-01-15".into()); // Simplified
                                sessions.push(session);
                            }
                        }
                    }
                }
            }
        }
    }

    if sessions.is_empty() {
        println!("No sessions found in ~/.claude/projects/");
        println!("Run some Claude Code sessions first!");
        return;
    }

    println!("Found {} sessions\n", sessions.len());

    // Compute baseline from first half
    let mid = sessions.len() / 2;
    let baseline = if mid > 0 {
        compute_baseline(&sessions[..mid], &dates[..mid], "2026-01-01", "2026-12-31")
    } else {
        Baseline::default()
    };

    println!("Baseline computed from {} sessions\n", baseline.session_count);

    // Score remaining sessions
    println!("Scoring recent sessions:");
    println!("{:-<60}", "");

    for (i, session) in sessions.iter().skip(mid).enumerate() {
        let score = score_session(session, &baseline);

        println!(
            "\nSession {}: {} (MQI-X: {:.1})",
            i + 1,
            session.model,
            score.mqi_x
        );

        // Show degraded metrics
        let degraded: Vec<_> = score
            .metrics
            .iter()
            .filter(|m| m.status == MetricStatus::Error)
            .collect();

        if degraded.is_empty() {
            println!("  All metrics healthy");
        } else {
            println!("  Degraded metrics:");
            for m in degraded {
                println!("    - {} (z={:.2})", m.name, m.z);
            }
        }
    }
}
