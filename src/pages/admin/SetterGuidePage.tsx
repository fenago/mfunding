// ─────────────────────────────────────────────────────────────────────────────
// Setter Onboarding Guide — "Your day on the dialer, step by step"
//
// A faithful in-app port of docs/ph/setter_onboarding.html: the Chrome +
// same-session-login rule, the two profile locations, the 3-line dialing steps,
// the on-call flow, the compliance rules, and the troubleshooting table.
// Static reference page — no data fetching.
//
// Audience: brand-new setters (role `closer`). This is the ONE onboarding doc
// they read before their first live call, so it's reachable from their nav.
//
// Theming: the source keyed off prefers-color-scheme / [data-theme]. The app
// drives dark mode with a `dark` class on <html> (see lib/theme-context), so the
// dark token block is scoped to `.dark .son` instead — same colors, app's switch.
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
.son{
  --ink:#0f2942; --ink-soft:#40546b; --ink-faint:#728299;
  --ground:#eef2f7; --panel:#ffffff; --line:#dde5ee; --line-soft:#eaeff5;
  --accent:#0f9d6b; --accent-ink:#0a7a52; --gold:#b5822a; --gold-soft:#f5ecd8;
  --danger:#c0392b; --danger-soft:#fbeae7; --blue:#2f6fb0; --blue-soft:#e8f0f8;
  --shadow:0 1px 2px rgba(15,41,66,.05),0 6px 22px rgba(15,41,66,.06);
  --radius:16px;
  background:var(--ground); color:var(--ink); min-height:100%;
  font-family:-apple-system,"SF Pro Text",system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  line-height:1.55; -webkit-font-smoothing:antialiased;
}
.dark .son{
  --ink:#e9eef5; --ink-soft:#aab9c9; --ink-faint:#7f92a6;
  --ground:#0a141d; --panel:#101d29; --line:#233240; --line-soft:#18242f;
  --accent:#2fc98d; --accent-ink:#5bd9a8; --gold:#d9ab52; --gold-soft:#241d0f;
  --danger:#ef6a5a; --danger-soft:#2a1512; --blue:#6aa6e0; --blue-soft:#12202e;
  --shadow:0 1px 2px rgba(0,0,0,.35),0 8px 26px rgba(0,0,0,.3);
}
.son *{box-sizing:border-box}
.son .wrap{max-width:840px;margin:0 auto;padding:40px 22px 72px}
.son h1,.son h2,.son h3{text-wrap:balance;margin:0;letter-spacing:-.02em}
.son header{margin-bottom:10px}
.son .brand{display:flex;align-items:center;gap:10px}
.son .logo{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--gold));box-shadow:var(--shadow)}
.son .brand b{font-weight:800;font-size:15px}
.son .eyebrow{font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--accent-ink);margin:20px 0 6px}
.son header h1{font-size:clamp(27px,4.4vw,38px);font-weight:850;line-height:1.02;margin-bottom:.35em}
.son .lede{color:var(--ink-soft);font-size:16px;max-width:64ch}
.son .lede b{color:var(--ink)}

.son section{margin-top:34px}
.son .kicker{display:flex;align-items:baseline;gap:11px;margin-bottom:16px;padding-bottom:9px;border-bottom:2px solid var(--line)}
.son .kicker .n{font-size:12px;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums}
.son .kicker h2{font-size:19px;font-weight:800}

.son .cards{display:grid;grid-template-columns:1fr 1fr;gap:13px}
.son .card{border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--shadow);padding:16px 18px;border-top:3px solid var(--accent)}
.son .card.mf{border-top-color:var(--gold)}
.son .card .role{font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint)}
.son .card .nm{font-weight:800;font-size:16px;margin:2px 0 8px}
.son .card .url{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:13px;font-weight:700;color:var(--accent-ink);word-break:break-all}
.son .card .sub{font-size:12.8px;color:var(--ink-soft);margin-top:7px}

.son ol.steps{list-style:none;margin:0;padding:0;counter-reset:s;display:flex;flex-direction:column;gap:2px}
.son ol.steps>li{counter-increment:s;display:grid;grid-template-columns:34px 1fr;gap:14px;align-items:start;padding:13px 0;border-bottom:1px solid var(--line-soft)}
.son ol.steps>li:last-child{border-bottom:0}
.son ol.steps>li::before{content:counter(s);grid-row:span 2;width:29px;height:29px;border-radius:50%;background:var(--accent);color:#fff;font-weight:800;font-size:13px;display:grid;place-items:center;font-variant-numeric:tabular-nums}
.son .st-t{font-weight:750;font-size:15px}
.son .st-d{font-size:13.6px;color:var(--ink-soft);margin-top:3px}
.son .st-d b{color:var(--ink)}
.son code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-size:.88em;background:var(--line-soft);padding:1px 6px;border-radius:5px;font-weight:600;word-break:break-word}
.son .pill{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.04em;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent-ink);vertical-align:middle}

