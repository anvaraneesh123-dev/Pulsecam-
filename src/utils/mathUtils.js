/**
 * PulseCam - Digital Signal Processing & Biometric Math Utilities
 */

/**
 * 2nd-Order Digital Butterworth Bandpass Filter
 * Tuned for 30 FPS webcam input with passband [0.75 Hz, 3.0 Hz] (45 - 180 BPM)
 */
export class BandpassFilter {
  constructor(lowCutoff = 0.75, highCutoff = 3.0, sampleRate = 30) {
    this.fs = sampleRate;
    this.fLow = lowCutoff;
    this.fHigh = highCutoff;
    this.reset();
  }

  reset() {
    this.x = [0, 0, 0, 0, 0];
    this.y = [0, 0, 0, 0, 0];
  }

  // Precomputed 2nd-order Butterworth coefficients at ~30Hz sample rate for 0.75Hz-3.0Hz
  process(sample) {
    // Standard direct form II biquad section cascade approximation
    // High-pass at 0.75 Hz + Low-pass at 3.0 Hz
    if (isNaN(sample)) return 0;

    // Shift previous inputs
    this.x[4] = this.x[3];
    this.x[3] = this.x[2];
    this.x[2] = this.x[1];
    this.x[1] = this.x[0];
    this.x[0] = sample;

    // Shift previous outputs
    this.y[4] = this.y[3];
    this.y[3] = this.y[2];
    this.y[2] = this.y[1];
    this.y[1] = this.y[0];

    // Coefficients calculated for normalized bandpass [0.05, 0.20]
    // b = [0.0465, 0, -0.0931, 0, 0.0465]
    // a = [1.0, -2.593, 2.768, -1.412, 0.325]
    const b = [0.04658, 0, -0.09316, 0, 0.04658];
    const a = [1.0, -2.5932, 2.7685, -1.4124, 0.3253];

    const out =
      b[0] * this.x[0] +
      b[1] * this.x[1] +
      b[2] * this.x[2] +
      b[3] * this.x[3] +
      b[4] * this.x[4] -
      (a[1] * this.y[1] +
        a[2] * this.y[2] +
        a[3] * this.y[3] +
        a[4] * this.y[4]);

    this.y[0] = isNaN(out) ? 0 : Math.max(-100, Math.min(100, out));
    return this.y[0];
  }
}

/**
 * Detrend signal by removing moving average baseline
 */
export function detrendSignal(signal, windowSize = 15) {
  if (signal.length < windowSize) return [...signal];
  const detrended = [];
  const half = Math.floor(windowSize / 2);

  for (let i = 0; i < signal.length; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(signal.length, i + half + 1);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += signal[j];
    }
    const mean = sum / (end - start);
    detrended.push(signal[i] - mean);
  }
  return detrended;
}

/**
 * Autocorrelation heart-rate estimator
 * Robust against camera noise and lighting flickers
 */
export function estimateHeartRateAutocorr(signal, sampleRate = 30) {
  if (signal.length < 60) return null; // Need at least 2 seconds

  const n = signal.length;
  // HR limits: 45 BPM -> lag = sampleRate * 60 / 45 = 40 frames
  // HR limits: 180 BPM -> lag = sampleRate * 60 / 180 = 10 frames
  const minLag = Math.floor((sampleRate * 60) / 180);
  const maxLag = Math.floor((sampleRate * 60) / 45);

  let bestLag = -1;
  let maxCorr = -Infinity;

  // Compute zero-lag autocorrelation (variance)
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += signal[i] * signal[i];
  if (sumSq < 1e-6) return null;

  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    let corr = 0;
    let count = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += signal[i] * signal[i + lag];
      count++;
    }
    const normalizedCorr = count > 0 ? corr / count : 0;
    if (normalizedCorr > maxCorr) {
      maxCorr = normalizedCorr;
      bestLag = lag;
    }
  }

  if (bestLag > 0 && maxCorr > 0) {
    const estimatedBPM = (sampleRate / bestLag) * 60;
    // Normalized peak correlation gives confidence measure
    const confidence = Math.min(1, Math.max(0, maxCorr / (sumSq / n)));
    return { bpm: Math.round(estimatedBPM), confidence, lag: bestLag };
  }
  return null;
}

/**
 * Peak detector for inter-beat intervals (IBI) and HRV calculation
 */
export function findPeaks(signal, minDistance = 10, threshold = 0.05) {
  const peaks = [];
  for (let i = 1; i < signal.length - 1; i++) {
    if (
      signal[i] > signal[i - 1] &&
      signal[i] > signal[i + 1] &&
      signal[i] > threshold
    ) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDistance) {
        peaks.push(i);
      }
    }
  }
  return peaks;
}

/**
 * Calculate Root Mean Square of Successive Differences (RMSSD) for HRV
 */
