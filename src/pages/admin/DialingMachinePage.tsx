// ─────────────────────────────────────────────────────────────────────────────
// How the Dialing Machine Works
//
// A faithful in-app port of the one-pager the owner signed off on: Lists →
// GoHighLevel → HotProspector → Revenue Playbook. Static reference page — no
// data fetching. The design (Momentum navy/mint/gold tokens, the inline-SVG
// flow diagram, the four system cards, the numbered steps, the GHL↔HotProspector
// vocabulary table) is reproduced 1:1 from the artifact.
//
// Theming: the artifact keyed off prefers-color-scheme / [data-theme]. The app
// drives dark mode with a `dark` class on <html> (see lib/theme-context), so the
// dark token block is scoped to `.dark .dmw` instead — same colors, app's switch.
// The SVG reads those same CSS variables (fills/strokes + the <marker> arrowheads),
// so the diagram follows the theme automatically.
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
.dmw{
  --ink:#0f2942; --ink-soft:#40546b; --ink-faint:#7387a0;
  --ground:#f6f8fb; --panel:#ffffff; --line:#dfe6ee; --line-soft:#eef2f7;
  --accent:#0f9d6b; --accent-ink:#0a7a52; --gold:#c08a2d;
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
  --accent:#2fc98d; --accent-ink:#57d7a5; --gold:#d9ab52;
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
.dmw .n-ghl{stroke:var(--sys-ghl)}
.dmw .n-hp{stroke:var(--sys-hp)}
.dmw .n-close{stroke:var(--sys-close)}
.dmw .n-play{stroke:var(--sys-play);stroke-width:2.6}
.dmw .nt{fill:var(--ink);font-weight:750;font-size:12.5px}
.dmw .nr{fill:var(--ink-soft);font-size:9.7px;font-weight:600}
.dmw .edge{stroke:var(--ink-faint);stroke-width:1.7;fill:none}
.dmw .edge-accent{stroke:var(--sys-play);stroke-width:1.9;fill:none}
.dmw .arrowhead{fill:var(--ink-faint)}
.dmw .arrowhead-a{fill:var(--sys-play)}
.dmw .elabel{fill:var(--ink-soft);font-size:10.5px;font-weight:600}
.dmw .elabel-a{fill:var(--accent-ink);font-size:10.5px;font-weight:700}
.dmw figcaption{font-size:12.5px;color:var(--ink-soft);margin-top:10px;padding-top:9px;border-top:1px solid var(--line-soft)}
/* steps */
.dmw .steps{display:flex;flex-direction:column;gap:0}
.dmw .step{display:grid;grid-template-columns:34px 108px 1fr;gap:14px;align-items:start;padding:13px 0;border-bottom:1px solid var(--line-soft)}
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
.dmw .ok::marker{content:"✅  "}
.dmw .todo::marker{content:"⏳  "}
.dmw footer{margin-top:40px;padding-top:15px;border-top:1px solid var(--line);color:var(--ink-faint);font-size:12px}
`;

// The four systems, in the order the lead travels through them.
const SYSTEMS = [
  {
    cls: "s-list",
    kicker: "The lists",
    name: "Synergy + UCC machine",
    body: (
      <>
        Where leads come from — <b>Synergy</b> live-transfer leads and the merchants your{" "}
        <b>homegrown UCC machine</b> surfaces.
      </>
    ),
  },
  {
    cls: "s-ghl",
    kicker: "The brain",
    name: "GoHighLevel · VibeReach",
    body: (
      <>
        The CRM and <b>system of record</b> — every contact, the pipeline, and the automations
        (workflows) that send docs &amp; follow up.
      </>
    ),
  },
  {
    cls: "s-hp",
    kicker: "The dialer",
    name: "HotProspector",
    body: (
      <>
        Where setters spend the day. You <b>Import a CSV</b> of traced leads into a Group, build a
        Campaign on it, and it power-dials + pops the merchant on a live answer.
      </>
    ),
  },
  {
    cls: "s-play",
    kicker: "The cockpit",
    name: "Revenue Playbook",
    body: (
      <>
        Inside your app. The setter clicks in on a live call and it opens{" "}
        <b>with the deal preloaded</b> — scripts, send-app, Connect-Bank. This is where they work.
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
        A merchant appears — a <b>Synergy</b> live transfer, or a business your <b>UCC machine</b>{" "}
        surfaced.
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
        (BatchData ~$0.06/lead fills phone + email; only DNC/TCPA-clean numbers survive).
      </>
    ),
  },
  {
    where: "UCC Machine",
    cls: "w-list",
    body: (
      <>
        You <b>Export CSV</b> from the UCC Machine — the traced, dialable leads.
      </>
    ),
  },
  {
    where: "→ HotProspector",
    cls: "w-hp",
    body: (
      <>
        <b>This is the key step:</b> HotProspector → <b>Contacts → "Import Leads"</b> → upload the CSV
        → map the columns → import into a <b>per-batch Group</b> (e.g. "UCC 2026-08-10"). The old "it
        auto-syncs from GoHighLevel" idea is <b>not reliable</b> — always Import.
      </>
    ),
  },
  {
    where: "HotProspector",
    cls: "w-hp",
    body: (
      <>
        You build a <b>Dialer Campaign</b> on that Group (Power mode, calling hours, caller-ID,
        statuses) — see the load SOP below. This is what actually dials.
      </>
    ),
  },
  {
    where: "HotProspector",
    cls: "w-hp",
    body: (
      <>
        You <b>assign a setter and Start</b> — only then does it call real businesses (<b>TCPA hours
        enforced</b> per the lead's timezone, 8am–9pm). Until a setter presses Start it sits idle.
      </>
    ),
  },
  {
    where: "→ Playbook",
    cls: "w-play",
    body: (
      <>
        Live answer → the setter opens the <b>Revenue Playbook</b> (deal preloaded), sends the{" "}
        <b>04B e-sign application</b> + the <b>Connect-Bank / upload links</b>, and presses the{" "}
        <b>"Send Application"</b> call-status. "Check your text while I've got you."
      </>
    ),
  },
  {
    where: "→ GoHighLevel",
    cls: "w-ghl",
    body: (
      <>
        The <b>disposition writes back to GoHighLevel</b> (reliable HP→GHL) → fires the follow-up{" "}
        <b>workflow</b> → moves the pipeline. Complete files (<b>signed + bank connected</b>) hand to
        the <b>MCA pipeline</b> for your closers. Watch per-setter KPIs on <b>/admin/dialer</b>.
      </>
    ),
  },
];

// GHL ↔ HotProspector vocabulary. An em dash means the concept doesn't exist there.
const VOCAB: [string, string, string][] = [
  ["Contact", "Lead (in a Group)", "the merchant's record — loaded into HotProspector by CSV Import, not by sync"],
  ["Tag", "Tag", "a label that can trigger an automation"],
  [
    "Pipeline · Stage · Opportunity",
    "— (no pipeline)",
    "where the deal sits in your funnel; HotProspector doesn't have this — the disposition drives it",
  ],
  ["Workflow", "— (fired by a disposition/tag)", "the automation that sends docs & moves stages"],
  ["—", "Group", "HotProspector's bucket of people to dial (Leads / Customers / Unassigned / DNC)"],
  ["—", "Campaign", "the dialing job: a list + calling hours + caller-ID + script + assigned setter"],
  ["—", "Disposition", "the outcome the setter records on a call — see below"],
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
          <h1>Lists → HotProspector → Revenue Playbook → GoHighLevel</h1>
          <p>
            Where a lead comes from, how you <b>load it into the dialer</b> (skip-trace → CSV Import —
            not auto-sync), how a setter works the live call, and how the outcome writes back to the
            CRM. Read the picture first, then the steps, then the load SOP.
          </p>
        </header>

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

        {/* DIAGRAM */}
        <section>
          <div className="sec-h">How they connect</div>
          <figure>
            <svg
              className="diagram"
              viewBox="0 0 720 300"
              role="img"
              aria-label="Leads from Synergy and the UCC machine are skip-traced and exported to CSV, then imported directly into HotProspector; on a live call the setter clicks from HotProspector into the Revenue Playbook, which sends the application and Connect-Bank links and writes the disposition back to GoHighLevel, which fires the follow-up workflow, moves the pipeline, and hands a complete file to the closers."
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
              </defs>

              {/* nodes */}
              <rect className="n n-list" x="14" y="54" width="150" height="60" rx="11" />
              <text className="nt" x="89" y="80" textAnchor="middle">
                Lists
              </text>
              <text className="nr" x="89" y="97" textAnchor="middle">
                Synergy + UCC machine
              </text>

              <rect className="n n-ghl" x="250" y="54" width="200" height="60" rx="11" />
              <text className="nt" x="350" y="80" textAnchor="middle">
                GoHighLevel · VibeReach
              </text>
              <text className="nr" x="350" y="97" textAnchor="middle">
                CRM · pipeline · workflows
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
                deal preloaded · the cockpit
              </text>

              {/* edges */}
              {/* lists -> hotprospector (the load path) */}
              <polyline
                className="edge"
                points="89,114 89,175 251,175 251,206"
                markerEnd="url(#dmw-ar)"
              />
              <text className="elabel" x="96" y="168" textAnchor="start">
                skip-trace → CSV Import
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
                points="536,206 536,150 350,150 350,118"
                markerEnd="url(#dmw-ara)"
              />
              <text className="elabel-a" x="443" y="143" textAnchor="middle">
                sends app + bank · disposition → workflow
              </text>
            </svg>
            <figcaption>
              <b>The one idea:</b> leads reach the dialer by <b>skip-trace → CSV Import</b>, straight
              into a HotProspector Group — <b>not</b> by auto-sync from GoHighLevel (that direction
              silently drops contacts, so we never rely on it). On a live answer the setter{" "}
              <b>clicks from the dialer into the Revenue Playbook</b> with the deal preloaded, sends
              the app + bank links, and the call's outcome <b>writes back to GoHighLevel</b> (that
              direction is reliable) to fire the follow-up and move the pipeline.
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

        {/* LOAD SOP */}
        <section>
          <div className="sec-h">How to load a batch into the dialer (do this every time)</div>

          <div className="warn">
            <b>The one rule:</b> GoHighLevel does <u>not</u> reliably push contacts into
            HotProspector — HP's inbound queue (API / webhook / "Sync Leads") silently accepts new
            leads and drops them. The <b>only</b> proven way to get leads dialing is{" "}
            <b>CSV Import</b>. (The reverse direction, HP → GoHighLevel writeback of dispositions,{" "}
            <b>is</b> reliable — that's why the pipeline still moves itself.)
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">A</span>
              <h3>Get leads into HotProspector</h3>
            </div>
            <ol>
              <li>
                <b>UCC Machine (/admin/ph-ucc)</b> — <b>filter</b> the leads you want (Lead heat,
                Confidence = Confirmed / High, state), then <b>skip-trace</b> the filtered set
                (BatchData ~$0.06/lead — fills phone + email; only DNC/TCPA-clean numbers survive).
              </li>
              <li>
                <b>Export CSV</b> — download the traced, dialable leads from the UCC Machine.
              </li>
              <li>
                <b>HotProspector → Contacts → "Import Leads"</b> → upload the CSV → <b>map columns</b>{" "}
                → import into a <b>per-batch Group</b> (e.g. "UCC 2026-08-10").
              </li>
              <li>
                <b>Verify by opening that Group</b> (the Group filter) — <b>NOT the search box</b>;
                HP's search is broken. If the Group shows your count, the import worked.
              </li>
            </ol>
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">B</span>
              <h3>Build the dialer campaign (tab by tab)</h3>
            </div>
            <ol>
              <li>
                <b>Dialer → New Campaign</b> — 7 tabs; use the green <b>Next</b> button to advance
                (clicking the tab names does not switch tabs).
              </li>
              <li>
                <b>Campaign Settings:</b> name it; <b>Group</b> = the per-batch group (confirm{" "}
                <b>"NN Leads Found" &gt; 0</b>); <b>Mode = Power</b>; Dial attempts 20 / 2-per-day
                (defaults); <b>Dialer Access Hours = Yes</b> → <b>8:00 AM–9:00 PM</b> ("times are the
                lead's timezone" = TCPA).
              </li>
              <li>
                <b>Call Handling:</b> Phone Number (caller ID) = <b>+1 954-860-7138</b>; check the
                call-recording disclaimer box.
              </li>
              <li>
                <b>Call Statuses:</b> ensure standard dispositions <b>+ "Send Application"</b> are
                enabled.
              </li>
              <li>
                <b>Lead Details / Workflows:</b> leave default / empty.
              </li>
              <li>
                <b>Timezone Settings:</b> leave all zones checked; check <b>"selected carefully."</b>
              </li>
              <li>
                <b>Disclaimer:</b> check the box → <b>Next &amp; Create</b> → OK.
              </li>
              <li>
                It now sits <b>IDLE</b> (Last Login "---", 0 attempts) until a setter is assigned and
                presses Start.
              </li>
              <li>
                <b>GO LIVE (deliberate):</b> campaign row → <b>Action</b> → assign-members icon →
                assign the setter → the setter opens Dialer → <b>Start</b>.
              </li>
            </ol>
          </div>
        </section>

        {/* DIALING MODE / LINES */}
        <section>
          <div className="sec-h">How the dialing actually works (3 lines at once)</div>

          <div className="warn">
            <b>Verified in the account 2026-08-11 (live UI + HotProspector's own docs):</b>{" "}
            HotProspector <b>does dial 3 numbers at once</b> — it's included on your{" "}
            <b>Business plan ($297/mo)</b>, no add-on. The catch was the <b>mode name</b>: HP's mode
            called <b>"Power" is one-at-a-time</b> (that's why the earlier test showed a single line).
            The 3-line behavior lives in the mode called <b>"Progressive(M)"</b>, which reveals a{" "}
            <b>"Dialing Leads"</b> field you set to <b>3</b>. It dials 3, connects you to the first
            pickup, drops the other two — and (unlike a predictive dialer) <b>won't fire the next set
            until the setter hangs up</b>, which keeps abandoned calls down.
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">1</span>
              <h3>The two modes (mode LOCKS at creation — pick it up front)</h3>
            </div>
            <ol>
              <li>
                <b>Power</b> = dials <b>one lead at a time</b>. Simplest, zero abandoned calls.
              </li>
              <li>
                <b>Progressive(M)</b> = the <b>3-line</b> mode. Choosing it reveals <b>"Dialing
                Leads"</b> (1 / 2 / 3, max 3) = how many numbers it rings simultaneously. Set it to{" "}
                <b>3</b>. (Progressive-<i>A</i> / predictive is hidden on this account — we don't use
                it.)
              </li>
              <li>
                <b>The mode can't be changed after a campaign is created</b> — to switch, you build a
                new campaign. Our live 3-line campaign is <b>"UCC Power-3 — 2026-08-11"</b>.
              </li>
            </ol>
          </div>

          <div className="sopbox">
            <div className="sop-h">
              <span className="badge">2</span>
              <h3>Build a 3-line campaign (the repeatable click-path)</h3>
            </div>
            <ol>
              <li>
                <b>Dialer → New Campaign.</b> Advance with the green <b>Next</b> button (clicking tab
                names doesn't switch tabs), and note HP <b>creates the campaign as you Next through</b>
                {" "}— it exists before the final screen.
              </li>
              <li>
                <b>Campaign Settings:</b> Name it; <b>Group</b> = the per-batch lead group; <b>Mode =
                Progressive(M)</b> → the <b>Dialing Leads</b> field appears → set it to <b>3</b>;{" "}
                <b>Dialer Access Hours = Yes</b> (defaults to <b>8:00 AM–9:00 PM in the lead's
                timezone</b> = TCPA). ⚠️ Check <b>Maximum Dial Attempts</b> — it can save as 1; set it
                to <b>20</b>.
              </li>
              <li>
                <b>Call Handling:</b> Phone Number (caller ID) = <b>+1 954-860-7138</b>. (Call
                recording — see the callout below; it needs an owner sign-off, so leave it off for
                now.)
              </li>
              <li>
                <b>Call Statuses:</b> confirm <b>"Send Application"</b> is enabled (it's a global,
                account-wide status).
              </li>
              <li>
                <b>Lead Details / Workflows:</b> defaults. <b>Timezone Settings:</b> tick <b>"I have
                selected time zone carefully."</b> <b>Disclaimer:</b> check the box → <b>Create</b>.
              </li>
              <li>
                It sits <b>IDLE</b> until an owner <b>assigns a setter</b> (campaign row → Action →
                assign-members) and the setter presses <b>Start</b>.
              </li>
            </ol>
          </div>

          <div className="warn">
            <b>Call recording is OFF and needs your sign-off.</b> Turning it on (Edit → Call Handling →
            Call Recording = <b>Automatic</b>) pops HP's <b>"Call Recording Disclosure and Consent
            Agreement"</b> — a legal attestation only <b>you</b> can accept. Until you do, calls aren't
            recorded (so no AI call scoring). Enable it when you're ready by accepting that modal.
          </div>

          <div className="callout">
            <b>Answering machines:</b> when a call hits voicemail, the setter drops a pre-recorded
            message with the <b>Voicemail Drop</b> button and moves on — no dead air. Record/manage
            those under <b>Settings → Templates → Voicemail / RVM</b>.
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
        </section>

        {/* STATUS */}
        <section>
          <div className="sec-h">What's live vs. what you set up once</div>
          <div className="two">
            <div className="stbox">
              <h3>✅ Already live</h3>
              <ul>
                <li className="ok">
                  <b>CSV Import is the proven load path</b> — HotProspector → Contacts → "Import
                  Leads" reliably lands leads in a per-batch Group.
                </li>
                <li className="ok">
                  <b>HP → GoHighLevel writeback</b> — dispositions / call outcomes flow up to GHL
                  reliably and fire the follow-up workflows.
                </li>
                <li className="ok">
                  <b>The "UCC 2026-08-10" campaign is built + idle</b> — Group loaded, campaign
                  configured; it starts calling the moment a setter is assigned and presses Start.
                </li>
                <li className="ok">
                  <b>Revenue Playbook cockpit</b> — deal preloads on click; send-app + Connect-Bank +
                  upload links are built and tokenized (send.mfunding.net).
                </li>
                <li className="ok">
                  <b>/admin/dialer scoreboard</b> — per-setter KPIs.
                </li>
              </ul>
            </div>
            <div className="stbox">
              <h3>⚠️ Do NOT rely on this</h3>
              <ul>
                <li className="todo">
                  <b>GoHighLevel → HotProspector contact auto-sync is NOT reliable.</b> HP's inbound
                  queue (API / webhook / "Sync Leads") silently accepts new contacts and then drops
                  them. <b>Always CSV Import.</b> (Only the HP→GHL writeback direction is trustworthy.)
                </li>
                <li className="todo">
                  <b>HotProspector's search box is broken</b> — verify an import by opening the{" "}
                  <b>Group</b> (Group filter), never by searching for a name.
                </li>
                <li className="todo">
                  <b>Per batch (owner):</b> filter + skip-trace in the UCC Machine, Export CSV, Import
                  into a new dated Group, build the Campaign, assign the setter — the SOP above.
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
