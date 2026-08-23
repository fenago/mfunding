// ─────────────────────────────────────────────────────────────────────────────
// Setter Onboarding Guide — "Your day on the dialer, step by step"
//
// The setters' one onboarding doc, now teaching the VibeReach + WAVV flow
// (HotProspector is fully retired): Chrome same-session rule, Opportunities →
// MFunding MCA Pipeline → Source filter (UCC/Aged, exact case, APPLY) → Call on
// the New Lead column → 3-line dialing, VM-drop + Resume, contact card →
// Additional Info → Revenue Playbook (~30s load), dispositions, compliance,
// WAVV voicemail setup + scripts, and the troubleshooting table.
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

.son .vm{border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:var(--shadow);padding:15px 18px;margin-top:12px;border-left:4px solid var(--accent)}
.son .vm .tag{font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-faint)}
.son .vm .nm{font-weight:800;font-size:15px;margin:2px 0 8px}
.son .vm blockquote{margin:0;font-size:14.2px;line-height:1.62;color:var(--ink-soft);font-style:italic}
.son .vm blockquote b{color:var(--ink);font-style:normal}
.son .script{margin-top:30px;padding-top:22px;border-top:1px dashed var(--line)}
.son .script:first-of-type{margin-top:6px;padding-top:0;border-top:0}
.son .script .who{font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--gold)}
.son .script h3{font-size:17px;font-weight:800;margin:2px 0 6px}
.son .script .psych{font-size:13.6px;color:var(--ink-soft);max-width:70ch}
.son .script .psych b{color:var(--ink)}
.son .script .lbl{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--accent-ink);margin:16px 0 6px}
.son .branch{display:grid;grid-template-columns:150px 1fr;gap:12px;padding:9px 0;border-bottom:1px solid var(--line-soft);font-size:13.6px}
.son .branch:last-child{border-bottom:0}
.son .branch .cue{font-weight:750;color:var(--ink)}
.son .branch .say-line{color:var(--ink-soft)}
@media (max-width:620px){.son .branch{grid-template-columns:1fr;gap:2px}}
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

// Call scripts by lead type — one persona per script, read word-for-word.
// Objection rows reuse the .fix table; openings/closes use .vm blockquotes.
type CallScript = {
  who: string;
  title: string;
  psych: React.ReactNode;
  opening: React.ReactNode;
  branches: { cue: string; line: React.ReactNode }[];
  qualify: React.ReactNode;
  closeLbl: string;
  close: React.ReactNode;
  objections: { q: string; a: React.ReactNode }[];
};

