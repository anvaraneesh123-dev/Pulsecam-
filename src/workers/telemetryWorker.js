/**
 * PulseCam - Offscreen Telemetry Web Worker
 * Offloads computer vision (MediaPipe FaceLandmarker), rPPG blood volume pulse extraction,
 * blink kinematics, lighting evaluation, and clinical fatigue heuristics off the main thread.
 */

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { RPPGEngine } from '../modules/rppg.js';
import { BlinkTracker } from '../modules/blink.js';
import { LightingChecker } from '../modules/lightingCheck.js';
import { CalibrationManager } from '../modules/calibration.js';
import { SignalQualityAssessor } from '../modules/signalQuality.js';
import { ClinicalHeuristicsEngine } from '../modules/cliEngine.js';
import { HeadMotionTracker } from '../modules/headMotion.js';
import {
  extractROIs,
  extractBgRoi,
  FOREHEAD_INDICES,
  LEFT_CHEEK_INDICES,
  RIGHT_CHEEK_INDICES
} from '../modules/faceTracker.js';
import { BackgroundWatchEngine } from '../modules/backgroundWatch.js';

let landmarker = null;
let isModelReady = false;
let isMeasurementActive = false;
let activeBaseline = null;
let isCheckinMode = false;

// Stream reader & visibility state for background processing
let trackReader = null;
let isTrackReading = false;
let isTabHidden = false;
let lastLowFpsWarnTime = 0;

// Background Watch engine (30s window every 3m duty cycle, no rPPG)
const bgWatch = new BackgroundWatchEngine();

// Telemetry modules inside worker
const rppg = new RPPGEngine({
  windowDurationMs: 10000, // 10-second sliding window
  targetFs: 30,            // 30 Hz uniform resampling rate
  fLow: 0.7,               // 0.7 Hz (42 BPM)
  fHigh: 3.0,              // 3.0 Hz (180 BPM)
  confidenceThreshold: 35, // SNR confidence threshold
  medianWindowSize: 5      // 5-sample median filter
});
const blink = new BlinkTracker();
const lighting = new LightingChecker();
const calibration = new CalibrationManager(120000); // 2 minutes default (guided calibration)
const sqiAssessor = new SignalQualityAssessor();
const cliEngine = new ClinicalHeuristicsEngine();
const motionTracker = new HeadMotionTracker({
  movementThreshold: 0.035, // 3.5% of IOD normalized displacement
  windowDurationMs: 10000,  // 10-second rolling window
  lowConfidenceThreshold: 0.40 // 40% discard rate threshold
});

// Offscreen pixel canvas
let offscreenCanvas = null;
let offscreenCtx = null;

// Pipeline FPS tracking
let frameCount = 0;
let lastFpsTime = performance.now();
let pipelineFps = 0;

// Landmark indices
const NOSE_TIP = 1;
const CHIN = 152;
const TEMPLE_LEFT = 234;
const TEMPLE_RIGHT = 454;

/**
 * Initialize MediaPipe FaceLandmarker inside Worker
 */
async function initModel() {
  if (isModelReady && landmarker) return true;

  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: true
    });

    isModelReady = true;
    return true;
  } catch (gpuErr) {
    console.warn('Worker: GPU delegate failed, falling back to CPU...', gpuErr);
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'CPU'
        },
        runningMode: 'VIDEO',
        numFaces: 1
      });
      isModelReady = true;
      return true;
    } catch (fallbackErr) {
      console.error('Worker: FaceLandmarker init failed:', fallbackErr);
      throw fallbackErr;
    }
  }
}

/**
 * Execute processing pipeline on an incoming VideoFrame or ImageBitmap
 */
