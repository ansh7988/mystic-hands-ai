import {
  FilesetResolver,
  HandLandmarker,
  ImageSegmenter
} from '@mediapipe/tasks-vision';

import { drawMagicEffect } from './magicEngine.js';
import { createTelekinesisEngine } from './telekinesis.js';
import { createGestureTracker } from './gestureEngine.js';
import { createCircleDetector } from './circleDetector.js';
import { createSnapDetector } from './snapDetector.js';

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
// PERSON SEGMENTER (for the snap: you turn to dust)
// Needs public/models/selfie_segmenter.tflite. Without it the snap still
// destroys the floating objects, but you do not disappear.
// ==========================================

async function createPersonSegmenter(vision) {

  const make = (delegate) => ImageSegmenter.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: '/models/selfie_segmenter.tflite',
      delegate
    },
    runningMode: 'VIDEO',
    outputConfidenceMasks: true,
    outputCategoryMask: false
  });

  try {
    const segmenter = await make('GPU');
    console.log('Person segmenter ready (GPU requested).');
    return segmenter;
  } catch (gpuError) {
    try {
      const segmenter = await make('CPU');
      console.log('Person segmenter ready (CPU).');
      return segmenter;
    } catch (error) {
      console.warn(
        'Person segmenter unavailable - the snap will not hide you. ' +
        'Put selfie_segmenter.tflite into public/models/. ',
        error
      );
      return null;
    }
  }
}

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
  // PERSON SEGMENTER
  // ========================================

  const segmenter = await createPersonSegmenter(vision);

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
      video.videoHeight,
      video
    );

    telekinesis.attachSegmenter(segmenter);

  } catch (error) {

    handLandmarker.close();
    if (segmenter) segmenter.close();
    throw error;
  }

  // ========================================
  // GESTURE STATE MACHINE (Milestone 2)
  // ========================================

  const aspect = video.videoWidth / video.videoHeight;
  const gestureTracker = createGestureTracker();
  const circleDetector = createCircleDetector();
  const snapDetector = createSnapDetector();
  const onGestureEvent = options.onGestureEvent || null;
  const isInputBlocked = options.isInputBlocked || (() => false);
  const EMPTY_FRAME = { hands: [], events: [], circles: null };

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

        // ==================================
        // SLING-RING CIRCLE (two fingers)
        // ==================================

        const circleFrame = circleDetector.update(
          gestureFrame.hands,
          currentTime,
          aspect
        );

        gestureFrame.events.push(...circleFrame.events);
        gestureFrame.circles = circleFrame;

        const busy = ['CHARGING', 'RELEASE', 'GRAB'];

        if (!busy.includes(gestureFrame.ui.gesture)) {

          if (circleFrame.portalRecent) {
            gestureFrame.ui.gesture = 'PORTAL';
          } else if (circleFrame.drawing) {
            gestureFrame.ui.gesture = 'SPELL_DRAW';
            gestureFrame.ui.energy = circleFrame.progress;
          }
        }

        // While system-control mode owns the hands, the magic stays quiet
        const blocked = isInputBlocked();

        // ==================================
        // FINGER SNAP (thumb + middle finger)
        // ==================================

        if (!blocked) {

          const snapFrame = snapDetector.update(
            gestureFrame.hands,
            currentTime
          );

          for (const snapEvent of snapFrame.events) {
            snapEvent.personEffect = !!segmenter;
            gestureFrame.events.push(snapEvent);
          }

          if (snapFrame.recent) {
            gestureFrame.ui.gesture = 'SNAP';
          }
        }

        if (onGestureEvent && !blocked) {
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
          blocked ? EMPTY_FRAME : gestureFrame
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

  function stopTracking() {

    running = false;

    cancelAnimationFrame(animationId);

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    gestureTracker.reset();
    circleDetector.reset();
    snapDetector.reset();

    // Dispose 3D engine
    telekinesis.dispose();

    // Close MediaPipe
    handLandmarker.close();

    if (segmenter) segmenter.close();

    console.log(
      'MYSTIC HANDS AI tracking stopped.'
    );
  }

  // main.js calls this when system-control mode switches on
  stopTracking.releaseInteractions = () => telekinesis.releaseAll();

  return stopTracking;
}