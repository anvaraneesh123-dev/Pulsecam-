/**
 * PulseCam - Head Motion & Optical Stability Tracker Module
 * Computes:
 * 1. Inter-Ocular Distance (IOD) between outer eye canthi.
 * 2. Frame-to-frame facial landmark displacement normalized by IOD.
 * 3. Head pose angles (Pitch, Yaw, Roll in degrees).
 * 4. Noisy frame filtering with threshold gating for pulse extraction.
 * 5. Rolling 10-second sliding window discard rate and low-confidence classification.
 */

export class HeadMotionTracker {
  /**
   * @param {Object} [options]
   * @param {number} [options.movementThreshold=0.035] - Displacement threshold normalized by IOD (3.5% IOD)
   * @param {number} [options.windowDurationMs=10000] - Sliding window duration (10 seconds)
   * @param {number} [options.lowConfidenceThreshold=0.40] - Discard ratio marking window low-confidence (40%)
   */
  constructor(options = {}) {
    this.movementThreshold = options.movementThreshold !== undefined ? options.movementThreshold : 0.035;
    this.windowDurationMs = options.windowDurationMs || 10000;
    this.lowConfidenceThreshold = options.lowConfidenceThreshold !== undefined ? options.lowConfidenceThreshold : 0.40;

    this.prevLandmarks = null;
    this.windowRecords = []; // Array of { timestamp, isDiscarded, normalizedMovement }

    // Prominent facial landmarks for robust tracking
    this.LEFT_EYE_OUTER = 263;
    this.RIGHT_EYE_OUTER = 33;
    this.NOSE_TIP = 1;
    this.CHIN = 152;
    this.FOREHEAD_TOP = 10;
    this.TEMPLE_LEFT = 234;
    this.TEMPLE_RIGHT = 454;
  }

  reset() {
    this.prevLandmarks = null;
    this.windowRecords = [];
  }

  /**
   * Compute Inter-Ocular Distance (IOD) in pixels
   * @param {Array} landmarks - 468 landmark array
   * @param {number} width - Frame width
   * @param {number} height - Frame height
   * @returns {number} Distance in pixels
   */
  computeIOD(landmarks, width, height) {
    if (!landmarks || landmarks.length === 0) return width * 0.18;

    const left = landmarks[this.LEFT_EYE_OUTER];
    const right = landmarks[this.RIGHT_EYE_OUTER];

    if (!left || !right) return width * 0.18;

    const dx = (left.x - right.x) * width;
    const dy = (left.y - right.y) * height;
    const iod = Math.hypot(dx, dy);

    // Guard against degenerate / zero distances
    return Math.max(15, iod);
  }

  /**
   * Compute average frame-to-frame landmark displacement in pixels
   * @param {Array} landmarks
   * @param {Array} prevLandmarks
   * @param {number} width
   * @param {number} height
   * @returns {number} Mean displacement in pixels
   */
  computeDisplacement(landmarks, prevLandmarks, width, height) {
    if (!prevLandmarks || prevLandmarks.length === 0 || !landmarks || landmarks.length === 0) {
      return 0;
    }

    const count = Math.min(landmarks.length, prevLandmarks.length);
    if (count === 0) return 0;

    let totalDist = 0;
    // Step by 3 across 468 landmarks for high precision + ultra-fast execution (< 0.02ms)
    let sampled = 0;
    for (let i = 0; i < count; i += 3) {
      const p1 = landmarks[i];
      const p2 = prevLandmarks[i];
      if (p1 && p2) {
        const dx = (p1.x - p2.x) * width;
        const dy = (p1.y - p2.y) * height;
        totalDist += Math.hypot(dx, dy);
        sampled++;
      }
    }

    return sampled > 0 ? totalDist / sampled : 0;
  }

