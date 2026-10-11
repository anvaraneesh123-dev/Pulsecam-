import test from 'node:test';
import assert from 'node:assert/strict';
import { BlinkTracker } from '../src/modules/blink.js';

/**
 * Helper to construct synthetic 468-point landmarks with controlled EAR
 * @param {number} ear - Target Eye Aspect Ratio (e.g. 0.30 for open, 0.12 for closed)
 * @param {number} [jitterOffset=0] - Offset to simulate landmark jitter (glasses glare)
 */
function createSyntheticLandmarks(ear = 0.30, jitterOffset = 0) {
  const landmarks = new Array(468).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));

  const horizontal = 0.08; // Eye width in normalized space
  const halfV = ear * horizontal; // vertical = 2 * halfV, so (2*halfV + 2*halfV)/(2*horizontal) = 2*halfV/horizontal = 2*ear*horizontal/horizontal = 2*ear? Wait:
  // calculateEAR: vertical1 = dist(p2, p6), vertical2 = dist(p3, p5), horizontal = dist(p1, p4)
  // EAR = (vertical1 + vertical2) / (2 * horizontal)
  // Let vertical1 = vertical2 = v
  // EAR = 2 * v / (2 * horizontal) = v / horizontal.
  // So v = ear * horizontal.
  const v = ear * horizontal;

  // Left Eye: [33 (p1, outer), 160 (p2, top1), 158 (p3, top2), 133 (p4, inner), 153 (p5, bottom2), 144 (p6, bottom1)]
  const cxL = 0.40 + jitterOffset;
  const cyL = 0.35 + jitterOffset;
  landmarks[33] = { x: cxL - horizontal / 2, y: cyL, z: 0 };
  landmarks[133] = { x: cxL + horizontal / 2, y: cyL, z: 0 };
  landmarks[160] = { x: cxL - horizontal / 4, y: cyL - v / 2, z: 0 };
  landmarks[144] = { x: cxL - horizontal / 4, y: cyL + v / 2, z: 0 };
  landmarks[158] = { x: cxL + horizontal / 4, y: cyL - v / 2, z: 0 };
  landmarks[153] = { x: cxL + horizontal / 4, y: cyL + v / 2, z: 0 };

  // Right Eye: [362 (p1, inner), 385 (p2, top1), 387 (p3, top2), 263 (p4, outer), 373 (p5, bottom2), 380 (p6, bottom1)]
  const cxR = 0.60;
  const cyR = 0.35;
  landmarks[362] = { x: cxR - horizontal / 2, y: cyR, z: 0 };
  landmarks[263] = { x: cxR + horizontal / 2, y: cyR, z: 0 };
  landmarks[385] = { x: cxR - horizontal / 4, y: cyR - v / 2, z: 0 };
  landmarks[380] = { x: cxR - horizontal / 4, y: cyR + v / 2, z: 0 };
  landmarks[387] = { x: cxR + horizontal / 4, y: cyR - v / 2, z: 0 };
  landmarks[373] = { x: cxR + horizontal / 4, y: cyR + v / 2, z: 0 };

  return landmarks;
}

test('BlinkTracker - Derives personal thresholds from calibration baseline', () => {
  const tracker = new BlinkTracker();
  tracker.setPersonalBaseline(0.32);

  assert.equal(tracker.personalBaselineEAR, 0.32);
  // Blink threshold is 72% of baseline: 0.32 * 0.72 = 0.2304 -> 0.230
  assert.equal(tracker.personalBlinkThreshold, 0.23);
  // PERCLOS threshold is 75% of baseline: 0.32 * 0.75 = 0.240
  assert.equal(tracker.personalPerclosThreshold, 0.24);
});

test('BlinkTracker - Detects valid blink (3 consecutive frames below threshold)', () => {
  const tracker = new BlinkTracker({ baselineEAR: 0.30 });
  let t = 1000;

  // 1. Initial 15 frames with open eyes (EAR = 0.30)
  for (let i = 0; i < 15; i++) {
    t += 33.3;
    tracker.process(createSyntheticLandmarks(0.30), t);
  }
  assert.equal(tracker.totalBlinks, 0, 'No blinks during open eye resting period');

  // 2. 3 frames below threshold (EAR = 0.12 < 0.216)
  for (let i = 0; i < 3; i++) {
    t += 33.3;
    tracker.process(createSyntheticLandmarks(0.12), t);
  }
  assert.equal(tracker.totalBlinks, 0, 'Blink in progress; not counted until eye re-opens');

  // 3. Eye re-opens (EAR = 0.30)
  for (let i = 0; i < 5; i++) {
    t += 33.3;
    tracker.process(createSyntheticLandmarks(0.30), t);
  }

  assert.equal(tracker.totalBlinks, 1, 'Valid 3-frame blink detected upon eye re-opening');
  assert.equal(tracker.lastBlinkFrames, 3, 'Recorded blink duration is 3 frames');
});

test('BlinkTracker - Rejects 1-frame optical noise flutter as not a blink', () => {
  const tracker = new BlinkTracker({ baselineEAR: 0.30 });
  let t = 2000;

  for (let i = 0; i < 10; i++) {
    t += 33.3;
    tracker.process(createSyntheticLandmarks(0.30), t);
  }

  // 1 single frame dip
  t += 33.3;
  tracker.process(createSyntheticLandmarks(0.12), t);

  // Immediate reopen
  for (let i = 0; i < 10; i++) {
    t += 33.3;
    tracker.process(createSyntheticLandmarks(0.30), t);
  }

  assert.equal(tracker.totalBlinks, 0, '1-frame optical flutter rejected');
});

test('BlinkTracker - Flags prolonged closure (>6 frames) as micro-sleep, not a quick blink', () => {
  const tracker = new BlinkTracker({ baselineEAR: 0.30 });
  let t = 3000;

  for (let i = 0; i < 10; i++) {
    t += 33.3;
    tracker.process(createSyntheticLandmarks(0.30), t);
  }

  // 9 consecutive closed frames (> 6 frames)
  for (let i = 0; i < 9; i++) {
    t += 33.3;
    tracker.process(createSyntheticLandmarks(0.12), t);
  }

  // Re-open
  for (let i = 0; i < 10; i++) {
    t += 33.3;
    tracker.process(createSyntheticLandmarks(0.30), t);
  }

  assert.equal(tracker.totalBlinks, 0, 'Prolonged closure does not register as a quick blink');
  assert.equal(tracker.prolongedClosureCount, 1, 'Prolonged closure recorded');
});

test('BlinkTracker - Detects landmark jitter and lowers confidence to prevent spurious blinks', () => {
  const tracker = new BlinkTracker({ baselineEAR: 0.30 });
  let t = 4000;

  for (let i = 0; i < 10; i++) {
    t += 33.3;
    // Alternate jitter offset rapidly to simulate glasses rim glare or tracking instability
    const jitter = i % 2 === 0 ? 0.04 : -0.04;
    tracker.process(createSyntheticLandmarks(0.30, jitter), t);
  }

  assert.ok(
    tracker.ocularConfidence < 60,
    `Ocular confidence ${tracker.ocularConfidence}% dropped due to landmark jitter`
  );
});
