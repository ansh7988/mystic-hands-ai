import {
  FilesetResolver,
  HandLandmarker
} from '@mediapipe/tasks-vision';

import { drawMagicEffect } from './magicEngine.js';
import { createTelekinesisEngine } from './telekinesis.js';
import { createGestureTracker } from './gestureEngine.js';

// ==========================================
// HAND CONNECTIONS
// ==========================================

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];

// ==========================================
// MAIN HAND TRACKING FUNCTION
//
// onDetection(hands, handedness, delegate, gestureFrame)
//   - the first three arguments are unchanged
//   - gestureFrame is new (Milestone 2): per-hand state machine output
//
// options.onGestureEvent(event) receives CHARGE_START, CHARGE_CANCEL,
// RELEASE, GRAB_START and GRAB_END events.
// ==========================================

export async function startHandTracking(
  video,
  canvas,
  onDetection,
  options = {}
) {

  const ctx = canvas.getContext('2d');

  // ========================================
  // MEDIAPIPE VISION INITIALIZATION
  // ========================================

  // NOTE: pin this URL to your installed @mediapipe/tasks-vision version
  // once package.json lists it (Milestone 8).
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
  );

  // ========================================
  // GPU FIRST - CPU FALLBACK
  // ========================================

  let handLandmarker;
  let activeDelegate = 'GPU';

  const landmarkerOptions = {
    baseOptions: {
      modelAssetPath: '/models/hand_landmarker.task',
      delegate: 'GPU'
    },

    runningMode: 'VIDEO',
    numHands: 2,

    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  };

  try {

    console.log('Initializing MediaPipe GPU...');

    handLandmarker = await HandLandmarker.createFromOptions(
      vision,
      landmarkerOptions
    );

    activeDelegate = 'GPU';

    console.log('MediaPipe GPU delegate initialized (not yet verified by measurement).');

  } catch (gpuError) {

    console.warn(
      'GPU initialization failed. Switching to CPU...',
      gpuError
    );

    handLandmarker = await HandLandmarker.createFromOptions(
      vision,
      {
        ...landmarkerOptions,

        baseOptions: {
          ...landmarkerOptions.baseOptions,
          delegate: 'CPU'
        }
      }
    );

    activeDelegate = 'CPU';

    console.log('MediaPipe CPU fallback initialized.');
  }

  // ========================================
  // CANVAS CONFIGURATION
  // ========================================

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    zIndex: '3',
    pointerEvents: 'none'
  });

  // ========================================
  // INITIALIZE 3D TELEKINESIS ENGINE
  // (close the landmarker if this fails so nothing leaks)
  // ========================================

  let telekinesis;

  try {

    telekinesis = createTelekinesisEngine(
      canvas.parentElement,
      video.videoWidth,
      video.videoHeight
    );

  } catch (error) {

    handLandmarker.close();
    throw error;
  }

  // ========================================
  // GESTURE STATE MACHINE (Milestone 2)
  // ========================================

  const aspect = video.videoWidth / video.videoHeight;
  const gestureTracker = createGestureTracker();
  const onGestureEvent = options.onGestureEvent || null;

  // ========================================
  // TRACKING VARIABLES
  // ========================================

  let running = true;
  let animationId;
  let lastVideoTime = -1;
  let reportedDetectError = false;

  // ========================================
  // DRAW HAND LANDMARKS
  // ========================================

  function drawLandmarks(landmarks) {

    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffad42';
    ctx.shadowColor = '#ff7800';
    ctx.shadowBlur = 16;

    // Draw connections
    for (const [start, end] of HAND_CONNECTIONS) {

      const a = landmarks[start];
      const b = landmarks[end];

      ctx.beginPath();

      ctx.moveTo(
        a.x * canvas.width,
        a.y * canvas.height
      );

      ctx.lineTo(
        b.x * canvas.width,
        b.y * canvas.height
      );

      ctx.stroke();
    }

    // Draw landmark points
    for (const point of landmarks) {

      ctx.beginPath();

      ctx.arc(
        point.x * canvas.width,
        point.y * canvas.height,
        6,
        0,
        Math.PI * 2
      );

      ctx.fillStyle = '#fff2c7';
      ctx.shadowColor = '#ff8c00';
      ctx.shadowBlur = 20;

      ctx.fill();
    }

    ctx.shadowBlur = 0;
  }

  // ========================================
  // DETECTION LOOP
  // ========================================

  function detectFrame() {

    if (!running) return;

    if (
      video.readyState >= 2 &&
      video.currentTime !== lastVideoTime
    ) {

      lastVideoTime = video.currentTime;

      const currentTime = performance.now();

      let results = null;

      // MediaPipe inference (a thrown error must not kill the loop)
      try {

        results = handLandmarker.detectForVideo(
          video,
          currentTime
        );

      } catch (error) {

        if (!reportedDetectError) {
          console.error('Hand detection error:', error);
          reportedDetectError = true;
        }
      }

      if (results) {

        ctx.clearRect(
          0,
          0,
          canvas.width,
          canvas.height
        );

        const hands = results.landmarks || [];
        const worldHands = results.worldLandmarks || [];
        const handedness = results.handedness || [];

        // ==================================
        // ORIGINAL HAND TRACKING
        // ==================================

        for (const landmarks of hands) {
          drawLandmarks(landmarks);
        }

        // ==================================
        // ORIGINAL MAGIC ENGINE
        // DO NOT MODIFY
        // ==================================

        drawMagicEffect(
          ctx,
          hands,
          canvas.width,
          canvas.height,
          currentTime
        );

        // ==================================
        // GESTURE STATE MACHINE
        // (runs every frame, also with zero hands,
        //  so lost-hand and merge timers advance)
        // ==================================

        const gestureFrame = gestureTracker.update(
          hands,
          worldHands,
          handedness,
          currentTime,
          aspect
        );

        if (onGestureEvent) {
          for (const event of gestureFrame.events) {
            onGestureEvent(event);
          }
        }

        // ==================================
        // 3D TELEKINESIS ENGINE
        // (driven by the gesture state machine)
        // ==================================

        telekinesis.update(
          hands,
          currentTime,
          gestureFrame
        );

        // ==================================
        // SEND DETECTION INFORMATION
        // ==================================

        onDetection(
          hands,
          handedness,
          activeDelegate,
          gestureFrame
        );
      }
    }

    animationId = requestAnimationFrame(detectFrame);
  }

  // Start detection
  detectFrame();

  console.log(
    `MYSTIC HANDS AI started (MediaPipe delegate requested: ${activeDelegate})`
  );

  // ========================================
  // CLEANUP FUNCTION
  // ========================================

  return function stopTracking() {

    running = false;

    cancelAnimationFrame(animationId);

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    gestureTracker.reset();

    // Dispose 3D engine
    telekinesis.dispose();

    // Close MediaPipe
    handLandmarker.close();

    console.log(
      'MYSTIC HANDS AI tracking stopped.'
    );
  };
}