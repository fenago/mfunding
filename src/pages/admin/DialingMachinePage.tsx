// ─────────────────────────────────────────────────────────────────────────────
// How the Dialing Machine Works
//
// The CORRECTED end-to-end SOP: Lists → GoHighLevel (tagged) → HotProspector
// (linked sync) → Revenue Playbook → GoHighLevel writeback. Static reference
// page — no data fetching.
//
// ⚠️ Content history: this page previously documented "CSV → import straight
// into HotProspector". That flow is WRONG and broke the setter floor (1,047
// leads loaded that way carried no GoHighLevel id, so the setter's
// "Gohighlevel Custom Link" button errored "Lead data not Synced" on every
// one). Lists must land in GoHighLevel FIRST and reach HotProspector only via
// the tagged Settings → Integrations sync. Do not reintroduce a direct-to-HP
// import path here.
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
  --sys-list:#c08a2d; --sys-ghl:#2f6fb0; --sys-hp:#7c5cd6; --sys-play:#0f9d6b; --sys-close:#2f9e6e;
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
  --sys-list:#d9ab52; --sys-ghl:#6aa6e0; --sys-hp:#a68bf0; --sys-play:#2fc98d; --sys-close:#54c68d;
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
.dmw .sys{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px}
.dmw .syscard{border:1px solid var(--line);border-left-width:4px;border-radius:12px;background:var(--panel);box-shadow:var(--shadow);padding:13px 15px}
.dmw .syscard .k{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint)}
.dmw .syscard .nm{font-weight:750;font-size:15px;margin:2px 0 4px}
.dmw .syscard .ds{font-size:12.5px;color:var(--ink-soft)}
.dmw .s-list{border-left-color:var(--sys-list)}
.dmw .s-ghl{border-left-color:var(--sys-ghl)}
.dmw .s-hp{border-left-color:var(--sys-hp)}
.dmw .s-play{border-left-color:var(--sys-play)}
/* diagram */
.dmw figure{margin:0;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow);padding:18px 18px 12px}
.dmw .diagram{width:100%;height:auto;display:block}
.dmw .n{fill:var(--panel);stroke-width:1.7}
.dmw .n-list{stroke:var(--sys-list)}
.dmw .n-ghl{stroke:var(--sys-ghl);stroke-width:2.6}
.dmw .n-hp{stroke:var(--sys-hp)}
.dmw .n-close{stroke:var(--sys-close)}
.dmw .n-play{stroke:var(--sys-play);stroke-width:2.6}
.dmw .nt{fill:var(--ink);font-weight:750;font-size:12.5px}
.dmw .nr{fill:var(--ink-soft);font-size:9.7px;font-weight:600}
.dmw .edge{stroke:var(--ink-faint);stroke-width:1.7;fill:none}
.dmw .edge-accent{stroke:var(--sys-play);stroke-width:1.9;fill:none}
.dmw .edge-hp{stroke:var(--sys-hp);stroke-width:2.4;fill:none}
.dmw .arrowhead{fill:var(--ink-faint)}
.dmw .arrowhead-a{fill:var(--sys-play)}
.dmw .arrowhead-h{fill:var(--sys-hp)}
.dmw .elabel{fill:var(--ink-soft);font-size:10.5px;font-weight:600}
.dmw .elabel-a{fill:var(--accent-ink);font-size:10.5px;font-weight:700}
.dmw .elabel-h{fill:var(--sys-hp);font-size:10.5px;font-weight:700}
.dmw figcaption{font-size:12.5px;color:var(--ink-soft);margin-top:10px;padding-top:9px;border-top:1px solid var(--line-soft)}
/* steps */
.dmw .steps{display:flex;flex-direction:column;gap:0}
.dmw .step{display:grid;grid-template-columns:34px 122px 1fr;gap:14px;align-items:start;padding:13px 0;border-bottom:1px solid var(--line-soft)}
.dmw .step:last-child{border-bottom:0}
.dmw .num{width:28px;height:28px;border-radius:50%;background:var(--accent);color:var(--num-ink);font-weight:800;font-size:13px;display:grid;place-items:center}
.dmw .where{font-size:10.5px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding:4px 8px;border-radius:6px;text-align:center;align-self:start;margin-top:1px}
.dmw .w-list{background:color-mix(in srgb,var(--sys-list) 16%,transparent);color:var(--sys-list)}
.dmw .w-ghl{background:color-mix(in srgb,var(--sys-ghl) 16%,transparent);color:var(--sys-ghl)}
.dmw .w-hp{background:color-mix(in srgb,var(--sys-hp) 18%,transparent);color:var(--sys-hp)}
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
.dmw tbody td:nth-child(2){font-weight:700;color:var(--sys-hp)}
.dmw .callout{margin-top:14px;border-left:3px solid var(--gold);background:var(--panel);border-radius:0 10px 10px 0;padding:13px 16px;font-size:13.5px;color:var(--ink-soft);box-shadow:var(--shadow)}
.dmw .callout b{color:var(--ink)}
/* cadence table — plain first/second columns, badge in col 2 */
.dmw .tbl-cad tbody td:first-child{color:var(--ink);font-weight:700}
.dmw .tbl-cad tbody td:nth-child(2){color:var(--ink-soft);font-weight:600;white-space:nowrap}
.dmw .cad{display:inline-block;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:6px;white-space:nowrap}
.dmw .cad-once{background:color-mix(in srgb,var(--sys-ghl) 16%,transparent);color:var(--sys-ghl)}
.dmw .cad-batch{background:color-mix(in srgb,var(--gold) 22%,transparent);color:var(--gold)}
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
.dmw footer{margin-top:40px;padding-top:15px;border-top:1px solid var(--line);color:var(--ink-faint);font-size:12px}
`;

// The four systems, in the order the lead travels through them.
const SYSTEMS = [
  {
    cls: "s-list",
    kicker: "The lists",
    name: "UCC machine + bought lists",
    body: (
      <>
        Where leads come from — the merchants your <b>homegrown UCC machine</b> surfaces
        (/admin/ph-ucc) and any <b>purchased list</b> you drop in as a CSV.
      </>
    ),
  },
  {
    cls: "s-ghl",
    kicker: "The brain · loads FIRST",
    name: "GoHighLevel · VibeReach",
    body: (
      <>
        The CRM and <b>system of record</b>. Every list lands here first and gets a{" "}
        <b>batch tag</b>. Nothing reaches the dialer except through here.
      </>
    ),
  },
  {
    cls: "s-hp",
    kicker: "The dialer",
    name: "HotProspector",
    body: (
      <>
        Where setters spend the day. Leads arrive by the <b>tagged GoHighLevel sync</b> — which is
        what makes each one <b>linked</b> (it carries its GHL id) so the setter's button works.
      </>
    ),
  },
  {
    cls: "s-play",
    kicker: "The cockpit",
    name: "Revenue Playbook",
    body: (
      <>
        Inside your app. On a live call the setter clicks{" "}
        <b>"Gohighlevel Custom Link"</b> and it opens <b>with the merchant preloaded</b> — script,
        send-app, Connect-Bank. This is where they work.
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
        A batch appears — either your <b>UCC machine</b> or a <b>purchased list</b> (CSV: First,
        Last, Company, Phone, Email, City, State, Zip).
      </>
    ),
  },
  {
    where: "UCC Machine",
    cls: "w-list",
    body: (
      <>
        In <b>/admin/ph-ucc</b> you <b>filter</b> the leads you want — Lead heat (# of stacked
        advances), Confidence (Confirmed / High), state — then <b>skip-trace</b> the filtered set
        (BatchData ~$0.06/lead fills phone + email; <b>DNC and TCPA-litigator numbers are suppressed
        automatically</b>). Then <b>Export</b>.
      </>
    ),
  },
  {
    where: "→ GoHighLevel",
    cls: "w-ghl",
    body: (
      <>
        <b>Load the list into GoHighLevel FIRST</b> — the <b>VibeReach Contacts → Import</b> flow, or
        an API upsert by phone/email, into the <b>MFunding.net</b> location.{" "}
        <b>Exact clicks are in Part B below.</b> This is also what puts the merchants in VibeReach
        where the rest of the business lives.
      </>
    ),
  },
  {
    where: "GoHighLevel",
    cls: "w-ghl",
    body: (
      <>
        <b>TAG every lead in the batch</b> — e.g. <b>ucc-lead</b>, or a dated tag like{" "}
        <b>ucc-2026-08-12</b>. The tag is <b>not optional</b>: it is the key the HotProspector sync
        reads. No tag = nothing syncs.
      </>
    ),
  },
  {
    where: "→ HotProspector",
    cls: "w-hp",
    body: (
      <>
        <b>The linchpin.</b> HotProspector → <b>Settings → INTEGRATIONS → Go High Level Integration</b>{" "}
        → the <b>MFunding.net</b> row → Step 2 <b>Select Your Tag</b> = the batch tag → Step 3{" "}
        <b>Group to Sync With</b> = the dialer group → <b>Sync Leads</b>. A red{" "}
        <b>"InProgress N%"</b> shows on the row; when it finishes the contacts are in HP{" "}
        <b>linked</b>.
      </>
    ),
  },
  {
    where: "Validate",
    cls: "w-close",
    body: (
      <>
        <b>Before anything else:</b> open one synced contact → click{" "}
        <b>"Gohighlevel Custom Link"</b> (bottom of the right sidebar) → the Revenue Playbook must
        open <b>that merchant with no "not synced" error</b>. If it errors, the lead didn't come
        through GoHighLevel — <b>stop and fix it</b>.
      </>
    ),
  },
  {
    where: "HotProspector",
    cls: "w-hp",
    body: (
      <>
        Build the <b>3-line campaign</b> on that group — <b>Mode = Progressive(M)</b> with{" "}
        <b>Dialing Leads = 3</b>, <b>"TAGS TO DIAL WITHOUT SORTING" ON with the batch tag</b> (this
        is what the dialer actually resolves leads by), caller ID <b>+1 954-860-7138</b>, hours{" "}
        <b>8:00am–9:00pm in the lead's timezone</b> (TCPA), the setter script attached with{" "}
        <b>Autoload</b>. Assign setters on the <b>"Assign To"</b> field in Campaign Settings.
      </>
    ),
  },
  {
    where: "Validate",
    cls: "w-close",
    body: (
      <>
        <b>Owner makes ONE test call</b> — script auto-loads, the button opens the Playbook, the
        disposition writes back to GoHighLevel. <b>Only then do setters start.</b>
      </>
    ),
  },
  {
    where: "→ Playbook",
    cls: "w-play",
    body: (
      <>
        Live answer → setter clicks into the <b>Revenue Playbook</b> (merchant preloaded), sends the{" "}
        <b>e-sign application</b> + the <b>Connect-Bank / upload links</b> while the merchant is on
        the phone. "Check your text while I've got you."
      </>
    ),
  },
  {
    where: "→ GoHighLevel",
    cls: "w-ghl",
    body: (
      <>
        The <b>disposition writes back to GoHighLevel</b> → fires the follow-up <b>workflow</b> →
        moves the pipeline. Complete files (<b>signed + bank connected</b>) hand to the{" "}
        <b>MCA pipeline</b> for your closers. Watch per-setter KPIs on <b>/admin/dialer</b>.
      </>
    ),
  },
];

// GHL ↔ HotProspector vocabulary. An em dash means the concept doesn't exist there.
const VOCAB: [string, string, string][] = [
  [
    "Contact",
    "Lead (in a Group)",
    "the merchant's record — it reaches HotProspector only through the tagged GoHighLevel sync, never by CSV import",
  ],
  [
    "Tag",
    "the sync key",
    "the batch label you put on every lead (e.g. ucc-2026-08-12). It's what Settings → Integrations → Step 2 reads. No tag, no sync.",
  ],
  [
    "Contact ID",
    "the link behind \"Gohighlevel Custom Link\"",
    "the GoHighLevel id a synced lead carries. A lead without one can't open the Playbook — that's the \"Lead data not Synced\" error",
  ],
  [
    "Pipeline · Stage · Opportunity",
    "— (no pipeline)",
    "where the deal sits in your funnel; HotProspector doesn't have this — the disposition drives it",
  ],
  ["Workflow", "— (fired by a disposition/tag)", "the automation that sends docs & moves stages"],
  ["—", "Group", "HotProspector's bucket of people to dial — the sync's destination, and what a campaign dials"],
  ["—", "Campaign", "the dialing job: a group + mode + calling hours + caller-ID + script + assigned setters"],
  ["—", "Disposition", "the outcome the setter records on a call — see below"],
];

// What is already built and never touched again, vs. what you redo for every
// single batch. `once` = set up once and left alone; `batch` = a fresh one for
// each list you run.
const SETUP_MATRIX: { thing: React.ReactNode; cadence: "once" | "batch"; note: React.ReactNode }[] =
  [
    {
      thing: (
        <>
          HotProspector ↔ GoHighLevel <b>integration connection</b>
        </>
      ),
      cadence: "once",
      note: (
        <>
          <b>Already connected</b> to the <b>MFunding.net</b> location and shows as a row under
          HP <b>Settings → INTEGRATIONS → Go High Level Integration</b>.{" "}
          <b>Never disconnect or re-add it</b> — you only ever change Step 2 / Step 3 on that row.
        </>
      ),
    },
    {
      thing: (
        <>
          HP <b>Custom URL</b> = <b>https://mfunding.net/admin/playbooks?x=</b>
        </>
      ),
      cadence: "once",
      note: (
        <>
          <b>Already set.</b> This is the setting that makes the setter's{" "}
          <b>"Gohighlevel Custom Link"</b> button open the Revenue Playbook on the right merchant.
          Don't edit it.
        </>
      ),
    },
    {
      thing: (
        <>
          <b>Setter Team seats</b> in HotProspector + their <b>mfunding.net logins</b>
        </>
      ),
      cadence: "once",
      note: (
        <>
          <b>One-time per setter</b>, not per batch. New setter = create the HP team user{" "}
          <b>and</b> the mfunding.net login once; after that they just get assigned to each new
          campaign.
        </>
      ),
    },
    {
      thing: (
        <>
          The <b>call script</b> template
        </>
      ),
      cadence: "once",
      note: (
        <>
          <b>"UCC Setter Script — Momentum"</b> is built once and <b>reused on every campaign</b>.
          Edit the wording whenever you want — you do not create a new script per batch.
        </>
      ),
    },
    {
      thing: (
        <>
          The <b>batch TAG</b> in GoHighLevel
        </>
      ),
      cadence: "batch",
      note: (
        <>
          <b>A NEW dated tag for every list</b> — e.g. <b>ucc-2026-08-20</b>. This is the key the
          HotProspector sync reads. <b>Never reuse an old batch tag.</b>
        </>
      ),
    },
    {
      thing: (
        <>
          <b>GoHighLevel import</b> of the list (with that tag on it)
        </>
      ),
      cadence: "batch",
      note: (
        <>
          Every batch gets loaded into the <b>MFunding.net</b> location first, tagged during the
          import. See <b>Part B</b> for the exact clicks.
        </>
      ),
    },
    {
      thing: (
        <>
          HP <b>group</b>
        </>
      ),
      cadence: "batch",
      note: (
        <>
          <b>Create one group per batch</b> — e.g. <b>"UCC 2026-08-20"</b> — so counts, campaigns
          and reporting stay clean per list.
        </>
      ),
    },
    {
      thing: (
        <>
          HP integration row: <b>Step 2 tag + Step 3 group + Sync Leads</b>
        </>
      ),
      cadence: "batch",
      note: (
        <>
          You <b>re-point the same existing row</b> at this batch's tag and this batch's group, then
          hit <b>Sync Leads</b>. See <b>Part C</b>.
        </>
      ),
    },
    {
      thing: (
        <>
          <b>Dialer campaign</b>
        </>
      ),
      cadence: "batch",
      note: (
        <>
          <b>A new campaign per batch</b> — the <b>mode LOCKS at creation</b>, so campaigns aren't
          re-editable into a different shape. Name it after the batch, point it at this batch's
          group, <b>set this batch's tag under "TAGS TO DIAL WITHOUT SORTING"</b>, and{" "}
          <b>assign the setters on it</b>. See <b>Part D</b>.
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
          <b>Every single batch</b>, before setters dial: the Custom Link opens the Playbook, the
          Dialer LIST view shows the real count, and the owner makes one test call.{" "}
          <b>Parts C-5 and E.</b>
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
          <h1>Lists → GoHighLevel → HotProspector → Revenue Playbook</h1>
          <p>
            Where a lead comes from, how it gets <b>loaded into GoHighLevel and tagged</b>, how the
            tag syncs it down into the dialer <b>linked</b>, how a setter works the live call, and
            how the outcome writes back to the CRM. Read the rule, then the picture, then the SOP.
          </p>
        </header>

        {/* THE RULE */}
        <section>
          <div className="warn danger">
            <b>THE ONE ARCHITECTURE RULE — lists load into GoHighLevel FIRST, then sync down into
            HotProspector.</b>{" "}
            GoHighLevel is the system of record. <u>Never import a list directly into
            HotProspector.</u>{" "}
            Leads loaded that way have <b>no GoHighLevel id</b>, so the setter's{" "}
            <b>"Gohighlevel Custom Link"</b> button errors <b>"Lead data not Synced"</b> on every
            single one and the setter has no cockpit. That is exactly what happened: <b>1,047 leads
            CSV'd straight into HotProspector</b>, a dead floor, and a day lost. Every batch goes{" "}
            <b>list → GoHighLevel (tagged) → sync → dialer</b>. No exceptions.
          </div>
        </section>

        {/* SYSTEMS */}
        <section>
          <div className="sec-h">The four systems &amp; what each one is for</div>
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
            <b>The short version:</b> the <b>plumbing is already built</b> — the HP↔GHL connection,
            the Custom URL, the setter seats and the script. <b>What you redo for every list</b> is:
            a <b>new dated tag</b>, a <b>GHL import carrying that tag</b>, a <b>new HP group</b>,{" "}
            <b>re-point the integration row and Sync</b>, a <b>new campaign</b>, and the{" "}
            <b>validation clicks</b>. Six things. Nothing else gets touched.
          </div>
        </section>

        {/* DIAGRAM */}
        <section>
          <div className="sec-h">How they connect</div>
          <figure>
            <svg
              className="diagram"
              viewBox="0 0 720 300"
              role="img"
              aria-label="Lists from the UCC machine or a purchased file are loaded into GoHighLevel first and tagged. The tagged contacts sync down into HotProspector, arriving linked with their GoHighLevel id. On a live call the setter clicks from HotProspector into the Revenue Playbook, which sends the application and Connect-Bank links and writes the disposition back to GoHighLevel, which fires the follow-up workflow, moves the pipeline, and hands a complete file to the closers."
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
                  id="dmw-arh"
                  viewBox="0 0 10 10"
                  refX="8.5"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path className="arrowhead-h" d="M0,0 L10,5 L0,10 z" />
                </marker>
              </defs>

              {/* nodes */}
              <rect className="n n-list" x="14" y="54" width="150" height="60" rx="11" />
              <text className="nt" x="89" y="80" textAnchor="middle">
                Lists
              </text>
              <text className="nr" x="89" y="97" textAnchor="middle">
                UCC machine · bought lists
              </text>

              <rect className="n n-ghl" x="250" y="54" width="200" height="60" rx="11" />
              <text className="nt" x="350" y="80" textAnchor="middle">
                GoHighLevel · VibeReach
              </text>
              <text className="nr" x="350" y="97" textAnchor="middle">
                system of record · loads FIRST
              </text>

              <rect className="n n-close" x="548" y="54" width="158" height="60" rx="11" />
              <text className="nt" x="627" y="80" textAnchor="middle">
                MCA Pipeline
              </text>
              <text className="nr" x="627" y="97" textAnchor="middle">
                your closers
              </text>

              <rect className="n n-hp" x="176" y="210" width="158" height="60" rx="11" />
              <text className="nt" x="255" y="236" textAnchor="middle">
                HotProspector
              </text>
              <text className="nr" x="255" y="253" textAnchor="middle">
                the dialer
              </text>

              <rect className="n n-play" x="430" y="210" width="212" height="60" rx="11" />
              <text className="nt" x="536" y="236" textAnchor="middle">
                Revenue Playbook
              </text>
              <text className="nr" x="536" y="253" textAnchor="middle">
                merchant preloaded · the cockpit
              </text>

              {/* edges */}
              {/* lists -> GHL (load + tag) */}
              <line className="edge" x1="164" y1="84" x2="246" y2="84" markerEnd="url(#dmw-ar)" />
              <text className="elabel" x="205" y="76" textAnchor="middle">
                load + TAG
              </text>
              {/* GHL -> hotprospector (the tagged sync — the linchpin) */}
              <polyline
                className="edge-hp"
                points="300,114 300,162 255,162 255,206"
                markerEnd="url(#dmw-arh)"
              />
              <text className="elabel-h" x="292" y="154" textAnchor="end">
                tagged sync → leads arrive LINKED
              </text>
              {/* ghl -> closers */}
              <line className="edge" x1="450" y1="84" x2="544" y2="84" markerEnd="url(#dmw-ar)" />
              <text className="elabel" x="497" y="76" textAnchor="middle">
                handoff
              </text>
              {/* hp -> playbook */}
              <line
                className="edge-accent"
                x1="334"
                y1="240"
                x2="426"
                y2="240"
                markerEnd="url(#dmw-ara)"
              />
              <text className="elabel-a" x="380" y="232" textAnchor="middle">
                clicks in
              </text>
              {/* playbook -> ghl (disposition writeback) */}
              <polyline
                className="edge-accent"
                points="536,206 536,140 350,140 350,118"
                markerEnd="url(#dmw-ara)"
              />
              <text className="elabel-a" x="443" y="133" textAnchor="middle">
                sends app + bank · disposition → workflow
              </text>
            </svg>
            <figcaption>
              <b>The one idea:</b> every list goes into <b>GoHighLevel first</b> and gets a{" "}
              <b>batch tag</b>; that tag is what pulls the contacts down into HotProspector{" "}
              <b>linked</b> — carrying the GoHighLevel id that makes the setter's{" "}
              <b>"Gohighlevel Custom Link"</b> button open the Revenue Playbook. A lead that skipped
              GoHighLevel has no id and <b>cannot be worked</b>. On a live answer the setter clicks
              from the dialer into the Playbook, sends the app + bank links, and the call's outcome{" "}
              <b>writes back to GoHighLevel</b> to fire the follow-up and move the pipeline.
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
          <div className="sec-h">Pitfalls — each of these cost us hours</div>
          <div className="stbox">
            <ul>
              <li className="no">
                <b>Importing a CSV directly into HotProspector.</b> Those leads have{" "}
                <b>no GoHighLevel link</b>, so the setter's button errors on every one.{" "}
                <b>Always load through GoHighLevel.</b>
              </li>
              <li className="no">
                <b>Running the sync with no tag.</b> Step 2 <b>Select Your Tag</b> is required —
                without it <b>Sync Leads is a silent no-op</b>. The error toast ("Tag for selected
                row not to be empty") flashes for a second and vanishes. <b>This cost a full day.</b>
              </li>
              <li className="no">
                <b>The "Sync Leads" button on the CONTACTS toolbar is a decoy</b> — it syncs field
                definitions, not contacts. The real one is in{" "}
                <b>Settings → Integrations → the MFunding.net row</b>.
              </li>
              <li className="no">
                <b>HotProspector's contact SEARCH box is broken</b> — verify a batch with the{" "}
                <b>Tags filter</b> (Contacts → Search Filter → Tags), never by searching a name.
              </li>
              <li className="no">
                <b>Campaign shows "Leads Found: 0" even though the group is full.</b> The campaign
                must <b>ALSO have the batch tag set under "TAGS TO DIAL WITHOUT SORTING"</b> — a
                group-only campaign reads HotProspector's <b>broken group index</b> and finds
                nothing. Set the tag; the count appears.
              </li>
              <li className="no">
                <b>HotProspector silently reverts some campaign edits after Save and Close.</b>{" "}
                <b>Always REOPEN the campaign after saving</b> and confirm your change actually
                stuck.
              </li>
              <li className="no">
                <b>"Power" mode is ONE line.</b> The 3-line mode is <b>Progressive(M)</b> with{" "}
                <b>Dialing Leads = 3</b>, and the <b>mode locks at creation</b> — pick it up front or
                build a new campaign.
              </li>
              <li className="no">
                <b>Reusing an old batch tag.</b> A <b>batch tag is per-batch</b> — dated, one list,
                never recycled. Point Step 2 at an old tag and the <b>re-sync re-pulls that whole old
                batch</b> into this batch's group, and your setters spend the day re-dialing people
                you already called.
              </li>
            </ul>
          </div>
        </section>

        {/* SOP */}
        <section>
          <div className="sec-h">
            How to run a batch, start to finish — every part below is per-batch
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">A</span>
              <h3>Get the list</h3>
              <span className="cadline cad cad-batch">Every batch</span>
            </div>
            <ol>
              <li>
                <b>UCC Machine (/admin/ph-ucc)</b> — <b>filter</b> the leads you want (Lead heat,
                Confidence = Confirmed / High, state), <b>skip-trace</b> the filtered set (BatchData{" "}
                <b>~$0.06/lead</b> — fills phone + email; <b>DNC and TCPA-litigator numbers are
                suppressed automatically</b>), then <b>export</b>.
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
              <h3>Load into GoHighLevel / VibeReach — and TAG it</h3>
              <span className="cadline cad cad-batch">Every batch</span>
            </div>

            <div className="opt">
              Option 1 — the VibeReach UI import (the standard way, no engineer needed)
            </div>
            <ol>
              <li>
                Go to <b>app.vibereach.io</b> and make sure you are in the <b>MFunding.net</b>{" "}
                location — use the <b>location switcher at the top</b>. If you're in the wrong
                location the contacts land somewhere the dialer can't see them.
              </li>
              <li>
                Left menu → <b>Contacts</b> → on the top toolbar click the <b>Import</b> icon (the{" "}
                <b>cloud-with-an-arrow</b>) → <b>Import Contacts</b>.
              </li>
              <li>
                <b>Upload the CSV.</b> Columns: <b>First Name, Last Name, Business Name, Phone,
                Email, City, State, Postal Code</b>. → <b>Next</b>.
              </li>
              <li>
                <b>Map the columns</b> to GoHighLevel fields — First Name → <b>First Name</b>, Last
                Name → <b>Last Name</b>, Company → <b>Business Name</b>, Phone → <b>Phone</b>, Email
                → <b>Email</b>, City / State / Postal Code to their matching fields. → <b>Next</b>.
              </li>
              <li>
                On the import-options screen, <b>add a TAG to all imported contacts</b> — type the{" "}
                <b>NEW batch tag</b>, e.g. <b>ucc-2026-08-20</b> (<b>dated, one per batch</b> — this
                is the exact tag HotProspector will sync on). Set the <b>dedupe preference</b> to{" "}
                <b>update existing contacts by email/phone</b> so you don't create duplicate
                merchants.
              </li>
              <li>
                <b>Start Import</b> → wait for it to finish. Then <b>verify</b>: Contacts →{" "}
                <b>filter by that tag</b> → the count must match your list. If the tag shows{" "}
                <b>0 contacts</b>, the tag didn't apply — <b>redo the import; do not go to Part C.</b>
              </li>
            </ol>

            <div className="opt second">
              Option 2 — ask Claude / engineering to push it by API (what we do for UCC Machine
              batches)
            </div>
            <ol>
              <li>
                Say: <b>"push batch X to GHL with tag Y."</b> The UCC Machine's skip-traced leads get{" "}
                <b>upserted into the MFunding.net location by phone/email</b> with the batch tag
                applied — <b>no CSV handling, no manual mapping, no duplicate merchants</b>.
              </li>
              <li>
                You still <b>verify the same way</b>: Contacts → filter by the tag → the count
                matches.
              </li>
            </ol>

            <div className="callout">
              <b>Why the tag matters — this is the whole ballgame.</b> HotProspector's sync pulls{" "}
              <b>ONLY the contacts carrying the tag you pick in Step 2</b> of the integration row.{" "}
              <b>No tag on the contacts = nothing to sync</b>, and the sync will look like it ran and
              did nothing. The tag is also what puts the merchants in <b>VibeReach</b>, where the
              workflows, conversations and pipeline live.
            </div>
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">C</span>
              <h3>Sync GoHighLevel → HotProspector (the linchpin)</h3>
              <span className="cadline cad cad-batch">Every batch</span>
            </div>
            <ol>
              <li>
                Go to <b>app.hotprospector.com</b> → <b>top-right avatar</b> → <b>Settings</b> → the{" "}
                <b>INTEGRATIONS</b> tab → the card titled <b>"Go High Level Integration"</b> → click{" "}
                <b>"Go High Level Integration"</b>. That opens the <b>Integration wizard page</b>,
                which lists the connected locations as rows. <b>The connection already exists — you
                are only changing two dropdowns on the MFunding.net row.</b>
              </li>
              <li>
                On the <b>MFunding.net</b> row, <b>Step 2 "Select Your Tag"</b> → click the box → a
                dropdown opens with a <b>tiny search box</b> at the top → type this batch's tag (e.g.{" "}
                <b>ucc-2026-08-20</b>) → <b>click the tag</b> to select it. ⚠️ <b>If the tag doesn't
                appear</b>, HotProspector's copy of the tag list is stale: <b>avatar menu → Quick
                Links → "Refresh Meta"</b>, then come back and retry.
              </li>
              <li>
                <b>Step 3 "Group to Sync With"</b> → pick <b>this batch's HP group</b>. If it doesn't
                exist yet, create it first: <b>Contacts → "Create Group"</b> → name it after the
                batch, e.g. <b>"UCC 2026-08-20"</b> — then come back to this row.
              </li>
              <li>
                <b>Step 4</b> → click <b>"Sync Leads"</b>. The row shows a red{" "}
                <b>"InProgress N%"</b> — <b>wait for it to finish.</b> ⚠️ <b>The toasts lie here:</b>{" "}
                you may see <b>"No Leads Found"</b> while it is in fact syncing. <b>Judge by the
                CONTACT COUNT instead</b> — the Contacts page header (<b>"Showing 0-25 of N"</b>)
                should grow by roughly your batch size.
              </li>
              <li>
                <b>VALIDATE — mandatory, before anything else.</b> Go to <b>Contacts</b> → open one
                of the <b>new arrivals</b> (sort/spot by <b>Last Updated = minutes ago</b>) → the
                contact card must show <b>"Location Name : MFunding.net"</b> underneath the email →
                then click <b>"Gohighlevel Custom Link"</b> at the <b>bottom of the right
                sidebar</b> (it has an ↗ icon) → the <b>MFunding Revenue Playbook must open that
                merchant</b>. If it errors <b>"Lead data not Synced"</b>, that lead did NOT come
                through GoHighLevel — <b>stop and re-check Parts B and C.</b>
              </li>
              <li>
                <b>Count the batch by its TAG, not by the group.</b> In HotProspector go to{" "}
                <b>Contacts → Search Filter → Tags</b> → pick this batch's tag — that count is the{" "}
                <b>authoritative lead count</b> for the batch.{" "}
                <b>Group counts are not reliable</b> (HP's group index is broken account-wide), so
                never validate a batch off a group number.
              </li>
            </ol>
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">D</span>
              <h3>Build the 3-line campaign — a NEW one for this batch</h3>
              <span className="cadline cad cad-batch">Every batch</span>
            </div>
            <div className="warn">
              <b>You build a NEW campaign for every batch.</b> You do not reuse or re-point an old
              one, because <b>the dialing mode LOCKS at creation</b> and the lead set is tied to the
              group. So each batch: <b>Dialer → New Campaign</b> → <b>name it after the batch</b>{" "}
              (e.g. "UCC 2026-08-20") → <b>Group = this batch's group</b> →{" "}
              <b>Mode = Progressive(M)</b> → <b>Dialing Leads = 3</b> → <b>assign the setters on
              it</b>. The details are below.
            </div>
            <ol>
              <li>
                <b>Dialer → New Campaign</b> → <b>name it after the batch</b> (e.g.{" "}
                <b>"UCC 2026-08-20"</b> — matching the group name keeps the floor from dialing last
                week's list). Advance with the green <b>Next</b> button (clicking tab names doesn't
                switch tabs), and note HP <b>creates the campaign as you click Next</b> — it exists
                before you reach the final screen.
              </li>
              <li>
                <b>Mode = Progressive(M)</b> — this is the 3-at-once mode. Selecting it reveals{" "}
                <b>"Dialing Leads"</b> → <b>set it to 3</b> (rings 3 simultaneously, connects the
                first answer, drops the others). <b>"Power" = one at a time — NOT what we run.</b>{" "}
                ⚠️ <b>The mode LOCKS after creation.</b>
              </li>
              <li>
                <b>Group = this batch's group</b> — the one you just synced into in Part C, not last
                batch's. <b>Caller ID = +1 954-860-7138.</b>{" "}
                <b>Dialer Access Hours = 8:00am–9:00pm</b> in the <b>lead's timezone</b> (that's
                TCPA).
              </li>
              <li>
                ⚠️ <b>Then toggle ON "TAGS TO DIAL WITHOUT SORTING" and select this batch's tag</b>{" "}
                (the same dated tag from Part B, e.g. <b>ucc-2026-08-20</b>).{" "}
                <u>
                  The tag is what the dialer actually resolves leads by — the group alone cannot be
                  trusted, because HotProspector's group counters are broken account-wide.
                </u>{" "}
                The <b>"Leads Found"</b> count should jump to your batch size the moment you pick the
                tag. <b>If it still reads 0, the tag isn't set — do not proceed.</b>
              </li>
              <li>
                <b>Call Statuses:</b> turn on <b>"Send Application"</b>.
              </li>
              <li>
                <b>Script:</b> attach <b>"UCC Setter Script — Momentum"</b> with{" "}
                <b>Autoload on dialer screen</b> checked.
              </li>
              <li>
                <b>Assign setters on the "Assign To" field in Campaign Settings</b> — not an "Action
                menu" item. The <b>account owner has access implicitly</b> and won't appear in that
                list.
              </li>
              <li>
                ⚠️ <b>Check Maximum Dial Attempts</b> — it can save as <b>1</b>. Set it to <b>20</b>.
              </li>
              <li>
                ⚠️ <b>REOPEN the campaign after "Save and Close" and confirm every setting stuck</b>{" "}
                — HotProspector <b>silently reverts some edits on save</b>. Re-check the tag, the
                mode, Dialing Leads and Maximum Dial Attempts.
              </li>
              <li>
                ⚠️ If the Edit screen shows <b>"0 Leads Found"</b> while the group is loaded, treat it
                as a <b>missing tag, not a display bug</b> — set the batch tag under{" "}
                <b>"TAGS TO DIAL WITHOUT SORTING"</b>. Cross-check the real number against the{" "}
                <b>batch-tag count in GoHighLevel</b> and the <b>Dialer LIST view</b>.
              </li>
              <li>
                <b>Call recording</b> requires the <b>owner</b> to accept HotProspector's consent
                agreement: <b>Edit → Call Handling → Automatic → Agree</b>. Until then, no recordings
                (and no AI call scoring).
              </li>
            </ol>
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">E</span>
              <h3>Validate end to end — never skip this</h3>
              <span className="cadline cad cad-batch">Every batch</span>
            </div>
            <ol>
              <li>
                A synced lead's <b>"Gohighlevel Custom Link"</b> opens the Revenue Playbook on that
                merchant.
              </li>
              <li>
                The campaign's <b>"Leads Found"</b> is non-zero (i.e. the batch tag is set on it) and
                the <b>Dialer LIST view</b> shows the <b>real lead count</b>, matching the{" "}
                <b>batch-tag count in Contacts</b>.
              </li>
              <li>
                <b>The owner makes ONE test call:</b> the script auto-loads → the button opens the
                Playbook → the disposition <b>writes back to GoHighLevel</b>.
              </li>
              <li>
                <b>Only then do setters start.</b> This is the lesson from the dead floor — three
                minutes of checking beats a lost day.
              </li>
            </ol>
            <div className="callout">
              <b>Ignore HotProspector's "Pipeline Status: Unassigned" column.</b> On the HP Contacts
              list every synced lead shows <b>Pipeline Status: Unassigned</b>. That is{" "}
              <b>HotProspector's own internal pipeline feature, which our flow does not use</b> —{" "}
              <b>"Unassigned" there is normal and is not a broken sync</b>. The real pipeline is the{" "}
              <b>12 stages inside the MFunding Revenue Playbook</b> (and the GoHighLevel pipeline
              behind it). Never troubleshoot against that column.
            </div>
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">F</span>
              <h3>The setter's daily flow</h3>
              <span className="cadline cad cad-once">Every day, no setup</span>
            </div>
            <ol>
              <li>
                <b>Google Chrome.</b> Log into <b>both</b> app.hotprospector.com <b>and</b>{" "}
                mfunding.net in the <b>same window</b>.
              </li>
              <li>
                <b>Dialer → the campaign → green ▶</b> → tick the timezone confirmation →{" "}
                <b>Start Dialing</b> (3 lines).
              </li>
              <li>
                <b>On answer:</b> the script auto-loads → click <b>"Gohighlevel Custom Link"</b> →
                the Revenue Playbook opens with the merchant loaded → <b>send the application +
                Connect Bank live on the call</b>.
              </li>
              <li>
                <b>Record the disposition</b> — it writes back to GoHighLevel and fires the
                workflows.
              </li>
              <li>
                <b>Backstop if the button ever errors:</b> copy the merchant's phone number (it's in
                the script) → <b>mfunding.net/admin/playbooks</b> →{" "}
                <b>"Open a merchant by phone"</b> box → <b>Open</b>.
              </li>
            </ol>
          </div>
        </section>

        {/* VOCAB */}
        <section>
          <div className="sec-h">The words, translated</div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>GoHighLevel (VibeReach)</th>
                  <th>HotProspector</th>
                  <th>What it actually is</th>
                </tr>
              </thead>
              <tbody>
                {VOCAB.map(([ghl, hp, what]) => (
                  <tr key={what}>
                    <td>{ghl}</td>
                    <td>{hp}</td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="callout">
            <b>What's a "disposition"?</b> Just the <b>outcome label for a call</b> — "sent
            application," "appointment set," "not interested," "no answer," "bad number." It's how
            the systems know what happened so the right follow-up fires. In your setup the setter
            mostly just <b>works the Revenue Playbook</b>; the outcome of that call becomes the
            disposition that flows back to GoHighLevel automatically — they're not stopping to fill
            out a form.
          </div>
          <div className="callout">
            <b>Answering machines:</b> when a call hits voicemail, the setter drops a pre-recorded
            message with the <b>Voicemail Drop</b> button and moves on — no dead air. Record/manage
            those under <b>Settings → Templates → Voicemail / RVM</b>.
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
                  <b>Tagged GoHighLevel → HotProspector sync</b> — Settings → Integrations → tag +
                  group + Sync Leads lands contacts in HP <b>linked</b>.
                </li>
                <li className="ok">
                  <b>"Gohighlevel Custom Link" opens the Revenue Playbook</b> on a synced lead, with
                  the merchant preloaded.
                </li>
                <li className="ok">
                  <b>HP → GoHighLevel writeback</b> — dispositions flow up to GHL and fire the
                  follow-up workflows.
                </li>
                <li className="ok">
                  <b>3 lines at once</b> — Progressive(M) with Dialing Leads = 3, on the Business
                  plan, no add-on.
                </li>
                <li className="ok">
                  <b>Revenue Playbook cockpit</b> — send-app + Connect-Bank + upload links, tokenized
                  (send.mfunding.net). <b>/admin/dialer</b> for per-setter KPIs, and{" "}
                  <b>/admin/playbooks</b> "open by phone" as the backstop.
                </li>
              </ul>
            </div>
            <div className="stbox">
              <h3>⛔ Never do this</h3>
              <ul>
                <li className="no">
                  <b>Never import a list straight into HotProspector.</b> No GoHighLevel id → the
                  setter's button errors on every lead → dead floor.
                </li>
                <li className="no">
                  <b>Never run the sync without the Step-2 tag</b> — it's a silent no-op and you'll
                  think the batch loaded.
                </li>
                <li className="no">
                  <b>Never build a campaign on the group alone</b> — it must also carry the batch tag
                  under <b>"TAGS TO DIAL WITHOUT SORTING"</b>, or it dials nothing.
                </li>
                <li className="no">
                  <b>Never trust HP's search box or any group count</b> — the authoritative count is
                  the <b>batch tag</b> (Contacts → Search Filter → Tags).
                </li>
                <li className="no">
                  <b>Never let setters start before the three end-to-end checks pass</b> (SOP E).
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
