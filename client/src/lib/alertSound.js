/**
 * Synthesises a short two-note rising chime using the Web Audio API.
 * No audio file required — the sound is generated in the browser.
 *
 * Browser autoplay policy: browsers block AudioContext.resume() until the
 * user has interacted with the page (click, keydown, etc.).  We track that
 * flag ourselves so we never call play() before it's safe.
 *
 * Fails silently in every error path so it never breaks the UI.
 */

let _ctx    = null;   // shared AudioContext — created once
let _ready  = false;  // true after first user interaction

/* ─── Listen for first user interaction ───────────────────────── */

function markReady() {
  _ready = true;
  // Resume a suspended context that was created before interaction
  if (_ctx && _ctx.state === "suspended") {
    _ctx.resume().catch(() => {});
  }
}

if (typeof window !== "undefined") {
  const EVENTS = ["click", "keydown", "pointerdown", "touchstart"];
  const once   = () => { markReady(); EVENTS.forEach(e => window.removeEventListener(e, once)); };
  EVENTS.forEach(e => window.addEventListener(e, once, { passive: true, capture: true }));
}

/* ─── Audio context (lazy, singleton) ─────────────────────────── */

function getCtx() {
  if (_ctx) return _ctx;
  try {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ready && _ctx.state === "suspended") _ctx.resume().catch(() => {});
  } catch {
    _ctx = null;
  }
  return _ctx;
}

/* ─── Tone helper ──────────────────────────────────────────────── */

function playTone(ctx, freq, startAt, duration, gainPeak = 0.18) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type      = "sine";
  osc.frequency.setValueAtTime(freq, startAt);

  // Quick attack, smooth decay
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

/* ─── Public API ───────────────────────────────────────────────── */

/**
 * Play a short rising chime (two notes: A5 → D6).
 * Safe to call at any time — returns immediately if audio is unavailable.
 */
export function playAlertSound() {
  if (!_ready) return;            // no interaction yet — browser would block
  const ctx = getCtx();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t = ctx.currentTime;
    playTone(ctx, 880,  t,        0.18);   // A5 — first note
    playTone(ctx, 1175, t + 0.13, 0.28);   // D6 — second note (slightly louder tail)
  } catch {
    // Blocked or unavailable — fail silently
  }
}