export function calculateRMSSD(intervalsMs) {
  if (intervalsMs.length < 3) return null;
  let sumSqDiff = 0;
  for (let i = 0; i < intervalsMs.length - 1; i++) {
    const diff = intervalsMs[i + 1] - intervalsMs[i];
    sumSqDiff += diff * diff;
  }
  return Math.round(Math.sqrt(sumSqDiff / (intervalsMs.length - 1)));
}

/**
 * Euclidean distance between 2D or 3D points
 */
export function euclideanDistance(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Eye Aspect Ratio (EAR) based on 6 landmark points
 * EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
 */
export function calculateEAR(landmarks, indices) {
  const [i1, i2, i3, i4, i5, i6] = indices;
  const p1 = landmarks[i1];
  const p2 = landmarks[i2];
  const p3 = landmarks[i3];
  const p4 = landmarks[i4];
  const p5 = landmarks[i5];
  const p6 = landmarks[i6];

  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0.3;

  const vertical1 = euclideanDistance(p2, p6);
  const vertical2 = euclideanDistance(p3, p5);
  const horizontal = euclideanDistance(p1, p4);

  if (horizontal < 1e-4) return 0.3;
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

/**
 * Exponential Moving Average
 */
export function ema(current, previous, alpha = 0.15) {
  if (previous === null || previous === undefined || isNaN(previous)) return current;
  return alpha * current + (1 - alpha) * previous;
}

/**
 * Radix-2 Cooley-Tukey Fast Fourier Transform (in-place)
 * @param {Float64Array|number[]} real - Real components array (length must be power of 2)
 * @param {Float64Array|number[]} imag - Imaginary components array (length must be power of 2)
 */
export function fft(real, imag) {
  const n = real.length;
  if ((n & (n - 1)) !== 0) throw new Error('FFT length must be a power of 2');

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      let tr = real[i]; real[i] = real[j]; real[j] = tr;
      let ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly computation
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wr = 1.0;
      let wi = 0.0;
      for (let k = 0; k < half; k++) {
        const uR = real[i + k];
        const uI = imag[i + k];
        const vR = real[i + k + half] * wr - imag[i + k + half] * wi;
        const vI = real[i + k + half] * wi + imag[i + k + half] * wr;

        real[i + k] = uR + vR;
        imag[i + k] = uI + vI;
        real[i + k + half] = uR - vR;
        imag[i + k + half] = uI - vI;

        const nextWr = wr * wStepR - wi * wStepI;
        wi = wr * wStepI + wi * wStepR;
        wr = nextWr;
      }
    }
  }
}

/**
 * Inverse Fast Fourier Transform
 * @param {Float64Array|number[]} real
 * @param {Float64Array|number[]} imag
 */
export function ifft(real, imag) {
  const n = real.length;
  for (let i = 0; i < n; i++) imag[i] = -imag[i];
  fft(real, imag);
  for (let i = 0; i < n; i++) {
    real[i] = real[i] / n;
    imag[i] = -imag[i] / n;
  }
}

/**
 * Resample non-uniform signal to a strictly uniform sampling rate fs based on timestamps
 * @param {number[]} timestamps - Millisecond timestamps array (monotonic)
 * @param {number[]} values - Signal values array
 * @param {number} [targetFs=30] - Desired uniform sample rate in Hz
 * @returns {{ resampled: number[], dtMs: number, fs: number, tStart: number, tEnd: number }}
 */
export function resampleSignal(timestamps, values, targetFs = 30) {
  const n = timestamps.length;
  if (n < 2) return { resampled: [...values], dtMs: 1000 / targetFs, fs: targetFs, tStart: 0, tEnd: 0 };

  const tStart = timestamps[0];
  const tEnd = timestamps[n - 1];
  const durationSec = (tEnd - tStart) / 1000;
  if (durationSec <= 0) return { resampled: [...values], dtMs: 1000 / targetFs, fs: targetFs, tStart, tEnd };

  const numSamples = Math.max(2, Math.floor(durationSec * targetFs));
  const stepMs = 1000 / targetFs;
  const resampled = new Float64Array(numSamples);

  let j = 0;
  for (let k = 0; k < numSamples; k++) {
    const tTarget = tStart + k * stepMs;
    while (j < n - 2 && timestamps[j + 1] < tTarget) {
      j++;
    }
    const t0 = timestamps[j];
    const t1 = timestamps[j + 1];
    const v0 = values[j];
    const v1 = values[j + 1];
    const span = t1 - t0;
    const u = span > 0 ? Math.max(0, Math.min(1, (tTarget - t0) / span)) : 0;
    resampled[k] = v0 + u * (v1 - v0);
  }

  return { resampled: Array.from(resampled), dtMs: stepMs, fs: targetFs, tStart, tEnd };
}

/**
 * Calculate median of a numerical array
 * @param {number[]} arr
 * @returns {number|null}
 */
export function median(arr) {
  if (!arr || arr.length === 0) return null;
  const valid = arr.filter((x) => typeof x === 'number' && !isNaN(x)).sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const mid = Math.floor(valid.length / 2);
  if (valid.length % 2 === 1) {
    return valid[mid];
  }
  return (valid[mid - 1] + valid[mid]) / 2;
}
