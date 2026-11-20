//! Distribution transforms for z-scoring.

/// Per-metric distribution family. Transforms raw values to a space
/// where z-scoring is statistically well-behaved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetricFamily {
    /// Gaussian-like (thinking_depth, duration, token rate). Use raw value.
    Gaussian,
    /// Bounded [0, 1] ratio. Transform via `logit(clamp(x, eps, 1-eps))`.
    LogitUnit,
    /// Bounded [0, 10] cap (keyword_sentiment). Transform via logit after
    /// rescaling to [0, 1]: `logit(x/10)`.
    LogitBounded10,
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
        MetricFamily::LogitBounded10 => {
            let eps = 1e-3;
            let x = (raw / 10.0).clamp(eps, 1.0 - eps);
            (x / (1.0 - x)).ln()
        }
        // raw.max(0.0) so a stray negative count clamps to log1p(0)=0 rather than a NaN,
        // matching the canonical rusty-bloomnet transform.
        MetricFamily::Log1pCount => raw.max(0.0).ln_1p(),
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
        MetricFamily::LogitBounded10 => {
            let exp_t = transformed.exp();
            10.0 * exp_t / (1.0 + exp_t)
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
        for family in [
            MetricFamily::Gaussian,
            MetricFamily::LogitUnit,
            MetricFamily::LogitBounded10,
            MetricFamily::Log1pCount,
        ] {
            let raw = 0.5;
            let transformed = transform_raw(raw, family);
            let recovered = inverse_transform(transformed, family);
            assert!((raw - recovered).abs() < 1e-6, "{:?}: {} != {}", family, raw, recovered);
        }
    }
}
