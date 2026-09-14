// ─────────────────────────────────────────────────────────────────────────────
// Easy Financing Script — the company's PRIMARY call script.
//
// VERBATIM TRANSCRIPTION of "Easy Financing Script.pdf" (4 pages). Every
// question number, every NOTE, every follow-up is reproduced exactly as the
// owner wrote it — including the two "Part 3" headings (DISCLOSURE and
// APPOINTMENTS), which are NOT renumbered. The only thing this page adds is
// formatting. Do not reword, add, or remove lines without owner approval.
//
// Audience: setters (role `closer`), processors, admin, super_admin — same as
// the Setter Guide. Read live, mid-call, often on a phone: hence the large base
// type, the sticky jump bar, and the hard visual split between what the setter
// SAYS OUT LOUD and the internal NOTEs that are never read aloud.
//
// Theming: the app drives dark mode with a `dark` class on <html> (see
// lib/theme-context), so the dark token block is scoped to `.dark .efs`.
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
.efs{
  --ink:#0f2942; --ink-soft:#40546b; --ink-faint:#728299;
  --ground:#eef2f7; --panel:#ffffff; --line:#dde5ee; --line-soft:#eaeff5;
  --accent:#0f9d6b; --accent-ink:#0a7a52; --accent-wash:#e7f6ef;
  --gold:#b5822a; --gold-ink:#8a6018; --gold-soft:#fbf3e2;
  --danger:#c0392b; --danger-ink:#a1301f; --danger-soft:#fbeae7;
  --blue:#2f6fb0; --blue-soft:#e8f0f8;
  --shadow:0 1px 2px rgba(15,41,66,.05),0 6px 22px rgba(15,41,66,.06);
  background:var(--ground); color:var(--ink); min-height:100%;
  font-family:-apple-system,"SF Pro Text",system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  font-size:18px; line-height:1.62; -webkit-font-smoothing:antialiased;
}
.dark .efs{
  --ink:#e9eef5; --ink-soft:#aab9c9; --ink-faint:#7f92a6;
  --ground:#0a141d; --panel:#101d29; --line:#233240; --line-soft:#18242f;
  --accent:#2fc98d; --accent-ink:#5bd9a8; --accent-wash:#0e2a22;
  --gold:#d9ab52; --gold-ink:#e8c477; --gold-soft:#241d0f;
  --danger:#ef6a5a; --danger-ink:#ff8a7a; --danger-soft:#2a1512;
  --blue:#6aa6e0; --blue-soft:#12202e;
  --shadow:0 1px 2px rgba(0,0,0,.35),0 8px 26px rgba(0,0,0,.3);
}
.efs *{box-sizing:border-box}
.efs .wrap{max-width:900px;margin:0 auto;padding:32px 22px 90px}
.efs h1,.efs h2,.efs h3{text-wrap:balance;margin:0;letter-spacing:-.02em}

/* ── Header ─────────────────────────────────────────────────────────────── */
.efs .brand{display:flex;align-items:center;gap:10px}
.efs .logo{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--gold));box-shadow:var(--shadow)}
.efs .brand b{font-weight:800;font-size:15px}
.efs .eyebrow{font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--accent-ink);margin:20px 0 6px}
.efs header h1{font-size:clamp(30px,5vw,44px);font-weight:850;line-height:1.03;margin-bottom:.3em}
.efs .lede{color:var(--ink-soft);font-size:17px;max-width:66ch}
.efs .lede b{color:var(--ink)}

/* ── Legend: spoken vs note vs gate ─────────────────────────────────────── */
.efs .legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(232px,1fr));gap:11px;margin-top:20px}
.efs .lg{border:1px solid var(--line);border-radius:12px;background:var(--panel);box-shadow:var(--shadow);padding:11px 14px;font-size:14px;color:var(--ink-soft);line-height:1.45}
.efs .lg b{display:block;font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;margin-bottom:3px}
.efs .lg.say{border-left:5px solid var(--accent)} .efs .lg.say b{color:var(--accent-ink)}
.efs .lg.nt{border-left:5px solid var(--gold)} .efs .lg.nt b{color:var(--gold)}
.efs .lg.gt{border-left:5px solid var(--blue)} .efs .lg.gt b{color:var(--blue)}

