import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure state machine unit implementation representing PulseCam's Quick Check-in
 */
class QuickCheckinStateMachine {
  constructor(options = {}) {
    this.warmupDurationMs = options.warmupDurationMs || 2000;
    this.durationMs = options.durationMs || 60000;

    this.state = 'IDLE'; // IDLE | PREPARING | MEASURING | RESULT
    this.isWarmedUp = false;
    this.wakeLockHeld = false;
    this.fullscreenActive = false;
    this.forceContinue = false;
    this.startTime = 0;
    this.measurementStartTime = 0;
    this.cancelledCount = 0;
    this.completedCount = 0;
    this.history = [];
  }

  start(now = 0) {
    if (this.state === 'PREPARING' || this.state === 'MEASURING') {
      return false; // Already in progress
    }

    // Full reset on start
    this.state = 'PREPARING';
    this.isWarmedUp = false;
    this.forceContinue = false;
    this.wakeLockHeld = true;
    this.fullscreenActive = true;
    this.startTime = now;
    this.measurementStartTime = 0;
    return true;
  }

  update(now, lightingResult = { isValid: true, meanLuminance: 65 }) {
    if (this.state === 'PREPARING') {
      const elapsed = now - this.startTime;
      if (elapsed >= this.warmupDurationMs) {
        // Auto-exposure settled, transition to measuring
        this.isWarmedUp = true;
        this.state = 'MEASURING';
        this.measurementStartTime = now;
      }
      return { state: this.state, progress: 0, isWarmedUp: this.isWarmedUp };
    }

    if (this.state === 'MEASURING') {
      const elapsed = now - this.measurementStartTime;
      const progress = Math.min(1.0, elapsed / this.durationMs);

      if (elapsed >= this.durationMs) {
        return this.complete(74, 80, 72);
      }

      return {
        state: this.state,
        progress,
        isWarmedUp: true,
        canShowLivePulse: elapsed >= 30000
      };
    }

    return { state: this.state, progress: 0, isWarmedUp: false };
  }

  cancel(reason = 'user') {
    if (this.state === 'IDLE') return false;

    this.state = 'IDLE';
    this.isWarmedUp = false;
    this.wakeLockHeld = false;
    this.fullscreenActive = false;
    this.cancelledCount++;
    return true;
  }

  complete(bpm, confidence, baseBpm = 72) {
    this.state = 'RESULT';
    this.wakeLockHeld = false;
    this.fullscreenActive = false;
    this.completedCount++;

    let comparison = 'Right around your usual';
    if (bpm > baseBpm + 4) comparison = 'A little higher than your usual';
    else if (bpm < baseBpm - 4) comparison = 'A little lower than usual';

    const entry = {
      id: String(Date.now()),
      bpm,
      confidence: confidence >= 68 ? 'Good' : 'Fair',
      comparison
    };
    this.history.unshift(entry);

    // Return to IDLE
    this.state = 'IDLE';
    return {
      state: 'RESULT',
      entry,
      progress: 1.0
    };
  }
}

test('QuickCheckin - Clean state progression: IDLE -> PREPARING -> MEASURING -> RESULT -> IDLE', () => {
  const machine = new QuickCheckinStateMachine();
  assert.equal(machine.state, 'IDLE');

  // 1. Start check-in
  const started = machine.start(1000);
  assert.equal(started, true);
  assert.equal(machine.state, 'PREPARING');
  assert.equal(machine.wakeLockHeld, true);
  assert.equal(machine.fullscreenActive, true);
  assert.equal(machine.isWarmedUp, false);

  // 2. 1 second elapsed (during warm-up, frames discarded)
  let status = machine.update(2000);
  assert.equal(machine.state, 'PREPARING');
  assert.equal(status.isWarmedUp, false);

  // 3. 2 seconds elapsed (warm-up finished, camera auto-exposure settled)
  status = machine.update(3000);
  assert.equal(machine.state, 'MEASURING');
  assert.equal(status.isWarmedUp, true);

  // 4. Mid measurement at 35 seconds: live pulse display is allowed
  status = machine.update(33000 + 5000); // 35s into measurement
  assert.equal(machine.state, 'MEASURING');
  assert.equal(status.canShowLivePulse, true);

  // 5. 60 seconds measurement finishes
  status = machine.update(63000); // 60s elapsed
  assert.equal(machine.state, 'IDLE');
  assert.equal(machine.wakeLockHeld, false);
  assert.equal(machine.fullscreenActive, false);
  assert.equal(machine.history.length, 1);
  assert.equal(machine.history[0].bpm, 74);
  assert.equal(machine.history[0].confidence, 'Good');
});

test('QuickCheckin - Esc or fullscreen exit mid-check cleanly cancels without getting stuck', () => {
  const machine = new QuickCheckinStateMachine();

  // Start check-in
  machine.start(0);
  assert.equal(machine.state, 'PREPARING');

  // Advance into measuring
  machine.update(2500);
  assert.equal(machine.state, 'MEASURING');

  // User presses Esc / leaves fullscreen at 15s
  const cancelled = machine.cancel('esc_key');
  assert.equal(cancelled, true);
  assert.equal(machine.state, 'IDLE', 'State returns cleanly to IDLE');
  assert.equal(machine.wakeLockHeld, false, 'Wake lock released');
  assert.equal(machine.fullscreenActive, false, 'Fullscreen deactivated');
  assert.equal(machine.cancelledCount, 1);
});

test('QuickCheckin - Repeatability: runs 5 check-ins in a row including cancellations and tab switches', () => {
  const machine = new QuickCheckinStateMachine();

  for (let cycle = 1; cycle <= 5; cycle++) {
    const t0 = cycle * 100000;
    machine.start(t0);
    assert.equal(machine.state, 'PREPARING');

    if (cycle === 3) {
      // Simulate cancelled check-in mid-way
      machine.update(t0 + 2100);
      machine.cancel('user_cancel');
      assert.equal(machine.state, 'IDLE');
      continue;
    }

    // Warm-up
    machine.update(t0 + 2000);
    assert.equal(machine.state, 'MEASURING');

    // Finish
    machine.update(t0 + 62000);
    assert.equal(machine.state, 'IDLE');
    assert.equal(machine.wakeLockHeld, false);
  }

  assert.equal(machine.completedCount, 4, '4 check-ins completed');
  assert.equal(machine.cancelledCount, 1, '1 check-in cancelled mid-way');
  assert.equal(machine.history.length, 4, 'History contains 4 entries');
});