.son .note{border-radius:12px;padding:14px 16px;font-size:13.8px;box-shadow:var(--shadow);margin-top:14px}
.son .note.warn{background:var(--danger-soft);border-left:4px solid var(--danger)}
.son .note.warn b{color:var(--danger)}
.son .note.tip{background:var(--gold-soft);border-left:4px solid var(--gold)}
.son .note.key{background:var(--blue-soft);border-left:4px solid var(--blue)}
.son .note.key b{color:var(--blue)}
.son .note .h{font-weight:800;font-size:13px;letter-spacing:.02em;margin-bottom:3px}

.son ul.rules{list-style:none;margin:0;padding:0}
.son ul.rules li{display:grid;grid-template-columns:22px 1fr;gap:11px;padding:11px 0;border-bottom:1px solid var(--line-soft);font-size:14px}
.son ul.rules li:last-child{border-bottom:0}
.son ul.rules li .mk{color:var(--accent);font-weight:800}
.son ul.rules li.no .mk{color:var(--danger)}
.son ul.rules b{color:var(--ink)}
.son .say{color:var(--accent-ink);font-weight:750}
.son .dont{color:var(--danger);font-weight:750;text-decoration:line-through;text-decoration-thickness:1.5px}

.son .fix{border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--shadow)}
.son .fix .row{display:grid;grid-template-columns:1fr 1.3fr}
.son .fix .row+.row{border-top:1px solid var(--line-soft)}
.son .fix .q{padding:12px 15px;font-weight:750;font-size:13.6px;background:var(--line-soft)}
.son .fix .a{padding:12px 15px;font-size:13.6px;color:var(--ink-soft)}
.son .fix .a b{color:var(--ink)}

.son a{color:var(--accent-ink);font-weight:700;text-decoration:underline;text-underline-offset:2px}
.son .card .sub a{color:var(--accent-ink)}
.son footer{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);color:var(--ink-faint);font-size:12px}

