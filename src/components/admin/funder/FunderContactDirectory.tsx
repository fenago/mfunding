// ─────────────────────────────────────────────────────────────────────────────
// Funder Contact — the "who do I call right now" tab.
//
// Every other tab on this page answers "who should get this deal". This one
// answers "how do I reach them", which is a different question with a different
// failure mode: a wrong answer here is a processor on hold with a dead number
// while a merchant waits, not a mismatched submission.
//
// Three rules the markup enforces, because they are the ones that have already
// gone wrong in this business:
//
//  1. ABSENT AND UNREADABLE ARE DIFFERENT. `funder_submission_profiles` is not
//     readable by a setter account, so an empty map there means UNKNOWN, never
//     "no address". Same for the web table. Every block below says which one it
//     is in words. (See the readers-must-distinguish-unreadable rule.)
//
//  2. WEB-SOURCED DATA IS NEVER PRESENTED AS OURS. `funder_web_contacts` rows
//     are scraped from the open web and are rendered in their own block, each
//     with the URL it was read on. They are never merged into the recorded
//     contact, never used to fill a gap silently, and the block says "not
//     verified by us" out loud. A plausible wrong number is worse than a gap.
//
//  3. THE RECORDED PHONE STRING IS PRINTED VERBATIM. These columns hold prose
//     — "929-531-9989 (MAIN SWITCHBOARD — ask for Lazer Preizler) · 646-491-1130
//     (cell)" — and the labels carry as much information as the digits. The call
//     BUTTONS are extracted on top of that text, never in place of it, so a bad
//     extraction can mislink but can never hide or rewrite what was recorded.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from "react";
import supabase from "@/supabase";
import {
  type ContactPerson,
  type ProfileState,
  PHONE_RE,
  clean,
  loadProfiles,
  telHref,
} from "@/lib/funderDisclosure";
import { CopyMini, Quoted } from "./parts";

// ── Shapes ───────────────────────────────────────────────────────────────────

type DirRow = {
  id: string;
  company_name: string;
  status: string;
  website: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  contacts: ContactPerson[] | null;
  submission_email: string | null;
  submission_portal_url: string | null;
  submission_notes: string | null;
  notes: string | null;
  category: {
    relationship?: string | null;
    relationships?: string[] | null;
    size_tier?: string | null;
    paper?: string[] | null;
    products?: string[] | null;
    known_for?: string | null;
  } | null;
  lender_types: string[] | null;
  funding_products: string[] | null;
};

type WebRow = {
  id: string;
  lender_id: string;
  kind: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  url: string | null;
  note: string | null;
  source_url: string;
  found_at: string;
  verified_at: string | null;
};

// Loaded / empty / failed — the only three states any read on this page ends
// in. "idle" exists so the first paint is not a lie about an empty result.
type Load<T> =
  | { s: "loading" }
  | { s: "ok"; v: T }
  | { s: "fail"; why: string };

// ── Categorisation ───────────────────────────────────────────────────────────
// `lenders.category` carries the relationship on `relationship` (older rows) or
// `relationships` (rows where a funder is worked in more than one mode — Giggle
// funds its own book but the broker channel is pure referral). Read both, every
// time; reading one silently mislabels the dual-mode funders.

const REL_LABEL: Record<string, string> = {
  direct_funder: "Direct funder",
  marketplace_aggregator: "Marketplace / aggregator",
  referral_affiliate: "Referral / affiliate",
  white_label: "White label",
  factoring_company: "Factoring",
  equipment_lessor: "Equipment lessor",
  software_vendor: "Software vendor",
};
// What each relationship MEANS for the person picking up the phone. A
// marketplace does not underwrite your deal — it re-brokers it — and a
// processor who does not know that will ask the wrong questions.
const REL_HINT: Record<string, string> = {
  direct_funder: "Underwrites and funds off its own book — the money is theirs.",
  marketplace_aggregator:
    "Does NOT fund — routes the file to its own lender panel. Expect your deal to be re-shopped.",
  referral_affiliate: "We refer the merchant out and are paid a referral fee; we do not package the file.",
  white_label: "Funds under our brand — the merchant sees Momentum, not them.",
  factoring_company: "Buys invoices/receivables, not future card sales. Different product, different stips.",
  equipment_lessor: "Finances equipment against the asset.",
  software_vendor: "A platform we use, not a funder. No deal goes here.",
};
const REL_UNSET = "__unset__";

