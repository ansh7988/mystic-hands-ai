/*
  MYSTIC HANDS AI
  Circle (sling ring) gesture detector

  While a hand holds the TWO_FINGERS pose, the fingertip path is recorded.
  When the path forms a closed, roughly circular loop the detector emits
  CIRCLE_COMPLETE, which opens a portal.

  Coordinates are aspect-corrected (x * aspect, y) so a circle drawn on
  screen is a circle in the maths. Events report centre in normalised
  image coordinates and radius in "frame heights".

  Events: CIRCLE_START, CIRCLE_CANCEL, CIRCLE_COMPLETE

  CIRCLE_COMPLETE carries anchor = { handId, palm } when the other hand holds
  an open palm (two-handed mandala spell), otherwise anchor = null.
*/

export const CIRCLE_CONFIG = {

  smoothing: 0.6,          // fingertip smoothing (1 = raw)
  minStep: 0.006,          // ignore jitter smaller than this (frame heights)
  windowMs: 2800,          // only the most recent path counts
  maxPoints: 160,

  minPoints: 12,
  minPathLength: 0.25,     // frame heights
  minRadius: 0.05,
  maxRadius: 0.40,
  maxRelativeError: 0.30,  // mean |distance - radius| / radius
  completeSweep: 5.5,      // radians (about 315 degrees)
  progressErrorLimit: 0.40,

  // Path starts to try: the full stroke, or only its latest 80% / 60%.
  // This lets a leading straight "wind-up" be ignored.
  startFractions: [0, 0.2, 0.4],

  cooldownMs: 1200,
  endGraceMs: 250,         // pose may flicker this long without ending the stroke
  minCancelPoints: 8
};

// Least-squares circle fit (Kasa method) on centred coordinates
function fitCircle(points) {

  const n = points.length;

  let mx = 0;
  let my = 0;

  for (const p of points) {
    mx += p.x;
    my += p.y;
  }

  mx /= n;
  my /= n;

  let suu = 0;
  let svv = 0;
  let suv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;

  for (const p of points) {

    const u = p.x - mx;
    const v = p.y - my;

    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }

  const det = suu * svv - suv * suv;

  if (Math.abs(det) < 1e-12) return null;

  const b1 = 0.5 * (suuu + suvv);
  const b2 = 0.5 * (svvv + svuu);

  const uc = (b1 * svv - b2 * suv) / det;
  const vc = (b2 * suu - b1 * suv) / det;

  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);

  return { cx: mx + uc, cy: my + vc, r };
}

function evaluate(points, cfg) {

  if (points.length < cfg.minPoints) return null;

  let length = 0;

  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y
    );
  }

  if (length < cfg.minPathLength) return null;

  const fit = fitCircle(points);

  if (!fit) return null;
  if (fit.r < cfg.minRadius || fit.r > cfg.maxRadius) return null;

  let error = 0;

  for (const p of points) {
    error += Math.abs(Math.hypot(p.x - fit.cx, p.y - fit.cy) - fit.r);
  }

  const relativeError = error / points.length / fit.r;

  // Signed angle swept around the fitted centre
  let sweep = 0;
  let prev = Math.atan2(points[0].y - fit.cy, points[0].x - fit.cx);

  for (let i = 1; i < points.length; i++) {

    const a = Math.atan2(points[i].y - fit.cy, points[i].x - fit.cx);

    let d = a - prev;

    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;

    sweep += d;
    prev = a;
  }

  return {
    cx: fit.cx,
    cy: fit.cy,
    r: fit.r,
    relativeError,
    sweep,
    length
  };
}

