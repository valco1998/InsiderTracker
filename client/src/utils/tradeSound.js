let lastPlayed = 0;

export function playTradeNotification() {
  const now = Date.now();
  if (now - lastPlayed < 2000) return; // debounce — max once per 2s
  lastPlayed = now;

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    function note(freq, startT, dur, vol = 0.22) {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, startT);
      gain.gain.linearRampToValueAtTime(vol, startT + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startT + dur);
      osc.start(startT);
      osc.stop(startT + dur + 0.01);
    }

    const t = ctx.currentTime;
    note(880, t,        0.18, 0.18);
    note(1100, t + 0.1, 0.22, 0.14);
  } catch {
    /* AudioContext not available — silent fail */
  }
}