const relsOf = (l: DirRow): string[] => {
  const c = l.category ?? {};
  const many = Array.isArray(c.relationships) ? c.relationships : [];
  const one = clean(c.relationship ?? null);
  const all = [...many, ...(one ? [one] : [])]
    .map((r) => String(r).trim())
    .filter((r) => r !== "");
  const dedup = Array.from(new Set(all));
  // An empty set is NOT "direct funder" — it is a funder nobody has classified.
  // Defaulting it to the most common value would quietly invent a fact.
  return dedup.length > 0 ? dedup : [REL_UNSET];
};

const STATUS_LABEL: Record<string, string> = {
  live_vendor: "Live — submit today",
  application_submitted: "ISO app submitted",
};

// Every product spelling this page can filter on, drawn from BOTH columns that
// carry products, because they are maintained by different processes and
// neither is complete on its own.
const PRODUCT_LABEL: Record<string, string> = {
  mca: "MCA",
  term_loan: "Term loan",
  line_of_credit: "Line of credit",
  sba_loan: "SBA",
  equipment_financing: "Equipment",
  invoice_factoring: "Factoring",
  real_estate: "Real estate",
};
const productsOf = (l: DirRow): string[] => {
  const raw = [
    ...(Array.isArray(l.category?.products) ? (l.category?.products as string[]) : []),
    ...(Array.isArray(l.lender_types) ? l.lender_types : []),
    ...(Array.isArray(l.funding_products) ? l.funding_products : []),
  ];
  return Array.from(new Set(raw.map((p) => String(p).trim().toLowerCase()).filter((p) => p !== "")));
};

// ── Phone extraction ─────────────────────────────────────────────────────────
// Pull the dialable digits OUT of the recorded prose so there can be a button,
// while the prose itself is still printed in full next to it.
const extractPhones = (text: string | null | undefined): string[] => {
  const t = clean(text);
  if (!t) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  PHONE_RE.lastIndex = 0;
  for (let m = PHONE_RE.exec(t); m !== null; m = PHONE_RE.exec(t)) {
    const digits = m[0].replace(/\D/g, "");
    // A "phone number" of 7 digits or a stray year is noise, not a line.
    if (digits.length < 10) continue;
    if (seen.has(digits)) continue;
    seen.add(digits);
    out.push(m[0].trim());
  }
  return out;
};

// A recorded phone string that TELLS us the line is dead. Highland Hill's reads
// "954-280-0359 (UNREACHABLE as of 2026-10-01 — not connecting)". Rendering a
// cheerful green Call button on that is the page lying to the person dialling.
const DEAD_LINE_RE = /unreachable|not connecting|disconnect|no longer (?:at|with|works)|wrong number|out of service/i;
const lineWarning = (text: string | null | undefined): string | null => {
  const t = clean(text);
  if (!t) return null;
  const m = t.match(DEAD_LINE_RE);
  return m ? t : null;
};

// ── The searchable text for one funder ───────────────────────────────────────
// Everything a person might type: the company, every human on file, every
// address, the domain, and the web-sourced rows too. Built once per funder.
const haystack = (l: DirRow, web: WebRow[]): string => {
  const people = Array.isArray(l.contacts) ? l.contacts : [];
  const bits = [
    l.company_name,
    l.website,
    l.primary_contact_name,
    l.primary_contact_email,
    l.primary_contact_phone,
    l.submission_email,
    l.submission_portal_url,
    l.category?.known_for ?? null,
    ...relsOf(l).map((r) => REL_LABEL[r] ?? r),
    ...productsOf(l).map((p) => PRODUCT_LABEL[p] ?? p),
    ...people.flatMap((p) => [p?.name, p?.email, p?.phone, p?.title]),
    ...web.flatMap((w) => [w.name, w.title, w.email, w.phone, w.url, w.note]),
  ];
  // Digits are appended separately so "9545551212" finds "(954) 555-1212".
  const text = bits.filter((b): b is string => typeof b === "string" && b.trim() !== "").join(" ");
  return `${text} ${text.replace(/\D/g, " ")}`.toLowerCase();
};

// ── Styling tokens (self-contained — see tw.ts for why) ──────────────────────
const INK = "text-[#0f2942] dark:text-[#e8eef5]";
const INK_SOFT = "text-[#40546b] dark:text-[#a9b8c8]";
const INK_FAINT = "text-[#6b7d92] dark:text-[#7d8ea0]";
const LINE = "border-[#dfe6ee] dark:border-[#23303f]";
const CHIP = "text-[10.5px] font-bold rounded-[5px] px-[7px] py-[2px] whitespace-nowrap";
const CHIP_NEUTRAL = `${CHIP} bg-[#eef2f7] dark:bg-[#1b2836] text-[#42566c] dark:text-[#a9b8c8]`;
const CHIP_LIVE = `${CHIP} bg-[#e6f4ec] dark:bg-[#123024] text-[#1f8a5b] dark:text-[#54c68d]`;
const CHIP_WARN = `${CHIP} bg-[#faf1dd] dark:bg-[#2c2413] text-[#b7791f] dark:text-[#dcab55]`;
const KEY = `text-[9.5px] font-extrabold tracking-[0.09em] uppercase ${INK_FAINT} mb-[4px]`;
const NONE = `text-[12px] ${INK_FAINT} italic`;