  /**
   * Compute head pose angles (Yaw, Pitch, Roll in degrees)
   * @param {Array} landmarks
   * @returns {{ yaw: number, pitch: number, roll: number }}
   */
  computeHeadPose(landmarks) {
    if (!landmarks || landmarks.length < 468) {
      return { yaw: 0, pitch: 0, roll: 0 };
    }

    const nose = landmarks[this.NOSE_TIP];
    const leftTemple = landmarks[this.TEMPLE_LEFT];
    const rightTemple = landmarks[this.TEMPLE_RIGHT];
    const foreheadTop = landmarks[this.FOREHEAD_TOP];
    const chin = landmarks[this.CHIN];

    if (!nose || !leftTemple || !rightTemple || !foreheadTop || !chin) {
      return { yaw: 0, pitch: 0, roll: 0 };
    }

    // Yaw: asymmetry between nose to left vs right temple
    const distToLeft = Math.abs(nose.x - leftTemple.x);
    const distToRight = Math.abs(rightTemple.x - nose.x);
    const yaw = ((distToRight - distToLeft) / (distToLeft + distToRight || 0.001)) * 90;

    // Pitch: vertical offset of nose relative to midline
    const midY = (foreheadTop.y + chin.y) / 2;
    const pitch = (nose.y - midY) * 90;

    // Roll: angle of temple-to-temple vector
    const dX = rightTemple.x - leftTemple.x;
    const dY = rightTemple.y - leftTemple.y;
    const roll = Math.atan2(dY, dX) * (180 / Math.PI);

    return {
      yaw: Math.round(yaw * 10) / 10,
      pitch: Math.round(pitch * 10) / 10,
      roll: Math.round(roll * 10) / 10
    };
  }

  /**
   * Process a frame's landmarks, evaluate movement, threshold discarding, and window confidence
   * @param {Array} landmarks - 468 landmarks
   * @param {number} width - Frame width
   * @param {number} height - Frame height
   * @param {number} timestamp - Current timestamp in ms
   */
  process(landmarks, width, height, timestamp = performance.now()) {
    if (!landmarks || landmarks.length === 0) {
      // Discard when face is missing
      this.windowRecords.push({
        timestamp,
        isDiscarded: true,
        normalizedMovement: 1.0
      });
      this._pruneWindow(timestamp);

      const stats = this._calculateWindowStats();
      return {
        iod: 0,
        displacement: 0,
        normalizedMovement: 0,
        threshold: this.movementThreshold,
        isNoisy: true,
        isDiscarded: true,
        headPose: { yaw: 0, pitch: 0, roll: 0 },
        reason: 'Face not detected',
        windowStability: stats
      };
    }

    // 1. Inter-Ocular Distance
    const iod = this.computeIOD(landmarks, width, height);

    // 2. Head Movement (normalized by IOD)
    const displacement = this.computeDisplacement(landmarks, this.prevLandmarks, width, height);
    const normalizedMovement = iod > 0 ? displacement / iod : 0;

    // 3. Head Pose Angles
    const headPose = this.computeHeadPose(landmarks);

    // 4. Movement Threshold Evaluation
    // If movement is >= threshold, mark frame as noisy and discard
    const isNoisy = normalizedMovement >= this.movementThreshold;
    const isDiscarded = isNoisy;

    // 5. Update 10-Second Sliding Window
    this.windowRecords.push({
      timestamp,
      isDiscarded,
      normalizedMovement
    });
    this._pruneWindow(timestamp);
    const windowStats = this._calculateWindowStats();

    // Cache current landmarks for next frame
    this.prevLandmarks = landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));

    return {
      iod: Math.round(iod * 10) / 10,
      displacement: Math.round(displacement * 100) / 100,
      normalizedMovement: Math.round(normalizedMovement * 1000) / 1000,
      threshold: this.movementThreshold,
      isNoisy,
      isDiscarded,
      headPose,
      reason: isNoisy ? `Head motion (${(normalizedMovement * 100).toFixed(1)}% IOD >= ${(this.movementThreshold * 100).toFixed(1)}% threshold)` : 'Stable',
      windowStability: windowStats
    };
  }

  _pruneWindow(currentTimestamp) {
    const cutoff = currentTimestamp - this.windowDurationMs;
    while (this.windowRecords.length > 0 && this.windowRecords[0].timestamp < cutoff) {
      this.windowRecords.shift();
    }
  }

  _calculateWindowStats() {
    const totalFrames = this.windowRecords.length;
    const discardedFrames = this.windowRecords.filter((r) => r.isDiscarded).length;
    const passedFrames = totalFrames - discardedFrames;
    const discardRate = totalFrames > 0 ? discardedFrames / totalFrames : 0;
    const discardPercentage = Math.round(discardRate * 100);

    // Mark window low-confidence if > 40% of frames in 10-second window are discarded
    // Require at least 15 frames (~0.5s of data) before applying window penalty
    const isLowConfidence = totalFrames >= 15 && discardRate > this.lowConfidenceThreshold;

    return {
      windowSeconds: 10,
      totalFrames,
      discardedFrames,
      passedFrames,
      discardRate: Math.round(discardRate * 1000) / 1000,
      discardPercentage,
      isLowConfidence,
      confidenceStatus: isLowConfidence ? 'LOW_CONFIDENCE' : 'CONFIDENT',
      thresholdPercent: Math.round(this.lowConfidenceThreshold * 100)
    };
  }
}
