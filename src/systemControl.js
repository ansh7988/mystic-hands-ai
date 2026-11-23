/*
  MYSTIC HANDS AI
  System control: turns hand gestures into OS commands.

  This module is pure logic (no network, no DOM). It reads the gesture
  frame from gestureEngine.js and returns a list of commands. systemBridge.js
  sends them to the local helper program, which performs the real action.

  ROLES (by position on the mirrored screen)
    cursor hand  = the hand on the right of the screen (configurable)
    dial hand    = the other hand

  CURSOR HAND
    index finger pointing          move the mouse
    thumb + index pinch            left click (hold and move = drag)
    thumb + middle pinch           right click (middle finger must be raised)
    index + middle fingers         scroll (move the hand up / down)

  DIAL HAND
    pinch and move up / down       turn the knob (volume or brightness)
    two fingers                    switch knob: VOLUME <-> BRIGHTNESS
    fist held ~1 second            mute / unmute

  Commands: move, down, up, click, scroll, volume, brightness, mute
*/

export const CONTROL_CONFIG = {

  cursorHand: 'right',            // which side of the screen is the cursor hand

  // Part of the camera frame that maps onto the whole screen, so the
  // screen edges are reachable without leaving the camera view.
  region: { x0: 0.15, x1: 0.85, y0: 0.15, y1: 0.80 },

  // One Euro filter: smooth when slow, responsive when fast
  filter: { minCutoff: 1.0, beta: 6.0, dCutoff: 1.0 },

  moveMinDelta: 0.0004,           // do not send moves smaller than this
  moveIntervalMs: 14,

  // Click / drag
  latchRatio: 0.55,               // cursor freezes when the pinch starts closing
  dragDeadzone: 0.012,            // hand must move this far before a drag starts
  rightClickCooldownMs: 700,
  rightClickMinMiddle: 0.4,       // middle finger must be raised for right click

  // Scroll
  scrollDeadzone: 0.003,
  scrollGain: 24,                 // wheel notches per frame-height of hand movement
  scrollDirection: 1,             // 1 = hand up scrolls up, -1 = reversed

  // Dial
  dialGain: 200,                  // percent per frame-height (0.5 = full range)
  dialSendIntervalMs: 50,
  switchCooldownMs: 900,
  muteHoldMs: 1000,
  muteCooldownMs: 1500,

  handLostMs: 300,                // hands missing this long releases everything
  idleDisableMs: 12000            // reported so the UI can switch control off
};

// ------------------------------------------------------------------
// One Euro filter
// ------------------------------------------------------------------

class OneEuro {

  constructor({ minCutoff, beta, dCutoff }) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value, tMs) {

    if (this.x === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }

    const dt = Math.max((tMs - this.t) / 1000, 1e-3);

    const rawVelocity = (value - this.x) / dt;

    this.dx += this.alpha(this.dCutoff, dt) * (rawVelocity - this.dx);

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);

    this.x += this.alpha(cutoff, dt) * (value - this.x);
    this.t = tMs;

    return this.x;
  }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ------------------------------------------------------------------

/**
 * @param {object}   overrides  CONTROL_CONFIG overrides
 * @param {function} getState   () => { volume, brightness } latest known levels
 */
