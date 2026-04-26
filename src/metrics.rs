//! Metric definitions: names, weights, orientations, and flags.

use crate::transforms::MetricFamily;

pub const METRIC_COUNT: usize = 24;

pub const METRIC_NAMES: [&str; METRIC_COUNT] = [
    "read_edit_ratio",              // [0]  Research
    "research_mutation_ratio",      // [1]  Research
    "thinking_depth",               // [2]  Thinking
    "edits_without_read",           // [3]  Execution
    "write_edit_ratio",             // [4]  Execution
    "reasoning_loops",              // [5]  Thinking
    "simplest_fix",                 // [6]  Research
    "premature_stopping",           // [7]  Execution
    "user_interrupts",              // [8]  Trust
    "repeated_edits",               // [9]  Execution
    "self_admitted_failures",       // [10] Trust
    "keyword_sentiment",            // [11] Trust
    "stop_hook_violations",         // [12] Execution
    "zero_reasoning_turn_rate",     // [13] Thinking
    "reversion_rate",               // [14] Execution
    "post_compaction_drift",        // [15] Execution
    "human_time_estimation",        // [16] Execution
    "re_instruction_rate",          // [17] Trust
    "incident_exposure",            // [18] Environment
    "issue_velocity",               // [19] Environment
    "redaction_rate",               // [20] Thinking
    "implicit_constraint_violator", // [21] Trust
    "trial_and_error_debugging",    // [22] Execution
    "token_rate_per_minute",        // [23] Throughput
];

/// Default weights. Sum to 1.00 across 6 groups:
/// - Thinking (0.19): thinking_depth, reasoning_loops, zero_reasoning_turn_rate
/// - Research (0.16): read_edit_ratio, research_mutation_ratio, simplest_fix
/// - Execution (0.23): various edit hygiene and stopping metrics
/// - Trust (0.18): user_interrupts, self_admitted_failures, constraint violations
/// - Throughput (0.05): token_rate_per_minute
/// - Environment (0.19): incident_exposure, issue_velocity
pub const WEIGHTS: [f64; METRIC_COUNT] = [
    0.07, // [0]  read_edit_ratio
    0.05, // [1]  research_mutation_ratio
    0.09, // [2]  thinking_depth
    0.03, // [3]  edits_without_read
    0.03, // [4]  write_edit_ratio
    0.08, // [5]  reasoning_loops
    0.04, // [6]  simplest_fix
    0.03, // [7]  premature_stopping
    0.07, // [8]  user_interrupts
    0.01, // [9]  repeated_edits
    0.04, // [10] self_admitted_failures
    0.02, // [11] keyword_sentiment
    0.02, // [12] stop_hook_violations
    0.02, // [13] zero_reasoning_turn_rate
    0.04, // [14] reversion_rate
    0.02, // [15] post_compaction_drift
    0.02, // [16] human_time_estimation
    0.02, // [17] re_instruction_rate
    0.10, // [18] incident_exposure
    0.09, // [19] issue_velocity
    0.00, // [20] redaction_rate (zeroed: extended-thinking forces 100%)
    0.03, // [21] implicit_constraint_violator
    0.03, // [22] trial_and_error_debugging
    0.05, // [23] token_rate_per_minute
];

/// Which direction is "good" for each metric.
/// true = higher is better, false = lower is better.
pub const HIGHER_IS_BETTER: [bool; METRIC_COUNT] = [
    true,  // [0]  read_edit_ratio (more research before editing)
    true,  // [1]  research_mutation_ratio
    true,  // [2]  thinking_depth
    false, // [3]  edits_without_read
    false, // [4]  write_edit_ratio
    false, // [5]  reasoning_loops (fewer explicit loops = more internalized)
    false, // [6]  simplest_fix
    false, // [7]  premature_stopping
    false, // [8]  user_interrupts
    false, // [9]  repeated_edits
    false, // [10] self_admitted_failures
    true,  // [11] keyword_sentiment (more positive)
    false, // [12] stop_hook_violations
    false, // [13] zero_reasoning_turn_rate
    false, // [14] reversion_rate
    false, // [15] post_compaction_drift
    false, // [16] human_time_estimation
    false, // [17] re_instruction_rate
    false, // [18] incident_exposure
    false, // [19] issue_velocity
    false, // [20] redaction_rate
    false, // [21] implicit_constraint_violator
    false, // [22] trial_and_error_debugging
    true,  // [23] token_rate_per_minute (faster = more productive)
];

