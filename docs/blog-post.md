# Measuring What Matters: A Framework for AI Agent Quality

*How we built a 24-metric composite score to detect when AI assistants are struggling*

---

## The Problem Nobody's Measuring

You've been using Claude Code for months. Some days it feels brilliant. Other days, something's off. The code still compiles, but the reasoning feels shallower. The research phase gets skipped. You find yourself interrupting more often.

Is the model degrading? Did a recent update change something? Or is it just you?

Without metrics, you're flying blind.

## Why Traditional Metrics Don't Work

Software engineering has SonarQube, code coverage, cyclomatic complexity. We measure the *output*. But with AI agents, the output is only part of the story. Two sessions can produce identical code while differing wildly in process:

- One researched extensively before editing
- One jumped straight to writing
- One reasoned through edge cases
- One pattern-matched from training data

The second approach might work today but fail tomorrow when the pattern doesn't fit. Process quality predicts future reliability.

## The 24-Metric Framework

MQI (Model Quality Index) tracks agent behavior across six dimensions:

### Thinking (19% weight)
- **thinking_depth**: How deeply does the agent reason? Measured by thinking block length per turn.
- **reasoning_loops**: Explicit iteration vs. one-shot answers.
- **zero_reasoning_turn_rate**: Turns with no visible reasoning chain.

### Research (16% weight)
- **read_edit_ratio**: Does the agent read before editing? Ratio of Read/Grep/Glob calls to Edit/Write calls.
- **research_mutation_ratio**: Research as a fraction of total activity.
- **simplest_fix**: Preference for minimal changes vs. overengineering.

### Execution (23% weight)
- **edits_without_read**: Blind edits with no prior research.
- **repeated_edits**: Same file edited multiple times in a session.
- **trial_and_error_debugging**: Bash failures followed by edits.
- **reversion_rate**: How often edits get undone.

### Trust (18% weight)
- **user_interrupts**: Times the user stopped the agent mid-flow.
- **self_admitted_failures**: Agent saying "I made a mistake."
- **implicit_constraint_violator**: Breaking unstated rules.

### Throughput (5% weight)
- **token_rate_per_minute**: Raw generation speed.

### Environment (19% weight)
- **incident_exposure**: Session overlap with Anthropic outages.
- **issue_velocity**: GitHub issue activity indicating model problems.

## The Scoring System

Each metric goes through a four-step transformation:

1. **Transform** to approximate normality (logit for ratios, log1p for counts)
2. **Z-score** against a baseline population
3. **Orient** so positive z always means "good"
4. **Sigmoid** to a 0-100 scale

The final MQI-X score represents where this session sits relative to your baseline. 50 means "typical." Above 50 is better than average; below 50 is concerning.

## Why Per-Model Baselines Matter

Here's something we learned the hard way: new model architectures often trade explicit reasoning for implicit. When Opus 4.7 launched, it showed shorter thinking blocks but better code. Against a pooled baseline dominated by Opus 4.5, every 4.7 session looked "degraded."

The fix: compare each model against its own best sessions. Opus 4.7 is measured against Opus 4.7, not Sonnet.

## What MQI Reveals

After tracking 2,700+ sessions, patterns emerge:

- **Monday mornings score higher** (fresh context, deliberate thinking)
- **Late-night sessions show more user interrupts** (impatience compounds)
- **Complex refactoring tasks surface research gaps** (edits_without_read spikes)
- **Incident overlap correlates with lower scores** (not surprising, but quantified)

## Future Directions

### Multi-Agent Scoring
When agents spawn subagents, how do we attribute quality? Current thinking: aggregate subagent scores weighted by token contribution, with a penalty for excessive delegation.

### Team-Level Metrics
What does MQI look like across an engineering org? Can we detect model regressions from fleet-wide degradation before individual users notice?

### Real-Time Hooks
Instead of post-hoc analysis, what if MQI ran during sessions? A depth-check hook that warns when thinking_depth drops 2 sigma below your session norm.

## Try It Yourself

MQI is [open source](https://github.com/alexdgutierreza/agent-mqi) and designed for Claude Code CLI sessions.

```rust
use agent_mqi::{score_session, compute_baseline};

let baseline = compute_baseline(&sessions, &dates, "2026-01-01", "2026-02-01");
let score = score_session(&current_session, &baseline);

println!("MQI-X: {:.1}/100", score.mqi_x);
```

The model that helps you might be having a bad day. Now you can know.

---

*Alex Gutierrez builds developer tools at the intersection of AI and software engineering. Follow for more on agent reliability and quality metrics.*
