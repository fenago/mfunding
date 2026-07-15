// OSKit — the shared design system for the "Momentum OS" landing page.
//
// Direction: "the operator's side, at speed" — a dispatch board, not a fintech
// dashboard. Deep ink base, one owned go-green "approved" signal, amber reserved for
// the clock/urgency. Anton (billboard display) + Inter (body) + Space Mono (data).
//
// Every section imports from here so the page reads as ONE system. Tokens live as CSS
// variables on .os-root; components below compose them. Fonts load once via useOSFonts.
import { useEffect, type ReactNode } from "react";

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap";

/** Load the three faces once for the whole page. */
export function useOSFonts() {
  useEffect(() => {
    if (document.getElementById("os-fonts")) return;
    const link = document.createElement("link");
    link.id = "os-fonts";
    link.rel = "stylesheet";
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }, []);
}

// ── Primitives ──────────────────────────────────────────────────────────────

/** A full-bleed section with the standard vertical rhythm. `tone` swaps the surface. */
export function OSSection({
  children, tone = "ink", className = "", id,
}: { children: ReactNode; tone?: "ink" | "panel"; className?: string; id?: string }) {
  return (
    <section id={id} className={`os-section os-section-${tone} ${className}`}>
      <div className="os-container">{children}</div>
    </section>
  );
}

/** Mono eyebrow with the green signal dot. Structural — states what the section is. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="os-eyebrow"><span className="os-eyedot" />{children}</p>;
}

/** Anton display heading (uppercase billboard). Pass a green run via <span className="os-go">. */
export function Display({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`os-display ${className}`}>{children}</h2>;
}

export function Lede({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`os-lede ${className}`}>{children}</p>;
}

export function CTAPrimary({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} className="os-cta-primary">{children} <span aria-hidden>→</span></a>;
}
export function CTAGhost({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} className="os-cta-ghost">{children}</a>;
}

/** The panel card used across products, steps, proof — hairline border, ink gradient. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`os-card ${className}`}>{children}</div>;
}

// ── The stylesheet (rendered once by the page wrapper) ───────────────────────

export const OS_CSS = `
/* LIGHT is the default (the app adds .dark to <html> for dark mode). The whole page
   is themed by flipping these variables — every section reads them, so nothing else
   needs to change. Light = "blueprint on warm paper"; dark = "deep-ink dispatch board".
   --on-green stays dark in BOTH themes (the green buttons are green in both). */
.os-root{
  --ink:#F4F0E7; --ink2:#FBF8F1; --panel:#FFFFFF; --panel2:#F6F2E9;
  --hair:rgba(14,24,34,.14); --hair2:rgba(14,24,34,.07);
  --tx:#101B26; --muted:#586674; --faint:#5F6B76; --lede:#3B4A57;
  --go:#0BA968; --go-deep:#0A8F58; --go-text:#0A7A42; --amber:#B4740F; --amber-hi:#8A5A0C; --paper:#101B26;
  --on-green:#06231A; --shadow:rgba(16,24,34,.16);
  background:var(--ink); color:var(--tx);
  font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased;
  overflow-x:hidden;
}
.dark .os-root{
  --ink:#070B14; --ink2:#0E1524; --panel:#111A2C; --panel2:#0C1424;
  --hair:rgba(255,255,255,.09); --hair2:rgba(255,255,255,.055);
  --tx:#E9EEF2; --muted:#8695A6; --faint:#57687B; --lede:#C4CFDA;
  --go:#16D992; --go-deep:#0BA968; --go-text:#16D992; --amber:#F6B24B; --amber-hi:#FFD79A; --paper:#F3ECDD;
  --on-green:#06231A; --shadow:rgba(0,0,0,.7);
}
.os-root *{box-sizing:border-box}
.os-container{max-width:1200px; margin:0 auto; padding:0 24px}

/* sections + the shared dispatch grid texture */
.os-section{position:relative; padding:100px 0}
.os-section-ink{background:var(--ink)}
.os-section-panel{
  background:
    linear-gradient(var(--hair2) 1px,transparent 1px),
    linear-gradient(90deg,var(--hair2) 1px,transparent 1px),
    var(--ink2);
  background-size:64px 64px,64px 64px,auto;
  border-top:1px solid var(--hair); border-bottom:1px solid var(--hair);
}

/* type primitives */
.os-eyebrow{
  font-family:'Space Mono',monospace; font-size:13px; letter-spacing:.18em;
  color:var(--muted); text-transform:uppercase; display:inline-flex; align-items:center; gap:10px; margin:0 0 20px;
}
.os-eyedot{width:8px;height:8px;border-radius:9px;background:var(--go);box-shadow:0 0 0 4px rgba(22,217,146,.16)}
.os-display{
  font-family:'Anton',sans-serif; font-weight:400; text-transform:uppercase;
  letter-spacing:.006em; line-height:.92; font-size:clamp(34px,4.6vw,60px); margin:0 0 20px; color:var(--tx);
}
.os-go{color:var(--go-text); text-shadow:0 0 40px rgba(22,217,146,.25)}
.os-amber{color:var(--amber)}
.os-lede{font-size:18px; line-height:1.6; color:var(--lede); max-width:38em; margin:0}
.os-lede strong{color:var(--tx); font-weight:600}
.os-mono{font-family:'Space Mono',monospace}

/* CTAs */
.os-cta-primary{
  background:var(--go); color:var(--on-green); font-weight:700; font-size:15px;
  padding:15px 26px; border-radius:10px; text-decoration:none; display:inline-flex; align-items:center; gap:10px;
  box-shadow:0 10px 30px -8px rgba(22,217,146,.5); transition:transform .15s, box-shadow .15s;
}
.os-cta-primary:hover{transform:translateY(-2px); box-shadow:0 16px 40px -10px rgba(22,217,146,.6)}
.os-cta-ghost{
  border:1px solid var(--hair); color:var(--tx); font-weight:600; font-size:15px;
  padding:15px 24px; border-radius:10px; text-decoration:none; display:inline-flex; align-items:center;
  transition:border-color .15s, background .15s;
}
.os-cta-ghost:hover{border-color:var(--go-text); background:rgba(22,217,146,.06)}
.os-cta-primary:focus-visible,.os-cta-ghost:focus-visible,a:focus-visible,button:focus-visible{outline:2px solid var(--go); outline-offset:3px}

/* card */
.os-card{
  background:linear-gradient(180deg,var(--panel),var(--panel2));
  border:1px solid var(--hair); border-radius:14px; padding:26px;
  transition:border-color .18s, transform .18s;
}
.os-card:hover{border-color:rgba(22,217,146,.35); transform:translateY(-3px)}

/* small shared bits */
.os-chip{
  font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.06em; color:var(--muted);
  border:1px solid var(--hair); border-radius:999px; padding:7px 14px; display:inline-flex; align-items:center; gap:8px;
}
.os-check{color:var(--go-text)}

@keyframes os-blink{0%,100%{opacity:1} 50%{opacity:.25}}
@keyframes os-ping{0%{box-shadow:0 0 0 0 rgba(246,178,75,.55)} 70%{box-shadow:0 0 0 10px rgba(246,178,75,0)} 100%{box-shadow:0 0 0 0 rgba(246,178,75,0)}}
@keyframes os-in{from{opacity:0; transform:translateY(16px)} to{opacity:1; transform:none}}

@media (max-width:820px){
  .os-section{padding:72px 0}
  .os-display{font-size:clamp(30px,7vw,44px)}
}
@media (prefers-reduced-motion:reduce){
  .os-card:hover,.os-cta-primary:hover{transform:none}
  *{animation-duration:.001ms !important}
}
`;
