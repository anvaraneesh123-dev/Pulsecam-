/**
 * PulseCam - Signal Quality Module (signalQuality.js)
 *
 * Synthesizes multi-modal optical telemetry into a unified 0–100 confidence score:
 * 1. Face-detection confidence (25% weight)
 * 2. Lighting / illumination stability (20% weight)
 * 3. Frame rate (FPS) stability (15% weight)
 * 4. Fraction of stable frames in sliding window (20% weight)
 * 5. rPPG signal-to-noise ratio (SNR) (20% weight)
 *
 * Badges:
 * - High:   score >= 70
 * - Medium: 45 <= score < 70
 * - Low:    score < 45
 *
 * When Low:
 * Sets isLow = true and provides the mandatory fallback notification:
 * "Measurements may be unreliable due to camera quality or lighting."
 * The UI hides BPM and Workload score and shows this notice instead.
 *
 * LOCAL DEBUG LOGGING:
 * "Log only quality metrics locally for debugging, never images."
 * Maintains an in-memory ring buffer of purely numeric diagnostic records.
 * Strictly guarantees zero images, canvas elements, or pixels are ever saved or logged.
 */

export class SignalQualityAssessor {
  constructor(options = {}) {
    this.maxLogEntries = options.maxLogEntries || 150;
    this.smoothedScore = null;
    this.smoothingAlpha = options.smoothingAlpha || 0.15; // Exponential Moving Average factor

    // Ring buffer for local numerical quality metrics debugging (never images!)
    this.debugLog = [];
    this.lastLogTimestamp = 0;

    // Movement tracking state
    this.previousFaceCenter = null;
    this.previousPose = null;
    this.motionJitterHistory = [];
  }

  /**
   * Reset internal smoothing and motion histories
   */
  reset() {
    this.smoothedScore = null;
    this.previousFaceCenter = null;
    this.previousPose = null;
    this.motionJitterHistory = [];
  }

  /**
   * Evaluate multi-modal signal quality
   * Supports both object parameters and positional parameters:
   * evaluate({ faceDetection, lighting, rppgResult, motionData, fps, illumination })
   * evaluate(faceDetection, lighting, rppgResult, motionData, fps, illumination)
   */
  evaluate(...args) {
    let params = {};
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !args[0].landmarks && !args[0].detected) {
      params = args[0];
    } else {
      params = {
        faceDetection: args[0] || null,
        lighting: args[1] || null,
        rppgResult: args[2] || null,
        motionData: args[3] || null,
        fps: args[4] !== undefined ? args[4] : null,
        illumination: args[5] || null
      };
    }

    const {
      faceDetection = null,
      lighting = null,
      rppgResult = null,
      motionData = null,
      fps = null,
      illumination = null
    } = params;

    // =========================================================================
    // 1. COMPONENT 1: Face-Detection Confidence (25% Weight)
    // =========================================================================
    let faceScore = 0;
    let rawFaceConf = 0;

    if (faceDetection && faceDetection.detected) {
      if (faceDetection.faceConfidence !== undefined && faceDetection.faceConfidence !== null) {
        rawFaceConf = Number(faceDetection.faceConfidence);
        // MediaPipe returns confidence in range 0.0 - 1.0 (or sometimes 0 - 100)
        faceScore = rawFaceConf <= 1.0 ? rawFaceConf * 100 : rawFaceConf;
      } else {
        rawFaceConf = 0.95;
        faceScore = 95;
      }

      // Check facial framing scale in viewport (640x480 standard frame)
      if (faceDetection.faceBox) {
        const areaFraction = (faceDetection.faceBox.width * faceDetection.faceBox.height) / (640 * 480);
        if (areaFraction < 0.10) {
          faceScore *= 0.80; // Face too far
        } else if (areaFraction > 0.85) {
          faceScore *= 0.85; // Face too close / cut off
        }
      }
    } else {
      faceScore = 0;
      rawFaceConf = 0;
    }
    faceScore = Math.max(0, Math.min(100, Math.round(faceScore)));

    // =========================================================================
    // 2. COMPONENT 2: Lighting / Illumination Stability (20% Weight)
    // =========================================================================
    let lightingScore = 50;
    let meanLum = 120;
    let lumVar = 25;
    let isIlluminationStable = true;

