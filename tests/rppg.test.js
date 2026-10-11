import test from 'node:test';
import assert from 'node:assert/strict';
import { RPPGEngine } from '../src/modules/rppg.js';

test('RPPGEngine - Recovers 72 BPM clean physiological sine signal', () => {
  const engine = new RPPGEngine({ targetFs: 30, confidenceThreshold: 35 });
  const fs = 30;
  const durationSec = 10;
  const nSamples = fs * durationSec; // 300 samples
  const targetHz = 1.2; // 72 BPM
  const targetBpm = 72;

  // Generate synthetic skin observations with pulsatile absorption peak in green channel
  const samples = [];
  for (let i = 0; i < nSamples; i++) {
    const t = i / fs;
    const pulse = Math.sin(2 * Math.PI * targetHz * t);
    samples.push({
      r: 220 + pulse * 1.0,
      g: 175 - pulse * 4.0, // capillary blood absorption peak in green
      b: 150 - pulse * 1.5,
      timestamp: i * 33.333
    });
  }

  // 1. Test POS chrominance projection
  const posSignal = engine._computePOS(samples);
  assert.equal(posSignal.length, nSamples, 'POS signal length matches input');

  // 2. Test detrending
  const detrended = engine._detrend(posSignal, Math.round(0.75 * fs));
  assert.equal(detrended.length, nSamples, 'Detrended signal length matches input');

  // 3. Test spectral peak and confidence analysis
  const analysis = engine._analyzeSpectrum(detrended, fs);
  assert.ok(analysis.peakBpm !== null, 'Peak BPM identified');
  assert.ok(
    Math.abs(analysis.peakBpm - targetBpm) <= 2,
    `Recovered BPM ${analysis.peakBpm} is within 2 BPM of target ${targetBpm}`
  );
  assert.ok(analysis.confidence >= 60, `Confidence ${analysis.confidence}% is high for clean signal`);
});

test('RPPGEngine - Recovers 90 BPM clean physiological sine signal', () => {
  const engine = new RPPGEngine({ targetFs: 30, confidenceThreshold: 35 });
  const fs = 30;
  const durationSec = 10;
  const nSamples = fs * durationSec;
  const targetHz = 1.5; // 90 BPM
  const targetBpm = 90;

  const samples = [];
  for (let i = 0; i < nSamples; i++) {
    const t = i / fs;
    const pulse = Math.sin(2 * Math.PI * targetHz * t);
    samples.push({
      r: 215 + pulse * 1.2,
      g: 180 - pulse * 4.2,
      b: 155 - pulse * 1.8,
      timestamp: i * 33.333
    });
  }

  const posSignal = engine._computePOS(samples);
  const detrended = engine._detrend(posSignal, Math.round(0.75 * fs));
  const analysis = engine._analyzeSpectrum(detrended, fs);

  assert.ok(analysis.peakBpm !== null, 'Peak BPM identified');
  assert.ok(
    Math.abs(analysis.peakBpm - targetBpm) <= 2,
    `Recovered BPM ${analysis.peakBpm} is within 2 BPM of target ${targetBpm}`
  );
});

test('RPPGEngine - Recovers 75 BPM from noisy synthetic sine signal', () => {
  const engine = new RPPGEngine({ targetFs: 30, confidenceThreshold: 30 });
  const fs = 30;
  const durationSec = 10;
  const nSamples = fs * durationSec;
  const targetHz = 1.25; // 75 BPM
  const targetBpm = 75;

  // Pseudo-random deterministic noise generator
  let seed = 42;
  const pseudoRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return (seed / 233280) * 2 - 1;
  };

  const samples = [];
  for (let i = 0; i < nSamples; i++) {
    const t = i / fs;
    const pulse = Math.sin(2 * Math.PI * targetHz * t);
    const noise = pseudoRandom() * 1.2; // Add noise
    samples.push({
      r: 220 + (pulse + noise) * 1.0,
      g: 175 - (pulse * 3.5 + noise * 1.0),
      b: 150 - (pulse * 1.2 + noise * 0.8),
      timestamp: i * 33.333
    });
  }

  const posSignal = engine._computePOS(samples);
  const detrended = engine._detrend(posSignal, Math.round(0.75 * fs));
  const analysis = engine._analyzeSpectrum(detrended, fs);

  assert.ok(analysis.peakBpm !== null, 'Peak BPM identified under noise');
  assert.ok(
    Math.abs(analysis.peakBpm - targetBpm) <= 3,
    `Recovered BPM ${analysis.peakBpm} is within 3 BPM of target ${targetBpm} under noise`
  );
});

test('RPPGEngine - Rejects flatline / low-energy signal with low confidence', () => {
  const engine = new RPPGEngine({ targetFs: 30, confidenceThreshold: 35 });
  const fs = 30;
  const durationSec = 10;
  const nSamples = fs * durationSec;

  // Flatline signal without cardiac pulsation
  const samples = [];
  for (let i = 0; i < nSamples; i++) {
    samples.push({
      r: 200,
      g: 160,
      b: 140,
      timestamp: i * 33.333
    });
  }

  const posSignal = engine._computePOS(samples);
  const detrended = engine._detrend(posSignal, Math.round(0.75 * fs));
  const analysis = engine._analyzeSpectrum(detrended, fs);

  assert.ok(analysis.confidence < 35, `Confidence ${analysis.confidence}% is low for flatline signal`);
});
