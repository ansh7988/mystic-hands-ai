/*
  MYSTIC HANDS AI
  Gesture Recognition Engine

  PART 1 - ORIGINAL CLASSIFIER (unchanged behaviour)
    recognizeGesture / getGestureName / getSpellName
    magicEngine.js depends on recognizeGesture, so its output is untouched.

  PART 2 - NEW (Milestone 2)
    analyzeHand          rotation- and scale-invariant finger metrics
    createGestureTracker per-hand state machine:
                         FIST = charge, OPEN = release, PINCH = grab,
                         plus hooks for the Milestone 6 snap detector
*/

// =====================================================
// PART 1 - ORIGINAL CLASSIFIER (do not change semantics)
// =====================================================

// Calculate distance between two landmarks
function distance(pointA, pointB) {
  const dx = pointA.x - pointB.x;
  const dy = pointA.y - pointB.y;

  return Math.sqrt(dx * dx + dy * dy);
}

// Check whether a finger is extended
function isFingerExtended(landmarks, tip, pip) {
  return landmarks[tip].y < landmarks[pip].y;
}

// Main gesture classifier
export function recognizeGesture(landmarks) {

  if (!landmarks || landmarks.length !== 21) {
    return 'UNKNOWN';
  }

  // Finger states
  const index = isFingerExtended(landmarks, 8, 6);
  const middle = isFingerExtended(landmarks, 12, 10);
  const ring = isFingerExtended(landmarks, 16, 14);
  const pinky = isFingerExtended(landmarks, 20, 18);

  // Thumb and index fingertip distance
  const pinchDistance = distance(
    landmarks[4],
    landmarks[8]
  );

  // 1. PINCH
  if (pinchDistance < 0.055) {
    return 'PINCH';
  }

  // 2. OPEN PALM
  if (index && middle && ring && pinky) {
    return 'OPEN_PALM';
  }

  // 3. TWO FINGERS
  if (index && middle && !ring && !pinky) {
    return 'TWO_FINGERS';
  }

  // 4. FIST
  if (!index && !middle && !ring && !pinky) {
    return 'FIST';
  }

  return 'UNKNOWN';
}

// Human-readable gesture names
export function getGestureName(gesture) {

  const names = {
    OPEN_PALM: 'OPEN PALM',
    PINCH: 'PINCH',
    FIST: 'FIST',
    TWO_FINGERS: 'TWO FINGERS',
    UNKNOWN: 'NO GESTURE',

    // Milestone 2 states
    CHARGING: 'CHARGING',
    RELEASE: 'RELEASE',
    GRAB: 'GRAB',
    SNAP: 'SNAP'
  };

  return names[gesture] || 'NO GESTURE';
}

// Spell mapping
export function getSpellName(gesture) {

  const spells = {
    OPEN_PALM: 'ENERGY SHIELD',
    PINCH: 'ENERGY ORB',
    FIST: 'ENERGY CHARGE',
    TWO_FINGERS: 'SPELL SELECTION',
    UNKNOWN: 'NONE',

    // Milestone 2 states
    CHARGING: 'ENERGY HOLD',
    RELEASE: 'ENERGY RELEASE',
    GRAB: 'OBJECT CONTROL',
    SNAP: 'DESTRUCTION'
  };

  return spells[gesture] || 'NONE';
}

// =====================================================
// PART 2 - ROBUST HAND ANALYSIS (Milestone 2)
// =====================================================

// All thresholds live here so they can be tuned from one place.
export const GESTURE_CONFIG = {

  // Finger extension = tip-to-wrist / knuckle-to-wrist distance ratio,
  // mapped from [curlRatio .. extendRatio] to [0 .. 1].
  curlRatio: 1.05,
  extendRatio: 1.65,

  // Hysteresis thresholds on mean finger openness (0 = fist, 1 = open)
  fistEnter: 0.25,
  fistExit: 0.45,
  openEnter: 0.75,
  openExit: 0.55,
  openMinFinger: 0.5,
  openExitMinFinger: 0.3,

  // Pinch: thumb-index distance divided by palm size
  pinchEnter: 0.30,
  pinchExit: 0.58,       // sticky: fingers must open clearly to let go
  pinchMinIndex: 0.35,   // index must not be curled (rules out a fist)

  // Thumb-middle contact (snap contact phase, used from Milestone 6)
  contactEnter: 0.30,
  contactExit: 0.42,

  // A new pose must be stable this long before it is committed (ms)
  confirmMs: { FIST: 120, OPEN: 90, PINCH: 50, TWO_FINGERS: 100 },

  // Unclassifiable frames ("in between") keep the committed pose this long (ms)
  graceMs: { FIST: 250, OPEN: 250, PINCH: 160, TWO_FINGERS: 150 },
  defaultGraceMs: 150,

  // Energy model
  chargeSeconds: 3.0,        // seconds of fist for full energy
  minReleaseEnergy: 0.05,    // below this an open palm is a cancelled tap
  cooldownMs: 500,           // per-hand pause after a release

  // Tracking and multi-hand behaviour
  lostMs: 350,               // hand missing this long -> track dropped
  matchDistance: 0.3,        // max wrist jump between frames (normalised)
  mergeMs: 120,              // two hands releasing within this merge to one
  globalReleaseCooldownMs: 350,
  releaseDisplayMs: 800
};

