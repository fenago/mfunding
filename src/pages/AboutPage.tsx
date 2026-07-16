// AboutPage — restyled to the "Momentum OS" dispatch-board design. Reskin only:
// same content and claims as before, re-voiced to the OS system (Anton display,
// mono labels, one owned go-green signal). Reads all tokens from OSKit.
import SEO from "../components/seo/SEO";
import ScrollToTop from "../components/ui/ScrollToTop";
import { OS_CSS, useOSFonts, OSSection, Eyebrow, Display, Lede, CTAPrimary, Card } from "../components/landing/os/OSKit";
import OSNav from "../components/landing/os/OSNav";
import OSFooter from "../components/landing/os/OSFooter";

const stats = [
  { value: "2,500+", label: "BUSINESSES FUNDED" },
  { value: "$180M+", label: "CAPITAL DEPLOYED" },
  { value: "24 HRS", label: "AVG FUNDING TIME" },
  { value: "97%", label: "CLIENT SATISFACTION" },
];

// The banks-said-no callout, broken into scannable dispatch rows.
const STORY_ROWS = [
  { code: "01", who: "CONTRACTORS", pain: "Losing jobs because they couldn't finance equipment." },
  { code: "02", who: "RESTAURANTS", pain: 'Missing expansion because banks took 60 days to say "no."' },
  { code: "03", who: "TRUCKING", pain: "Watching loads go to competitors — no cash to cover fuel between invoices." },
];

const values = [
  { code: "01", title: "Speed", body: "Time is money. Our streamlined process gets you funded in as little as 24 hours — not weeks." },
  { code: "02", title: "Simplicity", body: "No mountains of paperwork. No confusing fine print. Clear, honest, and straightforward." },
  { code: "03", title: "People first", body: "Behind every application is a real person with a real goal. We treat every owner the way we'd want to be treated." },
  { code: "04", title: "Transparency", body: "No hidden fees. No surprises. You always know exactly what you're getting and what it costs." },
];

const whyUs = [
  "Approvals in as little as 24 hours",
  "Funding from $5K to $5M",
  "All credit types considered",
  "A dedicated funding advisor for every client",
  "No hidden fees or prepayment penalties",
  "Multiple product options tailored to your business",
];

const team = [
  {
    name: "Dr. E. Lee",
    role: "FOUNDER, BOARD CHAIR & CEO",
    image: "/team/dr-lee.png",
    bio: "Two decades in financial services and business strategy. Dr. Lee founded Momentum Funding to bridge the gap between hardworking business owners and the capital they need to grow.",
  },
  {
    name: "Carlos Marquez",
    role: "VP OF OPERATIONS",
    image: "/team/carlos-marquez.png",
    bio: "Carlos owns the day-to-day operations behind our 24-hour funding promise — streamlining the process so owners spend less time waiting and more time growing.",
  },
];

