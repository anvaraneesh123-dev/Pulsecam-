# PulseCam — Contactless Arterial & Ocular Wellness Telemetry

> **"PulseCam is a wellness assistant, not a medical diagnostic tool."**  
> **"Your video never leaves your device."**

PulseCam is an editorial, privacy-first wellness application that estimates cardiovascular pulse waveforms and ocular fatigue cues directly from your computer’s camera aperture. All computer vision and physiological signal processing executes strictly inside your local browser’s volatile memory on an offscreen Web Worker—zero video frames, images, or biometric telemetry are ever stored or transmitted across any network.

---

## 1. Pipeline Overview

PulseCam features an off-thread, hardware-accelerated processing pipeline designed for high performance and low CPU overhead:

1. **Optical Capture**: WebRTC `getUserMedia` captures 640×480 video at 30 fps. In supported Chromium browsers (Chrome, Edge), the raw video stream is piped via `MediaStreamTrackProcessor` directly into a dedicated Web Worker.
2. **Dedicated Web Worker**:
   - **Face & Eye Landmarking**: MediaPipe FaceLandmarker tracks 468+ facial landmarks entirely in WebAssembly and WebGL.
   - **Ocular Kinematics**: Computes bi-ocular Eye Aspect Ratio (EAR), blink duration (2–6 frame dips), blink rate (/min), and rolling PERCLOS.
   - **Fatigue Cues**: Monitors yawns (sustained mouth opening), head nod/droop pitch, gaze drift/monitor diversion yaw, and brow furrow.
   - **Remote Photoplethysmography (rPPG)**: Employs Plane-Orthogonal-to-Skin (POS) chrominance projection across forehead and cheek capillary beds, detrends baseline drift, filters through a 2nd-order bandpass (0.7–3.0 Hz), and derives BPM and HRV RMSSD via FFT spectral analysis.
3. **Display Rendering Loop**: The main thread runs a single `requestAnimationFrame` loop with delta-time exponential smoothing, gliding telemetry numbers smoothly to match 60 Hz, 120 Hz, or 144 Hz display refresh rates.

---

## 2. The Two Operating Modes

### Mode A: Background Watch Mode (Continuous)
- **Zero Heart-Rate Analysis**: rPPG and cardiovascular pulse extraction are **never** executed during Background Watch, protecting battery life and eliminating camera auto-exposure sensitivity during normal work.
- **Ocular & Head Cues Only**:
  - Blink frequency and eye-closure duration relative to the user's calibrated baseline.
  - Yawn detection (sustained mouth opening > 1.5 seconds).
  - Head droop/nodding pitch slump.
  - Gaze drift and frequent looking away from the monitor.
  - Brow furrow as a mild concentration effort cue.
- **Duty Cycle**: Operates on a 30-second observation window every 3 minutes. Runs at 15+ fps during the active 30s window to prevent missing blinks, and enters dormant sleep between windows to minimize CPU usage.
- **Noise Rejection**: If no face is detected or if the user is looking at another display (|yaw| > 26° for > 35% of the window), the window is safely discarded and **never** counted toward fatigue.
- **State Output & Alert Gating**: Evaluates the window as **Fresh**, **Getting tired**, or **Tired** with a confidence score. Alerts fire only when confidence is high and the tired state persists across consecutive observation windows.

### Mode B: Quick Check-in Mode (60 Seconds)
- **Screen-Lit Key Light**: The screen fills with uniform neutral white (`#FFFFFF`) in fullscreen, acting as a soft photographic key light for the face.
- **Hidden Video**: Camera feed is completely hidden; users see only a minimal, calm oval alignment guide that transitions from muted brown to forest green when centered and still.
- **Dedicated Heart-Rate Analysis**: rPPG pulse extraction runs **only** during Quick Check-in and guided baseline calibration.
- **Camera Lock & Wake Lock**: Requests Screen Wake Lock to prevent dimming, and locks exposure, white balance, and focus to manual via `applyConstraints` (where supported by webcam hardware) to stop auto-exposure from neutralizing the screen light.

---

## 3. Combined Fatigue Engine