const FINGERS = {
  index: [5, 8],
  middle: [9, 12],
  ring: [13, 16],
  pinky: [17, 20]
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Distance in 3D. aspect corrects image-space x/z (normalised by width)
// against y (normalised by height). For world landmarks (metres) use aspect = 1.
function dist3(a, b, aspect) {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  const dz = ((a.z || 0) - (b.z || 0)) * aspect;
  return Math.hypot(dx, dy, dz);
}

/**
 * Rotation- and scale-invariant hand metrics.
 * @param {Array} lm      21 landmarks (world landmarks preferred)
 * @param {number} aspect video width / height when lm are image landmarks
 */
export function analyzeHand(lm, aspect = 1) {

  if (!lm || lm.length !== 21) return null;

  const cfg = GESTURE_CONFIG;
  const wrist = lm[0];

  // Palm size: wrist -> middle knuckle
  const scale = dist3(wrist, lm[9], aspect) || 1e-6;

  const ext = {};
  let sum = 0;
  let minFinger = 1;

  for (const [name, [mcp, tip]] of Object.entries(FINGERS)) {

    const knuckle = dist3(lm[mcp], wrist, aspect) || 1e-6;
    const ratio = dist3(lm[tip], wrist, aspect) / knuckle;

    const e = clamp01(
      (ratio - cfg.curlRatio) / (cfg.extendRatio - cfg.curlRatio)
    );

    ext[name] = e;
    sum += e;
    if (e < minFinger) minFinger = e;
  }

  return {
    scale,
    ext,
    openness: sum / 4,
    minFinger,
    pinchRatio: dist3(lm[4], lm[8], aspect) / scale,
    thumbMiddleRatio: dist3(lm[4], lm[12], aspect) / scale
  };
}

// Raw pose with hysteresis relative to the previous raw pose.
function classifyRawPose(a, prevRaw, prevContact) {

  const cfg = GESTURE_CONFIG;

  // Thumb touching the middle finger (snap contact) is not a pinch.
  const contact =
    a.thumbMiddleRatio < (prevContact ? cfg.contactExit : cfg.contactEnter) &&
    a.thumbMiddleRatio < a.pinchRatio;

  const pinchLimit = prevRaw === 'PINCH' ? cfg.pinchExit : cfg.pinchEnter;

  if (
    !contact &&
    a.ext.index > cfg.pinchMinIndex &&
    a.pinchRatio < pinchLimit
  ) {
    return { pose: 'PINCH', contact };
  }

  const fistLimit = prevRaw === 'FIST' ? cfg.fistExit : cfg.fistEnter;

  if (a.openness < fistLimit) {
    return { pose: 'FIST', contact };
  }

  const wasOpen = prevRaw === 'OPEN';
  const openLimit = wasOpen ? cfg.openExit : cfg.openEnter;
  const minLimit = wasOpen ? cfg.openExitMinFinger : cfg.openMinFinger;

  if (a.openness > openLimit && a.minFinger > minLimit) {
    return { pose: 'OPEN', contact };
  }

  if (
    a.ext.index > 0.6 && a.ext.middle > 0.6 &&
    a.ext.ring < 0.35 && a.ext.pinky < 0.35
  ) {
    return { pose: 'TWO_FINGERS', contact };
  }

  return { pose: 'OTHER', contact };
}

// =====================================================
// GESTURE TRACKER (state machine)
// =====================================================

/**
 * Per-hand state machine.
 *
 *   IDLE --fist held--> CHARGING --open palm--> (RELEASE event) COOLDOWN --> IDLE
 *                          |
 *                          +-- lost hand / other gesture --> CHARGE_CANCEL
 *
 * A release can only happen from CHARGING, and CHARGING can only be entered
 * with a fresh fist, so one continuous open palm can never fire twice.
 *
 * Events: CHARGE_START, CHARGE_CANCEL, RELEASE, GRAB_START, GRAB_END
 * Positions are normalised image coordinates (0..1, unmirrored).
 */
export function createGestureTracker(overrides = {}) {

  const cfg = { ...GESTURE_CONFIG, ...overrides };

  let nextId = 1;
  let tracks = [];

  let pendingRelease = null;
  let lastReleaseAt = -Infinity;
  let recentRelease = null;

  function newTrack(now) {
    return {
      id: nextId++,
      label: null,
      wrist: { x: 0, y: 0 },
      lastSeen: now,
      lastUpdate: now,

      rawPose: 'NONE',
      contact: false,
      pose: 'NONE',
      poseSince: now,
      pending: null,
      pendingSince: now,

      mode: 'IDLE',
      energy: 0,
      cooldownUntil: 0,

      grabbing: false,
      analysis: null,
      palm: { x: 0, y: 0 },
      pinchPoint: { x: 0, y: 0 }
    };
  }

  function palmCenter(lm) {
    let x = 0;
    let y = 0;
    for (const i of [0, 5, 9, 13, 17]) {
      x += lm[i].x;
      y += lm[i].y;
    }
    return { x: x / 5, y: y / 5 };
  }

  function queueRelease(ev, now) {

    // Global lock: never two explosions from one gesture burst
    if (now - lastReleaseAt < cfg.globalReleaseCooldownMs) return;

    if (!pendingRelease) {
      pendingRelease = { start: now, items: [] };
    }

    pendingRelease.items.push(ev);
  }

  function flushRelease(now, events) {

    if (!pendingRelease) return;
    if (now - pendingRelease.start < cfg.mergeMs) return;

    const items = pendingRelease.items;
    pendingRelease = null;
    lastReleaseAt = now;

    const energy = Math.min(
      1,
      items.reduce((sum, item) => sum + item.energy, 0)
    );

    const position = {
      x: items.reduce((s, i) => s + i.position.x, 0) / items.length,
      y: items.reduce((s, i) => s + i.position.y, 0) / items.length
    };

    events.push({
      type: 'RELEASE',
      time: now,
      energy,
      position,
      handIds: items.map((i) => i.handId),
      hands: items.length
    });

    recentRelease = { until: now + cfg.releaseDisplayMs, energy };
  }

  function cancelCharge(track, now, reason, events) {

    if (track.mode === 'CHARGING') {
      events.push({
        type: 'CHARGE_CANCEL',
        time: now,
        handId: track.id,
        reason,
        energy: track.energy
      });
    }

    track.mode = 'IDLE';
    track.energy = 0;
  }

  function updatePose(track, raw, now) {

    track.rawPose = raw;

    if (raw === track.pose) {
      track.pending = null;
      return;
    }

    if (raw !== track.pending) {
      track.pending = raw;
      track.pendingSince = now;
    }

    const need = raw === 'OTHER'
      ? (cfg.graceMs[track.pose] ?? cfg.defaultGraceMs)
      : cfg.confirmMs[raw];

    if (now - track.pendingSince >= need) {
      track.pose = raw;
      track.poseSince = now;
      track.pending = null;
    }
  }

  function updateMachine(track, now, dt, events) {

    // ---------- charge / release ----------
    switch (track.mode) {

      case 'IDLE':
        if (track.pose === 'FIST' && now >= track.cooldownUntil) {
          track.mode = 'CHARGING';
          track.energy = 0;
          events.push({
            type: 'CHARGE_START',
            time: now,
            handId: track.id,
            position: { ...track.palm }
          });
        }
        break;

      case 'CHARGING':

        if (track.pose === 'FIST') {

          // Energy only grows while the fist is really closed; it is
          // held (not lost) during short in-between frames.
          if (track.rawPose === 'FIST') {
            track.energy = Math.min(
              1,
              track.energy + dt / cfg.chargeSeconds
            );
          }

        } else if (track.pose === 'OPEN') {

          if (track.energy >= cfg.minReleaseEnergy) {

            queueRelease({
              handId: track.id,
              energy: track.energy,
              position: { ...track.palm }
            }, now);

            track.mode = 'COOLDOWN';
            track.cooldownUntil = now + cfg.cooldownMs;
            track.energy = 0;

          } else {
            cancelCharge(track, now, 'tap', events);
          }

        } else {
          cancelCharge(track, now, 'gesture_changed', events);
        }
        break;

      case 'COOLDOWN':
        if (now >= track.cooldownUntil) {
          track.mode = 'IDLE';
        }
        break;
    }

    // ---------- grab ----------
    const wantsGrab =
      track.pose === 'PINCH' &&
      track.mode !== 'CHARGING';

    if (wantsGrab && !track.grabbing) {

      track.grabbing = true;

      events.push({
        type: 'GRAB_START',
        time: now,
        handId: track.id,
        position: { ...track.pinchPoint }
      });

    } else if (!wantsGrab && track.grabbing) {

      track.grabbing = false;

      events.push({
        type: 'GRAB_END',
        time: now,
        handId: track.id,
        position: { ...track.pinchPoint }
      });
    }
  }

  function uiStateOf(track) {

    if (track.mode === 'CHARGING') return 'CHARGING';
    if (track.grabbing) return 'GRAB';

    switch (track.pose) {
      case 'FIST': return 'FIST';
      case 'OPEN': return 'OPEN_PALM';
      case 'PINCH': return 'PINCH';
      case 'TWO_FINGERS': return 'TWO_FINGERS';
      default: return 'UNKNOWN';
    }
  }

  /**
   * @param {Array} hands       image landmarks per hand
   * @param {Array} worldHands  world landmarks per hand (may be empty)
   * @param {Array} handedness  MediaPipe handedness per hand
   * @param {number} now        ms timestamp
   * @param {number} aspect     video width / height
   */
  function update(hands = [], worldHands = [], handedness = [], now = performance.now(), aspect = 1) {

    const events = [];

    // ---------- match detections to tracks (nearest wrist, greedy) ----------
    const detections = hands.map((lm, i) => ({
      lm,
      world: worldHands[i] && worldHands[i].length === 21 ? worldHands[i] : null,
      label: handedness[i]?.[0]?.categoryName ?? null
    }));

    const pairs = [];

    detections.forEach((det, di) => {
      tracks.forEach((track, ti) => {
        const d = Math.hypot(
          (det.lm[0].x - track.wrist.x) * aspect,
          det.lm[0].y - track.wrist.y
        );
        if (d <= cfg.matchDistance) pairs.push({ d, di, ti });
      });
    });

    pairs.sort((a, b) => a.d - b.d);

    const usedDet = new Set();
    const usedTrack = new Set();
    const matched = [];

    for (const p of pairs) {
      if (usedDet.has(p.di) || usedTrack.has(p.ti)) continue;
      usedDet.add(p.di);
      usedTrack.add(p.ti);
      matched.push({ track: tracks[p.ti], det: detections[p.di] });
    }

    detections.forEach((det, di) => {
      if (usedDet.has(di)) return;
      const track = newTrack(now);
      tracks.push(track);
      matched.push({ track, det });
    });

    // ---------- update matched tracks ----------
    const frameHands = [];

    for (const { track, det } of matched) {

      const dt = Math.min(Math.max((now - track.lastUpdate) / 1000, 0), 0.1);

      track.lastUpdate = now;
      track.lastSeen = now;
      track.label = det.label ?? track.label;
      track.wrist = { x: det.lm[0].x, y: det.lm[0].y };
      track.palm = palmCenter(det.lm);
      track.pinchPoint = {
        x: (det.lm[4].x + det.lm[8].x) / 2,
        y: (det.lm[4].y + det.lm[8].y) / 2
      };

      // World landmarks (metres) are the most scale-invariant input
      const analysis = det.world
        ? analyzeHand(det.world, 1)
        : analyzeHand(det.lm, aspect);

      track.analysis = analysis;

      if (analysis) {
        const raw = classifyRawPose(analysis, track.rawPose, track.contact);
        track.contact = raw.contact;
        updatePose(track, raw.pose, now);
      }

      updateMachine(track, now, dt, events);

      frameHands.push({
        id: track.id,
        label: track.label,
        pose: track.pose,
        rawPose: track.rawPose,
        mode: track.mode,
        energy: track.energy,
        grabbing: track.grabbing,
        contact: track.contact,
        palm: { ...track.palm },
        pinchPoint: { ...track.pinchPoint },
        analysis: track.analysis,
        ui: uiStateOf(track)
      });
    }

    // ---------- drop tracks that have been missing too long ----------
    tracks = tracks.filter((track) => {

      if (now - track.lastSeen <= cfg.lostMs) return true;

      cancelCharge(track, now, 'hand_lost', events);

      if (track.grabbing) {
        events.push({
          type: 'GRAB_END',
          time: now,
          handId: track.id,
          position: { ...track.pinchPoint },
          reason: 'hand_lost'
        });
      }

      return false;
    });

    // ---------- merged release ----------
    flushRelease(now, events);

    // ---------- summary for the UI ----------
    const priority = { CHARGING: 4, GRAB: 3, FIST: 2, OPEN_PALM: 2, PINCH: 2, TWO_FINGERS: 2, UNKNOWN: 0 };

    let primary = null;

    for (const h of frameHands) {
      if (!primary || (priority[h.ui] ?? 0) > (priority[primary.ui] ?? 0)) {
        primary = h;
      }
    }

    let gesture = primary ? primary.ui : 'UNKNOWN';
    let energy = primary ? primary.energy : 0;

    if (recentRelease && now < recentRelease.until) {
      gesture = 'RELEASE';
      energy = recentRelease.energy;
    }

    return {
      time: now,
      hands: frameHands,
      events,
      ui: { gesture, energy, handId: primary ? primary.id : null }
    };
  }

  function reset() {
    tracks = [];
    pendingRelease = null;
    recentRelease = null;
    lastReleaseAt = -Infinity;
  }

  return { update, reset, config: cfg };
}