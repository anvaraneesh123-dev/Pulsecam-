import test from 'node:test';
import assert from 'node:assert/strict';
import { LightingChecker } from '../src/modules/lightingCheck.js';

/**
 * Helper to build a mock canvas 2D context with synthetic pixel buffer
 */
function createMockContext(width, height, fillLumFn) {
  return {
    canvas: { width, height },
    getImageData(x, y, w, h) {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const idx = (py * w + px) * 4;
          const lum = fillLumFn(x + px, y + py);
          data[idx] = lum;     // R
          data[idx + 1] = lum; // G
          data[idx + 2] = lum; // B
          data[idx + 3] = 255; // Alpha
        }
      }
      return { data };
    }
  };
}

test('LightingChecker - Rejects completely black camera frame', () => {
  const checker = new LightingChecker();
  const ctx = createMockContext(640, 480, () => 0); // 0 lux
  const roi = { x: 200, y: 150, width: 240, height: 280 };

  const result = checker.evaluate(ctx, roi, 0.95, { mode: 'checkin' });
  assert.equal(result.isValid, false, 'Black frame is marked invalid');
  assert.equal(result.isBlackFrame, true, 'isBlackFrame flag is set');
  assert.equal(result.level, 'black-frame', 'Level is black-frame');
});

test('LightingChecker - Rejects synthetic dark frame (< 22 lux in check-in mode)', () => {
  const checker = new LightingChecker();
  // Generate pixels around 12 lux with slight variance
  const ctx = createMockContext(640, 480, (x, y) => 12 + ((x + y) % 4));
  const roi = { x: 200, y: 150, width: 240, height: 280 };

  const result = checker.evaluate(ctx, roi, 0.95, { mode: 'checkin' });
  assert.equal(result.isValid, false, 'Dark frame is marked invalid');
  assert.equal(result.isTooDark, true, 'isTooDark is true');
  assert.ok(result.meanLuminance < 22, `Mean luminance ${result.meanLuminance} is below check-in threshold 22`);
  assert.equal(result.debug.darkThreshold, 22, 'Check-in threshold used is 22 lux');
});

test('LightingChecker - Passes synthetic normal frame (85 lux with good variance in check-in mode)', () => {
  const checker = new LightingChecker();
  // Generate realistic facial skin illumination ~85 lux with textural variance
  const ctx = createMockContext(640, 480, (x, y) => 85 + (x % 16) - 8);
  const roi = { x: 200, y: 150, width: 240, height: 280 };

  const result = checker.evaluate(ctx, roi, 0.95, { mode: 'checkin' });
  assert.equal(result.isValid, true, 'Normal frame is marked valid in check-in mode');
  assert.equal(result.isTooDark, false, 'isTooDark is false');
  assert.equal(result.isOverexposed, false, 'isOverexposed is false');
  assert.ok(result.meanLuminance >= 75 && result.meanLuminance <= 95, 'Luminance in normal range');
});

test('LightingChecker - Rejects synthetic overexposed frame (> 232 lux in check-in mode)', () => {
  const checker = new LightingChecker();
  const ctx = createMockContext(640, 480, (x, y) => 245 + (x % 5));
  const roi = { x: 200, y: 150, width: 240, height: 280 };

  const result = checker.evaluate(ctx, roi, 0.95, { mode: 'checkin' });
  assert.equal(result.isValid, false, 'Overexposed frame is marked invalid');
  assert.equal(result.isOverexposed, true, 'isOverexposed flag is set');
});

test('LightingChecker - Adaptive threshold: 30 lux passes in check-in mode but fails in standard mode', () => {
  const checkerNormal = new LightingChecker();
  const checkerCheckin = new LightingChecker();

  // Synthetic frame around 30 lux (subdued screen lighting) with sufficient texture
  const ctx = createMockContext(640, 480, (x, y) => 30 + ((x * 3 + y * 7) % 18) - 9);
  const roi = { x: 200, y: 150, width: 240, height: 280 };

  // In normal mode: threshold is 45 lux -> fails
  const normalResult = checkerNormal.evaluate(ctx, roi, 0.95, { mode: 'normal' });
  assert.equal(normalResult.isValid, false, '30 lux fails in normal ambient mode (threshold 45)');
  assert.equal(normalResult.isTooDark, true, 'isTooDark is true in normal mode');

  // In check-in mode: threshold is 22 lux -> passes
  const checkinResult = checkerCheckin.evaluate(ctx, roi, 0.95, { mode: 'checkin' });
  assert.equal(checkinResult.isValid, true, '30 lux passes in check-in mode (threshold 22)');
  assert.equal(checkinResult.isTooDark, false, 'isTooDark is false in check-in mode');
});

test('LightingChecker - Temporal smoothing buffers frames and resetHistory clears them', () => {
  const checker = new LightingChecker();
  const darkCtx = createMockContext(640, 480, () => 10);
  const brightCtx = createMockContext(640, 480, (x, y) => 100 + (x % 10));
  const roi = { x: 200, y: 150, width: 240, height: 280 };

  // Feed 10 dark frames
  for (let i = 0; i < 10; i++) {
    checker.evaluate(darkCtx, roi, 0.9, { mode: 'checkin' });
  }
  assert.equal(checker.history.length, 10, 'History has 10 samples');

  // Reset history
  checker.resetHistory();
  assert.equal(checker.history.length, 0, 'History successfully reset');

  // New frame is not dragged down by past dark frames
  const res = checker.evaluate(brightCtx, roi, 0.9, { mode: 'checkin' });
  assert.ok(res.meanLuminance > 90, 'Mean luminance responds cleanly after reset');
});
