/**
 * PulseCam - Main Application Bootstrap & UI Rendering Loop
 * Runs offloaded camera processing (MediaPipe, rPPG, blinks) inside a Web Worker.
 * Main thread exclusively drives visuals from a single delta-time requestAnimationFrame
 * loop that natively syncs to display refresh rates (60/120/144 Hz) with critically
 * damped/exponential smoothing on all displayed telemetry values.
 */

import { CameraManager } from './modules/camera.js';
import { FaceTracker } from './modules/faceTracker.js';
import { TimelineManager } from './modules/timeline.js';
import { SuggestionsManager } from './modules/suggestions.js';
import { UIController } from './modules/ui.js';
import { AlertSystem } from './modules/alertSystem.js';
import { SmoothValue, SpringDamper } from './utils/smoothUtils.js';
import { loadStoredBaseline, saveStoredBaseline } from './modules/baselineStore.js';
import { PipManager } from './modules/pipManager.js';

class PulseCamApp {
  constructor() {
    this.videoEl = document.getElementById('webcam-video');
    this.hudCanvas = document.getElementById('hud-canvas');
    this.hudCtx = this.hudCanvas ? this.hudCanvas.getContext('2d') : null;

    // Camera & UI Modules on Main Thread
    this.camera = new CameraManager(this.videoEl);
    this.isDemoSession = false;
    this.camera.onStateChange = (isActive) => {
      this.ui.setCameraActive(isActive);
      this.updatePipState();
    };
    this.tracker = new FaceTracker(); // Canvas HUD overlay rendering
    this.timeline = new TimelineManager('oscilloscope-canvas', 'trend-canvas');
    this.suggestions = new SuggestionsManager();
    this.ui = new UIController();

    // Background processing & PiP state
    this.hasBackgroundProcessor = false;
    this.latestBackgroundWatch = null;
    this.shouldAlertBackgroundWatch = false;

    // Document Picture-in-Picture Mini Window (with in-page fallback)
    this.pip = new PipManager({
      onTogglePause: () => {
        this.isPaused = !this.isPaused;
        const btnTogglePause = document.getElementById('btn-toggle-pause');
        if (btnTogglePause) btnTogglePause.textContent = this.isPaused ? 'Resume' : 'Pause';
        this.ui.setMonitoringStatus(
          this.isPaused ? 'paused' : 'active',
          this.isPaused ? 'PAUSED' : 'ACTIVE TELEMETRY'
        );
        this.updatePipState();
      },
      onStop: () => this.stopMonitoringSession(),
      onStartCheckin: () => this.startQuickCheckin()
    });

    // Page Visibility API
    document.addEventListener('visibilitychange', () => {
      const isHidden = document.hidden;
      if (this.worker) {
        this.worker.postMessage({ type: 'SET_VISIBILITY', isHidden });
      }
    });

    // Calm Mindful Alert System (Top banner, silent by default, strictly high confidence)
    this.alertSystem = new AlertSystem({
      container: document.getElementById('top-alert-banner'),
      messageEl: document.getElementById('top-alert-message'),
      btnDismiss: document.getElementById('btn-alert-dismiss'),
      btnSnooze: document.getElementById('btn-alert-snooze'),
      onToast: (icon, text) => this.ui.showToast(icon, text)
    });
    this.ui.initSettingsInteractions(this.alertSystem);

    // Spawn Offscreen Telemetry Web Worker
    this.worker = new Worker(
      new URL('./workers/telemetryWorker.js', import.meta.url),
      { type: 'module' }
    );
    this.isWorkerReady = false;
    this.isWorkerBusy = false;
    this.pipelineFps = 0;

    // Loop state
    this.isMonitoring = false;
    this.isPaused = false;
    this.animationFrameId = null;
    this.sessionStartTime = 0;
    this.sessionTimerInterval = null;

    // Quick Check-in Mode State Machine ('IDLE', 'PREPARING', 'MEASURING', 'RESULT')
    this.checkinState = 'IDLE';
    this.isQuickCheckin = false;
    this.checkinStartTime = 0;
    this.checkinMeasurementStartTime = 0;
    this.checkinWarmupDuration = 2000; // 2 seconds warm-up for auto-exposure to settle
    this.checkinDuration = 60000; // 60 seconds measurement
    this.checkinWarmedUp = false;
    this.checkinForceContinue = false;
    this.wakeLockSentinel = null;
    this.checkinEscHandler = null;
    this.checkinFullscreenHandler = null;

    // Background Watch distance nudge & smart reminders
    this.consecutiveCloseFrames = 0;
    this.lastCloseNudgeTime = 0;
    this.lastSmartReminderTime = 0;
    this.sustainedHighFatigueWindows = 0;

    if (this.alertSystem) {
      this.alertSystem.onCheckinRequested = () => this.startQuickCheckin();
    }

    // Lighting-Quality Pre-Flight & Continuous Monitoring State
    this.sessionState = 'IDLE'; // 'IDLE' | 'PREFLIGHT' | 'MEASURING' | 'BLOCKED_LIGHTING' | 'PAUSED_LIGHTING'
    this.preflightStartTime = 0;
    this.preflightDuration = 3000; // 3 seconds
    this.preflightSamples = [];
    this.consecutiveGoodLightingFrames = 0;
    this.consecutiveBadLightingFrames = 0;

    // HUD Display Options
    this.showMesh = true;
    this.showRoi = true;
    this.showDebugOverlay = true;
    this.latestMotion = null;
    this.latestWindowStability = null;

    // Framerate & Delta Time Diagnostics
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.currentUiFps = 60;
    this.lastFpsCalc = performance.now();
    this.currentDt = 0.016;

    // Target telemetry values received from worker
    this.targetBPM = null;
    this.targetConfidence = 0;
    this.targetHRV = null;
    this.targetBlinkRate = 16;
    this.targetEAR = 0.3;
    this.targetPERCLOS = 0;
    this.targetFatigue = 10;
    this.targetSQI = 0;
    this.targetLighting = 100;
    this.targetMotion = 100;
    this.targetWaveform = 0;

    // Smoothed values with delta-time exponential smoothing (glides smoothly across 60/120/144Hz)
    this.smoothBPM = new SmoothValue(72, 5.0);
    this.smoothFatigue = new SmoothValue(10, 4.0);
    this.smoothHRV = new SmoothValue(45, 4.0);
    this.smoothBlinkRate = new SmoothValue(16, 5.0);
    this.smoothEAR = new SmoothValue(0.3, 8.0);
    this.smoothPERCLOS = new SmoothValue(0, 4.0);
    this.smoothSQI = new SmoothValue(0, 6.0);
    this.smoothLighting = new SmoothValue(100, 5.0);
    this.smoothMotion = new SmoothValue(100, 6.0);
    this.smoothWaveform = new SmoothValue(0, 14.0);

    // Latest detection snapshot from worker
    this.latestDetection = null;
    this.latestLighting = null;
    this.latestIllumination = null;
    this.latestBlink = null;
    // Personal Baseline Profile (client-side only, numeric distributions)
    const stored = loadStoredBaseline();
    this.activeBaseline = stored.baseline;
    this.isBaselineStale = stored.isStale;
    this.baselineAgeDays = stored.ageDays;
    this.selectedCalibDurationMs = 120000; // 2 minutes default
    this.latestZScores = null;

    if (this.activeBaseline) {
      this.ui.setHeaderBaseline(this.activeBaseline);
    }

    this.sessionTimeSplit = { calmSec: 0, busySec: 0, tiredSec: 0 };
    this.currentHumanState = 'calm';

    this.lastSuggestionTime = 0;

    this.initWorkerListeners();
    this.bindEvents();

    // Start single rAF UI rendering loop immediately
    this.renderLoop = this.renderLoop.bind(this);
    this.animationFrameId = requestAnimationFrame(this.renderLoop);
    window.__pulsecam_app = this;
  }

