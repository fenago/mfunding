import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import supabase from "../supabase";
import { getDealById } from "../services/dealService";
import type { PlaybookBusiness } from "../components/admin/BusinessPicker";
import type { DealWithCustomer, DealSubmissionWithLender } from "../types/deals";

/**
 * usePlaybookContact — the Revenue Playbook's deep-link + contact-resolution
 * engine, lifted verbatim out of PlaybooksPage (lines ~240-419 / 950-974) into a
 * standalone hook so a SECOND host (the setter Operations console) can load the
 * exact same merchant the exact same way, with none of PlaybooksPage's flow-tab,
 * campaign, or economics baggage.
 *
 * It owns ONE loaded merchant: the deal, its submissions, and — when the owner
 * has more than one business — the BusinessPicker context (`bizCtx`). It does NOT
 * pick a playbook/flow tab (that is PlaybooksPage's concern); a host that needs
 * one derives it from `deal.deal_type` / `deal.lead_source` itself.
 *
 * Contract:
 *   const { deal, submissions, bizCtx, phase, error,
 *           openMerchant, pickBusiness, reload } = usePlaybookContact();
 *
 * Deep links (auto-parsed from the URL search string, once per link):
 *   ?deal=<dealId>           → load that deal directly
 *   ?contact=<ghlContactId>  → resolve via playbook-open-contact
 *   ?phone=<phone>           → resolve via playbook-open-contact
 *   legacy ?x=… or a /contacts/detail/{id} path → contact id recovered from either
 */

// Digits-only phone identity: a setter pastes whatever the dialer shows —
// "(305) 555-0134", "+1 305-555-0134", "13055550134" — so strip everything that
// isn't a digit and drop the US country code. (Verbatim from PlaybooksPage.)
function dialDigits(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

// supabase.functions.invoke stashes a non-2xx response's JSON body in
// error.context (a Response) — pull the server's { error } out of it so the real
// reason reaches the setter instead of "non-2xx status code". (Verbatim.)
async function invokeThrow(error: unknown): Promise<never> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
    if (body?.error) throw new Error(body.error);
  }
  throw new Error((error as { message?: string } | null)?.message ?? "Request failed.");
}

/** "Which contact are we working, and what does he/she own." Drives the picker. */
export type PlaybookBizCtx = {
  key: string;
  ghlContactId: string | null;
  phone: string | null;
  ownerLabel: string;
  businesses: PlaybookBusiness[];
  listState: "idle" | "loading" | "error";
  listError: string | null;
};

export type PlaybookLookup = { dealId?: string; ghlContactId?: string; phone?: string };

export interface UsePlaybookContact {
  deal: DealWithCustomer | null;
  submissions: DealSubmissionWithLender[];
  bizCtx: PlaybookBizCtx | null;
  phase: "idle" | "loading" | "error";
  error: string | null;
  /** Resolve → load a merchant. Never throws; returns ok/not-ok. */
  openMerchant: (lookup: PlaybookLookup) => Promise<boolean>;
  /** Open one of the owner's businesses (from bizCtx) into the workspace. */
  pickBusiness: (customerId: string) => Promise<boolean>;
  /** Re-fetch the currently loaded deal (after a mutation elsewhere). */
  reload: () => Promise<void>;
}

