import './style.css';

import { startHandTracking } from './handTracking.js';
import { createSystemBridge } from './systemBridge.js';
import { createSystemControl } from './systemControl.js';

import {
  getGestureName,
  getSpellName
} from './gestureEngine.js';

// =====================================
// APPLICATION INTERFACE
// =====================================

document.querySelector('#app').innerHTML = `
  <header class="topbar">
    <div class="brand">
      <span class="brand-icon">✧</span>
      <div>
        <h1>MYSTIC HANDS <span>AI</span></h1>
        <p>REALITY IS YOUR CANVAS</p>
      </div>
    </div>

    <div class="system-status">
      <span class="status-dot"></span>
      SYSTEM ONLINE
    </div>
  </header>

  <main class="dashboard">

    <section class="intro">
      <p class="eyebrow">PROJECT MYSTIC // VERSION 1.0</p>
      <h2>Control the <span>Unseen.</span></h2>
      <p class="description">
        Your hands are the interface. Your imagination is the power.
      </p>
    </section>

    <section class="workspace">

      <div class="camera-panel">

        <div class="panel-header">
          <div>
            <h3>VISION INTERFACE</h3>
            <p>REAL-TIME CAMERA INPUT</p>
          </div>

          <span id="camera-status" class="status-label">
            CAMERA OFFLINE
          </span>
        </div>

        <div class="camera-screen">

          <video id="camera-feed" autoplay playsinline muted></video>

          <canvas id="hand-canvas"></canvas>

          <div id="camera-placeholder" class="placeholder">
            <div class="camera-symbol">◉</div>
            <h3>Vision System Standby</h3>
            <p>Initialize camera to begin hand tracking.</p>
          </div>

          <div class="camera-overlay">
            <span>LIVE FEED</span>
            <span id="resolution">NO SIGNAL</span>
          </div>

        </div>

        <div class="camera-controls">
          <button id="camera-btn" class="primary-btn">
            ◉ INITIALIZE CAMERA
          </button>

          <button id="stop-btn" class="secondary-btn" disabled>
            STOP
          </button>
        </div>

        <p id="camera-message" class="camera-message">
          Waiting for camera initialization...
        </p>

      </div>

      <aside class="info-panel">

        <div class="info-card">
          <p class="card-label">HAND DETECTION</p>
          <h2 id="hand-count">0 <span>/ 2</span></h2>
          <p>Hands detected</p>
        </div>

        <div class="info-card">
          <p class="card-label">TRACKING ENGINE</p>
          <h2 id="tracking-status" class="pending">PENDING</h2>
          <p>MediaPipe hand tracking</p>
        </div>

        <div class="info-card">
          <p class="card-label">ACTIVE GESTURE</p>
          <h2 id="active-gesture">NONE</h2>
          <p>Recognized hand movement</p>
        </div>

        <div class="info-card">
          <p class="card-label">ACTIVE SPELL</p>
          <h2 id="active-spell">NONE</h2>
          <p>Gesture mapped spell</p>
        </div>

        <div class="info-card">
          <p class="card-label">TELEKINESIS ENGINE</p>
          <h2 id="telekinesis-status" class="pending">READY</h2>
          <p>3D object interaction</p>
        </div>

        <div class="info-card">
          <p class="card-label">SYSTEM CONTROL</p>
          <h2 id="sys-status" class="pending">OFF</h2>
          <p id="sys-detail">Mouse, volume and brightness by hand</p>
          <input id="sys-token" type="password" autocomplete="off"
            placeholder="Helper token"
            style="width:100%;margin-top:12px;padding:8px 10px;font-size:11px;color:#f2e6d6;background:#0c0c10;border:1px solid #59412b;border-radius:6px;">
          <button id="sys-toggle" class="secondary-btn"
            style="margin-top:10px;width:100%;">ENABLE (C)</button>
        </div>

        <div class="info-card">
          <p class="card-label">SYSTEM MODULES</p>

          <ul class="module-list">
            <li><span class="module-dot active"></span> Interface</li>
            <li><span class="module-dot"></span> Camera</li>
            <li><span class="module-dot"></span> Hand Tracking</li>
            <li><span class="module-dot"></span> Gesture Engine</li>
            <li><span class="module-dot"></span> Magic Engine</li>
            <li><span class="module-dot"></span> Telekinesis 3D</li>
          </ul>
        </div>

      </aside>

    </section>

    <footer>
      MYSTIC HANDS AI <span>•</span> BUILT FOR THE REAL WORLD
    </footer>

  </main>
`;

// =====================================
// DOM ELEMENTS
// =====================================

const video = document.querySelector('#camera-feed');
const canvas = document.querySelector('#hand-canvas');
const screen = document.querySelector('.camera-screen');