export function createSystemControl(overrides = {}, getState = () => ({})) {

  const cfg = {
    ...CONTROL_CONFIG,
    ...overrides,
    region: { ...CONTROL_CONFIG.region, ...(overrides.region || {}) },
    filter: { ...CONTROL_CONFIG.filter, ...(overrides.filter || {}) }
  };

  const fx = new OneEuro(cfg.filter);
  const fy = new OneEuro(cfg.filter);

  let enabled = false;

  const s = {
    cursor: { x: 0.5, y: 0.5 },
    mode: 'IDLE',

    down: false,
    latched: false,
    dragStarted: false,
    base: { x: 0.5, y: 0.5 },
    ref: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
    lastMove: { x: -1, y: -1, t: -1e9 },
    prevContact: false,
    lastRightClick: -1e9,

    scrollPrevY: null,
    scrollAcc: 0,

    dial: 'volume',
    dialEngaged: false,
    dialRefY: 0,
    dialStart: 50,
    dialLevel: null,
    lastDialSend: { t: -1e9, value: null },
    prevDialTwo: false,
    lastSwitch: -1e9,
    fistSince: null,
    muteFired: false,
    lastMute: -1e9,

    lastSeen: 0,
    lastOffsetTime: 0
  };

  function mapToScreen(ix, iy) {

    const r = cfg.region;

    return {
      x: clamp((1 - ix - r.x0) / (r.x1 - r.x0), 0, 1),   // mirrored view
      y: clamp((iy - r.y0) / (r.y1 - r.y0), 0, 1)
    };
  }

  function releaseButtons(commands) {

    if (s.down) {
      commands.push({ type: 'up', button: 'left' });
      s.down = false;
    }

    s.latched = false;
    s.dragStarted = false;
  }

  function currentLevel(kind) {

    const known = getState() || {};

    if (typeof known[kind] === 'number') return known[kind];

    return typeof s.dialLevel === 'number' ? s.dialLevel : 50;
  }

  // ------------------------------------------------------------------
  // cursor hand
  // ------------------------------------------------------------------

  function updateCursorHand(hand, now, commands) {

    const a = hand.analysis;
    const ext = a ? a.ext : null;

    const pointing =
      !!ext &&
      ext.index > 0.6 && ext.middle < 0.35 &&
      ext.ring < 0.35 && ext.pinky < 0.35;

    const pinching = hand.pose === 'PINCH';

    const pinchClosing =
      !!ext && ext.index > 0.35 && a.pinchRatio < cfg.latchRatio && !hand.contact;

    const twoFingers = hand.pose === 'TWO_FINGERS';

    // ---------- scroll ----------
    if (twoFingers) {

      if (s.down) releaseButtons(commands);

      s.mode = 'SCROLL';
      s.latched = false;

      const y = hand.fingerTip.y;

      if (s.scrollPrevY !== null) {

        const dy = y - s.scrollPrevY;

        if (Math.abs(dy) > cfg.scrollDeadzone) {
          s.scrollAcc += -dy * cfg.scrollGain * cfg.scrollDirection;
        }
      }

      s.scrollPrevY = y;

      const notches = Math.trunc(s.scrollAcc);

      if (notches !== 0) {
        commands.push({ type: 'scroll', dy: notches });
        s.scrollAcc -= notches;
      }

      return;
    }

    s.scrollPrevY = null;
    s.scrollAcc = 0;

    // ---------- right click: thumb + RAISED middle finger ----------
    const rightPinch =
      hand.contact && !!ext && ext.middle > cfg.rightClickMinMiddle;

    if (
      rightPinch &&
      !s.prevContact &&
      !s.down &&
      now - s.lastRightClick > cfg.rightClickCooldownMs
    ) {
      commands.push({ type: 'click', button: 'right' });
      s.lastRightClick = now;
    }

    s.prevContact = !!hand.contact;

    const engaged = pointing || pinching || pinchClosing;

    if (!engaged) {

      if (s.down) releaseButtons(commands);

      s.latched = false;
      s.mode = 'IDLE';

      return;
    }

    const mapped = mapToScreen(hand.indexTip.x, hand.indexTip.y);

    // ---------- latch the cursor when a pinch starts closing ----------
    if (!s.latched && (pinchClosing || pinching)) {

      s.latched = true;
      s.dragStarted = false;
      s.base = { x: s.cursor.x, y: s.cursor.y };
      s.ref = { x: hand.indexBase.x, y: hand.indexBase.y };
    }

    let target;

    if (s.latched) {

      if (pinching && !s.down) {
        commands.push({ type: 'down', button: 'left' });
        s.down = true;
      }

      if (s.down && !pinching) {
        commands.push({ type: 'up', button: 'left' });
        s.down = false;
      }

      if (!pinching && !pinchClosing) {

        // Pinch released: keep the cursor where it is and blend back
        s.latched = false;
        s.dragStarted = false;
        s.offset = { x: s.cursor.x - mapped.x, y: s.cursor.y - mapped.y };
        s.lastOffsetTime = now;
      }
    }

    if (s.latched) {

      const r = cfg.region;

      const dx = -(hand.indexBase.x - s.ref.x) / (r.x1 - r.x0);
      const dy = (hand.indexBase.y - s.ref.y) / (r.y1 - r.y0);

      if (!s.dragStarted && Math.hypot(dx, dy) > cfg.dragDeadzone) {
        s.dragStarted = true;
      }

      target = s.dragStarted
        ? { x: clamp(s.base.x + dx, 0, 1), y: clamp(s.base.y + dy, 0, 1) }
        : { x: s.base.x, y: s.base.y };

      s.mode = s.down ? 'DRAG' : 'CLICK';

    } else {

      // Offset left over from a drag fades out smoothly
      const dt = Math.max((now - s.lastOffsetTime) / 1000, 0);
      const keep = Math.exp(-dt / 0.4);

      s.offset.x *= keep;
      s.offset.y *= keep;
      s.lastOffsetTime = now;

      target = {
        x: clamp(mapped.x + s.offset.x, 0, 1),
        y: clamp(mapped.y + s.offset.y, 0, 1)
      };

      s.mode = 'POINT';
    }

    const x = fx.filter(target.x, now);
    const y = fy.filter(target.y, now);

    s.cursor = { x, y };

    if (
      now - s.lastMove.t >= cfg.moveIntervalMs &&
      (Math.abs(x - s.lastMove.x) > cfg.moveMinDelta ||
        Math.abs(y - s.lastMove.y) > cfg.moveMinDelta)
    ) {
      commands.push({ type: 'move', x, y });
      s.lastMove = { x, y, t: now };
    }
  }

  // ------------------------------------------------------------------
  // dial hand
  // ------------------------------------------------------------------

  function updateDialHand(hand, now, commands) {

    // Switch knob with two fingers (once per gesture)
    const two = hand.pose === 'TWO_FINGERS';

    if (two && !s.prevDialTwo && now - s.lastSwitch > cfg.switchCooldownMs) {
      s.dial = s.dial === 'volume' ? 'brightness' : 'volume';
      s.lastSwitch = now;
      s.dialLevel = null;
    }

    s.prevDialTwo = two;

    // Pinch and move up / down = turn the knob (relative, no jumps)
    if (hand.pose === 'PINCH') {

      if (!s.dialEngaged) {
        s.dialEngaged = true;
        s.dialRefY = hand.palm.y;
        s.dialStart = currentLevel(s.dial);
        s.lastDialSend = { t: -1e9, value: null };
      }

      const level = clamp(
        s.dialStart + (s.dialRefY - hand.palm.y) * cfg.dialGain,
        0,
        100
      );

      s.dialLevel = level;

      const rounded = Math.round(level);

      if (
        rounded !== s.lastDialSend.value &&
        now - s.lastDialSend.t >= cfg.dialSendIntervalMs
      ) {
        commands.push({ type: s.dial, level: rounded });
        s.lastDialSend = { t: now, value: rounded };
      }

    } else {

      s.dialEngaged = false;
    }

    // Fist held = mute
    if (hand.pose === 'FIST') {

      if (s.fistSince === null) {
        s.fistSince = now;
      } else if (
        !s.muteFired &&
        now - s.fistSince >= cfg.muteHoldMs &&
        now - s.lastMute > cfg.muteCooldownMs
      ) {
        commands.push({ type: 'mute' });
        s.muteFired = true;
        s.lastMute = now;
      }

    } else {

      s.fistSince = null;
      s.muteFired = false;
    }
  }

  // ------------------------------------------------------------------
  // public API
  // ------------------------------------------------------------------

  function update(frame, now = performance.now()) {

    const commands = [];

    if (!enabled) {
      return { commands, hud: { active: false } };
    }

    const hands = (frame && frame.hands ? frame.hands : []).filter(
      (h) => h.analysis && h.indexTip && h.indexBase && h.fingerTip && h.palm
    );

    if (hands.length === 0) {

      if (now - s.lastSeen > cfg.handLostMs) {

        releaseButtons(commands);

        s.mode = 'IDLE';
        s.dialEngaged = false;
        s.scrollPrevY = null;
        s.fistSince = null;
      }

      return { commands, hud: makeHud(now, 0) };
    }

    s.lastSeen = now;

    // Roles by on-screen position (the video is mirrored: screen x = 1 - x)
    let cursorHand = hands[0];
    let dialHand = null;

    if (hands.length >= 2) {

      const sorted = [...hands].sort((p, q) => (1 - p.palm.x) - (1 - q.palm.x));

      cursorHand = cfg.cursorHand === 'right' ? sorted[sorted.length - 1] : sorted[0];
      dialHand = cursorHand === sorted[0] ? sorted[sorted.length - 1] : sorted[0];
    }

    updateCursorHand(cursorHand, now, commands);

    if (dialHand) {
      updateDialHand(dialHand, now, commands);
    } else {
      s.dialEngaged = false;
      s.fistSince = null;
      s.prevDialTwo = false;
    }

    return { commands, hud: makeHud(now, hands.length) };
  }

  function makeHud(now, handCount) {

    const known = getState() || {};

    return {
      active: true,
      handCount,
      cursorMode: s.mode,
      cursor: { ...s.cursor },
      down: s.down,
      dial: s.dial,
      dialEngaged: s.dialEngaged,
      dialLevel: s.dialLevel,
      volume: known.volume ?? null,
      brightness: known.brightness ?? null,
      muted: known.muted ?? null,
      idleMs: handCount === 0 ? now - s.lastSeen : 0,
      idleDisableMs: cfg.idleDisableMs
    };
  }

  /** Turning it off releases the mouse button; the caller must send the result. */
  function setEnabled(on, now = performance.now()) {

    const commands = [];

    if (on === enabled) return commands;

    if (!on) releaseButtons(commands);

    enabled = on;

    fx.reset();
    fy.reset();

    s.mode = 'IDLE';
    s.lastSeen = now;
    s.dialEngaged = false;
    s.dialLevel = null;
    s.scrollPrevY = null;
    s.prevContact = false;
    s.fistSince = null;
    s.offset = { x: 0, y: 0 };

    return commands;
  }

  function isEnabled() {
    return enabled;
  }

  return { update, setEnabled, isEnabled, config: cfg };
}