  initWorkerListeners() {
    this.worker.onmessage = (e) => {
      const { type } = e.data;

      if (type === 'READY') {
        this.isWorkerReady = true;
        if (this.activeBaseline) {
          this.worker.postMessage({ type: 'SET_ACTIVE_BASELINE', baseline: this.activeBaseline });
        }
      } else if (type === 'TELEMETRY_UPDATE') {
        this.isWorkerBusy = false;
        const data = e.data;

        this.pipelineFps = data.pipelineFps || 0;

        if (data.rppg) {
          this.targetBPM = data.rppg.bpm !== undefined ? data.rppg.bpm : null;
          this.targetConfidence = data.rppg.confidence || 0;
          if (data.rppg.hrv !== null) this.targetHRV = data.rppg.hrv;
          if (data.rppg.waveform !== undefined) this.targetWaveform = data.rppg.waveform;
          if (data.rppg.diagnostics) this.latestRppgDiagnostics = data.rppg.diagnostics;
          this.latestRppg = data.rppg;
        }

        if (data.blink) {
          this.targetBlinkRate = data.blink.blinkRate;
          this.targetEAR = data.blink.ear;
          this.targetPERCLOS = data.blink.perclosPct !== undefined ? data.blink.perclosPct : (data.blink.perclos * 100);
          this.latestBlink = data.blink;
        }

        if (data.heuristics) {
          this.targetFatigue = data.heuristics.fatigueScore;
          this.latestHeuristics = data.heuristics;
        }

        if (data.sqi) {
          this.targetSQI = data.sqi.score !== undefined ? data.sqi.score : data.sqi.sqi;
          this.targetMotion = data.sqi.motionStability;
          this.latestSqi = data.sqi;
        }

        if (data.lighting) {
          this.targetLighting = data.lighting.luminance;
          this.latestLighting = data.lighting;
        }

        if (data.zScores) {
          this.latestZScores = data.zScores;
        }

        if (data.calibration) {
          this.latestCalibration = data.calibration;
          // If calibration session finalized with a newly generated profile, persist to localStorage!
          if (data.calibration.isComplete && data.calibration.profile) {
            const prof = data.calibration.profile;
            if (!this.activeBaseline || this.activeBaseline.timestamp !== prof.timestamp) {
              this.activeBaseline = prof;
              saveStoredBaseline(prof);
              this.isBaselineStale = false;
              this.baselineAgeDays = 0;
              this.ui.setHeaderBaseline(prof);
              this.ui.showStaleBaselinePrompt(false);
              this.worker.postMessage({ type: 'SET_ACTIVE_BASELINE', baseline: prof });
            }
          }
        }

        if (data.backgroundWatch) {
          this.latestBackgroundWatch = data.backgroundWatch;
          this.shouldAlertBackgroundWatch = data.shouldAlertBackgroundWatch;
        }

        this.latestMotion = data.motion;
        this.latestWindowStability = data.windowStability;
        this.latestIllumination = data.illumination || (data.rppg ? data.rppg.illumination : null);

        this.latestDetection = {
          detected: data.faceDetected,
          landmarks: data.landmarks,
          faceBox: data.faceBox,
          rois: data.rois,
          bgRoi: data.bgRoi,
          foreheadRoi: data.foreheadRoi,
          leftCheekRoi: data.leftCheekRoi,
          rightCheekRoi: data.rightCheekRoi,
          headPose: data.headPose,
          motion: data.motion
        };
      } else if (type === 'CHECKIN_RESULT') {
        this.latestCheckinResult = e.data.result;
        if (this.onCheckinResultResolve) {
          this.onCheckinResultResolve(e.data.result);
          this.onCheckinResultResolve = null;
        }
      } else if (type === 'BACKGROUND_LOW_FPS') {
        console.warn(`[PulseCam] Background monitoring: frame delivery dropped below 10 fps (${e.data.fps} fps). Consider checking system power settings or browser background throttling.`);
      }
    };

    // Pre-initialize worker
    this.worker.postMessage({ type: 'INIT' });
  }