- **Continuous Assessment**: Background Watch provides the ongoing, continuous fatigue state.
- **Decaying Heart-Rate Context**: Heart-rate and pulse insights from the most recent Quick Check-in serve as supporting context and fade smoothly over a 60-minute window.
- **Confidence Adjustment**: When no recent Quick Check-in is available, the engine functions reliably on ocular and posture cues alone, capping confidence at 82%.
- **Single Cohesive Interface**: The main dashboard displays one large plain-language headline, one short sentence, one suggested action, and a soft day rhythm bar. All raw numbers, z-scores, and technical metrics remain tucked away in the optional "Details" panel.

---

## 4. Picture-in-Picture Mini Window

PulseCam includes a dedicated mini window that stays visible while you work in other applications:
- **Document Picture-in-Picture**: Opens a compact (340×180) always-on-top window using Chrome/Edge `documentPictureInPicture`.
- **In-Page Floating Widget Fallback**: If Document PiP is unavailable, falls back gracefully to a non-intrusive floating in-page status widget.
- **Minimal, Focused Controls**: Shows only a visible "Camera on" badge, status color dot, short plain message, Pause button, and Stop button.

---

## 5. Important Desktop Wrapper Note

> **Note on Browser Background Execution:**  
> Web browsers aggressively throttle background tabs, timers, and MediaStream pipelines when windows are minimized or obscured to conserve battery. While PulseCam uses `MediaStreamTrackProcessor` and Web Workers to maximize background survival on Chrome and Edge, fully reliable 24/7 background monitoring across all operating system sleep states may require packaging PulseCam in a desktop wrapper such as **Electron** or **Tauri** with `backgroundThrottling: false` configured on the main BrowserWindow's `webPreferences`.

---

## 6. System Limitations

1. **Skin Tone & Melanin**: Melanin absorbs light across the visible spectrum, reducing the relative amplitude of the green-channel pulsatile signal. PulseCam normalizes color channels with Plane-Orthogonal-to-Skin (POS) projection, but darker skin tones benefit significantly from higher screen brightness during Quick Check-in.
2. **Eyeglasses & Reflections**: Glare on lens coatings can cause landmark jitter. PulseCam evaluates bilateral eye symmetry and temporal jitter to penalize confidence and suppress false blink counts when glasses reflect light.
3. **Ambient Lighting**: Harsh backlights or dark rooms introduce photon noise. PulseCam provides a 3-second pre-flight lighting check and soft screen illumination to assist.
4. **Browser API Compatibility**: Native `MediaStreamTrackProcessor` and `documentPictureInPicture` require modern Chromium (Chrome 94+, Edge 94+). In other browsers, PulseCam displays a plain compatibility notice and maintains complete foreground functionality.

---

## 7. Privacy & Data Custody Model

- **100% Volatile Memory**: Video frames exist only in memory buffers for milliseconds while being analyzed, and are instantly discarded.
- **Strict Network Egress Block**: Zero video, audio, or biometric data is ever transmitted across the internet.
- **Hardware Release**: When monitoring is paused or stopped, webcam stream tracks are immediately called with `track.stop()`, hardware lights shut off, and `video.srcObject` is cleared.
- **Visible Camera Indicators**: A prominent "Camera on" indicator remains visible on the dashboard, during Quick Check-in, and inside the PiP mini window whenever the camera is active.
- **"Delete My Data"**: A dedicated button in Settings allows users to instantly wipe all locally saved baselines, session logs, and preferences from browser LocalStorage.

---

## 8. Development & Testing

### Running the App
```bash
npm run dev
```

### Running Unit Tests
Unit tests validate the rPPG signal recovery (synthetic clean and noisy sine waves) and the blink detector (synthetic eye-openness sequences, 2–6 frame dips, flutter rejection, and jitter penalties):
```bash
npm test
```

### Video File Replay & Demo Modes
PulseCam includes two built-in test modes accessible directly from the authorization screen:
- **Preview in Demo Mode**: Generates a synthetic multi-spectral pulsatile avatar inside an offscreen canvas.
- **Replay Video File**: Allows users and testers to load any local MP4 or WebM video file to replay through the complete optical and ocular pipeline without requiring a physical camera.

---

## 9. Regulatory Disclaimer

PulseCam is intended solely for personal wellness, posture awareness, and screen pacing. It does not provide medical diagnoses, clinical monitoring, or treatment advice. Always consult a qualified medical professional for health concerns.
