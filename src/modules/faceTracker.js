/**
 * PulseCam - Face Tracker Module
 * Uses MediaPipe Face Landmarker for 468+ point 3D landmarking.
 * Identifies skin Regions of Interest (ROI) for rPPG and eye/head pose for fatigue tracking.
 */

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
export const FOREHEAD_INDICES = [10, 67, 109, 108, 151, 9, 337, 338, 297];
export const LEFT_CHEEK_INDICES = [346, 347, 330, 280, 425, 266, 352, 411];
export const RIGHT_CHEEK_INDICES = [117, 118, 101, 50, 205, 36, 123, 187];

/**
 * Extract Forehead, Left Cheek, and Right Cheek ROIs from 468 landmarks
 * @param {Array} landmarks - MediaPipe 468 landmarks
 * @param {number} width - Video frame width
 * @param {number} height - Video frame height
 */
export function extractROIs(landmarks, width, height) {
  if (!landmarks || landmarks.length < 468) return null;

  // 1. Forehead ROI
  const foreheadPoints = FOREHEAD_INDICES.map((i) => landmarks[i]).filter(Boolean);
  const fMinX = Math.min(...foreheadPoints.map((p) => p.x));
  const fMaxX = Math.max(...foreheadPoints.map((p) => p.x));
  const fMinY = Math.min(...foreheadPoints.map((p) => p.y));
  const fMaxY = Math.max(...foreheadPoints.map((p) => p.y));

  const foreheadRoi = {
    name: 'Forehead',
    x: Math.max(0, (fMinX + (fMaxX - fMinX) * 0.1) * width),
    y: Math.max(0, (fMinY - (fMaxY - fMinY) * 0.35) * height),
    width: Math.max(15, (fMaxX - fMinX) * 0.8 * width),
    height: Math.max(15, (fMaxY - fMinY) * 0.85 * height)
  };

  // 2. Left Cheek ROI (Subject's anatomical left, camera right)
  const leftPoints = LEFT_CHEEK_INDICES.map((i) => landmarks[i]).filter(Boolean);
  const lMinX = Math.min(...leftPoints.map((p) => p.x));
  const lMaxX = Math.max(...leftPoints.map((p) => p.x));
  const lMinY = Math.min(...leftPoints.map((p) => p.y));
  const lMaxY = Math.max(...leftPoints.map((p) => p.y));

  const leftCheekRoi = {
    name: 'Cheek (L)',
    x: Math.max(0, (lMinX + (lMaxX - lMinX) * 0.1) * width),
    y: Math.max(0, (lMinY + (lMaxY - lMinY) * 0.1) * height),
    width: Math.max(15, (lMaxX - lMinX) * 0.8 * width),
    height: Math.max(15, (lMaxY - lMinY) * 0.8 * height)
  };

  // 3. Right Cheek ROI (Subject's anatomical right, camera left)
  const rightPoints = RIGHT_CHEEK_INDICES.map((i) => landmarks[i]).filter(Boolean);
  const rMinX = Math.min(...rightPoints.map((p) => p.x));
  const rMaxX = Math.max(...rightPoints.map((p) => p.x));
  const rMinY = Math.min(...rightPoints.map((p) => p.y));
  const rMaxY = Math.max(...rightPoints.map((p) => p.y));

  const rightCheekRoi = {
    name: 'Cheek (R)',
    x: Math.max(0, (rMinX + (rMaxX - rMinX) * 0.1) * width),
    y: Math.max(0, (rMinY + (rMaxY - rMinY) * 0.1) * height),
    width: Math.max(15, (rMaxX - rMinX) * 0.8 * width),
    height: Math.max(15, (rMaxY - rMinY) * 0.8 * height)
  };

  // 4. Background Reference ROI (Patch strictly outside face bounding box)
  const faceMinX = Math.min(fMinX, lMinX, rMinX) * width;
  const faceMaxX = Math.max(fMaxX, lMaxX, rMaxX) * width;
  const faceMinY = Math.min(fMinY, lMinY, rMinY) * height;
  const faceMaxY = Math.max(fMaxY, lMaxY, rMaxY) * height;
  const bgRoi = extractBgRoi(
    { x: faceMinX, y: faceMinY, width: faceMaxX - faceMinX, height: faceMaxY - faceMinY },
    width,
    height
  );

  return {
    forehead: foreheadRoi,
    leftCheek: leftCheekRoi,
    rightCheek: rightCheekRoi,
    bgRoi
  };
}