/* ── Sticky jump bar ────────────────────────────────────────────────────── */
.efs .jump{position:sticky;top:0;z-index:20;margin:22px -22px 0;padding:11px 22px;
  background:color-mix(in srgb,var(--ground) 88%,transparent);backdrop-filter:blur(10px);
  border-top:1px solid var(--line);border-bottom:1px solid var(--line);
  display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.efs .jump a{font-size:13.5px;font-weight:800;letter-spacing:.02em;text-decoration:none;
  padding:6px 13px;border-radius:999px;border:1px solid var(--line);background:var(--panel);
  color:var(--ink-soft);white-space:nowrap;transition:all .12s}
.efs .jump a:hover{border-color:var(--accent);color:var(--accent-ink)}
.efs .jump a.hot{background:color-mix(in srgb,var(--danger) 12%,var(--panel));border-color:var(--danger);color:var(--danger-ink)}

/* ── Gate strip — the pass/fail thresholds ──────────────────────────────── */
.efs .gates{margin-top:26px;border:2px solid color-mix(in srgb,var(--blue) 45%,transparent);
  border-radius:16px;background:var(--blue-soft);box-shadow:var(--shadow);padding:16px 18px}
.efs .gates .gh{font-size:12.5px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--blue);margin-bottom:11px}
.efs .grid5{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:10px}
.efs .gate{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:11px 13px}
.efs .gate .v{font-size:20px;font-weight:850;color:var(--ink);line-height:1.15;letter-spacing:-.02em}
.efs .gate .k{font-size:12.5px;font-weight:700;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.06em;margin-top:4px}

/* ── Sections ───────────────────────────────────────────────────────────── */
.efs section{margin-top:44px;scroll-margin-top:78px}
.efs .kicker{display:flex;align-items:baseline;gap:12px;margin-bottom:20px;padding-bottom:10px;border-bottom:3px solid var(--accent)}
.efs .kicker .n{font-size:13px;font-weight:850;color:var(--accent);letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}
.efs .kicker h2{font-size:clamp(22px,3.2vw,28px);font-weight:850}
.efs .subhead{font-size:16px;color:var(--ink-soft);margin:0 0 18px;max-width:70ch}

/* ── SAY: the spoken script. The star of the page. ──────────────────────── */
.efs .say-block{border-left:6px solid var(--accent);background:var(--panel);
  border-radius:0 14px 14px 0;box-shadow:var(--shadow);padding:16px 20px;margin:14px 0}
.efs .say-block .tag{font-size:11px;font-weight:850;letter-spacing:.13em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:6px}
.efs .say-line{font-size:20px;font-weight:700;line-height:1.55;color:var(--ink)}
.efs .say-line .var{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.88em;font-weight:800;
  background:var(--accent-wash);color:var(--accent-ink);padding:1px 7px;border-radius:6px;white-space:nowrap}
.efs .orbar{display:flex;align-items:center;gap:12px;margin:16px 0}
.efs .orbar span{font-size:13px;font-weight:850;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint)}
.efs .orbar i{flex:1;height:1px;background:var(--line)}

/* ── Questions ──────────────────────────────────────────────────────────── */
.efs .q{margin-top:22px;padding-top:20px;border-top:1px solid var(--line)}
.efs .q:first-of-type{border-top:0;padding-top:0;margin-top:0}
.efs .qhead{display:grid;grid-template-columns:46px 1fr;gap:15px;align-items:start}
.efs .qn{width:44px;height:44px;border-radius:12px;background:var(--accent);color:#fff;
  display:grid;place-items:center;font-size:19px;font-weight:850;font-variant-numeric:tabular-nums;box-shadow:var(--shadow)}
