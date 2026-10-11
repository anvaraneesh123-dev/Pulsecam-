/**
 * PulseCam - Calm Mindful Alert System
 * Displays at most one alert at a time as a small, calm top-of-screen banner.
 * Strict rules:
 * 1. Friendly, short sentences with no numbers (e.g. "Looking good. Keep going!").
 * 2. Never repeat the same alert within 15 minutes.
 * 3. Snooze (30 min) and Dismiss actions.
 * 4. Silent by default; optional gentle Web Audio chime enabled in settings.
 * 5. Strictly zero alarming words or terms: "diagnose", "stress detection", "burnout".
 * 6. Only fires when signal confidence is high enough.
 */

export class AlertSystem {
  constructor(options = {}) {
    this.container = options.container || document.getElementById('top-alert-banner');
    this.messageEl = options.messageEl || document.getElementById('top-alert-message');
    this.btnDismiss = options.btnDismiss || document.getElementById('btn-alert-dismiss');
    this.btnSnooze = options.btnSnooze || document.getElementById('btn-alert-snooze');

    this.onToast = options.onToast || null;
    this.btnAction = options.btnAction || document.getElementById('btn-alert-action');
    this.onCheckinRequested = options.onCheckinRequested || null;

    // Periodic Quick Check-in reminder interval (0 = off, 30 min, 60 min)
    const storedReminder = localStorage.getItem('pulsecam_checkin_reminder');
    this.checkinReminderMinutes = storedReminder ? parseInt(storedReminder, 10) : 0;
    this.lastCheckinReminderTime = Date.now();

    // Reminder gentleness setting ('gentle' | 'normal' | 'off')
    this.gentleness = localStorage.getItem('pulsecam_gentleness') || 'normal';

    // Quiet hours setting
    this.quietStart = localStorage.getItem('pulsecam_quiet_start') || '22:00';
    this.quietEnd = localStorage.getItem('pulsecam_quiet_end') || '08:00';

    // Cooldown tracking (15 minutes default; 25 minutes for gentle mode)
    this.COOLDOWN_MS = this.gentleness === 'gentle' ? 25 * 60 * 1000 : 15 * 60 * 1000;
    this.cooldowns = {};

    // Snooze tracking (30 minutes default)
    this.SNOOZE_MS = 30 * 60 * 1000;
    const storedSnooze = localStorage.getItem('pulsecam_snooze_until');
    this.snoozeUntil = storedSnooze ? parseInt(storedSnooze, 10) : 0;
    if (isNaN(this.snoozeUntil) || this.snoozeUntil < Date.now()) {
      this.snoozeUntil = 0;
    }

    // Audio Chime setting (Off by default)
    this.soundEnabled = localStorage.getItem('pulsecam_sound_enabled') === 'true';
    this.audioCtx = null;

    // Active alert state
    this.currentAlert = null;
    this.dismissTimeout = null;
    this.lastEvaluationTime = 0;

    // State tracking for conditions
    this.sustainedCalmDuration = 0;
    this.sustainedStrainDuration = 0;

    this.initEvents();
  }

  setGentleness(level) {
    this.gentleness = level;
    this.COOLDOWN_MS = this.gentleness === 'gentle' ? 25 * 60 * 1000 : 15 * 60 * 1000;
    try {
      localStorage.setItem('pulsecam_gentleness', level);
    } catch (_) {}
  }

  setQuietHours(start, end) {
    this.quietStart = start;
    this.quietEnd = end;
    try {
      localStorage.setItem('pulsecam_quiet_start', start);
      localStorage.setItem('pulsecam_quiet_end', end);
    } catch (_) {}
  }

  isQuietHours() {
    if (!this.quietStart || !this.quietEnd) return false;
    const now = new Date();
    const curMin = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = this.quietStart.split(':').map(Number);
    const [eh, em] = this.quietEnd.split(':').map(Number);
    const startMin = sh * 60 + (sm || 0);
    const endMin = eh * 60 + (em || 0);

    if (startMin < endMin) {
      return curMin >= startMin && curMin < endMin;
    } else {
      return curMin >= startMin || curMin < endMin;
    }
  }

  initEvents() {
    if (this.btnDismiss) {
      this.btnDismiss.addEventListener('click', () => {
        this.dismiss();
      });
    }

    if (this.btnSnooze) {
      this.btnSnooze.addEventListener('click', () => {
        this.snooze(this.SNOOZE_MS);
      });
    }

    if (this.btnAction) {
      this.btnAction.addEventListener('click', () => {
        const action = this.currentAlert?.action;
        this.dismiss();
        if (typeof action === 'function') {
          action();
        } else if (this.onCheckinRequested) {
          this.onCheckinRequested();
        }
      });
    }
  }

