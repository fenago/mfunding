// ─────────────────────────────────────────────────────────────────────────────
// How the Dialing Machine Works
//
// The end-to-end SOP: Lists → Lead Machine → VibeReach (contact + New Lead
// opportunity) → WAVV → Revenue Playbook → disposition writes the board back.
// Static reference page — no data fetching.
//
// ⚠️ Content history. This page used to document a HotProspector leg (load into
// GHL, tag, then sync the tag down into HP, then build an HP campaign on a
// group). HotProspector is FULLY RETIRED (owner ruling 8/17: "we are not using
// hot prospector at all") and that whole middle section no longer exists: WAVV
// lives inside VibeReach and dials a pipeline column directly, so there is no
// sync step, no group, and no dialer-side campaign. Do not reintroduce one.
//
// Every fact below is checked against the live system, not remembered:
//   • pipeline + stage names — GHL /opportunities/pipelines, "MFunding MCA
//     Pipeline" bG9ZEh4eP9x60E1CyaMx
//   • the disposition → board mapping — the MAPPING array in
//     supabase/functions/wavv-disposition-sync/index.ts (NOT that file's older
//     header comment, which still describes a superseded not-interested rule)
//   • the 10-minute cadence — 20260818_wavv_disposition_sync_cron.sql
//   • the setter-side clicks — SetterGuidePage, which is the setters' own doc
// If any of those change, fix them THERE first and mirror the change here.
//
// Audience: OPS (every staff role, setters included) — this is the manager-side
// companion to the Setter Guide. Same flow, told as "how does a bought list
// become a dialed lead" rather than "how do I run my shift".
//
// Theming: the app drives dark mode with a `dark` class on <html> (see
// lib/theme-context), so the dark token block is scoped to `.dark .dmw`. The
// SVG reads those same CSS variables (fills/strokes + the <marker> arrowheads),
// so the diagram follows the theme automatically.
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
.dmw{
  --ink:#0f2942; --ink-soft:#40546b; --ink-faint:#7387a0;
  --ground:#f6f8fb; --panel:#ffffff; --line:#dfe6ee; --line-soft:#eef2f7;
  --accent:#0f9d6b; --accent-ink:#0a7a52; --gold:#c08a2d; --danger:#c0392d;
  --sys-list:#c08a2d; --sys-lm:#7c5cd6; --sys-ghl:#2f6fb0; --sys-wavv:#1b8fa6;
  --sys-play:#0f9d6b; --sys-close:#2f9e6e;
  --num-ink:#ffffff;
  --shadow:0 1px 2px rgba(15,41,66,.06),0 5px 18px rgba(15,41,66,.05);
  --radius:14px;
  background:var(--ground);color:var(--ink);min-height:100%;
  font-family:-apple-system,"SF Pro Text",system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  line-height:1.5;-webkit-font-smoothing:antialiased;
}
.dark .dmw{
  --ink:#e8eef5; --ink-soft:#a9b8c8; --ink-faint:#8095a8;
  --ground:#0b1620; --panel:#111e2b; --line:#24313f; --line-soft:#18242f;
  --accent:#2fc98d; --accent-ink:#57d7a5; --gold:#d9ab52; --danger:#ef8177;
  --sys-list:#d9ab52; --sys-lm:#a68bf0; --sys-ghl:#6aa6e0; --sys-wavv:#55c4dc;
  --sys-play:#2fc98d; --sys-close:#54c68d;
  --num-ink:#08131c;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.25);
}
.dmw *{box-sizing:border-box}
.dmw .wrap{max-width:1080px;margin:0 auto;padding:34px 22px 72px}
.dmw h1,.dmw h2,.dmw h3{text-wrap:balance;letter-spacing:-.02em;margin:0}
.dmw .eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-ink)}
.dmw header{border-bottom:2px solid var(--line);padding-bottom:20px;margin-bottom:28px}
.dmw .brandrow{display:flex;align-items:center;gap:10px}
.dmw .logo{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,var(--accent),var(--gold));display:inline-block;box-shadow:var(--shadow)}
.dmw .brandname{font-weight:800}
.dmw header h1{font-size:clamp(25px,3.6vw,34px);font-weight:800;margin:.3em 0 .12em;line-height:1.05}
.dmw header p{margin:0;color:var(--ink-soft);max-width:74ch;font-size:15px}
.dmw section{margin-top:34px}
.dmw .sec-h{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:14px}
/* system cards */
.dmw .sys{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.dmw .syscard{border:1px solid var(--line);border-left-width:4px;border-radius:12px;background:var(--panel);box-shadow:var(--shadow);padding:13px 15px}
.dmw .syscard .k{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint)}
.dmw .syscard .nm{font-weight:750;font-size:15px;margin:2px 0 4px}
.dmw .syscard .ds{font-size:12.5px;color:var(--ink-soft)}
.dmw .s-list{border-left-color:var(--sys-list)}
.dmw .s-lm{border-left-color:var(--sys-lm)}
.dmw .s-ghl{border-left-color:var(--sys-ghl)}
.dmw .s-wavv{border-left-color:var(--sys-wavv)}
.dmw .s-play{border-left-color:var(--sys-play)}
/* diagram */
.dmw figure{margin:0;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow);padding:18px 18px 12px}
.dmw .diagram{width:100%;height:auto;display:block}
.dmw .n{fill:var(--panel);stroke-width:1.7}
.dmw .n-list{stroke:var(--sys-list)}
.dmw .n-lm{stroke:var(--sys-lm)}
.dmw .n-ghl{stroke:var(--sys-ghl);stroke-width:2.6}
.dmw .n-wavv{stroke:var(--sys-wavv);stroke-width:2.6}
.dmw .n-close{stroke:var(--sys-close)}
.dmw .n-play{stroke:var(--sys-play);stroke-width:2.6}
.dmw .nt{fill:var(--ink);font-weight:750;font-size:12.5px}
.dmw .nr{fill:var(--ink-soft);font-size:9.7px;font-weight:600}
.dmw .edge{stroke:var(--ink-faint);stroke-width:1.7;fill:none}
.dmw .edge-accent{stroke:var(--sys-play);stroke-width:1.9;fill:none}
.dmw .edge-wavv{stroke:var(--sys-wavv);stroke-width:2.4;fill:none}
.dmw .arrowhead{fill:var(--ink-faint)}
.dmw .arrowhead-a{fill:var(--sys-play)}
.dmw .arrowhead-w{fill:var(--sys-wavv)}
.dmw .elabel{fill:var(--ink-soft);font-size:10.5px;font-weight:600}
.dmw .elabel-a{fill:var(--accent-ink);font-size:10.5px;font-weight:700}
.dmw .elabel-w{fill:var(--sys-wavv);font-size:10.5px;font-weight:700}
.dmw figcaption{font-size:12.5px;color:var(--ink-soft);margin-top:10px;padding-top:9px;border-top:1px solid var(--line-soft)}
/* steps */
.dmw .steps{display:flex;flex-direction:column;gap:0}
.dmw .step{display:grid;grid-template-columns:34px 132px 1fr;gap:14px;align-items:start;padding:13px 0;border-bottom:1px solid var(--line-soft)}
.dmw .step:last-child{border-bottom:0}
.dmw .num{width:28px;height:28px;border-radius:50%;background:var(--accent);color:var(--num-ink);font-weight:800;font-size:13px;display:grid;place-items:center}
.dmw .where{font-size:10.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:4px 8px;border-radius:6px;text-align:center;align-self:start;margin-top:1px}
.dmw .w-list{background:color-mix(in srgb,var(--sys-list) 16%,transparent);color:var(--sys-list)}
.dmw .w-lm{background:color-mix(in srgb,var(--sys-lm) 18%,transparent);color:var(--sys-lm)}
.dmw .w-ghl{background:color-mix(in srgb,var(--sys-ghl) 16%,transparent);color:var(--sys-ghl)}
.dmw .w-wavv{background:color-mix(in srgb,var(--sys-wavv) 18%,transparent);color:var(--sys-wavv)}
.dmw .w-play{background:color-mix(in srgb,var(--sys-play) 16%,transparent);color:var(--accent-ink)}
.dmw .w-close{background:color-mix(in srgb,var(--sys-close) 16%,transparent);color:var(--sys-close)}
.dmw .stext{font-size:13.5px;color:var(--ink)}
.dmw .stext b{color:var(--accent-ink)}
/* table */
.dmw .tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow)}
.dmw table{border-collapse:collapse;width:100%;min-width:600px;font-size:13.5px}
.dmw thead th{background:var(--line-soft);text-align:left;padding:10px 14px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint);font-weight:700}
.dmw tbody td{padding:11px 14px;border-top:1px solid var(--line-soft);vertical-align:top}
.dmw tbody td:first-child{font-weight:700;color:var(--sys-ghl)}
.dmw tbody td:nth-child(2){font-weight:700;color:var(--sys-wavv)}
.dmw .callout{margin-top:14px;border-left:3px solid var(--gold);background:var(--panel);border-radius:0 10px 10px 0;padding:13px 16px;font-size:13.5px;color:var(--ink-soft);box-shadow:var(--shadow)}
.dmw .callout b{color:var(--ink)}
/* cadence table — plain first/second columns, badge in col 2 */
.dmw .tbl-cad tbody td:first-child{color:var(--ink);font-weight:700}
.dmw .tbl-cad tbody td:nth-child(2){color:var(--ink-soft);font-weight:600;white-space:nowrap}
.dmw .cad{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:6px;white-space:nowrap}
.dmw .cad-once{background:color-mix(in srgb,var(--sys-ghl) 16%,transparent);color:var(--sys-ghl)}
.dmw .cad-batch{background:color-mix(in srgb,var(--gold) 22%,transparent);color:var(--gold)}
/* disposition table — WAVV label, tag, what moves */
.dmw .tbl-disp tbody td:first-child{color:var(--ink);font-weight:750}
.dmw .tbl-disp tbody td:nth-child(2){color:var(--ink-faint);font-weight:600;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:12px;white-space:nowrap}
.dmw .tbl-disp tbody td:nth-child(3){color:var(--ink-soft);font-weight:400}
.dmw .mv{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:6px;white-space:nowrap;margin-right:7px}
.dmw .mv-fwd{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent-ink)}
.dmw .mv-lost{background:color-mix(in srgb,var(--danger) 18%,transparent);color:var(--danger)}
.dmw .mv-none{background:color-mix(in srgb,var(--ink-faint) 18%,transparent);color:var(--ink-faint)}
/* option headings inside a SOP box */
.dmw .opt{font-size:12.8px;font-weight:800;color:var(--ink);margin:2px 0 9px}
.dmw .opt.second{margin-top:18px;padding-top:15px;border-top:1px solid var(--line-soft)}
.dmw .cadline{font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;margin-left:auto;padding:3px 9px;border-radius:6px}
/* status */
.dmw .two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media (max-width:640px){
  .dmw .two{grid-template-columns:1fr}
  .dmw .step{grid-template-columns:28px 1fr;gap:10px}
  .dmw .where{grid-column:2;justify-self:start;margin-bottom:2px}
}
.dmw .stbox{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow);padding:15px 17px}
.dmw .stbox h3{font-size:14px;font-weight:800;margin-bottom:9px}
.dmw .stbox ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:7px}
.dmw .stbox li{font-size:12.8px;color:var(--ink-soft)}
.dmw .stbox li b{color:var(--ink)}
.dmw .stbox ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:9px}
.dmw .stbox ol li{font-size:12.8px;color:var(--ink-soft)}
.dmw .stbox ol li b{color:var(--ink)}
.dmw .stbox ol li::marker{color:var(--accent-ink);font-weight:800}
.dmw .stbox ol ul{margin:7px 0 2px;padding-left:16px;display:flex;flex-direction:column;gap:5px;list-style:disc}
.dmw .stbox ol ul li{font-size:12.4px}
.dmw .sop-h{display:flex;align-items:baseline;gap:9px;margin-bottom:10px}
.dmw .sop-h .badge{font-size:12px;font-weight:800;color:var(--num-ink);background:var(--accent);border-radius:6px;padding:2px 9px}
.dmw .sop-h h3{font-size:14px;font-weight:800}
.dmw .sopbox{border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:12px;background:var(--panel);box-shadow:var(--shadow);padding:16px 18px;margin-bottom:14px}
.dmw .warn{margin-bottom:16px;border-left:3px solid var(--gold);background:var(--panel);border-radius:0 10px 10px 0;padding:13px 16px;font-size:13.5px;color:var(--ink-soft);box-shadow:var(--shadow)}
.dmw .warn b{color:var(--ink)}
.dmw .warn u{text-decoration-color:var(--gold);text-underline-offset:2px}
.dmw .danger{border-left-color:var(--danger);border-left-width:4px}
.dmw .danger u{text-decoration-color:var(--danger)}
.dmw .ok::marker{content:"✅  "}
.dmw .todo::marker{content:"⏳  "}
.dmw .no::marker{content:"⛔  "}
.dmw code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.9em;background:var(--line-soft);padding:1px 6px;border-radius:5px;font-weight:700}
.dmw footer{margin-top:40px;padding-top:15px;border-top:1px solid var(--line);color:var(--ink-faint);font-size:12px}
`;

// The five systems, in the order the lead travels through them.
const SYSTEMS = [
  {
    cls: "s-list",
    kicker: "The lists",
    name: "UCC Harvester + bought lists",
    body: (
      <>
        Where leads come from — the merchants the <b>UCC Harvester</b> surfaces (/admin/ph-ucc) and
        any <b>purchased list</b> you drop in as a CSV.
      </>
    ),
  },
  {
    cls: "s-lm",
    kicker: "The loader",
    name: "Lead Machine",
    body: (
      <>
        /admin/lead-machine. Stages the file, lets you <b>filter a slice</b>, tags it, and{" "}
        <b>pushes it into VibeReach</b>. This is the only way a bought list is allowed to reach the
        floor.
      </>
    ),
  },
  {
    cls: "s-ghl",
    kicker: "The brain · system of record",
    name: "VibeReach · GoHighLevel",
    body: (
      <>
        The CRM. A pushed lead becomes a <b>contact</b> (carrying its Revenue Playbook link) and a{" "}
        <b>New Lead opportunity</b> on the <b>MFunding MCA Pipeline</b>. The board is what gets
        dialed.
      </>
    ),
  },
  {
    cls: "s-wavv",
    kicker: "The dialer · inside VibeReach",
    name: "WAVV",
    body: (
      <>
        Not a separate app — the <b>Call</b> button on a pipeline column header. Rings{" "}
        <b>3 numbers at once</b>, drops the losers on the first answer, and pops the contact card.
      </>
    ),
  },
  {
    cls: "s-play",
    kicker: "The cockpit",
    name: "Revenue Playbook",
    body: (
      <>
        Inside our app. On a live call the setter opens it from the contact card —{" "}
        <b>Additional Info → Revenue Playbook</b> — and it loads <b>that merchant</b>: script,
        send-app, Connect-Bank.
      </>
    ),
  },
];

// End-to-end walkthrough. `where` is the system the step happens in; a leading
// arrow means the step is a handoff INTO that system.
const STEPS = [
  {
    where: "Lists",
    cls: "w-list",
    body: (
      <>
        A batch appears — either the <b>UCC Harvester</b> or a <b>purchased list</b> (CSV: First,
        Last, Company, Phone, Email, City, State, Zip).
      </>
    ),
  },
  {
    where: "UCC Harvester",
    cls: "w-list",
    body: (
      <>
        In <b>/admin/ph-ucc</b> you <b>filter</b> the leads you want — Lead heat (# of stacked
        advances), Confidence (Confirmed / High), state — then <b>skip-trace</b> the filtered set
        (BatchData ~$0.06/lead fills phone + email; <b>DNC and TCPA-litigator numbers are suppressed
        automatically</b>).
      </>
    ),
  },
  {
    where: "Lead Machine",
    cls: "w-lm",
    body: (
      <>
        In <b>/admin/lead-machine</b>, stage the file, <b>filter the slice</b> you want to run, and
        give it a <b>dial tag</b>. The tag is <b>attribution, not a dial target</b> — nothing dials
        because of a tag.
      </>
    ),
  },
  {
    where: "→ VibeReach",
    cls: "w-ghl",
    body: (
      <>
        <b>Push to VibeReach.</b> Each lead is <b>upserted by phone/email</b> (so a re-push never
        duplicates a merchant), gets its tags, gets its <b>Revenue Playbook link</b>, and lands as a{" "}
        <b>New Lead opportunity</b> on the <b>MFunding MCA Pipeline</b>.
      </>
    ),
  },
  {
    where: "Validate",
    cls: "w-close",
    body: (
      <>
        <b>Before the floor touches it:</b> the <b>New Lead</b> column grew by roughly the push size,
        the setter's <b>Source</b> filter finds them, and one contact's{" "}
        <b>Additional Info → Revenue Playbook</b> opens that merchant. If any of the three fails,{" "}
        <b>stop and fix it</b>.
      </>
    ),
  },
  {
    where: "VibeReach",
    cls: "w-ghl",
    body: (
      <>
        The setter opens <b>Opportunities → MFunding MCA Pipeline</b>, then{" "}
        <b>Advanced Filters → Source → Is → </b>
        <code>UCC</code> or <code>Aged</code> — <b>capital letters matter</b> — and presses the blue{" "}
        <b>Apply</b>. One filter only; nothing stacked on top.
      </>
    ),
  },
  {
    where: "→ WAVV",
    cls: "w-wavv",
    body: (
      <>
        <b>Call</b> on the <b>New Lead</b> column header starts the dial session. WAVV rings{" "}
        <b>3 numbers at a time</b> and lines up the next 3 when the setter finishes.
      </>
    ),
  },
  {
    where: "WAVV",
    cls: "w-wavv",
    body: (
      <>
        <b>Answering machine → Voicemail, then Resume.</b> WAVV drops the setter's pre-recorded
        message and dials on. On multiline it drops VMs on the background lines automatically while
        the setter talks.
      </>
    ),
  },
  {
    where: "→ Playbook",
    cls: "w-play",
    body: (
      <>
        Live answer → WAVV pops the <b>contact card</b> → <b>Additional Info → Revenue Playbook</b>{" "}
        (one click, <b>up to 30 seconds</b>) → the setter sends the <b>e-sign application</b> and the{" "}
        <b>Connect-Bank / upload links</b> while the merchant is on the phone.
      </>
    ),
  },
  {
    where: "→ VibeReach",
    cls: "w-ghl",
    body: (
      <>
        <b>Disposition every live call in WAVV.</b> The disposition tags the contact and{" "}
        <b>moves the opportunity on the board</b> — see the mapping below. Complete files (
        <b>signed + bank connected</b>) hand on to the closers. Managers watch per-rep KPIs on{" "}
        <b>/admin/setter-performance</b>.
      </>
    ),
  },
];

// VibeReach ↔ WAVV vocabulary. An em dash means the concept doesn't exist there.
const VOCAB: [string, string, string][] = [
  [
    "Contact",
    "the person on the line",
    "the merchant's record. It carries the Revenue Playbook link under Additional Info — that link is the setter's whole cockpit",
  ],
  [
    "Opportunity · Pipeline · Stage",
    "— (no pipeline)",
    "the card on the board. WAVV dials a COLUMN of it, so the stage a lead sits in is what decides whether it gets called",
  ],
  [
    "Source (on the opportunity)",
    "—",
    'what the setter filters on: UCC or Aged, typed in exact capitals, then the blue Apply. This is how a setter gets "their" book',
  ],
  [
    "Tag",
    "— (WAVV writes wavv-* ones)",
    "provenance and attribution only (lm-ucc, the batch tag, the campaign tag). A tag DOES NOT make anything dial",
  ],
  ["Workflow", "—", "the automation that sends docs and fires follow-up when a stage changes"],
  ["—", "Call (column header)", "starts a 3-line dial session on everything in that column"],
  ["—", "Voicemail / Resume", "drop the pre-recorded message on an answering machine and move to the next 3"],
  [
    "—",
    "Disposition",
    "the outcome the setter records. It stamps a wavv-* tag on the contact, which is what moves the board",
  ],
];

// Disposition → what the board does. Straight from the MAPPING array in
// supabase/functions/wavv-disposition-sync/index.ts — do not paraphrase it from
// memory, and do not trust that file's older header comment, which still shows a
// superseded not-interested → Contacted rule.
const DISPOSITIONS: { label: string; tag: string; kind: "fwd" | "lost" | "none"; move: string; note: React.ReactNode }[] =
  [
    {
      label: "Interested",
      tag: "wavv-interested",
      kind: "fwd",
      move: "→ Qualifying",
      note: <>The forward move. WAVV does not advance stages itself — the sweep does.</>,
    },
    {
      label: "Appointment Set",
      tag: "wavv-appointment-set",
      kind: "fwd",
      move: "→ Qualifying",
      note: <>Same destination as Interested: a booked call is a qualified conversation.</>,
    },
    {
      label: "Callback",
      tag: "wavv-callback",
      kind: "fwd",
      move: "→ Contacted",
      note: <>Reached, not yet qualified — it leaves New Lead so it stops being cold-dialed.</>,
    },
    {
      label: "Not Interested",
      tag: "wavv-not-interested",
      kind: "lost",
      move: "Lost",
      note: (
        <>
          <b>WAVV sets this to Lost itself, at disposition time.</b> The card leaves the open board
          and lives under the Lost filter; the sweep is only a backstop for calls WAVV misses.
        </>
      ),
    },
    {
      label: "Bad Number",
      tag: "wavv-bad-number",
      kind: "lost",
      move: "Lost",
      note: <>Same treatment — the merchant was never reachable on this record.</>,
    },
    {
      label: "Do Not Contact",
      tag: "wavv-do-not-contact",
      kind: "lost",
      move: "DND, then Lost",
      note: (
        <>
          <b>The contact is marked DND first</b> — that is the durable TCPA suppression VibeReach
          actually enforces — and only then is the opportunity lost.
        </>
      ),
    },
    {
      label: "No Answer · Left Voicemail · Canceled · Blocked",
      tag: "— (no mapping)",
      kind: "none",
      move: "nothing moves",
      note: (
        <>
          Deliberate. The lead <b>stays in New Lead so it gets redialed</b>; a voicemail is not an
          outcome.
        </>
      ),
    },
  ];

// What is already built and never touched again, vs. what you redo for every
// single batch. `once` = set up once and left alone; `batch` = a fresh one for
// each list you run.
const SETUP_MATRIX: { thing: React.ReactNode; cadence: "once" | "batch"; note: React.ReactNode }[] =
  [
    {
      thing: (
        <>
          The <b>MFunding MCA Pipeline</b> and its stages
        </>
      ),
      cadence: "once",
      note: (
        <>
          <b>Already built</b> — New Lead → Contacted → Qualifying → Application Sent → … → Funded →
          Renewal Eligible. <b>Never re-stage it</b>: the stage ids are hard-referenced by the
          disposition sweep and the intake functions.
        </>
      ),
    },
    {
      thing: (
        <>
          The <b>Revenue Playbook link</b> on each contact
        </>
      ),
      cadence: "once",
      note: (
        <>
          <b>Written automatically.</b> The push sets it, and a sweep backfills any contact that
          missed it. <b>Nothing to do per batch</b> — but a contact with no link under{" "}
          <b>Additional Info</b> is a real defect worth reporting, not a setter mistake.
        </>
      ),
    },
    {
      thing: (
        <>
          <b>WAVV seats</b> per setter + their <b>mfunding.net logins</b>
        </>
      ),
      cadence: "once",
      note: (
        <>
          <b>One-time per setter</b>, not per batch. New setter = the VibeReach/WAVV seat{" "}
          <b>and</b> the mfunding.net login, once.
        </>
      ),
    },
    {
      thing: (
        <>
          Each setter's <b>recorded voicemail</b>
        </>
      ),
      cadence: "once",
      note: (
        <>
          Recorded by the setter in <b>WAVV → gear icon → Voicemails</b>, 20–30 seconds, in their own
          voice. Re-recorded every few weeks so it doesn't sound canned — never per batch.
        </>
      ),
    },
    {
      thing: (
        <>
          The <b>disposition set</b> + the board mapping
        </>
      ),
      cadence: "once",
      note: (
        <>
          Configured in <b>WAVV Manager → Call Dispositions</b>; the moves are made by the{" "}
          <b>disposition sweep, which runs every 10 minutes</b>. Both are built —{" "}
          <b>adding a new disposition means updating the mapping</b>, or it will silently move
          nothing.
        </>
      ),
    },
    {
      thing: (
        <>
          The <b>call script</b>
        </>
      ),
      cadence: "once",
      note: (
        <>
          Built once and reused. Edit the wording whenever you want — you do not create a new script
          per batch.
        </>
      ),
    },
    {
      thing: (
        <>
          <b>Stage + filter the list</b> in the Lead Machine
        </>
      ),
      cadence: "batch",
      note: (
        <>
          Every list gets uploaded (or loaded from a staged file) and cut down to the slice you
          actually want to run. See <b>Part B</b>.
        </>
      ),
    },
    {
      thing: (
        <>
          A <b>dial tag</b> for the slice
        </>
      ),
      cadence: "batch",
      note: (
        <>
          <b>A new dated tag per list</b>. It is how spend, deals and revenue attribute back to this
          batch — <b>it is not what dials</b>. Never recycle one, or two batches' numbers merge.
        </>
      ),
    },
    {
      thing: (
        <>
          <b>Push to VibeReach</b>
        </>
      ),
      cadence: "batch",
      note: (
        <>
          The one action that puts the batch in front of the floor: contacts upserted, tagged,
          Playbook-linked, and opened as <b>New Lead</b> opportunities.
        </>
      ),
    },
    {
      thing: (
        <>
          <b>Validation clicks</b>
        </>
      ),
      cadence: "batch",
      note: (
        <>
          <b>Every single batch</b>, before setters dial: the board count, the Source filter, one
          Revenue Playbook link, and one test call. <b>Part C.</b>
        </>
      ),
    },
  ];

export default function DialingMachinePage() {
  return (
    <div className="dmw">
      <style>{CSS}</style>
      <div className="wrap">
        <header>
          <div className="brandrow">
            <span className="logo" aria-hidden="true" />
            <span className="brandname">Momentum Funding</span>
          </div>
          <p className="eyebrow" style={{ marginTop: 14 }}>
            Internal · How the Machine Fits Together
          </p>
          <h1>Lists → VibeReach → WAVV → Revenue Playbook</h1>
          <p>
            Where a lead comes from, how the Lead Machine <b>pushes it into VibeReach as a New Lead
            opportunity</b>, how a setter filters to it and dials it with <b>WAVV</b>, how the
            Revenue Playbook opens on the live call, and how the disposition <b>moves the board back
            in VibeReach</b>. Read the rule, then the picture, then the SOP.
          </p>
        </header>

        {/* THE RULE */}
        <section>
          <div className="warn danger">
            <b>THE ONE ARCHITECTURE RULE — a lead is dialable only once it is a VibeReach contact
            with an opportunity on the board.</b>{" "}
            VibeReach is the system of record and WAVV dials <b>a pipeline column</b>, not a file.{" "}
            <u>Never dial a merchant off a CSV, an export, or a personal list.</u>{" "}
            A lead that skipped the push has <b>no Revenue Playbook link</b> on its card, <b>no
            opportunity</b> for the Call button to pick up, and <b>no disposition writeback</b> — so
            the setter has no cockpit, the follow-up never fires, and the call is unrecorded work.
            Every batch goes <b>list → Lead Machine → Push to VibeReach → the board</b>. No
            exceptions.
          </div>
        </section>

        {/* SYSTEMS */}
        <section>
          <div className="sec-h">The five systems &amp; what each one is for</div>
          <div className="sys">
            {SYSTEMS.map((s) => (
              <div key={s.name} className={`syscard ${s.cls}`}>
                <div className="k">{s.kicker}</div>
                <div className="nm">{s.name}</div>
                <div className="ds">{s.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ONE-TIME VS PER-BATCH */}
        <section>
          <div className="sec-h">One-time setup vs. every batch — read this first</div>
          <div className="tablewrap">
            <table className="tbl-cad">
              <thead>
                <tr>
                  <th>Thing</th>
                  <th>How often</th>
                  <th>What that means in practice</th>
                </tr>
              </thead>
              <tbody>
                {SETUP_MATRIX.map((r, i) => (
                  <tr key={i}>
                    <td>{r.thing}</td>
                    <td>
                      <span className={`cad ${r.cadence === "once" ? "cad-once" : "cad-batch"}`}>
                        {r.cadence === "once" ? "One-time" : "Every batch"}
                      </span>
                    </td>
                    <td>{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="callout">
            <b>The short version:</b> the <b>plumbing is already built</b> — the pipeline, the
            Playbook links, the seats, the voicemails, the dispositions and the script.{" "}
            <b>What you redo for every list</b> is: <b>stage and filter it</b>, <b>a new dial tag</b>
            , <b>push it to VibeReach</b>, and the <b>validation clicks</b>. Four things. Nothing
            else gets touched.
          </div>
        </section>

        {/* DIAGRAM */}
        <section>
          <div className="sec-h">How they connect</div>
          <figure>
            <svg
              className="diagram"
              viewBox="0 0 760 300"
              role="img"
              aria-label="Lists from the UCC Harvester or a purchased file are staged and filtered in the Lead Machine, then pushed into VibeReach, where each lead becomes a contact and a New Lead opportunity on the MFunding MCA Pipeline. WAVV dials that column three lines at a time. On a live answer the setter opens the Revenue Playbook from the contact card and sends the application and Connect-Bank links. The disposition writes back to VibeReach, moving the opportunity on the board, firing the follow-up workflow, and handing a complete file to the closers."
            >
              <defs>
                <marker
                  id="dmw-ar"
                  viewBox="0 0 10 10"
                  refX="8.5"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path className="arrowhead" d="M0,0 L10,5 L0,10 z" />
                </marker>
                <marker
                  id="dmw-ara"
                  viewBox="0 0 10 10"
                  refX="8.5"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path className="arrowhead-a" d="M0,0 L10,5 L0,10 z" />
                </marker>
                <marker
                  id="dmw-arw"
                  viewBox="0 0 10 10"
                  refX="8.5"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path className="arrowhead-w" d="M0,0 L10,5 L0,10 z" />
                </marker>
              </defs>

              {/* nodes — top row: the load path */}
              <rect className="n n-list" x="10" y="50" width="118" height="58" rx="11" />
              <text className="nt" x="69" y="75" textAnchor="middle">
                Lists
              </text>
              <text className="nr" x="69" y="92" textAnchor="middle">
                UCC · bought
              </text>

              <rect className="n n-lm" x="196" y="50" width="132" height="58" rx="11" />
              <text className="nt" x="262" y="75" textAnchor="middle">
                Lead Machine
              </text>
              <text className="nr" x="262" y="92" textAnchor="middle">
                stage · filter · tag
              </text>

              <rect className="n n-ghl" x="396" y="50" width="186" height="58" rx="11" />
              <text className="nt" x="489" y="75" textAnchor="middle">
                VibeReach
              </text>
              <text className="nr" x="489" y="92" textAnchor="middle">
                contact + New Lead opportunity
              </text>

              <rect className="n n-close" x="646" y="50" width="104" height="58" rx="11" />
              <text className="nt" x="698" y="75" textAnchor="middle">
                Closers
              </text>
              <text className="nr" x="698" y="92" textAnchor="middle">
                MCA pipeline
              </text>

              {/* nodes — bottom row: the call */}
              <rect className="n n-wavv" x="196" y="212" width="150" height="58" rx="11" />
              <text className="nt" x="271" y="237" textAnchor="middle">
                WAVV
              </text>
              <text className="nr" x="271" y="254" textAnchor="middle">
                dials the column · 3 lines
              </text>

              <rect className="n n-play" x="414" y="212" width="210" height="58" rx="11" />
              <text className="nt" x="519" y="237" textAnchor="middle">
                Revenue Playbook
              </text>
              <text className="nr" x="519" y="254" textAnchor="middle">
                merchant preloaded · the cockpit
              </text>

              {/* edges */}
              {/* lists -> lead machine */}
              <line className="edge" x1="128" y1="79" x2="192" y2="79" markerEnd="url(#dmw-ar)" />
              <text className="elabel" x="160" y="71" textAnchor="middle">
                upload
              </text>
              {/* lead machine -> vibereach (the push) */}
              <line className="edge" x1="328" y1="79" x2="392" y2="79" markerEnd="url(#dmw-ar)" />
              <text className="elabel" x="360" y="71" textAnchor="middle">
                push + tag
              </text>
              {/* vibereach -> closers */}
              <line className="edge" x1="582" y1="79" x2="642" y2="79" markerEnd="url(#dmw-ar)" />
              <text className="elabel" x="612" y="71" textAnchor="middle">
                handoff
              </text>
              {/* vibereach -> wavv (the board IS the dial list) */}
              <polyline
                className="edge-wavv"
                points="450,108 450,168 271,168 271,208"
                markerEnd="url(#dmw-arw)"
              />
              <text className="elabel-w" x="358" y="161" textAnchor="middle">
                WAVV dials the New Lead column
              </text>
              {/* wavv -> playbook */}
              <line
                className="edge-accent"
                x1="346"
                y1="241"
                x2="410"
                y2="241"
                markerEnd="url(#dmw-ara)"
              />
              <text className="elabel-a" x="378" y="233" textAnchor="middle">
                opens
              </text>
              {/* playbook -> vibereach (disposition writeback) */}
              <polyline
                className="edge-accent"
                points="600,208 600,140 560,140 560,112"
                markerEnd="url(#dmw-ara)"
              />
              <text className="elabel-a" x="612" y="182" textAnchor="start">
                disposition
              </text>
              <text className="elabel-a" x="612" y="196" textAnchor="start">
                moves the board
              </text>
            </svg>
            <figcaption>
              <b>The one idea:</b> the <b>board is the dial list</b>. The Lead Machine's push is what
              turns a bought row into a <b>VibeReach contact</b> — carrying its Revenue Playbook link
              — and a <b>New Lead opportunity</b>, and WAVV's <b>Call</b> button dials that column.
              A lead that skipped the push is on no column, so it <b>cannot be worked</b>. On a live
              answer the setter opens the Playbook off the contact card, sends the app + bank links,
              and the <b>disposition writes back</b> to move the card and fire the follow-up.
            </figcaption>
          </figure>
        </section>

        {/* STEPS */}
        <section>
          <div className="sec-h">End to end, step by step</div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div className="step" key={s.where + i}>
                <div className="num">{i + 1}</div>
                <div className={`where ${s.cls}`}>{s.where}</div>
                <div className="stext">{s.body}</div>
              </div>
            ))}
          </div>
        </section>

        {/* PITFALLS */}
        <section>
          <div className="sec-h">Pitfalls — each of these has cost us a session</div>
          <div className="stbox">
            <ul>
              <li className="no">
                <b>Dialing off a CSV or an export.</b> Those merchants are on no column and have no
                Playbook link. <b>Everything goes through the push.</b>
              </li>
              <li className="no">
                <b>The Source filter is case-sensitive.</b> It must be exactly <code>UCC</code> or{" "}
                <code>Aged</code> — <b>lowercase finds nothing</b> — and you must press the blue{" "}
                <b>Apply</b>. Confirm it took: the count next to the pipeline name changes.
              </li>
              <li className="no">
                <b>Stacking filters on top of Source.</b> One filter only. A second one silently
                shrinks the book and the setter spends the morning on 40 leads.
              </li>
              <li className="no">
                <b>Not signed into mfunding.net in the SAME Chrome window.</b> The Revenue Playbook
                link then lands on a login screen instead of the merchant. Both tabs, one window, all
                day.
              </li>
              <li className="no">
                <b>Clicking the Playbook link repeatedly.</b> It takes <b>up to 30 seconds</b>. One
                click, then wait — extra clicks just queue more loads.
              </li>
              <li className="no">
                <b>WAVV's "Answer Boost" mode skips answering machines entirely</b> — no voicemails
                get left at all. Use <b>standard mode</b> on days you want VM drops, and set the{" "}
                <b>ring timeout to 5–10 rings</b> so calls actually reach voicemail.
              </li>
              <li className="no">
                <b>Not dispositioning a live call.</b> No disposition = no tag = <b>the card never
                moves and the follow-up never fires</b>. The conversation is lost the moment the
                setter hangs up.
              </li>
              <li className="no">
                <b>Treating a missing Revenue Playbook link as a setter problem.</b> It isn't — that
                lead didn't get loaded properly. The setter works around it via the merchant search;
                the batch gets reported and fixed.
              </li>
              <li className="no">
                <b>Recycling a dial tag.</b> Tags are attribution. Reuse one and two batches' cost,
                deals and revenue merge into a number that describes neither.
              </li>
            </ul>
          </div>
        </section>

        {/* SOP */}
        <section>
          <div className="sec-h">
            How to run a batch, start to finish
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">A</span>
              <h3>Get the list</h3>
              <span className="cadline cad cad-batch">Every batch</span>
            </div>
            <ol>
              <li>
                <b>UCC Harvester (/admin/ph-ucc)</b> — <b>filter</b> the leads you want (Lead heat,
                Confidence = Confirmed / High, state), <b>skip-trace</b> the filtered set (BatchData{" "}
                <b>~$0.06/lead</b> — fills phone + email; <b>DNC and TCPA-litigator numbers are
                suppressed automatically</b>).
              </li>
              <li>
                <b>Or a purchased list</b> — a CSV with <b>First, Last, Company, Phone, Email, City,
                State, Zip</b>.
              </li>
            </ol>
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">B</span>
              <h3>Stage it, tag it, push it — in the Lead Machine</h3>
              <span className="cadline cad cad-batch">Every batch</span>
            </div>
            <ol>
              <li>
                Open <b>/admin/lead-machine</b> and <b>upload the CSV</b> (or load a file already
                staged). Uploading <b>applies no tags and sends nothing</b> — it just puts the rows
                in front of you as a batch.
              </li>
              <li>
                <b>Filter down to the slice you actually want to run</b> — state, lead type, line
                type, revenue. Different slices of one file can go out as different batches.
              </li>
              <li>
                <b>Name the dial tag</b> — a new dated one, e.g. <code>dial-ucc-0820</code>. Every
                pushed lead also picks up its <b>lm-type tag</b> and <b>batch tag</b> automatically;
                those are provenance. <b>None of these tags dial anything</b> — they are how the
                numbers attribute back.
              </li>
              <li>
                <b>Push to VibeReach.</b> Leads are <b>upserted by phone/email</b>, so a re-push
                updates the merchant already there instead of creating a second one. Each pushed lead
                gets its tags, its <b>Revenue Playbook link</b>, and a <b>New Lead opportunity</b> on
                the <b>MFunding MCA Pipeline</b>.
              </li>
            </ol>
            <div className="callout">
              <b>The push is the whole handoff.</b> There is no sync step after it, no dialer-side
              list to build, and nothing to wire up in WAVV. The moment the push finishes, the leads
              are sitting on the board where the setters' <b>Call</b> button reaches them.
            </div>
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">C</span>
              <h3>Validate the batch — never skip this</h3>
              <span className="cadline cad cad-batch">Every batch</span>
            </div>
            <ol>
              <li>
                <b>The board grew.</b> Open <b>Opportunities → MFunding MCA Pipeline</b>: the{" "}
                <b>New Lead</b> column should be up by roughly your push size.
              </li>
              <li>
                <b>The setter's filter finds them.</b> <b>Advanced Filters → Source → Is →</b>{" "}
                <code>UCC</code> (or <code>Aged</code>, exact capitals) → blue <b>Apply</b>. If the
                count doesn't move, the filter isn't on — <b>fix that before the floor starts</b>,
                not during.
              </li>
              <li>
                <b>One contact opens its Playbook.</b> Open any of the new arrivals →{" "}
                <b>Additional Info</b> → click <b>Revenue Playbook</b> → it must open{" "}
                <b>that merchant</b> in mfunding.net within ~30 seconds. A login screen means you
                aren't signed into mfunding.net in that window; <b>no link at all</b> means the push
                didn't land properly.
              </li>
              <li>
                <b>One test call.</b> Someone dials one lead end to end — Call → answer → Playbook
                opens → disposition → the card moves on the board.{" "}
                <b>Only then do setters start.</b> Three minutes of checking beats a lost day.
              </li>
            </ol>
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">D</span>
              <h3>The setter's daily flow</h3>
              <span className="cadline cad cad-once">Every day, no setup</span>
            </div>
            <ol>
              <li>
                <b>Google Chrome, one window.</b> Tab 1 <b>app.vibereach.io</b>, tab 2{" "}
                <b>mfunding.net</b>, both signed in, left open all day. Not two browsers, not
                incognito — the shared session is what makes the Playbook link work.
              </li>
              <li>
                <b>Opportunities → MFunding MCA Pipeline</b> → <b>Advanced Filters → Source → Is →</b>{" "}
                <code>UCC</code> or <code>Aged</code> (exact capitals) → blue <b>Apply</b>. One
                filter, nothing stacked.
              </li>
              <li>
                <b>Press Call on the New Lead column header.</b> That's WAVV: 3 lines at once, the
                other two drop on the first answer, and it lines up the next 3 when you're done.
              </li>
              <li>
                <b>Answering machine → Voicemail, then Resume.</b> The pre-recorded drop goes out and
                the dialer moves on. No dead air.
              </li>
              <li>
                <b>Live answer → contact card → Additional Info → Revenue Playbook.</b> One click,
                wait up to 30 seconds. Then work it top to bottom: capture the details,{" "}
                <b>send the application</b>, get the <b>bank connected</b> — all while they're on the
                phone.
              </li>
              <li>
                <b>Disposition the call in WAVV.</b> Every live call, every time — that's what moves
                the board and fires the follow-up.
              </li>
              <li>
                <b>Backstop if a contact has no Playbook link:</b> find the merchant with the{" "}
                <b>search bar</b> in mfunding.net (name, business, or phone) and keep working — then
                tell your manager, because that lead was loaded wrong.
              </li>
            </ol>
            <div className="callout">
              <b>Compliance, every call:</b> it's an <b>advance / working capital / funding</b> —{" "}
              <b>never "a loan"</b>. Open with <b>"this call may be recorded."</b> No upfront fees,
              no guarantees. Dial only <b>8am–9pm the merchant's local time</b>.{" "}
              <b>"Take me off your list" → Do Not Contact on the spot</b>, no arguing, no redial.
            </div>
          </div>
        </section>

        {/* DISPOSITIONS */}
        <section>
          <div className="sec-h">Dispositions — what each one does to the board</div>
          <div className="tablewrap">
            <table className="tbl-disp">
              <thead>
                <tr>
                  <th>Disposition in WAVV</th>
                  <th>Tag it stamps</th>
                  <th>What happens to the opportunity</th>
                </tr>
              </thead>
              <tbody>
                {DISPOSITIONS.map((d) => (
                  <tr key={d.tag}>
                    <td>{d.label}</td>
                    <td>{d.tag}</td>
                    <td>
                      <span className={`mv mv-${d.kind}`}>{d.move}</span>
                      {d.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="callout">
            <b>How the move actually happens.</b> WAVV stamps a <code>wavv-*</code> tag on the
            contact; a sweep runs <b>every 10 minutes</b>, reads the new tags, moves the
            opportunities and then <b>removes the tag</b> so each disposition is processed once. Two
            consequences worth knowing: the board is <b>current within ten minutes, not instantly</b>
            , and the sweep <b>never moves anything back INTO New Lead</b> — that stage fires the
            speed-to-lead email, and re-entering it would email the merchant again.{" "}
            <b>Adding a new disposition in WAVV Manager does nothing on its own</b> until it's added
            to the mapping.
          </div>
        </section>

        {/* VOCAB */}
        <section>
          <div className="sec-h">The words, translated</div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>VibeReach (GoHighLevel)</th>
                  <th>WAVV</th>
                  <th>What it actually is</th>
                </tr>
              </thead>
              <tbody>
                {VOCAB.map(([ghl, wavv, what]) => (
                  <tr key={what}>
                    <td>{ghl}</td>
                    <td>{wavv}</td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="callout">
            <b>Why "the tag doesn't dial" keeps coming up.</b> Under the old dialer a tag was the
            thing you pointed a campaign at, so a mistyped tag meant a dead floor. That is no longer
            true: <b>WAVV dials a pipeline column</b>. A tag now only decides which batch the cost
            and revenue land against — worth getting right, but it will never be the reason nobody
            got called.
          </div>
        </section>

        {/* STATUS */}
        <section>
          <div className="sec-h">What's proven vs. what will bite you</div>
          <div className="two">
            <div className="stbox">
              <h3>✅ Proven, verified live</h3>
              <ul>
                <li className="ok">
                  <b>Lead Machine push → VibeReach</b> — upsert by phone/email, tags applied, Revenue
                  Playbook link written, <b>New Lead opportunity opened</b> on the MFunding MCA
                  Pipeline.
                </li>
                <li className="ok">
                  <b>WAVV dials the column</b> — Call on the New Lead header, <b>3 lines at once</b>,
                  VM drop + Resume, contact card on a live answer.
                </li>
                <li className="ok">
                  <b>Additional Info → Revenue Playbook opens the merchant</b> preloaded, given a
                  same-window mfunding.net session.
                </li>
                <li className="ok">
                  <b>Dispositions move the board</b> — verified against the live WAVV disposition
                  set; the sweep runs every 10 minutes and is idempotent.
                </li>
                <li className="ok">
                  <b>Revenue Playbook cockpit</b> — send-app + Connect-Bank + upload links, tokenized
                  (send.mfunding.net). Per-rep KPIs on <b>/admin/setter-performance</b>.
                </li>
              </ul>
            </div>
            <div className="stbox">
              <h3>⛔ Never do this</h3>
              <ul>
                <li className="no">
                  <b>Never dial off a CSV or export.</b> No opportunity, no Playbook link, no
                  writeback.
                </li>
                <li className="no">
                  <b>Never type the Source value in lowercase</b>, and never skip the blue{" "}
                  <b>Apply</b> — the filter simply isn't on.
                </li>
                <li className="no">
                  <b>Never stack a second filter</b> on top of Source. It hides most of the book
                  without saying so.
                </li>
                <li className="no">
                  <b>Never leave a live call undispositioned.</b> The card doesn't move and the
                  follow-up doesn't fire.
                </li>
                <li className="no">
                  <b>Never re-stage the MFunding MCA Pipeline</b> or move a card back into{" "}
                  <b>New Lead</b> by hand — the stage ids are wired into the disposition sweep, and
                  New Lead re-fires the speed-to-lead email.
                </li>
                <li className="no">
                  <b>Never let setters start before the four checks in Part C pass.</b>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <footer>
          Internal reference for Momentum Funding · MCA compliance: leads and scripts say funding /
          capital / working capital / advance — never "loan" for an MCA · not a merchant-facing
          document.
        </footer>
      </div>
    </div>
  );
}
