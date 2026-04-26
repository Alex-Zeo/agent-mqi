//! Traits for pluggable session input.

use crate::metrics::METRIC_COUNT;

/// Trait for session data that can be scored by MQI.
/// Implement this for your session type to enable scoring.
///
/// # Example
///
/// ```rust
/// use agent_mqi::{SessionMetrics, METRIC_COUNT};
///
/// struct ClaudeCodeSession {
///     read_edit_ratio: f64,
///     thinking_depth: f64,
///     // ... other metrics
/// }
///
/// impl SessionMetrics for ClaudeCodeSession {
///     fn metric_value(&self, index: usize) -> f64 {
///         match index {
///             0 => self.read_edit_ratio,
///             2 => self.thinking_depth,
///             _ => 0.0,
///         }
///     }
/// }
/// ```
pub trait SessionMetrics {
    /// Get the raw value for metric at `index` (0..METRIC_COUNT).
    fn metric_value(&self, index: usize) -> f64;

    /// Get all metric values as an array.
    fn to_raw_array(&self) -> [f64; METRIC_COUNT] {
        let mut arr = [0.0; METRIC_COUNT];
        for i in 0..METRIC_COUNT {
            arr[i] = self.metric_value(i);
        }
        arr
    }
}

/// Blanket implementation for arrays.
impl SessionMetrics for [f64; METRIC_COUNT] {
    fn metric_value(&self, index: usize) -> f64 {
        self[index]
    }

    fn to_raw_array(&self) -> [f64; METRIC_COUNT] {
        *self
    }
}

/// Blanket implementation for Vec<f64> (panics if wrong length).
impl SessionMetrics for Vec<f64> {
    fn metric_value(&self, index: usize) -> f64 {
        self[index]
    }

    fn to_raw_array(&self) -> [f64; METRIC_COUNT] {
        assert_eq!(self.len(), METRIC_COUNT);
        let mut arr = [0.0; METRIC_COUNT];
        arr.copy_from_slice(self);
        arr
    }
}
