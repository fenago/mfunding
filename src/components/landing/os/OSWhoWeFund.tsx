// OSWhoWeFund — the "who we fund" section for the Momentum OS landing.
// Signature element: an industries departures/dispatch board — one big list of real
// target markets rendered as mono-labeled tiles that light green on the edge. Disciplined,
// not decorated. Reads from OSKit's shared tokens so it sits inside the same system.
import { type ReactNode } from "react";
import { OSSection, Eyebrow, Display, Lede, CTAPrimary } from "./OSKit";

// Small line icons — 1.5px stroke, currentColor, drawn to sit quiet next to the label.
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const Glyph = ({ d }: { d: ReactNode }) => (
  <svg className="oswho-ico" viewBox="0 0 24 24" width="22" height="22" aria-hidden {...stroke}>{d}</svg>
);

type Industry = { code: string; name: string; tag: string; icon: ReactNode };

const INDUSTRIES: Industry[] = [
  { code: "01", name: "Construction & Contractors", tag: "PROJECT CASH", icon: <Glyph d={<><path d="M3 21h18" /><path d="M6 21V9l6-4 6 4v12" /><path d="M10 21v-5h4v5" /></>} /> },
  { code: "02", name: "Restaurants & Bars", tag: "SEASONAL", icon: <Glyph d={<><path d="M6 3v7a2 2 0 0 0 2 2 2 2 0 0 0 2-2V3" /><path d="M8 3v18" /><path d="M17 3c-1.7 0-3 2-3 5s1.3 4 3 4v9" /></>} /> },
  { code: "03", name: "Trucking & Logistics", tag: "FLEET & FUEL", icon: <Glyph d={<><path d="M2 7h11v9H2z" /><path d="M13 10h4l3 3v3h-7z" /><circle cx="6" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>} /> },
  { code: "04", name: "Retail & E-commerce", tag: "INVENTORY", icon: <Glyph d={<><path d="M4 8h16l-1 12H5z" /><path d="M8 8a4 4 0 0 1 8 0" /></>} /> },
  { code: "05", name: "Auto & Repair", tag: "EQUIPMENT", icon: <Glyph d={<><path d="M14 7l3-3a4 4 0 0 1-5 5l-7 7a2 2 0 0 1-3-3l7-7a4 4 0 0 1 5-5z" /></>} /> },
  { code: "06", name: "Healthcare & Dental", tag: "PRACTICE", icon: <Glyph d={<><path d="M12 4v16" /><path d="M4 12h16" /><rect x="4" y="4" width="16" height="16" rx="3" /></>} /> },
  { code: "07", name: "Salons & Services", tag: "BUILD-OUT", icon: <Glyph d={<><circle cx="6" cy="7" r="2.4" /><circle cx="6" cy="17" r="2.4" /><path d="M8 8l12 8" /><path d="M8 16L20 8" /></>} /> },
  { code: "08", name: "Manufacturing", tag: "MACHINERY", icon: <Glyph d={<><path d="M3 21V10l6 4V10l6 4V6l6 4v11z" /></>} /> },
  { code: "09", name: "Wholesale & Distribution", tag: "PURCHASE ORDER", icon: <Glyph d={<><path d="M3 8l9-4 9 4-9 4z" /><path d="M3 8v8l9 4 9-4V8" /><path d="M12 12v8" /></>} /> },
];

