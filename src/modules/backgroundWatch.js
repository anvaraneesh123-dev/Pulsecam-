/**
 * PulseCam - Background Watch Module
 * Lightweight ocular and behavioral fatigue telemetry designed to run intermittently (duty cycle)
 * without rPPG/heart-rate analysis or facial image retention.
 *
 * Cues evaluated:
 * 1. Blink rate and eye-closure duration relative to user personal baseline
 * 2. Yawn detection (sustained mouth opening)
 * 3. Head droop / nod (sustained or rhythmic downward pitch)
 * 4. Gaze drift (frequent looking away from screen)
 * 5. Brow furrow (mild effort / strain cue)
 *
 * Discard rule:
 * If no face is visible or user is clearly looking at another monitor, pause and discard the window;
 * never count it as fatigue.
 *
 * States output per window: 'Fresh' | 'Getting tired' | 'Tired' (with confidence).
 * Strictly zero emotion labels or emotion classification.
 */

// Key MediaPipe Face Landmark Indices
const LIP_TOP = 13;
const LIP_BOTTOM = 14;
const FOREHEAD_TOP = 10;
const CHIN_BOTTOM = 152;
const BROW_LEFT = 55;
const BROW_RIGHT = 285;
const IRIS_LEFT_CENTER = 468;
const IRIS_RIGHT_CENTER = 473;
const EYE_OUTER_LEFT = 263;
const EYE_INNER_LEFT = 362;
const EYE_OUTER_RIGHT = 33;
const EYE_INNER_RIGHT = 133;

export class BackgroundWatchEngine {
  constructor(options = {}) {
    this.windowDurationMs = options.windowDurationMs || 30000; // 30 seconds analysis window
    this.cycleIntervalMs = options.cycleIntervalMs || 180000;  // 3 minutes duty cycle interval
    this.minFps = options.minFps || 15;

    this.isEnabled = true;
    this.isWindowActive = false;
    this.windowStartTime = 0;
    this.lastCycleStartTime = 0;

    // Window accumulators
    this.windowFrames = 0;
    this.faceDetectedFrames = 0;
    this.monitorDiversionFrames = 0;
    this.mouthOpenFrames = 0;
    this.yawnCount = 0;
    this.droopFrames = 0;
    this.furrowFrames = 0;
    this.driftFrames = 0;

    // Blink & eye-closure tracking inside window
    this.windowBlinkCount = 0;
    this.windowClosedFrames = 0;

    // Rolling window history for persistence check (alert only when sustained)
    this.history = [];
    this.maxHistory = 6;

    // Current output state
    this.latestState = {
      state: 'Fresh',
      confidence: 75,
      activeWindow: false,
      windowProgress: 0,
      secondsToNextWindow: 0,
      discarded: false,
      discardReason: null,
      cues: {
        yawnCount: 0,
        perclos: 0,
        blinkRate: 16,
        headDroop: false,
        browFurrow: false,
        gazeDrift: false
      }
    };
  }

  setEnabled(enabled) {
    this.isEnabled = Boolean(enabled);
    if (!this.isEnabled) {
      this.isWindowActive = false;
      this.windowFrames = 0;
    }
  }

  setDutyCycle(windowDurationSec, intervalMinutes) {
    if (windowDurationSec > 0) this.windowDurationMs = windowDurationSec * 1000;
    if (intervalMinutes > 0) this.cycleIntervalMs = intervalMinutes * 60 * 1000;
  }

  /**
   * Check if a duty cycle window should be active at timestamp
   */
  updateSchedule(timestamp) {
    if (!this.isEnabled) {
      this.isWindowActive = false;
      return false;
    }

    if (!this.lastCycleStartTime) {
      this.lastCycleStartTime = timestamp;
      this.startNewWindow(timestamp);
      return true;
    }

    const elapsedSinceCycle = timestamp - this.lastCycleStartTime;

    if (this.isWindowActive) {
      const windowElapsed = timestamp - this.windowStartTime;
      if (windowElapsed >= this.windowDurationMs) {
        // Window finished: finalize window evaluation
        this.finalizeWindow();
        this.isWindowActive = false;
      }
    } else {
      if (elapsedSinceCycle >= this.cycleIntervalMs) {
        this.lastCycleStartTime = timestamp;
        this.startNewWindow(timestamp);
      }
    }

    // Update countdown to next window for UI transparency
    const nextStart = this.lastCycleStartTime + this.cycleIntervalMs;
    const remainingMs = Math.max(0, nextStart - timestamp);
    this.latestState.secondsToNextWindow = Math.round(remainingMs / 1000);
    this.latestState.activeWindow = this.isWindowActive;
    if (this.isWindowActive) {
      this.latestState.windowProgress = Math.min(1.0, (timestamp - this.windowStartTime) / this.windowDurationMs);
    } else {
      this.latestState.windowProgress = 0;
    }

    return this.isWindowActive;
  }

