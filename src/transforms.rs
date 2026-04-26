//! Distribution transforms for z-scoring.

/// Per-metric distribution family. Transforms raw values to a space
/// where z-scoring is statistically well-behaved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetricFamily {
    /// Gaussian-like (thinking_depth, duration, token rate). Use raw value.
    Gaussian,
    /// Bounded [0, 1] ratio. Transform via `logit(clamp(x, eps, 1-eps))`.
    LogitUnit,
    /// Heavy-tailed count (zero-inflated). Transform via `log1p(x)`.
    Log1pCount,
}

/// Apply the per-metric distribution family transform.
/// Input is the raw metric value; output lives in a space where
/// scoring is approximately symmetric.
pub fn transform_raw(raw: f64, family: MetricFamily) -> f64 {
    match family {
        MetricFamily::Gaussian => raw,
        MetricFamily::LogitUnit => {
            let eps = 1e-3;
            let x = raw.clamp(eps, 1.0 - eps);
            (x / (1.0 - x)).ln()
        }
        MetricFamily::Log1pCount => (raw + 1.0).ln(),
    }
}

/// Inverse transform (for interpretation).
pub fn inverse_transform(transformed: f64, family: MetricFamily) -> f64 {
    match family {
        MetricFamily::Gaussian => transformed,
        MetricFamily::LogitUnit => {
            let exp_t = transformed.exp();
            exp_t / (1.0 + exp_t)
        }
        MetricFamily::Log1pCount => transformed.exp() - 1.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gaussian_identity() {
        assert!((transform_raw(5.0, MetricFamily::Gaussian) - 5.0).abs() < 1e-10);
    }

    #[test]
    fn test_logit_bounds() {
        let t = transform_raw(0.5, MetricFamily::LogitUnit);
        assert!(t.abs() < 1e-10); // logit(0.5) = 0

        let t_high = transform_raw(0.9, MetricFamily::LogitUnit);
        assert!(t_high > 0.0);

        let t_low = transform_raw(0.1, MetricFamily::LogitUnit);
        assert!(t_low < 0.0);
    }

    #[test]
    fn test_log1p() {
        assert!((transform_raw(0.0, MetricFamily::Log1pCount) - 0.0).abs() < 1e-10);
        assert!((transform_raw(1.0, MetricFamily::Log1pCount) - 2.0_f64.ln()).abs() < 1e-10);
    }

    #[test]
    fn test_inverse_roundtrip() {
        for family in [MetricFamily::Gaussian, MetricFamily::LogitUnit, MetricFamily::Log1pCount] {
            let raw = 0.5;
            let transformed = transform_raw(raw, family);
            let recovered = inverse_transform(transformed, family);
            assert!((raw - recovered).abs() < 1e-6, "{:?}: {} != {}", family, raw, recovered);
        }
    }
}