  bindEvents() {
    // Navigation / View Switching
    const btnHeroTop = document.getElementById('btn-hero-launch-top');
    const btnStartCheck = document.getElementById('btn-start-check');
    const btnConsentBack = document.getElementById('btn-consent-back');
    const btnConsentProceed = document.getElementById('btn-consent-proceed');
    const btnConsentDemo = document.getElementById('btn-consent-demo');

    if (btnHeroTop) btnHeroTop.onclick = () => this.ui.showView('consent');
    if (btnStartCheck) btnStartCheck.onclick = () => this.ui.showView('consent');
    if (btnConsentBack) btnConsentBack.onclick = () => this.ui.showView('landing');

    if (btnConsentDemo) {
      btnConsentDemo.onclick = () => this.startMonitoringSession(true);
    }
    const btnConsentVideo = document.getElementById('btn-consent-video');
    const inputTestVideo = document.getElementById('input-test-video');
    if (btnConsentVideo && inputTestVideo) {
      btnConsentVideo.onclick = () => inputTestVideo.click();
      inputTestVideo.onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          await this.startMonitoringSession(false, file);
        }
      };
    }
    if (btnConsentProceed) {
      btnConsentProceed.onclick = () => this.startMonitoringSession(false);
    }

    // Stop / Start Camera Toggle Controls (Releases and re-engages camera stream hardware)
    const toggleCameraStream = async () => {
      if (this.camera.isRunning) {
        this.camera.stop();
        this.ui.setCameraActive(false);
        this.ui.setMonitoringStatus('paused', 'CAMERA RELEASED');
      } else {
        try {
          if (this.isDemoSession) {
            await this.camera.startDemoMode();
          } else {
            await this.camera.start();
          }
          this.ui.setCameraActive(true);
          this.ui.setMonitoringStatus('active', 'ACTIVE TELEMETRY');
        } catch (err) {
          console.error('Failed to restart camera stream:', err);
        }
      }
    };

    const btnStopCamera = document.getElementById('btn-stop-camera');
    if (btnStopCamera) {
      btnStopCamera.onclick = toggleCameraStream;
    }

    const btnStopCameraFooter = document.getElementById('btn-stop-camera-footer');
    if (btnStopCameraFooter) {
      btnStopCameraFooter.onclick = toggleCameraStream;
    }

    // Re-run Lighting Check Button
    const btnRecheckLighting = document.getElementById('btn-recheck-lighting');
    if (btnRecheckLighting) {
      btnRecheckLighting.onclick = () => this.startPreflightCheck();
    }

    // Dashboard Controls
    const btnRecalibrate = document.getElementById('btn-recalibrate');
    if (btnRecalibrate) {
      btnRecalibrate.onclick = () => {
        if (this.camera.isRunning) {
          this.startGuidedCalibration(this.selectedCalibDurationMs);
        }
      };
    }

    if (this.ui.headerBaselineTag) {
      this.ui.headerBaselineTag.onclick = () => {
        if (this.camera.isRunning) {
          this.startGuidedCalibration(this.selectedCalibDurationMs);
        }
      };
    }

    // Guided Calibration Duration Selector (2 min vs 5 min)
    if (this.ui.btnDuration2m) {
      this.ui.btnDuration2m.onclick = () => {
        this.selectedCalibDurationMs = 120000;
        this.ui.btnDuration2m.classList.add('active');
        if (this.ui.btnDuration5m) this.ui.btnDuration5m.classList.remove('active');
        if (this.latestCalibration && this.latestCalibration.isCalibrating) {
          this.worker.postMessage({ type: 'START_CALIBRATION', durationMs: 120000 });
        }
      };
    }

    if (this.ui.btnDuration5m) {
      this.ui.btnDuration5m.onclick = () => {
        this.selectedCalibDurationMs = 300000;
        this.ui.btnDuration5m.classList.add('active');
        if (this.ui.btnDuration2m) this.ui.btnDuration2m.classList.remove('active');
        if (this.latestCalibration && this.latestCalibration.isCalibrating) {
          this.worker.postMessage({ type: 'EXTEND_CALIBRATION', durationMs: 300000 });
        }
      };
    }

    if (this.ui.btnExtendCalib) {
      this.ui.btnExtendCalib.onclick = () => {
        this.selectedCalibDurationMs = 300000;
        if (this.ui.btnDuration5m) this.ui.btnDuration5m.classList.add('active');
        if (this.ui.btnDuration2m) this.ui.btnDuration2m.classList.remove('active');
        this.worker.postMessage({ type: 'EXTEND_CALIBRATION', durationMs: 300000 });
      };
    }

    if (this.ui.btnExtendCalibBanner) {
      this.ui.btnExtendCalibBanner.onclick = () => {
        this.selectedCalibDurationMs = 300000;
        this.worker.postMessage({ type: 'EXTEND_CALIBRATION', durationMs: 300000 });
      };
    }

    if (this.ui.btnAbortCalib) {
      this.ui.btnAbortCalib.onclick = () => this.cancelGuidedCalibration();
    }

    const btnTogglePause = document.getElementById('btn-toggle-pause');
    if (btnTogglePause) {
      btnTogglePause.onclick = () => {
        this.isPaused = !this.isPaused;
        btnTogglePause.textContent = this.isPaused ? 'Resume' : 'Pause';
        this.ui.setMonitoringStatus(
          this.isPaused ? 'paused' : 'active',
          this.isPaused ? 'PAUSED' : 'ACTIVE TELEMETRY'
        );
      };
    }

    const btnExit = document.getElementById('btn-exit-dashboard');
    if (btnExit) {
      btnExit.onclick = () => this.stopMonitoringSession();
    }

    // Quick Check-in Triggers & Modals
    if (this.ui.btnStartQuickCheckin) {
      this.ui.btnStartQuickCheckin.onclick = () => this.startQuickCheckin();
    }
    if (this.ui.btnMainCheckNow) {
      this.ui.btnMainCheckNow.onclick = () => this.startQuickCheckin();
    }
    if (this.ui.btnStopCheckin) {
      this.ui.btnStopCheckin.onclick = () => this.cancelQuickCheckin(true);
    }
    if (this.ui.btnCheckinRetryLight) {
      this.ui.btnCheckinRetryLight.onclick = () => this.retryCheckin();
    }
    if (this.ui.btnCheckinContinueAnyway) {
      this.ui.btnCheckinContinueAnyway.onclick = () => this.continueCheckinAnyway();
    }
    if (this.ui.btnOpenDailyRecap) {
      this.ui.btnOpenDailyRecap.onclick = () => this.ui.openDailyRecap(this.sessionTimeSplit);
    }

    // HUD Toggles
    const btnToggleMesh = document.getElementById('btn-toggle-mesh');
    if (btnToggleMesh) {
      btnToggleMesh.onclick = () => {
        this.showMesh = !this.showMesh;
        btnToggleMesh.textContent = `Mesh: ${this.showMesh ? 'ON' : 'OFF'}`;
      };
    }

    const btnToggleRoi = document.getElementById('btn-toggle-roi');
    if (btnToggleRoi) {
      btnToggleRoi.onclick = () => {
        this.showRoi = !this.showRoi;
        btnToggleRoi.textContent = `ROI Targets: ${this.showRoi ? 'ON' : 'OFF'}`;
      };
    }

    const btnToggleDebug = document.getElementById('btn-toggle-debug');
    if (btnToggleDebug) {
      btnToggleDebug.onclick = () => {
        this.showDebugOverlay = !this.showDebugOverlay;
        btnToggleDebug.textContent = `Debug HUD: ${this.showDebugOverlay ? 'ON' : 'OFF'}`;
      };
    }

    // History Modal
    const btnHistory = document.getElementById('btn-view-history');
    const btnCloseHistory = document.getElementById('btn-close-history');
    const btnDoneHistory = document.getElementById('btn-done-history');
    const btnClearHistory = document.getElementById('btn-clear-history');

    if (btnHistory) {
      btnHistory.onclick = () => {
        const past = this.timeline.getSavedSessions();
        this.ui.openHistoryModal(past);
        this.timeline.renderTrendChart();
      };
    }
    if (btnCloseHistory) btnCloseHistory.onclick = () => this.ui.closeHistoryModal();
    if (btnDoneHistory) btnDoneHistory.onclick = () => this.ui.closeHistoryModal();
    if (btnClearHistory) {
      btnClearHistory.onclick = () => {
        localStorage.removeItem('pulsecam_sessions');
        this.ui.openHistoryModal([]);
      };
    }

    // Quick Box Breathing trigger
    const btnQuickBreathing = document.getElementById('btn-quick-breathing');
    if (btnQuickBreathing) {
      btnQuickBreathing.onclick = () => {
        this.suggestions.startBreathingExercise(this.ui.breathingContainer);
      };
    }

    // Workload Estimate "How is this calculated?" Modal
    const btnOpenWorkload = document.getElementById('btn-open-workload-info');
    const btnCloseWorkload = document.getElementById('btn-close-workload-info');
    const btnDoneWorkload = document.getElementById('btn-done-workload-info');

    if (btnOpenWorkload) {
      btnOpenWorkload.onclick = () => {
        this.ui.openWorkloadModal(this.latestHeuristics, Math.round(this.smoothFatigue.current));
      };
    }
    if (btnCloseWorkload) btnCloseWorkload.onclick = () => this.ui.closeWorkloadModal();
    if (btnDoneWorkload) btnDoneWorkload.onclick = () => this.ui.closeWorkloadModal();

    const btnTogglePip = document.getElementById('btn-toggle-pip');
    if (btnTogglePip) {
      btnTogglePip.onclick = () => this.pip.toggle();
    }
  }

  /**
   * Synchronize current state to Document Picture-in-Picture window or fallback widget
   */
  updatePipState() {
    if (!this.pip) return;
    const headline = this.ui.humanStatusHeadline ? this.ui.humanStatusHeadline.textContent.trim() : 'You seem calm and focused';
    this.pip.update({
      message: headline,
      state: this.currentHumanState || 'calm',
      isPaused: this.isPaused,
      cameraActive: this.camera.isRunning
    });
  }

  /**
   * Request Screen Wake Lock during Quick Check-in
   */
  async requestWakeLock() {
    if ('wakeLock' in navigator && typeof navigator.wakeLock.request === 'function') {
      try {
        this.wakeLockSentinel = await navigator.wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          this.wakeLockSentinel = null;
        });
      } catch (err) {
        console.warn('Wake Lock request skipped or denied:', err);
      }
    }
  }

  async releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        await this.wakeLockSentinel.release();
      } catch (err) {
        console.warn('Wake Lock release error:', err);
      }
      this.wakeLockSentinel = null;
    }
  }

  async enterFullscreen(element) {
    if (!element) return;
    try {
      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if (element.webkitRequestFullscreen) {
        await element.webkitRequestFullscreen();
      }
    } catch (err) {
      console.warn('Fullscreen request skipped or denied:', err);
    }
  }

  async exitFullscreen() {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Exit fullscreen error:', err);
    }
  }

  /**
   * Start 60-Second Screen-Lit Quick Check-in Mode
   * Implements clean state machine: IDLE -> PREPARING -> MEASURING -> RESULT -> IDLE.
   * On every start, fully resets all buffers, filters, worker state, and timers.
   */
  async startQuickCheckin() {
    if (this.checkinState === 'PREPARING' || this.checkinState === 'MEASURING') return;

    if (!this.isMonitoring || !this.camera.isRunning) {
      await this.startMonitoringSession(this.isDemoSession);
    }

    // 1. Clean state machine reset
    this.checkinState = 'PREPARING';
    this.isQuickCheckin = true;
    this.checkinStartTime = performance.now();
    this.checkinMeasurementStartTime = 0;
    this.checkinWarmedUp = false;
    this.checkinForceContinue = false;

    // 2. Full reset of worker analysis state, buffers, and filters
    this.worker.postMessage({ type: 'RESET_CHECKIN' });
    this.worker.postMessage({ type: 'SET_CHECKIN_MODE', active: true });

    // 3. Request Screen Wake Lock (exposure lock will settle after 2s if brightness is healthy)
    this.requestWakeLock();
    this.checkinExposureLocked = false;

    // 4. Enter fullscreen or fall back gracefully to full-window white overlay
    this.ui.setQuickCheckinActive(true);
    this.enterFullscreen(this.ui.quickCheckinOverlay);

    // 5. Reset UI progress & guidance
    this.ui.updateCheckinProgress(0);
    this.ui.updateCheckinLivePulse(null);
    this.ui.updateCheckinAlignment({
      faceDetected: false,
      isCentered: false,
      isGoodDistance: false,
      isFacingScreen: false,
      isStill: false,
      guidanceText: "For a better reading, turn your screen brightness up.",
      isLightingInvalid: false
    });

    // 6. Bind Esc key and fullscreen exit listeners to cancel cleanly
    this.cleanupCheckinListeners();

    this.checkinEscHandler = (e) => {
      if (e.key === 'Escape') {
        if (this.checkinState === 'PREPARING' || this.checkinState === 'MEASURING') {
          this.cancelQuickCheckin(true);
        }
      }
    };
    window.addEventListener('keydown', this.checkinEscHandler);

    this.checkinFullscreenHandler = () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (this.checkinState === 'PREPARING' || this.checkinState === 'MEASURING') {
          this.cancelQuickCheckin(true);
        }
      }
    };
    document.addEventListener('fullscreenchange', this.checkinFullscreenHandler);
    document.addEventListener('webkitfullscreenchange', this.checkinFullscreenHandler);
  }

  cleanupCheckinListeners() {
    if (this.checkinEscHandler) {
      window.removeEventListener('keydown', this.checkinEscHandler);
      this.checkinEscHandler = null;
    }
    if (this.checkinFullscreenHandler) {
      document.removeEventListener('fullscreenchange', this.checkinFullscreenHandler);
      document.removeEventListener('webkitfullscreenchange', this.checkinFullscreenHandler);
      this.checkinFullscreenHandler = null;
    }
  }

  /**
   * Cancel / abort Quick Check-in mode
   * Fully releases Wake Lock, exits fullscreen, clears listeners, and returns to IDLE.
   */
  cancelQuickCheckin(showCancelledModal = true) {
    if (this.checkinState === 'IDLE') return;

    this.checkinState = 'IDLE';
    this.isQuickCheckin = false;
    this.checkinWarmedUp = false;

    this.cleanupCheckinListeners();

    // 1. Deactivate worker rPPG mode and reset
    this.worker.postMessage({ type: 'SET_CHECKIN_MODE', active: false });

    // 2. Unlock camera constraints & release wake lock
    this.camera.unlockCameraConstraints();
    this.releaseWakeLock();
    this.exitFullscreen();

    // 3. Hide checkin overlay and live pulse
    this.ui.setQuickCheckinActive(false);
    this.ui.updateCheckinLivePulse(null);

    if (showCancelledModal) {
      this.ui.showCheckinCancelled(() => this.startQuickCheckin());
    }
  }

  /**
   * Stop quick checkin backwards compatibility alias
   */
  stopQuickCheckin(wasAborted = true) {
    this.cancelQuickCheckin(wasAborted);
  }

  /**
   * Retry check-in when lighting warning is displayed
   */
  retryCheckin() {
    if (this.ui.checkinLightingAdvisory) {
      this.ui.checkinLightingAdvisory.style.display = 'none';
    }
    this.cancelQuickCheckin(false);
    this.startQuickCheckin();
  }

  /**
   * Continue check-in anyway with lower confidence
   */
  continueCheckinAnyway() {
    this.checkinForceContinue = true;
    if (this.ui.checkinLightingAdvisory) {
      this.ui.checkinLightingAdvisory.style.display = 'none';
    }
    this.ui.showToast('ℹ️', 'Continuing check-in. Results will reflect estimated confidence.');
  }

  /**
   * Finish 60-second Quick Check-in and show friendly heart rate result card
   */
  completeQuickCheckin() {
    this.checkinState = 'RESULT';
    this.isQuickCheckin = false;

    this.cleanupCheckinListeners();
    this.worker.postMessage({ type: 'GET_CHECKIN_RESULT' });
    this.worker.postMessage({ type: 'SET_CHECKIN_MODE', active: false });
    this.camera.unlockCameraConstraints();
    this.releaseWakeLock();
    this.exitFullscreen();
    this.ui.setQuickCheckinActive(false);
    this.ui.updateCheckinLivePulse(null);

    const displayResult = (res) => {
      const curBpm = (res && res.medianBpm) ? res.medianBpm : this.smoothBPM.current;
      const fatigue = Math.round(this.smoothFatigue.current);
      const perclos = this.smoothPERCLOS.current;
      const baseBpm = this.activeBaseline?.heartRate?.mean ? Math.round(this.activeBaseline.heartRate.mean) : 72;

      let comparison = 'Right around your usual';
      if (curBpm > baseBpm + 4) {
        comparison = 'A little higher than your usual';
      } else if (curBpm < baseBpm - 4) {
        comparison = 'A little lower than usual';
      }

      if (res && res.hasReading && res.medianBpm > 42 && res.medianBpm < 185) {
        const roundedBpm = Math.round(res.medianBpm);
        const isElevated = fatigue > 60 || curBpm > baseBpm + 8;

        this.ui.showCheckinResult({
          bpm: roundedBpm,
          range: res.range || { min: roundedBpm - 2, max: roundedBpm + 2 },
          confidence: res.confidence || 'Good',
          comparison,
          isClearReading: true,
          onTakeReset: isElevated ? () => {
            this.ui.openResetBreak({
              initialBpm: roundedBpm,
              onFinishComparison: () => this.smoothBPM.current
            });
          } : null
        });

        // Save to local device history
        this.ui.saveCheckinEntry({
          id: Date.now().toString(),
          timestamp: Date.now(),
          bpm: roundedBpm,
          confidence: res.confidence || 'Good',
          comparison
        });
      } else {
        // Honest specific reason display (Phase 5)
        const code = res?.reasonCode || (this.latestRppgDiagnostics?.reasonNoReading || 'LOW_SNR');
        this.ui.showCheckinResult({
          bpm: null,
          confidence: 'Fair',
          isClearReading: false,
          reasonCode: code,
          onTryAgain: () => this.startQuickCheckin()
        });
      }

      // Update main UI headline calmly
      let headline = "You seem calm and focused";
      let supporting = "Check-in complete. Heart rhythm is steady and visual focus is balanced.";
      let action = "Keep going";
      let state = "calm";

      if (fatigue > 65 || perclos > 20) {
        headline = "You've been pushing hard, take a break";
        supporting = "Check-in complete. We noticed elevated fatigue in your heart rhythm and eyes.";
        action = "Take a 2-minute break";
        state = "tired";
      } else if (fatigue >= 35 || perclos > 13) {
        headline = "Time to rest your eyes soon";
        supporting = "Check-in complete. Subtle eye fatigue detected during your check-in.";
        action = "Look away for 20 seconds";
        state = "busy";
      }

      if (this.ui.humanStatusHeadline) {
        this.ui.humanStatusHeadline.textContent = headline;
        this.ui.humanStatusHeadline.className = `human-status-headline state-${state}`;
      }
      if (this.ui.humanSupportingText) {
        this.ui.humanSupportingText.textContent = supporting;
      }
      if (this.ui.suggestedActionLabel) {
        this.ui.suggestedActionLabel.textContent = action;
        this.ui.currentSuggestedAction = action;
      }

      this.sessionTimeSplit[state === 'tired' ? 'tiredSec' : state === 'busy' ? 'busySec' : 'calmSec'] += 60;
      this.ui.updateDaySummary(this.sessionTimeSplit);

      this.lastCheckinTime = Date.now();
      this.lastCheckinFatigue = fatigue;
      this.checkinState = 'IDLE';
      this.updatePipState();

      this.ui.showToast('✨', '60-second check-in complete! Result updated.');
    };

    if (this.latestCheckinResult) {
      displayResult(this.latestCheckinResult);
    } else {
      this.onCheckinResultResolve = (res) => displayResult(res);
      setTimeout(() => {
        if (this.onCheckinResultResolve) {
          this.onCheckinResultResolve(this.latestCheckinResult);
          this.onCheckinResultResolve = null;
        }
      }, 150);
    }
  }

  /**
   * Populate "For the curious" technical details modal with current telemetry snapshot
   */
  updateDetailsNow() {
    if (!this.ui.isDetailsPanelOpen) return;
    this.ui.updateDetailsPanel({
      bpm: this.smoothBPM.current,
      rppgConfidence: this.targetConfidence,
      blinkRate: this.smoothBlinkRate.current,
      perclos: this.smoothPERCLOS.current,
      ear: this.smoothEAR.current,
      faceDetected: this.latestDetection ? this.latestDetection.detected : false,
      sqi: this.latestSqi || {
        score: Math.round(this.smoothSQI.current),
        badge: this.smoothSQI.current >= 70 ? 'High' : this.smoothSQI.current >= 45 ? 'Moderate' : 'Low'
      },
      lighting: this.latestLighting,
      motion: this.latestMotion,
      baseline: this.activeBaseline,
      activeBaseline: this.activeBaseline,
      zScores: this.latestZScores,
      heuristics: this.latestHeuristics,
      workloadScore: Math.round(this.smoothFatigue.current),
      blink: this.latestBlink,
      rppgDiagnostics: this.latestRppgDiagnostics || this.latestRppg?.diagnostics
    });
  }

  /**
   * Start monitoring session
   */
  async startMonitoringSession(isDemo = false, videoFile = null) {
    const errorEl = document.getElementById('consent-error-msg');
    if (errorEl) errorEl.style.display = 'none';

    this.isDemoSession = isDemo;

    try {
      this.ui.btnConsentProceed.disabled = true;
      this.ui.btnConsentProceed.textContent = videoFile
        ? 'Loading Local Test Video...'
        : isDemo
        ? 'Engaging Simulated Demo Stream...'
        : 'Initializing Camera Hardware...';

      // 1. Initialize local camera stream or test video
      if (videoFile) {
        await this.camera.startVideoFile(videoFile);
      } else if (isDemo) {
        await this.camera.startDemoMode();
      } else {
        await this.camera.start();
      }

      this.ui.setCameraActive(true);

      // Synchronize canvas dimensions
      if (this.hudCanvas) {
        this.hudCanvas.width = this.camera.width;
        this.hudCanvas.height = this.camera.height;
      }

      this.ui.btnConsentProceed.textContent = 'Syncing Offscreen Worker Model...';

      // 2. Ensure worker is ready
      if (!this.isWorkerReady) {
        this.worker.postMessage({ type: 'INIT' });
        // Wait up to 3 seconds for worker readiness
        let attempts = 0;
        while (!this.isWorkerReady && attempts < 15) {
          await new Promise((r) => setTimeout(r, 200));
          attempts++;
        }
      }

      // 2.5 Attach MediaStreamTrackProcessor for background processing where supported
      const track = this.camera.getVideoTrack();
      const hasProcessor = typeof MediaStreamTrackProcessor !== 'undefined';
      if (hasProcessor && track) {
        try {
          const processor = new MediaStreamTrackProcessor({ track });
          this.worker.postMessage({
            type: 'ATTACH_TRACK_STREAM',
            readable: processor.readable,
            width: this.camera.width,
            height: this.camera.height
          }, [processor.readable]);
          this.hasBackgroundProcessor = true;
          console.log('[PulseCam] Native MediaStreamTrackProcessor connected to Web Worker for background processing.');
        } catch (err) {
          console.warn('[PulseCam] MediaStreamTrackProcessor could not be attached:', err);
          this.hasBackgroundProcessor = false;
        }
      } else {
        this.hasBackgroundProcessor = false;
      }

      const noticeEl = document.getElementById('bg-compatibility-notice');
      if (noticeEl) {
        noticeEl.style.display = this.hasBackgroundProcessor ? 'none' : 'flex';
      }

      // 3. Switch to Dashboard View
      this.ui.showView('dashboard');
      this.isMonitoring = true;
      this.isPaused = false;
      this.initVideoFrameCallback();

      // Run 3-second lighting-quality check before any measurement starts
      this.startPreflightCheck();

      // Start Session Timer (only counts during active physiological measurement)
      if (this.sessionTimerInterval) clearInterval(this.sessionTimerInterval);
      this.sessionTimerInterval = setInterval(() => {
        if (this.isMonitoring && !this.isPaused && this.sessionState === 'MEASURING') {
          const elapsedSec = Math.floor((Date.now() - this.sessionStartTime) / 1000);
          this.ui.updateSessionTimer(elapsedSec);
        }
      }, 1000);
    } catch (err) {
      console.error('Session start error:', err);
      if (errorEl) {
        errorEl.innerHTML = `${err.message || 'Camera acquisition failed.'}<br><span style="color: var(--accent); cursor: pointer; text-decoration: underline; display: inline-block; margin-top: 4px;" id="link-start-demo-fallback">Launch with Simulated Optical Demo Stream instead.</span>`;
        errorEl.style.display = 'block';

        const linkFallback = document.getElementById('link-start-demo-fallback');
        if (linkFallback) {
          linkFallback.onclick = () => this.startMonitoringSession(true);
        }
      }
      this.ui.btnConsentProceed.disabled = false;
      this.ui.btnConsentProceed.textContent = 'Authorize & Enter Workspace';
      this.camera.stop();
      this.ui.setCameraActive(false);
      this.sessionState = 'IDLE';
    }
  }

  /**
   * Run a dedicated 3-second pre-flight lighting-quality verification
   * Computes mean luminance, luminance variance across the face ROI, and face confidence.
   * Blocks measurement if face is not clearly visible or illumination is too dark / overexposed.
   */
  startPreflightCheck() {
    this.sessionState = 'PREFLIGHT';
    this.preflightStartTime = performance.now();
    this.preflightSamples = [];
    this.consecutiveGoodLightingFrames = 0;
    this.consecutiveBadLightingFrames = 0;

    // Block physiological measurement in Web Worker
    this.worker.postMessage({ type: 'SET_MEASUREMENT_ACTIVE', active: false });

    // Reset visual smoothed values
    this.smoothBPM.reset(72);
    this.smoothFatigue.reset(10);
    this.smoothHRV.reset(45);
    this.smoothBlinkRate.reset(16);
    this.smoothEAR.reset(0.3);
    this.smoothPERCLOS.reset(0);
    this.smoothSQI.reset(0);
    this.smoothWaveform.reset(0);

    this.ui.setMonitoringStatus('calibrating', 'VERIFYING LIGHTING (3s)');
    this.ui.setInsufficientLighting(false);
    this.ui.updateCalibrationView({ isCalibrating: false });
    this.ui.updatePreflightLightingView({
      isActive: true,
      progress: 0,
      remainingSec: 3.0,
      latest: this.latestLighting
    });
  }

  startGuidedCalibration(durationMs = 120000) {
    this.selectedCalibDurationMs = durationMs;
    this.worker.postMessage({ type: 'SET_MEASUREMENT_ACTIVE', active: true });
    this.worker.postMessage({ type: 'START_CALIBRATION', durationMs });
    this.ui.setMonitoringStatus('calibrating', 'CALIBRATING BASELINE');
    this.ui.isWhitePanelDismissed = false; // ensure neutral-white screen lighting panel is shown
    this.ui.updateCalibrationView({
      isCalibrating: true,
      progress: 0,
      remainingSec: Math.ceil(durationMs / 1000),
      totalSec: Math.round(durationMs / 1000),
      phaseTitle: 'Stage 1 of 4: Optical Lock & Stillness',
      message: 'Sit comfortably and look directly at the screen. Minimizing head motion...'
    });
  }

  cancelGuidedCalibration() {
    this.worker.postMessage({ type: 'RESET' });
    this.ui.updateCalibrationView({ isCalibrating: false });
    if (this.activeBaseline) {
      this.ui.setMonitoringStatus('active', 'ACTIVE TELEMETRY');
    } else {
      this.ui.setMonitoringStatus('paused', 'CALIBRATION CANCELLED');
    }
  }

  stopMonitoringSession() {
    this.sessionState = 'IDLE';
    this.isMonitoring = false;
    if (this.sessionTimerInterval) {
      clearInterval(this.sessionTimerInterval);
      this.sessionTimerInterval = null;
    }

    // Save summary snapshot
    this.timeline.saveSessionSummary();

    // Release camera hardware
    this.camera.stop();
    this.ui.setCameraActive(false);
    this.ui.updatePreflightLightingView({ isActive: false });
    this.ui.setInsufficientLighting(false);
    this.ui.setLowFpsWarning(false);
    this.ui.updateDebugHud(null, null, null, false);
    this.ui.updateCalibrationView({ isCalibrating: false });
    if (this.alertSystem) {
      this.alertSystem.dismiss();
    }
    if (this.isQuickCheckin) {
      this.stopQuickCheckin(false);
    }

    if (this.hasBackgroundProcessor) {
      this.worker.postMessage({ type: 'STOP_TRACK_STREAM' });
      this.hasBackgroundProcessor = false;
    }
    if (this.pip) {
      this.pip.close();
    }

    this.ui.btnConsentProceed.disabled = false;
    this.ui.btnConsentProceed.textContent = 'Authorize & Enter Workspace';
    this.ui.showView('landing');
  }

  /**
   * Unified Single requestAnimationFrame Loop
   * Dynamically tracks display refresh rate (60/120/144 Hz) with delta time.
   * Only renders UI: interpolates values, renders canvases, and batches transforms.
   */
  renderLoop(now) {
    this.animationFrameId = requestAnimationFrame(this.renderLoop);

    // 1. Delta-time calculation (clamped to prevent jumps on tab unfocus)
    const dt = Math.min(0.08, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;
    this.currentDt = dt;

    // 2. Measure display UI refresh rate (v-sync) & Active Frame Rate
    this.frameCount++;
    if (now - this.lastFpsCalc >= 500) {
      this.currentUiFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsCalc));
      this.frameCount = 0;
      this.lastFpsCalc = now;
    }

    // Monitor Frame Rate: Warn if rate drops below 20 FPS
    const activeFps = this.pipelineFps > 0 ? this.pipelineFps : this.currentUiFps;
    if (this.isMonitoring && this.camera.isRunning) {
      if (activeFps < 20) {
        this.ui.setLowFpsWarning(true, activeFps);
      } else {
        this.ui.setLowFpsWarning(false, activeFps);
      }
    } else {
      this.ui.setLowFpsWarning(false, activeFps);
    }

    // 3. Dispatch frame to Offscreen Web Worker if camera is streaming & worker is ready (Fallback mode only)
    if (
      !this.hasBackgroundProcessor &&
      this.isMonitoring &&
      !this.isPaused &&
      !this.isWorkerBusy &&
      this.camera.video &&
      this.camera.video.readyState >= 2
    ) {
      this.dispatchFrameToWorker(now);
    }

    // 3.5. State Machine: Pre-Flight Lighting Check (3s) & Continuous Optical Monitoring
    if (this.isMonitoring && this.camera.isRunning) {
      if (this.sessionState === 'PREFLIGHT') {
        const elapsed = now - this.preflightStartTime;
        const progress = Math.min(1.0, elapsed / this.preflightDuration);
        const remainingSec = Math.max(0, (this.preflightDuration - elapsed) / 1000);

        if (this.latestLighting) {
          this.preflightSamples.push(this.latestLighting);
        }

        this.ui.updatePreflightLightingView({
          isActive: true,
          progress,
          remainingSec,
          latest: this.latestLighting
        });

        if (elapsed >= this.preflightDuration) {
          // Pre-flight check period concluded: evaluate face visibility and lighting stability
          const validSamples = this.preflightSamples.filter((s) => s && s.isValid).length;
          const totalSamples = this.preflightSamples.length;
          const validRatio = totalSamples > 0 ? validSamples / totalSamples : 0;
          const latestValid = Boolean(this.latestLighting && this.latestLighting.isValid);
          const passed = validRatio >= 0.70 && latestValid;

          this.ui.updatePreflightLightingView({ isActive: false });

          if (passed) {
            // UNBLOCK: Optical lighting passed, start physiological measurement
            this.sessionState = 'MEASURING';
            this.sessionStartTime = Date.now();
            this.worker.postMessage({ type: 'SET_MEASUREMENT_ACTIVE', active: true });
            this.worker.postMessage({ type: 'RESET' });
            this.ui.setInsufficientLighting(false);

            // First-use calibration check:
            if (!this.activeBaseline) {
              // NO BASELINE SAVED: Launch first-use guided calibration immediately!
              this.startGuidedCalibration(this.selectedCalibDurationMs);
            } else {
              // EXISTING BASELINE: Set active baseline and prompt if stale (> 7 days)
              this.worker.postMessage({ type: 'SET_ACTIVE_BASELINE', baseline: this.activeBaseline });
              this.ui.setHeaderBaseline(this.activeBaseline);
              if (this.isBaselineStale) {
                this.ui.showStaleBaselinePrompt(
                  true,
                  this.baselineAgeDays,
                  () => this.startGuidedCalibration(120000),
                  () => this.ui.showStaleBaselinePrompt(false)
                );
              }
              this.ui.setMonitoringStatus('active', 'ACTIVE TELEMETRY');
            }
          } else {
            // BLOCK: Lighting is insufficient (too dark/overexposed or face not clearly visible)
            this.sessionState = 'BLOCKED_LIGHTING';
            this.worker.postMessage({ type: 'SET_MEASUREMENT_ACTIVE', active: false });
            this.ui.setMonitoringStatus('alert', 'LIGHTING INSUFFICIENT');
            this.ui.setInsufficientLighting(
              true,
              Object.assign({}, this.latestLighting || {}, { isBlocked: true })
            );
          }
        }
      } else if (this.sessionState === 'BLOCKED_LIGHTING') {
        // Measurement remains blocked; update docket with live readings
        this.ui.setInsufficientLighting(
          true,
          Object.assign({}, this.latestLighting || {}, { isBlocked: true })
        );

        if (this.latestLighting && this.latestLighting.isValid) {
          this.consecutiveGoodLightingFrames++;
          // If lighting stabilizes for ~1.5s (45 frames), automatically re-run 3s verification
          if (this.consecutiveGoodLightingFrames >= 45) {
            this.startPreflightCheck();
          }
        } else {
          this.consecutiveGoodLightingFrames = 0;
        }
      } else if (this.sessionState === 'MEASURING') {
        // Measurement active; continuous lighting check
        if (this.latestLighting && !this.latestLighting.isValid) {
          this.consecutiveBadLightingFrames++;
          // If lighting fails for 4 consecutive frames (~130ms), pause measurement immediately
          if (this.consecutiveBadLightingFrames >= 4) {
            this.sessionState = 'PAUSED_LIGHTING';
            this.worker.postMessage({ type: 'SET_MEASUREMENT_ACTIVE', active: false });
            this.ui.setMonitoringStatus('paused', 'PAUSED (INSUFFICIENT LIGHTING)');
            this.ui.setInsufficientLighting(
              true,
              Object.assign({}, this.latestLighting, { isBlocked: false })
            );
          }
        } else {
          this.consecutiveBadLightingFrames = 0;
        }
      } else if (this.sessionState === 'PAUSED_LIGHTING') {
        // Measurement paused due to poor lighting; update docket with live metrics
        this.ui.setInsufficientLighting(
          true,
          Object.assign({}, this.latestLighting || {}, { isBlocked: false })
        );

        if (this.latestLighting && this.latestLighting.isValid) {
          this.consecutiveGoodLightingFrames++;
          // If lighting recovers for ~25 frames (~800ms), auto-resume measurement
          if (this.consecutiveGoodLightingFrames >= 25) {
            this.sessionState = 'MEASURING';
            this.consecutiveGoodLightingFrames = 0;
            this.consecutiveBadLightingFrames = 0;
            this.worker.postMessage({ type: 'SET_MEASUREMENT_ACTIVE', active: true });
            this.ui.setMonitoringStatus('active', 'ACTIVE TELEMETRY');
            this.ui.setInsufficientLighting(false);
          }
        } else {
          this.consecutiveGoodLightingFrames = 0;
        }
      }
    }

    // 4. Interpolate telemetry values smoothly toward worker targets using delta-time
    this.smoothBPM.setTarget(this.targetBPM);
    this.smoothFatigue.setTarget(this.targetFatigue);
    this.smoothHRV.setTarget(this.targetHRV);
    this.smoothBlinkRate.setTarget(this.targetBlinkRate);
    this.smoothEAR.setTarget(this.targetEAR);
    this.smoothPERCLOS.setTarget(this.targetPERCLOS);
    this.smoothSQI.setTarget(this.targetSQI);
    this.smoothLighting.setTarget(this.targetLighting);
    this.smoothMotion.setTarget(this.targetMotion);
    this.smoothWaveform.setTarget(this.targetWaveform);

    const curBpm = this.smoothBPM.update(dt);
    const curFatigue = this.smoothFatigue.update(dt);
    const curHrv = this.smoothHRV.update(dt);
    const curBlink = this.smoothBlinkRate.update(dt);
    const curEar = this.smoothEAR.update(dt);
    const curPerclos = this.smoothPERCLOS.update(dt);
    const curSqi = this.smoothSQI.update(dt);
    const curLighting = this.smoothLighting.update(dt);
    const curMotion = this.smoothMotion.update(dt);
    const curWaveform = this.smoothWaveform.update(dt);

    // 5. Draw Canvas Waveform Oscilloscope (Only when measurement is active)
    if (this.isMonitoring && !this.isPaused && this.sessionState === 'MEASURING') {
      this.timeline.pushWaveform(curWaveform);
      this.timeline.logInterval({
        bpm: Math.round(curBpm),
        fatigue: Math.round(curFatigue),
        blinkRate: Math.round(curBlink)
      });
    }

    // 6. Camera Mirror Canvas (Clean natural mirror: no landmark or reticle overlays)
    if (this.hudCtx && this.hudCanvas) {
      this.hudCtx.clearRect(0, 0, this.hudCanvas.width, this.hudCanvas.height);
      if (this.isMonitoring && !this.camera.isRunning) {
        this.hudCtx.save();
        this.hudCtx.scale(-1, 1);
        this.hudCtx.fillStyle = 'rgba(238, 235, 230, 0.85)';
        this.hudCtx.font = '14px DM Sans, sans-serif';
        this.hudCtx.textAlign = 'center';
        this.hudCtx.fillText('Camera stopped', -this.hudCanvas.width / 2, this.hudCanvas.height / 2);
        this.hudCtx.restore();
      }
    }

    // 6.5. Accumulate Session Time Split for Day Summary Bar (Calm / Busy / Tired)
    if (this.isMonitoring && !this.isPaused && this.sessionState === 'MEASURING') {
      if (this.currentHumanState === 'tired') {
        this.sessionTimeSplit.tiredSec += dt;
      } else if (this.currentHumanState === 'busy') {
        this.sessionTimeSplit.busySec += dt;
      } else {
        this.sessionTimeSplit.calmSec += dt;
      }
    }

    // 7. Update UI Human Wellness Interface in Plain Language
    if (this.isMonitoring) {
      const elapsedSec = this.sessionStartTime ? Math.floor((Date.now() - this.sessionStartTime) / 1000) : 0;

      // Combine continuous Background Watch with fading Quick Check-in supporting context (fades over 60 min)
      let combinedFatigue = Math.round(curFatigue);
      let combinedConfidence = Math.round(curSqi);

      if (this.latestBackgroundWatch && !this.latestBackgroundWatch.discarded) {
        const bgFatigue = this.latestBackgroundWatch.fatiguePoints !== undefined
          ? this.latestBackgroundWatch.fatiguePoints
          : curFatigue;
        const nowMs = Date.now();
        const checkinAgeMs = this.lastCheckinTime ? (nowMs - this.lastCheckinTime) : Infinity;
        const checkinFadingWeight = Math.max(0, 1 - checkinAgeMs / (60 * 60 * 1000)); // fades over 60 mins

        if (checkinFadingWeight > 0 && this.lastCheckinFatigue !== undefined) {
          // Quick Check-in provides supporting context
          combinedFatigue = Math.round((1 - 0.28 * checkinFadingWeight) * bgFatigue + (0.28 * checkinFadingWeight) * this.lastCheckinFatigue);
          combinedConfidence = Math.min(95, Math.max(35, Math.round(this.latestBackgroundWatch.confidence)));
        } else {
          // Background cues alone: slightly lower confidence cap (82%)
          combinedFatigue = Math.round(bgFatigue);
          combinedConfidence = Math.min(82, Math.max(30, Math.round(this.latestBackgroundWatch.confidence)));
        }
      }

      this.currentHumanState = this.ui.updateTelemetry({
        sessionElapsedSec: elapsedSec,
        sessionTimeSplit: this.sessionTimeSplit,
        sessionState: this.sessionState,
        cameraActive: this.camera.isRunning,
        faceDetected: this.latestDetection ? this.latestDetection.detected : false,
        workloadScore: combinedFatigue,
        fatigueScore: combinedFatigue,
        blinkRate: Math.round(curBlink),
        perclos: curPerclos,
        rppgConfidence: this.sessionState === 'MEASURING' ? this.targetConfidence : 0,
        sqi: {
          score: combinedConfidence,
          badge: combinedConfidence >= 70 ? 'High' : combinedConfidence >= 45 ? 'Medium' : 'Low',
          isLow: combinedConfidence < 45
        },
        lighting: {
          meanLuminance: curLighting,
          variance: this.latestLighting ? this.latestLighting.variance : 0,
          level: this.latestLighting ? this.latestLighting.level : 'optimal',
          isValid: this.latestLighting ? this.latestLighting.isValid : true
        },
        isBlockedLighting: this.sessionState === 'BLOCKED_LIGHTING',
        isPausedLighting: this.sessionState === 'PAUSED_LIGHTING'
      });

      // Synchronize Picture-in-Picture window or fallback widget
      this.updatePipState();

      if (this.latestCalibration && this.latestCalibration.isCalibrating) {
        this.ui.updateCalibrationView(this.latestCalibration);
      } else if (this.latestCalibration && this.latestCalibration.isComplete) {
        this.ui.updateCalibrationView({ isCalibrating: false });
        if (this.sessionState === 'MEASURING') {
          this.ui.setMonitoringStatus('active', 'ACTIVE TELEMETRY');
        }
      } else if (this.sessionState !== 'MEASURING') {
        this.ui.updateCalibrationView({ isCalibrating: false });
      }

      // 8. Evaluate Calm Top Alert System (High Confidence Only, 15-min cooldown, at most 1 alert)
      if (this.sessionState === 'MEASURING') {
        this.alertSystem.evaluate({
          cameraActive: this.camera.isRunning,
          faceDetected: this.latestDetection ? this.latestDetection.detected : false,
          sessionState: this.sessionState,
          sessionElapsedSec: elapsedSec,
          workloadScore: Math.round(curFatigue),
          fatigueScore: Math.round(curFatigue),
          blinkRate: Math.round(curBlink),
          perclos: curPerclos,
          rppgConfidence: this.sessionState === 'MEASURING' ? this.targetConfidence : 0,
          sqi: this.latestSqi || {
            score: Math.round(curSqi),
            badge: curSqi >= 70 ? 'High' : curSqi >= 45 ? 'Medium' : 'Low',
            isLow: curSqi < 45
          },
          lighting: {
            isValid: this.latestLighting ? this.latestLighting.isValid : true
          },
          isBlockedLighting: this.sessionState === 'BLOCKED_LIGHTING',
          isPausedLighting: this.sessionState === 'PAUSED_LIGHTING'
        }, dt);
      }

      // 8.5. Live Telemetry Update for "For the curious" Details Modal (Only when open)
      if (this.ui.isDetailsPanelOpen) {
        this.updateDetailsNow();
      }

      // 8.8. Quick Check-in Mode State Machine Loop (idle -> preparing -> measuring -> result)
      if (this.isQuickCheckin) {
        if (this.checkinState === 'PREPARING') {
          // Phase 1: 2-second auto-exposure settling warm-up delay; first frames discarded
          const prepElapsed = now - this.checkinStartTime;
          this.ui.updateCheckinProgress(0);
          this.ui.updateCheckinLivePulse(null);
          this.ui.updateCheckinAlignment({
            faceDetected: Boolean(this.latestDetection && this.latestDetection.detected),
            isCentered: false,
            isGoodDistance: false,
            isFacingScreen: false,
            isStill: false,
            guidanceText: "For a better reading, turn your screen brightness up.",
            isLightingInvalid: false
          });

          if (prepElapsed >= this.checkinWarmupDuration) {
            this.checkinWarmedUp = true;
            this.checkinState = 'MEASURING';
            this.checkinMeasurementStartTime = performance.now();
            this.worker.postMessage({ type: 'RESET_CHECKIN' });

            // Exposure: let auto-exposure settle for 2 seconds, then lock only if face brightness is in healthy range (90-180)
            const faceBrightness = this.latestRppgDiagnostics?.meanFaceBrightness ?? (this.latestLighting?.meanLuminance ?? 100);
            if (faceBrightness >= 90 && faceBrightness <= 180) {
              this.camera.lockCameraConstraints();
              this.checkinExposureLocked = true;
            }
          }
        } else if (this.checkinState === 'MEASURING') {
          const elapsed = now - this.checkinMeasurementStartTime;
          const progress = Math.min(1.0, elapsed / this.checkinDuration);
          this.ui.updateCheckinProgress(progress);

          const det = this.latestDetection;
          let guidanceText = "Hold still";
          let isCentered = false;
          let isGoodDistance = false;
          let isFacingScreen = false;
          let isStill = !(this.latestMotion && this.latestMotion.isNoisy);

          if (det && det.detected && det.faceBox) {
            const box = det.faceBox;
            const width = this.camera.width || 640;
            const height = this.camera.height || 480;
            const centerX = (box.x + box.width / 2) / width;
            const centerY = (box.y + box.height / 2) / height;
            const faceHeightFrac = box.height / height;
            const pose = det.headPose || { yaw: 0, pitch: 0, roll: 0 };

            isCentered = centerX >= 0.36 && centerX <= 0.64 && centerY >= 0.22 && centerY <= 0.78;
            const isTooFar = faceHeightFrac < 0.32;
            const isTooClose = faceHeightFrac > 0.72;
            isGoodDistance = !isTooFar && !isTooClose;
            isFacingScreen = Math.abs(pose.yaw) <= 14 && Math.abs(pose.pitch) <= 16;

            const faceLum = this.latestRppgDiagnostics?.meanFaceBrightness ?? (this.latestLighting ? this.latestLighting.meanLuminance : 60);

            // Per-ROI saturation check (Phase 2)
            const roiStats = this.latestRppgDiagnostics?.roiStats;
            let avgSat = 0;
            if (roiStats) {
              const satTotal = (roiStats.forehead?.saturationPct || 0) + (roiStats.leftCheek?.saturationPct || 0) + (roiStats.rightCheek?.saturationPct || 0);
              avgSat = satTotal / 3;
            }

            if (!isCentered) {
              guidanceText = "Center your face";
            } else if (isTooFar) {
              guidanceText = "Move slightly closer";
            } else if (isTooClose) {
              guidanceText = "Move back a bit";
            } else if (!isFacingScreen) {
              guidanceText = "Look straight at the screen";
            } else if (avgSat > 0.05) {
              guidanceText = "Your screen is very bright for this camera. Lean back a little or lower the brightness slightly.";
            } else if (faceLum < 70) {
              guidanceText = "A bit more light on your face, please.";
            } else if (!isStill) {
              guidanceText = "Hold still";
            } else if (elapsed < 12000) {
              // Phase 5: First 12 seconds calm countdown progress with alignment oval, never blank screen
              const secLeft = Math.max(1, Math.ceil((12000 - elapsed) / 1000));
              guidanceText = `Measuring... ${secLeft}s`;
            } else {
              guidanceText = "Hold still";
            }

            const isLightingInvalid = Boolean(!this.checkinForceContinue && this.latestLighting && !this.latestLighting.isValid);

            this.ui.updateCheckinAlignment({
              faceDetected: true,
              isCentered,
              isGoodDistance,
              isFacingScreen,
              isStill,
              guidanceText,
              isLightingInvalid
            });
          } else {
            this.ui.updateCheckinAlignment({
              faceDetected: false,
              isCentered: false,
              isGoodDistance: false,
              isFacingScreen: false,
              isStill: false,
              guidanceText: "Center your face in the oval",
              isLightingInvalid: Boolean(!this.checkinForceContinue && this.latestLighting && !this.latestLighting.isValid)
            });
          }

          // Phase 3: Live gently updating pulse value during last 20-30s once signal stabilizes
          if (elapsed >= 30000) {
            const curBpm = this.smoothBPM.current;
            if (curBpm > 45 && curBpm < 185) {
              this.ui.updateCheckinLivePulse(curBpm);
            } else {
              this.ui.updateCheckinLivePulse(null);
            }
          } else {
            this.ui.updateCheckinLivePulse(null);
          }

          if (elapsed >= this.checkinDuration) {
            this.completeQuickCheckin();
          }
        }
      } else {
        // Phase 4c: Screen-distance nudge in Background Watch
        if (this.sessionState === 'MEASURING' && this.latestDetection && this.latestDetection.detected && this.latestDetection.faceBox) {
          const height = this.camera.height || 480;
          const faceHeightFrac = this.latestDetection.faceBox.height / height;
          if (faceHeightFrac > 0.65) {
            this.consecutiveCloseFrames = (this.consecutiveCloseFrames || 0) + 1;
            if (this.consecutiveCloseFrames > 120 && (now - this.lastCloseNudgeTime > 300000)) {
              this.lastCloseNudgeTime = now;
              this.consecutiveCloseFrames = 0;
              this.alertSystem.showAlert({
                id: 'screen_distance_nudge',
                text: "You're sitting quite close, try leaning back a little."
              });
            }
          } else {
            this.consecutiveCloseFrames = Math.max(0, (this.consecutiveCloseFrames || 0) - 1);
          }
        }

        // Phase 4e: Smart reminders when combined fatigue persists across background windows
        if (this.sessionState === 'MEASURING' && combinedFatigue > 60) {
          this.sustainedHighFatigueWindows = (this.sustainedHighFatigueWindows || 0) + dt;
          if (this.sustainedHighFatigueWindows > 180 && (now - this.lastSmartReminderTime > 1200000)) {
            this.lastSmartReminderTime = now;
            this.sustainedHighFatigueWindows = 0;
            this.alertSystem.showAlert({
              id: 'smart_fatigue_break',
              text: "You've been focused with high fatigue for a while. A short break could help.",
              actionLabel: "Take a break",
              action: () => this.ui.handleSuggestedAction('Take a 2-minute break')
            });
          }
        } else {
          this.sustainedHighFatigueWindows = Math.max(0, (this.sustainedHighFatigueWindows || 0) - dt * 0.5);
        }
      }
    }

    // 9. Periodic Contextual Suggestions Check (Every 4 seconds)
    if (
      this.isMonitoring &&
      this.latestHeuristics &&
      (!this.lastSuggestionTime || now - this.lastSuggestionTime > 4000)
    ) {
      this.lastSuggestionTime = now;
      const suggestionsList = this.suggestions.getSuggestions({
        stressState: this.latestHeuristics.stressState,
        fatigueScore: curFatigue,
        blinkRate: curBlink,
        activeCues: this.latestHeuristics.activeCues,
        lightingLevel: this.latestLighting ? this.latestLighting.level : 'optimal'
      });

      this.ui.renderSuggestions(suggestionsList, (item) => {
        if (item.actionType === 'BREATHING') {
          this.suggestions.startBreathingExercise(this.ui.breathingContainer);
        } else if (item.actionType === 'EYE_BREAK') {
          alert('Ocular Relief Interval: Look at an object 20 feet away for 20 seconds.');
        }
      });
    }
  }

  /**
   * Hardware frame presentation callback for accurate frame timestamps and jitter analysis
   */
  initVideoFrameCallback() {
    if (!this.camera.video || typeof this.camera.video.requestVideoFrameCallback !== 'function') return;
    const onFrame = (now, metadata) => {
      if (this.camera.isRunning) {
        this.lastHardwareTimestamp = metadata?.presentationTime || now;
        this.camera.video.requestVideoFrameCallback(onFrame);
      }
    };
    this.camera.video.requestVideoFrameCallback(onFrame);
  }

  /**
   * Transfer video frame as zero-copy ImageBitmap to Web Worker
   */
  dispatchFrameToWorker(timestamp) {
    if (!this.camera.video || !this.camera.isRunning || this.isWorkerBusy) return;

    const frameTimestamp = this.lastHardwareTimestamp || timestamp;
    this.isWorkerBusy = true;
    createImageBitmap(this.camera.video)
      .then((bitmap) => {
        if (!this.isMonitoring || this.isPaused) {
          bitmap.close();
          this.isWorkerBusy = false;
          return;
        }

        // Transfer ImageBitmap with zero memory copy
        this.worker.postMessage(
          {
            type: 'PROCESS_FRAME',
            bitmap,
            timestamp: frameTimestamp,
            width: this.camera.width,
            height: this.camera.height,
            isDemo: Boolean(this.isDemoSession)
          },
          [bitmap]
        );
      })
      .catch((err) => {
        this.isWorkerBusy = false;
      });
  }
}

// Bootstrap on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  new PulseCamApp();
});
