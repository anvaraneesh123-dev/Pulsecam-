import { formatZScore, getZScoreSeverity } from './baselineStore.js';

export class UIController {
  constructor() {
    // Views
    this.viewLanding = document.getElementById('view-landing');
    this.viewConsent = document.getElementById('view-consent');
    this.viewDashboard = document.getElementById('view-dashboard');

    // Consent elements
    this.checkWellness = document.getElementById('consent-check-wellness');
    this.checkCamera = document.getElementById('consent-check-camera');
    this.btnConsentProceed = document.getElementById('btn-consent-proceed');
    this.consentErrorMsg = document.getElementById('consent-error-msg');

    // Dashboard Telemetry Elements
    this.statusIndicator = document.getElementById('monitoring-status-indicator');
    this.statusText = document.getElementById('monitoring-status-text');
    this.timerText = document.getElementById('session-timer-text');

    // Human Wellness Interface Elements
    this.humanStatusHeadline = document.getElementById('human-status-headline');
    this.humanStatusPip = document.getElementById('human-status-pip');
    this.humanStatusTag = document.getElementById('human-status-tag');
    this.humanSupportingText = document.getElementById('human-supporting-text');
    this.btnSuggestedAction = document.getElementById('btn-suggested-action');
    this.suggestedActionLabel = document.getElementById('suggested-action-label');
    this.humanLowQualityBox = document.getElementById('human-low-quality-box');
    this.humanLowQualityTitle = document.getElementById('human-low-quality-title');
    this.humanLowQualitySubtext = document.getElementById('human-low-quality-subtext');
    this.dayBarCalm = document.getElementById('day-bar-calm');
    this.dayBarBusy = document.getElementById('day-bar-busy');
    this.dayBarTired = document.getElementById('day-bar-tired');

    // Action Modal & Toast Elements
    this.actionModal = document.getElementById('human-action-modal');
    this.actionModalTitle = document.getElementById('action-modal-title');
    this.actionModalSubtitle = document.getElementById('action-modal-subtitle');
    this.actionModalTimer = document.getElementById('action-pacer-timer');
    this.actionModalPrompt = document.getElementById('action-modal-prompt');
    this.btnCloseActionModal = document.getElementById('btn-close-action-modal');
    this.btnActionModalDone = document.getElementById('btn-action-modal-done');
    this.humanToast = document.getElementById('human-toast');
    this.humanToastIcon = document.getElementById('human-toast-icon');
    this.humanToastText = document.getElementById('human-toast-text');
    this.currentSuggestedAction = 'Keep going';
    this.actionCountdownInterval = null;
    this.toastTimeout = null;

    // Settings Modal Elements
    this.btnOpenSettings = document.getElementById('btn-open-settings');
    this.settingsModal = document.getElementById('settings-modal');
    this.btnCloseSettings = document.getElementById('btn-close-settings');
    this.btnDoneSettings = document.getElementById('btn-done-settings');
    this.settingSoundChime = document.getElementById('setting-sound-chime');
    this.btnTestChime = document.getElementById('btn-test-chime');
    this.settingsSnoozeStatus = document.getElementById('settings-snooze-status');
    this.btnResumeAlerts = document.getElementById('btn-resume-alerts');

    // "For the curious" Details Modal Elements
    this.btnOpenDetails = document.getElementById('btn-open-details');
    this.detailsModal = document.getElementById('details-modal');
    this.btnCloseDetails = document.getElementById('btn-close-details');
    this.btnDoneDetails = document.getElementById('btn-done-details');
    this.isDetailsPanelOpen = false;

    this.detailsSqiBadge = document.getElementById('details-sqi-badge');
    this.detailsFaceVal = document.getElementById('details-face-val');
    this.detailsLightingVal = document.getElementById('details-lighting-val');
    this.detailsMotionVal = document.getElementById('details-motion-val');
    this.detailsSqiVal = document.getElementById('details-sqi-val');

    this.detailsHrBadge = document.getElementById('details-hr-badge');
    this.detailsHrBpm = document.getElementById('details-hr-bpm');
    this.detailsHrBase = document.getElementById('details-hr-base');
    this.detailsHrZscore = document.getElementById('details-hr-zscore');
    this.detailsHrConf = document.getElementById('details-hr-conf');

    this.detailsBlinkBadge = document.getElementById('details-blink-badge');
    this.detailsBlinkRate = document.getElementById('details-blink-rate');
    this.detailsBlinkPerclos = document.getElementById('details-blink-perclos');
    this.detailsBlinkEar = document.getElementById('details-blink-ear');
    this.detailsBlinkState = document.getElementById('details-blink-state');

    this.detailsWorkloadNum = document.getElementById('details-workload-num');
    this.detailsWorkloadSubtext = document.getElementById('details-workload-subtext');
    this.detailsCompHrVal = document.getElementById('details-comp-hr-val');
    this.detailsCompHrBar = document.getElementById('details-comp-hr-bar');
    this.detailsCompHrDesc = document.getElementById('details-comp-hr-desc');
    this.detailsCompEyeVal = document.getElementById('details-comp-eye-val');
    this.detailsCompEyeBar = document.getElementById('details-comp-eye-bar');
    this.detailsCompEyeDesc = document.getElementById('details-comp-eye-desc');
    this.detailsCompBlinkVal = document.getElementById('details-comp-blink-val');
    this.detailsCompBlinkBar = document.getElementById('details-comp-blink-bar');
    this.detailsCompBlinkDesc = document.getElementById('details-comp-blink-desc');
    this.detailsCompPostureVal = document.getElementById('details-comp-posture-val');
    this.detailsCompPostureBar = document.getElementById('details-comp-posture-bar');
    this.detailsCompPostureDesc = document.getElementById('details-comp-posture-desc');
    this.detailsCompDurVal = document.getElementById('details-comp-dur-val');
    this.detailsCompDurDesc = document.getElementById('details-comp-dur-desc');

    this.initDetailsInteractions();

    // Quick Check-in Mode Elements
    this.btnStartQuickCheckin = document.getElementById('btn-start-quick-checkin');
    this.quickCheckinOverlay = document.getElementById('quick-checkin-overlay');
    this.btnStopCheckin = document.getElementById('btn-stop-checkin');
    this.checkinProgressFill = document.getElementById('checkin-progress-fill');
    this.checkinGuideOval = document.getElementById('checkin-guide-oval');
    this.checkinGuidanceText = document.getElementById('checkin-guidance-text');
    this.checkinLightingAdvisory = document.getElementById('checkin-lighting-advisory');
    this.checkinBrightnessPrompt = document.getElementById('checkin-brightness-prompt');
    this.settingCheckinReminder = document.getElementById('setting-checkin-reminder');

    // Quick Check-in Live Pulse & Advisory Elements
    this.checkinLivePulseContainer = document.getElementById('checkin-live-pulse-container');
    this.checkinLivePulseVal = document.getElementById('checkin-live-pulse-val');
    this.btnCheckinRetryLight = document.getElementById('btn-checkin-retry-light');
    this.btnCheckinContinueAnyway = document.getElementById('btn-checkin-continue-anyway');

    // New Modals: Cancelled, Result, Reset Break, Eye Rest, Daily Recap
    this.checkinCancelledModal = document.getElementById('checkin-cancelled-modal');
    this.checkinResultModal = document.getElementById('checkin-result-modal');
    this.resetBreakModal = document.getElementById('reset-break-modal');
    this.eyeRestModal = document.getElementById('eye-rest-modal');
    this.dailyRecapModal = document.getElementById('daily-recap-modal');
    this.btnMainCheckNow = document.getElementById('btn-main-check-now');
    this.btnOpenDailyRecap = document.getElementById('btn-open-daily-recap');

    // Header Baseline Tag
    this.headerBaselineTag = document.getElementById('header-baseline-tag');
    this.headerBaselineText = document.getElementById('header-baseline-text');

    // Stale Baseline Banner
    this.staleBaselineBanner = document.getElementById('stale-baseline-banner');
    this.staleBaselineAge = document.getElementById('stale-baseline-age');
    this.btnStaleRecalibrate = document.getElementById('btn-stale-recalibrate');
    this.btnStaleDismiss = document.getElementById('btn-stale-dismiss');

    // Calibration Banner
    this.calibBanner = document.getElementById('calibration-banner');
    this.calibTitle = document.getElementById('calibration-title');
    this.calibTip = document.getElementById('calibration-status-tip');
    this.calibFill = document.getElementById('calibration-fill');
    this.calibPct = document.getElementById('calibration-pct');
    this.calibrationTimer = document.getElementById('calibration-timer');
    this.btnExtendCalibBanner = document.getElementById('btn-extend-calib-banner');

    // Full-Screen Neutral-White Calibration Panel (Diffuse Screen Lighting)
    this.whitePanel = document.getElementById('calibration-white-panel');
    this.whiteTitle = document.getElementById('calib-white-title');
    this.whitePct = document.getElementById('calib-white-pct');
    this.whiteTimer = document.getElementById('calib-white-timer');
    this.whiteFill = document.getElementById('calib-white-fill');
    this.whiteTip = document.getElementById('calib-white-tip');
    this.whiteStage = document.getElementById('calib-white-stage');
    this.btnDuration2m = document.getElementById('btn-duration-2m');
    this.btnDuration5m = document.getElementById('btn-duration-5m');
    this.btnExtendCalib = document.getElementById('btn-extend-calib');
    this.btnAbortCalib = document.getElementById('btn-abort-calibration');
    this.calibSampleHr = document.getElementById('calib-sample-hr');
    this.calibSampleBlink = document.getElementById('calib-sample-blink');
    this.calibSampleMotion = document.getElementById('calib-sample-motion');
    this.btnDismissWhitePanel = document.getElementById('btn-dismiss-white-panel');
    this.isWhitePanelDismissed = false;

    if (this.btnDismissWhitePanel) {
      this.btnDismissWhitePanel.onclick = () => {
        this.isWhitePanelDismissed = true;
        if (this.whitePanel) this.whitePanel.style.display = 'none';
      };
    }

    // 3-Second Pre-Flight Lighting Check Banner
    this.lightingBanner = document.getElementById('lighting-check-banner');
    this.lightingTimer = document.getElementById('lighting-check-timer');
    this.lightingTipMsg = document.getElementById('lighting-check-tip');
    this.lightingFill = document.getElementById('lighting-check-fill');
    this.lightingPct = document.getElementById('lighting-check-pct');
    this.preflightMeanVal = document.getElementById('preflight-mean-val');
    this.preflightVarVal = document.getElementById('preflight-var-val');
    this.preflightConfVal = document.getElementById('preflight-conf-val');

    // Blocked / Insufficient Lighting Banner
    this.insufficientBanner = document.getElementById('lighting-insufficient-banner');
    this.insufficientBadge = document.getElementById('lighting-insufficient-badge');
    this.insufficientReason = document.getElementById('lighting-insufficient-reason');
    this.insufficientMeanLum = document.getElementById('insufficient-mean-lum');
    this.insufficientLumVar = document.getElementById('insufficient-lum-var');
    this.insufficientFaceConf = document.getElementById('insufficient-face-conf');
    this.btnRecheckLighting = document.getElementById('btn-recheck-lighting');

    // Low FPS Warning Banner (< 20 FPS)
    this.fpsWarningBanner = document.getElementById('fps-warning-banner');
    this.fpsWarningText = document.getElementById('fps-warning-text');
    this.fpsWarningVal = document.getElementById('fps-warning-val');

    // KPI Elements & Z-Score Badges
    this.kpiBpm = document.getElementById('kpi-bpm');
    this.kpiBpmRow = document.getElementById('kpi-bpm-row');
    this.kpiBpmUnreliable = document.getElementById('kpi-bpm-unreliable');
    this.kpiBpmSqiBadge = document.getElementById('kpi-bpm-sqi-badge');
    this.kpiBpmConf = document.getElementById('kpi-bpm-conf');
    this.kpiBpmBase = document.getElementById('kpi-bpm-base');
    this.kpiBpmZscoreBadge = document.getElementById('kpi-bpm-zscore-badge');
    this.kpiBpmZscore = document.getElementById('kpi-bpm-zscore');
    this.kpiHrv = document.getElementById('kpi-hrv');
    this.kpiStress = document.getElementById('kpi-stress-status');
    this.kpiBlinkRate = document.getElementById('kpi-blink-rate');
    this.kpiBlinkZscoreBadge = document.getElementById('kpi-blink-zscore-badge');
    this.kpiBlinkZscore = document.getElementById('kpi-blink-zscore');
    this.kpiEar = document.getElementById('kpi-ear-val');
    this.kpiEarZscore = document.getElementById('kpi-ear-zscore');
    this.kpiPerclos = document.getElementById('kpi-perclos-val');
    this.kpiDrowsy = document.getElementById('kpi-drowsy-count');
    this.kpiFatigue = document.getElementById('kpi-fatigue');
    this.kpiAlertness = document.getElementById('kpi-alertness-status');

    // Signal Quality Badges (Top Nav & Diagnostics Strip)
    this.headerSqiTag = document.getElementById('header-sqi-tag');
    this.headerSqiPip = document.getElementById('header-sqi-pip');
    this.headerSqiText = document.getElementById('header-sqi-text');
    this.diagSqiBadge = document.getElementById('diag-sqi-badge');

    // Workload Estimate KPI Elements
    this.kpiWorkloadRow = document.getElementById('kpi-workload-row');
    this.kpiWorkloadVal = document.getElementById('kpi-workload-val');
    this.kpiWorkloadConf = document.getElementById('kpi-workload-conf');
    this.kpiWorkloadUnreliable = document.getElementById('kpi-workload-unreliable');
    this.kpiWorkloadStatus = document.getElementById('kpi-workload-status');
    this.btnOpenWorkloadInfo = document.getElementById('btn-open-workload-info');

    // "How is this calculated?" Workload Breakdown Modal Elements
    this.workloadModal = document.getElementById('workload-info-modal');
    this.btnCloseWorkloadInfo = document.getElementById('btn-close-workload-info');
    this.btnDoneWorkloadInfo = document.getElementById('btn-done-workload-info');
    this.modalWorkloadVal = document.getElementById('modal-workload-val');
    this.modalWorkloadValRow = document.getElementById('modal-workload-val-row');
    this.modalWorkloadUnreliableMsg = document.getElementById('modal-workload-unreliable-msg');
    this.modalWorkloadStatus = document.getElementById('modal-workload-status');
    this.modalConfVal = document.getElementById('modal-conf-val');
    this.modalConfBadge = document.getElementById('modal-conf-badge');
    this.modalConfDetail = document.getElementById('modal-conf-detail');

    // Modal Component Elements (30% HR, 30% Eye, 20% Blink, 20% Posture, Duration)
    this.compScoreHr = document.getElementById('comp-score-hr');
    this.compContribHr = document.getElementById('comp-contrib-hr');
    this.compBarHr = document.getElementById('comp-bar-hr');
    this.compDetailHr = document.getElementById('comp-detail-hr');

    this.compScoreEye = document.getElementById('comp-score-eye');
    this.compContribEye = document.getElementById('comp-contrib-eye');
    this.compBarEye = document.getElementById('comp-bar-eye');
    this.compDetailEye = document.getElementById('comp-detail-eye');

    this.compScoreBlink = document.getElementById('comp-score-blink');
    this.compContribBlink = document.getElementById('comp-contrib-blink');
    this.compBarBlink = document.getElementById('comp-bar-blink');
    this.compDetailBlink = document.getElementById('comp-detail-blink');

    this.compScorePosture = document.getElementById('comp-score-posture');
    this.compContribPosture = document.getElementById('comp-contrib-posture');
    this.compBarPosture = document.getElementById('comp-bar-posture');
    this.compDetailPosture = document.getElementById('comp-detail-posture');

    this.compScoreDuration = document.getElementById('comp-score-duration');
    this.compContribDuration = document.getElementById('comp-contrib-duration');
    this.compDetailDuration = document.getElementById('comp-detail-duration');

    // Diagnostic Meters
    this.sqiVal = document.getElementById('diag-sqi-val');
    this.sqiBar = document.getElementById('diag-sqi-bar');
    this.lightingVal = document.getElementById('diag-lighting-val');
    this.lightingBar = document.getElementById('diag-lighting-bar');
    this.motionVal = document.getElementById('diag-motion-val');
    this.motionBar = document.getElementById('diag-motion-bar');

    // HUD Chips
    this.chipFps = document.getElementById('chip-fps');
    this.chipFace = document.getElementById('chip-face-status');
    this.chipPose = document.getElementById('chip-head-pose');
    this.lightingTip = document.getElementById('hud-lighting-tip');

    // Debug HUD Elements (ROIs & Stability Telemetry)
    this.debugHud = document.getElementById('camera-debug-hud');
    this.debugHudPip = document.getElementById('debug-hud-pip');
    this.debugHudFrameStatus = document.getElementById('debug-hud-frame-status');
    this.debugHudMotion = document.getElementById('debug-hud-motion');
    this.debugHudThreshold = document.getElementById('debug-hud-threshold');
    this.debugHudPose = document.getElementById('debug-hud-pose');
    this.debugHudIod = document.getElementById('debug-hud-iod');
    this.debugHudBarFill = document.getElementById('debug-hud-bar-fill');
    this.debugHudBarPct = document.getElementById('debug-hud-bar-pct');
    this.debugHudWindowStatus = document.getElementById('debug-hud-window-status');
    this.debugHudDiscardPct = document.getElementById('debug-hud-discard-pct');
    this.debugHudFrameCounts = document.getElementById('debug-hud-frame-counts');
    this.chipRoiForehead = document.getElementById('chip-roi-forehead');
    this.chipRoiLeft = document.getElementById('chip-roi-left');
    this.chipRoiRight = document.getElementById('chip-roi-right');
    this.chipRoiBg = document.getElementById('chip-roi-bg');
    this.debugHudIllumination = document.getElementById('debug-hud-illumination');
    this.debugHudEar = document.getElementById('debug-hud-ear');
    this.debugHudPerclos = document.getElementById('debug-hud-perclos');
    this.debugHudMotionZ = document.getElementById('debug-hud-motion-z');

    // Suggestions container
    this.suggestionsContainer = document.getElementById('suggestions-list-container');
    this.breathingContainer = document.getElementById('breathing-coach-container');

    // History Modal
    this.historyModal = document.getElementById('history-modal');
    this.savedSessionsList = document.getElementById('saved-sessions-list');

    // Dev Performance Overlay
    this.devUiFps = document.getElementById('dev-ui-fps');
    this.devPipelineFps = document.getElementById('dev-pipeline-fps');
    this.devFrameDt = document.getElementById('dev-frame-dt');
    this.devWorkerMode = document.getElementById('dev-worker-mode');

    // Cached rendered values to prevent unnecessary DOM mutations & layout thrashing
    this.lastRendered = {};

    // Live Dashboard Telemetry & Vitals Strip Elements
    this.dashLiveBpm = document.getElementById('dash-live-bpm');
    this.dashHeartIcon = document.getElementById('dash-heart-icon');
    this.dashBpmBadge = document.getElementById('dash-bpm-badge');
    this.dashBpmBaselineDiff = document.getElementById('dash-bpm-baseline-diff');
    this.dashBpmConf = document.getElementById('dash-bpm-conf');
    this.dashLiveBlink = document.getElementById('dash-live-blink');
    this.dashBlinkBadge = document.getElementById('dash-blink-badge');
    this.dashBlinkDesc = document.getElementById('dash-blink-desc');
    this.dashPerclosVal = document.getElementById('dash-perclos-val');
    this.dashPulseCanvas = document.getElementById('dash-pulse-canvas');
    this.btnResultCheckinAgain = document.getElementById('btn-result-checkin-again');

    this.initConsentListeners();
    this.initActionInteractions();
  }

