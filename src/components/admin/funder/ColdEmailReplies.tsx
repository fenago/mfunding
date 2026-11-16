// ─────────────────────────────────────────────────────────────────────────────
// Cold-email & funnel replies — what a setter does when a Momentum Micro
// merchant writes back or fills the funnel form
//
// Lives on the Bitty playbook tab because Bitty is the funder behind Momentum
// Micro, but EVERY word a setter copies out of here goes to the merchant — so
// the merchant-facing strings obey three rules:
//
//   1. The funder is never named. Bitty may market to merchants directly
//      (Referral Agreement §4), so naming them hands the merchant a way around
//      us. The merchant hears "Momentum Funding" and "the funder".
//   2. MCA vocabulary only: advance, working capital, funding. Never "loan",
//      never "approved / pre-approved / guaranteed", no amount or rate promised
//      before the application and statements are in.
//   3. Buttons named here are the real buttons — "Fill out application",
//      "Send to merchant to e-sign", "Log the call", "🚫 Add to DND". If one is
//      renamed, this text is stale and stale step text is a bug.
//
// Styling: every class is `fp-cr-` prefixed and every colour is a `.fcs` token,
// for the same two reasons spelled out at the top of ./playbook.tsx (unlayered
// CSS outranks Tailwind; `.dark .fcs` redefines the tokens for dark mode).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Alert, type CheckItem, Checklist, Rows } from "./playbook";
import { BITTY_PROHIBITED as PROHIBITED } from "./bittyIndustries";

const CSS = `
.fcs .fp-cr-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 2px}
.fcs .fp-cr-chip{font-size:12px;font-weight:700;background:var(--chip);color:var(--chip-ink);
  border:1px solid var(--line);border-radius:999px;padding:3px 10px}
.fcs .fp-cr-chip.go{background:var(--a-bg);color:var(--a);border-color:var(--a)}
.fcs .fp-cr-chip code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:11.5px}
.fcs .fp-cr-h{font-size:12px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;
  color:var(--ink-faint);margin:16px 0 8px}
.fcs .fp-cr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.fcs .fp-cr-card{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);
  box-shadow:var(--shadow);display:flex;flex-direction:column;min-width:0}
.fcs .fp-cr-top{display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:10px 14px;border-bottom:1px solid var(--line-soft)}
.fcs .fp-cr-when{font-size:13.5px;font-weight:800;color:var(--ink)}
.fcs .fp-cr-copy{font:inherit;font-size:12px;font-weight:700;border:1px solid var(--line);
  background:var(--chip);color:var(--ink);border-radius:999px;padding:4px 12px;cursor:pointer;white-space:nowrap}
.fcs .fp-cr-copy:hover{border-color:var(--accent);color:var(--accent-ink)}
.fcs .fp-cr-copy:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.fcs .fp-cr-copy.done{background:var(--a-bg);color:var(--a);border-color:var(--a)}
.fcs .fp-cr-copy.fail{background:var(--d-bg);color:var(--d);border-color:var(--d)}
.fcs .fp-cr-text{margin:0;padding:12px 14px;font-size:13.5px;line-height:1.6;color:var(--ink);
  white-space:pre-wrap;user-select:all;flex:1 1 auto}
.fcs .fp-cr-do{padding:9px 14px 11px;border-top:1px solid var(--line-soft);background:var(--line-soft);
  font-size:12.5px;line-height:1.5;color:var(--ink-soft);border-radius:0 0 var(--radius) var(--radius)}
.fcs .fp-cr-do b{color:var(--ink);font-weight:800}
.fcs .fp-cr-steps{margin:0;padding:14px 16px 14px 34px;font-size:13.5px;line-height:1.6;color:var(--ink-soft)}
.fcs .fp-cr-steps li{margin-bottom:7px}
.fcs .fp-cr-steps li:last-child{margin-bottom:0}
.fcs .fp-cr-steps b{color:var(--ink);font-weight:800}
.fcs .fp-cr-btn{display:inline-block;font-weight:800;color:var(--accent-ink);background:var(--chip);
  border:1px solid var(--line);border-radius:6px;padding:0 6px;white-space:nowrap}
.fcs .fp-cr-rule{margin:4px 0 0;padding:0 0 0 18px;font-size:13.5px;line-height:1.6;color:var(--ink)}
.fcs .fp-cr-rule li{margin-bottom:4px}
.fcs .fp-cr-rule b{font-weight:800}
`;

// ── merchant-facing replies ──────────────────────────────────────────────────
// Short and human. [Brackets] are the only things the setter changes.
type Reply = { id: string; when: string; text: string; then: ReactNode };

