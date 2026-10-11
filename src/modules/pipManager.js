/**
 * PulseCam - Picture-in-Picture & Always-on-Top Mini Window Manager
 * Uses Document Picture-in-Picture where supported (Chromium 111+) to display
 * a floating mini window showing only the simple status color, short message,
 * "Camera on" indicator, and Pause / Stop controls.
 *
 * Gracefully falls back to an in-page floating widget if unsupported.
 */

export class PipManager {
  constructor(options = {}) {
    this.onTogglePause = options.onTogglePause || null;
    this.onStop = options.onStop || null;

    this.pipWindow = null;
    this.fallbackWidget = null;
    this.isFallbackOpen = false;

    // Current state cache
    this.currentState = {
      statusColor: '#2F6B4F', // Forest green default
      statusState: 'calm',
      message: 'You seem calm and focused',
      cameraActive: false,
      isPaused: false
    };

    this.initFallbackWidget();
  }

  /**
   * Initialize in-page floating widget DOM element as fallback
   */
  initFallbackWidget() {
    let el = document.getElementById('pulsecam-floating-widget');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pulsecam-floating-widget';
      el.className = 'pulsecam-floating-pip-widget';
      el.style.display = 'none';
      el.innerHTML = `
        <div class="pip-widget-inner">
          <div class="pip-widget-topbar">
            <div class="pip-camera-tag">
              <span class="pip-status-pip green"></span>
              <span class="pip-camera-text">Camera on</span>
            </div>
            <button type="button" class="pip-close-btn" id="pip-widget-close" title="Close mini widget">✕</button>
          </div>
          <div class="pip-widget-center">
            <span class="pip-state-indicator" id="pip-widget-dot"></span>
            <p class="pip-widget-message" id="pip-widget-msg">You seem calm and focused</p>
          </div>
          <div class="pip-widget-actions">
            <button type="button" class="btn btn-sm btn-pip" id="pip-widget-pause">Pause</button>
            <button type="button" class="btn btn-sm btn-pip btn-pip-stop" id="pip-widget-stop">Stop</button>
          </div>
        </div>
      `;
      document.body.appendChild(el);

      const closeBtn = el.querySelector('#pip-widget-close');
      if (closeBtn) closeBtn.onclick = () => this.close();

      const pauseBtn = el.querySelector('#pip-widget-pause');
      if (pauseBtn) {
        pauseBtn.onclick = () => {
          if (this.onTogglePause) this.onTogglePause();
        };
      }

      const stopBtn = el.querySelector('#pip-widget-stop');
      if (stopBtn) {
        stopBtn.onclick = () => {
          if (this.onStop) this.onStop();
        };
      }
    }
    this.fallbackWidget = el;
  }

  isOpen() {
    return Boolean(this.pipWindow || this.isFallbackOpen);
  }

  /**
   * Request or toggle Document Picture-in-Picture window
   */
  async toggle() {
    if (this.isOpen()) {
      this.close();
      return false;
    } else {
      return await this.open();
    }
  }

  async open() {
    // Attempt standard Document Picture-in-Picture API first (Chromium)
    if ('documentPictureInPicture' in window && typeof window.documentPictureInPicture.requestWindow === 'function') {
      try {
        const pip = await window.documentPictureInPicture.requestWindow({
          width: 340,
          height: 180,
          disallowReturnToOpener: false
        });

        this.pipWindow = pip;
        this.injectDocumentPipStyles(pip.document);
        this.renderDocumentPipHtml(pip.document);

        pip.addEventListener('pagehide', () => {
          this.pipWindow = null;
        });

        this.update(this.currentState);
        return true;
      } catch (err) {
        console.warn('[PulseCam PiP] Document PiP launch skipped or denied, using floating widget:', err);
      }
    }

    // Fallback: In-page floating widget
    if (this.fallbackWidget) {
      this.fallbackWidget.style.display = 'block';
      this.isFallbackOpen = true;
      this.update(this.currentState);
      return true;
    }
    return false;
  }

  close() {
    if (this.pipWindow) {
      try {
        this.pipWindow.close();
      } catch (_) {}
      this.pipWindow = null;
    }
    if (this.fallbackWidget) {
      this.fallbackWidget.style.display = 'none';
      this.isFallbackOpen = false;
    }
  }

  injectDocumentPipStyles(doc) {
    const style = doc.createElement('style');
    style.textContent = `
      :root {
        --bg-pip: #FAF8F5;
        --text-pip: #2B231D;
        --border-pip: rgba(107, 84, 68, 0.2);
        --good: #2F6B4F;
        --warn: #D97706;
        --alert: #B91C1C;
        --pip-gray: #6B5444;
      }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        background: var(--bg-pip);
        color: var(--text-pip);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        height: 100vh;
        padding: 12px 14px;
        user-select: none;
        overflow: hidden;
      }
      .pip-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .camera-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--good);
        background: rgba(47, 107, 79, 0.08);
        border: 1px solid rgba(47, 107, 79, 0.25);
        padding: 2px 7px;
        border-radius: 999px;
      }
      .camera-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--good);
        display: inline-block;
      }
      .pip-stage {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 0;
      }
      .status-indicator {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--good);
        flex-shrink: 0;
        transition: background 0.3s ease;
      }
      .status-message {
        font-size: 14px;
        font-weight: 500;
        line-height: 1.35;
        color: var(--text-pip);
      }
      .pip-actions {
        display: flex;
        gap: 8px;
      }
      .btn-pip {
        flex: 1;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 500;
        border: 1px solid var(--border-pip);
        background: #FFFFFF;
        color: var(--text-pip);
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .btn-pip:hover {
        background: #F2EFE9;
      }
      .btn-pip.btn-stop {
        border-color: rgba(185, 28, 28, 0.3);
        color: var(--alert);
      }
      .btn-pip.btn-stop:hover {
        background: rgba(185, 28, 28, 0.06);
      }
    `;
    doc.head.appendChild(style);
  }

  renderDocumentPipHtml(doc) {
    doc.body.innerHTML = `
      <div class="pip-header">
        <div class="camera-badge" id="pip-camera-badge">
          <span class="camera-dot"></span>
          <span>Camera on</span>
        </div>
      </div>
      <div class="pip-stage">
        <span class="status-indicator" id="pip-status-dot"></span>
        <p class="status-message" id="pip-status-text">You seem calm and focused</p>
      </div>
      <div class="pip-actions">
        <button type="button" class="btn-pip" id="pip-action-pause">Pause</button>
        <button type="button" class="btn-pip btn-stop" id="pip-action-stop">Stop</button>
      </div>
    `;

    const btnPause = doc.getElementById('pip-action-pause');
    if (btnPause) {
      btnPause.onclick = () => {
        if (this.onTogglePause) this.onTogglePause();
      };
    }

    const btnStop = doc.getElementById('pip-action-stop');
    if (btnStop) {
      btnStop.onclick = () => {
        if (this.onStop) this.onStop();
      };
    }
  }

  /**
   * Update visual elements in Document PiP or Fallback Widget
   */
  update({ message, state, isPaused, cameraActive }) {
    this.currentState = {
      message: message || this.currentState.message,
      state: state || this.currentState.state,
      isPaused: isPaused !== undefined ? isPaused : this.currentState.isPaused,
      cameraActive: cameraActive !== undefined ? cameraActive : this.currentState.cameraActive
    };

    let color = '#2F6B4F'; // calm / good
    if (this.currentState.state === 'tired') {
      color = '#B91C1C';
    } else if (this.currentState.state === 'busy') {
      color = '#D97706';
    } else if (this.currentState.state === 'low') {
      color = '#6B5444';
    }

    // 1. Update Document Picture-in-Picture window
    if (this.pipWindow && this.pipWindow.document) {
      const doc = this.pipWindow.document;
      const dot = doc.getElementById('pip-status-dot');
      if (dot) dot.style.background = color;

      const text = doc.getElementById('pip-status-text');
      if (text) text.textContent = this.currentState.message;

      const pauseBtn = doc.getElementById('pip-action-pause');
      if (pauseBtn) pauseBtn.textContent = this.currentState.isPaused ? 'Resume' : 'Pause';

      const camBadge = doc.getElementById('pip-camera-badge');
      if (camBadge) camBadge.style.opacity = this.currentState.cameraActive ? '1' : '0.4';
    }

    // 2. Update Fallback floating widget
    if (this.fallbackWidget) {
      const dot = this.fallbackWidget.querySelector('#pip-widget-dot');
      if (dot) dot.style.background = color;

      const msg = this.fallbackWidget.querySelector('#pip-widget-msg');
      if (msg) msg.textContent = this.currentState.message;

      const pauseBtn = this.fallbackWidget.querySelector('#pip-widget-pause');
      if (pauseBtn) pauseBtn.textContent = this.currentState.isPaused ? 'Resume' : 'Pause';
    }
  }
}
