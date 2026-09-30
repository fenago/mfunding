// Small pieces shared by the Funder disclosure blocks. All of them assume a
// `.fcs` ancestor for styling — see ./styles.
import { useState } from "react";
import type { ReactNode } from "react";
import { LINK_CHIP, PHONE_RE, classifyLink, safeQuote, telHref } from "@/lib/funderDisclosure";
import { FX } from "./tw";

export function PhoneText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  PHONE_RE.lastIndex = 0;
  for (let m = PHONE_RE.exec(text); m !== null; m = PHONE_RE.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <a className={FX.cphone} href={telHref(m[0])} key={`${m.index}-${m[0]}`}>
        {m[0]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (parts.length === 0) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}


export function CopyMini({ value, what }: { value: string; what: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={FX.cmini}
      aria-label={`Copy ${what}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          window.setTimeout(() => setDone(false), 1800);
        } catch {
          // Clipboard blocked. Say nothing false — the address is on screen.
          setDone(false);
        }
      }}
    >
      {done ? "✓" : "copy"}
    </button>
  );
}

export function MailLine({ label, email }: { label: string; email: string }) {
  return (
    <div className={FX.cline}>
      <span className={FX.lbl}>{label}</span>
      <a className={FX.cmail} href={`mailto:${email}`}>
        {email}
      </a>
      <CopyMini value={email} what={`${label} address`} />
    </div>
  );
}





export function Quoted({ label, text }: { label: string; text: string | null | undefined }) {
  const q = safeQuote(text);
  if (q.withheld) {
    return (
      <div className={FX.credhold}>
        {label} — <b>not shown.</b> This note contains what looks like a credential, and this page is open to every
        setter. Ops has it.
      </div>
    );
  }
  if (!q.text) return null;
  return (
    <div className={FX.cnote}>
      <span className={FX.cnoteK}>{label}</span>
      {q.text}
    </div>
  );
}

export function LinkLine({ label, url }: { label: string; url: string }) {
  const k = classifyLink(url);
  const chip = LINK_CHIP[k];
  return (
    <div className={FX.lrow}>
      <span className={FX.lk}>{label}</span>
      <a className={FX.cmail} href={url} target="_blank" rel="noreferrer">
        {url}
      </a>
      <span className={chip.cls} title={chip.title}>
        {chip.label}
      </span>
    </div>
  );
}

// ── A recorded credit box, when one exists ───────────────────────────────────
// `lender_programs` rows are loaded from a funder's own signed packet. Most
// funders have none for these products; a funder WITHOUT a row keeps the