const REPLIES: Reply[] = [
  {
    id: "yes",
    when: "“Interested” / “Yes” / “Tell me more”",
    text:
      "Hi [First name], thanks for getting back to me. I'm [Your name] with Momentum Funding — I just tried calling you.\n\n" +
      "We fill out the application together on the phone — it takes about 10 minutes — and then all we need is your last 3–4 months of business bank statements.\n\n" +
      "What's the best number and time to reach you? I'll call you right back.",
    then: (
      <>
        <b>Call first.</b> Send this only if the call went to voicemail — then try again within the hour.
      </>
    ),
  },
  {
    id: "howmuch",
    when: "“How much can I get?” / “What's the rate?”",
    text:
      "Fair question. Honestly, the amount and the cost both depend on your application and what your last few months of bank statements show, so I can't give you a number until we've seen those — anyone who quotes you one before that is guessing.\n\n" +
      "What I can tell you: this program runs from $2,000 to $100,000, there are no upfront fees, and filling out the application with us doesn't touch your credit.\n\n" +
      "Want to do the application together now? It takes about 10 minutes.",
    then: (
      <>
        <b>Never give a number</b> — not a ballpark, not a factor, not “most people get…”. The range is the only
        figure you may say.
      </>
    ),
  },
  {
    id: "later",
    when: "“Not right now”",
    text:
      "No problem at all, [First name]. When would be a better time to check back — a few weeks, a couple of months?\n\n" +
      "I'll make a note and reach out then. If anything changes before that, just reply here.",
    then: (
      <>
        <b>Set the reminder before you close the tab:</b> <span className="fp-cr-btn">Log the call</span> on the
        deal, with a callback on the date they named. No date given → callback in 30 days. Do not mark it lost.
      </>
    ),
  },
  {
    id: "remove",
    when: "“Remove me” / “Stop” / “Unsubscribe”",
    text: "Understood — you've been removed and you won't hear from us again. Sorry for the bother.",
    then: (
      <>
        <b>Do this first, then send the line above:</b> <span className="fp-cr-btn">🚫 Add to DND</span> on the deal
        (tap it twice — the second tap confirms). <b>No argument, no “are you sure”, no second message.</b> If they
        said it angrily, skip the reply and just set DND.
      </>
    ),
  },
  {
    id: "who",
    when: "“Wrong person” / “Who is this?”",
    text:
      "Sorry about that. I'm [Your name] with Momentum Funding — we help small businesses get working capital. I reached out because [Business name] looked like it might be a fit.\n\n" +
      "If you're not the owner, could you point me to the right person? And if you'd rather not hear from us, just say so and I'll take you off the list.",
    then: (
      <>
        <b>They name the owner</b> → update the contact and reach out to that person. <b>They say stop</b> → it is a
        Remove me: <span className="fp-cr-btn">🚫 Add to DND</span>.
      </>
    ),
  },
];

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
    setState(ok ? "done" : "fail");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), ok ? 1800 : 4000);
  };

  return (
    <button type="button" className={`fp-cr-copy${state === "idle" ? "" : ` ${state}`}`} onClick={copy}>
      {state === "done" ? "Copied ✓" : state === "fail" ? "Copy blocked — select the text" : "Copy"}
    </button>
  );
}

