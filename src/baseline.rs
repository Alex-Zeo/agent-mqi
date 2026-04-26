//! Baseline computation and storage.

use crate::metrics::{HIGHER_IS_BETTER, METRIC_COUNT, METRIC_FAMILIES, MIN_SIGMAS};
use crate::traits::SessionMetrics;
use crate::transforms::transform_raw;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Per-metric baseline statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricBaseline {
    /// Mean value in transformed space.
    pub mu: f64,
    /// Primary scale estimator (1.4826 * MAD on per-day means).
    pub sigma: f64,
    /// Session-level fallback when primary sigma collapses.
    #[serde(default)]
    pub sigma_fallback: f64,
    /// Source description (e.g., "golden", "topk_opus-4-7").
    pub source: String,
}

impl MetricBaseline {
    /// Choose the usable scale. Primary is preferred; fallback is rescue.
    pub fn effective_sigma(&self) -> f64 {
        if self.sigma >= 1e-3 {
            self.sigma
        } else {
            self.sigma_fallback
        }
    }
}

impl Default for MetricBaseline {
    fn default() -> Self {
        Self {
            mu: 0.0,
            sigma: 1.0,
            sigma_fallback: 0.0,
            source: "default".into(),
        }
    }
}

/// Where did the baseline come from?
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BaselineSource {
    /// User's own recent sessions (cold-start).
    #[serde(rename = "self")]
    Self_,
    /// Shipped golden window.
    #[default]
    Golden,
}

impl BaselineSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Self_ => "self",
            Self::Golden => "golden",
        }
    }
}

/// Full baseline for scoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub window_start: String,
    pub window_end: String,
    pub session_count: u32,
    pub per_metric: Vec<MetricBaseline>,
    pub issue_velocity_daily_mean: f64,
    #[serde(default = "one")]
    pub composite_std_empirical: f64,
    #[serde(default)]
    pub source: BaselineSource,
}

fn one() -> f64 {
    1.0
}

impl Default for Baseline {
    fn default() -> Self {
        Self {
            window_start: String::new(),
            window_end: String::new(),
            session_count: 0,
            per_metric: (0..METRIC_COUNT).map(|_| MetricBaseline::default()).collect(),
            issue_velocity_daily_mean: 1.0,
            composite_std_empirical: 1.0,
            source: BaselineSource::Golden,
        }
    }
}

/// Config for per-model top-K baseline selection.
#[derive(Clone, Copy, Debug)]
pub struct TopKConfig {
    /// Fraction of sessions to use (e.g., 0.20 = top 20%).
    pub fraction: f64,
    /// Minimum absolute count.
    pub min_count: usize,
    /// Minimum sessions before building per-model baseline.
    pub min_sessions: usize,
    /// Minimum effective sigma (prevents z-score blow-ups).
    pub min_sigma: f64,
}

impl Default for TopKConfig {
    fn default() -> Self {
        Self {
            fraction: 0.20,
            min_count: 30,
            min_sessions: 50,
            min_sigma: 0.05,
        }
    }
}

/// Compute baseline from a set of sessions in a date window.
pub fn compute_baseline<S: SessionMetrics>(
    sessions: &[S],
    dates: &[String],
    window_start: &str,
    window_end: &str,
) -> Baseline {
    let in_window: Vec<usize> = dates
        .iter()
        .enumerate()
        .filter(|(_, d)| d.as_str() >= window_start && d.as_str() <= window_end)
        .map(|(i, _)| i)
        .collect();

    if in_window.is_empty() {
        return Baseline::default();
    }

    let mut per_metric = Vec::with_capacity(METRIC_COUNT);
    for k in 0..METRIC_COUNT {
        let family = METRIC_FAMILIES[k];
        let values: Vec<f64> = in_window
            .iter()
            .map(|&i| transform_raw(sessions[i].metric_value(k), family))
            .filter(|v| v.is_finite())
            .collect();

        if values.is_empty() {
            per_metric.push(MetricBaseline::default());
            continue;
        }

        let mu = values.iter().sum::<f64>() / values.len() as f64;
        let var = values.iter().map(|v| (v - mu).powi(2)).sum::<f64>() / values.len() as f64;
        let sigma = var.sqrt().max(MIN_SIGMAS[k]);

        per_metric.push(MetricBaseline {
            mu,
            sigma,
            sigma_fallback: sigma,
            source: "computed".into(),
        });
    }

    Baseline {
        window_start: window_start.into(),
        window_end: window_end.into(),
        session_count: in_window.len() as u32,
        per_metric,
        issue_velocity_daily_mean: 1.0,
        composite_std_empirical: 1.0,
        source: BaselineSource::Golden,
    }
}

