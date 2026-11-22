/*
  MYSTIC HANDS AI
  Finger snap detector

  A snap looks like this to a camera:
    1. CONTACT     thumb tip touches the middle fingertip and is held
    2. SEPARATION  the fingers fly apart within a few frames

  The input is thumbMiddleRatio from gestureEngine (thumb-to-middle-tip
  distance divided by palm size, so it does not depend on how far the hand
  is from the camera).

  What is rejected:
    - a held pinch (no separation)
    - slowly opening the fingers (separation speed too low)
    - a one-frame touch (contact too short = sensor noise)
    - repeated snaps inside the cooldown

  Webcams run at 15-30 fps and a real snap separates in a few milliseconds,
  so one frame often jumps from "touching" to "far apart". Speed is measured
  frame to frame, using the actual time between frames.

  Event: SNAP { handId, position, speed }
*/

export const SNAP_CONFIG = {

  contactEnter: 0.30,       // thumb-middle ratio below this = touching
  minContactMs: 50,         // contact must last at least this long

  releaseWindowMs: 140,     // separation must finish within this time
  maxGapMs: 100,            // tracking gap longer than this cancels a pending snap
  releaseDelta: 0.40,       // ratio must grow by this much (in palm sizes)
  releaseMinSpeed: 6.0,     // fastest frame-to-frame growth, palm sizes / second

  cooldownMs: 2500,
  recentMs: 1500            // how long the UI keeps showing "SNAP"
};

export function createSnapDetector(overrides = {}) {

  const cfg = { ...SNAP_CONFIG, ...overrides };

  let hands = new Map();
  let lastSnapAt = -Infinity;

  function stateFor(id) {

    let s = hands.get(id);

    if (!s) {
      s = {
        contactSince: null,     // start of the current contact
        lastContact: null,      // time of the last contact frame
        contactRatio: 0,        // ratio at the last contact frame
        contactMs: 0,           // length of the finished contact
        pending: false,         // contact ended, watching for separation
        prevT: null,
        prevRatio: null,
        maxSpeed: 0,
        lastSeen: 0
      };
      hands.set(id, s);
    }

    return s;
  }

  function resetContact(s) {
    s.contactSince = null;
    s.lastContact = null;
    s.pending = false;
    s.maxSpeed = 0;
  }

  /**
   * @param {Array}  handList gestureFrame.hands (needs id, analysis, palm)
   * @param {number} now      ms
   */
  function update(handList = [], now = performance.now()) {

    const events = [];
    const seen = new Set();

    for (const hand of handList) {

      if (!hand.analysis) continue;

      seen.add(hand.id);

      const s = stateFor(hand.id);
      const ratio = hand.analysis.thumbMiddleRatio;

      s.lastSeen = now;

      // A tracking gap (hand lost, camera stall) breaks the motion: start over
      let speed = 0;

      if (s.prevT !== null && now - s.prevT > cfg.maxGapMs) {
        resetContact(s);
        s.contactSince = null;
        s.prevT = null;
      }

      // Frame-to-frame speed, using the real time between frames
      if (s.prevT !== null) {
        const dt = Math.max((now - s.prevT) / 1000, 0.001);
        speed = (ratio - s.prevRatio) / dt;
      }

      s.prevT = now;
      s.prevRatio = ratio;

      if (ratio < cfg.contactEnter) {

        // ---------- touching ----------
        // A new touch (also one that interrupts a pending release) restarts the clock
        if (s.contactSince === null || s.pending) s.contactSince = now;

        s.lastContact = now;
        s.contactRatio = ratio;
        s.pending = false;
        s.maxSpeed = 0;

        continue;
      }

      // ---------- not touching ----------
      if (s.contactSince !== null && !s.pending) {

        // Contact has just ended: was it long enough to be deliberate?
        s.contactMs = s.lastContact - s.contactSince;
        s.pending = s.contactMs >= cfg.minContactMs;

        s.maxSpeed = 0;

        if (!s.pending) {
          resetContact(s);
          continue;
        }
      }

      if (!s.pending) continue;

      s.maxSpeed = Math.max(s.maxSpeed, speed);

      const elapsed = now - s.lastContact;
      const rise = ratio - s.contactRatio;

      if (elapsed > cfg.releaseWindowMs) {

        // Opened too slowly: a relaxed release, not a snap
        resetContact(s);
        s.contactSince = null;
        continue;
      }

      if (rise >= cfg.releaseDelta && s.maxSpeed >= cfg.releaseMinSpeed) {

        if (now - lastSnapAt >= cfg.cooldownMs) {

          lastSnapAt = now;

          events.push({
            type: 'SNAP',
            time: now,
            handId: hand.id,
            position: hand.palm ? { ...hand.palm } : { x: 0.5, y: 0.5 },
            speed: s.maxSpeed
          });
        }

        resetContact(s);
      }
    }

    // Hands that disappeared mid-snap
    for (const [id, s] of hands) {

      if (seen.has(id)) continue;

      if (now - s.lastSeen > 300) {
        hands.delete(id);
      }
    }

    return {
      events,
      recent: now - lastSnapAt < cfg.recentMs
    };
  }

  function reset() {
    hands = new Map();
    lastSnapAt = -Infinity;
  }

  return { update, reset, config: cfg };
}