export default function AboutPage() {
  useOSFonts();
  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{ABOUT_CSS}</style>
      <SEO title="About Momentum Funding" description="Momentum Funding helps small business owners get fast working capital when banks say no. Meet the team behind $180M+ in capital deployed to 2,500+ businesses." keywords="about momentum funding, business funding company, small business capital, MCA broker" />
      <ScrollToTop />
      <OSNav />

      {/* Hero + stat board */}
      <OSSection tone="ink">
        <div className="ab-herohead">
          <Eyebrow>ABOUT MOMENTUM</Eyebrow>
          <Display>
            BUILT FOR THE BUSINESSES THAT<br />
            <span className="os-go">KEEP AMERICA RUNNING.</span>
          </Display>
          <Lede>
            We started Momentum Funding because every hardworking business owner deserves{" "}
            <strong>fast, fair access to capital</strong> — without the runaround.
          </Lede>
        </div>

        <div className="ab-stats" role="list">
          {stats.map((s) => (
            <div className="ab-stat" role="listitem" key={s.label}>
              <span className="ab-stat-val">{s.value}</span>
              <span className="ab-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </OSSection>

      {/* Our story */}
      <OSSection tone="panel">
        <div className="ab-storyhead">
          <Eyebrow>OUR STORY</Eyebrow>
          <Display>WE'VE BEEN WHERE YOU ARE.</Display>
          <Lede>
            Momentum was born from a simple frustration: <strong>too many good businesses were
            being turned away by banks.</strong> Not because they weren't profitable. Not because
            they weren't growing. Because the system wasn't built for them.
          </Lede>
        </div>

        <div className="ab-boardtop">
          <span>WHO GOT TURNED AWAY</span>
          <span className="ab-boardnote">EVERY ONE OF THEM HAD REVENUE</span>
        </div>
        <div className="ab-storygrid" role="list">
          {STORY_ROWS.map((r) => (
            <div className="ab-storyrow" role="listitem" key={r.code}>
              <span className="ab-storycode">{r.code}</span>
              <span className="ab-storywho">{r.who}</span>
              <span className="ab-storypain">{r.pain}</span>
            </div>
          ))}
        </div>

        <div className="ab-storyclose">
          <p className="ab-closelede">
            So we built something different — a funding company that <strong>moves at the speed of
            real business.</strong> Applications take <strong>minutes, not weeks.</strong> Your
            revenue matters more than your credit score. And a real person actually answers the phone.
          </p>
          <p className="ab-closego">
            That's Momentum. <span className="os-go">Fast, simple funding</span> for the businesses
            that keep America running.
          </p>
        </div>
      </OSSection>

      {/* Leadership */}
      <OSSection tone="ink">
        <div className="ab-teamhead">
          <Eyebrow>LEADERSHIP</Eyebrow>
          <Display>
            THE TEAM BEHIND<br /><span className="os-go">YOUR FUNDING.</span>
          </Display>
          <Lede>Real people who understand real business — and are set on getting you the capital you need.</Lede>
        </div>

        <div className="ab-teamgrid">
          {team.map((m) => (
            <Card key={m.name} className="ab-teamcard">
              <div className="ab-photo">
                <img
                  src={m.image}
                  alt={m.name}
                  className="ab-photo-img"
                  onError={(e) => {
                    const target = e.currentTarget;
                    target.style.display = "none";
                    const fallback = target.nextElementSibling as HTMLElement;
                    if (fallback) fallback.style.display = "flex";
                  }}
                />
                <div className="ab-photo-fallback">
                  <span className="ab-initials">
                    {m.name.split(" ").map((n) => n[0]).join("")}
                  </span>
                </div>
              </div>
              <h3 className="ab-teamname">{m.name}</h3>
              <p className="ab-teamrole">{m.role}</p>
              <p className="ab-teambio">{m.bio}</p>
            </Card>
          ))}
        </div>
      </OSSection>

      {/* Values */}
      <OSSection tone="panel">
        <div className="ab-valhead">
          <Eyebrow>WHAT WE STAND FOR</Eyebrow>
          <Display>FOUR RULES. NO EXCEPTIONS.</Display>
        </div>
        <div className="ab-valgrid">
          {values.map((v) => (
            <Card key={v.title} className="ab-valcard">
              <span className="ab-valcode">{v.code}</span>
              <h3 className="ab-valtitle">{v.title}</h3>
              <p className="ab-valbody">{v.body}</p>
            </Card>
          ))}
        </div>
      </OSSection>

      {/* Why + CTA */}
      <OSSection tone="ink">
        <div className="ab-why">
          <div className="ab-whyleft">
            <Eyebrow>WHY MOMENTUM</Eyebrow>
            <Display>
              WHY OWNERS<br /><span className="os-go">CHOOSE US.</span>
            </Display>
            <Lede>
              We're not a bank and we're not a faceless portal. We're a <strong>team of real
              people</strong> who know what it takes to run a business — and we keep yours moving.
            </Lede>
            <div className="ab-whycta">
              <CTAPrimary href="/apply">Check your rate — free</CTAPrimary>
            </div>
          </div>
          <ul className="ab-whylist">
            {whyUs.map((item) => (
              <li className="ab-whyitem" key={item}>
                <span className="ab-check" aria-hidden>✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="ab-fine os-mono">
          Not a loan. An MCA is a purchase of future receivables. You never pay us — funding partners compensate us.
        </p>
      </OSSection>

      <OSFooter />
    </div>
  );
}

const ABOUT_CSS = `
.ab-herohead{max-width:46em;margin-bottom:44px}

/* stat board */
.ab-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--hair);
  border:1px solid var(--hair);border-radius:12px;overflow:hidden}
.ab-stat{background:linear-gradient(180deg,var(--panel),var(--panel2));padding:26px 24px;
  display:flex;flex-direction:column;gap:8px}
.ab-stat-val{font-family:'Anton',sans-serif;font-size:clamp(28px,3.4vw,40px);line-height:1;color:var(--go-text)}
.ab-stat-label{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.14em;color:var(--muted)}

/* story */
.ab-storyhead{max-width:44em;margin-bottom:36px}
.ab-boardtop{display:flex;align-items:center;justify-content:space-between;gap:16px;
  font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.14em;color:var(--muted);
  padding:0 2px 12px;border-bottom:1px solid var(--hair);margin-bottom:2px}
.ab-boardnote{color:var(--faint)}
.ab-storygrid{display:grid;gap:1px;background:var(--hair);border:1px solid var(--hair);border-top:none}
.ab-storyrow{position:relative;background:linear-gradient(180deg,var(--panel),var(--panel2));
  padding:20px 22px;display:grid;grid-template-columns:auto 160px 1fr;gap:6px 18px;align-items:center;
  transition:background .18s,box-shadow .18s}
.ab-storyrow::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--go);opacity:0;transition:opacity .18s}
.ab-storyrow:hover{box-shadow:inset 0 0 0 1px rgba(22,217,146,.3)}
.ab-storyrow:hover::before{opacity:1}
.ab-storycode{font-family:'Space Mono',monospace;font-size:12px;color:var(--faint);letter-spacing:.06em}
.ab-storywho{font-family:'Space Mono',monospace;font-weight:700;font-size:13px;letter-spacing:.1em;color:var(--go-text)}
.ab-storypain{font-size:15px;color:var(--lede);line-height:1.5}
.ab-storyclose{margin-top:34px;max-width:44em}
.ab-closelede{font-size:18px;line-height:1.6;color:var(--lede);margin:0 0 18px}
.ab-closelede strong{color:var(--tx);font-weight:600}
.ab-closego{font-family:'Anton',sans-serif;text-transform:uppercase;letter-spacing:.006em;
  font-size:clamp(22px,2.6vw,30px);line-height:1.05;color:var(--tx);margin:0}

/* team */
.ab-teamhead{max-width:42em;margin-bottom:36px}
.ab-teamgrid{display:grid;grid-template-columns:repeat(2,1fr);gap:18px;max-width:820px}
.ab-teamcard{padding:0;overflow:hidden}
.ab-photo{position:relative;height:280px;background:linear-gradient(135deg,var(--ink2),var(--panel));overflow:hidden}
.ab-photo-img{width:100%;height:100%;object-fit:cover;object-position:top}
.ab-photo-fallback{position:absolute;inset:0;display:none;align-items:center;justify-content:center}
.ab-initials{font-family:'Anton',sans-serif;font-size:40px;color:var(--go-text);
  width:96px;height:96px;display:grid;place-items:center;border-radius:50%;
  background:rgba(22,217,146,.1);border:1px solid rgba(22,217,146,.3)}
.ab-teamname{font-family:'Anton',sans-serif;font-size:22px;letter-spacing:.01em;margin:22px 26px 4px;color:var(--tx)}
.ab-teamrole{font-family:'Space Mono',monospace;font-size:11px;letter-spacing:.12em;color:var(--go-text);margin:0 26px 12px}
.ab-teambio{font-size:14.5px;line-height:1.55;color:var(--lede);margin:0 26px 26px}

/* values */
.ab-valhead{margin-bottom:34px}
.ab-valgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px}
.ab-valcard{display:flex;flex-direction:column}
.ab-valcode{font-family:'Anton',sans-serif;font-size:34px;line-height:1;color:var(--go-text);
  text-shadow:0 0 34px rgba(22,217,146,.24);margin-bottom:14px}
.ab-valtitle{font-family:'Space Mono',monospace;font-weight:700;font-size:15px;letter-spacing:.04em;color:var(--tx);margin:0 0 10px}
.ab-valbody{font-size:14.5px;line-height:1.55;color:var(--lede);margin:0}

/* why */
.ab-why{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}
.ab-whyleft{max-width:34em}
.ab-whycta{margin-top:26px}
.ab-whylist{display:flex;flex-direction:column;gap:12px;margin:6px 0 0;padding:0;list-style:none}
.ab-whyitem{display:flex;align-items:flex-start;gap:12px;
  background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--hair);
  border-radius:12px;padding:16px 18px;font-size:15px;color:var(--tx);font-weight:500}
.ab-check{color:var(--go-text);font-weight:700;flex:0 0 auto;margin-top:1px}
.ab-fine{font-size:12px;letter-spacing:.03em;color:var(--faint);margin:40px 0 0}

@media (max-width:920px){
  .ab-stats{grid-template-columns:repeat(2,1fr)}
  .ab-valgrid{grid-template-columns:repeat(2,1fr)}
  .ab-why{grid-template-columns:1fr;gap:28px}
}
@media (max-width:640px){
  .ab-teamgrid{grid-template-columns:1fr}
  .ab-storyrow{grid-template-columns:auto 1fr;gap:4px 14px}
  .ab-storywho{grid-column:2}
  .ab-storypain{grid-column:1 / -1}
  .ab-boardtop{flex-direction:column;align-items:flex-start;gap:4px}
}
`;