export default function OSWhoWeFund() {
  return (
    <OSSection tone="ink" id="who" className="oswho">
      <style>{CSS}</style>

      <div className="oswho-head">
        <Eyebrow>WHO WE FUND</Eyebrow>
        <Display>
          MAIN STREET,<br /><span className="os-go">NOT WALL STREET.</span>
        </Display>
        <Lede>
          Momentum funds the businesses that keep neighborhoods running — the ones banks
          find <strong>&ldquo;too small,&rdquo;</strong> <strong>&ldquo;too new,&rdquo;</strong> or{" "}
          <strong>&ldquo;too risky.&rdquo;</strong> If you&rsquo;ve got revenue coming in, you&rsquo;ve got options.
        </Lede>
      </div>

      <div className="oswho-boardtop">
        <span className="oswho-boardtitle">FUNDED INDUSTRIES · BOARD</span>
        <span className="oswho-boardnote">9 SECTORS · MORE ON REQUEST</span>
      </div>

      <div className="oswho-grid" role="list">
        {INDUSTRIES.map((it) => (
          <div className="oswho-tile" role="listitem" key={it.code}>
            <span className="oswho-code">{it.code}</span>
            <span className="oswho-name">{it.icon}{it.name}</span>
            <span className="oswho-tag">{it.tag}</span>
          </div>
        ))}
      </div>

      <div className="oswho-qual">
        <span className="oswho-qual-label">MOST OF OUR FUNDED BUSINESSES MEET:</span>
        <span className="oswho-qual-line">
          6+ MONTHS IN BUSINESS
          <i>·</i>
          $10K+ MONTHLY REVENUE
          <i>·</i>
          A BUSINESS BANK ACCOUNT
        </span>
      </div>

      <div className="oswho-cta">
        <CTAPrimary href="/apply">See if you qualify</CTAPrimary>
        <span className="oswho-fine">Not a loan. An MCA is a purchase of future receivables.</span>
      </div>
    </OSSection>
  );
}

const CSS = `
.oswho .oswho-head{max-width:44em;margin-bottom:40px}

/* board header strip */
.oswho-boardtop{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.14em;color:var(--muted);
  padding:0 2px 12px;border-bottom:1px solid var(--hair);margin-bottom:2px;
}
.oswho-boardnote{color:var(--faint)}

/* the departures board grid */
.oswho-grid{
  display:grid;grid-template-columns:repeat(3,1fr);
  gap:1px;background:var(--hair);
  border:1px solid var(--hair);border-top:none;
}
.oswho-tile{
  position:relative;background:linear-gradient(180deg,var(--panel),var(--panel2));
  padding:22px 22px 20px;display:grid;
  grid-template-columns:auto 1fr;grid-template-rows:auto auto;gap:4px 14px;align-items:center;
  transition:background .18s,box-shadow .18s;
}
.oswho-tile::before{
  content:"";position:absolute;left:0;top:0;bottom:0;width:2px;
  background:var(--go);opacity:0;transition:opacity .18s;
}
.oswho-tile:hover{background:linear-gradient(180deg,rgba(22,217,146,.06),var(--panel2));box-shadow:inset 0 0 0 1px rgba(22,217,146,.35)}
.oswho-tile:hover::before{opacity:1}
.oswho-tile:hover .oswho-ico{color:var(--go-text)}

.oswho-code{
  grid-row:1 / span 2;align-self:start;margin-top:2px;
  font-family:'Space Mono',monospace;font-size:12px;color:var(--faint);letter-spacing:.06em;
}
.oswho-ico{color:var(--muted);transition:color .18s;flex:0 0 auto}
.oswho-name{
  grid-column:2;grid-row:1;display:flex;align-items:center;gap:11px;
  font-size:15px;font-weight:600;color:var(--tx);letter-spacing:.005em;line-height:1.2;
}
.oswho-tag{
  grid-column:2;grid-row:2;
  font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.14em;color:var(--muted);
}

/* qualification strip */
.oswho-qual{
  margin-top:32px;padding:20px 22px;border:1px solid var(--hair);border-radius:12px;
  background:rgba(22,217,146,.035);
  display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;
}
.oswho-qual-label{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.16em;color:var(--faint)}
.oswho-qual-line{
  font-family:'Space Mono',monospace;font-size:13px;letter-spacing:.05em;font-weight:700;color:var(--tx);
  display:inline-flex;flex-wrap:wrap;align-items:center;gap:10px;
}
.oswho-qual-line i{color:var(--go-text);font-style:normal;font-weight:700}

/* close */
.oswho-cta{margin-top:30px;display:flex;flex-wrap:wrap;align-items:center;gap:16px 22px}
.oswho-fine{font-size:12.5px;color:var(--faint)}

@media (max-width:920px){
  .oswho-grid{grid-template-columns:repeat(2,1fr)}
}
@media (max-width:560px){
  .oswho-grid{grid-template-columns:1fr}
  .oswho-boardtop{flex-direction:column;align-items:flex-start;gap:4px}
}
`;
