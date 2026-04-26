# ADR-005: MQI Scoped to Claude Code CLI Only

**Status:** Accepted  
**Date:** 2026-04-26

## Context

MQI (Model Quality Index) is a 24-metric composite score for detecting agent degradation. The question arose: should MQI support multiple agentic IDEs (Cursor, Codex, Claude Desktop, Windsurf) in addition to Claude Code CLI?

A data science audit examined telemetry availability across tools:

| Source | Location | Data Shape | Volume |
|--------|----------|------------|--------|
| Claude Code CLI | `~/.claude/projects/*/sessions/*.jsonl` | Full transcripts, tool calls, thinking blocks | 2,734+ user sessions |
| Cursor | `~/.cursor/ai-tracking/ai-code-tracking.db` | Code hashes, commit attribution | 845 entries (single day) |
| Codex | `~/.codex/history.jsonl` | Prompts only, no tool calls | 71 entries |
| Claude Desktop | `~/Library/Application Support/Claude/` | Electron app data, minimal telemetry | Unknown |
| Windsurf | `~/.windsurf/` | Empty | 0 |

The MQI metrics that actually predict degradation require data only Claude Code provides:
- `thinking_depth` - requires thinking block content
- `user_interrupts` - requires turn boundary detection
- `read_edit_ratio` - requires tool call sequences
- `trial_and_error_debugging` - requires Bash exit codes + tool sequences

## Decision

Scope MQI to Claude Code CLI only. Cross-IDE support is deferred until other tools expose richer trace data.

**Roadmap condition for revisiting**: When Cursor, Codex, or Windsurf expose:
1. Tool call sequences (not just code hashes)
2. Thinking/reasoning block content
3. Turn boundaries with user vs assistant attribution

## Consequences

- **Simpler architecture:** No adapter layer, no "core metrics" lowest-common-denominator scoring
- **Full metric depth:** All 24 metrics available, not a sparse subset
- **Public extraction cleaner:** The `agent-mqi` public repo targets one data format
- **Limitation acknowledged:** Users of Cursor/Codex/Windsurf cannot use MQI for now
- **No maintenance burden:** Avoiding half-working parsers for tools with insufficient telemetry

## Data Evidence

Cursor's `scored_commits` table was empty (no AI line attribution populated). Cursor's `conversation_summaries` table had 0 rows. Codex's `threads` table had 0 rows. The only substantive Cursor data was 845 code hashes from a single day of Claude Opus 4.6 usage.

Meanwhile, Claude Code CLI has 2,734 user sessions with full transcripts, enabling all 24 MQI metrics with real variance.