// The call button. Green, big enough for a thumb, and it is an <a href="tel:">
// so it works from a phone and from a softphone on the desktop.
const CALL =
  "inline-flex items-center gap-[5px] text-[12px] font-extrabold tracking-[0.02em] rounded-[7px] px-[10px] py-[5px] no-underline " +
  "bg-[#1f8a5b] text-white hover:bg-[#176f49] " +
  "dark:bg-[#54c68d] dark:text-[#08131c] dark:hover:bg-[#3fb77c] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c08a2d]";
const CALL_WARN =
  "inline-flex items-center gap-[5px] text-[12px] font-extrabold tracking-[0.02em] rounded-[7px] px-[10px] py-[5px] no-underline " +
  "bg-[#faf1dd] dark:bg-[#2c2413] text-[#b7791f] dark:text-[#dcab55] border border-[#b7791f] dark:border-[#dcab55] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c08a2d]";
const MAILBTN =
  "inline-flex items-center gap-[5px] text-[12px] font-bold rounded-[7px] px-[10px] py-[5px] no-underline " +
  "bg-[#e7f0f9] dark:bg-[#122238] text-[#2f6fb0] dark:text-[#6aa6e0] hover:bg-[#d7e6f5] dark:hover:bg-[#182f4a] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c08a2d]";

// A call button plus the verbatim label it was extracted from.
function CallButton({ number, warn }: { number: string; warn: boolean }) {
  return (
    <a
      className={warn ? CALL_WARN : CALL}
      href={telHref(number)}
      title={warn ? `${number} — flagged on the funder record as not connecting` : `Call ${number}`}
    >
      <span aria-hidden="true">{warn ? "⚠" : "📞"}</span>
      {number}
    </a>
  );
}

function MailButton({ email }: { email: string }) {
  return (
    <a className={MAILBTN} href={`mailto:${email}`} title={`Email ${email}`}>
      <span aria-hidden="true">✉</span>
      {email}
    </a>
  );
}