const SCRIPTS: CallScript[] = [
  {
    who: "Script 1 — UCC leads",
    title: "They already have funding",
    psych: (
      <>
        This owner has funded before — they get twenty of these calls a day, so the win is
        sounding like a <b>person, not a pitch</b>. Two research-backed moves: open with{" "}
        <b>&ldquo;how've you been?&rdquo;</b> (the #1 performing first line across 90,000 analyzed
        cold calls — it makes them stop and think), and state <b>&ldquo;the reason for my
        call&rdquo;</b> inside the first 15 seconds (doubles success). Never sound like you've seen
        their file — the angle is a <b>working-capital review</b>, not &ldquo;I know about your
        advance.&rdquo;
      </>
    ),
    opening: (
      <>
        &ldquo;Hey <b>[First Name]</b>, how&rsquo;ve you been? <i>(pause — let them react)</i> This
        is <b>[Your Name]</b> over at MFunding. The reason for my call &mdash; we work with
        business owners who&rsquo;ve used working capital before, and a lot of them are reviewing
        their options right now: renewals, better positions, extra capital before the busy season.
        Quick one for you &mdash; if the right money showed up at the right price, what would you
        actually put it toward: <b>payroll, equipment, inventory, or just breathing room</b>?&rdquo;
      </>
    ),
    branches: [
      {
        cue: "Names a use",
        line: (
          <>
            &ldquo;Makes sense. And are you still carrying anything from the last advance, or is
            that mostly behind you?&rdquo; <i>(paydown intel — past halfway = renewal window)</i>
          </>
        ),
      },
      {
        cue: "“Nothing right now”",
        line: (
          <>
            &ldquo;Fair. Most owners I talk to aren&rsquo;t shopping today &mdash; they just want to
            know what they qualify for <i>before</i> the slow month or the big job shows up. Takes
            two minutes to have it on file. Worth doing?&rdquo;
          </>
        ),
      },
      {
        cue: "“Who is this again?”",
        line: (
          <>
            &ldquo;MFunding &mdash; we&rsquo;re a funding brokerage, so funders compete for our
            files instead of you taking one offer. And owners who&rsquo;ve funded before get the
            better end of that.&rdquo;
          </>
        ),
      },
      {
        cue: "The pivot",
        line: (
          <>
            &ldquo;Easiest way to do this: I grab a two-minute picture, our specialist prices you
            with a few funders, and you see real numbers &mdash; no cost, and no credit impact for
            this part. Fair enough?&rdquo; <i>(capture the application)</i>
          </>
        ),
      },
    ],
    qualify: (
      <>
        We already have the business name. <b>Get first: best cell number and email.</b> Then: owner
        first + last name &bull; entity type (LLC, corp, sole prop) &bull; EIN &bull; years in
        business &bull; industry &bull; business address &bull; &ldquo;Who do you bank with?&rdquo;
        (get the <b>bank name</b>) &bull; optional: owner home address &mdash; &ldquo;Funders
        usually want the owner&rsquo;s home address on the app &mdash; want to knock that out
        now?&rdquo;
      </>
    ),
    closeLbl: "The close — bank statements, then the fallbacks",
    close: (
      <>
        <b>Best outcome:</b> &ldquo;Last thing &mdash; offers get built off your last 3 months of
        business bank statements. <b>Is this cell OK to text?</b> I&rsquo;ll send a secure upload
        link right now, and you&rsquo;re done &mdash; the specialist calls you with actual numbers
        instead of a sales pitch.&rdquo; <b>No statements?</b> Finish the application anyway — the
        specialist collects docs later. <b>No application?</b> &ldquo;No problem. Can I at least set
        you up with 15 minutes with the specialist &mdash; [time] or [time]? And is it OK if I text
        you the confirmation?&rdquo;
      </>
    ),
    objections: [
      {
        q: "“How did you get my info?”",
        a: (
          <>
            &ldquo;Fair question. When a business takes an advance, a UCC filing goes on public
            record &mdash; that&rsquo;s where we found you. That&rsquo;s all I can see &mdash;
            I&rsquo;m not inside your business.&rdquo;
          </>
        ),
      },
      {
        q: "“I'm not taking on more debt.”",
        a: (
          <>
            &ldquo;Respect that &mdash; and that&rsquo;s actually the best time to talk. Once
            you&rsquo;re past halfway paid down, funders compete for the renewal, usually on better
            terms than round one. Where are you at on it?&rdquo;
          </>
        ),
      },
      {
        q: "“My last advance was way too expensive.”",
        a: (
          <>
            &ldquo;Some of them are. That&rsquo;s literally why brokers exist &mdash; one file,
            several funders bidding, you see it in writing and toss it if it&rsquo;s not better
            than what you had. Nothing to lose but the two minutes.&rdquo;
          </>
        ),
      },
      {
        q: "“I get 20 of these calls a day.”",
        a: (
          <>
            &ldquo;I believe you, and I won&rsquo;t waste your time. Two minutes of questions, real
            numbers from the specialist, you decide. That&rsquo;s the whole thing.&rdquo;
          </>
        ),
      },
      {
        q: "“Not interested, I'm all set.”",
        a: (
          <>
            &ldquo;No problem at all. Can I ask &mdash; is it funding in general you&rsquo;re done
            with, or just the twenty guys a day calling about it?&rdquo; <i>(Pause. This gets a
            laugh and the real answer. If they're truly done: &ldquo;Want me to text you my info so
            you have it if that changes?&rdquo; — a yes is still a win.)</i>
          </>
        ),
      },
      {
        q: "“Take me off your list.”",
        a: (
          <>
            &ldquo;Done &mdash; I&rsquo;m marking you do-not-contact right now. Have a good
            one.&rdquo; <b>Disposition: Do Not Contact — always, immediately, no rebuttal.</b>
          </>
        ),
      },
    ],
  },
  {
    who: "Script 2 — Aged leads",
    title: "They asked about funding before",
    psych: (
      <>
        They raised their hand once — they wanted capital, and something killed it: timing, a slow
        broker, a bad offer. The research-backed play is the <b>warm recall hook</b> (reference the
        prior inquiry — it makes the call feel familiar, not cold) plus the <b>market-timing
        question</b>: &ldquo;has anything changed with cash flow since?&rdquo; And here the{" "}
        <b>&ldquo;how've you been?&rdquo;</b> opener is completely natural — they DID talk to
        somebody once.
      </>
    ),
    opening: (
      <>
        &ldquo;Hey <b>[First Name]</b>, how&rsquo;ve you been? <i>(pause)</i> <b>[Your Name]</b>{" "}
        with MFunding. Reason for my call &mdash; you&rsquo;d reached out a while back about
        working capital for <b>[Business Name]</b>, and nothing ever came of it. Usually that
        means the timing was off, or somebody&rsquo;s offer wasn&rsquo;t worth the paper. Which was
        it for you?&rdquo;
      </>
    ),
    branches: [
      {
        cue: "“Timing”",
        line: (
          <>
            &ldquo;Got it. Has anything changed with cash flow since &mdash; costs up, a big job
            coming, slow season ahead? A lot of owners who passed last year are re-checking their
            numbers now.&rdquo; <i>(pivot to capture)</i>
          </>
        ),
      },
      {
        cue: "“The offers were garbage”",
        line: (
          <>
            &ldquo;Good instinct &mdash; one funder&rsquo;s number isn&rsquo;t a market. We make
            several compete off the same file. Worst case, you confirm you were right to
            walk.&rdquo; <i>(pivot to capture)</i>
          </>
        ),
      },
      {
        cue: "“Got funded elsewhere”",
        line: (
          <>
            &ldquo;Glad it worked out. How far into it are you &mdash; mostly paid down?&rdquo;{" "}
            <i>(you are now on the UCC script — renewals price better past halfway)</i>
          </>
        ),
      },
      {
        cue: "“Don't remember / wasn't me”",
        line: (
          <>
            &ldquo;Could&rsquo;ve been a partner, or a good while back &mdash; no worries. While
            I&rsquo;ve got you: anything on the horizon money would make easier &mdash; payroll,
            equipment, expansion?&rdquo; If nothing &mdash; polite exit, ask OK to text your info.
          </>
        ),
      },
    ],
    qualify: (
      <>
        Same capture, same order: <b>cell + email first</b>, then owner name, entity type, EIN,
        years in business, industry, business address, bank name, optional home address.
      </>
    ),
    closeLbl: "The close — bank statements, then the fallbacks",
    close: (
      <>
        Same ladder as UCC: statements link (<b>&ldquo;is this cell OK to text?&rdquo;</b>) &rarr;
        application only &rarr; 15-minute appointment with the specialist + OK to text the
        confirmation.
      </>
    ),
    objections: [
      {
        q: "“I never inquired about anything.”",
        a: (
          <>
            &ldquo;No worries &mdash; could&rsquo;ve been a partner, or a good while back. Either
            way you&rsquo;ve got the right person on the phone: 30 seconds tells me whether
            [Business Name] qualifies for anything worth your time. What&rsquo;s monthly revenue
            running, roughly?&rdquo;
          </>
        ),
      },
      {
        q: "“The timing still isn't right.”",
        a: (
          <>
            &ldquo;Totally fine. Quick question though &mdash; when the time <i>is</i> right, is it
            usually because something good happens, or because something breaks? <i>(pause)</i>{" "}
            Either way, knowing what you qualify for beforehand costs nothing. Two minutes now,
            numbers on the shelf.&rdquo;
          </>
        ),
      },
      {
        q: "“Rates are too high everywhere.”",
        a: (
          <>
            &ldquo;Heard. Two things: this is based on your <b>revenue</b>, not your credit score
            &mdash; and I don&rsquo;t work for one funder, I make several of them compete for you.
            You see the real number in writing before you decide anything. Fair?&rdquo;
          </>
        ),
      },
      {
        q: "“Just send me some information.”",
        a: (
          <>
            &ldquo;Generic brochures are useless to you. Give me the two minutes, and what you get
            back is built on <i>your</i> actual business &mdash; that&rsquo;s information worth
            reading.&rdquo;
          </>
        ),
      },
      {
        q: "“I'm busy.”",
        a: (
          <>
            &ldquo;Totally get it. When&rsquo;s better &mdash; <b>[time]</b> or <b>[time]</b>?
            I&rsquo;ll text you a reminder if that&rsquo;s OK.&rdquo;
          </>
        ),
      },
      {
        q: "“Take me off your list.”",
        a: (
          <>
            Honor it instantly &mdash; <b>Disposition: Do Not Contact</b>, no rebuttal, ever.
          </>
        ),
      },
    ],
  },
  {
    who: "Script 3 — Trigger leads",
    title: "They're shopping for funding right now",
    psych: (
      <>
        This owner is in-market <b>this week</b> — they&rsquo;ve applied somewhere and are waiting
        on numbers. The clock is running: whoever shows real numbers first usually wins. Your angle
        is never &ldquo;switch to us&rdquo; — it&rsquo;s <b>&ldquo;never take the first
        offer&rdquo;</b> — and if they say they&rsquo;re not looking, believe them and exit
        gracefully.
      </>
    ),
    opening: (
      <>
        &ldquo;Hey <b>[First Name]</b> &mdash; <b>[Your Name]</b> with MFunding. Reason for the
        call: when a business owner starts a funding application, that inquiry shows up across the
        industry &mdash; that&rsquo;s how I know. I&rsquo;m not here to talk you out of anything.
        I&rsquo;m here because you should <b>never take the first number you&rsquo;re shown</b>.
        Where are you in it &mdash; waiting on an offer, or already holding one?&rdquo;
      </>
    ),
    branches: [
      {
        cue: "“Still waiting on numbers”",
        line: (
          <>
            &ldquo;Perfect timing then. While they make you wait, we can have a second set of
            numbers in 24 to 48 hours. Comparing beats hoping.&rdquo;{" "}
            <i>(capture the application)</i>
          </>
        ),
      },
      {
        cue: "“I have an offer already”",
        line: (
          <>
            &ldquo;Congrats &mdash; you&rsquo;re in the driver&rsquo;s seat. What did they come in
            at? <i>(listen)</i> Whatever it is, a second bid either beats it or proves it. Costs
            you two minutes.&rdquo; <i>(capture the application)</i>
          </>
        ),
      },
      {
        cue: "“Already signed”",
        line: (
          <>
            &ldquo;Done deal &mdash; respect. One thing worth knowing: once you&rsquo;re past
            halfway paid down, a renewal or better position opens up. OK if I text you my info for
            when that hits?&rdquo;
          </>
        ),
      },
      {
        cue: "“I'm not looking”",
        line: (
          <>
            &ldquo;Then my data&rsquo;s off &mdash; it happens. Ten seconds while I&rsquo;ve got
            you: if capital ever <i>is</i> on the list, we do this with no credit impact and no
            obligation. OK if I text you my info?&rdquo;
          </>
        ),
      },
    ],
    qualify: (
      <>
        Same capture, same order: <b>cell + email first</b>, then owner name, entity type, EIN,
        years in business, industry, business address, bank name, optional home address.
      </>
    ),
    closeLbl: "The close — statements first, and move fast",
    close: (
      <>
        <b>Best outcome:</b> &ldquo;You&rsquo;re already pulling statements together for somebody
        else anyway &mdash; same documents, one more set of offers. <b>Is this cell OK to text?</b>{" "}
        I&rsquo;ll send a secure upload link right now for your last 3 months of business bank
        statements, and the specialist calls you with actual numbers.&rdquo; <b>No statements?</b>{" "}
        Finish the application anyway. <b>No application?</b> &ldquo;Timing matters on this one, so
        let&rsquo;s not sit on it &mdash; I&rsquo;ve got [time] today with the specialist, or [time]
        tomorrow. And is it OK if I text you the confirmation?&rdquo;
      </>
    ),
    objections: [
      {
        q: "“How do you know I'm looking?”",
        a: (
          <>
            &ldquo;When a business owner starts shopping for funding, that activity shows up in
            industry data that funders and brokers subscribe to &mdash; that&rsquo;s how it works
            behind the curtain. The upside for you is competition: you should never have to take
            the first offer.&rdquo;
          </>
        ),
      },
      {
        q: "“I'm already working with someone.”",
        a: (
          <>
            &ldquo;Keep working with them &mdash; seriously. All I&rsquo;m adding is a second bid.
            You wouldn&rsquo;t take one bid on a job at your business; don&rsquo;t take one on your
            money. If their deal is best, I&rsquo;ll be the first to tell you to sign it.&rdquo;
          </>
        ),
      },
      {
        q: "“I just got declined.”",
        a: (
          <>
            &ldquo;Then you called a bank or the wrong funder &mdash; declines are half my day. Our
            funders look at your revenue, not just a credit score, and every funder&rsquo;s box is
            different. What reason did they give you?&rdquo;
          </>
        ),
      },
      {
        q: "“I don't want my credit pulled again.”",
        a: (
          <>
            &ldquo;It won&rsquo;t be. This conversation and the initial review have <b>zero</b>{" "}
            credit impact. Nothing gets formally submitted to any funder without your OK
            first.&rdquo;
          </>
        ),
      },
      {
        q: "“Is this a loan?”",
        a: (
          <>
            &ldquo;For the working capital advance &mdash; no, it&rsquo;s not a loan and there&rsquo;s
            no interest rate. It&rsquo;s an advance based on your future revenue, with one fixed
            payback amount you&rsquo;ll see in writing before you decide anything. We also broker
            true loan products, and the specialist will tell you plainly which is which.&rdquo;
          </>
        ),
      },
      {
        q: "“Take me off your list.”",
        a: (
          <>
            Honor it instantly &mdash; <b>Disposition: Do Not Contact</b>, no rebuttal, ever.
          </>
        ),
      },
    ],
  },
];

