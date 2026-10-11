/**
 * PulseCam - Remote Photoplethysmography (rPPG) Pulse Engine
 *
 * Implements:
 * 1. Spatial averaging of R, G, B channels across facial ROIs (forehead + both cheeks).
 * 2. Sliding 10-second temporal window of color observations.
 * 3. Plane-Orthogonal-to-Skin (POS) algorithm (Wang et al., 2017) combining multi-channel chrominance.
 * 4. Temporal resampling to a strictly uniform sampling grid based on non-uniform frame timestamps.
 * 5. Detrending to eliminate baseline wander and respiration drift.
 * 6. Digital zero-phase band-pass filtering (0.7 - 3.0 Hz, 42 - 180 BPM).
 * 7. Fast Fourier Transform (FFT) peak heart-rate estimation with parabolic interpolation.
 * 8. SNR-based confidence evaluation (peak signal power vs. rest of the cardiac band).
 * 9. Confidence threshold gating: outputs BPM only when confidence passes threshold, otherwise returns null.
 * 10. Multi-estimate median filter smoothing to eliminate transient spikes without latency.
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
   * @param {number} [options.windowDurationMs=10000] - Sliding window length in ms (10 seconds)
   * @param {number} [options.targetFs=30] - Resampling frequency in Hz (30 Hz)
   * @param {number} [options.fLow=0.7] - Bandpass lower bound in Hz (42 BPM)
   * @param {number} [options.fHigh=3.0] - Bandpass upper bound in Hz (180 BPM)
   * @param {number} [options.confidenceThreshold=35] - Minimum SNR confidence score to output BPM (0-100)
   * @param {number} [options.medianWindowSize=5] - Number of estimates for median smoothing
   */
  constructor(options = {}) {
    // Accommodate legacy single numeric argument (sampleRate) if passed
    if (typeof options === 'number') {
      options = { targetFs: options };
    }

    this.windowDurationMs = options.windowDurationMs || 10000;
    this.targetFs = options.targetFs || 30;
    this.fLow = options.fLow || 0.7; // 42 BPM
    this.fHigh = options.fHigh || 3.0; // 180 BPM
    this.confidenceThreshold = options.confidenceThreshold !== undefined ? options.confidenceThreshold : 35;
    this.medianWindowSize = options.medianWindowSize || 5;
    this.luminanceChangeThreshold = options.luminanceChangeThreshold || 0.15; // 15% relative change threshold

    // Sliding window of raw RGB observations: Array of { r, g, b, bgLum, faceLum, timestamp }
    this.windowSamples = [];

    // Median filter history for valid estimates
    this.bpmMedianHistory = [];

    // Current output state
    this.currentBPM = null; // Raw FFT peak BPM
    this.smoothedBPM = null; // Median-filtered BPM (null if below confidence threshold)
    this.confidence = 0; // SNR confidence score (0 - 100%)
    this.snrDb = 0; // Signal-to-Noise Ratio in decibels
    this.hrvRmssd = null; // Heart Rate Variability RMSSD in ms
    this.ibiHistory = []; // Inter-beat intervals
    this.currentWaveformValue = 0; // Real-time BVP waveform sample for oscilloscope

    // Illumination compensation state
    this.lastBgLuminance = null;
    this.isIlluminationUnstable = false;
  }

  /**
   * Reset all temporal buffers and estimate histories
   */
  reset() {
    this.windowSamples = [];
    this.bpmMedianHistory = [];
    this.currentBPM = null;
    this.smoothedBPM = null;
    this.confidence = 0;
    this.snrDb = 0;
    this.hrvRmssd = null;
    this.ibiHistory = [];
    this.currentWaveformValue = 0;
    this.lastBgLuminance = null;
    this.isIlluminationUnstable = false;
  }

  /**
   * Sample background reference ROI outside the face to compute environmental illumination
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} [bgRoi] - { x, y, width, height }
   * @returns {number|null} Background photic luminance (0 - 255)
   */
  extractBgLuminance(ctx, bgRoi) {
    if (!ctx || !bgRoi) return null;

    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;
    const rx = Math.max(0, Math.floor(bgRoi.x));
    const ry = Math.max(0, Math.floor(bgRoi.y));
    const rw = Math.min(canvasWidth - rx, Math.floor(bgRoi.width));
    const rh = Math.min(canvasHeight - ry, Math.floor(bgRoi.height));

    if (rw <= 4 || rh <= 4) return null;

    let imgData;
    try {
      imgData = ctx.getImageData(rx, ry, rw, rh);
    } catch (e) {
      return null;
    }

    const data = imgData.data;
    const step = Math.max(1, Math.floor(Math.min(rw, rh) / 15));
    let sumLum = 0;
    let count = 0;

    for (let y = 0; y < rh; y += step) {
      for (let x = 0; x < rw; x += step) {
        const idx = (y * rw + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Standard photic luminance (ITU-R BT.601)
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        sumLum += lum;
        count++;
      }
    }

    return count > 0 ? sumLum / count : null;
  }

  /**
   * Average R, G, B color channels inside facial ROIs for the current frame
   * @param {CanvasRenderingContext2D} ctx - Canvas context containing the video frame
   * @param {Object|Array} rois - Single ROI, array of ROIs, or { forehead, leftCheek, rightCheek }
   * @returns {{ avgR: number, avgG: number, avgB: number, pixelCount: number }|null}
   */
  extractRgbFromRois(ctx, rois) {
    if (!ctx || !rois) return null;

    const canvasWidth = ctx.canvas.width;
    const canvasHeight = ctx.canvas.height;

    // Normalize input to array of ROI boxes
    let roiList = [];
    if (Array.isArray(rois)) {
      roiList = rois.filter(Boolean);
    } else if (rois.forehead || rois.leftCheek || rois.rightCheek) {
      if (rois.forehead) roiList.push(rois.forehead);
      if (rois.leftCheek) roiList.push(rois.leftCheek);
      if (rois.rightCheek) roiList.push(rois.rightCheek);
    } else if (rois.width > 5 && rois.height > 5) {
      roiList = [rois];
    }

    if (roiList.length === 0) return null;

    let sumR = 0, sumG = 0, sumB = 0;
    let pixelCount = 0;

    for (const rBox of roiList) {
      const rx = Math.max(0, Math.floor(rBox.x));
      const ry = Math.max(0, Math.floor(rBox.y));
      const rw = Math.min(canvasWidth - rx, Math.floor(rBox.width));
      const rh = Math.min(canvasHeight - ry, Math.floor(rBox.height));

      if (rw <= 5 || rh <= 5) continue;

      let imgData;
      try {
        imgData = ctx.getImageData(rx, ry, rw, rh);
      } catch (e) {
        continue;
      }

      const data = imgData.data;
      const step = Math.max(1, Math.floor(Math.min(rw, rh) / 25));

      for (let y = 0; y < rh; y += step) {
        for (let x = 0; x < rw; x += step) {
          const idx = (y * rw + x) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];

          // Biological skin filter: ensures pixels reflect subcutaneous hemoglobin beds
          // and excludes hair, deep shadows, glasses frames, and non-skin specularities
          if (r > 40 && g > 25 && b > 15 && r > b && (r - g) > -15) {
            sumR += r;
            sumG += g;
            sumB += b;
            pixelCount++;
          }
        }
      }
    }

    if (pixelCount < 15) {
      return null;
    }

    return {
      avgR: sumR / pixelCount,
      avgG: sumG / pixelCount,
      avgB: sumB / pixelCount,
      pixelCount
    };
  }

  /**
   * Process a stable frame:
   * 1. Averages R, G, B in the facial ROIs and extracts background reference ROI luminance.
   * 2. Evaluates luminance changes over the 10-second window; flags > 15% shifts as "illumination unstable".
   * 3. Regresses background luminance over time and subtracts this component from face RGB before POS.
   * 4. Executes the POS algorithm over illumination-compensated color signals.
   * 5. Resamples to a uniform rate based on frame timestamps.
   * 6. Detrends and bandpass filters (0.7 - 3.0 Hz).
   * 7. Computes FFT peak heart rate and SNR confidence score.
   * 8. Lowers confidence if illumination is unstable and outputs BPM or null via threshold gating.
   *
   * @param {CanvasRenderingContext2D} ctx - Video frame context
   * @param {Object|Array} rois - Facial skin ROIs
   * @param {number} [timestampMs=performance.now()] - Timestamp of the current frame in ms
   * @param {Object} [bgRoi=null] - Background reference ROI outside face
   */
  processFrame(ctx, rois, timestampMs = performance.now(), bgRoi = null) {
    const rgb = this.extractRgbFromRois(ctx, rois);
    if (!rgb) {
      return {
        waveform: this.currentWaveformValue,
        bpm: this.smoothedBPM,
        rawBpm: this.currentBPM,
        confidence: this.confidence,
        snrDb: this.snrDb,
        hrv: this.hrvRmssd,
        isPulsing: false,
        illumination: {
          isUnstable: this.isIlluminationUnstable,
          status: this.isIlluminationUnstable ? 'UNSTABLE' : 'STABLE',
          bgLuminance: this.lastBgLuminance !== null ? Math.round(this.lastBgLuminance) : 0,
          faceLuminance: 0,
          bgDeltaPct: 0,
          faceDeltaPct: 0
        }
      };
    }

    // Whole-face photic luminance
    const faceLum = 0.299 * rgb.avgR + 0.587 * rgb.avgG + 0.114 * rgb.avgB;

    // Background reference ROI luminance
    let bgLum = this.extractBgLuminance(ctx, bgRoi);
    if (bgLum === null) {
      bgLum = this.lastBgLuminance !== null ? this.lastBgLuminance : faceLum;
    }
    this.lastBgLuminance = bgLum;

    // 1. Accumulate into 10-second sliding temporal window
    this.windowSamples.push({
      r: rgb.avgR,
      g: rgb.avgG,
      b: rgb.avgB,
      bgLum,
      faceLum,
      timestamp: timestampMs
    });

    // Prune entries older than 10 seconds
    const cutoffTime = timestampMs - this.windowDurationMs;
    while (this.windowSamples.length > 0 && this.windowSamples[0].timestamp < cutoffTime) {
      this.windowSamples.shift();
    }

    const nSamples = this.windowSamples.length;
    const durationMs = nSamples > 1
      ? this.windowSamples[nSamples - 1].timestamp - this.windowSamples[0].timestamp
      : 0;

    // Need at least 2.5 seconds (>= 70 samples) to establish spectral resolution
    if (nSamples < 70 || durationMs < 2500) {
      return {
        waveform: this.currentWaveformValue,
        bpm: null,
        rawBpm: null,
        confidence: 0,
        snrDb: 0,
        hrv: null,
        isPulsing: false,
        illumination: {
          isUnstable: false,
          status: 'STABLE',
          bgLuminance: Math.round(bgLum),
          faceLuminance: Math.round(faceLum),
          bgDeltaPct: 0,
          faceDeltaPct: 0
        }
      };
    }

    // 2. Assess Illumination Stability over the sliding window:
    // Flag any window where reference-region or whole-face luminance changes by more than set percentage (15%)
    let minBg = Infinity, maxBg = -Infinity, sumBg = 0;
    let minFace = Infinity, maxFace = -Infinity, sumFace = 0;
    for (let i = 0; i < nSamples; i++) {
      const s = this.windowSamples[i];
      if (s.bgLum < minBg) minBg = s.bgLum;
      if (s.bgLum > maxBg) maxBg = s.bgLum;
      sumBg += s.bgLum;

      if (s.faceLum < minFace) minFace = s.faceLum;
      if (s.faceLum > maxFace) maxFace = s.faceLum;
      sumFace += s.faceLum;
    }
    const meanBg = sumBg / nSamples;
    const meanFace = sumFace / nSamples;
    const deltaYBg = meanBg > 1 ? (maxBg - minBg) / meanBg : 0;
    const deltaYFace = meanFace > 1 ? (maxFace - minFace) / meanFace : 0;

    const isIlluminationUnstable =
      deltaYBg > this.luminanceChangeThreshold || deltaYFace > this.luminanceChangeThreshold;
    this.isIlluminationUnstable = isIlluminationUnstable;

    // 3. Illumination Compensation Step:
    // Compute background reference brightness over time and regress/subtract this component
    // from the face RGB signals before POS
    let varBg = 0;
    for (let i = 0; i < nSamples; i++) {
      const d = this.windowSamples[i].bgLum - meanBg;
      varBg += d * d;
    }
    varBg /= nSamples;

    let compensatedSamples = this.windowSamples;
    if (varBg > 1e-4) {
      let sumR = 0, sumG = 0, sumB = 0;
      for (let i = 0; i < nSamples; i++) {
        sumR += this.windowSamples[i].r;
        sumG += this.windowSamples[i].g;
        sumB += this.windowSamples[i].b;
      }
      const meanR = sumR / nSamples;
      const meanG = sumG / nSamples;
      const meanB = sumB / nSamples;

      let covR = 0, covG = 0, covB = 0;
      for (let i = 0; i < nSamples; i++) {
        const s = this.windowSamples[i];
        const bgDiff = s.bgLum - meanBg;
        covR += (s.r - meanR) * bgDiff;
        covG += (s.g - meanG) * bgDiff;
        covB += (s.b - meanB) * bgDiff;
      }

      const betaR = (covR / nSamples) / varBg;
      const betaG = (covG / nSamples) / varBg;
      const betaB = (covB / nSamples) / varBg;

      compensatedSamples = new Array(nSamples);
      for (let i = 0; i < nSamples; i++) {
        const s = this.windowSamples[i];
        const bgDiff = s.bgLum - meanBg;
        compensatedSamples[i] = {
          r: Math.max(1, s.r - betaR * bgDiff),
          g: Math.max(1, s.g - betaG * bgDiff),
          b: Math.max(1, s.b - betaB * bgDiff),
          timestamp: s.timestamp
        };
      }
    }

    // 4. Execute POS (Plane-Orthogonal-to-Skin) Algorithm over compensated color signals
    const posSignals = this._computePOS(compensatedSamples);

    // 5. Resample to a strictly uniform 30 Hz grid based on actual frame timestamps
    const timestamps = this.windowSamples.map((s) => s.timestamp);
    const { resampled, fs } = resampleSignal(timestamps, posSignals, this.targetFs);

    if (resampled.length < 64) {
      return {
        waveform: this.currentWaveformValue,
        bpm: this.smoothedBPM,
        rawBpm: this.currentBPM,
        confidence: this.confidence,
        snrDb: this.snrDb,
        hrv: this.hrvRmssd,
        isPulsing: false,
        illumination: {
          isUnstable: isIlluminationUnstable,
          status: isIlluminationUnstable ? 'UNSTABLE' : 'STABLE',
          bgDeltaPct: Math.round(deltaYBg * 100),
          faceDeltaPct: Math.round(deltaYFace * 100),
          bgLuminance: Math.round(bgLum),
          faceLuminance: Math.round(faceLum)
        }
      };
    }

    // 6. Detrend to eliminate baseline drift and low-frequency respiration wander
    const detrended = this._detrend(resampled, Math.round(0.75 * fs));

    // 7. Bandpass Filter (0.7 - 3.0 Hz / 42 - 180 BPM) & FFT Analysis
    const analysis = this._analyzeSpectrum(detrended, fs);

    // Update real-time waveform value for visual oscilloscope
    this.currentWaveformValue = analysis.latestWaveform;

    // 8. Evaluate Confidence and Apply Median Filter
    this.currentBPM = analysis.peakBpm;
    this.snrDb = analysis.snrDb;

    // Flag any window where reference-region or whole-face luminance changes by > 15%
    // as "illumination unstable" and lower its confidence
    let effectiveConfidence = analysis.confidence;
    if (isIlluminationUnstable) {
      // Lower confidence by 50% when illumination is unstable
      effectiveConfidence = Math.min(30, Math.round(effectiveConfidence * 0.5));
    }
    this.confidence = effectiveConfidence;

    // Gating rule: Output BPM only if confidence passes threshold, otherwise output null
    if (effectiveConfidence >= this.confidenceThreshold && analysis.peakBpm !== null) {
      this.bpmMedianHistory.push(analysis.peakBpm);
      if (this.bpmMedianHistory.length > this.medianWindowSize) {
        this.bpmMedianHistory.shift();
      }

      // Smooth with median filter over the last several estimates
      const med = median(this.bpmMedianHistory);
      this.smoothedBPM = med !== null ? Math.round(med) : null;
    } else {
      // Confidence below threshold: discard noisy estimation and output null
      this.smoothedBPM = null;
    }

    // 9. Extract Inter-Beat Intervals & HRV (RMSSD) from filtered waveform
    if (analysis.filteredWaveform && analysis.filteredWaveform.length >= 60) {
      this._extractHRV(analysis.filteredWaveform, fs);
    }

    return {
      waveform: this.currentWaveformValue,
      bpm: this.smoothedBPM,
      rawBpm: this.currentBPM,
      confidence: this.confidence,
      snrDb: this.snrDb,
      hrv: this.hrvRmssd,
      isPulsing: Math.abs(this.currentWaveformValue) > 0.15,
      illumination: {
        isUnstable: isIlluminationUnstable,
        status: isIlluminationUnstable ? 'UNSTABLE' : 'STABLE',
        bgDeltaPct: Math.round(deltaYBg * 100),
        faceDeltaPct: Math.round(deltaYFace * 100),
        bgLuminance: Math.round(bgLum),
        faceLuminance: Math.round(faceLum)
      }
    };
  }

  /**
   * Plane-Orthogonal-to-Skin (POS) projection
   * Computes chrominance projections S1 = Gn - Bn, S2 = Gn + Bn - 2*Rn,
   * then combines via standard deviation ratio: H = S1 + (std(S1)/std(S2)) * S2
   * @param {Array<{r: number, g: number, b: number}>} samples
   * @returns {number[]}
   */
  _computePOS(samples) {
    const N = samples.length;

    // Temporal mean for each color channel over the window
    let sumR = 0, sumG = 0, sumB = 0;
    for (let i = 0; i < N; i++) {
      sumR += samples[i].r;
      sumG += samples[i].g;
      sumB += samples[i].b;
    }
    const meanR = sumR / N || 1;
    const meanG = sumG / N || 1;
    const meanB = sumB / N || 1;

    // Normalized color signals and projection onto orthogonal chrominance vectors
    const S1 = new Float64Array(N);
    const S2 = new Float64Array(N);
    let sumS1 = 0, sumS2 = 0;

    for (let i = 0; i < N; i++) {
      const rn = samples[i].r / meanR;
      const gn = samples[i].g / meanG;
      const bn = samples[i].b / meanB;

      // Projection vectors:
      // S1 = Gn - Bn
      // S2 = Gn + Bn - 2*Rn
      const s1 = gn - bn;
      const s2 = gn + bn - 2.0 * rn;

      S1[i] = s1;
      S2[i] = s2;
      sumS1 += s1;
      sumS2 += s2;
    }

    const meanS1 = sumS1 / N;
    const meanS2 = sumS2 / N;

    // Compute standard deviations of S1 and S2
    let varS1 = 0, varS2 = 0;
    for (let i = 0; i < N; i++) {
      const d1 = S1[i] - meanS1;
      const d2 = S2[i] - meanS2;
      varS1 += d1 * d1;
      varS2 += d2 * d2;
    }

    const stdS1 = Math.sqrt(varS1 / N);
    const stdS2 = Math.sqrt(varS2 / N);

    // Alpha weighting ratio: std(S1) / std(S2)
    const alpha = stdS2 > 1e-7 ? stdS1 / stdS2 : 1.0;

    // Combined pulse signal: H = S1 + alpha * S2
    const H = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      H[i] = (S1[i] - meanS1) + alpha * (S2[i] - meanS2);
    }

    return Array.from(H);
  }

  /**
   * Detrend signal using moving-average subtraction
   * @param {number[]} signal
   * @param {number} windowSize
   * @returns {number[]}
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
      const baseline = localSum / (end - start + 1);
      detrended[i] = signal[i] - baseline;
      sum += detrended[i];
    }

    // Zero-mean centering
    const mean = sum / N;
    for (let i = 0; i < N; i++) {
      detrended[i] -= mean;
    }

    return Array.from(detrended);
  }

  /**
   * Filter in frequency domain (0.7 - 3.0 Hz) and compute FFT peak + SNR confidence
   * @param {number[]} signal - Uniform detrended signal
   * @param {number} fs - Sample rate in Hz
   * @returns {{ peakBpm: number|null, confidence: number, snrDb: number, latestWaveform: number, filteredWaveform: number[] }}
   */
  _analyzeSpectrum(signal, fs) {
    const M = signal.length;
    if (M < 32) {
      return { peakBpm: null, confidence: 0, snrDb: 0, latestWaveform: 0, filteredWaveform: [] };
    }

    // Zero-pad to next power of 2 (min 1024 points for high frequency bin resolution)
    let nFft = 1024;
    while (nFft < M) nFft <<= 1;

    const real = new Float64Array(nFft);
    const imag = new Float64Array(nFft);

    // Apply Hann window to mitigate spectral leakage
    for (let k = 0; k < M; k++) {
      const w = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * k) / (M - 1)));
      real[k] = signal[k] * w;
      imag[k] = 0;
    }

    // Compute Radix-2 FFT
    fft(real, imag);

    // Compute Power Spectral Density & Apply Bandpass (0.7 - 3.0 Hz / 42 - 180 BPM)
    const halfFft = nFft / 2;
    const power = new Float64Array(halfFft);
    const bpReal = new Float64Array(nFft);
    const bpImag = new Float64Array(nFft);

    const fResolution = fs / nFft; // Frequency resolution per bin (~0.029 Hz at 1024 / 30Hz)
    const kLow = Math.max(1, Math.floor(this.fLow / fResolution));
    const kHigh = Math.min(halfFft - 1, Math.ceil(this.fHigh / fResolution));

    let maxPower = -1;
    let kPeak = -1;
    let totalBandPower = 0;

    for (let k = 1; k < halfFft; k++) {
      const f = k * fResolution;
      const p = real[k] * real[k] + imag[k] * imag[k];
      power[k] = p;

      // Check if within cardiac passband [0.7 Hz, 3.0 Hz]
      if (k >= kLow && k <= kHigh) {
        totalBandPower += p;
        if (p > maxPower) {
          maxPower = p;
          kPeak = k;
        }

        // Keep passband frequencies for IFFT time-domain reconstruction
        bpReal[k] = real[k];
        bpImag[k] = imag[k];
        // Symmetric negative frequencies
        bpReal[nFft - k] = real[nFft - k];
        bpImag[nFft - k] = imag[nFft - k];
      }
    }

    // Reconstruct zero-phase bandpassed time-domain waveform via IFFT
    ifft(bpReal, bpImag);
    const filteredWaveform = Array.from(bpReal.subarray(0, M));
    const latestWaveform = filteredWaveform[M - 1] || 0;

    if (kPeak < 0 || totalBandPower <= 1e-12) {
      return { peakBpm: null, confidence: 0, snrDb: 0, latestWaveform, filteredWaveform };
    }

    // Parabolic interpolation around peak bin for sub-bin precision
    const pPrev = power[kPeak - 1] || power[kPeak];
    const pCurr = power[kPeak];
    const pNext = power[kPeak + 1] || power[kPeak];
    const denom = 2.0 * (2.0 * pCurr - pPrev - pNext);
    const delta = Math.abs(denom) > 1e-12 ? (pNext - pPrev) / denom : 0.0;
    const refinedFreq = Math.max(this.fLow, Math.min(this.fHigh, (kPeak + delta) * fResolution));
    const peakBpm = Math.round(refinedFreq * 60.0);

    // SNR Confidence Calculation:
    // Compare power within the fundamental peak (and first harmonic) vs. rest of the cardiac band
    const deltaK = Math.max(1, Math.round(0.15 / fResolution)); // +/- 0.15 Hz (~9 BPM) integration window
    let peakPowerSum = 0;

    // 1. Fundamental peak integration
    const pStart1 = Math.max(kLow, kPeak - deltaK);
    const pEnd1 = Math.min(kHigh, kPeak + deltaK);
    for (let k = pStart1; k <= pEnd1; k++) {
      peakPowerSum += power[k];
    }

    // 2. Harmonic peak integration (2 * refinedFreq) if within band
    const kHarmonic = Math.round((2.0 * refinedFreq) / fResolution);
    if (kHarmonic - deltaK > pEnd1 && kHarmonic <= kHigh) {
      const pStart2 = Math.max(kLow, kHarmonic - deltaK);
      const pEnd2 = Math.min(kHigh, kHarmonic + deltaK);
      for (let k = pStart2; k <= pEnd2; k++) {
        peakPowerSum += power[k];
      }
    }

    // Noise power = in-band power minus signal power
    const noisePower = Math.max(1e-12, totalBandPower - peakPowerSum);
    const snrRatio = peakPowerSum / noisePower;
    const snrDb = Math.round(10.0 * Math.log10(snrRatio) * 10) / 10;

    // Peak fraction of total band power (ranges from ~0.15 for noise to ~0.75+ for clean pulse)
    const peakFraction = totalBandPower > 0 ? peakPowerSum / totalBandPower : 0;

    // Calibrated confidence score (0 to 100%)
    // 0.20 fraction -> 0% confidence
    // 0.65+ fraction -> 100% confidence
    const confidence = Math.round(
      Math.min(100, Math.max(0, ((peakFraction - 0.20) / 0.45) * 100))
    );

    return {
      peakBpm,
      confidence,
      snrDb,
      latestWaveform,
      filteredWaveform
    };
  }

  /**
   * Extract Inter-Beat Intervals (IBIs) and RMSSD Heart Rate Variability from filtered waveform
   * @param {number[]} waveform
   * @param {number} fs
   */
  _extractHRV(waveform, fs) {
    const minDistance = Math.max(6, Math.floor(fs * 0.33)); // Max 180 BPM
    const peaks = findPeaks(waveform, minDistance, 0.03);

    if (peaks.length >= 2) {
      const ibis = [];
      for (let i = 0; i < peaks.length - 1; i++) {
        const frameDiff = peaks[i + 1] - peaks[i];
        const ibiMs = Math.round((frameDiff / fs) * 1000);
        if (ibiMs >= 333 && ibiMs <= 1400) {
          ibis.push(ibiMs);
        }
      }

      if (ibis.length >= 2) {
        this.ibiHistory = ibis;
        this.hrvRmssd = calculateRMSSD(ibis);
      }
    }
  }
}