// ── qualification — Bitty's numbers, printed in full ─────────────────────────
// Each `why` carries the fallback line, read from src/components/admin/products/
// lines.ts — so a merchant who fails Bitty is routed, not dropped.
const G = "Qualify on the call — then fill the application";
const QUALIFY: CheckItem[] = [
  {
    id: "cr-tib",
    group: G,
    label: "12+ months in business",
    hard: true,
    why: (
      <>
        Under 12 months is not a Micro file. <b>Fails → Bridge</b> (3+ months at LCF, 5+ through Quick Fix, 8+ at
        Lendini), or <b>Working Capital</b> at 6+ months if the statements are clean.
      </>
    ),
  },
  {
    id: "cr-rev",
    group: G,
    label: "$5,000+/mo in revenue — $15,000+/mo for the best tiers",
    hard: true,
    why: (
      <>
        <b>Fails → Working Capital</b> (Reliant's floor is $4,000/mo with 6+ months). A 1099 / self-employed
        merchant below that → <b>Gig</b> (up to $15,000, personal bank account accepted).
      </>
    ),
  },
  {
    id: "cr-fico",
    group: G,
    label: "Owner FICO 500 or better — 675+ gets the best pricing — and no open bankruptcy",
    hard: true,
    why: (
      <>
        Below 500 is an automatic decline here. <b>Fails → Working Capital</b> (Reliant publishes no FICO floor) or{" "}
        <b>Bridge</b> (LCF publishes no FICO minimum).
      </>
    ),
  },
  {
    id: "cr-neg",
    group: G,
    label: "Fewer than 19 negative-balance days in the last 3 months",
    hard: true,
    why: (
      <>
        Ask now, verify in the statements later. <b>Fails → Bridge</b>, the line built for imperfect statements.
        Already stacked and being drained by daily debits → <b>Debt Relief</b> (work the file; never text about it).
      </>
    ),
  },
  {
    id: "cr-ind",
    group: G,
    label: "Industry is NOT one of these 14",
    hard: true,
    why: (
      <>
        <b>{PROHIBITED.join(" · ")}</b>. <b>Fails → Bridge</b> — LCF looks at every industry.
      </>
    ),
  },
  {
    id: "cr-amt",
    group: G,
    label: "They need $2,000 – $100,000",
    hard: true,
    why: (
      <>
        <b>Needs more → Working Capital</b> ($10K–$2M, clean statements) or <b>Bridge</b> (up to $300K).
      </>
    ),
  },
];

export function ColdEmailReplies() {
  return (
    <>
      <style>{CSS}</style>

      {/* 1 — speed + where they are */}
      <Alert tone="stop" title="Call within 5 minutes of the reply or form fill">
        <p>
          They answered <b>us</b>. Every minute after the first five, the odds they pick up drop. <b>Call first</b>;
          reply in writing only if the call goes to voicemail or they asked for email.
        </p>
        <p>
          <b>Find them:</b> VibeReach → <b>Opportunities</b> → MCA pipeline → <b>Source</b> filter. Each one also
          arrives with a GHL task.
        </p>
        <div className="fp-cr-chips">
          <span className="fp-cr-chip go">
            Replied to the email · Source “Cold Email – Micro” · tag <code>cold-email-replied</code>
          </span>
          <span className="fp-cr-chip go">
            Filled the form · Source “Funnel – Micro” · tag <code>micro-form</code>
          </span>
        </div>
        <p style={{ marginTop: 8 }}>
          Dial from WAVV, then open the merchant in the <b>Revenue Playbook</b>.
        </p>
      </Alert>

      {/* 2 — what the email said */}
      <div className="fp-cr-h">What the email promised them — stay inside it</div>
      <div className="fp-cr-chips">
        <span className="fp-cr-chip">$2,000 – $100,000</span>
        <span className="fp-cr-chip">Open at least a year</span>
        <span className="fp-cr-chip">One application</span>
        <span className="fp-cr-chip">Last 3–4 months of bank statements</span>
        <span className="fp-cr-chip">Credit doesn't have to be perfect</span>
        <span className="fp-cr-chip">No upfront fees — the funder pays us</span>
        <span className="fp-cr-chip">Brand: Momentum Micro / Momentum Funding</span>
      </div>
      <Alert tone="warn" title="Never name the funder to the merchant">
        <p>
          Say <b>“the funder”</b>, never <b>Bitty</b>. Bitty can market to merchants directly, so the name hands the
          merchant a way around us. That goes for calls, emails and notes they could see.
        </p>
      </Alert>

      {/* 3 — replies */}
      <div className="fp-cr-h">Replies — copy, fill the [brackets], send in the same email thread</div>
      <div className="fp-cr-grid">
        {REPLIES.map((r) => (
          <div className="fp-cr-card" key={r.id}>
            <div className="fp-cr-top">
              <span className="fp-cr-when">{r.when}</span>
              <CopyButton text={r.text} />
            </div>
            <p className="fp-cr-text">{r.text}</p>
            <div className="fp-cr-do">{r.then}</div>
          </div>
        ))}
      </div>

      {/* 4 — qualify */}
      <div className="fp-cr-h">On the call — qualify (fails tell you which line it goes to instead)</div>
      <Checklist storageKey="mf.playbook.bitty.coldreply.v1" items={QUALIFY} />
      <Rows
        items={[
          {
            k: "It fails one",
            v: (
              <>
                <b>Don't end the call and don't say “declined”.</b> Say: “This program isn't the best fit, but we
                have others — let's finish the application and I'll match you to the right one.” Fill the
                application anyway, then check the line named above on <b>/admin/products</b> before you promise
                anything.
              </>
            ),
          },
        ]}
      />

      {/* 5 — send */}
      <div className="fp-cr-h">Send the application — you fill it, they sign it</div>
      <div className="fp-panel">
        <ol className="fp-cr-steps">
          <li>
            In the Revenue Playbook, press <span className="fp-cr-btn">Fill out application</span>. Ask each question
            and <b>type the answers yourself</b> while they talk — the merchant never gets a blank form.
          </li>
          <li>
            <b>Read back the mobile number and email.</b> The signing link and the ID check both go there — a typo
            kills the file.
          </li>
          <li>
            Fill every required (*) field, then press <span className="fp-cr-btn">Send to merchant to e-sign</span>.
            Stay on the line until they say it arrived.
          </li>
          <li>
            <b>Send it once.</b> Every send creates a new signable copy; a merchant holding two signs the wrong one.
            Didn't arrive? Check the email address before you send again.
          </li>
          <li>
            Ask for the <b>last 3–4 months of business bank statements</b> before you hang up.
          </li>
        </ol>
      </div>

      {/* 6 — compliance */}
      <Alert tone="info" title="Every word you say or send">
        <ul className="fp-cr-rule">
          <li>
            <b>Never “loan”.</b> It's an <b>advance</b>, <b>working capital</b> or <b>funding</b>.
          </li>
          <li>
            <b>Never “approved”, “pre-approved” or “guaranteed”</b> — not even “you should be approved”.
          </li>
          <li>
            <b>No upfront fees, ever.</b> The merchant pays us nothing; the funder pays us.
          </li>
          <li>
            <b>Applying through us doesn't affect their credit.</b> A credit check happens only when a funder
            reviews the file.
          </li>
          <li>
            <b>No amounts, rates or timelines promised</b> before the application and statements are in.
          </li>
        </ul>
      </Alert>
    </>
  );
}