  setCheckinReminderInterval(minutes) {
    this.checkinReminderMinutes = parseInt(minutes, 10) || 0;
    this.lastCheckinReminderTime = Date.now();
    try {
      localStorage.setItem('pulsecam_checkin_reminder', String(this.checkinReminderMinutes));
    } catch (_) {}
  }

  /**
   * Check if signal confidence is high enough to warrant delivering a wellness alert.
   * If lighting is insufficient, face is missing, or confidence is low, alerts remain silent.
   */
  isSignalConfidenceAdequate(data) {
    if (!data) return false;
    if (!data.cameraActive) return false;
    if (!data.faceDetected) return false;
    if (data.sessionState !== 'MEASURING') return false;
    if (data.isBlockedLighting || data.isPausedLighting) return false;
    if (data.lighting && !data.lighting.isValid) return false;
    if (data.sqi && (data.sqi.isLow || data.sqi.score < 50)) return false;
    if (data.rppgConfidence !== undefined && data.rppgConfidence < 40) return false;
    return true;
  }

  /**
   * Check if alerts are currently snoozed
   */
  isSnoozed() {
    return Date.now() < this.snoozeUntil;
  }

  getRemainingSnoozeMinutes() {
    if (!this.isSnoozed()) return 0;
    return Math.max(1, Math.ceil((this.snoozeUntil - Date.now()) / 60000));
  }

  /**
   * Snooze alerts for a duration
   */
  snooze(durationMs = this.SNOOZE_MS) {
    this.snoozeUntil = Date.now() + durationMs;
    try {
      localStorage.setItem('pulsecam_snooze_until', String(this.snoozeUntil));
    } catch (_) {}

    this.dismiss();

    if (this.onToast) {
      this.onToast('🌙', 'Alerts snoozed for 30 minutes.');
    }
  }

  /**
   * Resume alerts immediately (clear snooze)
   */
  resumeAlerts() {
    this.snoozeUntil = 0;
    try {
      localStorage.removeItem('pulsecam_snooze_until');
    } catch (_) {}

    if (this.onToast) {
      this.onToast('✨', 'Wellness alerts active.');
    }
  }

  /**
   * Set sound setting
   */
  setSoundEnabled(enabled) {
    this.soundEnabled = Boolean(enabled);
    try {
      localStorage.setItem('pulsecam_sound_enabled', this.soundEnabled ? 'true' : 'false');
    } catch (_) {}
  }

