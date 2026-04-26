# agent-mqi

**Model Quality Index (MQI)** - A 24-metric composite score for detecting AI agent degradation.

MQI monitors Claude Code sessions across six behavioral dimensions, producing a 0-100 quality score that surfaces when your AI assistant is struggling.

## Why MQI?

AI agents can degrade in subtle ways that are hard to notice session-by-session:
- Thinking becomes shallower
- Research habits slip (editing before reading)
- Self-correction decreases
- Trust signals emerge (user interruptions, constraint violations)

MQI tracks 24 metrics derived from session transcripts and computes a weighted composite score. When MQI drops, you know something changed.

## Quick Start

```rust
use agent_mqi::{SessionMetrics, score_session, compute_baseline, METRIC_COUNT};

// Your session data
struct MySession {
    thinking_depth: f64,
    read_edit_ratio: f64,
    user_interrupts: u32,
    // ... other metrics
}

impl SessionMetrics for MySession {
    fn metric_value(&self, index: usize) -> f64 {
        match index {
            0 => self.read_edit_ratio,
            2 => self.thinking_depth,
            8 => self.user_interrupts as f64,
            _ => 0.0,
        }
    }
}

// Compute baseline from historical sessions
let baseline = compute_baseline(&sessions, &dates, "2026-01-01", "2026-02-01");

// Score a new session
let score = score_session(&current_session, &baseline);
println!("MQI-X: {:.1}/100", score.mqi_x);

// Check per-metric breakdown
for m in &score.metrics {
    if m.status == MetricStatus::Error {
        println!("  {} is degraded (z={:.2})", m.name, m.z);
    }
}
```

## The 24 Metrics

| Group | Metrics | Weight |
|-------|---------|--------|
| **Thinking** | thinking_depth, reasoning_loops, zero_reasoning_turn_rate | 19% |
| **Research** | read_edit_ratio, research_mutation_ratio, simplest_fix | 16% |
| **Execution** | edits_without_read, write_edit_ratio, premature_stopping, repeated_edits, stop_hook_violations, reversion_rate, post_compaction_drift, human_time_estimation, trial_and_error_debugging | 23% |
| **Trust** | user_interrupts, self_admitted_failures, keyword_sentiment, re_instruction_rate, implicit_constraint_violator | 18% |
| **Throughput** | token_rate_per_minute | 5% |
| **Environment** | incident_exposure, issue_velocity | 19% |

### Key Metrics Explained

- **thinking_depth**: Length of thinking blocks per turn. Deeper thinking correlates with better outputs.
- **read_edit_ratio**: Research before editing. Sessions that read more files before editing tend to produce better code.
- **user_interrupts**: Times the user interrupted the agent. High interrupts suggest the agent wasn't meeting expectations.
- **incident_exposure**: Fraction of session that overlapped with Anthropic service incidents.

## Scoring Methodology

1. **Transform**: Each metric is transformed to approximate normality (logit for ratios, log1p for counts)
2. **Z-score**: Compare to baseline using robust estimators (MAD-based sigma)
3. **Orient**: Flip sign so positive z = good
4. **Weight**: Weighted sum across metrics
5. **Sigmoid**: Scale to 0-100

A score of 50 means "baseline quality". Above 50 is better than baseline; below 50 is worse.

## Per-Model Baselines

Different model architectures have different baseline behaviors. MQI supports per-model top-K baselines so Opus 4.7 is compared against Opus 4.7's best sessions, not Sonnet's.

```rust
use agent_mqi::{compute_per_model_topk_baselines, TopKConfig};

let cfg = TopKConfig::default(); // top 20%, min 30 sessions
let baselines = compute_per_model_topk_baselines(&sessions, &models, cfg);

let opus_baseline = baselines.get("claude-opus-4-7").unwrap();
```

## Scoped to Claude Code CLI

MQI is designed specifically for Claude Code CLI sessions (`~/.claude/projects/*/sessions/*.jsonl`). Other agentic IDEs (Cursor, Codex, Windsurf) don't expose sufficient telemetry for meaningful quality scoring:

| Source | Data Available | MQI Compatible |
|--------|---------------|----------------|
| Claude Code CLI | Full transcripts, tool calls, thinking blocks | Yes |
| Cursor | Code hashes, commit attribution | No |
| Codex | Prompts only, no tool calls | No |
| Windsurf | Empty | No |

See [ADR-005](docs/adr-005-claude-code-only.md) for the full rationale.

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
agent-mqi = "0.1"
```

## License

MIT
