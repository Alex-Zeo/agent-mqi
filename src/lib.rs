//! # agent-mqi
//!
//! Model Quality Index (MQI) - A 24-metric composite score for detecting AI agent degradation.
//!
//! MQI monitors agent behavior across six dimensions:
//! - **Thinking**: reasoning depth, explicit chains, zero-reasoning turns
//! - **Research**: read-before-edit patterns, research-to-mutation ratio
//! - **Execution**: edit hygiene, premature stopping, repeated edits
//! - **Trust**: user interrupts, self-admitted failures, constraint violations
//! - **Throughput**: token generation rate
//! - **Environment**: incident exposure, issue velocity
//!
//! ## Quick Start
//!
//! ```rust
//! use agent_mqi::{SessionMetrics, score_session, Baseline};
//!
//! // Implement SessionMetrics for your session type
//! struct MySession { /* ... */ }
//!
//! impl SessionMetrics for MySession {
//!     fn metric_value(&self, index: usize) -> f64 {
//!         // Return raw metric values
//!         0.0
//!     }
//! }
//!
//! // Score against a baseline
//! let session = MySession { /* ... */ };
//! let baseline = Baseline::default();
//! let score = score_session(&session, &baseline);
//! println!("MQI-X: {:.1}", score.mqi_x);
//! ```
//!
//! ## Scoped to Claude Code CLI
//!
//! MQI is designed for Claude Code CLI sessions (`~/.claude/projects/*/sessions/*.jsonl`).
//! Other agentic IDEs (Cursor, Codex, Windsurf) don't expose sufficient telemetry for
//! meaningful quality scoring. See ADR-005 for rationale.

mod baseline;
mod metrics;
mod scoring;
mod traits;
mod transforms;

pub use baseline::{
    compute_baseline, compute_per_model_topk_baselines, Baseline, BaselineSource, MetricBaseline,
    TopKConfig,
};
pub use metrics::{
    HIGHER_IS_BETTER, HOOK_COACHED, IS_MODEL_METRIC, METRIC_COUNT, METRIC_FAMILIES, METRIC_NAMES,
    MIN_SIGMAS, MODEL_DEPENDENT, WEIGHTS,
};
pub use scoring::{score_session, MetricScore, MetricStatus, SessionScore, Z_CLIP};
pub use traits::SessionMetrics;
pub use transforms::{inverse_transform, transform_raw, MetricFamily};
