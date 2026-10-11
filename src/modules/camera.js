/**
 * PulseCam - Camera Module
 * Purely local webcam streaming. Video frames are processed in-memory in real time
 * and are NEVER stored, saved, or transmitted across any network.
 */

export class CameraManager {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
    this.isRunning = false;
    this.width = 640;
    this.height = 480;

    // Hidden canvas for in-memory pixel processing (never attached to DOM, never saved)
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    // Stream state change callback
    this.onStateChange = null;
  }

  /**
   * Request webcam access via getUserMedia (640x480, requesting 30fps)
   * Video frames are processed strictly in local RAM on a hidden canvas and are NEVER saved or transmitted.
   */
  async start() {
    if (this.isRunning && this.stream) {
      return true;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Webcam mediaDevices API is not supported in this browser environment.');
    }

    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
          facingMode: 'user'
        },
        audio: false
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;

      // Wait until metadata has loaded and video plays
      await new Promise((resolve, reject) => {
        this.video.onloadedmetadata = () => {
          this.video.play()
            .then(() => {
              this.width = this.video.videoWidth || 640;
              this.height = this.video.videoHeight || 480;
              this.canvas.width = this.width;
              this.canvas.height = this.height;
              this.isRunning = true;
              if (this.onStateChange) this.onStateChange(true);
              resolve();
            })
            .catch(reject);
        };
        this.video.onerror = (err) => reject(err);
      });

      return true;
    } catch (err) {
      this.isRunning = false;
      this.stop();
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Camera permission was denied. Please allow camera access in your browser settings.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        throw new Error('No webcam found on this device. Please connect a camera.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        throw new Error('Camera is currently in use by another application.');
      } else {
        throw new Error(`Unable to initialize camera: ${err.message || err.name}`);
      }
    }
  }

  /**
   * Start a synthetic demo camera stream for testing without physical webcam hardware
   */
  startDemoMode() {
    this.stop();
    this.isDemo = true;
    this.width = 640;
    this.height = 480;

    const demoCanvas = document.createElement('canvas');
    demoCanvas.width = this.width;
    demoCanvas.height = this.height;
    const dctx = demoCanvas.getContext('2d');

    let t = 0;
    let blinkTimer = 0;

    const drawDemo = () => {
      if (!this.isRunning || !this.isDemo) return;
      t += 0.033; // ~30 fps
      blinkTimer += 0.033;

      // Dark background
      dctx.fillStyle = '#0f172a';
      dctx.fillRect(0, 0, this.width, this.height);

      // Simulating face skin tone with realistic multi-spectral hemodynamic pulse (72 BPM = 1.2 Hz)
      const pulse = Math.sin(2 * Math.PI * 1.2 * t);
      // Hemoglobin absorption peak in Green and Blue with subtle Red variation
      const greenMod = Math.floor(178 - pulse * 4.5);
      const redMod = Math.floor(224 - pulse * 1.2);
      const blueMod = Math.floor(156 - pulse * 2.0);

      // Head shape
      dctx.fillStyle = `rgb(${redMod}, ${greenMod}, ${blueMod})`;
      dctx.beginPath();
      dctx.ellipse(320, 240, 110, 145, 0, 0, Math.PI * 2);
      dctx.fill();

      // Forehead highlight
      dctx.fillStyle = `rgb(${redMod + 4}, ${greenMod + 2}, ${blueMod + 2})`;
      dctx.beginPath();
      dctx.ellipse(320, 165, 60, 32, 0, 0, Math.PI * 2);
      dctx.fill();

      // Cheeks highlights
      dctx.fillStyle = `rgb(${redMod + 3}, ${greenMod + 1}, ${blueMod + 1})`;
      dctx.beginPath();
      dctx.ellipse(250, 260, 32, 28, 0, 0, Math.PI * 2);
      dctx.ellipse(390, 260, 32, 28, 0, 0, Math.PI * 2);
      dctx.fill();

      // Eyes (with periodic blink every ~3.5s)
      const isBlinking = blinkTimer % 3.5 < 0.18;
      dctx.fillStyle = '#1e293b';
      if (isBlinking) {
        // Closed eye slit
        dctx.lineWidth = 3;
        dctx.strokeStyle = '#1e293b';
        dctx.beginPath();
        dctx.moveTo(270, 220);
        dctx.lineTo(295, 220);
        dctx.moveTo(345, 220);
        dctx.lineTo(370, 220);
        dctx.stroke();
      } else {
        // Open eyes
        dctx.beginPath();
        dctx.ellipse(282, 220, 12, 7, 0, 0, Math.PI * 2);
        dctx.ellipse(358, 220, 12, 7, 0, 0, Math.PI * 2);
        dctx.fill();
      }

      // Mouth
      dctx.strokeStyle = '#991b1b';
      dctx.lineWidth = 3;
      dctx.beginPath();
      dctx.arc(320, 305, 24, 0.1 * Math.PI, 0.9 * Math.PI);
      dctx.stroke();

      if (document.hidden) {
        setTimeout(drawDemo, 33);
      } else {
        requestAnimationFrame(drawDemo);
      }
    };

    try {
      this.stream = demoCanvas.captureStream(30);
      this.video.srcObject = this.stream;
      this.isRunning = true;
      drawDemo();

      return new Promise((resolve) => {
        this.video.onloadedmetadata = () => {
          this.video.play().then(() => {
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            resolve(true);
          });
        };
      });
    } catch (e) {
      console.warn('captureStream not available in demo:', e);
      this.isRunning = true;
      return Promise.resolve(true);
    }
  }

  /**
   * Get active MediaStreamTrack for MediaStreamTrackProcessor
   */
  getVideoTrack() {
    if (this.stream) {
      const tracks = this.stream.getVideoTracks();
      if (tracks && tracks.length > 0) return tracks[0];
    }
    return null;
  }

  /**
   * Capture current frame to internal offscreen canvas context
   */
  captureFrame() {
    if (!this.isRunning || (this.video && this.video.readyState < 2)) return null;
    this.ctx.drawImage(this.video, 0, 0, this.width, this.height);
    return this.ctx;
  }

  /**
   * Attempt to lock camera exposure, white balance, and focus to manual mode
   * to stop camera auto-exposure from cancelling added screen lighting.
   * Falls back gracefully if unsupported.
   */
  async lockCameraConstraints() {
    if (!this.stream) return false;
    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack || typeof videoTrack.applyConstraints !== 'function') return false;

    try {
      const capabilities = typeof videoTrack.getCapabilities === 'function' ? videoTrack.getCapabilities() : {};
      const advanced = [];

      if (capabilities.exposureMode && capabilities.exposureMode.includes('manual')) {
        advanced.push({ exposureMode: 'manual' });
      }
      if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.includes('manual')) {
        advanced.push({ whiteBalanceMode: 'manual' });
      }
      if (capabilities.focusMode && capabilities.focusMode.includes('manual')) {
        advanced.push({ focusMode: 'manual' });
      }

      if (advanced.length > 0) {
        await videoTrack.applyConstraints({ advanced });
        return true;
      }
    } catch (err) {
      console.warn('applyConstraints manual lock not supported or failed:', err);
    }
    return false;
  }

  /**
   * Unlock camera constraints back to continuous/auto if supported
   */
  async unlockCameraConstraints() {
    if (!this.stream) return false;
    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack || typeof videoTrack.applyConstraints !== 'function') return false;

    try {
      const capabilities = typeof videoTrack.getCapabilities === 'function' ? videoTrack.getCapabilities() : {};
      const advanced = [];

      if (capabilities.exposureMode && capabilities.exposureMode.includes('continuous')) {
        advanced.push({ exposureMode: 'continuous' });
      }
      if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.includes('continuous')) {
        advanced.push({ whiteBalanceMode: 'continuous' });
      }
      if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
      }

      if (advanced.length > 0) {
        await videoTrack.applyConstraints({ advanced });
        return true;
      }
    } catch (err) {
      console.warn('unlockCameraConstraints failed:', err);
    }
    return false;
  }

  /**
   * Start streaming from a user-supplied video file for testing and validation
   * @param {File} file
   */
  async startVideoFile(file) {
    this.stop();
    this.isVideoFile = true;
    this.video.srcObject = null;
    this.video.src = URL.createObjectURL(file);
    this.video.loop = true;
    this.video.muted = true;
    this.video.playsInline = true;

    await new Promise((resolve, reject) => {
      this.video.onloadedmetadata = () => {
        this.video.play()
          .then(() => {
            this.width = this.video.videoWidth || 640;
            this.height = this.video.videoHeight || 480;
            this.canvas.width = this.width;
            this.canvas.height = this.height;
            this.isRunning = true;
            try {
              if (typeof this.video.captureStream === 'function') {
                this.stream = this.video.captureStream(30);
              }
            } catch (_) {}
            if (this.onStateChange) this.onStateChange(true);
            resolve(true);
          })
          .catch(reject);
      };
      this.video.onerror = (e) => reject(new Error('Failed to play video file: ' + (e?.message || 'unknown error')));
    });
    return true;
  }

  /**
   * Stop video stream tracks and release webcam hardware
   */
  stop() {
    this.isDemo = false;
    if (this.isVideoFile && this.video && this.video.src) {
      try {
        URL.revokeObjectURL(this.video.src);
      } catch (_) {}
      this.video.src = '';
    }
    this.isVideoFile = false;

    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.stop();
      });
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
    }
    this.isRunning = false;
    if (this.onStateChange) this.onStateChange(false);
  }
}

