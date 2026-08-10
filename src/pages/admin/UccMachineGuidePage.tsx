// ─────────────────────────────────────────────────────────────────────────────
// How the UCC Lead Machine Works
//
// A faithful in-app port of the one-pager: Source → Match → Build & Score →
// Skip-Trace → Activate. Static reference page — no data fetching. This is the
// EXPLAINER; the operational console lives at /admin/ph-ucc ("UCC Machine").
//
// The design (Momentum navy/mint/gold tokens, the inline-SVG 5-stage pipeline,
// the per-stage cards, the outside-services grid, the cost/gates strip) is
// reproduced 1:1 from the artifact.
//
// Theming: the artifact keyed off prefers-color-scheme / [data-theme]. The app
// drives dark mode with a `dark` class on <html> (see lib/theme-context), so the
// dark token block is scoped to `.dark .umw` instead — same colors, app's switch.
// The SVG reads those same CSS variables (fills/strokes + the <marker>
// arrowhead), so the diagram follows the theme automatically.
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
.umw{
  --ink:#0f2942; --ink-soft:#40546b; --ink-faint:#7387a0;
  --ground:#f6f8fb; --panel:#ffffff; --line:#dfe6ee; --line-soft:#eef2f7;
  --accent:#0f9d6b; --accent-ink:#0a7a52; --gold:#c08a2d;
  --s-source:#c08a2d; --s-match:#2f6fb0; --s-build:#7c5cd6; --s-trace:#c26a1e; --s-active:#0f9d6b;
  --badge-ink:#ffffff;
  --shadow:0 1px 2px rgba(15,41,66,.06),0 5px 18px rgba(15,41,66,.05);
  --radius:14px;
  background:var(--ground);color:var(--ink);min-height:100%;
  font-family:-apple-system,"SF Pro Text",system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  line-height:1.5;-webkit-font-smoothing:antialiased;
}
.dark .umw{
  --ink:#e8eef5; --ink-soft:#a9b8c8; --ink-faint:#8095a8;
  --ground:#0b1620; --panel:#111e2b; --line:#24313f; --line-soft:#18242f;
  --accent:#2fc98d; --accent-ink:#57d7a5; --gold:#d9ab52;
  --s-source:#d9ab52; --s-match:#6aa6e0; --s-build:#a68bf0; --s-trace:#e0954a; --s-active:#2fc98d;
  --badge-ink:#08131c;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.25);
}
.umw *{box-sizing:border-box}
.umw .wrap{max-width:1080px;margin:0 auto;padding:34px 22px 72px}
.umw h1,.umw h2,.umw h3{text-wrap:balance;letter-spacing:-.02em;margin:0}
.umw .eyebrow{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-ink)}
.umw header{border-bottom:2px solid var(--line);padding-bottom:20px;margin-bottom:28px}
.umw .brandrow{display:flex;align-items:center;gap:10px}
.umw .logo{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,var(--accent),var(--gold));display:inline-block;box-shadow:var(--shadow)}
.umw .brandname{font-weight:800}
.umw header h1{font-size:clamp(25px,3.6vw,34px);font-weight:800;margin:.3em 0 .12em;line-height:1.05}
.umw header p{margin:0;color:var(--ink-soft);max-width:76ch;font-size:15px}
.umw section{margin-top:34px}
.umw .sec-h{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:14px}
/* diagram */
.umw figure{margin:0;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);box-shadow:var(--shadow);padding:18px 16px 12px}
.umw .diagram{width:100%;height:auto;display:block}
.umw .n{fill:var(--panel);stroke-width:1.8}
.umw .n-source{stroke:var(--s-source)}
.umw .n-match{stroke:var(--s-match)}
.umw .n-build{stroke:var(--s-build)}
.umw .n-trace{stroke:var(--s-trace)}
.umw .n-active{stroke:var(--s-active)}
.umw .nt{fill:var(--ink);font-weight:750;font-size:12px}
.umw .nr{fill:var(--ink-soft);font-size:9.5px;font-weight:600}
.umw .edge{stroke:var(--ink-faint);stroke-width:1.8;fill:none}
.umw .arrowhead{fill:var(--ink-faint)}
.umw .elabel{fill:var(--ink-soft);font-size:9.5px;font-weight:600}
.umw .lock{font-size:12px}
.umw figcaption{font-size:12.5px;color:var(--ink-soft);margin-top:10px;padding-top:9px;border-top:1px solid var(--line-soft)}
/* stage cards */
.umw .stage{display:grid;grid-template-columns:40px 1fr;gap:14px;padding:15px 0;border-bottom:1px solid var(--line-soft)}
.umw .stage:last-child{border-bottom:0}
.umw .badge{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-weight:800;font-size:15px;color:var(--badge-ink)}
.umw .b-source{background:var(--s-source)}
.umw .b-match{background:var(--s-match)}
.umw .b-build{background:var(--s-build)}
.umw .b-trace{background:var(--s-trace)}
.umw .b-active{background:var(--s-active)}
.umw .stage h3{font-size:15.5px;font-weight:800;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.umw .gatechip{font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--s-trace);background:color-mix(in srgb,var(--s-trace) 16%,transparent);padding:3px 8px;border-radius:6px}
.umw .stage p{margin:6px 0 8px;font-size:13.5px;color:var(--ink-soft)}
.umw .stage p b{color:var(--ink)}
.umw .meta{display:flex;flex-wrap:wrap;gap:6px}
.umw .tag{font-size:10.5px;font-weight:600;font-family:ui-monospace,Menlo,monospace;padding:3px 8px;border-radius:6px;background:var(--line-soft);color:var(--ink-soft)}
/* services */
.umw .svc{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.umw .svccard{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow);padding:13px 15px}
.umw .svccard .nm{font-weight:750;font-size:14px}
.umw .svccard .role{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-faint);margin:1px 0 5px}
.umw .svccard .ds{font-size:12.5px;color:var(--ink-soft)}
/* gates strip */
.umw .gates{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}
.umw .gate{border:1px solid var(--line);border-left:4px solid var(--s-trace);border-radius:12px;background:var(--panel);box-shadow:var(--shadow);padding:13px 15px}
.umw .gate .nm{font-weight:750;font-size:13.5px;display:flex;align-items:center;gap:6px}
.umw .gate .ds{font-size:12.5px;color:var(--ink-soft);margin-top:4px}
.umw .gate.free{border-left-color:var(--s-active)}
.umw footer{margin-top:40px;padding-top:15px;border-top:1px solid var(--line);color:var(--ink-faint);font-size:12px}
@media (max-width:560px){.umw .wrap{padding:24px 15px 56px}}
`;

// The five stages a UCC filing travels through, from raw government record to a
// dialable lead. `gate` marks a stage that spends money or dials — both are OFF
// until the owner turns them on.
const STAGES = [
  {
    cls: "b-source",
    title: "Source — free & cheap government data",
    gate: null as string | null,
    body: (
      <>
        Every time a business takes financing, the funder files a public <b>UCC lien</b> with the
        Secretary of State — naming the business (debtor) and the lender (secured party). We pull
        those filings: <b>Colorado, Connecticut, Oregon</b> auto-pull weekly from free state
        open-data APIs; <b>Florida</b> is a free full-file download; <b>California</b> was a one-time
        $100 master unload you upload. This is the raw material — and it's how we skip buying resold
        lists entirely.
      </>
    ),
    tags: [
      "ph_ucc_sources",
      "ph_ucc_filings",
      "fn: ph-ucc-ingest",
      "fn: ph-ucc-file-ingest",
      "via: Socrata",
    ],
  },
  {
    cls: "b-match",
    title: "Match — is the lender an MCA funder?",
    gate: null as string | null,
    body: (
      <>
        This is the secret sauce. Each filing names a lender; we check that name against our{" "}
        <b>funder dictionary</b> (~160 funders / 675 aliases) —{" "}
        <b>including the shell names funders hide behind</b> (e.g. Credibly files as "Death Valley
        LLC"). A <b>bank guard</b> makes sure real banks, equipment lessors and auto lenders never
        slip in. Only filings whose lender is a real MCA funder are kept; the rest are discarded
        immediately — we never warehouse the millions of junk rows.
      </>
    ),
    tags: ["ph_ucc_funder_aliases", "bank-pollution guard", "source: deBanked"],
  },
  {
    cls: "b-build",
    title: "Build & Score — turn filings into ranked leads",
    gate: null as string | null,
    body: (
      <>
        Matched filings get rolled up <b>by merchant</b> into one lead, then scored on{" "}
        <b>stack depth</b> (how many advances they already carry — 2+ = a consolidation target),{" "}
        <b>freshness</b> (kept ≤540 days), and overall rank. Two kinds of lead come out:{" "}
        <b>named-funder</b> (we know who funded them) and <b>agent-masked</b> (funder hidden behind a
        filing agent like CT Corp — scored by stacking, tagged with a confidence tier). A{" "}
        <b>missing-funder radar</b> watches for funders we're not catching yet.
      </>
    ),
    tags: ["ph_ucc_leads", "fn: ph_ucc_rebuild_leads()", "fn: ph-ucc-scan-unmatched"],
  },
  {
    cls: "b-trace",
    title: "Skip-Trace & scrub",
    gate: "🔒 gated — costs money",
    body: (
      <>
        A lead is just a business name + lien until we find the human. <b>BatchData</b> takes the
        merchant and returns the <b>owner's name, phone numbers, and emails</b> — plus{" "}
        <b>DNC and TCPA-litigator flags</b> — in one ~$0.064 lookup. DNC numbers are stored but{" "}
        <b>never dialed or exported</b>; a lead with only DNC numbers becomes email-only; TCPA
        litigators are suppressed. <b>Instantly</b> then verifies the emails are deliverable.{" "}
        <b>Apollo</b> can add business emails but is currently off (low hit rate on these merchants).
        Nothing here runs until you approve a batch.
      </>
    ),
    tags: [
      "ph_ucc_contacts",
      "fn: ph-ucc-skiptrace",
      "fn: ph-ucc-verify-emails",
      "fn: ph-ucc-apollo-enrich",
      "BatchData · Instantly · Apollo",
    ],
  },
  {
    cls: "b-active",
    title: "Activate — hand off to the dialer",
    gate: "🔒 gated",
    body: (
      <>
        Clean, dialable, verified leads get pushed into <b>GoHighLevel and the dialer</b> for the
        setters to work — which is exactly where the <b>"Dialing Machine"</b> one-pager picks up.
        Also gated: nothing loads to the CRM or the dialer without your go-ahead.
      </>
    ),
    tags: ["→ GoHighLevel", "→ HotProspector", "→ Revenue Playbook"],
  },
];

// The outside services, and what each actually does for the machine.
const SERVICES: { nm: string; role: string; ds: string }[] = [
  {
    nm: "Socrata",
    role: "Stage 1 · source",
    ds: "The free state open-data API we auto-pull CO / CT / OR filings from. No cost.",
  },
  {
    nm: "deBanked",
    role: "Stage 2 · dictionary",
    ds: "Industry source for funder names and the shell/alias intel that powers the matcher. Not a live feed — it seeds the dictionary.",
  },
  {
    nm: "BatchData",
    role: "Stage 4 · skip-trace (paid)",
    ds: "Turns a business into the owner + phones + emails + DNC/TCPA flags in one call. ~$0.064 each. The only place real money is spent.",
  },
  {
    nm: "Instantly",
    role: "Stage 4 · email verify",
    ds: "Checks that a traced email is real and deliverable before it's used for outreach.",
  },
  {
    nm: "Apollo",
    role: "Stage 4 · optional (OFF)",
    ds: "Can enrich with business emails, but off by default — low hit rate on these small-merchant records.",
  },
  {
    nm: "DNC / TCPA scrub",
    role: "Stage 4 · compliance",
    ds: "Not a list you buy — suppression applied during skip-trace. DNC numbers never get dialed; TCPA litigators are removed. Keeps calling compliant.",
  },
];

export default function UccMachineGuidePage() {
  return (
    <div className="umw">
      <style>{CSS}</style>
      <div className="wrap">
        <header>
          <div className="brandrow">
            <span className="logo" aria-hidden="true" />
            <span className="brandname">Momentum Funding</span>
          </div>
          <p className="eyebrow" style={{ marginTop: 14 }}>
            Internal · How the Machine Works, End to End
          </p>
          <h1>The UCC Lead Machine</h1>
          <p>
            Instead of buying stale, resold lead lists, this manufactures fresh MCA leads from free
            government records — finds businesses that already carry advances, figures out who funded
            them, and turns them into dialable contacts. Here's the whole thing, womb to tomb.
          </p>
        </header>

        {/* PIPELINE DIAGRAM */}
        <section>
          <div className="sec-h">The pipeline at a glance</div>
          <figure>
            <svg
              className="diagram"
              viewBox="0 0 1040 200"
              role="img"
              aria-label="Five-stage pipeline: Source pulls raw UCC filings from five states; Match keeps only filings whose secured party is a known MCA funder; Build and Score rolls them into ranked leads; Skip-Trace (gated) adds phones and emails via BatchData; Activate (gated) hands clean leads to the dialer."
            >
              <defs>
                <marker
                  id="umw-ar"
                  viewBox="0 0 10 10"
                  refX="8.5"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path className="arrowhead" d="M0,0 L10,5 L0,10 z" />
                </marker>
              </defs>

              {/* nodes */}
              <rect className="n n-source" x="16" y="52" width="150" height="80" rx="11" />
              <text className="nt" x="91" y="86" textAnchor="middle">
                1 · SOURCE
              </text>
              <text className="nr" x="91" y="103" textAnchor="middle">
                5 states · gov UCC
              </text>

              <rect className="n n-match" x="228" y="52" width="150" height="80" rx="11" />
              <text className="nt" x="303" y="86" textAnchor="middle">
                2 · MATCH
              </text>
              <text className="nr" x="303" y="103" textAnchor="middle">
                funder dictionary
              </text>

              <rect className="n n-build" x="440" y="52" width="150" height="80" rx="11" />
              <text className="nt" x="515" y="86" textAnchor="middle">
                3 · BUILD
              </text>
              <text className="nr" x="515" y="103" textAnchor="middle">
                roll up · score
              </text>

              <rect className="n n-trace" x="652" y="52" width="150" height="80" rx="11" />
              <text className="lock" x="788" y="70" textAnchor="middle">
                🔒
              </text>
              <text className="nt" x="723" y="86" textAnchor="middle">
                4 · SKIP-TRACE
              </text>
              <text className="nr" x="723" y="103" textAnchor="middle">
                BatchData
              </text>

              <rect className="n n-active" x="864" y="52" width="150" height="80" rx="11" />
              <text className="lock" x="1000" y="70" textAnchor="middle">
                🔒
              </text>
              <text className="nt" x="939" y="86" textAnchor="middle">
                5 · ACTIVATE
              </text>
              <text className="nr" x="939" y="103" textAnchor="middle">
                → the dialer
              </text>

              {/* edges */}
              <line className="edge" x1="166" y1="92" x2="224" y2="92" markerEnd="url(#umw-ar)" />
              <text className="elabel" x="195" y="84" textAnchor="middle">
                raw
              </text>
              <line className="edge" x1="378" y1="92" x2="436" y2="92" markerEnd="url(#umw-ar)" />
              <text className="elabel" x="407" y="84" textAnchor="middle">
                MCA only
              </text>
              <line className="edge" x1="590" y1="92" x2="648" y2="92" markerEnd="url(#umw-ar)" />
              <text className="elabel" x="619" y="84" textAnchor="middle">
                ranked
              </text>
              <line className="edge" x1="802" y1="92" x2="860" y2="92" markerEnd="url(#umw-ar)" />
              <text className="elabel" x="831" y="84" textAnchor="middle">
                contacts
              </text>
              <line className="edge" x1="1014" y1="92" x2="1038" y2="92" markerEnd="url(#umw-ar)" />
            </svg>
            <figcaption>
              <b>The core trick is Stage 2:</b> millions of raw UCC filings pour in, but only the
              ones whose lender is a known MCA funder are kept — everything else (banks, equipment,
              auto) is thrown away at the door, so we never store the junk. 🔒 = a gate that spends
              money or dials; both are OFF until you say go.
            </figcaption>
          </figure>
        </section>

        {/* STAGES */}
        <section>
          <div className="sec-h">Each stage, explained</div>
          {STAGES.map((s, i) => (
            <div className="stage" key={s.title}>
              <div className={`badge ${s.cls}`}>{i + 1}</div>
              <div>
                <h3>
                  {s.title}
                  {s.gate && <span className="gatechip">{s.gate}</span>}
                </h3>
                <p>{s.body}</p>
                <div className="meta">
                  {s.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* SERVICES */}
        <section>
          <div className="sec-h">The outside services — what each one actually does</div>
          <div className="svc">
            {SERVICES.map((s) => (
              <div className="svccard" key={s.nm}>
                <div className="nm">{s.nm}</div>
                <div className="role">{s.role}</div>
                <div className="ds">{s.ds}</div>
              </div>
            ))}
          </div>
        </section>

        {/* COST / GATES */}
        <section>
          <div className="sec-h">What costs money &amp; what's gated</div>
          <div className="gates">
            <div className="gate free">
              <div className="nm">🟢 Sources — nearly free</div>
              <div className="ds">
                CO/CT/OR/FL are free; CA was a one-time $100. No per-lead cost to source or match.
              </div>
            </div>
            <div className="gate">
              <div className="nm">🔒 Skip-trace — OFF by default</div>
              <div className="ds">
                <b>skiptrace_enabled = false.</b> BatchData (~$0.064/lead, up to 300/batch) only runs
                when you approve a batch. No surprise spend.
              </div>
            </div>
            <div className="gate">
              <div className="nm">🔒 Loading to the dialer — OFF</div>
              <div className="ds">
                Leads don't flow to GHL / the dialer until you turn it on. The pool just sits, ready.
              </div>
            </div>
          </div>
        </section>

        <footer>
          Internal reference for Momentum Funding · the operational console lives at{" "}
          <b>/admin/ph-ucc</b> ("UCC Machine") · current pool ~11,200 active MCA leads across
          FL/CA/CO/CT/OR, moving as weekly pulls run · MCA compliance: it's an advance / working
          capital, never a "loan" · not a merchant-facing document.
        </footer>
      </div>
    </div>
  );
}
