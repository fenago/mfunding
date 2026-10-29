// ─────────────────────────────────────────────────────────────────────────────
// Momentum Product Lines — /admin/products
//
// The Funder Cheat Sheet answers "which funder takes this deal". This page
// answers the question that comes before it: "what do we SELL, and who is
// behind each thing we sell".
//
// One tab per product line. Every line shows a PRIMARY and a SECONDARY funder
// in the same shape, and every funder slot carries the mapping back — the
// lender record it points at, the documents the figures came from, whether we
// can submit today, what we get paid, and what we do not know.
//
// The design decision that matters: GAPS ARE RENDERED, not hidden. A missing
// FICO floor prints as "not recorded" in warning colour rather than being left
// off the table, because a product sheet that lists only what we hold reads as
// complete and a closer then quotes a figure we never had. Several funders
// here have holes in exactly the fields a closer would assume are filled.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from "react";
import supabase from "@/supabase";
import { FunderDisclosureStyles } from "@/components/admin/funder/styles";
import { Alert, Checklist, PlaybookStyles, Sec, type CheckItem } from "@/components/admin/funder/playbook";
import { BittySpreadCalc } from "@/components/admin/funder/BittySpreadCalc";
import { LINES, type FunderSlot, type ProductLine } from "@/components/admin/products/lines";
import { PortalLogin, type CredState, type PortalCredRow } from "@/components/admin/products/PortalLogin";