const cameraBtn = document.querySelector('#camera-btn');
const stopBtn = document.querySelector('#stop-btn');

const placeholder = document.querySelector('#camera-placeholder');

const cameraStatus = document.querySelector('#camera-status');
const cameraMessage = document.querySelector('#camera-message');
const resolution = document.querySelector('#resolution');

const handCount = document.querySelector('#hand-count');

const trackingStatus = document.querySelector('#tracking-status');
const activeGesture = document.querySelector('#active-gesture');
const activeSpell = document.querySelector('#active-spell');
const telekinesisStatus = document.querySelector('#telekinesis-status');

const modules = document.querySelectorAll('.module-list li');

const sysStatus = document.querySelector('#sys-status');
const sysDetail = document.querySelector('#sys-detail');
const sysToken = document.querySelector('#sys-token');
const sysToggle = document.querySelector('#sys-toggle');

// =====================================
// APPLICATION VARIABLES
// =====================================

let cameraStream = null;
let stopTracking = null;
let isStarting = false;

// UI cache: DOM is only touched when a value really changes
const uiCache = new Map();
let trackingUiOnline = false;

function setText(element, value) {
  if (uiCache.get(element) === value) return;
  uiCache.set(element, value);
  element.textContent = value;
}

function setHandCount(count) {
  const key = `hands:${count}`;
  if (uiCache.get(handCount) === key) return;
  uiCache.set(handCount, key);
  handCount.innerHTML = `${count} <span>/ 2</span>`;
}

function setModule(index, active) {
  modules[index].classList.toggle('module-active', active);
}

// =====================================
// CAMERA FRAME FIT
// The video, hand canvas and 3D canvas must share one aspect ratio,
// otherwise the skeleton drifts away from the real hand and 3D objects
// get squashed. Inline styles override the fixed 430px / 300px heights
// from style.css only while the camera is running.
// =====================================

function fitScreenToVideo() {
  screen.style.height = 'auto';
  screen.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
}

function resetScreenFit() {
  screen.style.height = '';
  screen.style.aspectRatio = '';
}

// =====================================
// SYSTEM CONTROL (mouse / volume / brightness via the local helper)
// =====================================

let systemEnabled = false;
let lastSystemHud = null;

const systemBridge = createSystemBridge({
  onChange: () => renderSystem()
});

const systemControl = createSystemControl(
  {},
  () => systemBridge.getState()
);

try {
  sysToken.value = localStorage.getItem('mystic.helperToken') || '';
} catch {
  // storage not available: the token is simply typed each time
}

function renderSystem() {

  const status = systemBridge.status();

  sysToggle.textContent = systemEnabled ? 'DISABLE (C / Esc)' : 'ENABLE (C)';

  if (!systemEnabled) {

    sysStatus.textContent = 'OFF';
    sysStatus.classList.remove('online');
    sysStatus.classList.add('pending');

    sysDetail.textContent = status.error || 'Mouse, volume and brightness by hand';

    return;
  }

  if (!status.authed) {

    sysStatus.textContent = 'CONNECTING';
    sysStatus.classList.remove('online');
    sysStatus.classList.add('pending');

    sysDetail.textContent = status.error || 'Connecting to the helper...';

    return;
  }

  sysStatus.textContent = 'ACTIVE';
  sysStatus.classList.remove('pending');
  sysStatus.classList.add('online');

  const hud = lastSystemHud;

  if (hud && hud.active) {

    const level = hud.dialLevel ?? hud[hud.dial];

    const levelText = typeof level === 'number'
      ? `${Math.round(level)}%`
      : '--';

    sysDetail.textContent =
      `${hud.cursorMode} | ${hud.dial.toUpperCase()} ${levelText}` +
      (hud.muted ? ' (muted)' : '');

  } else {

    sysDetail.textContent = 'Point with your index finger to move the mouse';
  }
}

function setSystemEnabled(on) {

  if (on === systemEnabled) return;

  if (on) {

    const token = sysToken.value.trim();

    if (!token) {
      sysDetail.textContent = 'Paste the helper token first';
      return;
    }

    try {
      localStorage.setItem('mystic.helperToken', token);
    } catch {
      // ignore
    }

    systemBridge.connect(token);
  }

  // Turning off: release any held mouse button BEFORE disconnecting
  const release = systemControl.setEnabled(on, performance.now());

  release.forEach((command) => systemBridge.send(command));

  if (!on) systemBridge.disconnect();

  systemEnabled = on;

  // The magic hands off / on: let go of anything held in the 3D scene
  if (stopTracking && stopTracking.releaseInteractions) {
    stopTracking.releaseInteractions();
  }

  renderSystem();
}

sysToggle.addEventListener('click', () => setSystemEnabled(!systemEnabled));

