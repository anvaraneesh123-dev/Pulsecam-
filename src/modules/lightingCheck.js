/**
 * PulseCam - Lighting Quality & Environmental Diagnostics Module
 * Computes mean luminance, luminance variance across the facial ROI,
 * evaluates face detection confidence, and assesses optical viability.
 * Pre-flight verification runs for 3 seconds before measurement starts.
 */

export class LightingChecker {
  constructor() {
    this.history = [];
    this.maxHistory = 15;

    // 3-Second Pre-Flight Verification State
    this.preflightActive = false;
    this.preflightStartTime = 0;
    this.preflightDuration = 3000; // 3 seconds
    this.preflightSamples = [];
    this.preflightPassed = false;
    this.preflightCompleted = false;
  }

  /**
   * Initialize 3-second pre-flight lighting verification
   * @param {number} [durationMs=3000] - Duration in milliseconds (default 3000ms)
   */
  startPreflight(durationMs = 3000) {
    this.preflightActive = true;
    this.preflightStartTime = performance.now();
    this.preflightDuration = durationMs;
    this.preflightSamples = [];
    this.preflightPassed = false;
    this.preflightCompleted = false;
  }

  /**
   * Reset pre-flight state
   */
  resetPreflight() {
    this.preflightActive = false;
    this.preflightStartTime = 0;
    this.preflightSamples = [];
    this.preflightPassed = false;
    this.preflightCompleted = false;
  }

  /**
   * Step the pre-flight check with a fresh lighting result
   * @param {Object} lightingResult - Output from evaluate()
   * @param {number} [now=performance.now()] - Current timestamp
   */
  updatePreflight(lightingResult, now = performance.now()) {
    if (!this.preflightActive) {
      return {
        isActive: false,
        isComplete: this.preflightCompleted,
        passed: this.preflightPassed,
        progress: this.preflightCompleted ? 1.0 : 0.0,
        remainingSec: 0,
        latest: lightingResult
      };
    }

    const elapsed = now - this.preflightStartTime;
    const progress = Math.min(1.0, elapsed / this.preflightDuration);
    const remainingSec = Math.max(0, (this.preflightDuration - elapsed) / 1000);

    this.preflightSamples.push(lightingResult);

    if (elapsed >= this.preflightDuration) {
      this.preflightActive = false;
      this.preflightCompleted = true;

      // Evaluation: At least 70% of frames over 3 seconds must be valid,
      // and the final reading must also be valid.
      const validCount = this.preflightSamples.filter((s) => s.isValid).length;
      const validRatio = this.preflightSamples.length > 0 ? validCount / this.preflightSamples.length : 0;
      const latestValid = lightingResult ? lightingResult.isValid : false;

      this.preflightPassed = validRatio >= 0.70 && latestValid;

      return {
        isActive: false,
        isComplete: true,
        passed: this.preflightPassed,
        progress: 1.0,
        remainingSec: 0,
        validRatio,
        latest: lightingResult
      };
    }

    return {
      isActive: true,
      isComplete: false,
      passed: false,
      progress,
      remainingSec,
      latest: lightingResult
    };
  }

  /**
   * Evaluate lighting quality from a canvas 2D context, facial ROI, and face detection confidence
   * @param {CanvasRenderingContext2D} ctx - Canvas context containing the frame
   * @param {Object} [roi] - Bounding box {x, y, width, height} of the face ROI
   * @param {number} [faceConfidence=1.0] - Face detection confidence (0.0 to 1.0)
   */
  evaluate(ctx, roi = null, faceConfidence = 1.0) {
    if (!ctx) {
      return this._createResult({
        isValid: false,
        level: 'unknown',
        meanLuminance: 0,
        variance: 0,
        stdDev: 0,
        faceConfidence: 0,
        isFaceVisible: false,
        isTooDark: false,
        isOverexposed: false,
        isVarianceAdequate: false,
        message: 'No video frame available.'
      });
    }

    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;

    // Determine target region: face ROI if available, else fallback to central viewport
    const hasRoi = roi && roi.width > 12 && roi.height > 12;
    const x = hasRoi ? Math.max(0, Math.floor(roi.x)) : Math.floor(canvasWidth * 0.2);
    const y = hasRoi ? Math.max(0, Math.floor(roi.y)) : Math.floor(canvasHeight * 0.15);
    const w = hasRoi ? Math.min(canvasWidth - x, Math.floor(roi.width)) : Math.floor(canvasWidth * 0.6);
    const h = hasRoi ? Math.min(canvasHeight - y, Math.floor(roi.height)) : Math.floor(canvasHeight * 0.7);

    if (w <= 0 || h <= 0) {
      return this._createResult({
        isValid: false,
        level: 'no-face',
        meanLuminance: 0,
        variance: 0,
        stdDev: 0,
        faceConfidence: 0,
        isFaceVisible: false,
        isTooDark: false,
        isOverexposed: false,
        isVarianceAdequate: false,
        message: 'Face is not clearly visible in the camera viewport.'
      });
    }

    // Subsample step for fast real-time performance (< 0.2ms)
    const step = Math.max(2, Math.floor(Math.min(w, h) / 36));
    const imageData = ctx.getImageData(x, y, w, h);
    const data = imageData.data;

    let count = 0;
    let sumLum = 0;
    let sumLumSq = 0;
    let minLum = 255;
    let maxLum = 0;
    let clippedDark = 0;
    let clippedBright = 0;

    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const idx = (py * w + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Standard ITU-R BT.601 luminance equation
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        sumLum += lum;
        sumLumSq += lum * lum;

        if (lum < minLum) minLum = lum;
        if (lum > maxLum) maxLum = lum;
        if (lum < 15) clippedDark++;
        if (lum > 240) clippedBright++;
        count++;
      }
    }

