/**
 * PulseCam - Clinical-Heuristic Decision & Workload Estimation Engine
 *
 * Computes a 0–100 "Workload Estimate" derived from personal-baseline z-scores
 * with the following heuristic weights:
 * - 30% Heart-Rate Trend (autonomic arousal deviation)
 * - 30% Eye-Closure (PERCLOS & eyelid closure duration)
 * - 20% Blink-Pattern Change (suppression or compensatory flutter)
 * - 20% Head Movement / Posture (restlessness & forward pitch slump)
 * - Plus a small session-duration accumulation factor
 *
 * Output is clamped [0, 100] and smoothed with an EMA filter.
 *
 * DISCLAIMER & REGULATORY COMPLIANCE:
 * "These weights are heuristic estimates, not clinically validated."
 * Never uses the words "diagnose", "stress detection", or "burnout diagnosis".
 * Always provides an estimate with a confidence level.
 * When confidence is low, outputs:
 * "Measurements may be unreliable due to camera quality or lighting."
 */

export class ClinicalHeuristicsEngine {
  constructor() {
    this.smoothedWorkload = null;
    this.history = [];
  }

  /**
   * Reset smoothing state
   */
  reset() {
    this.smoothedWorkload = null;
    this.history = [];
  }

  /**
   * Evaluate multi-modal workload estimate and clinical cues
   * @param {Object} metrics
   * @param {number|null} metrics.bpm - Current heart rate
   * @param {number} [metrics.rppgConfidence=0] - SNR confidence of rPPG
   * @param {number|null} [metrics.hrv=null] - HRV RMSSD in ms
   * @param {number} [metrics.blinkRate=16] - Current blink rate per minute
   * @param {number} [metrics.perclos=0] - Current PERCLOS fraction (0.0 - 1.0)
   * @param {boolean} [metrics.isDrowsy=false] - Prolonged closure flag
   * @param {number} [metrics.prolongedClosures=0] - Count of prolonged closures
   * @param {number} [metrics.ocularConfidence=100] - Eye landmark tracking confidence
   * @param {Object} [metrics.headPose={ pitch: 0, yaw: 0, roll: 0 }] - Head pose in degrees
   * @param {number} [metrics.headMotion=0] - Normalized IOD displacement
   * @param {number} [metrics.motionStability=100] - Motion stability percentage
   * @param {number} [metrics.sqi=100] - Signal quality index
   * @param {boolean} [metrics.lightingValid=true] - Lighting check validity
   * @param {number} [metrics.elapsedSec=0] - Continuous session duration in seconds
   * @param {Object|null} [metrics.zScores=null] - Personal baseline deviations { bpm, blinkRate, ear, closureDuration, headMotion }
   * @param {Object|null} [metrics.activeBaseline=null] - Loaded personal baseline distributions
   */
  evaluate(metrics = {}) {
    const {
      bpm = null,
      rppgConfidence = 0,
      hrv = null,
      blinkRate = 16,
      perclos = 0,
      isDrowsy = false,
      prolongedClosures = 0,
      ocularConfidence = 100,
      headPose = { pitch: 0, yaw: 0, roll: 0 },
      headMotion = 0,
      motionStability = 100,
      sqi = 100,
      lightingValid = true,
      elapsedSec = 0,
      zScores = null,
      activeBaseline = null
    } = metrics;

    // =========================================================================
    // 1. COMPONENT 1: Heart-Rate Trend (Weight: 30%)
    // =========================================================================
    // Normal resting state is ~20 points. Positive z-scores reflect elevated
    // sympathetic tone / autonomic activation.
    let hrComponent = 20;
    const zBpm = zScores?.bpm ?? null;
    if (zBpm !== null) {
      // z = 0 -> 20, z = +1 -> 45, z = +2 -> 70, z = +3 -> 95
      hrComponent = Math.max(0, Math.min(100, 20 + zBpm * 25));
    } else if (bpm !== null && activeBaseline?.heartRate?.mean) {
      const deltaBpm = bpm - activeBaseline.heartRate.mean;
      hrComponent = Math.max(0, Math.min(100, 20 + (deltaBpm / 20) * 35));
    } else if (bpm !== null) {
      hrComponent = Math.max(0, Math.min(100, ((bpm - 55) / 50) * 50));
    }

    // =========================================================================
    // 2. COMPONENT 2: Eye-Closure (Weight: 30%)
    // =========================================================================
    // Evaluates PERCLOS (fraction of rolling window eyes are mostly closed)
    // and eyelid closure duration z-score.
    const zClosure = zScores?.closureDuration ?? 0;
    const perclosVal = typeof perclos === 'number' ? perclos : 0;
    let eyeClosureComponent = 10 + (perclosVal * 320) + Math.max(0, zClosure * 15);
    if (isDrowsy) eyeClosureComponent += 45;
    if (prolongedClosures > 1) eyeClosureComponent += 20;
    eyeClosureComponent = Math.max(0, Math.min(100, eyeClosureComponent));

    // =========================================================================
    // 3. COMPONENT 3: Blink-Pattern Change (Weight: 20%)
    // =========================================================================
    // Both screen stare fixation (negative z) and compensatory ocular flutter
    // (positive z) indicate cognitive/visual demand changes relative to baseline.
    const zBlink = zScores?.blinkRate ?? null;
    let blinkPatternComponent = 15;
    if (zBlink !== null) {
      // Deviation magnitude |z| drives workload alteration
      blinkPatternComponent = Math.max(0, Math.min(100, 15 + Math.abs(zBlink) * 28));
    } else {
      if (blinkRate < 10) blinkPatternComponent = 60;
      else if (blinkRate > 26) blinkPatternComponent = 55;
    }

    // =========================================================================
    // 4. COMPONENT 4: Head Movement / Posture (Weight: 20%)
    // =========================================================================
    // Evaluates restlessness (motion z-score) and downward forward pitch slump (> 10°).
    const zMotion = zScores?.headMotion ?? 0;
    const pitch = headPose?.pitch || 0;
    const pitchPenalty = Math.max(0, (pitch - 8) * 3.2); // Forward head slump / drowsiness nodding
    let headPostureComponent = 10 + Math.max(0, zMotion * 22) + pitchPenalty;
    headPostureComponent = Math.max(0, Math.min(100, headPostureComponent));

    // =========================================================================
    // 5. Session-Duration Accumulation Factor
    // =========================================================================
    // Prolonged uninterrupted screen focus gradually adds fatigue load:
    // ~0.2 points per elapsed minute, maxing out at +10 points after ~45 min.
    const elapsedMin = Math.max(0, elapsedSec / 60);
    const durationFactor = Math.min(10.0, Number((elapsedMin * 0.22).toFixed(1)));

    // =========================================================================
    // 6. Multi-Modal Synthesis & Smoothing
    // =========================================================================
    // Heuristic Weights:
    // 30% HR Trend + 30% Eye-Closure + 20% Blink-Pattern + 20% Head Posture + Duration
    const rawWorkload = Math.max(
      0,
      Math.min(
        100,
        0.30 * hrComponent +
        0.30 * eyeClosureComponent +
        0.20 * blinkPatternComponent +
        0.20 * headPostureComponent +
        durationFactor
      )
    );

    // Exponential Moving Average (EMA) smoothing (alpha = 0.08)
    if (this.smoothedWorkload === null) {
      this.smoothedWorkload = rawWorkload;
    } else {
      this.smoothedWorkload = 0.08 * rawWorkload + 0.92 * this.smoothedWorkload;
    }

    const workloadScore = Math.round(this.smoothedWorkload);

    // =========================================================================
    // 7. Aggregate Confidence Calculation
    // =========================================================================
    const effectiveRppgConf = bpm !== null ? rppgConfidence : 30;
    const effectiveOcularConf = Math.max(0, Math.min(100, ocularConfidence));
    const effectiveSqi = Math.max(0, Math.min(100, sqi));
    const effectiveMotion = Math.max(0, Math.min(100, motionStability));

    let compositeConfidence = Math.round(
      0.35 * effectiveRppgConf +
      0.30 * effectiveOcularConf +
      0.20 * effectiveSqi +
      0.15 * effectiveMotion
    );

    if (!lightingValid || effectiveSqi < 45) {
      compositeConfidence = Math.min(compositeConfidence, 35);
    }

    // Reliability threshold: if confidence drops below 45% or SQI is Low, flag as unreliable
    const isReliable = compositeConfidence >= 45 && lightingValid && effectiveSqi >= 45;
    const confidenceLevel = compositeConfidence >= 70 ? 'High' : compositeConfidence >= 45 ? 'Moderate' : 'Low';
    const unreliableMessage = 'Measurements may be unreliable due to camera quality or lighting.';

    // Status label
    let workloadStatus = 'Optimal Focus';
    if (!isReliable) {
      workloadStatus = 'Unreliable Signal';
    } else if (workloadScore >= 70 || isDrowsy) {
      workloadStatus = 'High Cognitive/Visual Load';
    } else if (workloadScore >= 45) {
      workloadStatus = 'Moderate Workload';
    } else {
      workloadStatus = 'Resting / Low Workload';
    }

    // Active wellness cues
    const activeCues = [];
    if (isDrowsy) {
      activeCues.push({
        severity: 'high',
        type: 'drowsiness',
        text: 'Micro-sleep / Prolonged eye closure event detected'
      });
    } else if (perclosVal > 0.15) {
      activeCues.push({
        severity: 'high',
        type: 'perclos_high',
        text: `Elevated PERCLOS eye closure (${(perclosVal * 100).toFixed(1)}%): Eyelid micro-droop detected`
      });
    }

    if (zBlink !== null && zBlink < -1.5) {
      activeCues.push({
        severity: 'medium',
        type: 'screen_stare',
        text: `Suppressed blink rate (z: ${zBlink}σ below baseline): Visual fixation / dry-eye risk`
      });
    } else if (zBlink !== null && zBlink > 1.8) {
      activeCues.push({
        severity: 'low',
        type: 'ocular_strain',
        text: `Elevated blink rate (z: +${zBlink}σ above baseline): Rapid compensatory ocular flutter`
      });
    }

    if (zBpm !== null && zBpm > 1.8) {
      activeCues.push({
        severity: 'medium',
        type: 'elevated_hr',
        text: `Autonomic heart rate elevation (z: +${zBpm}σ above resting baseline)`
      });
    }

    if (headPose && headPose.pitch > 16) {
      activeCues.push({
        severity: 'medium',
        type: 'head_droop',
        text: 'Downward head slump / postural fatigue forward pitch detected'
      });
    }

    // =========================================================================
    // 8. Structured Heuristic Component Breakdown for "How is this calculated?"
    // =========================================================================
    const components = {
      heartRate: {
        weight: 0.30,
        score: Math.round(hrComponent),
        weightedScore: Number((0.30 * hrComponent).toFixed(1)),
        zScore: zBpm,
        label: 'Heart-Rate Trend (Autonomic Arousal)',
        detail: zBpm !== null
          ? `z: ${zBpm > 0 ? '+' : ''}${zBpm}σ vs baseline (${activeBaseline?.heartRate?.mean || 72} BPM)`
          : (bpm ? `${bpm} BPM (Baseline converging)` : 'Acquiring signal...')
      },
      eyeClosure: {
        weight: 0.30,
        score: Math.round(eyeClosureComponent),
        weightedScore: Number((0.30 * eyeClosureComponent).toFixed(1)),
        perclosPct: Number((perclosVal * 100).toFixed(1)),
        zScore: zScores?.closureDuration ?? null,
        label: 'Eye-Closure Duration (PERCLOS & Eyelid Lag)',
        detail: `PERCLOS: ${(perclosVal * 100).toFixed(1)}% • Closure lag z: ${zScores?.closureDuration ? (zScores.closureDuration > 0 ? '+' : '') + zScores.closureDuration + 'σ' : '0.0σ'}`
      },
      blinkPattern: {
        weight: 0.20,
        score: Math.round(blinkPatternComponent),
        weightedScore: Number((0.20 * blinkPatternComponent).toFixed(1)),
        zScore: zBlink,
        label: 'Blink-Pattern Alteration (Stare / Flutter)',
        detail: zBlink !== null
          ? `Cadence z: ${zBlink > 0 ? '+' : ''}${zBlink}σ (${blinkRate} blinks/min)`
          : `${blinkRate} blinks/min`
      },
      headPosture: {
        weight: 0.20,
        score: Math.round(headPostureComponent),
        weightedScore: Number((0.20 * headPostureComponent).toFixed(1)),
        zScore: zMotion,
        pitchDeg: Math.round(pitch),
        label: 'Head Movement & Postural Pitch',
        detail: `Motion z: ${zMotion > 0 ? '+' : ''}${zMotion}σ • Pitch: ${Math.round(pitch)}°`
      },
      sessionDuration: {
        addedPoints: durationFactor,
        elapsedMin: Number(elapsedMin.toFixed(1)),
        label: 'Session Duration Factor',
        detail: `+${durationFactor} pts over ${Math.floor(elapsedMin)} min elapsed focus time`
      }
    };

    return {
      workloadEstimate: isReliable ? workloadScore : null,
      rawWorkload: Math.round(rawWorkload),
      fatigueScore: workloadScore, // backward compatibility
      isReliable,
      unreliableMessage,
      confidence: compositeConfidence,
      confidenceLevel,
      workloadStatus,
      components,
      disclaimer: 'These weights are heuristic estimates, not clinically validated.',
      stressState: (zBpm !== null && zBpm > 1.8) ? 'Elevated' : 'Balanced',
      alertness: isDrowsy || workloadScore >= 70 ? 'Drowsy / High Load' : workloadScore >= 45 ? 'Moderate Load' : 'Optimal',
      activeCues
    };
  }
}

export const cliEngine = new ClinicalHeuristicsEngine();
export default ClinicalHeuristicsEngine;