/// Build per-model top-K baselines.
pub fn compute_per_model_topk_baselines<S: SessionMetrics>(
    sessions: &[S],
    models: &[String],
    cfg: TopKConfig,
) -> HashMap<String, Baseline> {
    let mut by_model: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, m) in models.iter().enumerate() {
        if !m.is_empty() {
            by_model.entry(m.clone()).or_default().push(i);
        }
    }

    let mut out = HashMap::new();
    for (model, idxs) in by_model {
        if idxs.len() < cfg.min_sessions {
            continue;
        }

        let mut per_metric = Vec::with_capacity(METRIC_COUNT);
        for k in 0..METRIC_COUNT {
            let family = METRIC_FAMILIES[k];

            // Rank by raw values (monotone transforms preserve order)
            let mut ranked: Vec<(usize, f64)> = idxs
                .iter()
                .map(|&i| (i, sessions[i].metric_value(k)))
                .filter(|(_, v)| v.is_finite())
                .collect();

            if HIGHER_IS_BETTER[k] {
                ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            } else {
                ranked.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
            }

            let top_n = std::cmp::max(
                (ranked.len() as f64 * cfg.fraction).floor() as usize,
                cfg.min_count,
            )
            .min(ranked.len());

            if top_n == 0 {
                per_metric.push(MetricBaseline {
                    mu: 0.0,
                    sigma: cfg.min_sigma,
                    sigma_fallback: 0.0,
                    source: "topk_empty".into(),
                });
                continue;
            }

            // Aggregate in transformed space
            let top: Vec<f64> = ranked
                .iter()
                .take(top_n)
                .map(|(_, v)| transform_raw(*v, family))
                .collect();
            let mu = top.iter().sum::<f64>() / top.len() as f64;
            let var = top.iter().map(|v| (v - mu).powi(2)).sum::<f64>() / top.len().max(1) as f64;
            let sigma = var.sqrt().max(cfg.min_sigma).max(MIN_SIGMAS[k]);

            per_metric.push(MetricBaseline {
                mu,
                sigma,
                sigma_fallback: sigma,
                source: format!("topk_{}", model),
            });
        }

        out.insert(
            model.clone(),
            Baseline {
                window_start: String::new(),
                window_end: String::new(),
                session_count: idxs.len() as u32,
                per_metric,
                issue_velocity_daily_mean: 1.0,
                composite_std_empirical: 1.0,
                source: BaselineSource::Golden,
            },
        );
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_baseline() {
        let b = Baseline::default();
        assert_eq!(b.per_metric.len(), METRIC_COUNT);
        assert_eq!(b.composite_std_empirical, 1.0);
    }

    #[test]
    fn test_compute_baseline() {
        let sessions: Vec<[f64; METRIC_COUNT]> = (0..100)
            .map(|i| {
                let mut arr = [0.0; METRIC_COUNT];
                arr[2] = (i as f64) * 10.0; // thinking_depth
                arr
            })
            .collect();
        let dates: Vec<String> = (0..100).map(|i| format!("2026-01-{:02}", i % 31 + 1)).collect();

        let b = compute_baseline(&sessions, &dates, "2026-01-01", "2026-01-31");
        assert!(b.session_count > 0);
        assert!(b.per_metric[2].sigma > 0.0);
    }
}