  startNewWindow(timestamp) {
    this.isWindowActive = true;
    this.windowStartTime = timestamp;
    this.windowFrames = 0;
    this.faceDetectedFrames = 0;
    this.monitorDiversionFrames = 0;
    this.mouthOpenFrames = 0;
    this.yawnCount = 0;
    this.droopFrames = 0;
    this.furrowFrames = 0;
    this.driftFrames = 0;
    this.windowBlinkCount = 0;
    this.windowClosedFrames = 0;
  }

  /**
   * Process a single frame during an active duty-cycle window.
   * Gated strictly to ocular/postural cues. Never touches rPPG.
   */
  processFrame({
    landmarks,
    headPose,
    blinkResult,
    faceDetected,
    timestamp,
    baseline
  }) {
    if (!this.isWindowActive) return null;

    this.windowFrames++;

    if (!faceDetected || !landmarks) {
      return null;
    }

    this.faceDetectedFrames++;

    const pose = headPose || { yaw: 0, pitch: 0, roll: 0 };

    // 1. Monitor Diversion Check:
    // If head yaw is clearly turned away (|yaw| > 26°), user is looking at another monitor.
    const isLookingAtOtherMonitor = Math.abs(pose.yaw) > 26;
    if (isLookingAtOtherMonitor) {
      this.monitorDiversionFrames++;
      this.driftFrames++;
    }

    // 2. Gaze drift / frequent looking away:
    // Head yaw between 16° and 26° or eye off-center
    if (Math.abs(pose.yaw) > 16) {
      this.driftFrames++;
    }

    // 3. Head Droop / Nodding Cue:
    // Baseline pitch is typically -2° to 5°. Pitch < -12° indicates downward slouch / droop.
    const isDrooping = pose.pitch < -12;
    if (isDrooping) {
      this.droopFrames++;
    }

    // 4. Yawn Detection (sustained mouth opening):
    // Vertical mouth opening ratio normalized by face height
    if (landmarks[LIP_TOP] && landmarks[LIP_BOTTOM] && landmarks[FOREHEAD_TOP] && landmarks[CHIN_BOTTOM]) {
      const mouthHeight = Math.abs(landmarks[LIP_BOTTOM].y - landmarks[LIP_TOP].y);
      const faceHeight = Math.abs(landmarks[CHIN_BOTTOM].y - landmarks[FOREHEAD_TOP].y);
      const mouthRatio = faceHeight > 0.01 ? mouthHeight / faceHeight : 0;

      // Deep opening threshold > 0.16 of face height indicates wide open mouth
      if (mouthRatio > 0.16) {
        this.mouthOpenFrames++;
        // If mouth opening persists for ~1.5s (~25 frames at 18fps), register a yawn
        if (this.mouthOpenFrames === 25) {
          this.yawnCount++;
        }
      } else {
        this.mouthOpenFrames = Math.max(0, this.mouthOpenFrames - 2);
      }
    }

    // 5. Brow Furrow (mild effort / strain cue):
    // Distance between inner eyebrows normalized by face width
    if (landmarks[BROW_LEFT] && landmarks[BROW_RIGHT] && landmarks[CHIN_BOTTOM] && landmarks[FOREHEAD_TOP]) {
      const browDist = Math.abs(landmarks[BROW_RIGHT].x - landmarks[BROW_LEFT].x);
      const faceHeight = Math.abs(landmarks[CHIN_BOTTOM].y - landmarks[FOREHEAD_TOP].y);
      const browRatio = faceHeight > 0.01 ? browDist / faceHeight : 0.3;

      // Personal baseline or normative compressed brow distance
      const baselineBrowRatio = (baseline && baseline.browRatio) ? baseline.browRatio : 0.28;
      if (browRatio < baselineBrowRatio * 0.90) {
        this.furrowFrames++;
      }
    }

    // 6. Blink & Eye-Closure accumulation inside this window
    if (blinkResult) {
      if (blinkResult.isBlinking) {
        this.windowClosedFrames++;
      }
      if (blinkResult.blinkCount !== undefined) {
        this.windowBlinkCount = blinkResult.blinkCount;
      }
    }

    return this.latestState;
  }