// =====================================
// GESTURE EVENT FEEDBACK + DEBUG HUD
// (press D to toggle the debug panel)
// =====================================

let lastSystemRender = 0;
let lastEventText = '';
let lastEventTime = 0;

function handleGestureEvent(event) {

  switch (event.type) {

    case 'CHARGE_START':
      lastEventText = 'Charging energy...';
      break;

    case 'CHARGE_CANCEL':
      lastEventText = `Charge cancelled (${event.reason})`;
      break;

    case 'RELEASE':
      lastEventText =
        `ENERGY RELEASED ${Math.round(event.energy * 100)}%` +
        (event.hands > 1 ? ' (both hands)' : '');
      break;

    case 'SNAP':
      lastEventText = event.personEffect
        ? 'SNAP - reality turns to dust'
        : 'SNAP (add selfie_segmenter.tflite to public/models to vanish yourself)';
      break;

    case 'CIRCLE_START':
      lastEventText = 'Draw a circle with two fingers...';
      break;

    case 'CIRCLE_COMPLETE':
      lastEventText = event.anchor ? 'MANDALA SHIELD OPENED' : 'PORTAL OPENED';
      break;

    case 'CIRCLE_CANCEL':
      lastEventText = 'Circle not completed';
      break;

    case 'GRAB_START':
      lastEventText = 'Object grab';
      break;

    case 'GRAB_END':
      lastEventText = 'Object released';
      break;

    default:
      return;
  }

  lastEventTime = performance.now();

  console.log(
    `[gesture] ${event.type}`,
    event.energy !== undefined
      ? `energy=${event.energy.toFixed(2)}`
      : ''
  );
}

const hud = document.createElement('pre');

Object.assign(hud.style, {
  position: 'absolute',
  left: '12px',
  bottom: '12px',
  zIndex: '5',
  margin: '0',
  padding: '8px 10px',
  display: 'none',
  pointerEvents: 'none',
  font: '11px/1.45 ui-monospace, Consolas, monospace',
  color: '#ffd9a0',
  background: 'rgba(8, 9, 13, 0.75)',
  border: '1px solid #674020',
  borderRadius: '6px',
  whiteSpace: 'pre'
});

screen.appendChild(hud);

let hudVisible = false;
let hudLastUpdate = 0;

window.addEventListener('keydown', (event) => {

  if (event.ctrlKey || event.metaKey || event.altKey) return;

  // Typing in the token box must never trigger shortcuts
  if (event.target && event.target.tagName === 'INPUT') return;

  const key = event.key.toLowerCase();

  if (key === 'd') {
    hudVisible = !hudVisible;
    hud.style.display = hudVisible ? 'block' : 'none';
  }

  if (key === 'c') {
    setSystemEnabled(!systemEnabled);
  }

  // Kill switch
  if (event.key === 'Escape') {
    setSystemEnabled(false);
  }
});

function updateHud(frame, now) {

  if (!hudVisible || now - hudLastUpdate < 100) return;

  hudLastUpdate = now;

  if (!frame || frame.hands.length === 0) {
    hud.textContent = 'GESTURE DEBUG\nno hands';
    return;
  }

  const f2 = (v) => v.toFixed(2);

  const lines = ['GESTURE DEBUG (D to hide)'];

  for (const h of frame.hands) {

    const a = h.analysis;

    lines.push(
      `#${h.id} ${h.label || '?'}  pose ${h.pose} (raw ${h.rawPose})`
    );

    lines.push(
      `   mode ${h.mode}  energy ${Math.round(h.energy * 100)}%` +
      `${h.grabbing ? '  GRABBING' : ''}${h.contact ? '  THUMB-MID' : ''}`
    );

    if (a) {
      lines.push(
        `   open ${f2(a.openness)}  pinch ${f2(a.pinchRatio)}  ` +
        `thumb-mid ${f2(a.thumbMiddleRatio)}`
      );
      lines.push(
        `   I ${f2(a.ext.index)}  M ${f2(a.ext.middle)}  ` +
        `R ${f2(a.ext.ring)}  P ${f2(a.ext.pinky)}`
      );
    }
  }

  hud.textContent = lines.join('\n');
}

// =====================================
// START CAMERA
// =====================================