async function executeFrame(frameSource, isVideoFrame, timestamp, width, height, isDemo = false) {
  // Update Pipeline FPS
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 500) {
    pipelineFps = Math.round((frameCount * 1000) / (now - lastFpsTime));
    frameCount = 0;
    lastFpsTime = now;

    // Visibility 10 fps warning check
    if (isTabHidden && pipelineFps > 0 && pipelineFps < 10) {
      if (now - lastLowFpsWarnTime >= 8000) {
        lastLowFpsWarnTime = now;
        console.warn(`[PulseCam] Background monitoring: frame delivery dropped below 10 fps (${pipelineFps} fps). Tab background throttling active.`);
        self.postMessage({ type: 'BACKGROUND_LOW_FPS', fps: pipelineFps });
      }
    }
  }

  // Ensure OffscreenCanvas dimensions
  if (!offscreenCanvas || offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas = new OffscreenCanvas(width, height);
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }

  // Draw frame to offscreen canvas
  offscreenCtx.drawImage(frameSource, 0, 0, width, height);

  // Close hardware VideoFrame immediately to prevent GPU buffer exhaustion
  if (isVideoFrame && frameSource && typeof frameSource.close === 'function') {
    frameSource.close();
  }

  // Run MediaPipe Detection directly on the offscreen canvas
  let results = null;
  if (isModelReady && landmarker) {
    try {
      results = landmarker.detectForVideo(offscreenCanvas, timestamp);
    } catch (e) {
      console.warn('Worker detect error:', e);
    }
  }

  // Close ImageBitmap if transferred
  if (!isVideoFrame && frameSource && typeof frameSource.close === 'function') {
    frameSource.close();
  }

  let faceDetected = false;
  let landmarks = null;
  let faceBox = null;
  let rois = null;
  let bgRoi = null;
  let foreheadRoi = null;
  let leftCheekRoi = null;
  let rightCheekRoi = null;
  let headPose = null;
  let motionResult = null;

  if (results && results.faceLandmarks && results.faceLandmarks.length > 0) {
    faceDetected = true;
    landmarks = results.faceLandmarks[0];

    // Compute Face Bounding Box
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    faceBox = {
      x: minX * width,
      y: minY * height,
      width: (maxX - minX) * width,
      height: (maxY - minY) * height
    };

    // Extract Forehead, Left Cheek, Right Cheek, and Background Reference ROIs
    rois = extractROIs(landmarks, width, height);
    if (rois) {
      foreheadRoi = rois.forehead;
      leftCheekRoi = rois.leftCheek;
      rightCheekRoi = rois.rightCheek;
      bgRoi = rois.bgRoi || extractBgRoi(faceBox, width, height);
    } else {
      bgRoi = extractBgRoi(faceBox, width, height);
    }

    // Compute Head Motion & Pose (displacement normalized by IOD)
    motionResult = motionTracker.process(landmarks, width, height, timestamp);
    headPose = motionResult.headPose;
  } else if (isDemo) {
    // Synthetic Demo Face geometry corresponding to animated demo canvas
    faceDetected = true;
    faceBox = {
      x: Math.round(width * 0.32),
      y: Math.round(height * 0.20),
      width: Math.round(width * 0.36),
      height: Math.round(height * 0.60)
    };

    // Synthetic landmarks for 468 mesh with subtle physiological tremor
    const tSec = timestamp / 1000;
    const tremorX = Math.sin(tSec * 2.8) * 0.0006;
    const tremorY = Math.cos(tSec * 2.8) * 0.0009;

    landmarks = new Array(468).fill(null).map(() => ({ x: 0.5 + tremorX, y: 0.5 + tremorY, z: 0 }));
    landmarks[NOSE_TIP] = { x: 0.5 + tremorX, y: 0.52 + tremorY, z: 0 };
    landmarks[CHIN] = { x: 0.5 + tremorX, y: 0.80 + tremorY, z: 0 };
    landmarks[TEMPLE_LEFT] = { x: 0.33 + tremorX, y: 0.48 + tremorY, z: 0 };
    landmarks[TEMPLE_RIGHT] = { x: 0.67 + tremorX, y: 0.48 + tremorY, z: 0 };
    landmarks[10] = { x: 0.5 + tremorX, y: 0.22 + tremorY, z: 0 };

    // Forehead landmarks
    FOREHEAD_INDICES.forEach((idx, i) => {
      const spread = (i - FOREHEAD_INDICES.length / 2) * 0.02;
      landmarks[idx] = { x: 0.50 + spread + tremorX, y: 0.30 + tremorY, z: 0 };
    });

    // Left cheek landmarks (subject's left / camera right)
    LEFT_CHEEK_INDICES.forEach((idx, i) => {
      const spreadX = (i % 3) * 0.015;
      const spreadY = Math.floor(i / 3) * 0.015;
      landmarks[idx] = { x: 0.60 + spreadX + tremorX, y: 0.54 + spreadY + tremorY, z: 0 };
    });

    // Right cheek landmarks (subject's right / camera left)
    RIGHT_CHEEK_INDICES.forEach((idx, i) => {
      const spreadX = (i % 3) * 0.015;
      const spreadY = Math.floor(i / 3) * 0.015;
      landmarks[idx] = { x: 0.37 + spreadX + tremorX, y: 0.54 + spreadY + tremorY, z: 0 };
    });

    // Eyes: outer canthi (33 right, 263 left)
    const isBlinkFrame = tSec % 3.5 < 0.18;
    const eyeGap = isBlinkFrame ? 0.003 : 0.024;
    [33, 133, 362, 263].forEach((idx) => {
      landmarks[idx] = { x: idx < 200 ? 0.42 + tremorX : 0.58 + tremorX, y: 0.44 + tremorY, z: 0 };
    });
    [160, 158, 385, 387].forEach((idx) => {
      landmarks[idx] = { x: idx < 200 ? 0.42 + tremorX : 0.58 + tremorX, y: 0.44 - eyeGap + tremorY, z: 0 };
    });
    [153, 144, 373, 380].forEach((idx) => {
      landmarks[idx] = { x: idx < 200 ? 0.42 + tremorX : 0.58 + tremorX, y: 0.44 + eyeGap + tremorY, z: 0 };
    });

    // Extract ROIs
    rois = extractROIs(landmarks, width, height);
    if (rois) {
      foreheadRoi = rois.forehead;
      leftCheekRoi = rois.leftCheek;
      rightCheekRoi = rois.rightCheek;
      bgRoi = rois.bgRoi || extractBgRoi(faceBox, width, height);
    } else {
      bgRoi = extractBgRoi(faceBox, width, height);
    }

    // Process Motion Tracker
    motionResult = motionTracker.process(landmarks, width, height, timestamp);
    headPose = motionResult.headPose;
  }

  // Face detection confidence assessment
  let faceConfidence = 0.0;
  if (faceDetected && faceBox) {
    const faceAreaFraction = (faceBox.width * faceBox.height) / (width * height);
    faceConfidence = faceAreaFraction >= 0.03 && faceAreaFraction <= 0.85 ? 0.96 : 0.45;
  }

  // 1. Lighting Diagnostics evaluated on the facial ROI with detection confidence
  const lightingResult = lighting.evaluate(
    offscreenCtx,
    faceDetected ? faceBox : null,
    faceConfidence,
    {
      mode: isCheckinMode ? 'checkin' : 'normal',
      whiteScreenVisible: isCheckinMode,
      isWarmedUp: isCheckinMode
    }
  );

  // 2. Head Motion Threshold Gating:
  // "Only pass a frame to the pulse pipeline if movement is below a threshold; mark other frames as "noisy" and discard them."
  const isFrameNoisy = Boolean(motionResult && motionResult.isNoisy);
  const isFrameDiscarded = Boolean(motionResult && motionResult.isDiscarded);
  // Continuous acquisition: isCheckinMode immediately enables measurement; rppg engine internally scores SNR and rejects window if corrupted
  const canMeasure = Boolean(faceDetected && (isMeasurementActive || isCheckinMode));
  const canPassToPulse = Boolean(canMeasure);

  let rppgResult = null;
  let blinkResult = null;
  let sqiResult = null;
  let calibResult = null;
  let cliResult = null;

  const faceDetectionObj = {
    detected: faceDetected,
    landmarks,
    faceBox,
    rois,
    bgRoi,
    foreheadRoi,
    leftCheekRoi,
    rightCheekRoi,
    headPose,
    motion: motionResult
  };

  const effectiveBaseline = activeBaseline || calibration.profile || null;
  const calibContext = (effectiveBaseline && effectiveBaseline.thresholds)
    ? {
        baselineEAR: effectiveBaseline.ear.mean,
        personalBlinkThreshold: effectiveBaseline.thresholds.personalBlink,
        personalPerclosThreshold: effectiveBaseline.thresholds.personalPerclos
      }
    : (calibration.baselineEAR
      ? {
          baselineEAR: calibration.baselineEAR,
          personalBlinkThreshold: calibration.personalBlinkThreshold,
          personalPerclosThreshold: calibration.personalPerclosThreshold
        }
      : null);

  if (canPassToPulse && (isCheckinMode || calibration.isCalibrating || isMeasurementActive)) {
    // Continuous pulse extraction across multi-ROI skin buffers with motion weighting
    rppgResult = rppg.processFrame(offscreenCtx, rois, timestamp, bgRoi, motionResult);
    blinkResult = blink.process(landmarks, timestamp, calibContext);

    sqiResult = sqiAssessor.evaluate({
      faceDetection: faceDetectionObj,
      lighting: lightingResult,
      rppgResult,
      motionData: motionResult,
      fps: pipelineFps,
      illumination: rppgResult ? rppgResult.illumination : null
    });
  } else if (faceDetected) {
    // Frame DISCARDED from pulse pipeline (either movement >= threshold or measurement paused/blocked)
    blinkResult = blink.process(landmarks, timestamp, calibContext);
    sqiResult = sqiAssessor.evaluate({
      faceDetection: faceDetectionObj,
      lighting: lightingResult,
      rppgResult: null,
      motionData: motionResult,
      fps: pipelineFps,
      illumination: null
    });
  } else {
    sqiResult = sqiAssessor.evaluate({
      faceDetection: null,
      lighting: lightingResult,
      rppgResult: null,
      motionData: motionResult,
      fps: pipelineFps,
      illumination: null
    });
  }

  // Update guided calibration session if active
  if (calibration.isCalibrating) {
    calibResult = calibration.update(
      {
        bpm: rppgResult ? rppgResult.bpm : null,
        blinkRate: blinkResult ? blinkResult.blinkRate : null,
        ear: blinkResult ? blinkResult.ear : null,
        closureDuration: (blinkResult && blinkResult.closureDurationMs > 0) ? blinkResult.closureDurationMs : null,
        headMotion: motionResult ? motionResult.normalizedMovement : null,
        luminance: lightingResult.meanLuminance
      },
      timestamp
    );

    // If calibration just finalized, lock activeBaseline
    if (calibration.isComplete && calibration.profile) {
      activeBaseline = calibration.profile;
      if (activeBaseline?.ear?.mean) {
        blink.setPersonalBaseline(activeBaseline.ear.mean);
      }
    }
  }

  // Compute real-time relative deviations (z-scores) from user's personal baseline
  let zScores = null;
  if (effectiveBaseline) {
    const hrMean = effectiveBaseline.heartRate?.mean || 72;
    const hrStd = Math.max(1.0, effectiveBaseline.heartRate?.std || 3.5);
    const blinkMean = effectiveBaseline.blinkRate?.mean || 16;
    const blinkStd = Math.max(1.0, effectiveBaseline.blinkRate?.std || 3.0);
    const earMean = effectiveBaseline.ear?.mean || 0.30;
    const earStd = Math.max(0.005, effectiveBaseline.ear?.std || 0.015);
    const closureMean = effectiveBaseline.closureDuration?.mean || 140;
    const closureStd = Math.max(5.0, effectiveBaseline.closureDuration?.std || 25.0);
    const motionMean = effectiveBaseline.headMotion?.mean || 0.008;
    const motionStd = Math.max(0.001, effectiveBaseline.headMotion?.std || 0.003);

    const curBpm = rppgResult ? rppgResult.bpm : null;
    const curBlink = blinkResult ? blinkResult.blinkRate : 16;
    const curEar = blinkResult ? blinkResult.ear : 0.30;
    const curClosure = (blinkResult && blinkResult.closureDurationMs > 0) ? blinkResult.closureDurationMs : closureMean;
    const curMotion = motionResult ? motionResult.normalizedMovement : 0;

    zScores = {
      bpm: curBpm !== null ? Number(((curBpm - hrMean) / hrStd).toFixed(2)) : null,
      blinkRate: Number(((curBlink - blinkMean) / blinkStd).toFixed(2)),
      ear: Number(((curEar - earMean) / earStd).toFixed(2)),
      closureDuration: Number(((curClosure - closureMean) / closureStd).toFixed(2)),
      headMotion: Number(((curMotion - motionMean) / motionStd).toFixed(2))
    };
  }

  // Track elapsed measurement duration in seconds
  const elapsedSec = (canMeasure && timestamp > 0) ? Math.max(0, Math.floor(timestamp / 1000)) : 0;

  // Background Watch intermittent duty-cycle evaluation (ocular & posture only, never rPPG)
  bgWatch.updateSchedule(timestamp);
  if (bgWatch.isWindowActive) {
    bgWatch.processFrame({
      landmarks: faceDetected ? landmarks : null,
      headPose,
      blinkResult,
      faceDetected,
      timestamp,
      baseline: effectiveBaseline
    });
  }

  // Clinical fatigue and workload heuristics evaluated against personal baseline deviations
  cliResult = cliEngine.evaluate({
    bpm: rppgResult ? rppgResult.bpm : null,
    rppgConfidence: rppgResult ? rppgResult.confidence : 0,
    hrv: rppgResult ? rppgResult.hrv : null,
    blinkRate: blinkResult ? blinkResult.blinkRate : 16,
    perclos: blinkResult ? blinkResult.perclos : 0,
    isDrowsy: blinkResult ? blinkResult.isDrowsy : false,
    prolongedClosures: blinkResult ? blinkResult.prolongedClosures : 0,
    ocularConfidence: blinkResult ? blinkResult.confidence : 100,
    headPose,
    headMotion: motionResult ? motionResult.normalizedMovement : 0,
    motionStability: motionResult ? (motionResult.isNoisy ? 35 : 95) : 100,
    sqi: sqiResult ? sqiResult.sqi : 80,
    lightingValid: lightingResult ? lightingResult.isValid : true,
    elapsedSec,
    zScores,
    activeBaseline: effectiveBaseline
  });

  // Send telemetry snapshot back to main thread
  self.postMessage({
    type: 'TELEMETRY_UPDATE',
    timestamp,
    pipelineFps,
    isMeasurementActive: canMeasure,
    canPassToPulse,
    faceDetected,
    faceConfidence,
    landmarks: faceDetected ? landmarks : null,
    faceBox,
    rois,
    bgRoi,
    foreheadRoi,
    leftCheekRoi,
    rightCheekRoi,
    headPose,
    motion: motionResult,
    isFrameNoisy,
    isFrameDiscarded,
    windowStability: motionResult ? motionResult.windowStability : null,
    lighting: lightingResult,
    illumination: rppgResult ? rppgResult.illumination : null,
    rppg: rppgResult
      ? {
          bpm: rppgResult.bpm,
          rawBpm: rppgResult.rawBpm,
          confidence: rppgResult.confidence,
          snrDb: rppgResult.snrDb,
          hrv: rppgResult.hrv,
          waveform: rppgResult.waveform,
          isPulsing: rppgResult.isPulsing,
          isWindowLowConfidence: rppgResult.isWindowLowConfidence || false,
          illumination: rppgResult.illumination || null,
          diagnostics: rppgResult.diagnostics || rppg.diagnostics
        }
      : (isCheckinMode
        ? {
            bpm: null,
            rawBpm: null,
            confidence: 0,
            snrDb: 0,
            hrv: null,
            waveform: 0,
            isPulsing: false,
            diagnostics: rppg.diagnostics
          }
        : null),
    blink: blinkResult
      ? {
          ear: blinkResult.ear,
          leftEar: blinkResult.leftEar,
          rightEar: blinkResult.rightEar,
          blinkRate: blinkResult.blinkRate,
          totalBlinks: blinkResult.totalBlinks,
          perclos: blinkResult.perclos,
          perclosPct: blinkResult.perclosPct,
          closureDurationMs: blinkResult.closureDurationMs,
          prolongedClosures: blinkResult.prolongedClosures,
          isEyeClosed: blinkResult.isEyeClosed,
          isDrowsy: blinkResult.isDrowsy,
          confidence: blinkResult.confidence,
          jitter: blinkResult.jitter,
          isOccludedOrJittering: blinkResult.isOccludedOrJittering,
          personalThreshold: blinkResult.personalThreshold,
          personalBaseline: blinkResult.personalBaseline
        }
      : null,
    backgroundWatch: bgWatch.latestState,
    shouldAlertBackgroundWatch: bgWatch.shouldTriggerAlert(),
    sqi: sqiResult,
    calibration: {
      isCalibrating: calibration.isCalibrating,
      isComplete: calibration.isComplete,
      progress: calibration.progress,
      remainingSec: calibResult ? calibResult.remainingSec : Math.ceil(calibration.duration / 1000),
      totalSec: calibResult ? calibResult.totalSec : Math.round(calibration.duration / 1000),
      phaseTitle: calibResult ? calibResult.phaseTitle : 'Stage 1 of 4: Optical Lock',
      message: calibResult ? calibResult.message : (calibration.isComplete ? 'Baseline established' : 'Ready'),
      samples: calibResult ? calibResult.samples : null,
      profile: calibration.profile || effectiveBaseline,
      baselineBPM: calibration.baselineBPM || effectiveBaseline?.heartRate?.mean || null,
      baselineEAR: calibration.baselineEAR || effectiveBaseline?.ear?.mean || null,
      personalBlinkThreshold: calibration.personalBlinkThreshold || effectiveBaseline?.thresholds?.personalBlink || null,
      personalPerclosThreshold: calibration.personalPerclosThreshold || effectiveBaseline?.thresholds?.personalPerclos || null
    },
    zScores,
    activeBaseline: effectiveBaseline,
    heuristics: cliResult
  });
}

