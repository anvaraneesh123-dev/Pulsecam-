/**
 * PulseCam - Remote Photoplethysmography (rPPG) Pulse Engine
 *
 * Implements:
 * 1. Multi-ROI extraction (Forehead, Left Cheek, Right Cheek) with YCbCr skin mask
 *    and dark/saturation pixel filtering.
 * 2. Background-reference illumination compensation.
 * 3. Continuous signal buffer using true frame timestamps, 30 Hz interpolation,
 *    and short gap (<0.3s) recovery without dropping frames.
 * 4. Dual extraction: Plane-Orthogonal-to-Skin (POS) and Chrominance (CHROM) algorithms
 *    with temporal normalization over ~1.6s sub-windows and overlap-add.
 * 5. Detrending and zero-phase band-pass filtering (0.7 - 3.0 Hz, 42 - 180 BPM).
 * 6. Welch's Method for Power Spectral Density (PSD) with Hann windows and zero-padding.
 * 7. SNR-weighted spectral fusion across ROIs and algorithms.
 * 8. Fundamental and 2nd-harmonic integration for precise SNR calculation.
 * 9. Harmonic validation to prevent double/half-rate artifact tracking.
 * 10. Jump-constrained tracking (max 15 BPM delta unless high SNR) with median smoothing.
 * 11. Complete real-time diagnostic docket for the developer panel.
 */

import {
  fft,
  ifft,
  resampleSignal,
  median,
  findPeaks,
  calculateRMSSD
} from '../utils/mathUtils.js';

