// ─────────────────────────────────────────────────────────────────────────────
// The merchant handout, on the product it belongs to
//
// Five of the six lines have a compliance-passed one-page sheet sitting in
// public/programs/ and, until now, nothing in the app pointed at one. A closer
// on a call had no way to send a merchant the sheet for the product they were
// discussing.
//
// Two decisions worth knowing:
//
//  1. It sits in the line's HEADER, OUTSIDE every accordion. The accordions on
//     this page are closed by default, and collateral a closer needs mid-call
//     is the wrong thing to make somebody go looking for.
//  2. It prints what the sheet LEAVES OUT. A closer who knows the sheet names
//     no funder and quotes no rate can send it without reading it first; one
//     who does not know will either read the whole thing or hedge on the call.
//
// `fp-` prefixed throughout and styled from the page's injected stylesheet: a
// raw <style> block outranks any Tailwind utility sharing a class name, so the
// token system (which carries its own dark variants under `.dark .fcs`) is the
// only styling on this page.
// ─────────────────────────────────────────────────────────────────────────────
import { POSTERS, POSTER_OMITS } from "./posters";

export function PosterHandout({ lineId, lineName }: { lineId: string; lineName: string }) {
  const poster = POSTERS[lineId];

  // A line with no entry is a coding error, not a line without a sheet — say
  // which it is rather than rendering an empty space that reads as "none".
  if (!poster) {
    return (
      <div className="fp-post">
        <span className="fp-postlab">Merchant handout</span>
        <div className="fp-postwhy">
          <b>No poster is mapped to this line.</b> Every line is supposed to have one. Add an entry for{" "}
          <span className="mono">{lineId}</span> to <span className="mono">products/posters.ts</span>.
        </div>
      </div>
    );
  }

  if (poster.state === "withheld") {
    return (
      <div className="fp-post held">
        <span className="fp-postlab">Merchant handout · not downloadable</span>
        <div className="fp-postwhy">{poster.why}</div>
        <div className="fp-postpath">
          The built sheet: <span className="mono">{poster.builtTo}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fp-post">
      <span className="fp-postlab">Merchant handout · one page</span>
      <div className="fp-postrow">
        <a className="fp-postpdf" href={poster.pdf} download={`${poster.slug}.pdf`}>
          Download the PDF
        </a>
        <a className="fp-postalt" href={poster.html} target="_blank" rel="noreferrer">
          Open it first ↗
        </a>
      </div>
      <div className="fp-postchips">
        {POSTER_OMITS.map((o) => (
          <span className="fp-postchip" key={o}>
            {o}
          </span>
        ))}
      </div>
      <div className="fp-postpath">
        Safe to send as it is — this is the reviewed {lineName} sheet, not a draft. Rebuild it with{" "}
        <span className="mono">node scripts/one-pagers/build.mjs</span> after any copy change.
      </div>
    </div>
  );
}