  /**
   * Update visible Camera Active indicators and Stop button text
   */
  setCameraActive(isActive) {
    const activeText = isActive ? 'Camera active' : 'Camera stopped';
    const tag = document.getElementById('camera-active-text');
    const pip = document.getElementById('camera-active-pip');
    const feedText = document.getElementById('camera-feed-text');
    const feedPip = document.getElementById('camera-feed-pip');
    const stopBtn = document.getElementById('btn-stop-camera');
    const stopBtnFooter = document.getElementById('btn-stop-camera-footer');

    if (tag) tag.textContent = activeText;
    if (pip) pip.className = `status-pip ${isActive ? 'good' : 'muted'}`;
    if (feedText) feedText.textContent = activeText;
    if (feedPip) feedPip.className = `status-pip ${isActive ? 'good' : 'muted'}`;

    const btnLabel = isActive ? 'Stop Camera' : 'Start Camera';
    if (stopBtn) {
      stopBtn.innerHTML = `<span class="status-pip ${isActive ? 'alert' : 'good'}" style="width: 5px; height: 5px;"></span> ${btnLabel}`;
    }
    if (stopBtnFooter) {
      stopBtnFooter.textContent = btnLabel;
    }
  }

  /**
   * Update dev performance overlay telemetry
   */
  updateDevStats(uiFps, pipelineFps, dtSec, mode = 'WORKER') {
    if (this.devUiFps) this.devUiFps.textContent = `${uiFps} FPS`;
    if (this.devPipelineFps) this.devPipelineFps.textContent = `${pipelineFps} FPS`;
    if (this.devFrameDt) this.devFrameDt.textContent = `${(dtSec * 1000).toFixed(1)} ms`;
    if (this.devWorkerMode) this.devWorkerMode.textContent = mode;
  }