export class RPPGEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.windowDurationMs=15000] - 15-second sliding window
   * @param {number} [options.minWindowDurationMs=12000] - 12-second initial estimate threshold
   * @param {number} [options.targetFs=30] - Resampling frequency in Hz
   * @param {number} [options.fLow=0.7] - 0.7 Hz (42 BPM)
   * @param {number} [options.fHigh=3.0] - 3.0 Hz (180 BPM)
   * @param {number} [options.minSnrDb=1.5] - Minimum SNR (dB) for valid reading (Fair)
   * @param {number} [options.goodSnrDb=4.5] - Minimum SNR (dB) for high confidence (Good)
   */
  constructor(options = {}) {
    if (typeof options === 'number') {
      options = { targetFs: options };
    }

    this.windowDurationMs = options.windowDurationMs || 15000;
    this.minWindowDurationMs = options.minWindowDurationMs || 12000;
    this.targetFs = options.targetFs || 30;
    this.fLow = options.fLow || 0.7; // 42 BPM
    this.fHigh = options.fHigh || 3.0; // 180 BPM
    this.minSnrDb = options.minSnrDb !== undefined ? options.minSnrDb : 1.5;
    this.goodSnrDb = options.goodSnrDb !== undefined ? options.goodSnrDb : 4.5;
    this.medianWindowSize = options.medianWindowSize || 5;

    // Continuous buffer of frame samples
    // Sample: { timestamp, forehead: {r,g,b,lum}, leftCheek: {r,g,b,lum}, rightCheek: {r,g,b,lum}, bgLum, faceLum, motionWeight, isMoving }
    this.windowSamples = [];

    // Frame timing & jitter tracking
    this.lastFrameTime = null;
    this.frameIntervals = [];
    this.fps = 30;
    this.timestampJitterMs = 0;

    // Tracking history
    this.recentEstimates = []; // [{ bpm, snrDb, timestamp }]
    this.lastValidBpm = null;
    this.smoothedBPM = null;
    this.currentBPM = null;
    this.confidence = 0;
    this.snrDb = 0;
    this.hrvRmssd = null;
    this.ibiHistory = [];
    this.currentWaveformValue = 0;

    // Check-in accumulator (all valid estimates collected during check-in mode)
    this.checkinEstimates = [];

    // Diagnostics telemetry state
    this.diagnostics = {
      fps: 30,
      timestampJitterMs: 0,
      framesReceivedPerSec: 0,
      framesExcludedFraction: 0,
      exclusionReason: 'None',
      roiStats: {
        forehead: { pixelCount: 0, satPct: 0, meanLum: 0 },
        leftCheek: { pixelCount: 0, satPct: 0, meanLum: 0 },
        rightCheek: { pixelCount: 0, satPct: 0, meanLum: 0 }
      },
      meanFaceBrightness: 0,
      rawWaveform: [],
      filteredWaveform: [],
      spectrum: [],
      peakFreq: 0,
      peakBpm: null,
      snrDb: 0,
      reasonNoReading: 'STARTING'
    };
  }

  /**
   * Reset all temporal buffers and estimate histories
   */
  reset() {
    this.windowSamples = [];
    this.recentEstimates = [];
    this.checkinEstimates = [];
    this.lastValidBpm = null;
    this.smoothedBPM = null;
    this.currentBPM = null;
    this.confidence = 0;
    this.snrDb = 0;
    this.hrvRmssd = null;
    this.ibiHistory = [];
    this.currentWaveformValue = 0;
    this.lastFrameTime = null;
    this.frameIntervals = [];
    this.diagnostics.reasonNoReading = 'STARTING';
    this.diagnostics.spectrum = [];
    this.diagnostics.rawWaveform = [];
    this.diagnostics.filteredWaveform = [];
  }

  /**
   * Sample background reference ROI outside face for illumination baseline
   */
  extractBgLuminance(ctx, bgRoi) {
    if (!ctx || !bgRoi) return null;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const rx = Math.max(0, Math.floor(bgRoi.x));
    const ry = Math.max(0, Math.floor(bgRoi.y));
    const rw = Math.min(w - rx, Math.floor(bgRoi.width));
    const rh = Math.min(h - ry, Math.floor(bgRoi.height));

    if (rw <= 4 || rh <= 4) return null;

    let imgData;
    try {
      imgData = ctx.getImageData(rx, ry, rw, rh);
    } catch (_) {
      return null;
    }

    const data = imgData.data;
    const step = Math.max(1, Math.floor(Math.min(rw, rh) / 16));
    let sumLum = 0, count = 0;

    for (let y = 0; y < rh; y += step) {
      for (let x = 0; x < rw; x += step) {
        const idx = (y * rw + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        sumLum += lum;
        count++;
      }
    }
    return count > 0 ? sumLum / count : null;
  }

  /**
   * Extract skin pixels within a single ROI bounding box.
   * Applies YCbCr skin mask and excludes dark (<20) and saturated (>245) pixels.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} roiBox - { x, y, width, height }
   * @returns {{ avgR: number, avgG: number, avgB: number, pixelCount: number, satPct: number, meanLum: number }|null}
   */
  _sampleRoiSkin(ctx, roiBox) {
    if (!ctx || !roiBox) return null;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    const rx = Math.max(0, Math.floor(roiBox.x));
    const ry = Math.max(0, Math.floor(roiBox.y));
    const rw = Math.min(cw - rx, Math.floor(roiBox.width));
    const rh = Math.min(ch - ry, Math.floor(roiBox.height));

    if (rw <= 6 || rh <= 6) return null;

    let imgData;
    try {
      imgData = ctx.getImageData(rx, ry, rw, rh);
    } catch (_) {
      return null;
    }

    const data = imgData.data;
    // Fast step for real-time performance while sampling thousands of skin pixels
    const step = Math.max(1, Math.floor(Math.min(rw, rh) / 36));

    let sumR = 0, sumG = 0, sumB = 0;
    let sumLum = 0;
    let skinPixelCount = 0;
    let totalSampled = 0;
    let saturatedCount = 0;

    for (let y = 0; y < rh; y += step) {
      for (let x = 0; x < rw; x += step) {
        const idx = (y * rw + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        totalSampled++;

        // ITU-R BT.601 YCbCr calculation
        const Y = 0.299 * r + 0.587 * g + 0.114 * b;
        const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

        // Check pixel saturation and dark cutoff
        if (Y > 245 || r > 248 || g > 248 || b > 248) {
          saturatedCount++;
          continue;
        }
        if (Y < 20) {
          continue;
        }

        // Standard physiological YCbCr skin mask
        // Cb in [77, 127], Cr in [133, 173] with chromatic sanity
        const isSkin = (Cb >= 77 && Cb <= 130) && (Cr >= 130 && Cr <= 175) && (r > b) && (r > 30);

        if (isSkin) {
          sumR += r;
          sumG += g;
          sumB += b;
          sumLum += Y;
          skinPixelCount++;
        }
      }
    }

    const satPct = totalSampled > 0 ? (saturatedCount / totalSampled) * 100 : 0;
    if (skinPixelCount < 12) {
      return {
        avgR: 0,
        avgG: 0,
        avgB: 0,
        pixelCount: skinPixelCount,
        satPct: Math.round(satPct * 10) / 10,
        meanLum: 0
      };
    }

    return {
      avgR: sumR / skinPixelCount,
      avgG: sumG / skinPixelCount,
      avgB: sumB / skinPixelCount,
      pixelCount: skinPixelCount,
      satPct: Math.round(satPct * 10) / 10,
      meanLum: sumLum / skinPixelCount
    };
  }

  /**
   * Extract multi-ROI skin averages for Forehead, Left Cheek, Right Cheek
   */
  extractRoisData(ctx, rois) {
    if (!ctx || !rois) return null;

    let foreheadBox = rois.forehead || null;
    let leftCheekBox = rois.leftCheek || null;
    let rightCheekBox = rois.rightCheek || null;

    // Handle single bounding box fallback
    if (!foreheadBox && !leftCheekBox && !rightCheekBox) {
      if (rois.width > 20 && rois.height > 20) {
        foreheadBox = {
          x: rois.x + rois.width * 0.2,
          y: rois.y + rois.height * 0.1,
          width: rois.width * 0.6,
          height: rois.height * 0.25
        };
        leftCheekBox = {
          x: rois.x + rois.width * 0.55,
          y: rois.y + rois.height * 0.45,
          width: rois.width * 0.35,
          height: rois.height * 0.35
        };
        rightCheekBox = {
          x: rois.x + rois.width * 0.1,
          y: rois.y + rois.height * 0.45,
          width: rois.width * 0.35,
          height: rois.height * 0.35
        };
      }
    }

    const fh = this._sampleRoiSkin(ctx, foreheadBox);
    const lc = this._sampleRoiSkin(ctx, leftCheekBox);
    const rc = this._sampleRoiSkin(ctx, rightCheekBox);

    return {
      forehead: fh,
      leftCheek: lc,
      rightCheek: rc
    };
  }

  /**
   * Process incoming frame into sliding 15-second window.
   * Continuous acquisition: does NOT drop whole frames on movement; marks moving frames as low-weight.
   * Runs POS + CHROM on each ROI, zero-phase bandpass, Welch PSD, SNR fusion, and tracking.
   *
   * @param {CanvasRenderingContext2D} ctx - Canvas context
   * @param {Object} rois - { forehead, leftCheek, rightCheek }
   * @param {number} timestampMs - Real hardware/system timestamp
   * @param {Object} [bgRoi=null] - Background reference ROI
   * @param {Object} [motionData=null] - Motion tracker output
   */
  processFrame(ctx, rois, timestampMs = performance.now(), bgRoi = null, motionData = null) {
    // 1. Frame Timing & Jitter Tracking
    if (this.lastFrameTime !== null) {
      const delta = timestampMs - this.lastFrameTime;
      if (delta > 0 && delta < 500) {
        this.frameIntervals.push(delta);
        if (this.frameIntervals.length > 60) this.frameIntervals.shift();

        const meanDelta = this.frameIntervals.reduce((a, b) => a + b, 0) / this.frameIntervals.length;
        this.fps = meanDelta > 0 ? Math.round(1000 / meanDelta) : 30;

        let varDelta = 0;
        for (const dt of this.frameIntervals) {
          varDelta += (dt - meanDelta) * (dt - meanDelta);
        }
        this.timestampJitterMs = Math.round(Math.sqrt(varDelta / this.frameIntervals.length) * 10) / 10;
      }
    }
    this.lastFrameTime = timestampMs;

    // 2. Extract multi-ROI skin pixels
    const roiData = this.extractRoisData(ctx, rois);
    const bgLum = this.extractBgLuminance(ctx, bgRoi);

    if (!roiData) {
      this.diagnostics.reasonNoReading = 'FACE_PARTLY_HIDDEN';
      return this._buildOutput();
    }

    // Update diagnostics ROI stats
    if (roiData.forehead) this.diagnostics.roiStats.forehead = roiData.forehead;
    if (roiData.leftCheek) this.diagnostics.roiStats.leftCheek = roiData.leftCheek;
    if (roiData.rightCheek) this.diagnostics.roiStats.rightCheek = roiData.rightCheek;

    const fh = roiData.forehead;
    const lc = roiData.leftCheek;
    const rc = roiData.rightCheek;

    const totalValidPixels = (fh?.pixelCount || 0) + (lc?.pixelCount || 0) + (rc?.pixelCount || 0);
    const maxSatPct = Math.max(fh?.satPct || 0, lc?.satPct || 0, rc?.satPct || 0);

    const faceLum = totalValidPixels > 0
      ? ((fh?.pixelCount || 0) * (fh?.meanLum || 0) +
         (lc?.pixelCount || 0) * (lc?.meanLum || 0) +
         (rc?.pixelCount || 0) * (rc?.meanLum || 0)) / totalValidPixels
      : 0;

    this.diagnostics.meanFaceBrightness = Math.round(faceLum * 10) / 10;
    this.diagnostics.fps = this.fps;
    this.diagnostics.timestampJitterMs = this.timestampJitterMs;
    this.diagnostics.framesReceivedPerSec = this.fps;

    // Motion evaluation: compute weighting factor (0.1 to 1.0)
    const isMoving = Boolean(motionData && (motionData.isNoisy || motionData.normalizedMovement > 0.035));
    const motionWeight = isMoving ? 0.20 : 1.0;

    // 3. Append frame to continuous temporal buffer
    // Only discard if face is completely missing or completely dark/saturated
    if (totalValidPixels >= 25) {
      this.windowSamples.push({
        timestamp: timestampMs,
        forehead: fh && fh.pixelCount > 10 ? fh : null,
        leftCheek: lc && lc.pixelCount > 10 ? lc : null,
        rightCheek: rc && rc.pixelCount > 10 ? rc : null,
        bgLum: bgLum !== null ? bgLum : faceLum,
        faceLum,
        satPct: maxSatPct,
        motionWeight,
        isMoving
      });
    }

    // Prune entries older than sliding window length (15 seconds)
    const cutoff = timestampMs - this.windowDurationMs;
    while (this.windowSamples.length > 0 && this.windowSamples[0].timestamp < cutoff) {
      this.windowSamples.shift();
    }

    const nSamples = this.windowSamples.length;
    const durationMs = nSamples > 1
      ? this.windowSamples[nSamples - 1].timestamp - this.windowSamples[0].timestamp
      : 0;

    // Compute fraction of corrupted / moving frames in the window
    const movingCount = this.windowSamples.filter((s) => s.isMoving).length;
    const corruptedFraction = nSamples > 0 ? movingCount / nSamples : 0;
    this.diagnostics.framesExcludedFraction = Math.round(corruptedFraction * 100) / 100;

    // Check pre-conditions before running pulse extraction
    if (durationMs < this.minWindowDurationMs) {
      const remainingSec = Math.max(1, Math.ceil((this.minWindowDurationMs - durationMs) / 1000));
      this.diagnostics.reasonNoReading = 'STARTING';
      this.diagnostics.startingSec = remainingSec;
      return this._buildOutput();
    }

    if (this.fps < 16) {
      this.diagnostics.reasonNoReading = 'LOW_FPS';
      this.diagnostics.exclusionReason = 'Camera FPS below 16 Hz';
      return this._buildOutput();
    }

    if (faceLum < 24) {
      this.diagnostics.reasonNoReading = 'TOO_DARK';
      this.diagnostics.exclusionReason = 'Face luminance below 24 lux';
      return this._buildOutput();
    }

    if (maxSatPct > 15) {
      this.diagnostics.reasonNoReading = 'SATURATED_PIXELS';
      this.diagnostics.exclusionReason = 'Pixel saturation exceeds 15%';
      return this._buildOutput();
    }

    // Rule: reject window if more than 25% of it is corrupted by motion
    if (corruptedFraction > 0.28) {
      this.diagnostics.reasonNoReading = 'HIGH_MOTION';
      this.diagnostics.exclusionReason = `Movement corruption ${Math.round(corruptedFraction * 100)}% > 25%`;
      return this._buildOutput();
    }

    // 4. Uniform 30 Hz Resampling & Short Gap (<0.3s) Interpolation
    const timestamps = this.windowSamples.map((s) => s.timestamp);
    const weights = this.windowSamples.map((s) => s.motionWeight);

    // Compute pulse extraction across 3 ROIs: Forehead, Left Cheek, Right Cheek
    const roiKeys = ['forehead', 'leftCheek', 'rightCheek'];
    const streamSpectra = [];

    for (const key of roiKeys) {
      const validSamples = [];
      const validTs = [];
      const validW = [];

      for (let i = 0; i < nSamples; i++) {
        const s = this.windowSamples[i];
        if (s[key] && s[key].pixelCount > 10) {
          validSamples.push(s[key]);
          validTs.push(s.timestamp);
          validW.push(s.motionWeight);
        }
      }

      if (validSamples.length < 90) continue;

      // Resample R, G, B channels to uniform 30 Hz grid
      const rArr = validSamples.map((s) => s.avgR);
      const gArr = validSamples.map((s) => s.avgG);
      const bArr = validSamples.map((s) => s.avgB);

      const resR = resampleSignal(validTs, rArr, this.targetFs).resampled;
      const resG = resampleSignal(validTs, gArr, this.targetFs).resampled;
      const resB = resampleSignal(validTs, bArr, this.targetFs).resampled;
      const resW = resampleSignal(validTs, validW, this.targetFs).resampled;

      const uniformLen = Math.min(resR.length, resG.length, resB.length);
      if (uniformLen < 120) continue;

      // Apply sub-window overlap-add temporal normalization (L = 48 samples ~ 1.6s)
      const posSignal = this._computePosOverlapAdd(resR, resG, resB, resW, uniformLen);
      const chromSignal = this._computeChromOverlapAdd(resR, resG, resB, resW, uniformLen);

      // Detrend and filter
      const detrendPos = this._detrend(posSignal, Math.round(0.75 * this.targetFs));
      const detrendChrom = this._detrend(chromSignal, Math.round(0.75 * this.targetFs));

      // Welch Power Spectral Density for POS and CHROM
      const psdPos = this._computeWelchPSD(detrendPos, this.targetFs);
      const psdChrom = this._computeWelchPSD(detrendChrom, this.targetFs);

      if (psdPos) streamSpectra.push({ name: `${key}-POS`, psd: psdPos, signal: detrendPos });
      if (psdChrom) streamSpectra.push({ name: `${key}-CHROM`, psd: psdChrom, signal: detrendChrom });
    }

    if (streamSpectra.length === 0) {
      this.diagnostics.reasonNoReading = 'LOW_SNR';
      return this._buildOutput();
    }

    // 5. SNR-Weighted Spectral Fusion across all available ROI/algorithm streams
    const fusedResult = this._fuseSpectra(streamSpectra);

    if (!fusedResult || fusedResult.snrDb < this.minSnrDb) {
      this.diagnostics.reasonNoReading = 'LOW_SNR';
      this.diagnostics.exclusionReason = `SNR ${fusedResult ? fusedResult.snrDb : 0} dB < ${this.minSnrDb} dB`;
      this.currentBPM = fusedResult ? fusedResult.peakBpm : null;
      this.snrDb = fusedResult ? fusedResult.snrDb : 0;
      this.confidence = Math.max(0, Math.min(45, Math.round((this.snrDb / this.goodSnrDb) * 60)));
      return this._buildOutput();
    }

    // 6. Jump-Constrained Tracking & Smoothing
    let candidateBpm = fusedResult.peakBpm;

    // Check sudden jump (> 15 BPM) against recent estimates
    if (this.lastValidBpm !== null && Math.abs(candidateBpm - this.lastValidBpm) > 15) {
      if (fusedResult.snrDb < 6.0) {
        // Suppress sudden spike: clamp candidate closer to running trajectory
        const sign = candidateBpm > this.lastValidBpm ? 1 : -1;
        candidateBpm = this.lastValidBpm + sign * 6;
      }
    }

    // Push into recent median history
    this.recentEstimates.push({ bpm: candidateBpm, snrDb: fusedResult.snrDb, timestamp: timestampMs });
    if (this.recentEstimates.length > this.medianWindowSize) {
      this.recentEstimates.shift();
    }

    const medBpm = median(this.recentEstimates.map((e) => e.bpm));
    // Light exponential smoothing on top of median
    const finalBpm = this.lastValidBpm !== null
      ? Math.round(0.35 * medBpm + 0.65 * this.lastValidBpm)
      : Math.round(medBpm);

    this.lastValidBpm = finalBpm;
    this.currentBPM = finalBpm;
    this.smoothedBPM = finalBpm;
    this.snrDb = fusedResult.snrDb;

    // Confidence calibration: 1.5 dB -> 65% (Fair), 4.5 dB+ -> 90%+ (Good)
    const normalizedConf = Math.min(
      98,
      Math.max(50, Math.round(55 + ((fusedResult.snrDb - this.minSnrDb) / (this.goodSnrDb - this.minSnrDb)) * 35))
    );
    this.confidence = normalizedConf;

    // Accumulate into checkin collection
    this.checkinEstimates.push({ bpm: finalBpm, snrDb: fusedResult.snrDb, timestamp: timestampMs });

    // Update waveforms & spectrum for diagnostics panel
    this.currentWaveformValue = fusedResult.latestWaveform;
    this.diagnostics.rawWaveform = fusedResult.rawWaveform;
    this.diagnostics.filteredWaveform = fusedResult.filteredWaveform;
    this.diagnostics.spectrum = fusedResult.spectrum;
    this.diagnostics.peakFreq = fusedResult.peakFreq;
    this.diagnostics.peakBpm = finalBpm;
    this.diagnostics.snrDb = fusedResult.snrDb;
    this.diagnostics.reasonNoReading = 'OK';
    this.diagnostics.exclusionReason = 'Reading stable and passed SNR threshold';

    return this._buildOutput();
  }

  /**
   * POS Algorithm with Temporal Normalization over ~1.6s sub-window (L = 48) and Overlap-Add
   */
  _computePosOverlapAdd(resR, resG, resB, resW, N) {
    const L = Math.min(N, Math.max(32, Math.round(1.6 * this.targetFs))); // 48 samples
    const H = new Float64Array(N);
    const weightSum = new Float64Array(N);

    const step = 1; // Stride 1 sample for seamless reconstruction
    for (let m = 0; m <= N - L; m += step) {
      let sumR = 0, sumG = 0, sumB = 0;
      for (let i = 0; i < L; i++) {
        sumR += resR[m + i];
        sumG += resG[m + i];
        sumB += resB[m + i];
      }
      const meanR = sumR / L || 1;
      const meanG = sumG / L || 1;
      const meanB = sumB / L || 1;

      const S1 = new Float64Array(L);
      const S2 = new Float64Array(L);
      let sumS1 = 0, sumS2 = 0;

      for (let i = 0; i < L; i++) {
        const rn = resR[m + i] / meanR;
        const gn = resG[m + i] / meanG;
        const bn = resB[m + i] / meanB;

        const s1 = gn - bn;
        const s2 = gn + bn - 2.0 * rn;
        S1[i] = s1;
        S2[i] = s2;
        sumS1 += s1;
        sumS2 += s2;
      }

      const meanS1 = sumS1 / L;
      const meanS2 = sumS2 / L;
      let varS1 = 0, varS2 = 0;
      for (let i = 0; i < L; i++) {
        varS1 += (S1[i] - meanS1) * (S1[i] - meanS1);
        varS2 += (S2[i] - meanS2) * (S2[i] - meanS2);
      }
      const stdS1 = Math.sqrt(varS1 / L);
      const stdS2 = Math.sqrt(varS2 / L);
      const alpha = stdS2 > 1e-7 ? stdS1 / stdS2 : 1.0;

      // Overlap-add into composite signal with Hann window
      for (let i = 0; i < L; i++) {
        const win = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (L - 1)));
        const sMotion = resW ? (resW[m + i] || 1.0) : 1.0;
        const subPulse = (S1[i] - meanS1) + alpha * (S2[i] - meanS2);
        H[m + i] += subPulse * win * sMotion;
        weightSum[m + i] += win * sMotion;
      }
    }

    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      out[i] = weightSum[i] > 1e-4 ? H[i] / weightSum[i] : H[i];
    }
    return Array.from(out);
  }

  /**
   * CHROM Algorithm (Haan & Jeanne, 2013) with Temporal Normalization and Overlap-Add
   */
  _computeChromOverlapAdd(resR, resG, resB, resW, N) {
    const L = Math.min(N, Math.max(32, Math.round(1.6 * this.targetFs)));
    const H = new Float64Array(N);
    const weightSum = new Float64Array(N);

    const step = 1;
    for (let m = 0; m <= N - L; m += step) {
      let sumR = 0, sumG = 0, sumB = 0;
      for (let i = 0; i < L; i++) {
        sumR += resR[m + i];
        sumG += resG[m + i];
        sumB += resB[m + i];
      }
      const meanR = sumR / L || 1;
      const meanG = sumG / L || 1;
      const meanB = sumB / L || 1;

      const Xs = new Float64Array(L);
      const Ys = new Float64Array(L);
      let sumX = 0, sumY = 0;

      for (let i = 0; i < L; i++) {
        const rn = resR[m + i] / meanR;
        const gn = resG[m + i] / meanG;
        const bn = resB[m + i] / meanB;

        // CHROM projection:
        // Xs = 3*Rn - 2*Gn
        // Ys = 1.5*Rn + Gn - 1.5*Bn
        const xVal = 3.0 * rn - 2.0 * gn;
        const yVal = 1.5 * rn + gn - 1.5 * bn;
        Xs[i] = xVal;
        Ys[i] = yVal;
        sumX += xVal;
        sumY += yVal;
      }

      const meanX = sumX / L;
      const meanY = sumY / L;
      let varX = 0, varY = 0;
      for (let i = 0; i < L; i++) {
        varX += (Xs[i] - meanX) * (Xs[i] - meanX);
        varY += (Ys[i] - meanY) * (Ys[i] - meanY);
      }
      const stdX = Math.sqrt(varX / L);
      const stdY = Math.sqrt(varY / L);
      const alpha = stdY > 1e-7 ? stdX / stdY : 1.0;

      for (let i = 0; i < L; i++) {
        const win = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (L - 1)));
        const sMotion = resW ? (resW[m + i] || 1.0) : 1.0;
        const chromVal = (Xs[i] - meanX) - alpha * (Ys[i] - meanY);
        H[m + i] += chromVal * win * sMotion;
        weightSum[m + i] += win * sMotion;
      }
    }

    const out = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      out[i] = weightSum[i] > 1e-4 ? H[i] / weightSum[i] : H[i];
    }
    return Array.from(out);
  }

  /**
   * Moving-average detrending
   */
  _detrend(signal, windowSize = 23) {
    const N = signal.length;
    const half = Math.max(2, Math.floor(windowSize / 2));
    const detrended = new Float64Array(N);

    let sum = 0;
    for (let i = 0; i < N; i++) {
      const start = Math.max(0, i - half);
      const end = Math.min(N - 1, i + half);
      let localSum = 0;
      for (let j = start; j <= end; j++) {
        localSum += signal[j];
      }
      detrended[i] = signal[i] - localSum / (end - start + 1);
      sum += detrended[i];
    }

    const mean = sum / N;
    for (let i = 0; i < N; i++) {
      detrended[i] -= mean;
    }
    return Array.from(detrended);
  }

  /**
   * Welch's Method Power Spectral Density estimation
   * Divides signal into 50% overlapping segments, applies Hann window, zero-pads to 1024/2048, and averages spectra.
   */
  _computeWelchPSD(signal, fs) {
    const N = signal.length;
    if (N < 64) return null;

    const segLen = Math.min(N, Math.max(128, Math.round(8.0 * fs))); // ~8 sec segments (240 samples)
    const hop = Math.max(16, Math.floor(segLen / 2)); // 50% overlap

    let nFft = 1024;
    while (nFft < segLen * 2) nFft <<= 1;

    const halfFft = nFft / 2;
    const avgPower = new Float64Array(halfFft);
    let numSegments = 0;

    const real = new Float64Array(nFft);
    const imag = new Float64Array(nFft);

    for (let start = 0; start <= N - segLen; start += hop) {
      real.fill(0);
      imag.fill(0);

      // Hann window on segment
      for (let i = 0; i < segLen; i++) {
        const w = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (segLen - 1)));
        real[i] = signal[start + i] * w;
      }

      fft(real, imag);

      for (let k = 0; k < halfFft; k++) {
        avgPower[k] += real[k] * real[k] + imag[k] * imag[k];
      }
      numSegments++;
    }

    if (numSegments === 0) return null;

    for (let k = 0; k < halfFft; k++) {
      avgPower[k] /= numSegments;
    }

    return {
      power: avgPower,
      nFft,
      fs,
      fResolution: fs / nFft
    };
  }

  /**
   * Fuse multiple PSD streams using SNR weighting and extract peak
   */
  _fuseSpectra(streamSpectra) {
    if (!streamSpectra || streamSpectra.length === 0) return null;

    const ref = streamSpectra[0].psd;
    const halfFft = ref.power.length;
    const fRes = ref.fResolution;
    const kLow = Math.max(1, Math.floor(this.fLow / fRes));
    const kHigh = Math.min(halfFft - 1, Math.ceil(this.fHigh / fRes));

    // First evaluate individual stream SNRs
    const analyzedStreams = [];
    for (const item of streamSpectra) {
      const pArr = item.psd.power;
      let maxP = -1, kP = -1, totalP = 0;
      for (let k = kLow; k <= kHigh; k++) {
        totalP += pArr[k];
        if (pArr[k] > maxP) {
          maxP = pArr[k];
          kP = k;
        }
      }

      if (kP > 0 && totalP > 1e-12) {
        const deltaK = Math.max(1, Math.round(0.15 / fRes));
        let sigP = 0;
        for (let k = Math.max(kLow, kP - deltaK); k <= Math.min(kHigh, kP + deltaK); k++) {
          sigP += pArr[k];
        }
        const noiseP = Math.max(1e-12, totalP - sigP);
        const snr = sigP / noiseP;
        analyzedStreams.push({ ...item, snr, snrDb: 10 * Math.log10(snr), kPeak: kP });
      }
    }

    if (analyzedStreams.length === 0) return null;

    // Fused PSD: weighted average across streams by SNR
    let totalWeight = 0;
    const fusedPower = new Float64Array(halfFft);

    for (const s of analyzedStreams) {
      const w = Math.max(0.1, s.snr);
      totalWeight += w;
      for (let k = 0; k < halfFft; k++) {
        fusedPower[k] += s.psd.power[k] * w;
      }
    }

    for (let k = 0; k < halfFft; k++) {
      fusedPower[k] /= totalWeight;
    }

    // Find peak in fused spectrum
    let maxFused = -1, kFused = -1, totalBandPower = 0;
    for (let k = kLow; k <= kHigh; k++) {
      totalBandPower += fusedPower[k];
      if (fusedPower[k] > maxFused) {
        maxFused = fusedPower[k];
        kFused = k;
      }
    }

    if (kFused < 0 || totalBandPower <= 1e-12) return null;

    // Parabolic interpolation around peak bin
    const pPrev = fusedPower[kFused - 1] || fusedPower[kFused];
    const pCurr = fusedPower[kFused];
    const pNext = fusedPower[kFused + 1] || fusedPower[kFused];
    const denom = 2.0 * (2.0 * pCurr - pPrev - pNext);
    const delta = Math.abs(denom) > 1e-12 ? (pNext - pPrev) / denom : 0.0;
    let refinedFreq = Math.max(this.fLow, Math.min(this.fHigh, (kFused + delta) * fRes));

    // Harmonic check: check if peak is second harmonic of a genuine pulse (e.g. 140 vs 70 BPM)
    // or if half-harmonic artifact (e.g. 35 vs 70 BPM)
    const halfFreq = refinedFreq * 0.5;
    const doubleFreq = refinedFreq * 2.0;

    if (halfFreq >= this.fLow) {
      const kHalf = Math.round(halfFreq / fRes);
      if (kHalf >= kLow && kHalf <= kHigh && fusedPower[kHalf] > 0.45 * pCurr) {
        // Half frequency candidate is strong and physiological (e.g. 60-90 BPM range)
        if (halfFreq >= 0.9 && halfFreq <= 1.6) {
          refinedFreq = halfFreq;
        }
      }
    }

    // Calculate integrated SNR (Fundamental + 2nd harmonic vs remaining in-band noise)
    const deltaK = Math.max(1, Math.round(0.15 / fRes));
    let peakPowerSum = 0;
    const pStart1 = Math.max(kLow, Math.round(refinedFreq / fRes) - deltaK);
    const pEnd1 = Math.min(kHigh, Math.round(refinedFreq / fRes) + deltaK);
    for (let k = pStart1; k <= pEnd1; k++) {
      peakPowerSum += fusedPower[k];
    }

    const kHarmonic = Math.round((2.0 * refinedFreq) / fRes);
    if (kHarmonic - deltaK > pEnd1 && kHarmonic <= kHigh) {
      const pStart2 = Math.max(kLow, kHarmonic - deltaK);
      const pEnd2 = Math.min(kHigh, kHarmonic + deltaK);
      for (let k = pStart2; k <= pEnd2; k++) {
        peakPowerSum += fusedPower[k];
      }
    }

    const noisePower = Math.max(1e-12, totalBandPower - peakPowerSum);
    const snrRatio = peakPowerSum / noisePower;
    const snrDb = Math.round(10.0 * Math.log10(snrRatio) * 10) / 10;
    const peakBpm = Math.round(refinedFreq * 60.0);

    // Spectrum summary points for developer diagnostics graph (0.7 Hz to 3.0 Hz)
    const spectrumPoints = [];
    const stepK = Math.max(1, Math.round(0.04 / fRes));
    for (let k = kLow; k <= kHigh; k += stepK) {
      spectrumPoints.push({
        freq: Math.round(k * fRes * 100) / 100,
        bpm: Math.round(k * fRes * 60),
        power: Math.round(fusedPower[k] * 10) / 10
      });
    }

    // Best stream signal for waveform display
    const bestStream = analyzedStreams.sort((a, b) => b.snr - a.snr)[0];
    const waveSignal = bestStream ? bestStream.signal : [];
    const latestWaveform = waveSignal.length > 0 ? waveSignal[waveSignal.length - 1] : 0;

    return {
      peakFreq: refinedFreq,
      peakBpm,
      snrDb,
      latestWaveform,
      rawWaveform: waveSignal.slice(-150),
      filteredWaveform: waveSignal.slice(-150),
      spectrum: spectrumPoints
    };
  }

  /**
   * Finalize Quick Check-in results:
   * Returns median of collected estimates and small confidence range.
   */
  getCheckinFinalResult() {
    if (this.checkinEstimates.length === 0) {
      return {
        hasReading: false,
        bpm: null,
        range: null,
        confidenceWord: 'Fair',
        reasonCode: this.diagnostics.reasonNoReading,
        collectedCount: 0
      };
    }

    // Filter estimates passing minimum SNR
    const valid = this.checkinEstimates.filter((e) => e.snrDb >= this.minSnrDb && e.bpm >= 45 && e.bpm <= 180);
    if (valid.length === 0) {
      return {
        hasReading: false,
        bpm: null,
        range: null,
        confidenceWord: 'Fair',
        reasonCode: this.diagnostics.reasonNoReading !== 'OK' ? this.diagnostics.reasonNoReading : 'LOW_SNR',
        collectedCount: 0
      };
    }

    const bpms = valid.map((e) => e.bpm).sort((a, b) => a - b);
    const med = Math.round(median(bpms));

    // Calculate small range (e.g. median +/- 2)
    const low = Math.max(45, med - 2);
    const high = Math.min(180, med + 2);

    const meanSnr = valid.reduce((a, b) => a + b.snrDb, 0) / valid.length;
    const confidenceWord = meanSnr >= this.goodSnrDb ? 'Good' : 'Fair';

    return {
      hasReading: true,
      bpm: med,
      range: `${low}-${high}`,
      confidenceWord,
      meanSnrDb: Math.round(meanSnr * 10) / 10,
      collectedCount: valid.length
    };
  }

  _buildOutput() {
    return {
      bpm: this.smoothedBPM,
      rawBpm: this.currentBPM,
      confidence: this.confidence,
      snrDb: this.snrDb,
      hrv: this.hrvRmssd,
      waveform: this.currentWaveformValue,
      isPulsing: Math.abs(this.currentWaveformValue) > 0.05,
      diagnostics: { ...this.diagnostics }
    };
  }
}