// One person. Name, title, and whatever of email/phone was recorded — each
// absent field named out loud rather than left as whitespace.
function PersonRow({ p }: { p: ContactPerson & { note?: string | null; role?: string | null } }) {
  const name = clean(p.name);
  const title = clean(p.title) ?? clean(p.role);
  const email = clean(p.email);
  const phones = extractPhones(p.phone);
  const warn = lineWarning(p.phone);
  return (
    <div className={`border-l-2 ${LINE} pl-[10px] py-[2px] flex flex-col gap-[5px]`}>
      <div className="flex flex-wrap items-baseline gap-[8px]">
        <span className={`text-[13px] font-bold ${INK}`}>{name ?? "Name not recorded"}</span>
        {title && <span className={`text-[11.5px] ${INK_FAINT}`}>{title}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-[6px]">
        {email ? (
          <>
            <MailButton email={email} />
            <CopyMini value={email} what="email address" />
          </>
        ) : (
          <span className={NONE}>No email recorded.</span>
        )}
        {phones.length > 0 ? (
          phones.map((n) => (
            <span className="inline-flex items-center gap-[4px]" key={n}>
              <CallButton number={n} warn={!!warn} />
              <CopyMini value={n} what="phone number" />
            </span>
          ))
        ) : (
          <span className={NONE}>No phone recorded.</span>
        )}
      </div>
      {/* The recorded string in full, whenever it carried more than digits —
          the labels ("ask for Lazer", "cell", "UNREACHABLE") are the point. */}
      {clean(p.phone) && clean(p.phone) !== phones.join(" ") && (
        <div className={`text-[11.5px] ${INK_SOFT} leading-[1.45]`}>As recorded: {clean(p.phone)}</div>
      )}
      {clean(p.note) && <div className={`text-[11.5px] ${INK_SOFT} leading-[1.45]`}>{clean(p.note)}</div>}
    </div>
  );
}

// ── One funder, collapsed or open ────────────────────────────────────────────

function FunderCard({
  l,
  web,
  webReadable,
  profiles,
  open,
  onToggle,
}: {
  l: DirRow;
  web: WebRow[];
  webReadable: boolean;
  profiles: ProfileState;
  open: boolean;
  onToggle: () => void;
}) {
  const site = clean(l.website);
  const primaryName = clean(l.primary_contact_name);
  const primaryEmail = clean(l.primary_contact_email);
  const primaryPhones = extractPhones(l.primary_contact_phone);
  const primaryWarn = lineWarning(l.primary_contact_phone);

  const people = (Array.isArray(l.contacts) ? l.contacts : []).filter(
    (p) => clean(p?.name) || clean(p?.email) || clean(p?.phone),
  );
  // The primary rep is normally repeated inside `contacts` — don't print twice.
  const others = people.filter(
    (p) => !primaryEmail || clean(p.email)?.toLowerCase() !== primaryEmail.toLowerCase(),
  );

  const profile = profiles.map[l.id];
  const subTo = clean(profile?.to_email);
  const subCc = (profile?.cc_emails ?? []).map(clean).filter((x): x is string => !!x);
  const subPortal = clean(profile?.portal_url) ?? clean(l.submission_portal_url);
  const catalogSub = clean(l.submission_email);

  // Every dialable line anywhere on the record, for the collapsed header.
  const headerPhones = Array.from(
    new Set([...primaryPhones, ...people.flatMap((p) => extractPhones(p.phone))]),
  ).slice(0, 3);
  const headerEmail = primaryEmail ?? clean(people.find((p) => clean(p.email))?.email ?? null);

  const rels = relsOf(l);
  const live = l.status === "live_vendor";

  return (
    <div className={`border ${LINE} rounded-[12px] bg-white dark:bg-[#0e1a26] overflow-hidden`}>
      {/* ── Header: always visible, always dialable ───────────────────────── */}
      <div className="flex flex-wrap items-center gap-[10px] px-[14px] py-[11px]">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`fc-panel-${l.id}`}
          className={`font-[inherit] bg-transparent border-0 p-0 cursor-pointer text-left flex items-center gap-[8px] ${INK} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c08a2d] rounded-[4px]`}
        >
          <span className={`text-[12px] ${INK_FAINT} w-[12px] inline-block`} aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          <span className="text-[14.5px] font-extrabold">{l.company_name}</span>
        </button>

        <span className={live ? CHIP_LIVE : CHIP_NEUTRAL}>{STATUS_LABEL[l.status] ?? l.status}</span>
        {rels.map((r) => (
          <span
            key={r}
            className={r === REL_UNSET ? CHIP_WARN : CHIP_NEUTRAL}
            title={r === REL_UNSET ? "Nobody has classified this funder yet." : REL_HINT[r] ?? ""}
          >
            {r === REL_UNSET ? "Not categorised" : REL_LABEL[r] ?? r}
          </span>
        ))}

        {/* Call / email without opening the card. This is the whole point of
            the tab: the processor should not have to expand anything to dial. */}
        <span className="flex flex-wrap items-center gap-[6px] ml-auto">
          {headerPhones.length === 0 && <span className={NONE}>No phone on file</span>}
          {headerPhones.map((n) => (
            <CallButton key={n} number={n} warn={!!primaryWarn && primaryPhones.includes(n)} />
          ))}
          {headerEmail && <MailButton email={headerEmail} />}
        </span>
      </div>

      {open && (
        <div id={`fc-panel-${l.id}`} className={`border-t ${LINE} px-[14px] py-[13px] flex flex-col gap-[14px]`}>
          {primaryWarn && (
            <div className="text-[12px] font-bold text-[#b7791f] dark:text-[#dcab55] bg-[#faf1dd] dark:bg-[#2c2413] rounded-[7px] px-[10px] py-[7px] leading-[1.45]">
              The funder record flags a problem with this line — quoted in full: “{primaryWarn}”
            </div>
          )}

          {/* What kind of counterparty this is */}
          <div>
            <div className={KEY}>What they are</div>
            {rels.map((r) => (
              <div key={r} className={`text-[12.5px] ${INK_SOFT} leading-[1.5]`}>
                <b className={INK}>{r === REL_UNSET ? "Not categorised" : REL_LABEL[r] ?? r}</b>
                {r === REL_UNSET
                  ? " — nobody has recorded what kind of counterparty this is. Ask Ops before you promise a merchant anything about how the deal is handled."
                  : REL_HINT[r]
                    ? ` — ${REL_HINT[r]}`
                    : ""}
              </div>
            ))}
            {clean(l.category?.known_for) && (
              <div className={`text-[12.5px] ${INK_SOFT} leading-[1.5] mt-[4px]`}>
                Known for: {clean(l.category?.known_for)}
              </div>
            )}
            {productsOf(l).length > 0 && (
              <div className="flex flex-wrap gap-[4px] mt-[6px]">
                {productsOf(l).map((p) => (
                  <span key={p} className={CHIP_NEUTRAL}>
                    {PRODUCT_LABEL[p] ?? p.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* The rep */}
          <div>
            <div className={KEY}>Who to chase — the rep on the record</div>
            {primaryName || primaryEmail || primaryPhones.length > 0 ? (
              <PersonRow
                p={{
                  name: l.primary_contact_name,
                  email: l.primary_contact_email,
                  phone: l.primary_contact_phone,
                  title: null,
                }}
              />
            ) : (
              <div className={NONE}>
                No named rep recorded for this funder. Whatever is below came from the web or from a general line.
              </div>
            )}
          </div>

          {/* Everyone else */}
          <div>
            <div className={KEY}>Other people on file ({others.length})</div>
            {others.length === 0 ? (
              <div className={NONE}>No other contacts recorded.</div>
            ) : (
              <div className="flex flex-col gap-[9px]">
                {others.map((p, i) => (
                  <PersonRow key={`${clean(p.email) ?? clean(p.phone) ?? i}`} p={p} />
                ))}
              </div>
            )}
          </div>

          {/* Where a deal goes */}
          <div>
            <div className={KEY}>Where the deal goes</div>
            {!profiles.readable ? (
              <>
                <div className="text-[12px] font-bold text-[#b7791f] dark:text-[#dcab55]">
                  Submission recipe UNKNOWN — the profile table came back empty or unreadable for your account. That
                  is not “no address”: ask Ops before sending anything.
                </div>
                {catalogSub && (
                  <div className="flex flex-wrap items-center gap-[6px] mt-[5px]">
                    <span className={`text-[11.5px] ${INK_FAINT}`}>On the funder record</span>
                    <MailButton email={catalogSub} />
                    <CopyMini value={catalogSub} what="submission address" />
                  </div>
                )}
              </>
            ) : subTo || catalogSub || subPortal ? (
              <div className="flex flex-col gap-[5px]">
                {subTo && (
                  <div className="flex flex-wrap items-center gap-[6px]">
                    <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>Deals to</span>
                    <MailButton email={subTo} />
                    <CopyMini value={subTo} what="submission address" />
                  </div>
                )}
                {subCc.map((cc) => (
                  <div className="flex flex-wrap items-center gap-[6px]" key={cc}>
                    <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>CC</span>
                    <MailButton email={cc} />
                    <CopyMini value={cc} what="CC address" />
                  </div>
                ))}
                {!subTo && catalogSub && (
                  <>
                    <div className="flex flex-wrap items-center gap-[6px]">
                      <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>Catalog</span>
                      <MailButton email={catalogSub} />
                      <CopyMini value={catalogSub} what="submission address" />
                    </div>
                    <div className={NONE}>
                      From the funder record, not from a send recipe — no submission profile is set up here.
                    </div>
                  </>
                )}
                {subPortal && (
                  <div className="flex flex-wrap items-baseline gap-[6px]">
                    <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>Portal</span>
                    <a
                      className="text-[12.5px] text-[#2f6fb0] dark:text-[#6aa6e0] break-all"
                      href={subPortal}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {subPortal}
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div className={NONE}>No submission address or portal recorded for this funder.</div>
            )}
          </div>

          {/* Web-sourced — ALWAYS its own block, never merged above */}
          <div>
            <div className={KEY}>Found on the web — not verified by us</div>
            {!webReadable ? (
              <div className="text-[12px] font-bold text-[#b7791f] dark:text-[#dcab55]">
                The web-research table could not be read by your account. UNKNOWN, not empty.
              </div>
            ) : web.length === 0 ? (
              <div className={NONE}>Nothing recorded from a web pass for this funder.</div>
            ) : (
              <div className="flex flex-col gap-[8px]">
                <div className={`text-[11.5px] ${INK_SOFT} leading-[1.45]`}>
                  Read off a public page by a research pass. Nobody here has dialled or emailed these to confirm
                  them, and they are deliberately NOT merged into the funder record above. Check the source link
                  before you use one.
                </div>
                {web.map((w) => {
                  const phones = extractPhones(w.phone);
                  return (
                    <div key={w.id} className={`border-l-2 ${LINE} pl-[10px] flex flex-col gap-[4px]`}>
                      <div className="flex flex-wrap items-baseline gap-[8px]">
                        {clean(w.name) && <span className={`text-[12.5px] font-bold ${INK}`}>{clean(w.name)}</span>}
                        {clean(w.title) && <span className={`text-[11.5px] ${INK_FAINT}`}>{clean(w.title)}</span>}
                        <span className={CHIP_NEUTRAL}>{w.kind}</span>
                        {w.verified_at && <span className={CHIP_LIVE}>confirmed by us</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-[6px]">
                        {clean(w.email) && <MailButton email={clean(w.email) as string} />}
                        {phones.map((n) => (
                          <CallButton key={n} number={n} warn={false} />
                        ))}
                        {clean(w.url) && (
                          <a
                            className="text-[12px] text-[#2f6fb0] dark:text-[#6aa6e0] break-all"
                            href={clean(w.url) as string}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {clean(w.url)}
                          </a>
                        )}
                      </div>
                      {clean(w.note) && (
                        <div className={`text-[11.5px] ${INK_SOFT} leading-[1.45]`}>{clean(w.note)}</div>
                      )}
                      <a
                        className={`text-[10.5px] ${INK_FAINT} underline break-all`}
                        href={w.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        source: {w.source_url}
                      </a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Website + free-text notes, quoted not parsed */}
          <div className="flex flex-col gap-[6px]">
            <div className="flex flex-wrap items-baseline gap-[6px]">
              <span className={`text-[11.5px] ${INK_FAINT} min-w-[62px]`}>Website</span>
              {site ? (
                <a
                  className="text-[12.5px] text-[#2f6fb0] dark:text-[#6aa6e0] break-all"
                  href={site}
                  target="_blank"
                  rel="noreferrer"
                >
                  {site}
                </a>
              ) : (
                <span className={NONE}>Not recorded.</span>
              )}
            </div>
            <Quoted label="Submission notes — quoted, not parsed into fields" text={l.submission_notes} />
            <Quoted label="Funder record notes — quoted, not parsed into fields" text={l.notes} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "live_vendor" | "application_submitted";
type GapFilter = "all" | "no_phone" | "no_email" | "no_person";

export function FunderContactDirectory() {
  const [rows, setRows] = useState<Load<DirRow[]>>({ s: "loading" });
  const [web, setWeb] = useState<Load<WebRow[]>>({ s: "loading" });
  const [profiles, setProfiles] = useState<ProfileState>({
    map: {},
    readable: true,
    error: null,
    severity: "limited",
  });

  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState<StatusFilter>("all");
  const [relF, setRelF] = useState<string>("all");
  const [prodF, setProdF] = useState<string>("all");
  const [gapF, setGapF] = useState<GapFilter>("all");
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("lenders")
          .select(
            "id, company_name, status, website, primary_contact_name, primary_contact_email, primary_contact_phone, contacts, submission_email, submission_portal_url, submission_notes, notes, category, lender_types, funding_products",
          )
          .in("status", ["live_vendor", "application_submitted"])
          .order("company_name");
        if (cancelled) return;
        if (error) {
          setRows({
            s: "fail",
            why: `Could not read the funder catalog — ${error.message}. This is a READ FAILURE, not an empty network.`,
          });
          return;
        }
        const list = (data ?? []) as DirRow[];
        setRows({ s: "ok", v: list });

        const ids = list.map((r) => r.id);
        // Submission recipes. loadProfiles already collapses "unreadable" and
        // "empty" correctly, so just merge whatever it decided.
        const p = await loadProfiles(ids);
        if (!cancelled) setProfiles(p);

        if (ids.length === 0) {
          if (!cancelled) setWeb({ s: "ok", v: [] });
          return;
        }
        const { data: wdata, error: werr } = await supabase
          .from("funder_web_contacts")
          .select("id, lender_id, kind, name, title, email, phone, url, note, source_url, found_at, verified_at")
          .in("lender_id", ids)
          .order("found_at", { ascending: false });
        if (cancelled) return;
        if (werr) {
          setWeb({ s: "fail", why: `Web-sourced contacts could not be read — ${werr.message}.` });
          return;
        }
        setWeb({ s: "ok", v: (wdata ?? []) as WebRow[] });
      } catch (e) {
        if (cancelled) return;
        const why = e instanceof Error ? e.message : String(e);
        setRows((prev) =>
          prev.s === "ok" ? prev : { s: "fail", why: `Could not read the funder catalog — ${why}.` },
        );
        setWeb((prev) => (prev.s === "ok" ? prev : { s: "fail", why: `Web-sourced contacts could not be read — ${why}.` }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Memoised because a fresh `[]` on every render would re-run every useMemo
  // below it — the filter work is cheap but the churn is pointless.
  const list = useMemo(() => (rows.s === "ok" ? rows.v : []), [rows]);
  const webByLender = useMemo(() => {
    const m: Record<string, WebRow[]> = {};
    if (web.s !== "ok") return m;
    for (const w of web.v) (m[w.lender_id] ??= []).push(w);
    return m;
  }, [web]);

  // Filter options come from the DATA, not a hand-kept list, so a new
  // relationship or product spelling appears here the day it lands in the DB
  // instead of being silently unfilterable.
  const relOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of list) for (const r of relsOf(l)) counts.set(r, (counts.get(r) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [list]);

  const prodOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of list) for (const p of productsOf(l)) counts.set(p, (counts.get(p) ?? 0) + 1);
    return Array.from(counts.entries())
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
  }, [list]);

  const decorated = useMemo(
    () =>
      list.map((l) => {
        const w = webByLender[l.id] ?? [];
        const people = Array.isArray(l.contacts) ? l.contacts : [];
        const anyPhone =
          extractPhones(l.primary_contact_phone).length > 0 ||
          people.some((p) => extractPhones(p.phone).length > 0);
        const anyEmail = !!clean(l.primary_contact_email) || people.some((p) => clean(p.email));
        const anyPerson = !!clean(l.primary_contact_name) || people.some((p) => clean(p.name));
        return { l, w, hay: haystack(l, w), anyPhone, anyEmail, anyPerson };
      }),
    [list, webByLender],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return decorated.filter((d) => {
      if (statusF !== "all" && d.l.status !== statusF) return false;
      if (relF !== "all" && !relsOf(d.l).includes(relF)) return false;
      if (prodF !== "all" && !productsOf(d.l).includes(prodF)) return false;
      if (gapF === "no_phone" && d.anyPhone) return false;
      if (gapF === "no_email" && d.anyEmail) return false;
      if (gapF === "no_person" && d.anyPerson) return false;
      if (needle !== "" && !d.hay.includes(needle)) return false;
      return true;
    });
  }, [decorated, q, statusF, relF, prodF, gapF]);

  const allOpen = shown.length > 0 && shown.every((d) => open.has(d.l.id));

  const SELECT =
    `font-[inherit] text-[12.5px] ${INK} bg-white dark:bg-[#0e1a26] border ${LINE} rounded-[8px] px-[9px] py-[6px] ` +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#c08a2d]";

  return (
    <section aria-labelledby="fc-h" className="mt-[18px] flex flex-col gap-[14px]">
      <div>
        <h2 id="fc-h" className={`text-[19px] font-extrabold m-0 ${INK}`}>
          Funder Contact
        </h2>
        <p className={`text-[13px] ${INK_SOFT} leading-[1.55] mt-[6px] mb-0 max-w-[88ch]`}>
          Every funder we are live with or have an ISO application in with, and every way to reach them. Tap a number
          to call it. Each card shows what we have <b>recorded</b>, kept separate from what a research pass{" "}
          <b>found on the web</b> — the second kind is unverified and prints the page it came from, because a
          plausible wrong number costs more than a gap.
        </p>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className={`border ${LINE} rounded-[12px] bg-[#f7f9fc] dark:bg-[#111d2a] px-[13px] py-[11px] flex flex-wrap items-center gap-[9px]`}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, person, email, phone, domain…"
          aria-label="Search funders and contacts"
          className={`font-[inherit] text-[13px] ${INK} bg-white dark:bg-[#0e1a26] border ${LINE} rounded-[8px] px-[11px] py-[7px] min-w-[270px] flex-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#c08a2d]`}
        />

        <select
          className={SELECT}
          value={statusF}
          onChange={(e) => setStatusF(e.target.value as StatusFilter)}
          aria-label="Filter by our relationship status"
        >
          <option value="all">Status — all</option>
          <option value="live_vendor">Live — submit today</option>
          <option value="application_submitted">ISO app submitted</option>
        </select>

        <select
          className={SELECT}
          value={relF}
          onChange={(e) => setRelF(e.target.value)}
          aria-label="Filter by funder type"
        >
          <option value="all">Type — all</option>
          {relOptions.map(([r, n]) => (
            <option key={r} value={r}>
              {(r === REL_UNSET ? "Not categorised" : REL_LABEL[r] ?? r) + ` (${n})`}
            </option>
          ))}
        </select>

        <select
          className={SELECT}
          value={prodF}
          onChange={(e) => setProdF(e.target.value)}
          aria-label="Filter by product"
        >
          <option value="all">Product — all</option>
          {prodOptions.map(([p, n]) => (
            <option key={p} value={p}>
              {(PRODUCT_LABEL[p] ?? p.replace(/_/g, " ")) + ` (${n})`}
            </option>
          ))}
        </select>

        <select
          className={SELECT}
          value={gapF}
          onChange={(e) => setGapF(e.target.value as GapFilter)}
          aria-label="Filter by what is missing"
        >
          <option value="all">Gaps — show all</option>
          <option value="no_phone">Missing: no phone anywhere</option>
          <option value="no_email">Missing: no email anywhere</option>
          <option value="no_person">Missing: no named human</option>
        </select>

        <button
          type="button"
          className={`font-[inherit] text-[12px] font-bold ${INK_SOFT} bg-transparent border ${LINE} rounded-[8px] px-[10px] py-[6px] cursor-pointer hover:bg-[#eef2f7] dark:hover:bg-[#1b2836]`}
          onClick={() => setOpen(allOpen ? new Set() : new Set(shown.map((d) => d.l.id)))}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>

        {(q !== "" || statusF !== "all" || relF !== "all" || prodF !== "all" || gapF !== "all") && (
          <button
            type="button"
            className={`font-[inherit] text-[12px] font-bold ${INK_SOFT} bg-transparent border-0 underline cursor-pointer`}
            onClick={() => {
              setQ("");
              setStatusF("all");
              setRelF("all");
              setProdF("all");
              setGapF("all");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Read failures, said out loud ─────────────────────────────────── */}
      {rows.s === "fail" && (
        <div className="text-[13px] font-bold text-[#c0433d] dark:text-[#e57b74] bg-[#c0433d]/10 rounded-[8px] px-[12px] py-[9px]">
          {rows.why}
        </div>
      )}
      {profiles.error && (
        <div
          className={
            profiles.severity === "error"
              ? "text-[13px] font-bold text-[#c0433d] dark:text-[#e57b74] bg-[#c0433d]/10 rounded-[8px] px-[12px] py-[9px]"
              : "text-[12.5px] font-semibold text-[#b7791f] dark:text-[#dcab55] bg-[#faf1dd] dark:bg-[#2c2413] rounded-[8px] px-[12px] py-[9px]"
          }
        >
          {profiles.error}
        </div>
      )}
      {web.s === "fail" && (
        <div className="text-[12.5px] font-semibold text-[#b7791f] dark:text-[#dcab55] bg-[#faf1dd] dark:bg-[#2c2413] rounded-[8px] px-[12px] py-[9px]">
          {web.why}
        </div>
      )}
      {web.s === "ok" && web.v.length === 0 && rows.s === "ok" && list.length > 0 && (
        <div className={`text-[12.5px] ${INK_SOFT} bg-[#eef2f7] dark:bg-[#1b2836] rounded-[8px] px-[12px] py-[9px] leading-[1.5]`}>
          No web-sourced contacts have been recorded yet — the research pass has either not run or found nothing.
          Everything below is what WE hold.
        </div>
      )}

      {/* ── Count line ───────────────────────────────────────────────────── */}
      {rows.s === "ok" && (
        <div className={`text-[12px] ${INK_FAINT}`}>
          {shown.length === list.length
            ? `${list.length} funders — ${list.filter((l) => l.status === "live_vendor").length} live, ${
                list.filter((l) => l.status === "application_submitted").length
              } with an ISO app in.`
            : `${shown.length} of ${list.length} funders match.`}
        </div>
      )}

      {/* ── The accordion ────────────────────────────────────────────────── */}
      {rows.s === "loading" && <div className={`text-[13px] ${INK_FAINT}`}>Reading the funder catalog…</div>}
      {rows.s === "ok" && list.length === 0 && (
        <div className={`text-[13px] ${INK_FAINT}`}>
          The funder catalog came back with no live or applied-to funders. That read succeeded — the list really is
          empty — which would itself be worth telling Ops about.
        </div>
      )}
      {rows.s === "ok" && list.length > 0 && shown.length === 0 && (
        <div className={`text-[13px] ${INK_FAINT}`}>No funder matches those filters.</div>
      )}

      <div className="flex flex-col gap-[9px]">
        {shown.map((d) => (
          <FunderCard
            key={d.l.id}
            l={d.l}
            web={d.w}
            webReadable={web.s !== "fail"}
            profiles={profiles}
            open={open.has(d.l.id)}
            onToggle={() =>
              setOpen((prev) => {
                const next = new Set(prev);
                if (next.has(d.l.id)) next.delete(d.l.id);
                else next.add(d.l.id);
                return next;
              })
            }
          />
        ))}
      </div>
    </section>
  );
}