  /**
   * Finalize the 30-second window:
   * Evaluate fatigue score, check discard criteria, classify state, and maintain rolling history.
   */
  finalizeWindow() {
    const totalFrames = Math.max(1, this.windowFrames);
    const facePresenceRatio = this.faceDetectedFrames / totalFrames;
    const diversionRatio = this.monitorDiversionFrames / totalFrames;

    // Discard rule:
    // "If no face is visible or the user is clearly looking at another monitor,
    //  pause and discard that window; never count it as fatigue."
    if (facePresenceRatio < 0.60 || diversionRatio > 0.35) {
      this.latestState = {
        state: this.latestState.state, // preserve previous state without penalizing
        confidence: 0,
        activeWindow: false,
        windowProgress: 0,
        secondsToNextWindow: Math.round(this.cycleIntervalMs / 1000),
        discarded: true,
        discardReason: facePresenceRatio < 0.60 ? 'no_face' : 'monitor_diversion',
        cues: Object.assign({}, this.latestState.cues)
      };
      return;
    }

    // Valid window: compute fatigue metrics
    const perclosRatio = this.faceDetectedFrames > 0
      ? (this.windowClosedFrames / this.faceDetectedFrames) * 100
      : 0;
    const droopRatio = this.droopFrames / this.faceDetectedFrames;
    const furrowRatio = this.furrowFrames / this.faceDetectedFrames;
    const driftRatio = this.driftFrames / this.faceDetectedFrames;

    // Fatigue scoring heuristics (0 - 100)
    let fatiguePoints = 0;

    // Eye closure / PERCLOS
    if (perclosRatio > 18) fatiguePoints += 38;
    else if (perclosRatio > 12) fatiguePoints += 22;
    else if (perclosRatio > 7) fatiguePoints += 10;

    // Yawns (very strong indicator of drowsiness)
    if (this.yawnCount >= 2) fatiguePoints += 40;
    else if (this.yawnCount === 1) fatiguePoints += 25;

    // Head droop
    if (droopRatio > 0.30) fatiguePoints += 25;
    else if (droopRatio > 0.15) fatiguePoints += 12;

    // Brow furrow (mild effort cue)
    if (furrowRatio > 0.35) fatiguePoints += 10;

    // Gaze drift (mild fatigue / distracted cue)
    if (driftRatio > 0.30) fatiguePoints += 8;

    fatiguePoints = Math.min(100, fatiguePoints);

    // Classification per window
    let windowState = 'Fresh';
    if (fatiguePoints >= 55) {
      windowState = 'Tired';
    } else if (fatiguePoints >= 25) {
      windowState = 'Getting tired';
    } else {
      windowState = 'Fresh';
    }

    // Confidence calculation (higher when frame delivery was stable and face clearly visible)
    const fps = (this.windowFrames * 1000) / this.windowDurationMs;
    let confidence = 75;
    if (fps >= 20) confidence += 15;
    else if (fps < 12) confidence -= 20;

    if (facePresenceRatio > 0.85) confidence += 10;
    confidence = Math.max(35, Math.min(95, confidence));

    // Append to rolling history
    this.history.push({
      timestamp: Date.now(),
      state: windowState,
      fatiguePoints,
      confidence,
      perclos: Math.round(perclosRatio),
      yawnCount: this.yawnCount
    });

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    this.latestState = {
      state: windowState,
      confidence,
      fatiguePoints,
      activeWindow: false,
      windowProgress: 0,
      secondsToNextWindow: Math.round(this.cycleIntervalMs / 1000),
      discarded: false,
      discardReason: null,
      cues: {
        yawnCount: this.yawnCount,
        perclos: Math.round(perclosRatio),
        headDroop: droopRatio > 0.20,
        browFurrow: furrowRatio > 0.25,
        gazeDrift: driftRatio > 0.25
      }
    };
  }

  /**
   * Determine whether a persistent tired alert should be triggered:
   * "alert only when confidence is high and the state persists across several windows."
   */
  shouldTriggerAlert() {
    if (this.history.length < 2) return false;

    // Check last 2-3 windows
    const recent = this.history.slice(-3);
    const allHighConfidence = recent.every((w) => w.confidence >= 65);
    const allTiredOrGettingTired = recent.every(
      (w) => w.state === 'Tired' || w.state === 'Getting tired'
    );
    const atLeastOneTired = recent.some((w) => w.state === 'Tired');

    return allHighConfidence && allTiredOrGettingTired && atLeastOneTired;
  }
}