/// Model-capability metrics (excludes environment signals).
pub const IS_MODEL_METRIC: [bool; METRIC_COUNT] = [
    true, true, true, true, true, true, true, true, true, true, true, true,
    true, true, true, true, true, true,
    false, false, // incident_exposure, issue_velocity
    true, true, true, true,
];

/// Hook-coached metrics (drift with operator discipline, not model capability).
pub const HOOK_COACHED: [bool; METRIC_COUNT] = [
    false, false, false, false, false, false, false,
    true, // premature_stopping
    false, false, false, false,
    true, // stop_hook_violations
    false, false, false,
    true, // human_time_estimation
    false, false, false,
    true, // redaction_rate
    true, // implicit_constraint_violator
    false, false,
];

/// Architecture-dependent metrics (cross-model comparisons are apples-to-oranges).
pub const MODEL_DEPENDENT: [bool; METRIC_COUNT] = [
    false, false,
    true, // thinking_depth
    false, false,
    true, // reasoning_loops
    false, false, false, false, false, false, false,
    true, // zero_reasoning_turn_rate
    false, false, false, false, false, false,
    true, // redaction_rate
    false, false,
    true, // token_rate_per_minute
];

/// Distribution family for each metric.
pub const METRIC_FAMILIES: [MetricFamily; METRIC_COUNT] = [
    MetricFamily::Gaussian,    // [0]  read_edit_ratio
    MetricFamily::Gaussian,    // [1]  research_mutation_ratio
    MetricFamily::Log1pCount,  // [2]  thinking_depth
    MetricFamily::Log1pCount,  // [3]  edits_without_read
    MetricFamily::Gaussian,    // [4]  write_edit_ratio
    MetricFamily::Log1pCount,  // [5]  reasoning_loops
    MetricFamily::Log1pCount,  // [6]  simplest_fix
    MetricFamily::Log1pCount,  // [7]  premature_stopping
    MetricFamily::Log1pCount,  // [8]  user_interrupts
    MetricFamily::Log1pCount,  // [9]  repeated_edits
    MetricFamily::Log1pCount,  // [10] self_admitted_failures
    MetricFamily::Gaussian,    // [11] keyword_sentiment
    MetricFamily::Log1pCount,  // [12] stop_hook_violations
    MetricFamily::LogitUnit,   // [13] zero_reasoning_turn_rate
    MetricFamily::Log1pCount,  // [14] reversion_rate
    MetricFamily::LogitUnit,   // [15] post_compaction_drift
    MetricFamily::Log1pCount,  // [16] human_time_estimation
    MetricFamily::Log1pCount,  // [17] re_instruction_rate
    MetricFamily::LogitUnit,   // [18] incident_exposure
    MetricFamily::Gaussian,    // [19] issue_velocity
    MetricFamily::LogitUnit,   // [20] redaction_rate
    MetricFamily::Log1pCount,  // [21] implicit_constraint_violator
    MetricFamily::Log1pCount,  // [22] trial_and_error_debugging
    MetricFamily::Gaussian,    // [23] token_rate_per_minute
];

/// Minimum sigma thresholds per metric (prevents z-score blow-ups).
pub const MIN_SIGMAS: [f64; METRIC_COUNT] = [
    0.0, 0.0,
    0.30, // thinking_depth (log-space)
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
];
