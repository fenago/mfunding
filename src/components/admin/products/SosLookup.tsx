// ─────────────────────────────────────────────────────────────────────────────
// Secretary of State lookup — pick the state, get the register
//
// Bitty requires the merchant's registration to be active and in good standing
// on every file, and the checklist used to say so and then leave the closer to
// go and find the right state website mid-call. Fourteen of the fifty-one are
// not run by a Secretary of State, seven have moved recently, and two of the
// obvious URLs now land on a login wall — so "just google it" costs minutes and
// sometimes lands on a paid aggregator instead of the state.
//
// One select, one link, and the agency's real name next to it. Where the link
// is less than certain the UI says which kind of less-than-certain it is,
// rather than looking the same as a verified one.
//
// `fp-` prefixed throughout: the page injects `.fcs` as a raw <style> block
// which outranks any Tailwind utility sharing a class name.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { SOS_REGISTRY } from "./sosRegistry";

export function SosLookup() {
  const [code, setCode] = useState("");
  const hit = SOS_REGISTRY.find((s) => s.code === code);

  return (
    <div className="fp-sos">
      <label className="fp-soslab" htmlFor="sos-state">
        Merchant&rsquo;s state
      </label>
      <select id="sos-state" className="fp-sossel" value={code} onChange={(e) => setCode(e.target.value)}>
        <option value="">Select a state…</option>
        {SOS_REGISTRY.map((s) => (
          <option key={s.code} value={s.code}>
            {s.state}
          </option>
        ))}
      </select>

      {hit === undefined ? (
        <span className="fp-soshint">
          Pick the state the business is registered in — that is the state on the application, not necessarily where
          the owner lives.
        </span>
      ) : (
        <div className="fp-soshit">
          <a className="fp-sosgo" href={hit.url} target="_blank" rel="noreferrer">
            Open {hit.agency} ↗
          </a>
          {hit.check === "landing" ? (
            <span className="fp-soswarn">no direct search link — one more click</span>
          ) : hit.check === "unchecked" ? (
            <span className="fp-soswarn">unverified link</span>
          ) : null}
          <div className="fp-sosmeta">
            {hit.agency.startsWith("Secretary of State") || hit.agency.startsWith("Secretary of the") ? null : (
              <b>{hit.state} does not use a Secretary of State for this. </b>
            )}
            {hit.note ?? "Search the exact legal name from the application, then read the STATUS field — active is not the same as in good standing, and a lapsed registration is a silent decline."}
          </div>
        </div>
      )}
    </div>
  );
}