// Troubleshooting table — symptom on the left, the fix on the right.
const FIXES: { q: string; a: React.ReactNode }[] = [
  {
    q: "The Revenue Playbook link shows a login screen, not the merchant",
    a: (
      <>
        You're not signed into <b>mfunding.net</b> in this Chrome window. Open a tab, log in, then
        click the Playbook link again.
      </>
    ),
  },
  {
    q: "I applied the filter but the number of opportunities didn't change",
    a: (
      <>
        You probably didn't press the blue <b>Apply</b> button, or the value isn't exact. It must be{" "}
        <code>UCC</code> or <code>Aged</code> &mdash; <b>capital letters matter.</b> The count next
        to the pipeline name changes when the filter is really on.
      </>
    ),
  },
  {
    q: "The contact has no Revenue Playbook link under Additional Info",
    a: (
      <>
        Tell your manager &mdash; that lead wasn't loaded correctly. Meanwhile, find the merchant
        with MFunding's <b>search bar</b> (name, business, or phone) and keep working.
      </>
    ),
  },
  {
    q: "Nothing dials when I press Call",
    a: (
      <>
        Check you're on the <b>New Lead</b> column of <b>MFunding MCA Pipeline</b> with the Source
        filter applied. Still nothing? Tell your manager.
      </>
    ),
  },
  {
    q: "Can't log in",
    a: (
      <>
        Use <b>&ldquo;Forgot your password?&rdquo;</b> on <code>app.vibereach.io</code> or{" "}
        <code>mfunding.net</code>, or ask your manager to resend your setup link.
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
            Use <b>Google Chrome</b>, and sign into <b>both</b> VibeReach <b>and</b> MFunding in the{" "}
            <b>same Chrome window</b>. You'll be logged into both at once, side by side. That shared
            session is what lets the <b>Revenue Playbook</b> link open the merchant's file in
            MFunding instead of bouncing you to a login screen. Don't use two different browsers,
            and don't use a private/incognito window.
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
                <div className="st-t">Tab 1 — sign into VibeReach</div>
                <div className="st-d">
                  Go to <code>app.vibereach.io</code> and log in with your VibeReach email +
                  password. This is where you dial.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Tab 2 (same window) — sign into MFunding</div>
                <div className="st-d">
                  Open a new tab in the <b>same</b> Chrome window, go to <code>mfunding.net</code>,
                  and log in with your MFunding email + password. This is where the Revenue Playbook
                  lives. Leave both tabs open all day.
                </div>
              </div>
            </li>
          </ol>
          <div className="note tip">
            <div className="h">Forgot a password?</div>
            MFunding: <code>mfunding.net</code> &rarr; <b>&ldquo;Forgot your password?&rdquo;</b>{" "}
            &middot; VibeReach: use <b>&ldquo;Forgot password?&rdquo;</b> on{" "}
            <code>app.vibereach.io</code>. If you're brand new and haven't set a password yet, your
            manager sends you a one-time setup link &mdash; open it and choose your password.
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
              <div className="nm">VibeReach</div>
              <div className="sub">
                In <code>app.vibereach.io</code>: your <b>avatar</b> (top right) &rarr;{" "}
                <b>My Profile</b>. Set your <b>name</b> and check your details, then save. Your
                voicemail recording lives in the WAVV dialer settings (section 07).
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
                <div className="st-t">In VibeReach, open Opportunities</div>
                <div className="st-d">
                  Left sidebar &rarr; <b>Opportunities</b>. In the pipeline dropdown (top left),
                  choose <b>&ldquo;MFunding MCA Pipeline.&rdquo;</b>
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Filter to your book — one filter only</div>
                <div className="st-d">
                  <b>Advanced Filters</b> &rarr; <b>Add filter</b> &rarr; <b>Source</b> &rarr;{" "}
                  <b>Is</b> &rarr; type <code>UCC</code> or <code>Aged</code> (whichever list your
                  manager assigned you). <b>Capital letters matter</b> &mdash; type it exactly. Then
                  press the blue <b>Apply</b> button; nothing happens until you do. Confirm it took:
                  the count next to the pipeline name drops. Use <b>only</b> this one Source filter
                  &mdash; don't stack anything else.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">
                  Press &ldquo;Call&rdquo; on the New Lead column{" "}
                  <span className="pill">3-line</span>
                </div>
                <div className="st-d">
                  On the <b>New Lead</b> column header, press the <b>Call</b> button &mdash; that's
                  the <b>WAVV dialer</b>. It rings <b>three numbers at the same time</b>; the moment
                  one person answers, the other two drop. You talk; it lines up the next 3 when
                  you're done.
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
                <div className="st-t">Voicemail? Drop it and keep moving</div>
                <div className="st-d">
                  If a line hits an answering machine, press the <b>Voicemail</b> button, then{" "}
                  <b>Resume</b>. WAVV sends your <b>pre-recorded voicemail</b> (section 07) and
                  dials the next 3. That's the whole move &mdash; Voicemail, Resume, next.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Live answer — WAVV opens the contact</div>
                <div className="st-d">
                  When a real person picks up, WAVV opens their <b>contact card</b>. Talk first,
                  click second. Remember: it's an{" "}
                  <span className="say">advance / working capital</span>,{" "}
                  <span className="dont">a loan</span>.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Open the Revenue Playbook</div>
                <div className="st-d">
                  On the contact card, go to <b>Additional Info</b> and click the{" "}
                  <b>Revenue Playbook</b> link. It opens the merchant's file in{" "}
                  <b>mfunding.net</b> &mdash; give it up to <b>30 seconds</b> to load. Click it{" "}
                  <b>once</b> and wait; don't keep clicking.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Work the Playbook while you have them</div>
                <div className="st-d">
                  Follow the Playbook top to bottom: fill in the merchant's details,{" "}
                  <b>send the application</b>, and get them to{" "}
                  <b>connect their bank / upload statements</b> right there on the call. &ldquo;Let's
                  knock this out while I've got you.&rdquo;
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Disposition every live call in WAVV</div>
                <div className="st-d">
                  Every call that <b>wasn't</b> a voicemail gets a disposition in WAVV &mdash; pick
                  the outcome so the right follow-up fires: <b>Send Application</b>,{" "}
                  <b>Call Back</b>, <b>Not Interested</b>, etc. If they say &ldquo;take me off your
                  list,&rdquo; mark <b>DNC</b> immediately.
                </div>
              </div>
            </li>
          </ol>
          <div className="note warn">
            <div className="h">Two things to know</div>
            The Playbook takes up to <b>30 seconds</b> to open &mdash; that's normal; one click,
            then wait. And if a contact has <b>no Revenue Playbook link</b> under Additional Info,
            tell your manager &mdash; it means the lead wasn't loaded correctly; meanwhile you can
            find the merchant with the <b>search bar</b> in MFunding (name, business, or phone).
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

        {/* 07 — WAVV VOICEMAIL DROPS */}
        <section>
          <div className="kicker">
            <span className="n">07</span>
            <h2>Voicemails &amp; recordings in the WAVV dialer</h2>
          </div>
          <p className="lede" style={{ marginBottom: 14 }}>
            Record your voicemail <b>once</b>; the dialer drops it for you all day. When you hit an
            answering machine on a live line, click the <b>voicemail icon</b> — and on multiline
            dialing, WAVV automatically drops it on background lines that reach voicemail while
            you&rsquo;re talking to a live person. You don&rsquo;t have to do anything.
          </p>
          <ol className="steps">
            <li>
              <div>
                <div className="st-t">Open WAVV settings</div>
                <div className="st-d">
                  Launch the WAVV dialer, then click the <b>gear/cog icon</b> at the top right of the
                  dialer banner &rarr; <b>Voicemails</b> tab on the left.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Pick a recording method</div>
                <div className="st-d">
                  <b>Record via Computer</b> (allow Chrome mic permission when asked),{" "}
                  <b>Record via Phone</b> (a pop-up gives you a number and a 3-digit PIN — use this
                  if your computer mic sounds rough), or <b>Upload Audio File</b>.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Record it — 20 to 30 seconds</div>
                <div className="st-d">
                  Click the microphone to start, the red button to stop, then play it back.
                  Re-record until it sounds like a <b>phone call, not a commercial</b>. Record 3&ndash;4
                  takes and keep the natural one.
                </div>
              </div>
            </li>
            <li>
              <div>
                <div className="st-t">Name it and save</div>
                <div className="st-d">
                  Use a clear name like <code>MFunding – Working Capital Intro</code> so you grab the
                  right one during sessions.
                </div>
              </div>
            </li>
          </ol>
          <div className="vm">
            <div className="tag">Script A &mdash; primary (~25 seconds)</div>
            <div className="nm">Working Capital Intro</div>
            <blockquote>
              &ldquo;Hi, this is <b>[First Name]</b> with MFunding here in South Florida. I&rsquo;m
              reaching out because we&rsquo;re currently approving working capital for businesses in
              your industry &mdash; typically $20,000 to $500,000, often funded in as little as 24
              to 48 hours, and it&rsquo;s based on your revenue, not your credit. If you&rsquo;ve got a
              project, payroll, or opportunity that needs cash faster than a bank moves, give me a
              call back at <b>[Callback Number]</b>. Again, that&rsquo;s <b>[First Name]</b> with
              MFunding, <b>[Callback Number]</b>. Talk soon.&rdquo;
            </blockquote>
          </div>
          <div className="vm">
            <div className="tag">Script B &mdash; short test (~15 seconds)</div>
            <div className="nm">Quick Approvals</div>
            <blockquote>
              &ldquo;Hey, it&rsquo;s <b>[First Name]</b> over at MFunding. Quick call &mdash;
              we&rsquo;ve got approvals going out this week for business owners in your area, up to
              $500K based on revenue, not credit. Call me back at <b>[Callback Number]</b> and
              I&rsquo;ll tell you what you&rsquo;d qualify for. Again, <b>[Callback Number]</b>.
              Thanks.&rdquo;
            </blockquote>
          </div>
          <p className="lede" style={{ margin: "18px 0 14px" }}>
            The drop above is one of <b>four recordings</b> your line needs. The other three:
            the <b>Callback Message</b> (plays to a live person who answers while you&rsquo;re
            already on another call &mdash; set in the same Settings &rarr; <b>Voicemails</b> tab),
            your <b>personal voicemail greeting</b> (what a merchant hears when they call your
            number back and you miss it), and the <b>team voicemail greeting</b> (the shared
            MFunding line). Record all of them &mdash; your outbound drop tells people to call
            back, so what they hit when they do has to sound like MFunding.
          </p>
          <div className="vm">
            <div className="tag">Callback Message &mdash; live answer while you&rsquo;re busy (~15 seconds)</div>
            <div className="nm">Busy-Line Callback</div>
            <blockquote>
              &ldquo;Hi &mdash; so sorry, this is <b>[First Name]</b> with MFunding, and I stepped
              onto another call right as you picked up. I was calling about working capital
              approvals for businesses like yours &mdash; up to five hundred thousand, based on
              revenue, not credit. Call me right back at <b>[Callback Number]</b> &mdash; again,
              that&rsquo;s <b>[Callback Number]</b> &mdash; or I&rsquo;ll try you again shortly.
              Thanks!&rdquo;
            </blockquote>
          </div>
          <div className="vm">
            <div className="tag">Personal voicemail &mdash; your own line&rsquo;s greeting</div>
            <div className="nm">Missed Callback Greeting</div>
            <blockquote>
              &ldquo;Hi, you&rsquo;ve reached <b>[First Name]</b> with MFunding. Sorry I missed you
              &mdash; I&rsquo;m probably on the line with another business owner right now. Leave
              your name, your business name, and the best number to reach you, and I&rsquo;ll call
              you right back. If you&rsquo;re calling about working capital for your business,
              you&rsquo;re in the right place. Talk soon.&rdquo;
            </blockquote>
          </div>
          <div className="vm">
            <div className="tag">Team voicemail &mdash; the shared MFunding line</div>
            <div className="nm">Main Line Greeting</div>
            <blockquote>
              &ldquo;Thanks for calling MFunding &mdash; business funding made simple. We help
              business owners access working capital from twenty thousand to five hundred thousand
              dollars, based on your revenue, not your credit. Leave your name, your business name,
              and the best callback number, and a funding specialist will get right back to you.
              You can also visit mfunding-dot-net to get started online. We&rsquo;ll talk
              soon.&rdquo;
            </blockquote>
          </div>
          <div className="note tip">
            <div className="h">Delivery notes</div>
            Say the callback number <b>twice, slowly</b> &mdash; that&rsquo;s the #1 reason callbacks
            get lost. <b>Smile while recording</b>; it genuinely changes the tone. Re-record fresh
            every few weeks so it doesn&rsquo;t sound canned to repeat-dial prospects.
          </div>
          <div className="note warn">
            <div className="h">Two settings that change whether voicemails happen at all</div>
            <b>Answer Boost</b> mode skips answering machines entirely &mdash; no voicemails get
            left; use <b>standard mode</b> on days you want VM drops. And in General Settings, set
            the <b>ring timeout to 5&ndash;10 rings</b> so calls actually reach voicemail instead of
            cutting off early. As always: scripts say <span className="say">working capital</span>,{" "}
            <span className="dont">never &ldquo;a loan&rdquo;</span> &mdash; and DNC requests get
            honored on the spot.
          </div>
        </section>

        {/* 08 — CALL SCRIPTS BY LEAD TYPE */}
        <section>
          <div className="kicker">
            <span className="n">08</span>
            <h2>The scripts — UCC, Aged &amp; Trigger</h2>
          </div>
          <p className="lede" style={{ marginBottom: 6 }}>
            Three lists, three different people on the other end. The <b>Source</b> on the
            opportunity tells you which script you&rsquo;re on. Every call has the same{" "}
            <b>goal ladder</b> — get the best outcome you can before you hang up:{" "}
            <b>1) full application + bank statements</b>, <b>2) full application</b>,{" "}
            <b>3) an appointment with the funding specialist + permission to text</b>. These
            scripts are also loaded in the WAVV dialer (Call Scripts) so they&rsquo;re on screen
            during the call.
          </p>

          {SCRIPTS.map((s) => (
            <div className="script" key={s.who}>
              <div className="who">{s.who}</div>
              <h3>{s.title}</h3>
              <p className="psych">{s.psych}</p>

              <div className="lbl">Opening (~15 seconds)</div>
              <div className="vm" style={{ marginTop: 0 }}>
                <blockquote>{s.opening}</blockquote>
              </div>

              <div className="lbl">Branch on their answer</div>
              <div>
                {s.branches.map((b) => (
                  <div className="branch" key={b.cue}>
                    <div className="cue">{b.cue}</div>
                    <div className="say-line">{b.line}</div>
                  </div>
                ))}
              </div>

              <div className="lbl">Capture the application — cell + email first, in this order</div>
              <div className="vm" style={{ marginTop: 0 }}>
                <blockquote>{s.qualify}</blockquote>
              </div>

              <div className="lbl">{s.closeLbl}</div>
              <div className="vm" style={{ marginTop: 0 }}>
                <blockquote>{s.close}</blockquote>
              </div>

              <div className="lbl">Overcoming objections</div>
              <div className="fix">
                {s.objections.map((o) => (
                  <div className="row" key={o.q}>
                    <div className="q">{o.q}</div>
                    <div className="a">{o.a}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="note warn" style={{ marginTop: 22 }}>
            <div className="h">Rules that apply to all three scripts — drill these</div>
            <b>Deliver the opener in one confident breath</b> (~20 seconds), then ask ONE question
            and be quiet — the data says top callers talk first, then listen. <b>Never argue an
            objection</b>: agree with it, then ask a curious question. <b>Work the goal ladder
            every call</b> — application + statements beats application beats appointment, but any
            rung beats nothing; never quote rates, never promise an approval.{" "}
            <span className="say">Working capital / advance / funding</span>,{" "}
            <span className="dont">never &ldquo;a loan&rdquo;</span> for the advance product (the
            &ldquo;is this a loan?&rdquo; answer above is the only exception). Always the{" "}
            <b>two-option close</b> — &ldquo;[TIME] or [TIME]?&rdquo;, never &ldquo;when works for
            you?&rdquo;. <b>DNC is sacred</b> — &ldquo;stop calling&rdquo; means the do-not-contact
            disposition on the spot, no rebuttal. <b>Disposition every single call</b> — the board
            automation runs off it. And talk 30% / listen 70% while qualifying: what they say goes
            in the Playbook, because the closer&rsquo;s first 60 seconds depends on it.
          </div>
        </section>

        {/* 09 — COMMS */}
        <section>
          <div className="kicker">
            <span className="n">09</span>
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