/**
 * Start MediaStreamTrackProcessor stream reader loop inside Web Worker
 * Decoupled completely from main-thread requestAnimationFrame and timers.
 */
async function startTrackReader(readable, streamWidth, streamHeight) {
  if (trackReader) {
    try {
      await trackReader.cancel();
    } catch (_) {}
  }

  trackReader = readable.getReader();
  isTrackReading = true;

  const w = streamWidth || 640;
  const h = streamHeight || 480;

  while (isTrackReading) {
    try {
      const { done, value: videoFrame } = await trackReader.read();
      if (done || !videoFrame) break;

      // Real hardware frame timestamp from VideoFrame where supported
      const ts = (videoFrame.timestamp && videoFrame.timestamp > 0)
        ? videoFrame.timestamp / 1000
        : performance.now();

      // If monitoring is completely stopped or unneeded, free frame and continue
      if (!isMeasurementActive && !isCheckinMode && !calibration.isCalibrating && !bgWatch.isEnabled) {
        videoFrame.close();
        continue;
      }

      await executeFrame(videoFrame, true, ts, w, h, false);
    } catch (err) {
      console.warn('[PulseCam Worker] Track reader terminated or cancelled:', err);
      break;
    }
  }
}

// Worker message listener
self.onmessage = async (event) => {
  const { type } = event.data;

  if (type === 'INIT') {
    try {
      await initModel();
      self.postMessage({ type: 'READY' });
    } catch (e) {
      self.postMessage({ type: 'ERROR', message: e.message || 'Model load failure' });
    }
  } else if (type === 'ATTACH_TRACK_STREAM') {
    const { readable, width, height } = event.data;
    startTrackReader(readable, width, height);
  } else if (type === 'STOP_TRACK_STREAM') {
    isTrackReading = false;
    if (trackReader) {
      trackReader.cancel().catch(() => {});
      trackReader = null;
    }
  } else if (type === 'SET_VISIBILITY') {
    isTabHidden = Boolean(event.data.isHidden);
  } else if (type === 'SET_BACKGROUND_WATCH') {
    if (event.data.enabled !== undefined) bgWatch.setEnabled(event.data.enabled);
    if (event.data.dutyCycle) bgWatch.setDutyCycle(event.data.dutyCycle.windowSec, event.data.dutyCycle.intervalMin);
  } else if (type === 'PROCESS_FRAME') {
    const { bitmap, timestamp, width, height, isDemo } = event.data;
    executeFrame(bitmap, false, timestamp, width, height, isDemo);
  } else if (type === 'SET_ACTIVE_BASELINE') {
    activeBaseline = event.data.baseline;
    if (activeBaseline?.ear?.mean) {
      blink.setPersonalBaseline(activeBaseline.ear.mean);
    }
  } else if (type === 'START_CALIBRATION') {
    const durMs = event.data.durationMs || 120000;
    calibration.start(durMs);
  } else if (type === 'EXTEND_CALIBRATION') {
    const durMs = event.data.durationMs || 300000;
    calibration.extendTo(durMs);
  } else if (type === 'RECALIBRATE') {
    const durMs = event.data.durationMs || 120000;
    calibration.start(durMs);
  } else if (type === 'RESET') {
    rppg.reset();
    blink.reset();
    calibration.reset();
    sqiAssessor.reset();
    motionTracker.reset();
  } else if (type === 'SET_MEASUREMENT_ACTIVE') {
    isMeasurementActive = Boolean(event.data.active);
  } else if (type === 'SET_CHECKIN_MODE') {
    isCheckinMode = Boolean(event.data.active);
    rppg.reset();
    blink.reset();
    lighting.resetHistory();
  } else if (type === 'RESET_CHECKIN') {
    rppg.reset();
    blink.reset();
    lighting.resetHistory();
    motionTracker.reset();
  } else if (type === 'GET_CHECKIN_RESULT') {
    const checkinRes = rppg.getCheckinFinalResult();
    self.postMessage({ type: 'CHECKIN_RESULT', result: checkinRes });
  }
};
