// OSAuthShell — the shared minimal chrome for the auth screens on the "Momentum OS"
// design. A centered brand mark on the dispatch grid, no full nav/footer (auth pages
// want zero distraction). Presentation only — every auth page keeps its own logic.
//
// It also scope-overrides the global .input-field / .btn-primary utilities (used by
// the shared MerchantLoginLinkForm and the team form) so those controls pick up the
// OS look WITHOUT modifying the shared components. Overrides are keyed on
// `.os-root.os-auth` (3 classes) so they beat the global `.dark .input-field` rules
// in both themes.
import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { OS_CSS, useOSFonts } from "../OSKit";

export default function OSAuthShell({
  children,
  home = true,
  maxWidth = 420,
}: {
  children: ReactNode;
  home?: boolean;
  maxWidth?: number;
}) {
  useOSFonts();
  return (
    <div className="os-root os-auth">
      <style>{OS_CSS}</style>
      <style>{AUTH_CSS}</style>
      {home && (
        <Link to="/" className="os-auth-home os-mono">◄ HOME</Link>
      )}
      <main className="os-auth-main">
        <Link to="/" className="os-auth-brand">
          <span className="os-auth-mark">M</span>
          <span className="os-auth-word">Momentum</span>
        </Link>
        <div className="os-auth-inner" style={{ maxWidth }}>
          {children}
        </div>
      </main>
    </div>
  );
}

const AUTH_CSS = `
.os-auth{min-height:100vh;display:flex;flex-direction:column}
.os-auth-main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:64px 24px;
  background:
    linear-gradient(var(--hair2) 1px,transparent 1px),
    linear-gradient(90deg,var(--hair2) 1px,transparent 1px),
    var(--ink);
  background-size:64px 64px,64px 64px,auto}
.os-auth-home{position:absolute;top:22px;left:24px;font-size:12px;letter-spacing:.1em;
  color:var(--muted);text-decoration:none;z-index:2}
.os-auth-home:hover{color:var(--go-text)}
.os-auth-brand{display:flex;align-items:center;gap:11px;text-decoration:none;margin-bottom:28px}
.os-auth-mark{font-family:'Anton',sans-serif;font-size:22px;width:38px;height:38px;display:grid;place-items:center;
  color:var(--on-green);background:var(--go);border-radius:9px}
.os-auth-word{font-family:'Anton',sans-serif;font-size:24px;letter-spacing:.02em;color:var(--tx)}
.os-auth-inner{width:100%}

/* the OS auth card */
.os-authcard{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--hair);
  border-radius:16px;padding:32px}
.os-auth-title{font-family:'Anton',sans-serif;font-size:24px;letter-spacing:.01em;color:var(--tx);text-align:center;margin:0 0 8px}
.os-auth-sub{font-size:14px;line-height:1.5;color:var(--muted);text-align:center;margin:0 0 22px}
.os-auth-link{color:var(--go-text);text-decoration:none;font-weight:600}
.os-auth-link:hover{text-decoration:underline}
.os-auth-status{text-align:center;font-size:14px;color:var(--muted);margin:2px 0 0}

/* shared control overrides — MerchantLoginLinkForm + team form use .input-field/.btn-primary */
.os-root.os-auth .input-field{height:48px;width:100%;border:1px solid var(--hair);border-radius:10px;
  padding:0 14px;font-size:15px;font-family:'Inter',sans-serif;background:var(--ink2);color:var(--tx);
  transition:border-color .15s,box-shadow .15s;box-shadow:none}
.os-root.os-auth .input-field::placeholder{color:var(--faint)}
.os-root.os-auth .input-field:focus{outline:none;border-color:var(--go-text);box-shadow:0 0 0 3px rgba(22,217,146,.12)}
.os-root.os-auth .btn-primary{background:var(--go);color:var(--on-green);font-weight:700;font-size:15px;
  min-height:48px;border-radius:10px;box-shadow:0 10px 30px -8px rgba(22,217,146,.5);
  transition:transform .15s,box-shadow .15s}
.os-root.os-auth .btn-primary:hover{background:var(--go);transform:translateY(-2px);box-shadow:0 16px 40px -10px rgba(22,217,146,.6)}
`;