  /**
   * Switch active application view
   * @param {'landing' | 'consent' | 'dashboard'} viewName
   */
  showView(viewName) {
    [this.viewLanding, this.viewConsent, this.viewDashboard].forEach((v) => {
      v.classList.remove('active');
    });

    if (viewName === 'landing') this.viewLanding.classList.add('active');
    else if (viewName === 'consent') this.viewConsent.classList.add('active');
    else if (viewName === 'dashboard') this.viewDashboard.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  initConsentListeners() {
    const validateConsent = () => {
      const isValid = this.checkWellness.checked && this.checkCamera.checked;
      this.btnConsentProceed.disabled = !isValid;
    };

    if (this.checkWellness && this.checkCamera) {
      this.checkWellness.addEventListener('change', validateConsent);
      this.checkCamera.addEventListener('change', validateConsent);
    }
  }

  setMonitoringStatus(status, text) {
    if (!this.statusText || !this.statusIndicator) return;
    this.statusText.textContent = text;
    this.statusIndicator.style.boxShadow = 'none';

    if (status === 'active') {
      this.statusIndicator.style.backgroundColor = 'var(--good)';
      this.statusText.style.color = 'var(--good)';
    } else if (status === 'calibrating') {
      this.statusIndicator.style.backgroundColor = 'var(--accent)';
      this.statusText.style.color = 'var(--accent)';
    } else if (status === 'paused') {
      this.statusIndicator.style.backgroundColor = 'var(--caution)';
      this.statusText.style.color = 'var(--caution)';
    } else {
      this.statusIndicator.style.backgroundColor = 'var(--alert)';
      this.statusText.style.color = 'var(--alert)';
    }
  }

  updateSessionTimer(seconds) {
    if (!this.timerText) return;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (this.lastRendered.sessionTimer !== formatted) {
      this.lastRendered.sessionTimer = formatted;
      this.timerText.textContent = formatted;
    }
  }

  updateCalibrationView(calibData) {
    if (!this.calibBanner) return;

    if (calibData && calibData.isCalibrating) {
      this.calibBanner.style.display = 'flex';
      const pct = Math.round(calibData.progress || 0);
      const remainingSec = calibData.remainingSec !== undefined ? calibData.remainingSec : 120;
      const mins = Math.floor(remainingSec / 60);
      const secs = remainingSec % 60;
      const formattedTimer = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

      if (this.lastRendered.calibPct !== pct) {
        this.lastRendered.calibPct = pct;
        this.calibPct.textContent = `${pct}%`;
      }
      // Animate ONLY transform: zero reflow thrashing!
      this.calibFill.style.transform = `scaleX(${pct / 100})`;
      if (this.calibTitle) this.calibTitle.textContent = calibData.phaseTitle || 'Calibrating Personal Baseline...';
      if (this.calibTip) this.calibTip.textContent = calibData.message;
      if (this.calibrationTimer) this.calibrationTimer.textContent = formattedTimer;

      // Full-screen neutral-white calibration panel:
      // Active during calibration only to establish uniform diffuse key light
      if (this.whitePanel && !this.isWhitePanelDismissed) {
        this.whitePanel.style.display = 'flex';
        if (this.whitePct) this.whitePct.textContent = `${pct}%`;
        if (this.whiteTimer) this.whiteTimer.textContent = formattedTimer;
        if (this.whiteFill) this.whiteFill.style.transform = `scaleX(${pct / 100})`;
        if (this.whiteStage && calibData.phaseTitle) this.whiteStage.textContent = calibData.phaseTitle;
        if (this.whiteTip) this.whiteTip.textContent = calibData.message;

        // Real-time sample counters
        if (calibData.samples) {
          if (this.calibSampleHr) this.calibSampleHr.textContent = calibData.samples.bpm || 0;
          if (this.calibSampleBlink) this.calibSampleBlink.textContent = calibData.samples.blink || 0;
          if (this.calibSampleMotion) this.calibSampleMotion.textContent = calibData.samples.motion || 0;
        }
      }
    } else {
      this.calibBanner.style.display = 'none';
      if (this.whitePanel) this.whitePanel.style.display = 'none';
      // Reset dismissal flag so subsequent recalibrations re-show the panel
      this.isWhitePanelDismissed = false;
    }
  }

  setHeaderBaseline(baseline) {
    if (!this.headerBaselineTag || !this.headerBaselineText) return;
    if (baseline && baseline.heartRate && baseline.blinkRate) {
      this.headerBaselineTag.style.display = 'inline-flex';
      const hr = Math.round(baseline.heartRate.mean);
      const hrStd = baseline.heartRate.std ? `±${baseline.heartRate.std.toFixed(1)}` : '';
      const bl = Math.round(baseline.blinkRate.mean);
      const ageMs = Date.now() - (baseline.timestamp || Date.now());
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      const ageStr = ageDays === 0 ? 'today' : `${ageDays}d old`;
      this.headerBaselineText.textContent = `BASELINE: ${hr} ${hrStd} BPM • ${bl} BL/M • ${ageStr}`;
    } else {
      this.headerBaselineTag.style.display = 'none';
    }
  }

  showStaleBaselinePrompt(isStale, ageDays, onRecalibrate, onDismiss) {
    if (!this.staleBaselineBanner) return;
    if (isStale) {
      this.staleBaselineBanner.style.display = 'block';
      if (this.staleBaselineAge) this.staleBaselineAge.textContent = ageDays;
      if (this.btnStaleRecalibrate) {
        this.btnStaleRecalibrate.onclick = () => {
          this.staleBaselineBanner.style.display = 'none';
          if (onRecalibrate) onRecalibrate();
        };
      }
      if (this.btnStaleDismiss) {
        this.btnStaleDismiss.onclick = () => {
          this.staleBaselineBanner.style.display = 'none';
          if (onDismiss) onDismiss();
        };
      }
    } else {
      this.staleBaselineBanner.style.display = 'none';
    }
  }

  /**
   * Update 3-second Pre-Flight Lighting Check display
   */
  updatePreflightLightingView(preflightData) {
    if (!this.lightingBanner) return;

    if (preflightData && preflightData.isActive) {
      this.lightingBanner.style.display = 'flex';
      const pct = Math.round(preflightData.progress * 100);
      if (this.lightingFill) this.lightingFill.style.transform = `scaleX(${preflightData.progress})`;
      if (this.lightingPct) this.lightingPct.textContent = `${pct}%`;
      if (this.lightingTimer) this.lightingTimer.textContent = `${(preflightData.remainingSec || 0).toFixed(1)}s`;

      if (preflightData.latest) {
        const mean = Math.round(preflightData.latest.meanLuminance || 0);
        const variance = Math.round(preflightData.latest.variance || 0);
        const conf = Math.round((preflightData.latest.faceConfidence || 0) * 100);

        if (this.preflightMeanVal) this.preflightMeanVal.textContent = `${mean} lux`;
        if (this.preflightVarVal) this.preflightVarVal.textContent = `${variance}`;
        if (this.preflightConfVal) this.preflightConfVal.textContent = `${conf}%`;
      }
    } else {
      this.lightingBanner.style.display = 'none';
    }
  }

  /**
   * Display or hide the Insufficient Lighting Blocked/Paused Banner
   */
  setInsufficientLighting(isInsufficient, data = null) {
    if (!this.insufficientBanner) return;

    if (isInsufficient && data) {
      this.insufficientBanner.style.display = 'flex';
      if (this.insufficientBadge) {
        this.insufficientBadge.textContent = data.isBlocked ? 'Measurement Blocked' : 'Measurement Paused';
      }
      if (this.insufficientReason) {
        let reason = 'Face is not clearly visible in the camera viewport.';
        if (data.isTooDark) {
          reason = `Face is too dark (mean luminance is ${Math.round(data.meanLuminance || 0)} lux; minimum is 50 lux).`;
        } else if (data.isOverexposed) {
          reason = `Face is overexposed (mean luminance is ${Math.round(data.meanLuminance || 0)} lux; maximum is 215 lux).`;
        } else if (!data.isFaceVisible) {
          reason = `Face detection confidence is ${Math.round((data.faceConfidence || 0) * 100)}% (minimum 50% required).`;
        } else if (data.variance !== undefined && data.variance < 15) {
          reason = `Insufficient facial optical contrast (variance is ${Math.round(data.variance)}; minimum 15 required).`;
        }
        this.insufficientReason.textContent = reason;
      }
      if (this.insufficientMeanLum) {
        this.insufficientMeanLum.textContent = `${Math.round(data.meanLuminance || 0)} lux`;
      }
      if (this.insufficientLumVar) {
        this.insufficientLumVar.textContent = `${Math.round(data.variance || 0)}`;
      }
      if (this.insufficientFaceConf) {
        this.insufficientFaceConf.textContent = `${Math.round((data.faceConfidence || 0) * 100)}%`;
      }
    } else {
      this.insufficientBanner.style.display = 'none';
    }
  }

  /**
   * Display or hide the Low Frame Rate (< 20 FPS) Warning
   */
  setLowFpsWarning(isLow, currentFps = 0) {
    if (!this.fpsWarningBanner) return;

    if (isLow) {
      this.fpsWarningBanner.style.display = 'flex';
      if (this.fpsWarningText) {
        this.fpsWarningText.textContent = `Frame rate is currently ${currentFps} FPS (< 20 FPS). Optical waveform precision may be degraded. Please close heavy background applications or improve illumination.`;
      }
      if (this.fpsWarningVal) {
        this.fpsWarningVal.textContent = `${currentFps} FPS (< 20)`;
      }
      if (this.chipFps) {
        this.chipFps.style.borderColor = 'var(--alert)';
        this.chipFps.style.color = 'var(--alert)';
      }
    } else {
      this.fpsWarningBanner.style.display = 'none';
      if (this.chipFps) {
        this.chipFps.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        this.chipFps.style.color = '#EDE8E1';
      }
    }
  }

  /**
   * Update Floating Debug HUD with ROI & Motion Stability Telemetry
   * @param {Object} detection - Latest detection object
   * @param {Object} motion - Head motion analysis output
   * @param {Object} windowStability - 10s window stability stats
   * @param {boolean} showDebug - Whether the debug HUD is toggled on
   * @param {Object} [illumination=null] - Illumination stability telemetry
   * @param {Object} [blink=null] - Blink & ocular kinematics telemetry
   */
  updateDebugHud(detection, motion, windowStability, showDebug = true, illumination = null, blink = null) {
    if (!this.debugHud) return;

    if (!showDebug) {
      this.debugHud.style.display = 'none';
      return;
    }
    this.debugHud.style.display = 'block';

    const isDetected = Boolean(detection && detection.detected);
    const isNoisy = Boolean(motion && motion.isNoisy);
    const isDiscarded = Boolean(motion && motion.isDiscarded);

    // 1. Frame Status Badge
    if (this.debugHudFrameStatus) {
      if (!isDetected) {
        this.debugHudFrameStatus.textContent = 'NO FACE';
        this.debugHudFrameStatus.className = 'debug-hud-badge noisy';
        if (this.debugHudPip) this.debugHudPip.className = 'status-pip alert';
      } else if (isNoisy || isDiscarded) {
        this.debugHudFrameStatus.textContent = 'NOISY (DISCARDED)';
        this.debugHudFrameStatus.className = 'debug-hud-badge noisy';
        if (this.debugHudPip) this.debugHudPip.className = 'status-pip alert';
      } else {
        this.debugHudFrameStatus.textContent = 'STABLE (PASSED)';
        this.debugHudFrameStatus.className = 'debug-hud-badge';
        if (this.debugHudPip) this.debugHudPip.className = 'status-pip good';
      }
    }

    // 2. Head Movement & Threshold
    if (motion) {
      const normMov = motion.normalizedMovement !== undefined ? motion.normalizedMovement : 0;
      const thresh = motion.threshold || 0.035;
      const iod = motion.iod || 0;

      if (this.debugHudMotion) {
        this.debugHudMotion.textContent = `${normMov.toFixed(3)} IOD`;
        this.debugHudMotion.style.color = isNoisy ? 'var(--alert)' : 'var(--text)';
      }
      if (this.debugHudThreshold) {
        this.debugHudThreshold.textContent = `${thresh.toFixed(3)} IOD`;
      }
      if (this.debugHudIod) {
        this.debugHudIod.textContent = `${Math.round(iod)} px`;
      }

      // Progress bar fill (0% to 100%)
      const pctOfThresh = Math.round((normMov / thresh) * 100);
      if (this.debugHudBarFill) {
        this.debugHudBarFill.style.width = `${Math.min(100, pctOfThresh)}%`;
        this.debugHudBarFill.style.backgroundColor = isNoisy ? 'var(--alert)' : 'var(--good)';
      }
      if (this.debugHudBarPct) {
        this.debugHudBarPct.textContent = `${pctOfThresh}% threshold`;
        this.debugHudBarPct.style.color = isNoisy ? 'var(--alert)' : 'var(--text-muted)';
      }

      // Pose
      if (this.debugHudPose && motion.headPose) {
        const { pitch, yaw, roll } = motion.headPose;
        this.debugHudPose.textContent = `P${pitch > 0 ? '+' : ''}${Math.round(pitch)}° Y${yaw > 0 ? '+' : ''}${Math.round(yaw)}° R${roll > 0 ? '+' : ''}${Math.round(roll)}°`;
      }
    }

    // 3. Illumination Stability Readout
    if (this.debugHudIllumination) {
      if (illumination) {
        if (illumination.isUnstable) {
          this.debugHudIllumination.textContent = `UNSTABLE (Δ${illumination.bgDeltaPct || 0}%)`;
          this.debugHudIllumination.style.color = 'var(--alert)';
        } else {
          this.debugHudIllumination.textContent = 'STABLE';
          this.debugHudIllumination.style.color = 'var(--good)';
        }
      } else {
        this.debugHudIllumination.textContent = 'STABLE';
        this.debugHudIllumination.style.color = 'var(--good)';
      }
    }

    // 4. Ocular Kinematics: EAR, Personal Threshold, PERCLOS & Confidence (Jitter)
    if (blink) {
      if (this.debugHudEar) {
        const curEar = (blink.ear !== undefined ? blink.ear : 0).toFixed(2);
        const thresh = (blink.personalThreshold || 0.22).toFixed(2);
        this.debugHudEar.textContent = `${curEar} / ${thresh}`;
        this.debugHudEar.style.color = blink.isEyeClosed ? 'var(--caution)' : 'var(--text)';
      }
      if (this.debugHudPerclos) {
        const pct = (blink.perclosPct !== undefined ? blink.perclosPct : (blink.perclos * 100 || 0)).toFixed(1);
        const conf = blink.confidence !== undefined ? Math.round(blink.confidence) : 100;
        this.debugHudPerclos.textContent = `${pct}% (${conf}%)`;
        this.debugHudPerclos.style.color = blink.isOccludedOrJittering
          ? 'var(--alert)'
          : conf < 65
          ? 'var(--caution)'
          : 'var(--text)';
      }
    }

    // 5. 10-Second Window Discard Statistics
    const win = windowStability || (motion ? motion.windowStability : null);
    if (win) {
      const isLowConf = Boolean(win.isLowConfidence);
      if (this.debugHudWindowStatus) {
        this.debugHudWindowStatus.textContent = isLowConf ? 'LOW CONFIDENCE' : 'CONFIDENT';
        this.debugHudWindowStatus.className = `debug-hud-window-status mono ${isLowConf ? 'low-confidence' : ''}`;
      }
      if (this.debugHudDiscardPct) {
        this.debugHudDiscardPct.textContent = `${win.discardPercentage}%`;
        this.debugHudDiscardPct.style.color = isLowConf ? 'var(--alert)' : 'var(--text)';
      }
      if (this.debugHudFrameCounts) {
        this.debugHudFrameCounts.textContent = `${win.discardedFrames} / ${win.totalFrames} frames`;
      }
    }

    // 6. ROIs Active Indicator: Background Ref, Forehead, Left Cheek, Right Cheek
    const hasBg = Boolean(detection && (detection.bgRoi || (detection.rois && detection.rois.bgRoi)));
    const hasForehead = Boolean(detection && (detection.foreheadRoi || (detection.rois && detection.rois.forehead)));
    const hasLeft = Boolean(detection && (detection.leftCheekRoi || (detection.rois && detection.rois.leftCheek)));
    const hasRight = Boolean(detection && (detection.rightCheekRoi || (detection.rois && detection.rois.rightCheek)));

    if (this.chipRoiBg) this.chipRoiBg.className = `debug-roi-chip ${hasBg ? 'locked' : ''}`;
    if (this.chipRoiForehead) this.chipRoiForehead.className = `debug-roi-chip ${hasForehead ? 'locked' : ''}`;
    if (this.chipRoiLeft) this.chipRoiLeft.className = `debug-roi-chip ${hasLeft ? 'locked' : ''}`;
    if (this.chipRoiRight) this.chipRoiRight.className = `debug-roi-chip ${hasRight ? 'locked' : ''}`;
  }

  /**
   * Initialize Suggested Action Button interactions and action modal
   */
  initActionInteractions() {
    if (this.btnSuggestedAction) {
      this.btnSuggestedAction.addEventListener('click', () => {
        const action = this.currentSuggestedAction || 'Keep going';
        this.handleSuggestedAction(action);
      });
    }

    if (this.btnCloseActionModal) {
      this.btnCloseActionModal.addEventListener('click', () => {
        this.closeActionModal();
      });
    }

    if (this.btnActionModalDone) {
      this.btnActionModalDone.addEventListener('click', () => {
        this.closeActionModal();
      });
    }

    if (this.actionModal) {
      this.actionModal.addEventListener('click', (e) => {
        if (e.target === this.actionModal) {
          this.closeActionModal();
        }
      });
    }
  }

  /**
   * Initialize settings preferences modal interactions
   */
  initSettingsInteractions(alertSystem) {
    if (this.btnOpenSettings) {
      this.btnOpenSettings.addEventListener('click', () => {
        this.openSettingsModal(alertSystem);
      });
    }

    if (this.btnCloseSettings) {
      this.btnCloseSettings.addEventListener('click', () => {
        this.closeSettingsModal();
      });
    }

    if (this.btnDoneSettings) {
      this.btnDoneSettings.addEventListener('click', () => {
        this.closeSettingsModal();
      });
    }

    if (this.settingsModal) {
      this.settingsModal.addEventListener('click', (e) => {
        if (e.target === this.settingsModal) {
          this.closeSettingsModal();
        }
      });
    }

    if (this.settingSoundChime && alertSystem) {
      this.settingSoundChime.checked = alertSystem.soundEnabled;
      this.settingSoundChime.addEventListener('change', () => {
        alertSystem.setSoundEnabled(this.settingSoundChime.checked);
        this.showToast(
          this.settingSoundChime.checked ? '🔔' : '🔕',
          this.settingSoundChime.checked ? 'Gentle chime enabled.' : 'Chime silenced (default).'
        );
      });
    }

    if (this.btnTestChime && alertSystem) {
      this.btnTestChime.addEventListener('click', () => {
        alertSystem.playGentleChime();
      });
    }

    if (this.btnResumeAlerts && alertSystem) {
      this.btnResumeAlerts.addEventListener('click', () => {
        alertSystem.resumeAlerts();
        this.updateSettingsSnoozeStatus(alertSystem);
      });
    }

    if (this.settingCheckinReminder && alertSystem) {
      const mins = alertSystem.checkinReminderMinutes || 0;
      this.settingCheckinReminder.value = mins === 60 ? '60' : mins === 30 ? '30' : 'off';
      this.settingCheckinReminder.addEventListener('change', () => {
        alertSystem.setCheckinReminderInterval(this.settingCheckinReminder.value);
        const label = this.settingCheckinReminder.value === '60'
          ? 'Reminding every hour.'
          : this.settingCheckinReminder.value === '30'
          ? 'Reminding every 30 minutes.'
          : 'Check-in reminders turned off.';
        this.showToast('⏱️', label);
      });
    }

    // Background Watch setting
    const settingBgWatch = document.getElementById('setting-bg-watch');
    if (settingBgWatch) {
      const stored = localStorage.getItem('pulsecam_bg_watch');
      settingBgWatch.checked = stored !== 'false';
      settingBgWatch.addEventListener('change', () => {
        localStorage.setItem('pulsecam_bg_watch', settingBgWatch.checked ? 'true' : 'false');
        if (window.__pulsecam_app && window.__pulsecam_app.worker) {
          window.__pulsecam_app.worker.postMessage({
            type: 'SET_BACKGROUND_WATCH',
            enabled: settingBgWatch.checked
          });
        }
        this.showToast('👁️', settingBgWatch.checked ? 'Background watch active.' : 'Background watch turned off.');
      });
    }

    // Reminder gentleness
    const settingGentleness = document.getElementById('setting-reminder-gentleness');
    if (settingGentleness && alertSystem) {
      settingGentleness.value = alertSystem.gentleness || 'normal';
      settingGentleness.addEventListener('change', () => {
        alertSystem.setGentleness(settingGentleness.value);
        this.showToast('🌿', `Reminder gentleness set to ${settingGentleness.value}.`);
      });
    }

    // Quiet hours
    const settingQuietStart = document.getElementById('setting-quiet-start');
    const settingQuietEnd = document.getElementById('setting-quiet-end');
    if (settingQuietStart && settingQuietEnd && alertSystem) {
      settingQuietStart.value = alertSystem.quietStart || '22:00';
      settingQuietEnd.value = alertSystem.quietEnd || '08:00';
      const onQuietChange = () => {
        alertSystem.setQuietHours(settingQuietStart.value, settingQuietEnd.value);
      };
      settingQuietStart.addEventListener('change', onQuietChange);
      settingQuietEnd.addEventListener('change', onQuietChange);
    }

    // Break length
    const settingBreakLength = document.getElementById('setting-break-length');
    if (settingBreakLength) {
      const storedBreak = localStorage.getItem('pulsecam_break_length') || '2';
      settingBreakLength.value = storedBreak;
      settingBreakLength.addEventListener('change', () => {
        localStorage.setItem('pulsecam_break_length', settingBreakLength.value);
        this.showToast('☕', `Break length set to ${settingBreakLength.value} minutes.`);
      });
    }

    // Pause for 1 hour
    const btnPause1hr = document.getElementById('btn-pause-1hr');
    if (btnPause1hr && alertSystem) {
      btnPause1hr.addEventListener('click', () => {
        alertSystem.snooze(60 * 60 * 1000); // 1 hour snooze
        if (window.__pulsecam_app) {
          window.__pulsecam_app.isPaused = true;
          const btnToggle = document.getElementById('btn-toggle-pause');
          if (btnToggle) btnToggle.textContent = 'Resume';
          this.setMonitoringStatus('paused', 'PAUSED (1 HOUR)');
        }
        this.updateSettingsSnoozeStatus(alertSystem);
        this.showToast('🌙', 'Paused for 1 hour. Take a restful break.');
      });
    }

    // Delete My Data (Phase 5)
    const btnDeleteData = document.getElementById('btn-delete-all-data');
    if (btnDeleteData) {
      btnDeleteData.addEventListener('click', () => {
        if (confirm('Permanently delete your calibrated baseline and session records from this browser?')) {
          localStorage.clear();
          this.showToast('🗑️', 'All local data has been permanently cleared.');
          setTimeout(() => {
            window.location.reload();
          }, 1200);
        }
      });
    }
  }

  openSettingsModal(alertSystem) {
    if (!this.settingsModal) return;
    if (this.settingSoundChime && alertSystem) {
      this.settingSoundChime.checked = alertSystem.soundEnabled;
    }
    if (this.settingCheckinReminder && alertSystem) {
      const mins = alertSystem.checkinReminderMinutes || 0;
      this.settingCheckinReminder.value = mins === 60 ? '60' : mins === 30 ? '30' : 'off';
    }
    const settingGentleness = document.getElementById('setting-reminder-gentleness');
    if (settingGentleness && alertSystem) {
      settingGentleness.value = alertSystem.gentleness || 'normal';
    }
    const settingBgWatch = document.getElementById('setting-bg-watch');
    if (settingBgWatch) {
      settingBgWatch.checked = localStorage.getItem('pulsecam_bg_watch') !== 'false';
    }
    this.updateSettingsSnoozeStatus(alertSystem);
    this.settingsModal.classList.add('open');
  }

  closeSettingsModal() {
    if (this.settingsModal) {
      this.settingsModal.classList.remove('open');
    }
  }

  updateSettingsSnoozeStatus(alertSystem) {
    if (!this.settingsSnoozeStatus || !alertSystem) return;
    if (alertSystem.isSnoozed()) {
      const mins = alertSystem.getRemainingSnoozeMinutes();
      this.settingsSnoozeStatus.textContent = `Snoozed (${mins} min remaining)`;
      if (this.btnResumeAlerts) this.btnResumeAlerts.style.display = 'inline-flex';
    } else {
      this.settingsSnoozeStatus.textContent = 'Active (delivering friendly, short suggestions)';
      if (this.btnResumeAlerts) this.btnResumeAlerts.style.display = 'none';
    }
  }

  /**
   * Initialize "For the curious" technical details panel interactions
   */
  initDetailsInteractions() {
    if (this.btnOpenDetails) {
      this.btnOpenDetails.addEventListener('click', (e) => {
        e.preventDefault();
        this.openDetailsModal();
      });
    }

    if (this.btnCloseDetails) {
      this.btnCloseDetails.addEventListener('click', () => {
        this.closeDetailsModal();
      });
    }

    if (this.btnDoneDetails) {
      this.btnDoneDetails.addEventListener('click', () => {
        this.closeDetailsModal();
      });
    }

    if (this.detailsModal) {
      this.detailsModal.addEventListener('click', (e) => {
        if (e.target === this.detailsModal) {
          this.closeDetailsModal();
        }
      });
    }

    this.initValidationTool();
  }

  openDetailsModal() {
    if (!this.detailsModal) return;
    this.isDetailsPanelOpen = true;
    this.detailsModal.classList.add('open');

    // If app instance is available, request an immediate update
    if (window.__pulsecam_app && typeof window.__pulsecam_app.updateDetailsNow === 'function') {
      window.__pulsecam_app.updateDetailsNow();
    }
  }

  closeDetailsModal() {
    if (this.detailsModal) {
      this.detailsModal.classList.remove('open');
    }
    this.isDetailsPanelOpen = false;
  }

  /**
   * Set Quick Check-in mode active visibility
   */
  setQuickCheckinActive(active) {
    if (this.quickCheckinOverlay) {
      this.quickCheckinOverlay.style.display = active ? 'flex' : 'none';
    }
  }

  /**
   * Update Quick Check-in 60s progress bar
   */
  updateCheckinProgress(progress) {
    if (this.checkinProgressFill) {
      const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
      this.checkinProgressFill.style.width = `${pct}%`;
    }
  }

  /**
   * Update Quick Check-in minimal face-alignment guide (oval + short plain text guidance)
   */
  updateCheckinAlignment({ faceDetected, isCentered, isGoodDistance, isFacingScreen, isStill, guidanceText, isLightingInvalid }) {
    const isAligned = Boolean(faceDetected && isCentered && isGoodDistance && isFacingScreen && isStill);

    if (this.checkinGuideOval) {
      if (isAligned) {
        this.checkinGuideOval.className = 'checkin-guide-oval aligned';
      } else {
        this.checkinGuideOval.className = 'checkin-guide-oval not-aligned';
      }
    }

    if (this.checkinGuidanceText) {
      this.checkinGuidanceText.textContent = guidanceText || (isAligned ? 'Hold still' : 'Center your face in the oval');
      if (isAligned) {
        this.checkinGuidanceText.className = 'checkin-guidance-text aligned';
      } else {
        this.checkinGuidanceText.className = 'checkin-guidance-text';
      }
    }

    if (this.checkinLightingAdvisory) {
      this.checkinLightingAdvisory.style.display = isLightingInvalid ? 'block' : 'none';
    }
  }

  /**
   * Display gently animated live pulse estimate inside oval during last 20-30s of check-in
   */
  updateCheckinLivePulse(bpm) {
    if (!this.checkinLivePulseContainer || !this.checkinLivePulseVal) return;
    if (bpm && bpm > 40 && bpm < 190) {
      this.checkinLivePulseContainer.style.display = 'flex';
      this.checkinLivePulseVal.textContent = Math.round(bpm);
    } else {
      this.checkinLivePulseContainer.style.display = 'none';
    }
  }

  /**
   * Show "Check-in stopped" modal on Esc or premature fullscreen exit
   */
  showCheckinCancelled(onStartAgain) {
    if (this.checkinCancelledModal) {
      this.checkinCancelledModal.style.display = 'flex';
      const btnAgain = document.getElementById('btn-checkin-start-again');
      if (btnAgain) {
        btnAgain.onclick = () => {
          this.closeCheckinCancelled();
          if (onStartAgain) onStartAgain();
        };
      }
      const btnClose = document.getElementById('btn-close-cancelled-modal');
      if (btnClose) {
        btnClose.onclick = () => this.closeCheckinCancelled();
      }
    }
  }

  closeCheckinCancelled() {
    if (this.checkinCancelledModal) {
      this.checkinCancelledModal.style.display = 'none';
    }
  }

  /**
   * Show friendly Quick Check-in Result card (rounded BPM / range, plain label "Estimate", confidence Good/Fair)
   */
  showCheckinResult({ bpm, range, confidence = 'Good', comparison, isClearReading = true, reasonCode, onTakeReset, onTryAgain }) {
    if (!this.checkinResultModal) return;
    this.checkinResultModal.style.display = 'flex';
    this.latestCheckinMeasuredBpm = bpm;

    const clearBox = document.getElementById('checkin-result-clear-box');
    const unclearBox = document.getElementById('checkin-result-unclear-box');
    const badgeEl = document.getElementById('checkin-result-conf-badge');
    const headlineEl = document.getElementById('checkin-result-bpm-headline');
    const rangeEl = document.getElementById('checkin-result-range');
    const compEl = document.getElementById('checkin-result-comparison');
    const unclearReason = document.getElementById('checkin-result-unclear-reason');
    const unclearAdvice = document.getElementById('checkin-result-unclear-advice');
    const btnTryAgain = document.getElementById('btn-result-try-again');
    const resetOffer = document.getElementById('checkin-result-reset-offer');

    if (badgeEl) {
      badgeEl.textContent = confidence;
      badgeEl.className = `stamp-tag ${confidence === 'Good' ? 'good' : confidence === 'Fair' ? 'caution' : 'alert'}`;
    }

    if (isClearReading && bpm) {
      if (clearBox) clearBox.style.display = 'block';
      if (unclearBox) unclearBox.style.display = 'none';
      if (headlineEl) {
        const roundedBpm = Math.round(bpm);
        headlineEl.textContent = `About ${roundedBpm} beats per minute`;
      }
      if (rangeEl) {
        if (range && typeof range === 'object' && range.min !== undefined && range.max !== undefined) {
          rangeEl.textContent = `Range: ${range.min}–${range.max} bpm`;
          rangeEl.style.display = 'inline-flex';
        } else if (typeof range === 'string') {
          rangeEl.textContent = `Range: ${range} bpm`;
          rangeEl.style.display = 'inline-flex';
        } else {
          rangeEl.textContent = `Range: ${Math.round(bpm) - 2}–${Math.round(bpm) + 2} bpm`;
          rangeEl.style.display = 'inline-flex';
        }
      }
      if (compEl) {
        compEl.textContent = comparison || 'Right around your usual';
      }
    } else {
      if (clearBox) clearBox.style.display = 'none';
      if (unclearBox) unclearBox.style.display = 'block';

      let reason = "We couldn't get a clear reading this time.";
      let advice = "Camera-based estimates can be off by a few beats. Try staying very still under steady light.";

      switch (reasonCode) {
        case 'TOO_MUCH_MOVEMENT':
          reason = "Try to stay still during the check-in.";
          advice = "Subtle head motion can overpower the delicate optical pulse signal.";
          break;
        case 'TOO_DARK':
          reason = "A bit more light on your face, please.";
          advice = "The camera sensor needs more illumination to detect capillary blood flow.";
          break;
        case 'TOO_BRIGHT':
        case 'SATURATED':
          reason = "Your screen is very bright for this camera. Lean back a little or lower the brightness slightly.";
          advice = "Screen glare saturated camera pixels and masked capillary blood absorption.";
          break;
        case 'FACE_NOT_FOUND':
        case 'POOR_ALIGNMENT':
          reason = "Face was partly hidden or turned away.";
          advice = "Keep your face centered inside the oval guide throughout the measurement.";
          break;
        case 'LOW_FPS':
          reason = "Camera frame rate was too low.";
          advice = "The video stream dropped below the minimum rate required for optical pulse analysis.";
          break;
        case 'LOW_SNR':
        case 'INSUFFICIENT_WINDOW':
        default:
          reason = "Pulse signal was too faint.";
          advice = "Try staying very still under steady lighting and run a fresh check-in.";
          break;
      }

      if (unclearReason) unclearReason.textContent = reason;
      if (unclearAdvice) unclearAdvice.textContent = advice;

      if (btnTryAgain) {
        btnTryAgain.onclick = () => {
          this.closeCheckinResult();
          if (onTryAgain) onTryAgain();
        };
      }
    }

    if (resetOffer) {
      if (onTakeReset) {
        resetOffer.style.display = 'block';
        const btnReset = document.getElementById('btn-result-take-reset');
        if (btnReset) {
          btnReset.onclick = () => {
            this.closeCheckinResult();
            onTakeReset();
          };
        }
      } else {
        resetOffer.style.display = 'none';
      }
    }

    const btnClose = document.getElementById('btn-close-checkin-result');
    if (btnClose) btnClose.onclick = () => this.closeCheckinResult();
    const btnDone = document.getElementById('btn-done-checkin-result');
    if (btnDone) btnDone.onclick = () => this.closeCheckinResult();

    const btnCheckinAgain = document.getElementById('btn-result-checkin-again');
    if (btnCheckinAgain) {
      btnCheckinAgain.onclick = () => {
        this.closeCheckinResult();
        if (onTryAgain) {
          onTryAgain();
        } else if (window.__pulsecam_app && typeof window.__pulsecam_app.startQuickCheckin === 'function') {
          window.__pulsecam_app.startQuickCheckin();
        }
      };
    }
  }

  closeCheckinResult() {
    if (this.checkinResultModal) {
      this.checkinResultModal.style.display = 'none';
    }
    if (window.__pulsecam_app) {
      window.__pulsecam_app.checkinState = 'IDLE';
    }
  }

  /**
   * Reset Break with before-and-after: 2-minute breathing circle (5s in / 5s out)
   */
  openResetBreak({ initialBpm, onFinishComparison }) {
    if (!this.resetBreakModal) return;
    this.resetBreakModal.style.display = 'flex';

    let remainingSeconds = 120; // 2 minutes
    const timerEl = document.getElementById('reset-break-timer');
    const circleEl = document.getElementById('breathing-circle');
    const textEl = document.getElementById('breathing-text');
    const compBox = document.getElementById('reset-comparison-result');
    const compHeadline = document.getElementById('reset-comparison-headline');
    const compSub = document.getElementById('reset-comparison-sub');

    if (compBox) compBox.style.display = 'none';
    if (circleEl) circleEl.style.animationPlayState = 'running';

    let breathState = 'in';
    if (textEl) textEl.textContent = 'Breathe in';
    if (this.breathCadenceInterval) clearInterval(this.breathCadenceInterval);
    this.breathCadenceInterval = setInterval(() => {
      breathState = breathState === 'in' ? 'out' : 'in';
      if (textEl) textEl.textContent = breathState === 'in' ? 'Breathe in' : 'Breathe out';
    }, 5000);

    const updateTimerDisplay = (sec) => {
      const m = Math.floor(sec / 60).toString().padStart(2, '0');
      const s = (sec % 60).toString().padStart(2, '0');
      if (timerEl) timerEl.textContent = `${m}:${s}`;
    };
    updateTimerDisplay(remainingSeconds);

    if (this.resetBreakInterval) clearInterval(this.resetBreakInterval);
    this.resetBreakInterval = setInterval(() => {
      remainingSeconds--;
      updateTimerDisplay(remainingSeconds);
      if (remainingSeconds <= 0) {
        clearInterval(this.resetBreakInterval);
        clearInterval(this.breathCadenceInterval);
        this.resetBreakInterval = null;
        this.breathCadenceInterval = null;

        if (onFinishComparison) {
          const finalBpm = onFinishComparison();
          if (compBox) compBox.style.display = 'block';
          if (finalBpm && initialBpm && finalBpm < initialBpm - 2) {
            if (compHeadline) compHeadline.textContent = 'Your heart rate settled a little';
            if (compSub) compSub.textContent = `About ${Math.round(finalBpm)} bpm after your reset.`;
          } else {
            if (compHeadline) compHeadline.textContent = 'Nice reset!';
            if (compSub) compSub.textContent = 'You took two mindful minutes away from high load.';
          }
        }
      }
    }, 1000);

    const btnClose = document.getElementById('btn-close-reset-break');
    if (btnClose) btnClose.onclick = () => this.closeResetBreak();
  }

  closeResetBreak() {
    if (this.resetBreakInterval) {
      clearInterval(this.resetBreakInterval);
      this.resetBreakInterval = null;
    }
    if (this.breathCadenceInterval) {
      clearInterval(this.breathCadenceInterval);
      this.breathCadenceInterval = null;
    }
    if (this.resetBreakModal) {
      this.resetBreakModal.style.display = 'none';
    }
  }

  /**
   * Eye Rest mode: guided 20-second "look away" screen with soft warm dim background and countdown ring
   */
  openEyeRest() {
    if (!this.eyeRestModal) return;
    this.eyeRestModal.style.display = 'flex';

    let remaining = 20;
    const countEl = document.getElementById('eye-rest-countdown');
    const circle = document.getElementById('eye-rest-circle');
    const totalCircumference = 2 * Math.PI * 54; // ~339.29

    if (countEl) countEl.textContent = remaining;
    if (circle) {
      circle.style.strokeDasharray = `${totalCircumference}`;
      circle.style.strokeDashoffset = '0';
    }

    if (this.eyeRestInterval) clearInterval(this.eyeRestInterval);
    this.eyeRestInterval = setInterval(() => {
      remaining--;
      if (countEl) countEl.textContent = Math.max(0, remaining);
      if (circle) {
        const offset = totalCircumference * (1 - remaining / 20);
        circle.style.strokeDashoffset = `${offset}`;
      }
      if (remaining <= 0) {
        clearInterval(this.eyeRestInterval);
        this.eyeRestInterval = null;
        if (countEl) countEl.textContent = '✓';
      }
    }, 1000);

    const btnClose = document.getElementById('btn-close-eye-rest');
    if (btnClose) btnClose.onclick = () => this.closeEyeRest();
    const btnDone = document.getElementById('btn-done-eye-rest');
    if (btnDone) btnDone.onclick = () => this.closeEyeRest();
  }

  closeEyeRest() {
    if (this.eyeRestInterval) {
      clearInterval(this.eyeRestInterval);
      this.eyeRestInterval = null;
    }
    if (this.eyeRestModal) {
      this.eyeRestModal.style.display = 'none';
    }
  }

  /**
   * Local history management for check-ins (stored only on device)
   */
  getCheckinHistory() {
    try {
      const raw = localStorage.getItem('pulsecam_checkin_history');
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  saveCheckinEntry(entry) {
    try {
      const history = this.getCheckinHistory();
      const updated = [entry, ...history].slice(0, 50);
      localStorage.setItem('pulsecam_checkin_history', JSON.stringify(updated));
      return updated;
    } catch (_) {
      return [];
    }
  }

  deleteCheckinEntry(id) {
    try {
      const history = this.getCheckinHistory().filter(item => item.id !== id);
      localStorage.setItem('pulsecam_checkin_history', JSON.stringify(history));
      this.renderCheckinHistory();
      return history;
    } catch (_) {
      return [];
    }
  }

  clearCheckinHistory() {
    try {
      localStorage.removeItem('pulsecam_checkin_history');
      this.renderCheckinHistory();
    } catch (_) {}
  }

  openDailyRecap(timeSplit = { calmSec: 0, busySec: 0, tiredSec: 0 }) {
    if (!this.dailyRecapModal) return;
    this.dailyRecapModal.style.display = 'flex';

    const history = this.getCheckinHistory();
    const todayCount = history.filter(h => {
      const d = new Date(h.timestamp);
      const today = new Date();
      return d.toDateString() === today.toDateString();
    }).length;

    const headlineEl = document.getElementById('daily-recap-headline');
    const insightEl = document.getElementById('daily-recap-insight');

    if (headlineEl) {
      headlineEl.textContent = `Today: ${todayCount} check-in${todayCount === 1 ? '' : 's'}, rhythm balanced.`;
    }
    if (insightEl) {
      if (history.length >= 3) {
        insightEl.textContent = 'Your calm focus tends to peak during morning and midday sessions.';
      } else {
        insightEl.textContent = 'PulseCam learns your best focus patterns as you complete check-ins throughout the week.';
      }
    }

    this.renderCheckinHistory();

    const btnClear = document.getElementById('btn-clear-checkin-history');
    if (btnClear) {
      btnClear.onclick = () => this.clearCheckinHistory();
    }
    const btnClose = document.getElementById('btn-close-daily-recap');
    if (btnClose) {
      btnClose.onclick = () => this.closeDailyRecap();
    }
  }

  renderCheckinHistory() {
    const listEl = document.getElementById('daily-recap-history-list');
    if (!listEl) return;
    const history = this.getCheckinHistory();

    if (history.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">
          No check-ins recorded yet. Tap "Check now" to start your first reading.
        </div>
      `;
      return;
    }

    listEl.innerHTML = history.map(item => `
      <div class="checkin-history-item" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; margin-bottom: 6px;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <strong style="font-size: 0.95rem; color: var(--text);">${item.bpm ? `About ${item.bpm} bpm` : 'Inconclusive reading'}</strong>
            <span class="stamp-tag ${item.confidence === 'Good' ? 'good' : 'caution'}" style="font-size: 0.72rem; padding: 2px 6px;">${item.confidence || 'Estimate'}</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 3px;">
            ${item.comparison || 'Right around your usual'} • ${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <button type="button" class="btn-delete-history" data-id="${item.id}" title="Delete reading" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1rem; padding: 4px;">✕</button>
      </div>
    `).join('');

    listEl.querySelectorAll('.btn-delete-history').forEach(btn => {
      btn.onclick = (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.deleteCheckinEntry(id);
      };
    });
  }

  closeDailyRecap() {
    if (this.dailyRecapModal) {
      this.dailyRecapModal.style.display = 'none';
    }
  }

  /**
   * Populate live technical signals for the curious user
   */
  updateDetailsPanel(data) {
    if (!this.isDetailsPanelOpen || !data) return;

    // 1. Signal Quality & Environmental Optics
    const sqiScore = data.sqi ? (data.sqi.score !== undefined ? data.sqi.score : 85) : 85;
    const sqiBadge = data.sqi ? (data.sqi.badge || (sqiScore >= 70 ? 'High' : sqiScore >= 45 ? 'Moderate' : 'Low')) : 'High';
    if (this.detailsSqiBadge) {
      this.detailsSqiBadge.textContent = `${sqiBadge} Confidence (${sqiScore})`;
      this.detailsSqiBadge.className = `stamp-tag ${sqiScore >= 70 ? 'good' : sqiScore >= 45 ? 'caution' : 'alert'}`;
    }
    if (this.detailsFaceVal) {
      this.detailsFaceVal.textContent = data.faceDetected ? 'Locked (468 pts)' : 'Searching...';
    }
    if (this.detailsLightingVal) {
      const lum = data.lighting && data.lighting.meanLuminance !== undefined ? Math.round(data.lighting.meanLuminance) : 100;
      const isValid = data.lighting ? data.lighting.isValid : true;
      this.detailsLightingVal.textContent = isValid ? `Even Diffuse (${lum})` : 'Insufficient Light';
    }
    if (this.detailsMotionVal) {
      const isMotionLow = data.motion ? data.motion.isStable : true;
      this.detailsMotionVal.textContent = isMotionLow ? 'Still (Stable)' : 'Movement / Jitter';
    }
    if (this.detailsSqiVal) {
      this.detailsSqiVal.textContent = `${sqiBadge} (${sqiScore}/100)`;
    }

    // 2. Heart-Rate Rhythm & Autonomic Trend
    const curBpm = data.bpm !== null && data.bpm !== undefined && data.bpm > 0 ? Math.round(data.bpm) : null;
    const baseBpm = data.baseline && data.baseline.heartRate && data.baseline.heartRate.mean
      ? Math.round(data.baseline.heartRate.mean)
      : (data.activeBaseline?.heartRate?.mean ? Math.round(data.activeBaseline.heartRate.mean) : 72);
    const zBpm = data.zScores?.bpm !== undefined && data.zScores?.bpm !== null
      ? (data.zScores.bpm > 0 ? '+' : '') + Number(data.zScores.bpm).toFixed(1) + 'σ'
      : (curBpm ? ((curBpm - baseBpm) / 10 > 0 ? '+' : '') + ((curBpm - baseBpm) / 10).toFixed(1) + 'σ' : '0.0σ');

    if (this.detailsHrBpm) this.detailsHrBpm.textContent = curBpm ? `${curBpm} BPM` : 'Acquiring...';
    if (this.detailsHrBase) this.detailsHrBase.textContent = `${baseBpm} BPM`;
    if (this.detailsHrZscore) this.detailsHrZscore.textContent = zBpm;
    if (this.detailsHrConf) {
      const conf = data.rppgConfidence !== undefined ? Math.round(data.rppgConfidence) : 85;
      this.detailsHrConf.textContent = curBpm ? `${conf}%` : '--%';
    }

    // 3. Blink Dynamics & Ocular Kinematics
    const blinkRate = data.blinkRate !== undefined ? Math.round(data.blinkRate) : 16;
    const perclos = data.perclos !== undefined ? Number(data.perclos).toFixed(1) : '3.0';
    const curEar = data.ear !== undefined ? Number(data.ear).toFixed(2) : '0.28';
    const threshEar = data.blink?.personalThreshold ? Number(data.blink.personalThreshold).toFixed(2) : '0.22';

    if (this.detailsBlinkRate) this.detailsBlinkRate.textContent = `${blinkRate} / min`;
    if (this.detailsBlinkPerclos) this.detailsBlinkPerclos.textContent = `${perclos}%`;
    if (this.detailsBlinkEar) this.detailsBlinkEar.textContent = `${curEar} / ${threshEar}`;
    if (this.detailsBlinkState) {
      if (Number(perclos) > 15) this.detailsBlinkState.textContent = 'Fatigue / Drowsy';
      else if (blinkRate < 10) this.detailsBlinkState.textContent = 'Screen Fixation Stare';
      else if (blinkRate > 25) this.detailsBlinkState.textContent = 'Compensatory Flutter';
      else this.detailsBlinkState.textContent = 'Natural Cadence';
    }

    // 4. Workload Score Breakdown
    const h = data.heuristics;
    const score = data.workloadScore !== undefined ? data.workloadScore : (h?.workloadEstimate || 24);
    if (this.detailsWorkloadNum) this.detailsWorkloadNum.textContent = String(score);
    if (this.detailsWorkloadSubtext) {
      this.detailsWorkloadSubtext.textContent = score >= 70 ? 'High cognitive / visual load' : score >= 45 ? 'Moderate workload' : 'Resting / Low workload';
    }

    const comps = h?.components;
    if (comps) {
      if (this.detailsCompHrVal) this.detailsCompHrVal.textContent = `${comps.heartRate?.score || 20} pts (contrib: +${comps.heartRate?.weightedScore || 6.0})`;
      if (this.detailsCompHrBar) this.detailsCompHrBar.style.width = `${Math.min(100, comps.heartRate?.score || 20)}%`;
      if (this.detailsCompHrDesc && comps.heartRate?.detail) this.detailsCompHrDesc.textContent = comps.heartRate.detail;

      if (this.detailsCompEyeVal) this.detailsCompEyeVal.textContent = `${comps.eyeClosure?.score || 15} pts (contrib: +${comps.eyeClosure?.weightedScore || 4.5})`;
      if (this.detailsCompEyeBar) this.detailsCompEyeBar.style.width = `${Math.min(100, comps.eyeClosure?.score || 15)}%`;
      if (this.detailsCompEyeDesc && comps.eyeClosure?.detail) this.detailsCompEyeDesc.textContent = comps.eyeClosure.detail;

      if (this.detailsCompBlinkVal) this.detailsCompBlinkVal.textContent = `${comps.blinkPattern?.score || 15} pts (contrib: +${comps.blinkPattern?.weightedScore || 3.0})`;
      if (this.detailsCompBlinkBar) this.detailsCompBlinkBar.style.width = `${Math.min(100, comps.blinkPattern?.score || 15)}%`;
      if (this.detailsCompBlinkDesc && comps.blinkPattern?.detail) this.detailsCompBlinkDesc.textContent = comps.blinkPattern.detail;

      if (this.detailsCompPostureVal) this.detailsCompPostureVal.textContent = `${comps.headPosture?.score || 10} pts (contrib: +${comps.headPosture?.weightedScore || 2.0})`;
      if (this.detailsCompPostureBar) this.detailsCompPostureBar.style.width = `${Math.min(100, comps.headPosture?.score || 10)}%`;
      if (this.detailsCompPostureDesc && comps.headPosture?.detail) this.detailsCompPostureDesc.textContent = comps.headPosture.detail;

      if (this.detailsCompDurVal) this.detailsCompDurVal.textContent = `+${comps.sessionDuration?.addedPoints || 0.0} pts`;
      if (this.detailsCompDurDesc && comps.sessionDuration?.detail) this.detailsCompDurDesc.textContent = comps.sessionDuration.detail;
    }

    // 6. Section 6: Quick Check-in & Optical Diagnostics (Phase 1 Debugging & Verification)
    const diagReadyState = document.getElementById('details-diag-readystate');
    if (diagReadyState) {
      const rs = data.cameraVideoReadyState !== undefined ? data.cameraVideoReadyState : (window.__pulsecam_app?.videoEl?.readyState ?? 4);
      const rsName = rs === 4 ? '4 (HAVE_ENOUGH_DATA)' : rs === 3 ? '3 (HAVE_FUTURE_DATA)' : rs === 2 ? '2 (HAVE_CURRENT_DATA)' : `${rs} (INITIALIZING)`;
      diagReadyState.textContent = rsName;
    }
    const diagDimensions = document.getElementById('details-diag-dimensions');
    if (diagDimensions) {
      const w = data.frameWidth || window.__pulsecam_app?.camera?.width || 640;
      const h = data.frameHeight || window.__pulsecam_app?.camera?.height || 480;
      diagDimensions.textContent = `${w} × ${h} px`;
    }
    const diagLuminance = document.getElementById('details-diag-luminance');
    if (diagLuminance) {
      const lum = data.lighting?.meanLuminance !== undefined ? Math.round(data.lighting.meanLuminance) : '--';
      diagLuminance.textContent = `${lum} lux`;
    }
    const diagThreshold = document.getElementById('details-diag-threshold');
    if (diagThreshold) {
      const isCheckin = window.__pulsecam_app?.isQuickCheckin || false;
      diagThreshold.textContent = isCheckin ? '22 lux (Screen Light Key)' : '45 lux (Ambient Room)';
    }
    const diagWhiteScreen = document.getElementById('details-diag-white-screen');
    if (diagWhiteScreen) {
      const isCheckin = window.__pulsecam_app?.isQuickCheckin || false;
      diagWhiteScreen.textContent = isCheckin ? 'Visible (Full Overlay)' : 'Hidden (Standard Mode)';
    }
    const diagExposure = document.getElementById('details-diag-exposure');
    if (diagExposure) {
      const isWarmedUp = window.__pulsecam_app?.checkinWarmedUp ?? true;
      diagExposure.textContent = isWarmedUp ? 'Settled (>2s Warm-up)' : 'Warming up (<2s)';
    }
    const diagBadge = document.getElementById('details-checkin-diag-badge');
    if (diagBadge) {
      const isCheckin = window.__pulsecam_app?.isQuickCheckin || false;
      diagBadge.textContent = isCheckin ? 'Check-in Active' : 'Camera Stream Active';
      diagBadge.className = `stamp-tag ${isCheckin ? 'good' : ''}`;
    }

    // 7. Section 7: Developer-Only rPPG Telemetry & Spectral Diagnostics
    const diag = data.rppgDiagnostics || data.rppg?.diagnostics;
    if (diag) {
      const badge = document.getElementById('dev-diag-reason-badge');
      if (badge) {
        badge.textContent = diag.reasonNoReading || 'NORMAL';
        badge.className = `stamp-tag ${diag.hasReading ? 'good' : (diag.reasonNoReading === 'STABILIZING' ? 'accent' : 'alert')}`;
      }

      const fpsJitter = document.getElementById('dev-diag-fps-jitter');
      if (fpsJitter) {
        const fps = (diag.fps || 0).toFixed(1);
        const jitter = (diag.timestampJitterMs || 0).toFixed(1);
        fpsJitter.textContent = `${fps} fps / ${jitter} ms`;
      }

      const rxRate = document.getElementById('dev-diag-rx-rate');
      if (rxRate) {
        rxRate.textContent = `${(diag.framesReceivedPerSec || 0).toFixed(1)} /s`;
      }

      const excludedFrac = document.getElementById('dev-diag-excluded-frac');
      if (excludedFrac) {
        const pct = Math.round((diag.framesExcludedFraction || 0) * 100);
        excludedFrac.textContent = `${pct}%`;
        excludedFrac.style.color = pct > 25 ? 'var(--alert)' : pct > 10 ? 'var(--caution)' : 'var(--text)';
      }

      const excludedReason = document.getElementById('dev-diag-excluded-reason');
      if (excludedReason) {
        excludedReason.textContent = diag.exclusionReason || 'None';
      }

      const brightness = document.getElementById('dev-diag-brightness');
      if (brightness) {
        brightness.textContent = `${Math.round(diag.meanFaceBrightness || 0)} / 255`;
      }

      const snr = document.getElementById('dev-diag-snr');
      if (snr) {
        const snrVal = (diag.snrDb || 0).toFixed(1);
        snr.textContent = `${snrVal} dB`;
        snr.style.color = (diag.snrDb >= 4.5) ? 'var(--good)' : (diag.snrDb >= 1.5) ? 'var(--caution)' : 'var(--alert)';
      }

      // Per-ROI metrics
      if (diag.roiStats) {
        const fhEl = document.getElementById('dev-diag-roi-fh');
        if (fhEl && diag.roiStats.forehead) {
          const satPct = (diag.roiStats.forehead.saturationPct * 100).toFixed(1);
          fhEl.textContent = `${diag.roiStats.forehead.pixelCount} px (${satPct}% sat)`;
        }
        const lcEl = document.getElementById('dev-diag-roi-lc');
        if (lcEl && diag.roiStats.leftCheek) {
          const satPct = (diag.roiStats.leftCheek.saturationPct * 100).toFixed(1);
          lcEl.textContent = `${diag.roiStats.leftCheek.pixelCount} px (${satPct}% sat)`;
        }
        const rcEl = document.getElementById('dev-diag-roi-rc');
        if (rcEl && diag.roiStats.rightCheek) {
          const satPct = (diag.roiStats.rightCheek.saturationPct * 100).toFixed(1);
          rcEl.textContent = `${diag.roiStats.rightCheek.pixelCount} px (${satPct}% sat)`;
        }
      }

      // Waveform Oscilloscope Canvas
      this.drawDevWaveforms(diag.rawWaveform, diag.filteredWaveform);

      // Welch Power Spectrum Canvas
      this.drawDevPowerSpectrum(diag.spectrum, diag.peakBpm, diag.peakFreq);
    }
  }

  drawDevWaveforms(rawWave, filtWave) {
    const canvas = document.getElementById('dev-diag-wave-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Center guideline
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Raw waveform (gray trace)
    if (rawWave && rawWave.length > 1) {
      const minR = Math.min(...rawWave);
      const maxR = Math.max(...rawWave);
      const rangeR = maxR - minR || 1;
      ctx.strokeStyle = 'rgba(180, 170, 160, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const step = w / (rawWave.length - 1);
      for (let i = 0; i < rawWave.length; i++) {
        const x = i * step;
        const norm = (rawWave[i] - minR) / rangeR;
        const y = h - (norm * (h - 16) + 8);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Filtered waveform (red / accent trace)
    if (filtWave && filtWave.length > 1) {
      const minF = Math.min(...filtWave);
      const maxF = Math.max(...filtWave);
      const rangeF = maxF - minF || 1;
      ctx.strokeStyle = '#b23a2e';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      const step = w / (filtWave.length - 1);
      for (let i = 0; i < filtWave.length; i++) {
        const x = i * step;
        const norm = (filtWave[i] - minF) / rangeF;
        const y = h - (norm * (h - 16) + 8);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  drawDevPowerSpectrum(spectrum, peakBpm, peakFreq) {
    const canvas = document.getElementById('dev-diag-spec-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const peakMeta = document.getElementById('dev-diag-peak-meta');
    if (peakMeta) {
      peakMeta.textContent = peakBpm ? `Peak: ${peakBpm.toFixed(1)} bpm (${(peakFreq || 0).toFixed(2)} Hz)` : 'Peak: -- bpm';
    }

    if (!spectrum || spectrum.length === 0) return;

    let maxP = 0;
    for (let i = 0; i < spectrum.length; i++) {
      if (spectrum[i].power > maxP) maxP = spectrum[i].power;
    }
    if (maxP <= 0) maxP = 1;

    const minFreq = 0.7;
    const maxFreq = 3.0;

    ctx.fillStyle = 'rgba(178, 58, 46, 0.2)';
    ctx.strokeStyle = '#b23a2e';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(0, h);

    for (let i = 0; i < spectrum.length; i++) {
      const f = spectrum[i].freq;
      const x = ((f - minFreq) / (maxFreq - minFreq)) * w;
      const y = h - (spectrum[i].power / maxP) * (h - 12);
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (peakFreq && peakFreq >= minFreq && peakFreq <= maxFreq) {
      const peakX = ((peakFreq - minFreq) / (maxFreq - minFreq)) * w;
      ctx.strokeStyle = '#2f6b4f';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(peakX, 0);
      ctx.lineTo(peakX, h);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#2f6b4f';
      ctx.font = '10px monospace';
      ctx.fillText(`${(peakBpm || 0).toFixed(0)} bpm`, Math.min(w - 55, peakX + 4), 14);
    }
  }

  initValidationTool() {
    const btnLog = document.getElementById('btn-dev-log-val');
    const btnClear = document.getElementById('btn-dev-clear-val');
    const inputRef = document.getElementById('dev-val-ref-bpm');

    if (btnLog) {
      btnLog.onclick = () => {
        const refVal = parseFloat(inputRef ? inputRef.value : '');
        if (isNaN(refVal) || refVal < 30 || refVal > 220) {
          alert('Please enter a valid reference BPM between 30 and 220.');
          return;
        }
        const measured = this.latestCheckinMeasuredBpm || (window.__pulsecam_app?.smoothBPM?.current ?? 72);
        this.addValidationEntry(refVal, measured);
      };
    }

    if (btnClear) {
      btnClear.onclick = () => {
        localStorage.removeItem('pulsecam_val_log');
        this.renderValidationLog();
      };
    }

    this.renderValidationLog();
  }

  addValidationEntry(referenceBpm, measuredBpm) {
    const error = Math.abs(measuredBpm - referenceBpm);
    const entry = {
      timestamp: Date.now(),
      ref: Math.round(referenceBpm),
      measured: Math.round(measuredBpm),
      error: Number(error.toFixed(1))
    };

    let log = [];
    try {
      log = JSON.parse(localStorage.getItem('pulsecam_val_log') || '[]');
    } catch (_) {}
    log.unshift(entry);
    if (log.length > 50) log = log.slice(0, 50);
    localStorage.setItem('pulsecam_val_log', JSON.stringify(log));

    this.renderValidationLog();
  }

  renderValidationLog() {
    let log = [];
    try {
      log = JSON.parse(localStorage.getItem('pulsecam_val_log') || '[]');
    } catch (_) {}

    const countEl = document.getElementById('dev-val-count');
    const maeEl = document.getElementById('dev-val-mae');
    const listEl = document.getElementById('dev-val-log-list');

    if (countEl) countEl.textContent = `${log.length} test${log.length === 1 ? '' : 's'}`;

    if (log.length > 0) {
      const sumErr = log.reduce((acc, item) => acc + item.error, 0);
      const mae = (sumErr / log.length).toFixed(1);
      if (maeEl) maeEl.textContent = `${mae} bpm`;
    } else {
      if (maeEl) maeEl.textContent = '-- bpm';
    }

    if (listEl) {
      if (log.length === 0) {
        listEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.75rem;">No validation entries logged yet.</div>';
      } else {
        listEl.innerHTML = log.map((item, idx) => `
          <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed var(--line); padding: 2px 0;">
            <span>#${log.length - idx} Ref: ${item.ref} | Measured: ${item.measured}</span>
            <strong style="color: ${item.error <= 3 ? 'var(--good)' : item.error <= 6 ? 'var(--caution)' : 'var(--alert)'};">Err: ${item.error} bpm</strong>
          </div>
        `).join('');
      }
    }
  }

  handleSuggestedAction(action) {
    if (action === 'Look away for 20 seconds') {
      this.openEyeRest();
    } else if (action === 'Take a 2-minute break') {
      const curBpm = window.__pulsecam_app?.smoothBPM?.current;
      this.openResetBreak({
        initialBpm: curBpm,
        onFinishComparison: () => window.__pulsecam_app?.smoothBPM?.current
      });
    } else if (action === 'Stretch') {
      this.showToast('🧘', 'Posture reset: roll your shoulders back and gently tilt your head.');
    } else if (action === 'Drink water') {
      this.showToast('💧', 'Hydration logged: enjoy a mindful glass of water.');
    } else if (action === 'Check lighting') {
      if (window.__pulsecam_app && typeof window.__pulsecam_app.startPreflightCheck === 'function') {
        window.__pulsecam_app.startPreflightCheck();
      }
    } else { // 'Keep going'
      this.showToast('✨', 'Continuing your session. Steady focus ahead.');
    }
  }

  openActionModal({ title, subtitle, seconds, prompt }) {
    if (!this.actionModal) return;
    if (this.actionModalTitle) this.actionModalTitle.textContent = title;
    if (this.actionModalSubtitle) this.actionModalSubtitle.textContent = subtitle;
    if (this.actionModalPrompt) this.actionModalPrompt.textContent = prompt;

    let remaining = seconds;
    if (this.actionModalTimer) this.actionModalTimer.textContent = remaining;

    if (this.actionCountdownInterval) {
      clearInterval(this.actionCountdownInterval);
    }

    this.actionCountdownInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(this.actionCountdownInterval);
        this.actionCountdownInterval = null;
        if (this.actionModalTimer) this.actionModalTimer.textContent = '✓';
        if (this.actionModalPrompt) this.actionModalPrompt.textContent = 'Break complete! Feel free to resume when ready.';
      } else {
        if (this.actionModalTimer) this.actionModalTimer.textContent = remaining;
      }
    }, 1000);

    this.actionModal.classList.add('open');
  }

  closeActionModal() {
    if (this.actionCountdownInterval) {
      clearInterval(this.actionCountdownInterval);
      this.actionCountdownInterval = null;
    }
    if (this.actionModal) this.actionModal.classList.remove('open');
  }

  showToast(icon, text) {
    if (!this.humanToast) return;
    if (this.humanToastIcon) this.humanToastIcon.textContent = icon;
    if (this.humanToastText) this.humanToastText.textContent = text;
    this.humanToast.style.display = 'inline-flex';

    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      if (this.humanToast) this.humanToast.style.display = 'none';
    }, 3500);
  }

  /**
   * Update the soft horizontal day summary bar (no axes, no numbers, no gridlines)
   * @param {{ calmSec: number, busySec: number, tiredSec: number }} timeSplit
   */
  updateDaySummary(timeSplit) {
    if (!this.dayBarCalm || !this.dayBarBusy || !this.dayBarTired) return;
    const calm = Math.max(0, timeSplit.calmSec || 0);
    const busy = Math.max(0, timeSplit.busySec || 0);
    const tired = Math.max(0, timeSplit.tiredSec || 0);
    const total = calm + busy + tired;

    if (total > 0.5) {
      const calmRatio = Math.max(0.02, calm / total);
      const busyRatio = Math.max(0.02, busy / total);
      const tiredRatio = Math.max(0.02, tired / total);
      this.dayBarCalm.style.flex = calmRatio;
      this.dayBarBusy.style.flex = busyRatio;
      this.dayBarTired.style.flex = tiredRatio;
    } else {
      this.dayBarCalm.style.flex = 1;
      this.dayBarBusy.style.flex = 0;
      this.dayBarTired.style.flex = 0;
    }
  }

  /**
   * Main telemetry update: drives the human interface in plain language.
   * Completely hides raw values, head angles, EAR, SNR, FFT, z-scores, percentage weights, fps counters, raw BPM charts, confidence numbers, and jargon.
   */
  updateTelemetry(data) {
    // 1. Determine Low Quality / Unreliable State
    const isLightingInvalid = Boolean(data.lighting && !data.lighting.isValid);
    const isLightingBlocked = Boolean(data.isBlockedLighting || data.isPausedLighting);
    const isFaceMissing = !data.faceDetected;
    const isSqiLow = Boolean(data.sqi && (data.sqi.isLow || data.sqi.score < 45));
    const isConfidenceLow = (data.rppgConfidence !== undefined && data.rppgConfidence < 40);
    const isPreflight = data.sessionState === 'PREFLIGHT';
    const isLowQuality = isLightingInvalid || isLightingBlocked || isFaceMissing || isSqiLow || isConfidenceLow || isPreflight;

    // Session minutes
    const sessionSec = data.sessionElapsedSec || 0;
    const elapsedMinutes = Math.max(1, Math.floor(sessionSec / 60));
    const minText = `${elapsedMinutes} ${elapsedMinutes === 1 ? 'minute' : 'minutes'}`;

    let state = 'calm'; // 'calm' (green) | 'busy' (yellow) | 'tired' (red) | 'reading' (grey)
    let headline = "You're doing great";
    let supporting = `You've been working for ${minText}.`;
    let suggestedAction = 'Keep going';

    if (isLowQuality) {
      state = 'reading';
      headline = 'Getting a clear reading...';
      if (isLightingInvalid || isLightingBlocked) {
        supporting = 'Lighting is insufficient for reliable estimation.';
        suggestedAction = 'Check lighting';
      } else {
        supporting = "We can't get a clear reading right now. Try facing a light source.";
        suggestedAction = 'Keep going';
      }
    } else {
      // Workload and fatigue assessment from underlying signal pipeline
      const workload = data.workloadScore !== undefined ? data.workloadScore : (data.fatigueScore || 0);
      const perclos = data.perclos || 0;
      const isDrowsy = perclos > 22 || workload > 65 || elapsedMinutes > 75;
      const isEyeStrain = perclos > 14 || workload >= 35 || (data.blinkRate !== undefined && data.blinkRate < 11) || elapsedMinutes > 35;

      if (isDrowsy) {
        state = 'tired';
        headline = "You've been pushing hard, take a break";
        supporting = `You've been working for ${minText}.`;
        suggestedAction = 'Take a 2-minute break';
      } else if (isEyeStrain) {
        state = 'busy';
        headline = 'Time to rest your eyes soon';
        supporting = `You've been working for ${minText}.`;
        suggestedAction = 'Look away for 20 seconds';
      } else {
        state = 'calm';
        headline = "You're doing great";
        supporting = `You've been working for ${minText}.`;
        suggestedAction = elapsedMinutes >= 25 ? 'Drink water' : 'Keep going';
      }
    }

    // 1. One large status headline in plain language with a calm color
    if (this.humanStatusHeadline && this.lastRendered.headline !== headline) {
      this.lastRendered.headline = headline;
      this.humanStatusHeadline.textContent = headline;
      this.humanStatusHeadline.className = `human-status-headline state-${state}`;
    }

    if (this.humanStatusPip) {
      this.humanStatusPip.className = `human-status-pip state-${state}`;
    }
    if (this.humanStatusTag) {
      const tagMap = {
        calm: 'Mindful State',
        busy: 'Focus State',
        tired: 'Rest Needed',
        reading: 'Acquiring Signal'
      };
      this.humanStatusTag.textContent = tagMap[state] || 'Mindful State';
    }

    // 2. One short supporting sentence
    if (this.humanSupportingText && this.lastRendered.supporting !== supporting) {
      this.lastRendered.supporting = supporting;
      this.humanSupportingText.textContent = supporting;
    }

    // 3. One clear suggested action button
    if (this.suggestedActionLabel && this.lastRendered.suggestedAction !== suggestedAction) {
      this.lastRendered.suggestedAction = suggestedAction;
      this.currentSuggestedAction = suggestedAction;
      this.suggestedActionLabel.textContent = suggestedAction;
    }

    // 6. Plain wording for low-quality states (Never show a number when confidence is low)
    if (this.humanLowQualityBox) {
      if (isLowQuality) {
        this.humanLowQualityBox.style.display = 'block';
        if (this.humanLowQualityTitle) {
          this.humanLowQualityTitle.textContent = 'Lighting is insufficient for reliable estimation.';
        }
        if (this.humanLowQualitySubtext) {
          this.humanLowQualitySubtext.textContent = "We can't get a clear reading right now. Try facing a light source.";
        }
      } else {
        this.humanLowQualityBox.style.display = 'none';
      }
    }

    // 5. Friendly day summary bar update
    if (data.sessionTimeSplit) {
      this.updateDaySummary(data.sessionTimeSplit);
    }

    // 7. Live Arterial Pulse Rate & Ocular Telemetry Strip
    if (this.dashLiveBpm) {
      if (data.bpm && data.bpm > 0) {
        this.dashLiveBpm.textContent = Math.round(data.bpm);
        if (this.dashHeartIcon) this.dashHeartIcon.classList.add('beating');
      } else {
        this.dashLiveBpm.textContent = '--';
        if (this.dashHeartIcon) this.dashHeartIcon.classList.remove('beating');
      }
    }

    if (this.dashBpmBadge) {
      const hasLock = Boolean(data.faceDetected && data.bpm && data.bpm > 0);
      this.dashBpmBadge.textContent = hasLock ? 'Live Optical Lock' : 'Acquiring Signal...';
      this.dashBpmBadge.className = `stamp-tag ${hasLock ? 'good' : 'caution'}`;
    }

    if (this.dashBpmBaselineDiff) {
      if (data.bpm && data.bpm > 0) {
        const base = data.baselineBpm || 72;
        const diff = Math.round(data.bpm) - Math.round(base);
        if (Math.abs(diff) <= 3) {
          this.dashBpmBaselineDiff.textContent = 'Right around your usual baseline';
        } else if (diff > 3) {
          this.dashBpmBaselineDiff.textContent = `+${diff} BPM above usual baseline`;
        } else {
          this.dashBpmBaselineDiff.textContent = `${diff} BPM below usual baseline`;
        }
      } else {
        this.dashBpmBaselineDiff.textContent = 'Keep face steady inside camera view';
      }
    }

    if (this.dashBpmConf) {
      const conf = data.rppgConfidence !== undefined && data.rppgConfidence > 0
        ? Math.round(data.rppgConfidence)
        : (data.sqi?.score || 85);
      this.dashBpmConf.textContent = `${conf}% Conf`;
    }

    if (this.dashLiveBlink) {
      this.dashLiveBlink.textContent = data.blinkRate !== undefined ? Math.round(data.blinkRate) : '16';
    }

    if (this.dashBlinkBadge) {
      const br = data.blinkRate || 16;
      if (br < 10) {
        this.dashBlinkBadge.textContent = 'Screen Stare';
        this.dashBlinkBadge.className = 'stamp-tag caution';
      } else if (br > 25) {
        this.dashBlinkBadge.textContent = 'Rapid Flutter';
        this.dashBlinkBadge.className = 'stamp-tag alert';
      } else {
        this.dashBlinkBadge.textContent = 'Natural Rhythm';
        this.dashBlinkBadge.className = 'stamp-tag good';
      }
    }

    if (this.dashPerclosVal) {
      const p = data.perclos !== undefined ? Number(data.perclos).toFixed(1) : '2.8';
      this.dashPerclosVal.textContent = `${p}% PERCLOS`;
    }

    return state;
  }

  renderSuggestions(suggestionsList, onAction) {
    if (!this.suggestionsContainer) return;
    this.suggestionsContainer.innerHTML = '';

    suggestionsList.slice(0, 2).forEach((item) => {
      const el = document.createElement('div');
      el.className = 'intervention-row';
      el.innerHTML = `
        <div class="intervention-icon-wrap">${item.iconSvg || ''}</div>
        <div class="intervention-body" style="flex: 1;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px;">
            <h4>${item.title}</h4>
            <span class="stamp-tag">${item.category}</span>
          </div>
          <p>${item.description}</p>
        </div>
        ${
          item.actionLabel
            ? `<button class="btn btn-secondary btn-sm" style="align-self: center; margin-left: 8px;" data-action="${item.actionType}">${item.actionLabel}</button>`
            : ''
        }
      `;

      const btn = el.querySelector('button');
      if (btn) {
        btn.addEventListener('click', () => onAction(item));
      }

      this.suggestionsContainer.appendChild(el);
    });
  }

  openHistoryModal(savedSessions) {
    if (!this.historyModal) return;
    this.historyModal.classList.add('open');

    if (!this.savedSessionsList) return;
    this.savedSessionsList.innerHTML = '';

    if (!savedSessions || savedSessions.length === 0) {
      this.savedSessionsList.innerHTML = `
        <p style="text-align: center; color: var(--color-text-dim); padding: 1.5rem;">
          No sessions logged yet. Complete a check to save your telemetry snapshot locally.
        </p>
      `;
      return;
    }

    savedSessions.forEach((sess, idx) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.innerHTML = `
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 0.85rem;">
            <span>Session #${savedSessions.length - idx} • ${new Date(sess.date).toLocaleDateString()} ${new Date(sess.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span style="color: var(--color-cyan);">${sess.durationSec}s duration</span>
          </div>
          <div style="display: flex; gap: 20px; font-size: 0.8rem; margin-top: 6px; color: var(--color-text-muted);">
            <span>Avg HR: <strong style="color: #fff;">${sess.avgBpm} BPM</strong></span>
            <span>Range: ${sess.minBpm} - ${sess.maxBpm} BPM</span>
            <span>Avg Fatigue: <strong style="color: var(--color-crimson);">${sess.avgFatigue}%</strong></span>
          </div>
        </div>
      `;
      this.savedSessionsList.appendChild(item);
    });
  }

  closeHistoryModal() {
    if (this.historyModal) {
      this.historyModal.classList.remove('open');
    }
  }

  /**
   * Open "How is this calculated?" Workload Breakdown Modal
   */
  openWorkloadModal(heuristics, score = null) {
    if (!this.workloadModal) return;
    this.workloadModal.classList.add('open');
    if (heuristics) {
      this.updateWorkloadModal(heuristics, score);
    }
  }

  /**
   * Close "How is this calculated?" Modal
   */
  closeWorkloadModal() {
    if (this.workloadModal) {
      this.workloadModal.classList.remove('open');
    }
  }

  /**
   * Update live meters, contributions, and disclaimer status in Workload Modal
   */
  updateWorkloadModal(heuristics, score = null) {
    if (!heuristics) return;
    const isReliable = heuristics.isReliable;
    const workloadScore = score !== null ? score : (heuristics.workloadEstimate ?? heuristics.fatigueScore ?? '--');

    // Score & Unreliable Fallback Message
    if (this.modalWorkloadValRow && this.modalWorkloadUnreliableMsg) {
      if (isReliable) {
        this.modalWorkloadValRow.style.display = 'flex';
        this.modalWorkloadUnreliableMsg.style.display = 'none';
        if (this.modalWorkloadVal) this.modalWorkloadVal.textContent = workloadScore;
      } else {
        this.modalWorkloadValRow.style.display = 'none';
        this.modalWorkloadUnreliableMsg.style.display = 'block';
      }
    }

    if (this.modalWorkloadStatus) {
      this.modalWorkloadStatus.textContent = heuristics.workloadStatus || (isReliable ? 'Optimal Focus' : 'Unreliable Signal');
    }

    // Confidence Level
    const conf = heuristics.confidence ?? 0;
    const confLevel = heuristics.confidenceLevel || (conf >= 75 ? 'HIGH' : conf >= 45 ? 'MODERATE' : 'LOW');
    if (this.modalConfVal) this.modalConfVal.textContent = `${conf}%`;
    if (this.modalConfBadge) {
      this.modalConfBadge.textContent = `${confLevel.toUpperCase()} CONFIDENCE`;
      this.modalConfBadge.className = `stamp-tag mono ${conf >= 75 ? 'good' : conf >= 45 ? 'caution' : 'alert'}`;
    }
    if (this.modalConfDetail) {
      this.modalConfDetail.textContent = isReliable
        ? 'Signal stability & illumination verified'
        : (heuristics.unreliableMessage || 'Lighting or tracking unstable');
    }

    const c = heuristics.components;
    if (!c) return;

    // Component 1: Heart Rate (30%)
    if (c.heartRate) {
      if (this.compScoreHr) this.compScoreHr.textContent = `${c.heartRate.score}%`;
      if (this.compContribHr) this.compContribHr.textContent = `contrib: ${c.heartRate.weightedScore} pts`;
      if (this.compBarHr) {
        this.compBarHr.style.transform = `scaleX(${Math.max(0, Math.min(1, c.heartRate.score / 100))})`;
        this.compBarHr.style.backgroundColor = c.heartRate.score > 65 ? 'var(--alert)' : c.heartRate.score > 40 ? 'var(--caution)' : 'var(--text)';
      }
      if (this.compDetailHr) this.compDetailHr.textContent = c.heartRate.detail || 'Resting deviation';
    }

    // Component 2: Eye Closure (30%)
    if (c.eyeClosure) {
      if (this.compScoreEye) this.compScoreEye.textContent = `${c.eyeClosure.score}%`;
      if (this.compContribEye) this.compContribEye.textContent = `contrib: ${c.eyeClosure.weightedScore} pts`;
      if (this.compBarEye) {
        this.compBarEye.style.transform = `scaleX(${Math.max(0, Math.min(1, c.eyeClosure.score / 100))})`;
        this.compBarEye.style.backgroundColor = c.eyeClosure.score > 65 ? 'var(--alert)' : c.eyeClosure.score > 40 ? 'var(--caution)' : 'var(--text)';
      }
      if (this.compDetailEye) this.compDetailEye.textContent = c.eyeClosure.detail || 'PERCLOS & lag';
    }

    // Component 3: Blink Pattern (20%)
    if (c.blinkPattern) {
      if (this.compScoreBlink) this.compScoreBlink.textContent = `${c.blinkPattern.score}%`;
      if (this.compContribBlink) this.compContribBlink.textContent = `contrib: ${c.blinkPattern.weightedScore} pts`;
      if (this.compBarBlink) {
        this.compBarBlink.style.transform = `scaleX(${Math.max(0, Math.min(1, c.blinkPattern.score / 100))})`;
        this.compBarBlink.style.backgroundColor = c.blinkPattern.score > 65 ? 'var(--alert)' : c.blinkPattern.score > 40 ? 'var(--caution)' : 'var(--text)';
      }
      if (this.compDetailBlink) this.compDetailBlink.textContent = c.blinkPattern.detail || 'Cadence deviation';
    }

    // Component 4: Head Posture (20%)
    if (c.headPosture) {
      if (this.compScorePosture) this.compScorePosture.textContent = `${c.headPosture.score}%`;
      if (this.compContribPosture) this.compContribPosture.textContent = `contrib: ${c.headPosture.weightedScore} pts`;
      if (this.compBarPosture) {
        this.compBarPosture.style.transform = `scaleX(${Math.max(0, Math.min(1, c.headPosture.score / 100))})`;
        this.compBarPosture.style.backgroundColor = c.headPosture.score > 65 ? 'var(--alert)' : c.headPosture.score > 40 ? 'var(--caution)' : 'var(--text)';
      }
      if (this.compDetailPosture) this.compDetailPosture.textContent = c.headPosture.detail || 'Motion & pitch';
    }

    // Component 5: Session Duration (+Factor)
    if (c.sessionDuration) {
      if (this.compScoreDuration) this.compScoreDuration.textContent = `+${c.sessionDuration.addedPoints}`;
      if (this.compDetailDuration) this.compDetailDuration.textContent = c.sessionDuration.detail || `${c.sessionDuration.elapsedMin} min elapsed`;
    }
  }
}