    const meanLuminance = count > 0 ? sumLum / count : 0;
    // Population variance: E[X^2] - (E[X])^2
    const variance = count > 0 ? Math.max(0, (sumLumSq / count) - (meanLuminance * meanLuminance)) : 0;
    const stdDev = Math.sqrt(variance);
    const contrast = maxLum - minLum;

    // Temporal smoothing for stability
    this.history.push(meanLuminance);
    if (this.history.length > this.maxHistory) this.history.shift();
    const smoothedLum = this.history.reduce((a, b) => a + b, 0) / this.history.length;

    // Face visibility criteria
    const isFaceVisible = Boolean(hasRoi && faceConfidence >= 0.5);

    // Illumination thresholds
    const isTooDark = smoothedLum < 50;
    const isOverexposed = smoothedLum > 215 || (smoothedLum > 195 && (clippedBright / (count || 1)) > 0.20);
    const isVarianceAdequate = variance >= 15;

    // Complete validity test
    const isValid = isFaceVisible && !isTooDark && !isOverexposed && isVarianceAdequate;

    let level = 'optimal';
    let score = 95;
    let message = 'Optimal ambient illumination for optical pulse tracking.';

    if (!isFaceVisible) {
      level = 'no-face';
      score = 0;
      message = 'Face is not clearly visible to the camera aperture.';
    } else if (isTooDark) {
      level = 'too-dark';
      score = Math.max(10, Math.round((smoothedLum / 50) * 50));
      message = 'Face illumination is too dark (mean luminance below 50 lux).';
    } else if (isOverexposed) {
      level = 'too-bright';
      score = Math.max(15, Math.round((1 - (smoothedLum - 215) / 40) * 45));
      message = 'Face illumination is overexposed or high optical glare detected (mean luminance > 215 lux).';
    } else if (smoothedLum < 75) {
      level = 'dim';
      score = 75;
      message = 'Slightly subdued lighting; optical pulse lock is acceptable.';
    } else if (smoothedLum > 190) {
      level = 'bright';
      score = 85;
      message = 'Bright lighting detected with strong diffuse reflectance.';
    } else {
      level = 'optimal';
      score = Math.min(100, Math.round(85 + (contrast / 255) * 15));
      message = 'Balanced illumination and stable optical skin contrast.';
    }

    return this._createResult({
      isValid,
      level,
      score,
      meanLuminance: Math.round(smoothedLum * 10) / 10,
      rawMeanLuminance: Math.round(meanLuminance * 10) / 10,
      variance: Math.round(variance * 10) / 10,
      stdDev: Math.round(stdDev * 10) / 10,
      contrast: Math.round(contrast),
      faceConfidence: Math.round(faceConfidence * 100) / 100,
      isFaceVisible,
      isTooDark,
      isOverexposed,
      isVarianceAdequate,
      message
    });
  }

  _createResult(params) {
    return {
      isValid: params.isValid,
      level: params.level,
      score: params.score || 0,
      meanLuminance: params.meanLuminance || 0,
      rawMeanLuminance: params.rawMeanLuminance || 0,
      variance: params.variance || 0,
      stdDev: params.stdDev || 0,
      contrast: params.contrast || 0,
      faceConfidence: params.faceConfidence || 0,
      isFaceVisible: params.isFaceVisible || false,
      isTooDark: params.isTooDark || false,
      isOverexposed: params.isOverexposed || false,
      isVarianceAdequate: params.isVarianceAdequate !== undefined ? params.isVarianceAdequate : true,
      message: params.message,
      // Exact user-specified notification text:
      exactNotice: 'Lighting is insufficient for reliable estimation.',
      // Exact user-specified tips:
      tips: [
        'Face a window or lamp',
        'Raise screen brightness',
        'Avoid backlight'
      ]
    };
  }
}
