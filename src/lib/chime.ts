// chime — the corner-alert sounds, generated in code (no audio assets).
//
// Extracted from useNewLeadAlert so a second alert stream (the signed-application
// alert) can sound DIFFERENT without copying the WebAudio plumbing. The floor
// works by ear: a closer should know which of these fired without looking up.
//
//   newLead  ding-ding, rising     — a live transfer / real-time lead, act now
//   match    one high ding         — a vendor email merged into an existing deal
//   signed   three-note rise, warm — the merchant signed their APPLICATION
//
// A fresh AudioContext per chime, closed once it finishes, so we never leak
// contexts. Everything is wrapped in try/catch: if the browser blocks audio the
// visual alert is still the real signal.

function playTones(tones: { freq: number; at: number; dur: number }[]) {
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const start = ctx.currentTime;
    let end = 0;
    for (const t of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = t.freq;
      const t0 = start + t.at;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + t.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + t.dur + 0.02);
      end = Math.max(end, t.at + t.dur);
    }
    setTimeout(() => ctx.close().catch(() => {}), (end + 0.2) * 1000);
  } catch {
    /* audio unavailable — the alert carries itself */
  }
}

/** New lead: two rising beeps ("ding-ding"). */
export const playNewLeadChime = () =>
  playTones([
    { freq: 660, at: 0, dur: 0.16 },
    { freq: 990, at: 0.18, dur: 0.16 },
  ]);

/** Vendor email matched: ONE clean high ding — audibly not a new lead. */
export const playMatchChime = () => playTones([{ freq: 1175, at: 0, dur: 0.32 }]);

/**
 * Application signed: a warm three-note rise (C–E–G), longer and softer than the
 * lead chimes. This is GOOD NEWS, not an emergency — it must never be mistaken
 * for the live-transfer ding that means someone is on the phone right now.
 */
export const playSignedChime = () =>
  playTones([
    { freq: 523.25, at: 0, dur: 0.18 },
    { freq: 659.25, at: 0.16, dur: 0.18 },
    { freq: 783.99, at: 0.32, dur: 0.34 },
  ]);
