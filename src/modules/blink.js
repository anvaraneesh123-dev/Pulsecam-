/**
 * PulseCam - Blink & Ocular Kinematics Tracker Module
 *
 * Implements:
 * 1. Eye Aspect Ratio (EAR) computation from 6-point MediaPipe landmarks for both eyes (averaged).
 * 2. Personalized threshold derivation from user calibration baseline (no fixed global thresholds).
 * 3. Blink detection: EAR dips below personal threshold for strictly 2-6 consecutive frames.
 * 4. Blink rate per minute over rolling 60-second temporal window.
 * 5. Eye-closure duration (PERCLOS-style: fraction of time eyes are mostly closed in a rolling window).
 * 6. Glasses and partial occlusion compensation: detects landmark jitter and bilateral asymmetry,
 *    lowering ocular confidence and suppressing false blink triggers during glasses glare/occlusion.
 */

import { calculateEAR, euclideanDistance } from '../utils/mathUtils.js';

export class BlinkTracker {
  /**
   * @param {Object} [options]
   * @param {number} [options.baselineEAR=null] - User's resting open-eye EAR baseline
   * @param {number} [options.perclosWindowMs=30000] - Rolling PERCLOS window duration (30 seconds)
   */
  constructor(options = {}) {
    // MediaPipe canonical 6-point landmark indices for each eye
    this.EYE_INDICES_LEFT = [33, 160, 158, 133, 153, 144];
    this.EYE_INDICES_RIGHT = [362, 385, 387, 263, 373, 380];

    // Personal calibration baseline & derived thresholds
    this.personalBaselineEAR = options.baselineEAR || null;
    this.personalBlinkThreshold = null;
    this.personalPerclosThreshold = null;
    if (this.personalBaselineEAR) {
      this.setPersonalBaseline(this.personalBaselineEAR);
    }

    // Eyelid kinematics state
    this.currentEAR = 0.30;
    this.leftEAR = 0.30;
    this.rightEAR = 0.30;
    this.isClosed = false;
    this.closedStartTime = 0;
    this.closedFrameCount = 0; // Number of consecutive frames below threshold
    this.minEarDuringDip = 1.0;

    // Blink metrics
    this.totalBlinks = 0;
    this.blinkTimestamps = []; // Timestamps of confirmed blinks within past 60s
    this.prolongedClosureCount = 0;
    this.lastBlinkFrames = 0;
    this.lastBlinkDurationMs = 0;

    // Rolling PERCLOS window (fraction of time eyes are mostly closed in rolling 30s window)
    this.perclosWindowMs = options.perclosWindowMs || 30000;
    this.closureHistory = []; // Array of { timestamp, isClosed, ear }

    // Landmark jitter & glasses/occlusion handling
    this.prevEyeLandmarks = null;
    this.jitter = 0;
    this.ocularConfidence = 100; // 0 - 100%
    this.isOccludedOrJittering = false;

    // Adaptive buffer before calibration baseline is locked
    this.earAccumulator = [];
  }

  /**
   * Reset tracking state
   */
  reset() {
    this.isClosed = false;
    this.closedStartTime = 0;
    this.closedFrameCount = 0;
    this.minEarDuringDip = 1.0;
    this.totalBlinks = 0;
    this.blinkTimestamps = [];
    this.prolongedClosureCount = 0;
    this.closureHistory = [];
    this.prevEyeLandmarks = null;
    this.jitter = 0;
    this.ocularConfidence = 100;
    this.isOccludedOrJittering = false;
    this.earAccumulator = [];
  }

  /**
   * Set personal baseline and derive customized thresholds from calibration data
   * (Do not use fixed global thresholds)
   * @param {number} baselineEAR - Resting open-eye baseline from calibration
   */
  setPersonalBaseline(baselineEAR) {
    if (!baselineEAR || isNaN(baselineEAR) || baselineEAR < 0.15 || baselineEAR > 0.50) return;
    this.personalBaselineEAR = Number(baselineEAR.toFixed(3));
    // Blink threshold is 72% of personal resting open-eye baseline
    this.personalBlinkThreshold = Number((this.personalBaselineEAR * 0.72).toFixed(3));
    // PERCLOS threshold is 75% of baseline (mostly closed eyelid)
    this.personalPerclosThreshold = Number((this.personalBaselineEAR * 0.75).toFixed(3));
  }

