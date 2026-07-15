// OSHowItWorks — the "How it works" section for the Momentum OS landing.
// The full-width, expanded version of the hero's dispatch clock: the same three
// rows (01 APPLY -> 02 REVIEW -> 03 GET FUNDED), stretched into a horizontal
// timeline so the page has a through-line. A thin track behind the numbers fills
// go-green up to step 2 and sits amber/pending at step 3 — tying back to the hero
// progress bar. Steps stay product-neutral (no "loan"/"advance" claim needed here).
import { OSSection, Eyebrow, Display, CTAPrimary } from "./OSKit";

type Step = {
  n: string;
  title: string;
  desc: string;
  chip: string;
  state: "done" | "live" | "wait";
};

const STEPS: Step[] = [
  {
    n: "01",
    title: "APPLY",
    desc: "Fill out the 5-minute application. It's free and won't affect your credit score.",
    chip: "~5 MIN",
    state: "done",
  },
  {
    n: "02",
    title: "REVIEW",
    desc: "We read your cash flow, not just your credit, and bring you clear, transparent offers.",
    chip: "~24 HRS",
    state: "done",
  },
  {
    n: "03",
    title: "GET FUNDED",
    desc: "Accept an offer and the funds hit your business bank account — often same day.",
    chip: "SAME DAY",
    state: "live",
  },
];

export default function OSHowItWorks() {
  return (
    <OSSection tone="panel" id="how">
      <style>{CSS}</style>

      <div className="osw-head">
        <Eyebrow>HOW IT WORKS</Eyebrow>
        <Display>
          THREE STEPS.
          <br />
          <span className="os-go">FORTY-EIGHT HOURS.</span>
        </Display>
      </div>

      <div className="osw-board" role="list">
        {/* the shared progress track: filled go-green through step 2, amber-pending at 3 */}
        <div className="osw-track" aria-hidden>
          <span className="osw-track-fill" />
          <span className="osw-track-dot osw-track-dot-1" />
          <span className="osw-track-dot osw-track-dot-2" />
          <span className="osw-track-dot osw-track-dot-3" />
        </div>

        {STEPS.map((s, i) => (
          <div className={`osw-step osw-step-${s.state}`} role="listitem" key={s.n}>
            <div className="osw-step-top">
              <span className="osw-n">{s.n}</span>
              {i < STEPS.length - 1 && <span className="osw-arrow" aria-hidden>→</span>}
            </div>
            <div className="osw-step-title">
              {s.state === "done" && <span className="os-check osw-tick">✓</span>}
              {s.state === "live" && <span className="osw-pulse" aria-hidden />}
              {s.title}
            </div>
            <p className="osw-desc">{s.desc}</p>
            <span className="osw-chip">{s.chip}</span>
          </div>
        ))}
      </div>

      <div className="osw-foot">
        <CTAPrimary href="/apply">Start your application</CTAPrimary>
        <p className="osw-fine">WON&rsquo;T AFFECT YOUR CREDIT&nbsp;&nbsp;·&nbsp;&nbsp;NO UPFRONT FEES</p>
      </div>
    </OSSection>
  );
}

const CSS = `
.osw-head{margin-bottom:44px}

.osw-board{position:relative;display:grid;grid-template-columns:repeat(3,1fr);gap:20px}

/* the horizontal progress track sitting behind the numbered steps */
.osw-track{position:absolute;top:26px;left:8%;right:8%;height:4px;border-radius:6px;
  background:rgba(255,255,255,.07);z-index:0}
.osw-track-fill{position:absolute;left:0;top:0;height:100%;width:66%;border-radius:6px;
  background:linear-gradient(90deg,var(--go-deep),var(--go));
  box-shadow:0 0 18px -2px rgba(22,217,146,.45);
  transform-origin:left center;animation:osw-fill 1s cubic-bezier(.2,.7,.2,1) both}
.osw-track-dot{position:absolute;top:50%;width:11px;height:11px;border-radius:50%;
  transform:translate(-50%,-50%);background:var(--panel);border:2px solid var(--go)}
.osw-track-dot-1{left:0}
.osw-track-dot-2{left:66%}
.osw-track-dot-3{left:100%;border-color:var(--amber);
  box-shadow:0 0 0 0 rgba(246,178,75,.5);animation:os-ping 1.8s ease-out infinite}

@keyframes osw-fill{from{transform:scaleX(0)}to{transform:scaleX(1)}}

/* each step card */
.osw-step{position:relative;z-index:1;background:linear-gradient(180deg,var(--panel),var(--panel2));
  border:1px solid var(--hair);border-radius:14px;padding:22px 22px 24px;
  transition:border-color .18s,transform .18s}
.osw-step:hover{border-color:rgba(22,217,146,.35);transform:translateY(-3px)}
.osw-step-live{border-color:rgba(246,178,75,.35)}

.osw-step-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.osw-n{font-family:'Anton',sans-serif;font-size:clamp(40px,4.5vw,56px);line-height:.8;color:var(--tx)}
.osw-step-done .osw-n{color:var(--go);text-shadow:0 0 34px rgba(22,217,146,.28)}
.osw-step-live .osw-n{color:var(--amber);text-shadow:0 0 34px rgba(246,178,75,.24)}
.osw-arrow{font-family:'Space Mono',monospace;font-size:20px;color:var(--faint)}

.osw-step-title{display:flex;align-items:center;gap:9px;font-family:'Space Mono',monospace;
  font-weight:700;font-size:15px;letter-spacing:.06em;color:var(--tx);margin-bottom:10px}
.osw-tick{font-size:14px}
.osw-pulse{width:9px;height:9px;border-radius:50%;background:var(--amber);
  animation:os-ping 1.6s ease-out infinite}

.osw-desc{font-size:15px;line-height:1.55;color:#C4CFDA;margin:0 0 18px}

.osw-chip{font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.08em;
  border:1px solid var(--hair);border-radius:999px;padding:7px 14px;display:inline-flex;
  color:var(--muted)}
.osw-step-done .osw-chip{color:var(--go);border-color:rgba(22,217,146,.32);background:rgba(22,217,146,.06)}
.osw-step-live .osw-chip{color:var(--amber);border-color:rgba(246,178,75,.32);background:rgba(246,178,75,.05)}

/* footer CTA row */
.osw-foot{display:flex;align-items:center;gap:22px;flex-wrap:wrap;margin-top:44px}
.osw-fine{font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.05em;color:var(--muted);margin:0}

@media (max-width:820px){
  .osw-board{grid-template-columns:1fr;gap:14px}
  .osw-track{display:none}
  .osw-arrow{display:none}
  .osw-head{margin-bottom:32px}
  .osw-foot{margin-top:32px}
}

@media (prefers-reduced-motion:reduce){
  .osw-step:hover{transform:none}
  .osw-track-fill{animation:none}
  .osw-track-dot-3,.osw-pulse{animation:none}
}
`;
