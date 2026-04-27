# Viral README Redesign Spec

## Goal

Rewrite agent-mqi README.md with a three-act structure designed for viral
distribution on HN, AI Twitter, and Reddit. Ship an R visualization script
with pre-generated PNG using real data from bloomnet.db.

## Decisions

- **Audience**: Layered. Viral cover (AI Twitter) + technical core (HN).
- **Data exposure**: Full. Real project names, dates, counts.
- **Hook**: Blend A+C. Personal stat + counterintuitive finding + bridge.
- **Visualization**: R script + PNG committed. Reproducible.
- **Approach**: Hook > Proof > Tool (three-act).
- **No em dashes anywhere.**

## Act 1: Hook

Three lines, no scrolling:

```
56.4% of the words I type to my AI assistant are negative.
The more I cursed at it, the better my code got.
Here's 2,740 sessions of data proving your frustration isn't a personality
flaw. It's a quality signal.
```

Followed by hero screenshot (`docs/screenshots/hero.png`), then one-line
anchor:

> MQI (Model Quality Index) is a 24-metric composite score that detects when
> your AI coding assistant is degrading, built from real Claude Code session
> transcripts.

## Act 2: Proof

### Section 1: "Your Frustration Is Improving. The Tooling Did That."

R-generated temporal trend chart showing weekly avg sentiment from W04-W16.

**Chart spec:**
- X: weeks (W04 through W16)
- Y: avg sentiment (inverted so "calmer" is up)
- Primary: smoothed trend line with confidence band
- Secondary: per-session scatter, opacity 0.15, colored by project
- Annotations: 2-3 milestone callouts (hooks shipped, baseline fix, etc.)
- Style: dark theme, minimal grid

Context paragraph about frustration decreasing as tooling matures.

**Deliverables:**
- `scripts/sentiment-trend.R`
- `docs/screenshots/sentiment-trend.png`

### Section 2: "Swearing at Your AI Assistant Is a Feature, Not a Bug"

Single-column table: "Profanity as a quality signal"

Subtitle: "Users define their own keyword lists. These are ours."

Two examples:

| | Profanity as a quality signal |
|---|---|
| | *Users define their own keyword lists. These are ours.* |
| **Example 1** | *"so fuckin do it lol wtf are you waiting for"* |
| What triggered it | Agent stalled, explaining a plan instead of executing it. |
| MQI metrics that fire | `keyword_sentiment`, `user_interrupts`, `zero_reasoning_turn_rate` |
| **Example 2** | *"stop being lazy check the console, dom, and screenshots. the counts on each filter are not updating as intended"* |
| What triggered it | Agent skipped research phase, wrote code without checking UI state. |
| MQI metrics that fire | `edits_without_read`, `keyword_sentiment`, `re_instruction_rate` |
| **Key insight** | These aren't outbursts. They're leading indicators of session degradation. MQI captures the intensity and correlates it with 23 other behavioral metrics to determine whether the tool is struggling, not the user. |

Research citations: Strehmel thesis, GitHub toxicity study, Inc. workplace
swearing piece.

### Section 3: "You're Not a Negative Person. We Swear."

Side-by-side keyword lists showing the asymmetry.

Punchline: "fix the broken deploy" scores 2 negative, 0 positive. The
negative list is biased toward problem-solving language, not anger.
keyword_sentiment weight is 0.02 (lowest tier) precisely because raw word
counts overstate negativity.

Closing: "So no, you don't have anger issues. You have a codebase."

### Section 4: "When MQI Drops, Switch Models"

Per-model MQI table with real data:

| Model | Sessions | Avg MQI |
|---|---|---|
| Sonnet 4.6 | 100 | 35.8 |
| Haiku 4.5 | 52 | 28.9 |
| Opus 4.6 | 247 | 12.0 |
| Opus 4.7 | 146 | 10.6 |

Context: Opus scores lower because hard problems route to Opus. But when
Opus degrades within its own cohort, switching to Sonnet recovers quality.
Weeks 12-13 evidence.

### Roadmap: Geographic Routing

VPN zone-switching to off-peak inference clusters. Hypothesis: 50-100ms
added latency is negligible for quality-critical tasks. MQI becomes a
routing signal, not just a diagnostic.

## Act 3: Tool

Standard open-source README sections, tightened from existing:

1. Quick Start (clone, build, dashboard)
2. The 24 Metrics (existing table)
3. How It Works (ASCII pipeline)
4. Scoring Methodology (6-step numbered list)
5. Per-Model Baselines (paragraph)
6. Dashboard Features (existing list)
7. Library Usage (Rust snippet)
8. License (MIT)
