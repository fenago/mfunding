// Call/Transfer-quality classifier — the owner's taxonomy, focused on the FIRST
// 60-90 seconds of the call ("that tells the story"). Pure function, no I/O, so it
// can be unit-checked (see the deno-test block at the bottom of the sweep) and reused
// by the cron and the manual path identically.
//
// Taxonomy (see the team-lead spec):
//   missed_transfer_voicemail — the paid transfer rang to OUR voicemail (our greeting
//        with our number 954-439-1163 / "can't take your call" is in the transcript).
//   answered_then_kicked      — HEADLINE FAILURE. A conference "kicked/disconnected/
//        removed" message in the first ~90s with no goodbye before it: we answered and
//        were immediately dumped out of the conference (the owner's Jul 22-24 incident).
//   mid_call_drop             — a kick AFTER 90s with no goodbye cue just before it.
//   end_teardown_cosmetic     — a kick right after a goodbye ("thanks, bye") — the
//        normal conference teardown, not a failure.
//   clean                     — no kick / voicemail language.
//   no_recording              — the call had no downloadable recording.
//   transcription_failed      — a recording existed but could not be transcribed.
//   suspected_instant_drop    — metadata-only fallback: completed call < 15s.
//   short_call_unverified     — metadata-only fallback: 15-90s, no transcript.

export type CallClass =
  | "missed_transfer_voicemail"
  | "answered_then_kicked"
  | "mid_call_drop"
  | "end_teardown_cosmetic"
  | "clean"
  | "no_recording"
  | "transcription_failed"
  | "suspected_instant_drop"
  | "short_call_unverified";

export interface ClassifyInput {
  hasRecording: boolean;
  transcript: string | null;
  durationS: number | null;
  /** true when a recording existed but transcription was attempted and failed / was
   *  skipped (no key, too large). Drives the metadata-only fallback. */
  transcriptionFailed?: boolean;
}

export interface ClassifyResult {
  classification: CallClass;
  matchedQuote: string | null;
  kickOffsetHint: string | null;
}

// The kick is garble-tolerant: transcribers mangle "conference" and the verb, so we
// require the noun (confe?re?nce) AND a nearby teardown verb, rather than an exact
// phrase. "you have been kicked from this conference" and its garbled cousins all hit.
const CONFERENCE_RE = /conferen?ce|confe?rance|confrence|conferrence/i;
const KICK_VERB_RE = /(kick|disconnec|remov|eject|drop)/i;

// OUR voicemail greeting. The number is the strongest signal (digits survive garbling);
// the phrase is the backup ("can't take your call now" → whisper heard "column").
const OUR_VM_NUMBER = "9544391163";
const OUR_VM_PHRASE_RE = /can'?\s?t take your (call|colum|column)|can ?not take your call/i;

// Goodbye cues that make a teardown cosmetic when they sit just before the kick.
const GOODBYE_RE =
  /(thank you|thanks|good ?bye|\bbye\b|call you|have a (nice|good|great)|talk (to you|soon|later)|take care|appreciate (it|your)|reach out|follow ?up|we'?ll be in touch)/i;

const WITHIN_OPENING_SECS = 90;

function quoteWindow(text: string, idx: number, span = 90): string {
  const start = Math.max(0, idx - span);
  const end = Math.min(text.length, idx + span);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

function findKick(norm: string): number {
  const conf = norm.search(CONFERENCE_RE);
  if (conf < 0) return -1;
  // Require a teardown verb somewhere within ~60 chars around the conference token.
  const around = norm.slice(Math.max(0, conf - 60), conf + 60);
  return KICK_VERB_RE.test(around) ? conf : -1;
}

function voicemailIndex(norm: string, digitsOnly: string): number {
  if (digitsOnly.includes(OUR_VM_NUMBER)) {
    // Point the quote at the phrase if present, else the start.
    const p = norm.search(OUR_VM_PHRASE_RE);
    return p >= 0 ? p : 0;
  }
  const p = norm.search(OUR_VM_PHRASE_RE);
  return p;
}

export function classifyCall(input: ClassifyInput): ClassifyResult {
  const dur = input.durationS ?? 0;

  if (!input.hasRecording) {
    return { classification: "no_recording", matchedQuote: null, kickOffsetHint: null };
  }

  const t = (input.transcript ?? "").trim();
  const noText = input.transcriptionFailed || t.length < 2;
  if (noText) {
    // Metadata-only fallback — never silently drop the call.
    if (dur > 0 && dur < 15) {
      return { classification: "suspected_instant_drop", matchedQuote: null, kickOffsetHint: `call ${dur}s` };
    }
    if (dur > 0 && dur <= WITHIN_OPENING_SECS) {
      return { classification: "short_call_unverified", matchedQuote: null, kickOffsetHint: `call ${dur}s` };
    }
    return { classification: "transcription_failed", matchedQuote: null, kickOffsetHint: dur ? `call ${dur}s` : null };
  }

  const norm = t.toLowerCase();
  const digitsOnly = norm.replace(/\D/g, "");

  // Voicemail first — a transfer that hit our machine never became a conversation.
  const vmIdx = voicemailIndex(norm, digitsOnly);
  if (vmIdx >= 0) {
    return {
      classification: "missed_transfer_voicemail",
      matchedQuote: quoteWindow(t, vmIdx),
      kickOffsetHint: null,
    };
  }

  const kickIdx = findKick(norm);
  if (kickIdx >= 0) {
    const frac = norm.length > 0 ? kickIdx / norm.length : 0;
    const estOffset = dur > 0 ? Math.round(frac * dur) : null;
    // A goodbye sitting in the ~160 chars before the kick = normal teardown.
    const pre = norm.slice(Math.max(0, kickIdx - 160), kickIdx);
    const hasGoodbye = GOODBYE_RE.test(pre);
    const hint = estOffset != null
      ? `~${estOffset}s in (${Math.round(frac * 100)}% of transcript, call ${dur}s)`
      : (dur ? `call ${dur}s` : null);

    if (hasGoodbye) {
      return { classification: "end_teardown_cosmetic", matchedQuote: quoteWindow(t, kickIdx), kickOffsetHint: hint };
    }
    // No goodbye. If the kick lands in the opening (short call, or estimated < 90s in),
    // it's the owner's answered-then-kicked failure; otherwise a mid-call drop.
    const inOpening = dur === 0 || dur < WITHIN_OPENING_SECS || (estOffset != null && estOffset < WITHIN_OPENING_SECS);
    return {
      classification: inOpening ? "answered_then_kicked" : "mid_call_drop",
      matchedQuote: quoteWindow(t, kickIdx),
      kickOffsetHint: hint,
    };
  }

  return { classification: "clean", matchedQuote: null, kickOffsetHint: null };
}

// Human-readable labels + whether a class is a FAILURE (for the UI rollups). Kept
// server-side-adjacent so the taxonomy has one home; the UI re-declares its own chips.
export const CALL_CLASS_LABELS: Record<CallClass, string> = {
  missed_transfer_voicemail: "Missed → our voicemail",
  answered_then_kicked: "Answered then kicked",
  mid_call_drop: "Mid-call drop",
  end_teardown_cosmetic: "Teardown (cosmetic)",
  clean: "Clean",
  no_recording: "No recording",
  transcription_failed: "Transcription failed",
  suspected_instant_drop: "Suspected instant drop",
  short_call_unverified: "Short call (unverified)",
};