@media (max-width:620px){
  .son .cards{grid-template-columns:1fr}
  .son .fix .row{grid-template-columns:1fr}
  .son .fix .q{background:transparent;padding-bottom:2px}
  .son .fix .a{padding-top:2px}
}
@media print{.son{background:#fff}.son .wrap{max-width:100%;padding:0}.son section{break-inside:avoid}}
`;

// Troubleshooting table — symptom on the left, the fix on the right.
const FIXES: { q: string; a: React.ReactNode }[] = [
  {
    q: 'The "Open by phone" box shows a login screen, not the merchant',
    a: (
      <>
        You're not signed into <b>mfunding.net</b>. Log in (same Chrome window as HotProspector),
        then paste the number again.
      </>
    ),
  },
  {
    q: '"Open by phone" says it can\'t find a number',
    a: (
      <>
        Make sure you pasted <b>10 digits</b> (the box strips dashes/spaces/+1 automatically).
        Re-copy the number from your script and try again.
      </>
    ),
  },
  {
    q: "“Out of leads” / nothing dials",
    a: (
      <>
        Tell your manager &mdash; your campaign needs leads loaded, or you're not assigned to it yet.
      </>
    ),
  },
  {
    q: "Can't log in",
    a: (
      <>
        Use <b>&ldquo;Forgot your password?&rdquo;</b> on <code>mfunding.net</code>, or ask your
        manager to resend your setup link.
      </>
    ),
  },
  {
    q: "Someone's angry you called",
    a: (
      <>
        Stay calm, apologize, and if they say stop &mdash; <b>DNC them and end the call.</b> Never
        argue.
      </>
    ),
  },
];

export default function SetterGuidePage() {
  return (
    <div className="son">
      <style>{CSS}</style>
      <div className="wrap">
        <header>
          <div className="brand">
            <span className="logo" aria-hidden="true" />
            <b>Momentum Funding</b>
          </div>
          <p className="eyebrow">Setter Onboarding &middot; Read This First</p>
          <h1>Your day on the dialer, step by step</h1>
          <p className="lede">
            You call business owners who already have funding, get them interested, and hand them to
            a funding specialist &mdash; capturing what you learn in <b>MFunding</b> so we can send
            their application while they're still on the phone. This guide is written for your very
            first day: follow it top to bottom and you can't go wrong.
          </p>
        </header>

        {/* 01 — THE SETUP RULE */}
        <section>
          <div className="kicker">
            <span className="n">01</span>
            <h2>Set up your browser the right way (do this first)</h2>
          </div>
          <div className="note key">
            <div className="h">The one rule that makes everything work</div>
            Use <b>Google Chrome</b>, and sign into <b>both</b> HotProspector <b>and</b> MFunding in
            the <b>same Chrome window</b>. You'll be logged into both at once, side by side. That
            shared session is what lets the merchant's file open when you <b>paste their number</b>,
            instead of bouncing you to a login screen. Don't use two different browsers, and don't
            use a private/incognito window.
          </div>
          <ol className="steps">
            <li>
              <div>
                <div className="st-t">Open Google Chrome</div>
                <div className="st-d">
                  Not Safari, Edge, or Firefox &mdash; <b>Chrome</b>. Not an incognito window.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Tab 1 — sign into HotProspector</div>
                <div className="st-d">
                  Go to <code>app.hotprospector.com</code> and log in with your HotProspector email +
                  password.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Tab 2 (same window) — sign into MFunding</div>
                <div className="st-d">
                  Open a new tab in the <b>same</b> Chrome window, go to <code>mfunding.net</code>,
                  and log in with your MFunding email + password. Leave both tabs open all day.
                </div>
              </div>
            </li>
          </ol>
          <div className="note tip">
            <div className="h">Forgot a password?</div>
            MFunding: <code>mfunding.net</code> &rarr; <b>&ldquo;Forgot your password?&rdquo;</b>{" "}
            &middot; HotProspector: use <b>&ldquo;Forgot password?&rdquo;</b> on its login screen. If
            you're brand new and haven't set a password yet, your manager sends you a one-time setup
            link &mdash; open it and choose your password.
          </div>
        </section>

        {/* 02 — PROFILE */}
        <section>
          <div className="kicker">
            <span className="n">02</span>
            <h2>Set up your profile in both systems</h2>
          </div>
          <p className="lede" style={{ marginBottom: 14 }}>
            Do this once so your name, number, and password are yours &mdash; not the defaults.
          </p>
          <div className="cards">
            <div className="card">
              <div className="role">Profile 1 &mdash; the dialer</div>
              <div className="nm">HotProspector</div>
              <div className="sub">
                Top-right <b>avatar</b> &rarr; <b>Settings</b> &rarr; <b>Profile</b> tab &rarr;{" "}
                <b>Basic Information</b>. Set your <b>First / Last name</b> and <b>phone</b>, then{" "}
                <b>Submit</b>. Change your password under the <b>Update Password</b> sub-tab.
              </div>
            </div>
            <div className="card mf">
              <div className="role">Profile 2 &mdash; the cockpit</div>
              <div className="nm">MFunding</div>
              <div className="sub">
                Go to <code>mfunding.net/admin/my-profile</code> (or your name/avatar &rarr;{" "}
                <b>My Profile</b>). Fill in your details and save. This is your MFunding account for
                the Playbook you'll use on calls.
              </div>
            </div>
          </div>
        </section>

        {/* 03 — START DIALING */}
        <section>
          <div className="kicker">
            <span className="n">03</span>
            <h2>Start dialing</h2>
          </div>
          <ol className="steps">
            <li>
              <div>
                <div className="st-t">In HotProspector, open the Dialer</div>
                <div className="st-d">
                  Top blue menu &rarr; <b>Dialer</b>. Find the campaign assigned to you:{" "}
                  <b>&ldquo;UCC Parallel-3b.&rdquo;</b>
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Press the green ▶ (Start Calling)</div>
                <div className="st-d">
                  A <b>Session Settings</b> box appears &rarr; tick your <b>time zone</b> &rarr;{" "}
                  <b>Start Dialing</b>.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">
                  It dials 3 at once <span className="pill">3-line</span>
                </div>
                <div className="st-d">
                  The dialer rings <b>three numbers at the same time</b> and connects you the instant
                  one person answers &mdash; the other two drop. You talk; it lines up the next set
                  when you hang up.
                </div>
              </div>
            </li>
          </ol>
        </section>

        {/* 04 — ON A LIVE CALL */}
        <section>
          <div className="kicker">
            <span className="n">04</span>
            <h2>When someone answers</h2>
          </div>
          <ol className="steps">
            <li>
              <div>
                <div className="st-t">Read the script</div>
                <div className="st-d">
                  It <b>auto-loads</b> on the <b>Script</b> tab of your call screen. Follow it &mdash;
                  it keeps you compliant. Remember: it's an{" "}
                  <span className="say">advance / working capital</span>,{" "}
                  <span className="dont">a loan</span>.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Open the merchant in MFunding — by phone</div>
                <div className="st-d">
                  <b>Copy the merchant's phone number</b> (it's shown right in your script), switch to
                  your <b>MFunding tab</b>, and paste it into the{" "}
                  <b>&ldquo;Open a merchant by phone&rdquo;</b> box at the top of the Playbook &rarr;
                  click <b>Open</b>. Their file opens with everything preloaded.{" "}
                  <i>(Any format works &mdash; with or without dashes or +1.)</i>
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Work the Playbook while you have them</div>
                <div className="st-d">
                  Fill in the merchant's details, <b>send the application</b>, and get them to{" "}
                  <b>connect their bank / upload statements</b> right there on the call. &ldquo;Let's
                  knock this out while I've got you.&rdquo;
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Disposition the call</div>
                <div className="st-d">
                  Pick the outcome so the right follow-up fires: <b>Send Application</b>,{" "}
                  <b>Call Back</b>, <b>Not Interested</b>, etc. If they say &ldquo;take me off your
                  list,&rdquo; mark <b>DNC</b> immediately.
                </div>
              </div>
            </li>
          </ol>
          <div className="note warn">
            <div className="h">Don't use the "Gohighlevel Custom Link" in HotProspector</div>
            There's a <b>&ldquo;Gohighlevel Custom Link&rdquo;</b> and a <b>&ldquo;Playbook&rdquo;</b>{" "}
            tab inside HotProspector &mdash; <b>ignore both.</b> The way into MFunding is always the
            same:{" "}
            <b>
              copy the phone number and paste it into the &ldquo;Open a merchant by phone&rdquo; box
            </b>{" "}
            on your MFunding Playbook. That works on every lead.
          </div>
        </section>

        {/* 05 — COMPLIANCE */}
        <section>
          <div className="kicker">
            <span className="n">05</span>
            <h2>Say it right &mdash; every call</h2>
          </div>
          <ul className="rules">
            <li className="no">
              <span className="mk">✕</span>
              <div>
                It's an <span className="say">advance</span>,{" "}
                <span className="say">working capital</span>, or <span className="say">funding</span>{" "}
                &mdash; <span className="dont">never &ldquo;a loan.&rdquo;</span>
              </div>
            </li>
            <li>
              <span className="mk">✓</span>
              <div>
                Open with the recording notice: <b>&ldquo;this call may be recorded.&rdquo;</b>
              </div>
            </li>
            <li>
              <span className="mk">✓</span>
              <div>
                <b>No upfront fees.</b> <b>No guarantees</b> of approval, rate, or amount &mdash;
                it's subject to underwriting.
              </div>
            </li>
            <li>
              <span className="mk">✓</span>
              <div>
                Call only <b>8am&ndash;9pm the merchant's local time</b> (the dialer already enforces
                this &mdash; don't override it).
              </div>
            </li>
            <li className="no">
              <span className="mk">✕</span>
              <div>
                <b>&ldquo;Take me off your list&rdquo;</b> &rarr; mark <b>DNC</b> on the spot. No
                arguing, no re-dial.
              </div>
            </li>
          </ul>
        </section>

        {/* 06 — QUICK FIXES */}
        <section>
          <div className="kicker">
            <span className="n">06</span>
            <h2>If something's off</h2>
          </div>
          <div className="fix">
            {FIXES.map((f) => (
              <div className="row" key={f.q}>
                <div className="q">{f.q}</div>
                <div className="a">{f.a}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 07 — COMMS */}
        <section>
          <div className="kicker">
            <span className="n">07</span>
            <h2>Need help? Message us on Google Chat</h2>
          </div>
          <div className="note key">
            <div className="h">Ad-hoc requests &amp; questions go through Google Chat</div>
            For anything during your shift &mdash; a stuck screen, a lead question, a judgment call
            &mdash; message us on <b>Google Chat</b>. Open it here:{" "}
            <a href="https://chat.google.com/" target="_blank" rel="noopener noreferrer">
              chat.google.com
            </a>{" "}
            (or the <b>Chat</b> icon in Gmail), then search the email below and send a message.
          </div>
          <div className="cards">
            <div className="card">
              <div className="role">Ping on Google Chat</div>
              <div className="nm">Dr. Lee</div>
              <div className="sub">
                <a href="mailto:sales@mfunding.net">sales@mfunding.net</a>
                <br />
                <a href="mailto:socrates73@gmail.com">socrates73@gmail.com</a>
              </div>
            </div>
            <div className="card mf">
              <div className="role">Ping on Google Chat</div>
              <div className="nm">Mr. Carlos Marquez</div>
              <div className="sub">
                <a href="mailto:cmarq2k8@gmail.com">cmarq2k8@gmail.com</a>
              </div>
            </div>
          </div>
        </section>

        <footer>
          Internal training reference for Momentum Funding appointment setters. Not a customer-facing
          document. Questions? Reach Dr. Lee or Mr. Marquez on Google Chat (above) before your first
          live call.
        </footer>
      </div>
    </div>
  );
}