    if (lighting) {
      meanLum = lighting.meanLuminance !== undefined
        ? lighting.meanLuminance
        : (lighting.luminance !== undefined ? lighting.luminance : (lighting.score || 120));
      lumVar = lighting.variance !== undefined ? lighting.variance : 25;

      // a. Mean luminance score: ideal 80-180 lux, acceptable 50-215 lux
      let lumScore = 100;
      if (meanLum < 50) {
        lumScore = Math.max(0, (meanLum / 50) * 55); // Under-exposed / dark
      } else if (meanLum < 80) {
        lumScore = 55 + ((meanLum - 50) / 30) * 45;
      } else if (meanLum <= 180) {
        lumScore = 100; // Optimal diffuse reflectance
      } else if (meanLum <= 215) {
        lumScore = 100 - ((meanLum - 180) / 35) * 40;
      } else {
        lumScore = Math.max(0, 60 - ((meanLum - 215) / 40) * 60); // Over-exposed / glare
      }

      // b. Luminance contrast variance: minimum 15 required
      let varScore = 100;
      if (lumVar < 15) {
        varScore = Math.max(0, (lumVar / 15) * 50);
      } else if (lumVar < 25) {
        varScore = 50 + ((lumVar - 15) / 10) * 50;
      } else {
        varScore = 100;
      }

      // c. Illumination drift stability from background ROI reference
      const illData = illumination || (rppgResult ? rppgResult.illumination : null);
      if (illData && illData.isUnstable) {
        isIlluminationStable = false;
      }

      const driftScore = isIlluminationStable ? 100 : 40;

      lightingScore = Math.round(0.55 * lumScore + 0.25 * varScore + 0.20 * driftScore);
      if (lighting.isValid === false) {
        lightingScore = Math.min(lightingScore, 30);
      }
    }
    lightingScore = Math.max(0, Math.min(100, lightingScore));

    // =========================================================================
    // 3. COMPONENT 3: Frame Rate Stability (15% Weight)
    // =========================================================================
    const effectiveFps = typeof fps === 'number' && fps > 0 ? fps : 30;
    let fpsScore = 100;

    if (effectiveFps >= 28) {
      fpsScore = 100;
    } else if (effectiveFps >= 20) {
      // 20 FPS -> 60 pts, 28 FPS -> 100 pts
      fpsScore = 60 + ((effectiveFps - 20) / 8) * 40;
    } else if (effectiveFps >= 14) {
      // Below 20 FPS threshold drops steeply: 14 FPS -> 20 pts, 20 FPS -> 60 pts
      fpsScore = 20 + ((effectiveFps - 14) / 6) * 40;
    } else {
      fpsScore = Math.max(0, effectiveFps * 1.4);
    }
    fpsScore = Math.max(0, Math.min(100, Math.round(fpsScore)));

    // =========================================================================
    // 4. COMPONENT 4: Fraction of Stable Frames in Window (20% Weight)
    // =========================================================================
    let stableFraction = 1.0;
    let stableScore = 100;

    const winStability = motionData?.windowStability || null;
    if (winStability && typeof winStability.totalFrames === 'number' && winStability.totalFrames > 0) {
      const discarded = winStability.discardedFrames || 0;
      const total = winStability.totalFrames;
      stableFraction = Math.max(0, Math.min(1.0, 1.0 - (discarded / total)));

      if (stableFraction >= 0.90) {
        stableScore = 100;
      } else if (stableFraction >= 0.60) {
        // Between 10% and 40% discarded: 60% stable -> 50 pts, 90% stable -> 100 pts
        stableScore = 50 + ((stableFraction - 0.60) / 0.30) * 50;
      } else {
        // > 40% discarded frames is low-confidence: drops sharply below 50
        stableScore = Math.max(0, (stableFraction / 0.60) * 45);
      }
    } else if (motionData) {
      stableFraction = motionData.isNoisy ? 0.35 : 1.0;
      stableScore = motionData.isNoisy ? 35 : 95;
    }
    stableScore = Math.max(0, Math.min(100, Math.round(stableScore)));

    // =========================================================================
    // 5. COMPONENT 5: rPPG Signal-to-Noise Ratio (SNR) (20% Weight)
    // =========================================================================
    let snrScore = 30;
    let snrDb = 0;