function Slot({ slot, creds, allEmpty }: { slot: FunderSlot; creds: CredState; allEmpty: boolean }) {
  return (
    <div className={`fp-pcard ${slot.role === "Primary" ? "adv" : "spec"}`}>
      <div className="fp-ptop">
        <div>
          <span className="fp-pname">{slot.name}</span>
          <span className="fp-pkind">{slot.role}</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className={`fp-vtag ${slot.liveToday ? "pref" : "no"}`}>
            {slot.liveToday ? "Can submit today" : "Cannot submit"}
          </div>
        </div>
      </div>

      <div className="fp-pline">
        <span className="fp-plk">Status</span>
        {slot.liveNote}
      </div>

      <div className="fp-pline">
        <span className="fp-plk">How the file goes out</span>
        {slot.routes.map((r) => (
          <div key={r.value} style={{ marginTop: 3 }}>
            <b>{r.kind === "selfserve" ? "Merchant self-serve link" : r.kind === "email" ? "Email" : "Portal"}</b> —{" "}
            {r.kind === "email" ? (
              <a className="fp-link" href={`mailto:${r.value}`}>{r.value}</a>
            ) : r.value.startsWith("http") ? (
              <a className="fp-link" href={r.value} target="_blank" rel="noreferrer">{r.value}</a>
            ) : (
              <span className="mono">{r.value}</span>
            )}
            {r.note ? <span style={{ color: "var(--ink-soft)" }}> · {r.note}</span> : null}
          </div>
        ))}
      </div>

      <PortalLogin
        lenderId={slot.lenderId}
        funderName={slot.name}
        portal={slot.portal}
        portalNote={slot.portalNote}
        creds={creds}
        allEmpty={allEmpty}
      />

      <div className="fp-ckgroup">Credit box — what they will look at</div>
      <div className="fp-rows">
        {slot.box.map((b) => (
          <Row key={b.k} k={b.k} v={b.v} missing={b.missing} />
        ))}
      </div>

      <div className="fp-ckgroup">What the merchant pays</div>
      <div className="fp-rows">
        {slot.pricing.map((p) => (
          <Row key={p.k} k={p.k} v={p.v} />
        ))}
      </div>

      <div className="fp-ckgroup">What we earn</div>
      <div className="fp-pline">
        <span className="fp-plk">Headline</span>
        <b style={{ fontSize: 15 }}>{slot.pay.headline}</b>
      </div>
      <div className="fp-pline">
        <span className="fp-plk">Basis</span>
        {slot.pay.basis}
      </div>
      <div className="fp-pline">
        <span className="fp-plk">When</span>
        {slot.pay.timing}
      </div>

      <div className="fp-pline">
        <span className="fp-plk">Track record</span>
        {slot.track}
      </div>

      {slot.contacts.length > 0 ? (
        <div className="fp-pline">
          <span className="fp-plk">Who to call</span>
          {slot.contacts.map((c) => (
            <div key={c.name} style={{ marginTop: 2 }}>
              <b>{c.name}</b>
              {c.title ? <span style={{ color: "var(--ink-soft)" }}> · {c.title}</span> : null}
              {c.email ? <> · <a className="fp-link" href={`mailto:${c.email}`}>{c.email}</a></> : null}
              {c.phone ? <> · <a className="fp-link" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a></> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="fp-pline">
          <span className="fp-plk">Who to call</span>
          <span className="fp-miss">No named contact recorded — submissions inbox only.</span>
        </div>
      )}

      <div className="fp-ckgroup">Where these numbers come from</div>
      <div className="fp-pline">
        <ul className="fp-evid">
          {slot.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>

      <div className="fp-gapbox">
        <b>What we do NOT know about {slot.name}</b>
        <ul>
          {slot.gaps.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Row({ k, v, missing }: { k: string; v: string; missing?: boolean }) {
  return (
    <>
      <div className="fp-rk">{k}</div>
      <div className="fp-rv">{missing ? <span className="fp-miss">{v}</span> : v}</div>
    </>
  );
}

function LineView({ line, creds }: { line: ProductLine; creds: CredState }) {
  // RLS hands an unauthorised reader an empty list rather than an error, so a
  // page-wide zero is the one signal we have that the emptiness may not be real.
  const allEmpty = creds.s === "ok" && creds.rows.length === 0;
  const checks: CheckItem[] = line.checklist.map((c) => ({
    id: c.id,
    group: c.group,
    label: c.label,
    hard: c.hard,
    why: c.why,
  }));

  return (
    <>
      <div className="fp-head">
        <div>
          <h2>{line.name}</h2>
          <p className="fp-role">{line.tagline}</p>
          <div className="fp-idchips">
            <span className="fp-idchip">{line.range}</span>
            <span className="fp-idchip">
              {line.vocab === "advance" ? "Advance · never call it a loan" : line.vocab === "credit" ? "Credit · lending language" : "Mixed"}
            </span>
            <span className="fp-idchip">{line.primary.name}</span>
            {line.secondary ? <span className="fp-idchip">{line.secondary.name}</span> : null}
          </div>
        </div>
      </div>

      <Sec n={1} title="Who this is for">
        <div className="fp-panel">
          <div className="fp-pline">{line.whoFor}</div>
        </div>
        {line.warning ? (
          <div style={{ marginTop: 12 }}>
            <Alert tone={line.warning.tone} title={line.warning.title}>
              <p>{line.warning.body}</p>
            </Alert>
          </div>
        ) : null}
      </Sec>

      <Sec
        n={2}
        title={line.secondary ? "The two funders behind it" : "The funder behind it"}
        sub="mapped back to the record and the documents"
      >
        <Slot slot={line.primary} creds={creds} allEmpty={allEmpty} />
        {line.secondary ? (
          <Slot slot={line.secondary} creds={creds} allEmpty={allEmpty} />
        ) : (
          // A line with one funder says so in words. Padding the slot with a
          // funder that cannot serve this borrower would read as cover and
          // send somebody down a dead end mid-call.
          <div style={{ marginTop: 14 }}>
            <Alert tone="warn" title="No secondary funder on this line">
              <p>{line.noSecondary}</p>
            </Alert>
          </div>
        )}
      </Sec>

      {line.calculator ? (
        <Sec n={3} title="Price it" sub="Bitty is the only funder on any line whose margin we choose">
          <BittySpreadCalc />
        </Sec>
      ) : null}

      <Sec
        n={line.calculator ? 4 : 3}
        title="Submission checklist"
        sub="walk it top to bottom · ticks are saved in this browser only"
      >
        <Checklist storageKey={`mf.productline.${line.id}.v1`} items={checks} />
      </Sec>

      <Sec n={line.calculator ? 5 : 4} title="Open questions on this line" sub="each one is a blocker for something">
        <div className="fp-panel">
          <div className="fp-ladder">
            {line.openQuestions.map((q) => (
              <div className="fp-rung" key={q}>
                <span className="fp-rnum" />
                <span>
                  <span className="fp-rq">{q}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Sec>

      <div className="fp-foot">
        <b>How to read this page.</b> Every figure traces to the funder record or a document named under “Where these
        numbers come from”. Anything marked <span className="fp-miss">not recorded</span> is a real gap in what we
        hold, printed rather than hidden — do not fill it in from memory on a call. Nothing on this page is a
        quote to a merchant.
      </div>
    </>
  );
}

export default function ProductLinesPage() {
  const [tab, setTab] = useState(LINES[0].id);
  const line = LINES.find((l) => l.id === tab) ?? LINES[0];
  const [creds, setCreds] = useState<CredState>({ s: "load" });

  // One query for every funder on every line, rather than one per card. The
  // password is NOT in this select — `secret_id` is a vault pointer and the
  // plaintext only comes back from the audited RPC.
  useEffect(() => {
    let cancelled = false;
    const ids = LINES.flatMap((l) => [l.primary.lenderId, l.secondary?.lenderId ?? ""]).filter(Boolean);
    void (async () => {
      const { data, error } = await supabase
        .from("funder_portal_credentials")
        .select("id, lender_id, label, portal_url, username, secret_id, mfa_note, login_note, last_confirmed_on")
        .in("lender_id", ids)
        .order("label");
      if (cancelled) return;
      // A failure must stay distinguishable from an empty result all the way
      // to the screen; collapsing them here is how "no login on file" gets
      // printed over a login that exists.
      setCreds(error ? { s: "fail", why: error.message } : { s: "ok", rows: (data ?? []) as PortalCredRow[] });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="fcs">
      <FunderDisclosureStyles />
      <PlaybookStyles />
      <style>{EXTRA_CSS}</style>
      <div className="wrap">
        <header>
          <div className="brandrow">
            <span className="logo" aria-hidden="true" />
            <span className="brandname">Momentum Funding</span>
          </div>
          <p className="eyebrow" style={{ marginTop: 14 }}>
            Internal · Product Lines
          </p>
          <h1>What we sell</h1>
          <p>
            {LINES.length} product lines, each with a <b>primary</b> and a <b>secondary</b> funder behind it. Every
            number maps back to a funder record and the document it came from — and every gap in what we hold is
            printed rather than hidden.
          </p>
        </header>

        <div className="tabs" role="tablist" aria-label="Product line">
          {LINES.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === l.id}
              onClick={() => setTab(l.id)}
            >
              {l.tab}
            </button>
          ))}
        </div>

        <LineView line={line} creds={creds} />
      </div>
    </div>
  );
}

const EXTRA_CSS = `
.fcs .fp-unver{display:inline-block;margin-left:6px;padding:0 5px;border-radius:4px;background:var(--c-bg);color:var(--c);font-size:9.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;vertical-align:1px}
.fcs .fp-pnote{margin-top:3px;font-size:12px;color:var(--ink-soft);line-height:1.5}
.fcs .fp-secret{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;padding:1px 6px;border-radius:5px;background:var(--chip);border:1px solid var(--line-soft)}
.fcs .fp-pbtn{font:inherit;font-size:12px;font-weight:700;padding:3px 10px;border-radius:6px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer}
.fcs .fp-pbtn:hover:not(:disabled){border-color:var(--accent);color:var(--accent-ink)}
.fcs .fp-pbtn:disabled{opacity:.55;cursor:default}
.fcs .fp-phint{font-size:11.5px;color:var(--ink-faint)}
.fcs .fp-perr{font-size:11.5px;font-weight:700;color:var(--d)}
.fcs .fp-link{color:var(--accent-ink);text-decoration:none;border-bottom:1px solid color-mix(in srgb,var(--accent) 40%,transparent)}
.fcs .fp-link:hover{border-bottom-color:var(--accent)}
.fcs .fp-evid{margin:0;padding-left:18px;font-size:12.5px;color:var(--ink-soft);line-height:1.6}
.fcs .fp-evid li{break-inside:avoid}
.fcs .fp-gapbox{margin:0;padding:13px 18px;background:var(--c-bg);border-top:1px solid var(--line)}
.fcs .fp-gapbox > b{display:block;font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--c);margin-bottom:6px}
.fcs .fp-gapbox ul{margin:0;padding-left:18px;font-size:13px;line-height:1.6}
.fcs .fp-gapbox li + li{margin-top:3px}
`;