.efs .qlbl{font-size:11.5px;font-weight:850;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-faint);margin-bottom:2px}
.efs .qtext{font-size:21px;font-weight:800;line-height:1.45;color:var(--ink);letter-spacing:-.01em}
.efs .qtext .cond{font-weight:700;color:var(--danger-ink);font-size:.85em;white-space:nowrap}
.efs .qtext .thresh{display:inline-block;font-size:.7em;font-weight:850;letter-spacing:.04em;
  background:color-mix(in srgb,var(--blue) 16%,transparent);color:var(--blue);
  border:1px solid color-mix(in srgb,var(--blue) 45%,transparent);
  padding:2px 9px;border-radius:999px;vertical-align:middle;margin-left:6px;white-space:nowrap}
.efs .fu{margin:12px 0 0 61px;padding:11px 0 11px 16px;border-left:3px dashed color-mix(in srgb,var(--accent) 55%,transparent)}
.efs .fu .flbl{font-size:11px;font-weight:850;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:2px}
.efs .fu .ftext{font-size:18.5px;font-weight:750;line-height:1.5;color:var(--ink)}

/* ── NOTE: internal coaching. Deliberately NOT bold, clearly "not spoken". ─ */
.efs .nt{margin:13px 0 0 61px;border-radius:12px;background:var(--gold-soft);
  border-left:5px solid var(--gold);padding:13px 16px}
.efs .nt .nh{font-size:11px;font-weight:850;letter-spacing:.13em;text-transform:uppercase;color:var(--gold);margin-bottom:4px}
.efs .nt .nb{font-size:16px;font-weight:400;line-height:1.6;color:var(--ink-soft)}
.efs .nt .nb b{color:var(--ink);font-weight:750}
.efs .nt.rec{background:var(--danger-soft);border-left-color:var(--danger)}
.efs .nt.rec .nh{color:var(--danger-ink)}
.efs .nt.rec .nb{color:var(--ink);font-weight:600}
.efs .nt.flush{margin-left:0}

/* ── DISCLOSURE — the loudest block on the page ─────────────────────────── */
.efs .disc{margin-top:20px;border:3px solid var(--accent);border-radius:18px;background:var(--panel);
  box-shadow:0 10px 34px color-mix(in srgb,var(--accent) 22%,transparent);overflow:hidden}
.efs .disc .dh{background:var(--accent);color:#fff;padding:12px 22px;font-size:13px;
  font-weight:850;letter-spacing:.15em;text-transform:uppercase}
.efs .disc .db{padding:22px 24px 24px}
.efs .disc .dline{font-size:clamp(21px,3.1vw,26px);font-weight:800;line-height:1.45;color:var(--ink);letter-spacing:-.015em}
.efs .disc .dline+.dline{margin-top:18px;padding-top:18px;border-top:1px solid var(--line)}
.efs .disc .dnote{display:block;margin-top:9px;font-size:15px;font-weight:750;letter-spacing:.02em;
  text-transform:uppercase;color:var(--danger-ink)}

/* ── Recap lists ────────────────────────────────────────────────────────── */
.efs .layer{margin-top:18px}
.efs .layer .lh{font-size:18px;font-weight:750;color:var(--ink);margin-bottom:10px}
.efs ul.dash{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px}
.efs ul.dash li{display:grid;grid-template-columns:16px 1fr;gap:11px;align-items:baseline;
  background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:11px 14px;
  font-size:17px;font-weight:700;color:var(--ink)}
.efs ul.dash li .mk{color:var(--accent);font-weight:850}

/* ── Rebuttals ──────────────────────────────────────────────────────────── */
.efs .reb{margin-top:16px;border:1px solid var(--line);border-radius:16px;background:var(--panel);
  box-shadow:var(--shadow);padding:18px 20px;border-top:4px solid var(--gold)}
.efs .reb .ask{font-size:12px;font-weight:850;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);margin-bottom:5px}
.efs .reb .askq{font-size:18px;font-weight:750;color:var(--ink-soft);line-height:1.5;margin-bottom:14px}
.efs .reb .youlbl{font-size:11px;font-weight:850;letter-spacing:.13em;text-transform:uppercase;color:var(--accent-ink);margin-bottom:5px}
.efs .reb blockquote{margin:0;font-size:20px;font-weight:750;line-height:1.55;color:var(--ink);
  border-left:5px solid var(--accent);padding-left:16px}

