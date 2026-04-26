//! Z-score and composite scoring.

use crate::baseline::Baseline;
use crate::metrics::{
    HIGHER_IS_BETTER, HOOK_COACHED, IS_MODEL_METRIC, METRIC_COUNT, METRIC_FAMILIES, MIN_SIGMAS,
    WEIGHTS,
};
use crate::traits::SessionMetrics;
use crate::transforms::transform_raw;
use serde::{Deserialize, Serialize};

/// Z-score clipping threshold.
pub const Z_CLIP: f64 = 5.0;

/// Result of scoring a single session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionScore {
    /// Final MQI-X score (0-100 scale).
    pub mqi_x: f64,
    /// Model-only composite (excludes environment signals).
    pub mqi_x_model: f64,
    /// Uncoached composite (excludes hook-coached metrics).
    pub mqi_x_uncoached: f64,
    /// Raw composite z-score before sigmoid.
    pub composite_z: f64,
    /// Per-metric scores.
    pub metrics: Vec<MetricScore>,
}

/// Per-metric score details.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricScore {
    pub name: String,
    pub raw: f64,
    pub z: f64,
    pub weight: f64,
    pub status: MetricStatus,
}

/// Traffic-light status for metrics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MetricStatus {
    Green,
    Amber,
    Error,
}

/// Score a session against a baseline.
pub fn score_session<S: SessionMetrics>(session: &S, baseline: &Baseline) -> SessionScore {
    let raw_values = session.to_raw_array();
    let (z_scores, statuses) = compute_z_scores(&raw_values, baseline);

    // Compute composites
    let composite_z = weighted_sum(&z_scores, &WEIGHTS);
    let mqi_x = sigmoid_to_100(composite_z, baseline.composite_std_empirical);

    // Model-only (excludes environment signals)
    let model_weights = renormalize_weights(&WEIGHTS, &IS_MODEL_METRIC);
    let model_z = weighted_sum_masked(&z_scores, &model_weights, &IS_MODEL_METRIC);
    let mqi_x_model = sigmoid_to_100(model_z, baseline.composite_std_empirical);

    // Uncoached (excludes hook-coached metrics)
    let uncoached_mask: [bool; METRIC_COUNT] = std::array::from_fn(|i| !HOOK_COACHED[i]);
    let uncoached_weights = renormalize_weights(&WEIGHTS, &uncoached_mask);
    let uncoached_z = weighted_sum_masked(&z_scores, &uncoached_weights, &uncoached_mask);
    let mqi_x_uncoached = sigmoid_to_100(uncoached_z, baseline.composite_std_empirical);

    // Build per-metric results
    let metrics: Vec<MetricScore> = (0..METRIC_COUNT)
        .map(|i| MetricScore {
            name: crate::metrics::METRIC_NAMES[i].to_string(),
            raw: raw_values[i],
            z: z_scores[i],
            weight: WEIGHTS[i],
            status: statuses[i],
        })
        .collect();

    SessionScore {
        mqi_x,
        mqi_x_model,
        mqi_x_uncoached,
        composite_z,
        metrics,
    }
}

/// Compute z-scores for all metrics.
fn compute_z_scores(raw: &[f64; METRIC_COUNT], baseline: &Baseline) -> ([f64; METRIC_COUNT], [MetricStatus; METRIC_COUNT]) {
    let mut z_scores = [0.0; METRIC_COUNT];
    let mut statuses = [MetricStatus::Green; METRIC_COUNT];

    for k in 0..METRIC_COUNT {
        let family = METRIC_FAMILIES[k];
        let mb = &baseline.per_metric[k];
        let sigma = mb.effective_sigma().max(MIN_SIGMAS[k]).max(1e-6);

        let transformed = transform_raw(raw[k], family);
        let mut z = (transformed - mb.mu) / sigma;

        // Orient so positive z = good
        if !HIGHER_IS_BETTER[k] {
            z = -z;
        }

        // Clip extreme values
        z = z.clamp(-Z_CLIP, Z_CLIP);
        z_scores[k] = z;

        // Determine status
        statuses[k] = if z >= -1.0 {
            MetricStatus::Green
        } else if z >= -2.0 {
            MetricStatus::Amber
        } else {
            MetricStatus::Error
        };
    }

    (z_scores, statuses)
}

/// Weighted sum of z-scores.
fn weighted_sum(z: &[f64; METRIC_COUNT], w: &[f64; METRIC_COUNT]) -> f64 {
    z.iter().zip(w.iter()).map(|(z, w)| z * w).sum()
}

/// Weighted sum with mask.
fn weighted_sum_masked(z: &[f64; METRIC_COUNT], w: &[f64; METRIC_COUNT], mask: &[bool; METRIC_COUNT]) -> f64 {
    z.iter()
        .zip(w.iter())
        .zip(mask.iter())
        .filter(|(_, m)| **m)
        .map(|((z, w), _)| z * w)
        .sum()
}

/// Renormalize weights to sum to 1.0 over masked subset.
fn renormalize_weights(w: &[f64; METRIC_COUNT], mask: &[bool; METRIC_COUNT]) -> [f64; METRIC_COUNT] {
    let total: f64 = w.iter().zip(mask.iter()).filter(|(_, m)| **m).map(|(w, _)| w).sum();
    let mut out = [0.0; METRIC_COUNT];
    if total > 1e-6 {
        for i in 0..METRIC_COUNT {
            if mask[i] {
                out[i] = w[i] / total;
            }
        }
    }
    out
}

/// Sigmoid transform to 0-100 scale.
fn sigmoid_to_100(z: f64, empirical_std: f64) -> f64 {
    let scale = empirical_std.max(1.0);
    let normalized = z / scale;
    let sig = 1.0 / (1.0 + (-normalized).exp());
    sig * 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::baseline::Baseline;
    use crate::transforms::transform_raw;

    #[test]
    fn test_sigmoid_midpoint() {
        let mqi = sigmoid_to_100(0.0, 1.0);
        assert!((mqi - 50.0).abs() < 0.1);
    }

    #[test]
    fn test_score_session() {
        let baseline = Baseline::default();
        let session = [0.0; METRIC_COUNT];
        let score = score_session(&session, &baseline);

        assert!(score.mqi_x >= 0.0 && score.mqi_x <= 100.0);
        assert_eq!(score.metrics.len(), METRIC_COUNT);
    }

    #[test]
    fn test_high_quality_session() {
        let mut baseline = Baseline::default();
        // Set baseline mu in transformed space and sigma to 1 for all metrics
        for (i, mb) in baseline.per_metric.iter_mut().enumerate() {
            let family = METRIC_FAMILIES[i];
            mb.mu = transform_raw(1.0, family); // baseline at raw=1.0
            mb.sigma = 1.0;
        }

        // Create a session with good values
        // For higher-is-better: use higher raw values
        // For lower-is-better: use lower raw values (but still positive for Log1pCount)
        let mut session = [0.0; METRIC_COUNT];
        for i in 0..METRIC_COUNT {
            if HIGHER_IS_BETTER[i] {
                session[i] = 10.0; // well above baseline
            } else {
                session[i] = 0.1; // well below baseline (good for lower-is-better)
            }
        }

        let score = score_session(&session, &baseline);
        assert!(score.mqi_x > 50.0, "High quality session should score > 50, got {}", score.mqi_x);
    }
}