  /**
   * Evaluate eye landmark jitter and bilateral asymmetry to detect glasses glare or occlusion
   * @private
   */
  _evaluateJitterAndOcclusion(landmarks, leftEAR, rightEAR) {
    const eyeIndices = [...this.EYE_INDICES_LEFT, ...this.EYE_INDICES_RIGHT];
    const currentPoints = eyeIndices.map((i) => landmarks[i]).filter(Boolean);

    if (currentPoints.length !== 12) {
      return { jitter: 0, asymmetry: 0, confidence: 35 };
    }

    // Inter-ocular distance or horizontal eye width for scale normalization
    const pLeftOuter = landmarks[33];
    const pLeftInner = landmarks[133];
    const pRightInner = landmarks[362];
    const pRightOuter = landmarks[263];

    let eyeWidth = 0.05;
    if (pLeftOuter && pLeftInner && pRightInner && pRightOuter) {
      const wL = euclideanDistance(pLeftOuter, pLeftInner);
      const wR = euclideanDistance(pRightOuter, pRightInner);
      eyeWidth = Math.max(0.01, (wL + wR) / 2);
    }

    let jitter = 0;
    if (this.prevEyeLandmarks && this.prevEyeLandmarks.length === 12) {
      let sumDisp = 0;
      for (let i = 0; i < 12; i++) {
        sumDisp += euclideanDistance(currentPoints[i], this.prevEyeLandmarks[i]);
      }
      const meanDisp = sumDisp / 12;
      jitter = meanDisp / eyeWidth;
    }
    this.prevEyeLandmarks = currentPoints;

    // Bilateral asymmetry between left and right eye (identifies unilateral occlusion like hair or glasses rim)
    const asymmetry = Math.abs(leftEAR - rightEAR);

    // Ocular confidence calculation:
    // Natural, unoccluded eyes exhibit jitter <= 0.035 and asymmetry <= 0.06
    let penalty = 0;
    if (jitter > 0.035) {
      // Jitter penalty up to 60 points
      penalty += Math.min(60, Math.round(((jitter - 0.035) / 0.065) * 60));
    }
    if (asymmetry > 0.06) {
      // Asymmetry penalty up to 35 points
      penalty += Math.min(35, Math.round(((asymmetry - 0.06) / 0.08) * 35));
    }

    const rawConfidence = Math.max(10, Math.min(100, 100 - penalty));
    // Exponential smoothing on confidence to prevent jitter spikes from flickering the UI
    this.ocularConfidence = Math.round(0.25 * rawConfidence + 0.75 * this.ocularConfidence);
    this.jitter = Number(jitter.toFixed(4));
    this.isOccludedOrJittering = this.ocularConfidence < 55;

    return {
      jitter: this.jitter,
      asymmetry: Number(asymmetry.toFixed(3)),
      confidence: this.ocularConfidence
    };
  }

  /**
   * Derive dynamic baseline if calibration has not yet established personal thresholds
   * @private
   */
  _getEffectiveBlinkThreshold() {
    if (this.personalBlinkThreshold) {
      return this.personalBlinkThreshold;
    }
    // Dynamic buffer fallback: 70th percentile of accumulating EAR observations
    if (this.earAccumulator.length >= 25) {
      const sorted = [...this.earAccumulator].sort((a, b) => a - b);
      const p70 = sorted[Math.floor(sorted.length * 0.70)];
      return Number((p70 * 0.72).toFixed(3));
    }
    return 0.22; // Fallback prior to data accumulation
  }