.efs .plain{font-size:18px;font-weight:700;line-height:1.6;color:var(--ink);margin:0}
.efs footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line);color:var(--ink-faint);font-size:13.5px;line-height:1.6}

@media (max-width:620px){
  .efs .wrap{padding:22px 15px 80px}
  .efs .jump{margin:18px -15px 0;padding:10px 15px}
  .efs .fu,.efs .nt{margin-left:0}
  .efs .qhead{grid-template-columns:38px 1fr;gap:12px}
  .efs .qn{width:36px;height:36px;font-size:16px;border-radius:10px}
}
@media print{
  .efs{background:#fff;font-size:12pt}
  .efs .wrap{max-width:100%;padding:0}
  .efs .jump{display:none}
  .efs section,.efs .q,.efs .disc,.efs .reb{break-inside:avoid}
  .efs .disc{box-shadow:none}
}
`;

export default function CallScriptPage() {
  return (
    <div className="efs">
      <style>{CSS}</style>
      <div className="wrap">
        <header>
          <div className="brand">
            <span className="logo" aria-hidden="true" />
            <b>Momentum Funding</b>
          </div>
          <p className="eyebrow">Easy Financing Script &middot; The Call Script</p>
          <h1>The Easy Financing Script</h1>
          <p className="lede">
            This is <b>the</b> script. Word for word, top to bottom &mdash; open, prequalify on all{" "}
            <b>ten questions</b>, read the <b>disclosure</b>, recap, transfer. The green bars are
            what you <b>say out loud</b>. The amber boxes are <b>internal notes</b> &mdash; coaching
            for you, never read to the prospect.
          </p>

          <div className="legend">
            <div className="lg say">
              <b>Green bar</b>
              What you say out loud, word for word.
            </div>
            <div className="lg nt">
              <b>Amber box &mdash; internal</b>
              Coaching note. Never read this to the prospect.
            </div>
            <div className="lg gt">
              <b>Blue pill</b>
              A qualifying threshold. Pass / fail.
            </div>
          </div>
        </header>

        {/* Sticky jump bar — a setter mid-call taps straight to the part they need */}
        <nav className="jump" aria-label="Jump to section">
          <a href="#part1">Part 1 &middot; Opening</a>
          <a href="#part2">Part 2 &middot; Prequalification</a>
          <a href="#disclosure" className="hot">
            Part 3 &middot; DISCLOSURE
          </a>
          <a href="#appointments">Part 3 &middot; Appointments</a>
          <a href="#recap">Part 4 &middot; Recap</a>
          <a href="#rebuttals">Part 5 &middot; Rebuttals</a>
        </nav>

        {/* The pass/fail gates — impossible to miss */}
        <div className="gates">
          <div className="gh">The qualifying gates &mdash; all five must pass</div>
          <div className="grid5">
            <div className="gate">
              <div className="v">$10,000+</div>
              <div className="k">Avg monthly deposit</div>
            </div>
            <div className="gate">
              <div className="v">550+</div>
              <div className="k">Credit score</div>
            </div>
            <div className="gate">
              <div className="v">RIGHT AWAY</div>
              <div className="k">Needs the funds</div>
            </div>
            <div className="gate">
              <div className="v">NOT funded</div>
              <div className="k">Already funded = no</div>
            </div>
            <div className="gate">
              <div className="v">No bankruptcy</div>
              <div className="k">Should be NO</div>
            </div>
          </div>
        </div>

        {/* ─────────────────────────── PART 1 ─────────────────────────── */}
        <section id="part1">
          <div className="kicker">
            <span className="n">Part 1</span>
            <h2>Opening and Establishing Funding Needs</h2>
          </div>

          <div className="say-block">
            <div className="tag">Say</div>
            <p className="say-line">
              HEY, IS THIS <span className="var">(#FirstName#)</span>{" "}
              <span className="var">(#LastName#)</span>?
            </p>
          </div>

          <div className="say-block">
            <div className="tag">Opener A</div>
            <p className="say-line">
              Hi, this is <span className="var">(#Rep#)</span> from EASY FINANCING and I wanted to
              give you a call because you&rsquo;ve inquired about a business loan and I wanted to
              see if you were able to get all the money that you needed for the business?
            </p>
          </div>

          <div className="orbar">
            <i />
            <span>-Or-</span>
            <i />
          </div>

          <div className="say-block">
            <div className="tag">Opener B</div>
            <p className="say-line">
              Hi, this is <span className="var">(#Rep#)</span> from EASY FINANCING and I wanted to
              give you a call because a FEW of our lender are interested in speaking with you and
              want to give you an offer, ARE YOU STILL IN NEED OF FUNDS?
            </p>
          </div>

          <div className="say-block">
            <div className="tag">If There is a NEED</div>
            <p className="say-line">
              GREAT! THAT&rsquo;S ACTUALLY WHY I&rsquo;M CALLING YOU TODAY.
            </p>
          </div>
        </section>

        {/* ─────────────────────────── PART 2 ─────────────────────────── */}
        <section id="part2">
          <div className="kicker">
            <span className="n">Part 2</span>
            <h2>Prequalification</h2>
          </div>

          {/* Q1 */}
          <div className="q">
            <div className="qhead">
              <div className="qn">1</div>
              <div>
                <div className="qlbl">Question 1</div>
                <div className="qtext">How much money do you need?</div>
              </div>
            </div>
            <div className="nt">
              <div className="nh">Note &mdash; internal, do not say</div>
              <div className="nb">THE AMOUNT MUST BE COMING FROM THE PROSPECT NOT THE AGENT.</div>
            </div>
          </div>

          {/* Q2 */}
          <div className="q">
            <div className="qhead">
              <div className="qn">2</div>
              <div>
                <div className="qlbl">Question 2</div>
                <div className="qtext">Why do you need the money?</div>
              </div>
            </div>
            <div className="nt">
              <div className="nh">Note &mdash; internal, do not say</div>
              <div className="nb">
                THIS IS THE MONEY QUESTION. THIS IS WHERE WE WOULD GAUGE IF THE BORROWER IS REALLY
                INTERESTED. THIS SHOULD BE ASKED IN AN OPEN-ENDED MANNER. LET THEM OPEN UP. ASK
                LIKE, TELL ME MORE ABOUT IT&hellip;. WHAT EQUIPMENTS WILL YOU BE PURCHASING? IF THEY
                SAY &ldquo;EXPANSION&rdquo; ASK LIKE, WILL YOU BE HIRING MORE PEOPLE. WE NEED TO ASK
                LOGICAL QUESTIONS. LET&rsquo;S GET DETAILED ON THIS PART.
              </div>
            </div>
          </div>

          {/* Q3 */}
          <div className="q">
            <div className="qhead">
              <div className="qn">3</div>
              <div>
                <div className="qlbl">Question 3</div>
                <div className="qtext">How long have you been the business owner?</div>
              </div>
            </div>
            <div className="fu">
              <div className="flbl">Follow up question 3</div>
              <div className="ftext">What is the name of your business?</div>
            </div>
            <div className="fu">
              <div className="flbl">Follow up question 3</div>
              <div className="ftext">I want to make sure that this business is still running right?</div>
            </div>
          </div>

          {/* Q4 */}
          <div className="q">
            <div className="qhead">
              <div className="qn">4</div>
              <div>
                <div className="qlbl">Question 4</div>
                <div className="qtext">
                  Do you have an active business bank account?{" "}
                  <span className="cond">(IF NO GO STRAIGHT TO Q.5)</span>
                </div>
              </div>
            </div>
            <div className="fu">
              <div className="flbl">Follow up question 4</div>
              <div className="ftext">
                Have you been depositing money into that account over the last 4 months?
              </div>
            </div>
            <div className="fu">
              <div className="flbl">Follow up question 4</div>
              <div className="ftext">
                What is your average monthly deposit?
                <span className="thresh">SHOULD BE AT LEAST $10,000</span>
                <span className="cond"> (IF NOT PROCEED TO Q.5)</span>
              </div>
            </div>
            <div className="nt rec">
              <div className="nh">Note &mdash; compliance, must be on the recording</div>
              <div className="nb">
                These questions must be heard on the recordings. Including all follow up questions.
              </div>
            </div>
          </div>

          {/* Q5 */}
          <div className="q">
            <div className="qhead">
              <div className="qn">5</div>
              <div>
                <div className="qlbl">Question 5</div>
                <div className="qtext">
                  What is your Credit score?<span className="thresh">Should be at least 550</span>
                </div>
              </div>
            </div>
            <div className="nt">
              <div className="nh">Note &mdash; internal, do not say</div>
              <div className="nb">
                If the prospect does not know his/her credit, we must try to obtain a range. If
                still no credit score then we can&rsquo;t submit the lead.
              </div>
            </div>
          </div>

          {/* Q6 */}
          <div className="q">
            <div className="qhead">
              <div className="qn">6</div>
              <div>
                <div className="qlbl">Question 6</div>
                <div className="qtext">
                  Do you need the money RIGHT AWAY?
                  <span className="thresh">Should be YES</span>
                  <span className="cond">
                    {" "}
                    (if not, we follow up when they need the funds and call back)
                  </span>
                </div>
              </div>
            </div>
            <div className="nt">
              <div className="nh">Note &mdash; internal, do not say</div>
              <div className="nb">
                We don&rsquo;t ask the 6 weeks question anymore. They should need the funds right
                away.
              </div>
            </div>
          </div>

          {/* Q7 */}
          <div className="q">
            <div className="qhead">
              <div className="qn">7</div>
              <div>
                <div className="qlbl">Question 7</div>
                <div className="qtext">
                  Do you have any equity or property?{" "}
                  <span className="cond">(Could be any real estate property)</span>
                </div>
              </div>
            </div>
            <div className="fu">
              <div className="flbl">Follow up question 7</div>
              <div className="ftext">Has it been at least 50% paid off?</div>
            </div>
            <div className="nt">
              <div className="nh">Note &mdash; internal, do not say</div>
              <div className="nb">Those questions should be asked separately.</div>
            </div>
          </div>

          {/* Q8 */}
          <div className="q">
            <div className="qhead">
              <div className="qn">8</div>
              <div>
                <div className="qlbl">Question 8</div>
                <div className="qtext">Do you have any existing loans?</div>
              </div>
            </div>
            <div className="fu">
              <div className="flbl">Follow up question 8</div>
              <div className="ftext">How many loans and how much do you owe?</div>
            </div>
          </div>

          {/* Q9 */}
          <div className="q">
            <div className="qhead">
              <div className="qn">9</div>
              <div>
                <div className="qlbl">Question 9</div>
                <div className="qtext">
                  Are you already working with a lender or a bank? If Yes, would you be willing to
                  listen to another offer?
                </div>
              </div>
            </div>
            <div className="fu">
              <div className="flbl">Follow up question 9</div>
              <div className="ftext">
                Have you had difficulty getting approved within the last 30 days?
              </div>
            </div>
            <div className="fu">
              <div className="flbl">Follow up question 9</div>
              <div className="ftext">
                I just want to make sure that you have NOT already been funded, right?
              </div>
            </div>
          </div>

          {/* Q10 */}
          <div className="q">
            <div className="qhead">
              <div className="qn">10</div>
              <div>
                <div className="qlbl">Question 10</div>
                <div className="qtext">
                  Just for documentation purposes, you are not dealing with Bankruptcy as of the
                  moment, right?<span className="thresh">Should be NO</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ───────────────────────── PART 3 — DISCLOSURE ───────────────────────── */}
        <section id="disclosure">
          <div className="kicker">
            <span className="n">Part 3</span>
            <h2>Disclosure</h2>
          </div>
          <p className="plain">
            AFTER GATHERING ALL THE INFORMATION, PROCEED RIGHT AWAY TO THE DISCLOSURE.
          </p>

          <div className="disc">
            <div className="dh">Say this word for word &mdash; it must be on the recording</div>
            <div className="db">
              <p className="dline">
                &hellip;. NOW THAT I HAVE VERIFIED ALL THE INFORMATION HERE, I WILL TRANSFER YOU TO
                AN UNDERWRITER THAT WE HAVE MATCHED YOU WITH.
              </p>
              <p className="dline">
                CAN YOU HOLD FOR ONE MINUTE WHILE I CONNECT THEM?
                <span className="dnote">
                  (Should be, YES. Prospect must be heard answer to this disclosure)
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* ──────────────────── PART 3 (as written) — APPOINTMENTS ──────────────────── */}
        <section id="appointments">
          <div className="kicker">
            <span className="n">Part 3</span>
            <h2>Appointments</h2>
          </div>
          <p className="plain">
            AGENTS CAN BOOK APPOINTMENTS IF A BORROWER DOESN&rsquo;T HAVE TIME TO BE TRANSFERRED -
            THEN THE AGENT WILL CALL BACK AT THE APPOINTMENT AND THEN ATTEMPT TO MAKE THE TRANSFER.
          </p>
        </section>

        {/* ─────────────────────────── PART 4 — RECAP ─────────────────────────── */}
        <section id="recap">
          <div className="kicker">
            <span className="n">Part 4</span>
            <h2>Recap</h2>
          </div>

          <div className="layer">
            <div className="lh">
              First thing we have to verify is their basic info. This must me spelled out
              Phonetically too
            </div>
            <ul className="dash">
              <li>
                <span className="mk">&ndash;</span>Name
              </li>
              <li>
                <span className="mk">&ndash;</span>Company name
              </li>
              <li>
                <span className="mk">&ndash;</span>Phone number and Alternate phone number.
              </li>
              <li>
                <span className="mk">&ndash;</span>Fax
              </li>
              <li>
                <span className="mk">&ndash;</span>Email
              </li>
            </ul>
          </div>

          <div className="layer">
            <div className="lh">Second layer of recap are the things you prequalified.</div>
            <ul className="dash">
              <li>
                <span className="mk">&ndash;</span>Amount Needed
              </li>
              <li>
                <span className="mk">&ndash;</span>When they need the funds
              </li>
              <li>
                <span className="mk">&ndash;</span>Deposit and Credit Score
              </li>
              <li>
                <span className="mk">&ndash;</span>Callback and Appointment Time.
              </li>
            </ul>
          </div>
        </section>

        {/* ─────────────────── PART 5 — GO-TO SCRIPT / REBUTTALS ─────────────────── */}
        <section id="rebuttals">
          <div className="kicker">
            <span className="n">Part 5</span>
            <h2>Go-To Script (If Applicable)</h2>
          </div>

          <div className="reb">
            <div className="ask">If asked about</div>
            <div className="askq">INTEREST RATES, PAYMENT TERM AND TYPE OF LOAN.</div>
            <div className="youlbl">You say</div>
            <blockquote>
              &ldquo;That&rsquo;s the best part, the lenders in our network have a lot of different
              options for you. You&rsquo;d have the power to choose.&rdquo;
            </blockquote>
          </div>

          <div className="reb">
            <div className="ask">If asked</div>
            <div className="askq">
              &ldquo;WHY ARE YOU ASKING TOO MANY QUESTIONS LIKE DEPOSIT, EQUITY AND CREDIT
              SCORE?&rdquo;
            </div>
            <div className="youlbl">You say</div>
            <blockquote>
              &ldquo;We want to ensure that you get the best loan possible, in all ways, that&rsquo;s
              why we ask&rdquo;
            </blockquote>
          </div>
        </section>

        <footer>
          Transcribed verbatim from the Easy Financing Script. Question numbering, follow-up
          numbering and section headings are reproduced exactly as written &mdash; including the two
          &ldquo;Part 3&rdquo; sections. Formatting only; no wording has been changed.
        </footer>
      </div>
    </div>
  );
}