export default function usePlaybookContact(): UsePlaybookContact {
  const [deal, setDeal] = useState<DealWithCustomer | null>(null);
  const [submissions, setSubmissions] = useState<DealSubmissionWithLender[]>([]);
  const [bizCtx, setBizCtx] = useState<PlaybookBizCtx | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  // Load a deal by id and mirror both halves of getDealById into state. Shared by
  // openMerchant, pickBusiness, and reload so all three hydrate identically.
  const loadDeal = useCallback(async (dealId: string): Promise<boolean> => {
    const found = await getDealById(dealId);
    if (!found) throw new Error("Couldn't load that merchant's deal — find it in My Day.");
    setDeal(found.deal);
    setSubmissions(found.submissions);
    return true;
  }, []);

  // Resolve → load a merchant. ONE path for both deep-link forms (contact id and
  // phone) plus a direct dealId, so they get the same spinner and the same error.
  // Never throws — reports through phase/error and returns ok/not-ok.
  const openMerchant = useCallback(
    async (lookup: PlaybookLookup): Promise<boolean> => {
      setPhase("loading");
      setError(null);
      try {
        let targetDealId = lookup.dealId ?? "";
        if (!targetDealId) {
          const body = lookup.ghlContactId
            ? { ghl_contact_id: lookup.ghlContactId }
            : { phone: lookup.phone };
          const { data, error: fnErr } = await supabase.functions.invoke("playbook-open-contact", { body });
          if (fnErr) await invokeThrow(fnErr);
          const res = data as {
            ok?: boolean;
            deal_id?: string;
            error?: string;
            multiple_businesses?: boolean;
            businesses?: PlaybookBusiness[];
            ghl_contact_id?: string | null;
          } | null;
          // The owner owns more than one business → DON'T silently land on #1.
          // Surface the picker (bizCtx). This response carries NO deal_id, so it
          // must be handled before the deal_id guard. The ?phone= path learns the
          // owner's contact id here — what a later add/open is keyed on.
          if (res?.multiple_businesses && res.businesses?.length) {
            const contactId = lookup.ghlContactId || res.ghl_contact_id || "";
            setBizCtx({
              key: contactId || dialDigits(lookup.phone ?? ""),
              ghlContactId: contactId || null,
              phone: lookup.phone ?? null,
              ownerLabel: lookup.phone || "this contact",
              businesses: res.businesses,
              listState: "idle",
              listError: null,
            });
            setDeal(null);
            setSubmissions([]);
            setPhase("idle");
            return true;
          }
          if (!res?.ok || !res.deal_id) throw new Error(res?.error || "Couldn't open that merchant.");
          targetDealId = res.deal_id;
        }
        await loadDeal(targetDealId);
        setPhase("idle");
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Couldn't open that merchant.";
        setError(msg);
        setPhase("error");
        return false;
      }
    },
    [loadDeal],
  );

  // Open one of the owner's businesses — resolve its deal, then load it into the
  // SAME workspace any other deal uses. (Mirrors PlaybooksPage.openBusiness.)
  const pickBusiness = useCallback(
    async (customerId: string): Promise<boolean> => {
      setPhase("loading");
      setError(null);
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("playbook-open-contact", {
          body: { action: "open_business", customer_id: customerId },
        });
        if (fnErr) await invokeThrow(fnErr);
        const res = data as { deal_id?: string; error?: string } | null;
        if (res?.error) throw new Error(res.error);
        if (!res?.deal_id) throw new Error("Couldn't open that business — no deal came back.");
        await loadDeal(res.deal_id);
        setPhase("idle");
        return true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Couldn't open that business.";
        setError(msg);
        setPhase("error");
        return false;
      }
    },
    [loadDeal],
  );

  // Re-fetch the loaded deal after a mutation (stage move, appointment, send).
  const reload = useCallback(async (): Promise<void> => {
    const id = deal?.id;
    if (!id) return;
    const found = await getDealById(id);
    if (found) {
      setDeal(found.deal);
      setSubmissions(found.submissions);
    }
  }, [deal?.id]);

  // ── Deep link auto-parse ──────────────────────────────────────────────────
  // Runs once PER LINK, then strips the params so a refresh can't re-fire it.
  // Reacts to the search string changing (not just mounting): a host that stays
  // mounted while a new lead is routed in must still re-run. StrictMode's
  // double-invoke is guarded by handledDeepLink without blocking the next link.
  const handledDeepLink = useRef<string | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(search);
    const dealParam = sp.get("deal")?.trim() ?? "";
    const phoneParam = dialDigits(sp.get("phone") ?? "");
    let contactParam = sp.get("contact")?.trim() ?? "";
    if (!contactParam) {
      const hay = `${sp.get("x") ?? ""} ${window.location.pathname}`;
      contactParam = hay.match(/\/contacts\/detail\/([^/?#\s]+)/)?.[1] ?? "";
    }
    // Nothing to open. Clearing the guard here is what lets the SAME lead be
    // opened twice (the URL is stripped in between).
    if (!dealParam && !contactParam && !phoneParam) {
      handledDeepLink.current = null;
      return;
    }
    const key = `${dealParam}|${contactParam}|${phoneParam}`;
    if (handledDeepLink.current === key) return;
    handledDeepLink.current = key;
    void (async () => {
      try {
        await openMerchant(
          dealParam
            ? { dealId: dealParam }
            : contactParam
              ? { ghlContactId: contactParam }
              : { phone: phoneParam },
        );
      } finally {
        // Clean URL: a refresh reopens the page, not the deep link. Routed through
        // navigate (not history.replaceState) so react-router's own location
        // clears too. Stays on the CURRENT route so this hook is host-agnostic.
        navigate(pathname, { replace: true });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return { deal, submissions, bizCtx, phase, error, openMerchant, pickBusiness, reload };
}