/**
 * Extract background reference ROI strictly outside the face region
 * @param {Object} [faceBox] - { x, y, width, height }
 * @param {number} [width=640] - Frame width
 * @param {number} [height=480] - Frame height
 * @returns {{ name: string, x: number, y: number, width: number, height: number }}
 */
export function extractBgRoi(faceBox, width = 640, height = 480) {
  const patchSize = Math.max(24, Math.min(56, Math.floor(Math.min(width, height) * 0.11)));
  const margin = 14;

  // Prefer top-left if face is not encroaching on it
  if (!faceBox || faceBox.x > (margin + patchSize + 10)) {
    return {
      name: 'BG Ref (L)',
      x: margin,
      y: margin,
      width: patchSize,
      height: patchSize
    };
  }

  // Otherwise pick top-right if face is away from the right edge
  if (faceBox && (faceBox.x + faceBox.width) < (width - margin - patchSize - 10)) {
    return {
      name: 'BG Ref (R)',
      x: width - margin - patchSize,
      y: margin,
      width: patchSize,
      height: patchSize
    };
  }

  // Fallback: bottom-left corner
  return {
    name: 'BG Ref (BL)',
    x: margin,
    y: Math.max(0, height - margin - patchSize),
    width: patchSize,
    height: patchSize
  };
}

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.isLoaded = false;
    this.lastVideoTime = -1;

    // Standard landmark indices
    this.EYE_INDICES_LEFT = [33, 160, 158, 133, 153, 144];
    this.EYE_INDICES_RIGHT = [362, 385, 387, 263, 373, 380];
    this.FOREHEAD_INDICES = FOREHEAD_INDICES;
    this.LEFT_CHEEK_INDICES = LEFT_CHEEK_INDICES;
    this.RIGHT_CHEEK_INDICES = RIGHT_CHEEK_INDICES;
    this.NOSE_TIP = 1;
    this.CHIN = 152;
    this.TEMPLE_LEFT = 234;
    this.TEMPLE_RIGHT = 454;
  }

  /**
   * Initialize MediaPipe Face Landmarker
   */
  async init(onProgress = null) {
    if (this.isLoaded && this.landmarker) return true;

    try {
      if (onProgress) onProgress('Loading vision AI runtime...');
      
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );

      if (onProgress) onProgress('Compiling neural landmarker model...');

      this.landmarker = await FaceLandmarker.createFromOptions(vision, {
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

      this.isLoaded = true;
      if (onProgress) onProgress('Vision model ready.');
      return true;
    } catch (err) {
      console.warn('GPU delegate failed or network slow, attempting CPU fallback...', err);
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        );
        this.landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'CPU'
          },
          runningMode: 'VIDEO',
          numFaces: 1
        });
        this.isLoaded = true;
        return true;
      } catch (fallbackErr) {
        console.error('Failed to load FaceLandmarker:', fallbackErr);
        throw new Error('Could not initialize FaceLandmarker model. Please check network connection.');
      }
    }
  }

  /**
   * Process a video frame and extract biometric facial landmarks
   */
  detect(videoElement, timestampMs) {
    if (!this.isLoaded || !this.landmarker || !videoElement) return null;

    if (videoElement.currentTime === this.lastVideoTime) {
      return null;
    }
    this.lastVideoTime = videoElement.currentTime;

    const width = videoElement.videoWidth || 640;
    const height = videoElement.videoHeight || 480;

    let results;
    try {
      results = this.landmarker.detectForVideo(videoElement, timestampMs);
    } catch (e) {
      console.warn('FaceLandmarker detect exception:', e);
      return null;
    }

    if (!results || !results.faceLandmarks || results.faceLandmarks.length === 0) {
      return { detected: false };
    }

    const landmarks = results.faceLandmarks[0];

    // Compute Face Bounding Box
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const faceBox = {
      x: minX * width,
      y: minY * height,
      width: (maxX - minX) * width,
      height: (maxY - minY) * height
    };

    // Extract all 3 ROIs: Forehead, Left Cheek, Right Cheek
    const rois = extractROIs(landmarks, width, height);
    const foreheadRoi = rois ? rois.forehead : null;

    // Head Pose Estimation (Yaw, Pitch, Roll)
    const nose = landmarks[this.NOSE_TIP];
    const leftTemple = landmarks[this.TEMPLE_LEFT];
    const rightTemple = landmarks[this.TEMPLE_RIGHT];
    const foreheadTop = landmarks[10];
    const chin = landmarks[this.CHIN];

    const distToLeft = Math.abs(nose.x - leftTemple.x);
    const distToRight = Math.abs(rightTemple.x - nose.x);
    const yaw = ((distToRight - distToLeft) / (distToLeft + distToRight || 1)) * 90;

    const midY = (foreheadTop.y + chin.y) / 2;
    const pitch = (nose.y - midY) * 90;

    const dX = rightTemple.x - leftTemple.x;
    const dY = rightTemple.y - leftTemple.y;
    const roll = Math.atan2(dY, dX) * (180 / Math.PI);

    return {
      detected: true,
      landmarks,
      faceBox,
      foreheadRoi,
      leftCheekRoi: rois ? rois.leftCheek : null,
      rightCheekRoi: rois ? rois.rightCheek : null,
      rois,
      headPose: { yaw, pitch, roll },
      blendshapes: results.faceBlendshapes ? results.faceBlendshapes[0] : null
    };
  }

  /**
   * Draw futuristic HUD augmented reality overlay on output canvas
   */
  drawHUD(canvasCtx, detection, options = { showMesh: true, showRoi: true, showDebugOverlay: false }) {
    if (!canvasCtx || !detection || !detection.detected) return;

    const ctx = canvasCtx;
    const { landmarks, faceBox, rois, foreheadRoi, leftCheekRoi, rightCheekRoi, motion } = detection;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const isNoisy = Boolean(motion && motion.isNoisy);

    ctx.save();

    // 1. Handcrafted Optical Framing Brackets around Face
    if (faceBox) {
      const bx = faceBox.x;
      const by = faceBox.y;
      const bw = faceBox.width;
      const bh = faceBox.height;
      const corner = Math.min(20, bw * 0.15);

      ctx.strokeStyle = isNoisy ? 'rgba(178, 58, 46, 0.9)' : 'rgba(241, 234, 223, 0.85)';
      ctx.lineWidth = 1;

      // Top-left corner
      ctx.beginPath();
      ctx.moveTo(bx, by + corner);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + corner, by);
      ctx.stroke();

      // Top-right corner
      ctx.beginPath();
      ctx.moveTo(bx + bw - corner, by);
      ctx.lineTo(bx + bw, by);
      ctx.lineTo(bx + bw, by + corner);
      ctx.stroke();

      // Bottom-left corner
      ctx.beginPath();
      ctx.moveTo(bx, by + bh - corner);
      ctx.lineTo(bx, by + bh);
      ctx.lineTo(bx + corner, by + bh);
      ctx.stroke();

      // Bottom-right corner
      ctx.beginPath();
      ctx.moveTo(bx + bw - corner, by + bh);
      ctx.lineTo(bx + bw, by + bh);
      ctx.lineTo(bx + bw, by + bh - corner);
      ctx.stroke();
    }

    // 2. Render ROIs: Background Reference, Forehead, Left Cheek, Right Cheek
    const shouldShowRois = Boolean(options.showRoi || options.showDebugOverlay);
    const targetRois = rois || {
      bgRoi: detection.bgRoi || (rois ? rois.bgRoi : null),
      forehead: foreheadRoi,
      leftCheek: leftCheekRoi,
      rightCheek: rightCheekRoi
    };

    if (shouldShowRois && targetRois) {
      const roiEntries = [
        { key: 'bgRoi', label: 'ROI 0: BG REF', color: 'rgba(217, 164, 65, 0.95)', data: targetRois.bgRoi },
        { key: 'forehead', label: 'ROI 1: FOREHEAD', color: isNoisy ? 'rgba(178, 58, 46, 0.9)' : 'rgba(155, 44, 44, 0.9)', data: targetRois.forehead },
        { key: 'leftCheek', label: 'ROI 2: CHEEK (L)', color: isNoisy ? 'rgba(178, 58, 46, 0.9)' : 'rgba(47, 107, 79, 0.9)', data: targetRois.leftCheek },
        { key: 'rightCheek', label: 'ROI 3: CHEEK (R)', color: isNoisy ? 'rgba(178, 58, 46, 0.9)' : 'rgba(47, 107, 79, 0.9)', data: targetRois.rightCheek }
      ];

      for (const entry of roiEntries) {
        const roi = entry.data;
        if (!roi || roi.width <= 0 || roi.height <= 0) continue;

        const rx = roi.x;
        const ry = roi.y;
        const rw = roi.width;
        const rh = roi.height;

        // Bounding outline
        ctx.strokeStyle = entry.color;
        ctx.lineWidth = 1;
        ctx.setLineDash(isNoisy ? [2, 2] : [3, 2]);

        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.stroke();
        ctx.setLineDash([]);

        // Small corner ticks
        const cLen = Math.min(6, rw * 0.2);
        ctx.beginPath();
        ctx.moveTo(rx, ry + cLen); ctx.lineTo(rx, ry); ctx.lineTo(rx + cLen, ry);
        ctx.moveTo(rx + rw - cLen, ry); ctx.lineTo(rx + rw, ry); ctx.lineTo(rx + rw, ry + cLen);
        ctx.moveTo(rx, ry + rh - cLen); ctx.lineTo(rx, ry + rh); ctx.lineTo(rx + cLen, ry + rh);
        ctx.moveTo(rx + rw - cLen, ry + rh); ctx.lineTo(rx + rw, ry + rh); ctx.lineTo(rx + rw, ry + rh - cLen);
        ctx.stroke();

        // Label rendered counter-scaled for mirrored canvas so it reads left-to-right correctly
        ctx.save();
        ctx.scale(-1, 1);
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillStyle = entry.color;
        // In mirrored space, X coordinate is inverted
        ctx.fillText(entry.label, -(rx + rw), ry - 3);
        ctx.restore();
      }
    }

    // 3. Subtle Facial Mesh Wireframe Points
    if (options.showMesh && landmarks) {
      ctx.fillStyle = isNoisy ? 'rgba(178, 58, 46, 0.35)' : 'rgba(241, 234, 223, 0.35)';
      const step = 5;
      for (let i = 0; i < landmarks.length; i += step) {
        const p = landmarks[i];
        ctx.fillRect(p.x * w - 0.5, p.y * h - 0.5, 1, 1);
      }

      // Eye pupil tracking indicators
      ctx.fillStyle = 'rgba(155, 44, 44, 0.75)';
      [...this.EYE_INDICES_LEFT, ...this.EYE_INDICES_RIGHT].forEach((idx) => {
        const p = landmarks[idx];
        if (p) {
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }

    ctx.restore();
  }
}
