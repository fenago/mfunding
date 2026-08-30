import { useState } from "react";
import { EnvelopeIcon, PhoneIcon, PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import type { DealWithCustomer } from "@/types/deals";
import {
  updateCustomerAdditionalEmails,
  updateCustomerAdditionalPhones,
} from "@/services/dealService";
import { normalizePhoneForStorage } from "@/lib/phone";

// The MFunding VibeReach location — deep-links an additional cell to the contact,
// whose call button dials, records, and auto-logs (same as the header number).
const GHL_LOCATION = "t7NmVR4WCy927j4Zon4b";

const emailShape = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ── Additional-emails editor ──
// Extra addresses that ride along as CC on every merchant email (the primary
// stays customers.email, always the To:). Inline chip UI — no popups.
function AdditionalEmailsEditor({
  customerId,
  primaryEmail,
  emails,
  onRefresh,
}: {
  customerId: string;
  primaryEmail: string | null;
  emails: string[];
  onRefresh: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = async (next: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await updateCustomerAdditionalEmails(customerId, next);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const e = value.trim().toLowerCase();
    if (!emailShape(e)) { setError("Enter a valid email."); return; }
    if (e === (primaryEmail ?? "").trim().toLowerCase()) { setError("That's already the primary email."); return; }
    if (emails.some((x) => x.toLowerCase() === e)) { setError("Already added."); return; }
    setValue("");
    setAdding(false);
    await persist([...emails, e]);
  };

  const remove = (e: string) => persist(emails.filter((x) => x !== e));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {emails.map((e) => (
        <span
          key={e}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-ocean-blue/10 text-ocean-blue dark:text-blue-300 border border-ocean-blue/30"
          title={`Also CC'd on merchant email: ${e}`}
        >
          <EnvelopeIcon className="w-3 h-3" />
          {e}
          <button
            type="button"
            onClick={() => remove(e)}
            disabled={busy}
            title="Remove this address"
            className="ml-0.5 hover:text-red-600 disabled:opacity-50"
          >
            <XMarkIcon className="w-3 h-3" />
          </button>
        </span>
      ))}

      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            type="email"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } if (e.key === "Escape") { setAdding(false); setValue(""); setError(null); } }}
            placeholder="bookkeeper@acme.com"
            className="text-[11px] rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-0.5 w-44"
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy}
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-ocean-blue text-white hover:bg-deep-sea disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setValue(""); setError(null); }}
            className="text-[11px] text-gray-400 hover:text-gray-600"
          >
            cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          title="Add another address that gets CC'd on merchant email"
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-dashed border-ocean-blue/50 text-ocean-blue dark:text-blue-300 hover:bg-ocean-blue/10"
        >
          <PlusIcon className="w-3 h-3" /> email
        </button>
      )}

      {error && <span className="text-[11px] text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

// ── Additional-phones editor ──
// Extra cell numbers a merchant can be reached on. The primary stays
// customers.phone (the canonical dial + identity key); these ride alongside as
// dialable chips. Stored canonical (+1XXXXXXXXXX) so they dedupe cleanly.
function AdditionalPhonesEditor({
  customerId,
  primaryPhone,
  phones,
  ghlContactId,
  onRefresh,
}: {
  customerId: string;
  primaryPhone: string | null;
  phones: string[];
  ghlContactId: string | null;
  onRefresh: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = async (next: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await updateCustomerAdditionalPhones(customerId, next);
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const digits = value.replace(/\D/g, "");
    if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")))) {
      setError("Enter a 10-digit US number.");
      return;
    }
    const normalized = normalizePhoneForStorage(value);
    if (normalized === normalizePhoneForStorage(primaryPhone ?? "")) { setError("That's already the primary number."); return; }
    if (phones.some((p) => normalizePhoneForStorage(p) === normalized)) { setError("Already added."); return; }
    setValue("");
    setAdding(false);
    await persist([...phones, normalized]);
  };

  const remove = (p: string) => persist(phones.filter((x) => x !== p));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {phones.map((p) => {
        const tel = p.replace(/[^+\d]/g, "");
        return (
          <span
            key={p}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-ocean-blue/10 text-ocean-blue dark:text-blue-300 border border-ocean-blue/30"
            title={`Additional cell for this merchant: ${p}`}
          >
            {/* Dials via VibeReach (records + auto-logs) when the contact exists,
                like the header number; a plain tel: link otherwise. */}
            {ghlContactId ? (
              <a
                href={`https://app.vibereach.io/v2/location/${GHL_LOCATION}/contacts/detail/${ghlContactId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline"
                title="Open in VibeReach — its call button dials, records, and auto-logs"
              >
                <PhoneIcon className="w-3 h-3" /> {p}
              </a>
            ) : (
              <a href={`tel:${tel}`} className="inline-flex items-center gap-1 hover:underline" title="Dial this number">
                <PhoneIcon className="w-3 h-3" /> {p}
              </a>
            )}
            <button
              type="button"
              onClick={() => remove(p)}
              disabled={busy}
              title="Remove this number"
              className="ml-0.5 hover:text-red-600 disabled:opacity-50"
            >
              <XMarkIcon className="w-3 h-3" />
            </button>
          </span>
        );
      })}

      {adding ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            type="tel"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } if (e.key === "Escape") { setAdding(false); setValue(""); setError(null); } }}
            placeholder="(555) 123-4567"
            className="text-[11px] rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 px-2 py-0.5 w-36"
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy}
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-ocean-blue text-white hover:bg-deep-sea disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setValue(""); setError(null); }}
            className="text-[11px] text-gray-400 hover:text-gray-600"
          >
            cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          title="Add another cell number this merchant can be reached on"
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-dashed border-ocean-blue/50 text-ocean-blue dark:text-blue-300 hover:bg-ocean-blue/10"
        >
          <PlusIcon className="w-3 h-3" /> cell
        </button>
      )}

      {error && <span className="text-[11px] text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

// ── Setter contacts editor ──
// One panel to add/edit the merchant's additional emails (CC'd on outbound) and
// additional cell numbers (dialable alongside the primary). The primary email and
// phone are shown read-only for context — the setter never leaves the console to
// add the owner's bookkeeper, a partner, or a second cell. No popups; each edit
// persists on add/remove and calls onRefresh.
export default function SetterContactsEditor({
  deal,
  onRefresh,
}: {
  deal: DealWithCustomer;
  onRefresh: () => void;
}) {
  const customer = deal.customer;

  if (!customer) {
    return (
      <div className="text-[12px] text-gray-500 dark:text-gray-400">
        No merchant record linked to this deal yet.
      </div>
    );
  }

  const primaryEmail = customer.email ?? null;
  const primaryPhone = customer.phone ?? null;
  const additionalEmails = (customer.additional_emails ?? []).filter(Boolean);
  const additionalPhones = (customer.additional_phones ?? []).filter(Boolean);

  return (
    <div className="space-y-4">
      {/* Emails */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <EnvelopeIcon className="w-3.5 h-3.5" /> Emails
        </div>
        <div className="flex items-center gap-2 text-[12px] text-gray-700 dark:text-gray-200">
          <span className="text-gray-400 dark:text-gray-500">Primary:</span>
          {primaryEmail ? (
            <span className="font-medium">{primaryEmail}</span>
          ) : (
            <span className="italic text-gray-400 dark:text-gray-500">none on file</span>
          )}
        </div>
        <AdditionalEmailsEditor
          customerId={customer.id}
          primaryEmail={primaryEmail}
          emails={additionalEmails}
          onRefresh={onRefresh}
        />
      </div>

      {/* Phones */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          <PhoneIcon className="w-3.5 h-3.5" /> Cell phones
        </div>
        <div className="flex items-center gap-2 text-[12px] text-gray-700 dark:text-gray-200">
          <span className="text-gray-400 dark:text-gray-500">Primary:</span>
          {primaryPhone ? (
            <span className="font-medium">{primaryPhone}</span>
          ) : (
            <span className="italic text-gray-400 dark:text-gray-500">none on file</span>
          )}
        </div>
        <AdditionalPhonesEditor
          customerId={customer.id}
          primaryPhone={primaryPhone}
          phones={additionalPhones}
          ghlContactId={deal.ghl_contact_id}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}
