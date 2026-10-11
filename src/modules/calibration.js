/**
 * PulseCam - Personalized Guided Calibration Engine
 *
 * Implements a guided 2-minute (configurable, extendable to 5 minutes) calibration
 * session where the user sits still and looks at the screen.
 *
 * Records baseline mean and standard deviation (Gaussian parameters) for:
 * 1. Heart Rate (BPM)
 * 2. Blink Rate (/min)
 * 3. Eye Aspect Ratio (EAR) open-eye resting level
 * 4. Eye-closure duration (ms)
 * 5. Head-movement level (normalized IOD displacement)
 *
 * All later readings across PulseCam are expressed as deviation from this user's
 * own personal baseline (z-scores), never a universal population constant.
 */

export class CalibrationManager {
  /**
   * @param {number} [defaultDurationMs=120000] - Default session duration (120,000 ms = 2 min)
   */
  constructor(defaultDurationMs = 120000) {
    this.duration = defaultDurationMs;
    this.startTime = null;
    this.isCalibrating = false;
    this.isComplete = false;
    this.progress = 0; // 0 to 100%

    // Sample buffers collected across the calibration session
    this.collectedBPM = [];
    this.collectedBlinkRate = [];
    this.collectedEAR = [];
    this.collectedClosureDuration = [];
    this.collectedHeadMotion = [];
    this.collectedLuminance = [];

    // Calibrated numeric distributions
    this.profile = null;
    this.baselineBPM = null;
    this.baselineEAR = null;
    this.personalBlinkThreshold = null;
    this.personalPerclosThreshold = null;
  }

  /**
   * Start a guided calibration session
   * @param {number} [durationMs=120000] - Duration in ms (e.g. 120000 for 2 min, 300000 for 5 min)
   */
  start(durationMs = 120000) {
    this.duration = durationMs;
    this.startTime = performance.now();
    this.isCalibrating = true;
    this.isComplete = false;
    this.progress = 0;

    // Reset sample buffers
    this.collectedBPM = [];
    this.collectedBlinkRate = [];
    this.collectedEAR = [];
    this.collectedClosureDuration = [];
    this.collectedHeadMotion = [];
    this.collectedLuminance = [];

    this.profile = null;
  }

  /**
   * Extend the running calibration session (e.g. to 5 minutes / 300 seconds)
   * @param {number} [newDurationMs=300000]
   */
  extendTo(newDurationMs = 300000) {
    if (newDurationMs > this.duration) {
      this.duration = newDurationMs;
    }
  }

  /**
   * Reset calibration state
   */
  reset() {
    this.startTime = null;
    this.isCalibrating = false;
    this.isComplete = false;
    this.progress = 0;
    this.collectedBPM = [];
    this.collectedBlinkRate = [];
    this.collectedEAR = [];
    this.collectedClosureDuration = [];
    this.collectedHeadMotion = [];
    this.collectedLuminance = [];
    this.profile = null;
  }

  /**
   * Update calibration step with current frame metrics
   * @param {Object} metrics - { bpm, blinkRate, ear, closureDuration, headMotion, luminance }
   * @param {number} [now=performance.now()]
   */
  update(metrics = {}, now = performance.now()) {
    if (!this.isCalibrating || this.isComplete) {
      return {
        isCalibrating: this.isCalibrating,
        isComplete: this.isComplete,
        progress: this.progress,
        remainingSec: 0,
        totalSec: Math.round(this.duration / 1000),
        message: this.isComplete ? 'Personal baseline established' : 'Ready',
        profile: this.profile
      };
    }

    const elapsed = Math.max(0, now - this.startTime);
    this.progress = Math.min(100, Math.round((elapsed / this.duration) * 100));
    const remainingMs = Math.max(0, this.duration - elapsed);
    const remainingSec = Math.ceil(remainingMs / 1000);
    const totalSec = Math.round(this.duration / 1000);

    // 1. Collect Heart Rate (physiological plausible resting range 45 - 180 BPM)
    if (metrics.bpm && typeof metrics.bpm === 'number' && metrics.bpm >= 45 && metrics.bpm <= 180) {
      this.collectedBPM.push(metrics.bpm);
    }

    // 2. Collect Blink Rate
    if (metrics.blinkRate !== undefined && typeof metrics.blinkRate === 'number') {
      this.collectedBlinkRate.push(metrics.blinkRate);
    }

    // 3. Collect Open-Eye EAR (filter extreme closures so we isolate resting aperture)
    if (metrics.ear && typeof metrics.ear === 'number' && metrics.ear >= 0.12 && metrics.ear <= 0.50) {
      this.collectedEAR.push(metrics.ear);
    }

    // 4. Collect Closure Duration (when blinks or micro-closures occur during calibration)
    if (metrics.closureDuration && typeof metrics.closureDuration === 'number' && metrics.closureDuration > 50) {
      this.collectedClosureDuration.push(metrics.closureDuration);
    }

    // 5. Collect Head Motion (normalized displacement in IOD)
    if (metrics.headMotion !== undefined && typeof metrics.headMotion === 'number' && !isNaN(metrics.headMotion)) {
      this.collectedHeadMotion.push(metrics.headMotion);
    }

    // 6. Collect Ambient Luminance
    if (metrics.luminance !== undefined && typeof metrics.luminance === 'number') {
      this.collectedLuminance.push(metrics.luminance);
    }

    // Friendly, plain-language guidance based on calibration progress stage
    let phaseTitle = "Let's learn what's normal for you";
    let statusTip = "Sit comfortably and look at the screen for 2 minutes...";

    if (this.progress < 25) {
      phaseTitle = "Let's learn what's normal for you";
      statusTip = "Sit comfortably and look at the screen for 2 minutes...";
    } else if (this.progress < 55) {
      phaseTitle = "Learning your resting rhythm";
      statusTip = "Checking steady pulse rhythm. Breathe normally and stay relaxed...";
    } else if (this.progress < 80) {
      phaseTitle = "Learning your natural eye focus";
      statusTip = "Observing your natural blinking pace and eye comfort...";
    } else {
      phaseTitle = "Finishing your baseline";
      statusTip = "Almost there. Saving what is normal for you...";
    }

    // Check completion
    if (elapsed >= this.duration) {
      this.finish();
      phaseTitle = "All set!";
      statusTip = "Your personal baseline is ready. Future suggestions will be tailored to you.";
    }

    return {
      isCalibrating: this.isCalibrating,
      isComplete: this.isComplete,
      progress: this.progress,
      remainingSec,
      totalSec,
      phaseTitle,
      message: statusTip,
      samples: {
        bpm: this.collectedBPM.length,
        blink: this.collectedBlinkRate.length,
        ear: this.collectedEAR.length,
        motion: this.collectedHeadMotion.length,
        closure: this.collectedClosureDuration.length
      },
      profile: this.profile,
      baselineBPM: this.baselineBPM,
      baselineEAR: this.baselineEAR,
      personalBlinkThreshold: this.personalBlinkThreshold,
      personalPerclosThreshold: this.personalPerclosThreshold
    };
  }