    if (rppgResult) {
      snrDb = rppgResult.snrDb !== undefined ? rppgResult.snrDb : 0;
      const rppgConf = rppgResult.confidence !== undefined ? rppgResult.confidence : 0;

      // Map SNR in dB (typically -2.0 dB to +8.0 dB in contactless photoplethysmography)
      let snrDbScore = 0;
      if (snrDb >= 6.0) {
        snrDbScore = 100;
      } else if (snrDb >= 2.0) {
        // 2.0 dB -> 50 pts, 6.0 dB -> 100 pts
        snrDbScore = 50 + ((snrDb - 2.0) / 4.0) * 50;
      } else if (snrDb >= 0.0) {
        // 0.0 dB -> 20 pts, 2.0 dB -> 50 pts
        snrDbScore = 20 + (snrDb / 2.0) * 30;
      } else {
        snrDbScore = Math.max(0, 20 + snrDb * 5);
      }

      // Blend FFT SNR with spectral peak confidence
      snrScore = Math.round(0.60 * snrDbScore + 0.40 * rppgConf);
    } else if (faceDetection && faceDetection.detected) {
      snrScore = 35; // Searching for pulse waveform
    } else {
      snrScore = 0;
    }
    snrScore = Math.max(0, Math.min(100, snrScore));

    // =========================================================================
    // 6. Multi-Modal Synthesis & Smoothing
    // =========================================================================
    // Weights:
    // 25% Face-detection confidence
    // 20% Lighting / illumination stability
    // 15% Frame rate
    // 20% Fraction of stable frames
    // 20% rPPG SNR
    let rawScore = (
      0.25 * faceScore +
      0.20 * lightingScore +
      0.15 * fpsScore +
      0.20 * stableScore +
      0.20 * snrScore
    );

    // Hard failure clamps
    if (!faceDetection || !faceDetection.detected) {
      rawScore = 0;
    } else if (lighting && lighting.isValid === false) {
      rawScore = Math.min(rawScore, 35);
    } else if (winStability && winStability.isLowConfidence) {
      rawScore = Math.min(rawScore, 38);
    }

    rawScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    // Exponential Moving Average (EMA) smoothing with asymmetric decay:
    // Drops fast (alpha = 0.35) when noise/glare/motion strikes, rises smoothly (alpha = 0.15) on recovery
    const alpha = (this.smoothedScore !== null && rawScore < this.smoothedScore) ? 0.35 : this.smoothingAlpha;
    if (this.smoothedScore === null) {
      this.smoothedScore = rawScore;
    } else {
      this.smoothedScore = (
        alpha * rawScore +
        (1 - alpha) * this.smoothedScore
      );
    }

    // Direct failure clamps on smoothed score to prevent delayed warnings on critical faults
    if (!faceDetection || !faceDetection.detected) {
      this.smoothedScore = 0;
    } else if (lighting && lighting.isValid === false) {
      this.smoothedScore = Math.min(this.smoothedScore, 35);
    } else if (winStability && winStability.isLowConfidence) {
      this.smoothedScore = Math.min(this.smoothedScore, 38);
    }

    const finalScore = Math.round(this.smoothedScore);

    // =========================================================================
    // 7. Badge & Reliability Determination
    // =========================================================================
    // High:   score >= 70
    // Medium: 45 <= score < 70
    // Low:    score < 45
    let badge = 'High';
    let level = 'high';

    if (finalScore >= 70) {
      badge = 'High';
      level = 'high';
    } else if (finalScore >= 45) {
      badge = 'Medium';
      level = 'medium';
    } else {
      badge = 'Low';
      level = 'low';
    }

    const isLow = badge === 'Low';
    const unreliableMessage = 'Measurements may be unreliable due to camera quality or lighting.';

    let message = 'Signal is pristine. High-precision optical lock active.';
    if (isLow) {
      if (!faceDetection || !faceDetection.detected) {
        message = 'Face not detected in camera viewport.';
      } else if (lighting && lighting.isValid === false) {
        message = 'Lighting is insufficient for reliable estimation.';
      } else if (effectiveFps < 20) {
        message = 'Frame rate below 20 FPS. Optical waveforms degraded.';
      } else if (stableFraction < 0.60) {
        message = 'High motion jitter: >40% of frames discarded.';
      } else {
        message = unreliableMessage;
      }
    } else if (badge === 'Medium') {
      message = 'Moderate signal stability. Maintain still posture.';
    }

