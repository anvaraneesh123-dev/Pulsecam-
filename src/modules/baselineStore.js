/**
 * PulseCam - Personal Baseline Storage & Deviation (Z-Score) Engine
 *
 * Manages client-side persistence of the user's individual calibration profile.
 * STRICT PRIVACY REQUIREMENT: Stores ONLY numeric distribution parameters
 * (mean, standard deviation, sample count, timestamp). Zero images, video,
 * or canvas frames are ever stored.
 */

export const BASELINE_STORAGE_KEY = 'pulsecam_user_baseline';
export const BASELINE_MAX_AGE_DAYS = 7;
export const BASELINE_MAX_AGE_MS = BASELINE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/**
 * Load the stored baseline profile from localStorage.
 * Checks for validity and age (prompts recalibration if older than 7 days).
 * @returns {{ baseline: Object|null, isStale: boolean, ageDays: number }}
 */
export function loadStoredBaseline() {
  try {
    const raw = localStorage.getItem(BASELINE_STORAGE_KEY);
    if (!raw) {
      return { baseline: null, isStale: false, ageDays: 0 };
    }

    const baseline = JSON.parse(raw);
    if (!baseline || typeof baseline !== 'object' || !baseline.timestamp) {
      return { baseline: null, isStale: false, ageDays: 0 };
    }

    // Verify presence of essential numeric distributions
    if (!baseline.heartRate || !baseline.blinkRate || !baseline.ear) {
      return { baseline: null, isStale: false, ageDays: 0 };
    }

    const ageMs = Date.now() - baseline.timestamp;
    const ageDays = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
    const isStale = ageMs > BASELINE_MAX_AGE_MS;

    return {
      baseline,
      isStale,
      ageDays
    };
  } catch (err) {
    console.warn('Failed to parse stored baseline from localStorage:', err);
    return { baseline: null, isStale: false, ageDays: 0 };
  }
}

/**
 * Persist the calibrated numeric baseline profile to localStorage.
 * ONLY numeric statistical summaries are saved.
 * @param {Object} profile - Calibration profile object
 */
export function saveStoredBaseline(profile) {
  if (!profile || typeof profile !== 'object') return false;

  // Enforce strict schema with numeric distributions only
  const sanitized = {
    timestamp: profile.timestamp || Date.now(),
    date: profile.date || new Date().toISOString(),
    durationSec: profile.durationSec || 120,
    heartRate: {
      mean: Number(profile.heartRate?.mean || 72),
      std: Number(Math.max(1.0, profile.heartRate?.std || 4.0)),
      count: Number(profile.heartRate?.count || 0)
    },
    blinkRate: {
      mean: Number(profile.blinkRate?.mean || 16),
      std: Number(Math.max(1.0, profile.blinkRate?.std || 3.0)),
      count: Number(profile.blinkRate?.count || 0)
    },
    ear: {
      mean: Number(profile.ear?.mean || 0.30),
      std: Number(Math.max(0.005, profile.ear?.std || 0.02)),
      count: Number(profile.ear?.count || 0)
    },
    closureDuration: {
      mean: Number(profile.closureDuration?.mean || 140),
      std: Number(Math.max(5.0, profile.closureDuration?.std || 25)),
      count: Number(profile.closureDuration?.count || 0)
    },
    headMotion: {
      mean: Number(profile.headMotion?.mean || 0.008),
      std: Number(Math.max(0.001, profile.headMotion?.std || 0.004)),
      count: Number(profile.headMotion?.count || 0)
    },
    thresholds: {
      personalBlink: Number(profile.thresholds?.personalBlink || 0.22),
      personalPerclos: Number(profile.thresholds?.personalPerclos || 0.23)
    }
  };

  try {
    localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(sanitized));
    return true;
  } catch (err) {
    console.error('Failed to store baseline profile in localStorage:', err);
    return false;
  }
}

/**
 * Remove stored baseline profile
 */
export function clearStoredBaseline() {
  try {
    localStorage.removeItem(BASELINE_STORAGE_KEY);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Compute deviation as a z-score relative to the user's personal baseline:
 * z = (value - mean) / max(std, minStd)
 * @param {number|null} value - Current observed reading
 * @param {number} mean - Baseline distribution mean
 * @param {number} std - Baseline standard deviation
 * @param {number} [minStd=0.001] - Minimum denominator floor to prevent division by zero
 * @returns {number|null}
 */
export function computeZScore(value, mean, std, minStd = 0.001) {
  if (value === null || value === undefined || isNaN(value)) return null;
  const effectiveStd = Math.max(std || 0, minStd);
  const z = (value - mean) / effectiveStd;
  return Number(z.toFixed(2));
}

/**
 * Format a z-score for UI display (e.g., "+1.4σ", "-0.8σ")
 * @param {number|null} z
 * @returns {string}
 */
export function formatZScore(z) {
  if (z === null || z === undefined || isNaN(z)) return '--';
  const prefix = z > 0 ? '+' : '';
  return `${prefix}${z.toFixed(1)}σ`;
}

/**
 * Get visual severity token for a z-score deviation:
 * |z| <= 1.0: Typical / Baseline (good)
 * 1.0 < |z| <= 2.0: Mild deviation (caution)
 * |z| > 2.0: Significant deviation (alert)
 * @param {number|null} z
 * @returns {'typical'|'mild'|'marked'}
 */
export function getZScoreSeverity(z) {
  if (z === null || z === undefined || isNaN(z)) return 'typical';
  const absZ = Math.abs(z);
  if (absZ <= 1.0) return 'typical';
  if (absZ <= 2.0) return 'mild';
  return 'marked';
}