  /**
   * Finalize the calibration session and compute Gaussian parameters (mean & std)
   */
  finish() {
    this.isCalibrating = false;
    this.isComplete = true;
    this.progress = 100;

    // Helper: calculate mean and standard deviation
    const calcStats = (arr, fallbackMean, minStd = 1.0) => {
      if (!arr || arr.length === 0) {
        return { mean: fallbackMean, std: minStd, count: 0 };
      }
      const sum = arr.reduce((a, b) => a + b, 0);
      const mean = sum / arr.length;
      if (arr.length < 2) {
        return { mean: Number(mean.toFixed(3)), std: minStd, count: arr.length };
      }
      const sumSqDiff = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0);
      const variance = sumSqDiff / (arr.length - 1);
      const std = Math.max(minStd, Math.sqrt(variance));
      return {
        mean: Number(mean.toFixed(3)),
        std: Number(std.toFixed(3)),
        count: arr.length
      };
    };

    // 1. Heart Rate (BPM)
    const hrStats = calcStats(this.collectedBPM, 72.0, 3.5);
    this.baselineBPM = Math.round(hrStats.mean);

    // 2. Blink Rate (/min)
    const blinkStats = calcStats(this.collectedBlinkRate, 16.0, 3.0);

    // 3. EAR Open-Eye Level
    // Use 70th percentile of collected EAR to isolate resting open-eye aperture
    let earStats;
    if (this.collectedEAR.length > 0) {
      const sortedEAR = [...this.collectedEAR].sort((a, b) => a - b);
      const p70Idx = Math.floor(sortedEAR.length * 0.70);
      const restingAperture = sortedEAR[p70Idx] || sortedEAR[Math.floor(sortedEAR.length / 2)];
      const rawStats = calcStats(this.collectedEAR, restingAperture, 0.015);
      earStats = {
        mean: Number(restingAperture.toFixed(3)),
        std: Number(Math.max(0.015, rawStats.std).toFixed(3)),
        count: this.collectedEAR.length
      };
    } else {
      earStats = { mean: 0.30, std: 0.02, count: 0 };
    }
    this.baselineEAR = earStats.mean;

    // Derive personal blink & PERCLOS thresholds from user's resting aperture
    this.personalBlinkThreshold = Number((this.baselineEAR * 0.72).toFixed(3));
    this.personalPerclosThreshold = Number((this.baselineEAR * 0.75).toFixed(3));

    // 4. Closure Duration (ms)
    const closureStats = calcStats(this.collectedClosureDuration, 140.0, 25.0);

    // 5. Head-Movement Level (normalized IOD displacement)
    const motionStats = calcStats(this.collectedHeadMotion, 0.008, 0.003);

    // Build complete baseline profile (numeric parameters only, zero image/video data)
    this.profile = {
      timestamp: Date.now(),
      date: new Date().toISOString(),
      durationSec: Math.round(this.duration / 1000),
      heartRate: hrStats,
      blinkRate: blinkStats,
      ear: earStats,
      closureDuration: closureStats,
      headMotion: motionStats,
      thresholds: {
        personalBlink: this.personalBlinkThreshold,
        personalPerclos: this.personalPerclosThreshold
      }
    };

    return this.profile;
  }
}
