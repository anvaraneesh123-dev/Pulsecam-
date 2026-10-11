/**
 * PulseCam - Timeline & Live PPG Oscilloscope Module
 * Renders real-time arterial pulse wave oscilloscope and tracks
 * session trends (BPM, Fatigue, Blinks) locally in browser memory & localStorage.
 */

export class TimelineManager {
  constructor(oscilloscopeCanvasId, trendCanvasId = null, dashCanvasId = 'dash-pulse-canvas') {
    this.oscCanvas = document.getElementById(oscilloscopeCanvasId);
    this.oscCtx = this.oscCanvas ? this.oscCanvas.getContext('2d') : null;

    this.trendCanvas = trendCanvasId ? document.getElementById(trendCanvasId) : null;
    this.trendCtx = this.trendCanvas ? this.trendCanvas.getContext('2d') : null;

    this.dashCanvas = dashCanvasId ? document.getElementById(dashCanvasId) : null;
    this.dashCtx = this.dashCanvas ? this.dashCanvas.getContext('2d') : null;

    // Buffer for high-frequency PPG waveform (150 points)
    this.waveformHistory = new Array(120).fill(0);
    this.waveformMin = -1;
    this.waveformMax = 1;

    // Session log samples taken once every second
    this.sessionTimeline = []; // { timestamp, bpm, fatigue, blinks }
    this.lastLogTime = 0;
  }

  /**
   * Push live raw/filtered PPG sample and redraw oscilloscope
   */
  pushWaveform(val) {
    this.waveformHistory.push(val);
    if (this.waveformHistory.length > 140) {
      this.waveformHistory.shift();
    }
    this.renderOscilloscope();
  }

  /**
   * Log 1-second interval session telemetry
   */
  logInterval(metrics) {
    const now = Date.now();
    if (now - this.lastLogTime >= 1000) {
      this.lastLogTime = now;
      if (metrics.bpm && metrics.bpm > 0) {
        this.sessionTimeline.push({
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          timestamp: now,
          bpm: metrics.bpm,
          fatigue: metrics.fatigue || 20,
          blinkRate: metrics.blinkRate || 15
        });

        // Limit live session timeline to recent 300 points (5 minutes)
        if (this.sessionTimeline.length > 300) {
          this.sessionTimeline.shift();
        }

        this.renderTrendChart();
      }
    }
  }

  /**
   * Render handcrafted live PPG pulse wave as a clean physiological kymograph
   */
  renderOscilloscope() {
    this.drawWaveformToContext(this.oscCtx, this.oscCanvas, false);
    this.drawWaveformToContext(this.dashCtx, this.dashCanvas, true);
  }

  drawWaveformToContext(ctx, canvas, isDark = false) {
    if (!ctx || !canvas) return;
    const w = canvas.width;
    const h = canvas.height;

    // Background fill
    ctx.fillStyle = isDark ? '#1C1917' : '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    // Fine hairline grid lines
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.05)' : '#E2D6C6';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Midline (subtle dashed hairline)
    ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.10)' : '#D5C7B5';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const data = this.waveformHistory;
    if (data.length < 2) return;

    // Adaptive auto-scale
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i++) {
      if (data[i] < min) min = data[i];
      if (data[i] > max) max = data[i];
    }
    const range = Math.max(0.2, max - min);
    const stepX = w / (data.length - 1);

    // Draw clean arterial pulse wave in garnet accent
    ctx.save();
    ctx.beginPath();

    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i] - min) / range; // 0 to 1
      const y = h - (normalized * (h * 0.72) + h * 0.14);
      const x = i * stepX;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        const prevX = (i - 1) * stepX;
        const prevNormalized = (data[i - 1] - min) / range;
        const prevY = h - (prevNormalized * (h * 0.72) + h * 0.14);
        const midX = (prevX + x) / 2;
        ctx.bezierCurveTo(midX, prevY, midX, y, x, y);
      }
    }

    ctx.strokeStyle = isDark ? '#c24b3e' : '#9B2C2C';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Pulse head terminal dot
    const lastY = h - (((data[data.length - 1] - min) / range) * (h * 0.72) + h * 0.14);
    ctx.fillStyle = isDark ? '#c24b3e' : '#9B2C2C';
    ctx.beginPath();
    ctx.arc(w - 2, lastY, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Render session trend chart (BPM & Fatigue trends over time) in editorial print style
   */
  renderTrendChart() {
    if (!this.trendCtx || !this.trendCanvas || this.sessionTimeline.length < 2) return;
    const ctx = this.trendCtx;
    const w = this.trendCanvas.width;
    const h = this.trendCanvas.height;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    // Hairline grid
    ctx.strokeStyle = '#E2D6C6';
    ctx.lineWidth = 1;
    for (let y = 20; y < h; y += 30) {
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(w - 10, y);
      ctx.stroke();
    }

    const data = this.sessionTimeline;
    const stepX = (w - 20) / (data.length - 1);

    // BPM bounds
    const minBpm = 50;
    const maxBpm = 120;
    const bpmRange = maxBpm - minBpm;

    // Draw BPM curve (--accent: #9B2C2C)
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = 10 + i * stepX;
      const bpmNorm = Math.max(0, Math.min(1, (data[i].bpm - minBpm) / bpmRange));
      const y = h - 20 - bpmNorm * (h - 40);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#9B2C2C';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw Fatigue curve (--caution: #D9A441)
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = 10 + i * stepX;
      const fatigueNorm = Math.max(0, Math.min(1, data[i].fatigue / 100));
      const y = h - 20 - fatigueNorm * (h - 40);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#D9A441';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Save session snapshot to localStorage for private user history
   */
  saveSessionSummary() {
    if (this.sessionTimeline.length === 0) return;

    const bpms = this.sessionTimeline.map((d) => d.bpm);
    const avgBpm = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);
    const fatigues = this.sessionTimeline.map((d) => d.fatigue);
    const avgFatigue = Math.round(fatigues.reduce((a, b) => a + b, 0) / fatigues.length);

    const record = {
      date: new Date().toISOString(),
      durationSec: this.sessionTimeline.length,
      avgBpm,
      avgFatigue,
      minBpm: Math.min(...bpms),
      maxBpm: Math.max(...bpms)
    };

    try {
      const existing = JSON.parse(localStorage.getItem('pulsecam_sessions') || '[]');
      existing.unshift(record);
      // Keep up to 20 past sessions
      localStorage.setItem('pulsecam_sessions', JSON.stringify(existing.slice(0, 20)));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  }

  getSavedSessions() {
    try {
      return JSON.parse(localStorage.getItem('pulsecam_sessions') || '[]');
    } catch (e) {
      return [];
    }
  }
}