async function startCamera() {

  if (isStarting || cameraStream) return;

  isStarting = true;
  cameraBtn.disabled = true;

  try {

    cameraMessage.textContent = 'Starting camera...';

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = cameraStream;

    await video.play();

    fitScreenToVideo();

    placeholder.style.display = 'none';

    cameraStatus.textContent = 'CAMERA ONLINE';
    cameraStatus.classList.add('online');

    modules[1].classList.add('module-active');

    resolution.textContent =
      `${video.videoWidth} × ${video.videoHeight}`;

    stopBtn.disabled = false;

    cameraMessage.textContent =
      'Initializing MediaPipe and 3D Telekinesis...';

    // =================================
    // INITIALIZE HAND TRACKING
    // =================================

    stopTracking = await startHandTracking(
      video,
      canvas,
      (hands, handedness, delegate, frame) => {

        const now = performance.now();

        // One-time "engines online" state (no per-frame DOM writes)
        if (!trackingUiOnline) {

          trackingUiOnline = true;

          trackingStatus.textContent = 'ACTIVE';
          trackingStatus.classList.remove('pending');
          trackingStatus.classList.add('online');

          modules[2].classList.add('module-active');

          telekinesisStatus.textContent = 'ACTIVE';
          telekinesisStatus.classList.remove('pending');
          telekinesisStatus.classList.add('online');

          modules[5].classList.add('module-active');
        }

        setHandCount(hands.length);
        updateHud(frame, now);

        // ---------- system control (runs even with no hands, to release buttons) ----------
        if (systemEnabled && systemBridge.status().authed) {

          const result = systemControl.update(frame, now);

          for (const command of result.commands) {
            systemBridge.send(command);
          }

          lastSystemHud = result.hud;

          // Hands away for a long time: switch control off for safety
          if (
            result.hud.active &&
            result.hud.idleMs > result.hud.idleDisableMs
          ) {
            setSystemEnabled(false);
          }

          if (now - lastSystemRender > 120) {
            lastSystemRender = now;
            renderSystem();
          }
        }

        if (hands.length === 0) {

          setText(activeGesture, 'NONE');
          setText(activeSpell, 'NONE');

          setText(
            cameraMessage,
            'Show your hand to control floating objects.'
          );

          setModule(3, false);

          return;
        }

        if (systemEnabled) {

          const hudNow = lastSystemHud;

          setText(activeGesture, hudNow ? hudNow.cursorMode : 'CONTROL');
          setText(activeSpell, 'SYSTEM CONTROL');
          setText(cameraMessage, 'System control is on. Press Esc to stop.');
          setModule(3, true);

          return;
        }

        const state = frame.ui.gesture;

        let gestureText = getGestureName(state);

        if (
          state === 'CHARGING' ||
          state === 'RELEASE' ||
          state === 'SPELL_DRAW'
        ) {
          gestureText += ` ${Math.round(frame.ui.energy * 100)}%`;
        }

        setText(activeGesture, gestureText);
        setText(activeSpell, getSpellName(state));

        setModule(3, true);

        // Recent gesture events take over the message line briefly
        if (now - lastEventTime < 1500 && lastEventText) {
          setText(cameraMessage, lastEventText);
        } else {
          setText(
            cameraMessage,
            `Gesture: ${getGestureName(state)} | Telekinesis ready`
          );
        }
      },
      {
        onGestureEvent: handleGestureEvent,
        isInputBlocked: () => systemEnabled
      }
    );

    console.log('MYSTIC HANDS AI: All engines active.');

  } catch (error) {

    console.error('Initialization Error:', error);

    cameraMessage.textContent =
      `Initialization failed: ${error.message}`;

    stopCamera();

  } finally {

    isStarting = false;

    if (!cameraStream) {
      cameraBtn.disabled = false;
    }
  }
}

// =====================================
// STOP CAMERA
// =====================================

function stopCamera() {

  if (systemEnabled) {
    setSystemEnabled(false);
  }

  if (stopTracking) {

    stopTracking();
    stopTracking = null;
  }

  if (cameraStream) {

    cameraStream.getTracks().forEach(track => {
      track.stop();
    });

    cameraStream = null;
  }

  video.srcObject = null;

  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  resetScreenFit();

  placeholder.style.display = 'flex';

  cameraStatus.textContent = 'CAMERA OFFLINE';
  cameraStatus.classList.remove('online');

  cameraMessage.textContent = 'Camera stopped.';

  resolution.textContent = 'NO SIGNAL';

  // Reset cached UI state so the next start redraws everything
  uiCache.clear();
  trackingUiOnline = false;
  lastEventText = '';
  lastEventTime = 0;

  hud.textContent = '';

  handCount.innerHTML = '0 <span>/ 2</span>';

  trackingStatus.textContent = 'PENDING';
  trackingStatus.classList.remove('online');
  trackingStatus.classList.add('pending');

  activeGesture.textContent = 'NONE';
  activeSpell.textContent = 'NONE';

  telekinesisStatus.textContent = 'READY';
  telekinesisStatus.classList.remove('online');

  modules.forEach((module, index) => {
    if (index !== 0) {
      module.classList.remove('module-active');
    }
  });

  cameraBtn.disabled = false;
  stopBtn.disabled = true;
}

// =====================================
// BUTTON EVENTS
// =====================================

cameraBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);

window.addEventListener('beforeunload', stopCamera);