  /**
   * @private
   */
  _getEffectivePerclosThreshold() {
    if (this.personalPerclosThreshold) {
      return this.personalPerclosThreshold;
    }
    const blinkThresh = this._getEffectiveBlinkThreshold();
    return Number((blinkThresh * 1.05).toFixed(3));
  }

  /**
   * Process current frame's MediaPipe landmarks:
   * 1. Averages EAR for both eyes.
   * 2. Evaluates jitter to lower confidence on glasses glare or partial occlusion.
   * 3. Detects blinks where EAR dips below personal threshold for strictly 2-6 consecutive frames.
   * 4. Computes blink rate per minute over rolling 60 seconds.
   * 5. Computes PERCLOS (fraction of time eyes are mostly closed in rolling window).
   *
   * @param {Array} landmarks - 468+ MediaPipe facial landmarks
   * @param {number} [timestampMs=performance.now()] - Timestamp in ms
   * @param {Object} [calibrationData=null] - Calibration baseline data if available
   */
  process(landmarks, timestampMs = performance.now(), calibrationData = null) {
    if (!landmarks || landmarks.length < 468) {
      return {
        ear: 0.30,
        leftEar: 0.30,
        rightEar: 0.30,
        blinkRate: this.blinkTimestamps.length,
        totalBlinks: this.totalBlinks,
        perclos: 0,
        perclosPct: 0,
        closureDurationMs: 0,
        prolongedClosures: this.prolongedClosureCount,
        isEyeClosed: false,
        isDrowsy: false,
        confidence: 0,
        jitter: 0,
        isOccludedOrJittering: true,
        personalThreshold: this.personalBlinkThreshold || 0.22,
        personalBaseline: this.personalBaselineEAR || 0.30,
        status: 'no_face',
        message: 'Eye landmarks acquiring...'
      };
    }

    // 1. Sync calibration baseline if provided from calibration step
    if (calibrationData) {
      if (calibrationData.baselineEAR && (!this.personalBaselineEAR || this.personalBaselineEAR !== calibrationData.baselineEAR)) {
        this.setPersonalBaseline(calibrationData.baselineEAR);
      }
      if (calibrationData.personalBlinkThreshold) {
        this.personalBlinkThreshold = calibrationData.personalBlinkThreshold;
      }
      if (calibrationData.personalPerclosThreshold) {
        this.personalPerclosThreshold = calibrationData.personalPerclosThreshold;
      }
    }

    // 2. Compute Eye Aspect Ratio from MediaPipe eye landmarks (both eyes, averaged)
    const leftEAR = calculateEAR(landmarks, this.EYE_INDICES_LEFT);
    const rightEAR = calculateEAR(landmarks, this.EYE_INDICES_RIGHT);
    const avgEAR = (leftEAR + rightEAR) / 2;
    this.leftEAR = Number(leftEAR.toFixed(3));
    this.rightEAR = Number(rightEAR.toFixed(3));
    this.currentEAR = Number(avgEAR.toFixed(3));

    // Accumulate for dynamic baseline if calibration baseline not yet set
    if (!this.personalBaselineEAR) {
      this.earAccumulator.push(avgEAR);
      if (this.earAccumulator.length > 150) this.earAccumulator.shift();
    }

    // 3. Handle glasses and partial occlusion by lowering confidence when landmarks jitter
    const { jitter, confidence, asymmetry } = this._evaluateJitterAndOcclusion(landmarks, leftEAR, rightEAR);

    // 4. Derive personalized thresholds (never fixed global thresholds)
    const blinkThreshold = this._getEffectiveBlinkThreshold();
    const perclosThreshold = this._getEffectivePerclosThreshold();

    // 5. Detect blinks: "EAR dips below a personal threshold for 2-6 frames"
    const isBelowThreshold = avgEAR < blinkThreshold;
    let newBlinkDetected = false;

    if (isBelowThreshold) {
      this.closedFrameCount++;
      if (this.closedFrameCount === 1) {
        this.closedStartTime = timestampMs;
        this.minEarDuringDip = avgEAR;
      } else {
        this.minEarDuringDip = Math.min(this.minEarDuringDip, avgEAR);
      }
      this.isClosed = true;
    } else {
      if (this.closedFrameCount > 0) {
        // Eyelid has reopened after dipping below threshold
        const frames = this.closedFrameCount;
        const durationMs = timestampMs - this.closedStartTime;
        this.closedFrameCount = 0;
        this.isClosed = false;

        // Condition: EAR dips below personal threshold for 2-6 frames
        // Require confidence >= 30 so glasses glare jitter does not register spurious blinks
        if (frames >= 2 && frames <= 6 && confidence >= 30) {
          this.totalBlinks++;
          this.blinkTimestamps.push(timestampMs);
          this.lastBlinkFrames = frames;
          this.lastBlinkDurationMs = Math.round(durationMs);
          newBlinkDetected = true;
        } else if (frames > 6) {
          // Prolonged closure (>6 frames / >200ms) indicates micro-sleep / eye droop, not a quick blink
          this.prolongedClosureCount++;
        }
        // If frames < 2 (1 frame dip), discarded as optical noise/flutter
      }
    }

    // 6. Blink rate per minute: prune timestamps older than 60 seconds
    const cutoffTime = timestampMs - 60000;
    this.blinkTimestamps = this.blinkTimestamps.filter((t) => t >= cutoffTime);
    const blinkRate = this.blinkTimestamps.length;

    // 7. Eye-closure duration (PERCLOS-style: fraction of time eyes are mostly closed in rolling window)
    const isMostlyClosed = avgEAR < perclosThreshold;
    this.closureHistory.push({
      timestamp: timestampMs,
      isClosed: isMostlyClosed
    });

    const perclosCutoff = timestampMs - this.perclosWindowMs;
    while (this.closureHistory.length > 0 && this.closureHistory[0].timestamp < perclosCutoff) {
      this.closureHistory.shift();
    }

    let closedFramesInWindow = 0;
    const windowLength = this.closureHistory.length;
    for (let i = 0; i < windowLength; i++) {
      if (this.closureHistory[i].isClosed) closedFramesInWindow++;
    }

    const perclosFraction = windowLength > 0 ? closedFramesInWindow / windowLength : 0;
    const perclosPct = Number((perclosFraction * 100).toFixed(1));

    // Current continuous eye-closure duration in ms
    const currentClosureDurationMs = this.isClosed ? Math.round(timestampMs - this.closedStartTime) : 0;
    const isDrowsyEvent = currentClosureDurationMs > 400 || perclosFraction > 0.15;

    // Status classification
    let status = 'normal';
    let message = 'Normal ocular cadence';

    if (this.isOccludedOrJittering) {
      status = 'occluded';
      message = 'Landmark jitter detected (glasses glare or partial occlusion)';
    } else if (isDrowsyEvent) {
      status = 'drowsy';
      message = 'Prolonged eye closure or elevated PERCLOS (drowsiness cue)';
    } else if (blinkRate < 10) {
      status = 'staring';
      message = 'Infrequent blinking (< 10/min): Screen stare / dry eye risk';
    } else if (blinkRate > 26) {
      status = 'strained';
      message = 'Elevated blink rate (> 26/min): Visual fatigue or squinting';
    }

    return {
      ear: this.currentEAR,
      leftEar: this.leftEAR,
      rightEar: this.rightEAR,
      blinkRate,
      totalBlinks: this.totalBlinks,
      perclos: Number(perclosFraction.toFixed(3)),
      perclosPct,
      closureDurationMs: currentClosureDurationMs,
      prolongedClosures: this.prolongedClosureCount,
      isEyeClosed: this.isClosed,
      isDrowsy: isDrowsyEvent,
      confidence: confidence,
      jitter,
      asymmetry,
      isOccludedOrJittering: this.isOccludedOrJittering,
      personalThreshold: blinkThreshold,
      personalBaseline: this.personalBaselineEAR,
      newBlinkDetected,
      status,
      message
    };
  }
}