    const components = {
      faceConfidence: {
        score: faceScore,
        raw: Number(rawFaceConf.toFixed(2)),
        weight: 0.25,
        label: 'Face-Detection Confidence'
      },
      lightingStability: {
        score: lightingScore,
        meanLuminance: Math.round(meanLum),
        variance: Math.round(lumVar),
        isStable: isIlluminationStable,
        weight: 0.20,
        label: 'Lighting & Illumination Stability'
      },
      frameRate: {
        score: fpsScore,
        fps: Number(effectiveFps.toFixed(1)),
        weight: 0.15,
        label: 'Camera Frame Rate'
      },
      stableFrameFraction: {
        score: stableScore,
        fraction: Number(stableFraction.toFixed(3)),
        discardPercentage: winStability ? winStability.discardPercentage : (motionData?.isNoisy ? 65 : 0),
        weight: 0.20,
        label: 'Fraction of Stable Frames'
      },
      rppgSnr: {
        score: snrScore,
        snrDb: Number(snrDb.toFixed(1)),
        weight: 0.20,
        label: 'rPPG Signal-to-Noise Ratio (SNR)'
      }
    };

    // =========================================================================
    // 8. PRIVACY-COMPLIANT LOCAL DEBUG LOGGING (Metrics only, never images!)
    // =========================================================================
    const now = Date.now();
    // Throttle logging to ~2 samples per second for minimal overhead
    if (now - this.lastLogTimestamp >= 500) {
      this.lastLogTimestamp = now;
      this._logQualityMetrics({
        timestamp: now,
        score: finalScore,
        badge,
        faceScore,
        lightingScore,
        fps: Number(effectiveFps.toFixed(1)),
        stableFraction: Number(stableFraction.toFixed(3)),
        snrDb: Number(snrDb.toFixed(1)),
        isLow
      });
    }

    return {
      score: finalScore,
      sqi: finalScore, // Backward compatibility with existing callers
      badge,
      level,
      grade: badge,
      isLow,
      hideMetrics: isLow,
      unreliableMessage,
      message,
      motionStability: stableScore,
      lightingScore,
      rppgConfidence: snrScore,
      components
    };
  }

  /**
   * Internal logging function: enforces that ONLY numerical parameters are saved.
   * Strictly forbids image frames, pixels, or ImageData objects.
   * @param {Object} metricEntry
   */
  _logQualityMetrics(metricEntry) {
    // Structural Privacy Assertion: Validate that no image or buffer data exists
    const sanitized = {
      timestamp: metricEntry.timestamp,
      score: metricEntry.score,
      badge: metricEntry.badge,
      faceScore: metricEntry.faceScore,
      lightingScore: metricEntry.lightingScore,
      fps: metricEntry.fps,
      stableFraction: metricEntry.stableFraction,
      snrDb: metricEntry.snrDb,
      isLow: metricEntry.isLow
    };

    this.debugLog.push(Object.freeze(sanitized));
    if (this.debugLog.length > this.maxLogEntries) {
      this.debugLog.shift();
    }
  }

  /**
   * Retrieve in-memory numerical quality debug log
   * @returns {Array<Object>}
   */
  getDebugLog() {
    return [...this.debugLog];
  }

  /**
   * Clear local debug log
   */
  clearDebugLog() {
    this.debugLog = [];
  }

  /**
   * Export brief numerical summary for dev diagnostics
   */
  getDebugSummary() {
    if (this.debugLog.length === 0) return null;
    const scores = this.debugLog.map((e) => e.score);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const lowCount = this.debugLog.filter((e) => e.isLow).length;

    return {
      totalSamples: this.debugLog.length,
      averageScore: avgScore,
      minScore,
      maxScore,
      lowConfidenceSamples: lowCount,
      lowConfidenceRate: Number((lowCount / this.debugLog.length).toFixed(3)),
      latest: this.debugLog[this.debugLog.length - 1]
    };
  }
}

export const signalQuality = new SignalQualityAssessor();
export default SignalQualityAssessor;