export function createCircleDetector(overrides = {}) {

  const cfg = { ...CIRCLE_CONFIG, ...overrides };

  let strokes = new Map();
  let lastCompleteAt = -Infinity;

  function newStroke() {
    return {
      active: false,
      points: [],
      smooth: null,
      speed: 0,
      progress: 0,
      cooldownUntil: 0,
      lastPoseTime: 0,
      lastSeen: 0
    };
  }

  function endStroke(id, stroke, now, events, reason) {

    if (stroke.active && stroke.points.length >= cfg.minCancelPoints) {
      events.push({ type: 'CIRCLE_CANCEL', time: now, handId: id, reason });
    }

    stroke.active = false;
    stroke.points = [];
    stroke.smooth = null;
    stroke.progress = 0;
    stroke.speed = 0;
  }

  /**
   * @param {Array}  hands  gestureFrame.hands (needs id, pose, fingerTip)
   * @param {number} now    ms
   * @param {number} aspect video width / height
   */
  function update(hands = [], now = performance.now(), aspect = 1) {

    const events = [];
    const seen = new Set();
    const active = [];

    for (const hand of hands) {

      seen.add(hand.id);

      let stroke = strokes.get(hand.id);

      if (!stroke) {
        stroke = newStroke();
        strokes.set(hand.id, stroke);
      }

      stroke.lastSeen = now;

      const drawing = hand.pose === 'TWO_FINGERS' && hand.fingerTip;

      if (drawing) {
        stroke.lastPoseTime = now;
      }

      const poseAlive =
        drawing || (stroke.active && now - stroke.lastPoseTime <= cfg.endGraceMs);

      if (!poseAlive) {

        if (stroke.active) {
          endStroke(hand.id, stroke, now, events, 'pose_lost');
        }

        continue;
      }

      if (!drawing) {
        // Inside the grace period: keep the stroke, add no points
        active.push({ id: hand.id, stroke });
        continue;
      }

      const raw = {
        x: hand.fingerTip.x * aspect,
        y: hand.fingerTip.y
      };

      if (!stroke.smooth) {

        stroke.smooth = { x: raw.x, y: raw.y, t: now };

      } else {

        const prev = stroke.smooth;

        const next = {
          x: prev.x + (raw.x - prev.x) * cfg.smoothing,
          y: prev.y + (raw.y - prev.y) * cfg.smoothing,
          t: now
        };

        const dt = Math.max((now - prev.t) / 1000, 0.001);

        stroke.speed = Math.hypot(next.x - prev.x, next.y - prev.y) / dt;

        stroke.smooth = next;
      }

      if (!stroke.active) {

        stroke.active = true;
        stroke.points = [];

        events.push({ type: 'CIRCLE_START', time: now, handId: hand.id });
      }

      const last = stroke.points[stroke.points.length - 1];

      if (
        !last ||
        Math.hypot(stroke.smooth.x - last.x, stroke.smooth.y - last.y) >= cfg.minStep
      ) {

        stroke.points.push({
          x: stroke.smooth.x,
          y: stroke.smooth.y,
          t: now
        });
      }

      // Keep only the recent path
      while (
        stroke.points.length > 0 &&
        (now - stroke.points[0].t > cfg.windowMs ||
          stroke.points.length > cfg.maxPoints)
      ) {
        stroke.points.shift();
      }

      // ---------- look for a circle ----------
      let best = null;

      for (const fraction of cfg.startFractions) {

        const start = Math.floor(stroke.points.length * fraction);
        const result = evaluate(stroke.points.slice(start), cfg);

        if (!result) continue;

        if (
          result.relativeError <= cfg.maxRelativeError &&
          Math.abs(result.sweep) >= cfg.completeSweep
        ) {
          best = { ...result, complete: true };
          break;
        }

        if (
          !best &&
          result.relativeError <= cfg.progressErrorLimit
        ) {
          best = { ...result, complete: false };
        }
      }

      stroke.progress = best
        ? Math.min(1, Math.abs(best.sweep) / (Math.PI * 2))
        : 0;

      if (best && best.complete && now >= stroke.cooldownUntil) {

        // Two-handed spell: another hand holding an open palm anchors it
        const anchorHand = hands.find(
          (h) =>
            h.id !== hand.id &&
            h.pose === 'OPEN' &&
            h.mode !== 'CHARGING' &&
            h.palm
        );

        events.push({
          type: 'CIRCLE_COMPLETE',
          time: now,
          handId: hand.id,
          center: { x: best.cx / aspect, y: best.cy },
          radius: best.r,
          direction: best.sweep > 0 ? 1 : -1,
          anchor: anchorHand
            ? { handId: anchorHand.id, palm: { ...anchorHand.palm } }
            : null
        });

        lastCompleteAt = now;

        stroke.cooldownUntil = now + cfg.cooldownMs;
        stroke.points = [];
        stroke.progress = 0;
      }

      active.push({ id: hand.id, stroke });
    }

    // Hands that disappeared
    for (const [id, stroke] of strokes) {

      if (seen.has(id)) continue;

      if (stroke.active && now - stroke.lastSeen > cfg.endGraceMs) {
        endStroke(id, stroke, now, events, 'hand_lost');
      }

      if (now - stroke.lastSeen > 1500) {
        strokes.delete(id);
      }
    }

    const summary = active
      .filter((a) => a.stroke.smooth)
      .map((a) => ({
        handId: a.id,
        tip: {
          x: a.stroke.smooth.x / aspect,
          y: a.stroke.smooth.y
        },
        speed: a.stroke.speed,
        progress: a.stroke.progress
      }));

    return {
      events,
      strokes: summary,
      drawing: summary.length > 0,
      progress: summary.reduce((m, s) => Math.max(m, s.progress), 0),
      portalRecent: now - lastCompleteAt < 1200
    };
  }

  function reset() {
    strokes = new Map();
    lastCompleteAt = -Infinity;
  }

  return { update, reset, config: cfg };
}