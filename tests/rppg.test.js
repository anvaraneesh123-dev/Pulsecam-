import test from 'node:test';
import assert from 'node:assert/strict';
import { RPPGEngine } from '../src/modules/rppg.js';

/**
 * Deterministic pseudo-random number generator
 */
function createRng(seed = 12345) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return (s / 233280) * 2 - 1;
  };
}

/**
 * Helper to feed synthetic frame sequence to RPPGEngine
 */
function feedSyntheticSequence(engine, targetBpm, options = {}) {
  const fs = 30;
  const durationSec = options.durationSec || 15;
  const targetHz = targetBpm / 60.0;
  const rng = createRng(options.seed || 42);
  const driftRate = options.driftRate || 0.0;
  const noiseAmp = options.noiseAmp !== undefined ? options.noiseAmp : 0.8;
  const motionDropRatio = options.motionDropRatio || 0.0;

  const width = 640;
  const height = 480;

  // Mock canvas context
  const mockCtx = {
    canvas: { width, height },
    getImageData() {
      // Not called directly if we supply precomputed ROIs in engine
      return { data: new Uint8ClampedArray(100) };
    }
  };

  const totalFrames = Math.round(durationSec * fs);
  let lastOutput = null;

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fs;
    const ts = i * 33.333 + (options.jitter ? rng() * 4.0 : 0);

    // Skip simulated missing frames if testing gap interpolation
    if (motionDropRatio > 0 && rng() < (motionDropRatio * 2 - 1)) {
      continue;
    }

    const pulse = Math.sin(2 * Math.PI * targetHz * t);
    const drift = driftRate * t;
    const noise = rng() * noiseAmp;

    // Simulate skin color with pulsatile capillary absorption peak in Green
    const r = Math.max(30, Math.min(240, 215 + drift + (pulse * 1.0 + noise)));
    const g = Math.max(30, Math.min(240, 172 + drift - (pulse * 3.8 + noise * 1.2)));
    const b = Math.max(20, Math.min(240, 148 + drift - (pulse * 1.5 + noise * 0.8)));

    const roiSample = {
      avgR: r,
      avgG: g,
      avgB: b,
      pixelCount: 2200,
      satPct: 0.5,
      meanLum: 0.299 * r + 0.587 * g + 0.114 * b
    };

    // Override extractRoisData on mock
    const originalExtract = engine.extractRoisData;
    engine.extractRoisData = () => ({
      forehead: { ...roiSample },
      leftCheek: { ...roiSample },
      rightCheek: { ...roiSample }
    });

    const isMoving = options.simulateMotion && (i % 60 < 6); // intermittent motion
    const motionData = {
      isNoisy: isMoving,
      normalizedMovement: isMoving ? 0.05 : 0.006
    };

    lastOutput = engine.processFrame(mockCtx, {}, ts, null, motionData);
    engine.extractRoisData = originalExtract;
  }

  return { lastOutput, checkinResult: engine.getCheckinFinalResult() };
}

test('RPPGEngine - Recovers 60 BPM with noise and slow brightness drift within 3 BPM', () => {
  const engine = new RPPGEngine({ windowDurationMs: 15000, minWindowDurationMs: 12000 });
  const { checkinResult } = feedSyntheticSequence(engine, 60, {
    durationSec: 15,
    driftRate: 0.4, // Slow baseline drift
    noiseAmp: 0.8
  });

  assert.equal(checkinResult.hasReading, true, 'Produces a valid reading');
  assert.ok(
    Math.abs(checkinResult.bpm - 60) <= 3,
    `Estimate ${checkinResult.bpm} BPM is within 3 BPM of target 60 BPM (drift + noise)`
  );
  assert.ok(['Good', 'Fair'].includes(checkinResult.confidenceWord));
});

test('RPPGEngine - Recovers 72 BPM with small motion artifacts within 3 BPM', () => {
  const engine = new RPPGEngine({ windowDurationMs: 15000, minWindowDurationMs: 12000 });
  const { checkinResult } = feedSyntheticSequence(engine, 72, {
    durationSec: 15,
    simulateMotion: true,
    noiseAmp: 1.0
  });

  assert.equal(checkinResult.hasReading, true, 'Produces reading under intermittent motion');
  assert.ok(
    Math.abs(checkinResult.bpm - 72) <= 3,
    `Estimate ${checkinResult.bpm} BPM is within 3 BPM of target 72 BPM`
  );
});

test('RPPGEngine - Recovers 90 BPM with timestamp jitter and missing frames within 3 BPM', () => {
  const engine = new RPPGEngine({ windowDurationMs: 15000, minWindowDurationMs: 12000 });
  const { checkinResult } = feedSyntheticSequence(engine, 90, {
    durationSec: 15,
    jitter: true,
    motionDropRatio: 0.05, // 5% dropped frames
    noiseAmp: 0.7
  });

  assert.equal(checkinResult.hasReading, true, 'Produces reading with jitter and missing frames');
  assert.ok(
    Math.abs(checkinResult.bpm - 90) <= 3,
    `Estimate ${checkinResult.bpm} BPM is within 3 BPM of target 90 BPM`
  );
});

test('RPPGEngine - Recovers 120 BPM within 3 BPM', () => {
  const engine = new RPPGEngine({ windowDurationMs: 15000, minWindowDurationMs: 12000 });
  const { checkinResult } = feedSyntheticSequence(engine, 120, {
    durationSec: 15,
    noiseAmp: 0.6
  });

  assert.equal(checkinResult.hasReading, true, 'Produces valid reading at high rate (120 BPM)');
  assert.ok(
    Math.abs(checkinResult.bpm - 120) <= 3,
    `Estimate ${checkinResult.bpm} BPM is within 3 BPM of target 120 BPM`
  );
});

test('RPPGEngine - Pure noise produces NO reading (fails minimum SNR)', () => {
  const engine = new RPPGEngine({ windowDurationMs: 15000, minWindowDurationMs: 12000 });
  const fs = 30;
  const durationSec = 15;
  const rng = createRng(999);
  const totalFrames = Math.round(durationSec * fs);

  const mockCtx = { canvas: { width: 640, height: 480 }, getImageData: () => ({ data: new Uint8ClampedArray(10) }) };

  for (let i = 0; i < totalFrames; i++) {
    const ts = i * 33.333;
    // Pure random noise, no cardiac sinusoidal component
    const r = 210 + rng() * 6.0;
    const g = 170 + rng() * 6.0;
    const b = 145 + rng() * 6.0;

    const roiSample = {
      avgR: r,
      avgG: g,
      avgB: b,
      pixelCount: 2000,
      satPct: 0.1,
      meanLum: 0.299 * r + 0.587 * g + 0.114 * b
    };

    engine.extractRoisData = () => ({
      forehead: { ...roiSample },
      leftCheek: { ...roiSample },
      rightCheek: { ...roiSample }
    });

    engine.processFrame(mockCtx, {}, ts, null, null);
  }

  const finalRes = engine.getCheckinFinalResult();
  assert.equal(finalRes.hasReading, false, 'Pure noise produces NO reading');
  assert.equal(finalRes.bpm, null, 'BPM is null on pure noise');
  assert.equal(finalRes.reasonCode, 'LOW_SNR', 'Reason code is LOW_SNR');
});