  /**
   * Synthesize a gentle mindfulness chime using Web Audio API (silent by default)
   */
  playGentleChime() {
    if (!this.soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const ctx = this.audioCtx;
      const now = ctx.currentTime;

      // Soft first bell harmonic (C5 523.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now);
      gain1.gain.setValueAtTime(0.0001, now);
      gain1.gain.exponentialRampToValueAtTime(0.06, now + 0.04);
      gain1.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 1.3);

      // Soft second bell harmonic (E5 659.25 Hz)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, now + 0.12);
      gain2.gain.setValueAtTime(0.0001, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.05, now + 0.16);
      gain2.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 1.5);
    } catch (err) {
      console.debug('Chime playback skipped:', err);
    }
  }

  /**
   * Main evaluation step called during telemetry updates.
   * Runs every ~4 seconds.
   */
  evaluate(data, dt = 0.016) {
    // 1. If an alert is already visible, show at most one alert at a time
    if (this.currentAlert) return;

    // 2. If snoozed, gentleness is off, or within quiet hours, remain silent
    if (this.isSnoozed() || this.gentleness === 'off' || this.isQuietHours()) return;

    // 3. Alerts only appear when signal confidence is high enough
    if (!this.isSignalConfidenceAdequate(data)) {
      return;
    }

    const now = Date.now();

    // Periodic Check-in reminder evaluation (never launches automatically, only delivers a gentle alert)
    if (this.checkinReminderMinutes > 0) {
      const reminderIntervalMs = this.checkinReminderMinutes * 60 * 1000;
      if (now - this.lastCheckinReminderTime >= reminderIntervalMs) {
        this.lastCheckinReminderTime = now;
        this.showAlert({
          id: 'checkin_reminder',
          text: 'Ready for a 60-second check-in? Take a calm moment for yourself.',
          actionLabel: 'Start Check-in',
          action: () => {
            if (this.onCheckinRequested) this.onCheckinRequested();
          }
        });
        return;
      }
    }

    if (now - this.lastEvaluationTime < 3500) {
      return;
    }
    this.lastEvaluationTime = now;

    const sessionMinutes = data.sessionElapsedSec ? Math.floor(data.sessionElapsedSec / 60) : 0;
    const perclos = data.perclos || 0;
    const blinkRate = data.blinkRate !== undefined ? data.blinkRate : 16;
    const workloadScore = data.workloadScore !== undefined ? data.workloadScore : (data.fatigueScore || 0);

    // Track sustained physiological periods
    if (perclos > 15 || blinkRate < 10) {
      this.sustainedStrainDuration += 4;
    } else {
      this.sustainedStrainDuration = Math.max(0, this.sustainedStrainDuration - 2);
    }

    if (workloadScore < 30 && perclos < 10) {
      this.sustainedCalmDuration += 4;
    } else {
      this.sustainedCalmDuration = Math.max(0, this.sustainedCalmDuration - 2);
    }

    // Candidate Alert Definitions (Short, friendly, no numbers, no alarming words)
    const candidates = [
      // Alert A: Eye tiredness
      {
        id: 'eye_tired',
        text: 'Your eyes look tired. Try looking away for 20 seconds.',
        condition: () => this.sustainedStrainDuration >= 12 || perclos > 20
      },
      // Alert B: Long focused session
      {
        id: 'long_focus',
        text: "You've been focused for a long time. A short walk could help.",
        condition: () => sessionMinutes >= 45 && workloadScore >= 40
      },
      // Alert C: Positive steady progress
      {
        id: 'looking_good',
        text: 'Looking good. Keep going!',
        condition: () => sessionMinutes >= 15 && this.sustainedCalmDuration >= 20
      },
      // Alert D: Physical posture reset
      {
        id: 'relax_shoulders',
        text: 'Remember to relax your shoulders and take an easy breath.',
        condition: () => sessionMinutes >= 25 && workloadScore >= 35
      },
      // Alert E: Gentle hydration reminder
      {
        id: 'drink_water',
        text: 'A glass of water might feel refreshing right now.',
        condition: () => sessionMinutes >= 35
      }
    ];

    // Find the first candidate that meets its condition and has passed the 15-minute cooldown
    for (const item of candidates) {
      const lastShown = this.cooldowns[item.id] || 0;
      const isCooldownPassed = (now - lastShown) >= this.COOLDOWN_MS;

      if (isCooldownPassed && item.condition()) {
        this.showAlert(item);
        break;
      }
    }
  }

  /**
   * Display a calm top alert banner
   */
  showAlert({ id, text, actionLabel, action }) {
    if (this.currentAlert || this.isSnoozed()) return;

    this.currentAlert = { id, text, actionLabel, action, timestamp: Date.now() };
    this.cooldowns[id] = Date.now();

    if (!this.container) {
      this.container = document.getElementById('top-alert-banner');
    }
    if (!this.messageEl) {
      this.messageEl = document.getElementById('top-alert-message');
    }

    if (this.messageEl) {
      this.messageEl.textContent = text;
    }

    if (this.btnAction) {
      if (actionLabel) {
        this.btnAction.textContent = actionLabel;
        this.btnAction.style.display = 'inline-flex';
      } else {
        this.btnAction.style.display = 'none';
      }
    }

    if (this.container) {
      this.container.classList.remove('hiding');
      this.container.style.display = 'block';
    }

    // Play optional gentle chime
    this.playGentleChime();

    // Auto-dismiss peacefully after 25 seconds if unhandled
    if (this.dismissTimeout) clearTimeout(this.dismissTimeout);
    this.dismissTimeout = setTimeout(() => {
      this.dismiss();
    }, 25000);
  }

  dismiss() {
    if (this.dismissTimeout) {
      clearTimeout(this.dismissTimeout);
      this.dismissTimeout = null;
    }

    if (this.btnAction) {
      this.btnAction.style.display = 'none';
    }

    if (!this.container) {
      this.currentAlert = null;
      return;
    }

    this.container.classList.add('hiding');
    setTimeout(() => {
      if (this.container) {
        this.container.style.display = 'none';
        this.container.classList.remove('hiding');
      }
      this.currentAlert = null;
    }, 260);
  }

  /**
   * Trigger a test alert (useful for settings preview & validation)
   */
  triggerTestAlert(customText = 'Looking good. Keep going!') {
    this.showAlert({
      id: 'test_alert_' + Date.now(),
      text: customText
    });
  }
}
