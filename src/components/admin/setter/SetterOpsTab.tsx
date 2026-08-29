import { useCallback, useState } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import usePlaybookContact from "@/hooks/usePlaybookContact";
import BusinessPicker from "@/components/admin/BusinessPicker";
import SetterHeaderBar from "@/components/admin/setter/SetterHeaderBar";
import SetterActionRail from "@/components/admin/setter/SetterActionRail";
import SetterCommsPanel from "@/components/admin/setter/SetterCommsPanel";
import SetterMerchantSearch from "@/components/admin/setter/SetterMerchantSearch";

/**
 * SetterOpsTab — the setter's single-screen Operations console, mounted as a tab
 * inside Setter Performance. It is the INTEGRATOR: it owns nothing but the layout
 * and one shared toast, and hands the ONE loaded merchant to the four reusable
 * pieces built in Pass 1.
 *
 * How a merchant gets here:
 *   • DEEP LINK — a setter contact link (?deal / ?contact / ?phone / legacy ?x=,
 *     or a /contacts/detail/{id} path) is auto-parsed by usePlaybookContact on
 *     mount, then stripped. The page's own mount effect flips the tab to
 *     "operations" whenever one of those params is present, so the link lands
 *     here rather than on Funnel.
 *   • MANUAL — no deep link → a phone box (idle state) lets a setter paste the
 *     number the dialer shows and pull the merchant up by hand.
 *
 * usePlaybookContact resolves the contact and NEVER re-fetches once loaded; every
 * child binds to the same `deal` and re-reads it only through `reload`.
 */
export default function SetterOpsTab() {
  const { deal, bizCtx, phase, error, openMerchant, pickBusiness, reload } = usePlaybookContact();

  // ONE toast, shared by the whole console (SetterHeaderBar's stage moves report
  // through it; the action rail keeps its own for modal/appointment feedback).
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const notify = useCallback((text: string, tone: string = "ok") => {
    setToast({ text, tone: tone === "error" ? "error" : "ok" });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Manual pull-up delegate — SetterMerchantSearch resolves the lookup (dealId or
  // phone) and hands it here; the hook does the actual load.
  const pullUp = useCallback(
    (lookup: Parameters<typeof openMerchant>[0]) => {
      void openMerchant(lookup);
    },
    [openMerchant],
  );

  // BusinessPicker wiring — one owner, many businesses. `pickBusiness` opens the
  // chosen one into the SAME workspace; a row shows a spinner while it loads.
  const [busyCustomerId, setBusyCustomerId] = useState<string | null>(null);
  const openBusiness = useCallback(
    (customerId: string) => {
      setBusyCustomerId(customerId);
      void pickBusiness(customerId).finally(() => setBusyCustomerId(null));
    },
    [pickBusiness],
  );

  // Re-open the contact to refetch its business list (the hook's bizCtx has no
  // standalone list-reload; re-resolving the same contact rebuilds it).
  const retryList = useCallback(() => {
    if (!bizCtx) return;
    void openMerchant(
      bizCtx.ghlContactId ? { ghlContactId: bizCtx.ghlContactId } : { phone: bizCtx.phone ?? "" },
    );
  }, [bizCtx, openMerchant]);

  // Add a second/third business for this owner, then drop straight into it.
  // Reuses the playbook's edge action; throws on failure so BusinessPicker shows
  // the reason inline.
  const addBusiness = useCallback(
    async (businessName: string) => {
      const ctx = bizCtx;
      if (!ctx || (!ctx.ghlContactId && !ctx.phone)) {
        throw new Error("No contact loaded — open the merchant first.");
      }
      const body: Record<string, unknown> = {
        action: "add_business",
        business_name: businessName,
        ...(ctx.ghlContactId ? { ghl_contact_id: ctx.ghlContactId } : { phone: ctx.phone }),
      };
      const { data, error: fnErr } = await supabase.functions.invoke("playbook-open-contact", { body });
      if (fnErr) throw new Error(fnErr instanceof Error ? fnErr.message : "Couldn't add that business.");
      const res = data as { deal_id?: string; error?: string } | null;
      if (res?.error) throw new Error(res.error);
      if (!res?.deal_id) throw new Error("The business was created but no deal came back — find it in My Day.");
      await openMerchant({ dealId: res.deal_id });
    },
    [bizCtx, openMerchant],
  );

  // ── Body by phase ──────────────────────────────────────────────────────────
  let body: React.ReactNode;

  if (phase === "loading") {
    body = (
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm py-10 justify-center">
        <span className="loading loading-spinner loading-sm" /> Pulling up the merchant…
      </div>
    );
  } else if (phase === "error") {
    // UNREADABLE ≠ empty — a red banner, never a blank console. The setter can
    // immediately try another number.
    body = (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">Couldn't open that merchant.</div>
            <div className="mt-0.5">{error || "Something went wrong resolving the contact."}</div>
          </div>
        </div>
        <SetterMerchantSearch onOpen={pullUp} />
      </div>
    );
  } else if (bizCtx && !deal) {
    // One owner, multiple businesses — pick which one to work (nothing auto-opens).
    body = (
      <BusinessPicker
        businesses={bizCtx.businesses}
        activeCustomerId={null}
        ownerLabel={bizCtx.ownerLabel}
        listState={bizCtx.listState}
        listError={bizCtx.listError}
        onRetryList={retryList}
        onOpen={openBusiness}
        onAdd={addBusiness}
        busyCustomerId={busyCustomerId}
      />
    );
  } else if (deal) {
    // Loaded — the single-screen console. Application-first: the action rail's
    // primary is "Fill out application", and it auto-opens the first time a deal
    // resolves so capture leads.
    body = (
      <div className="space-y-4">
        <SetterHeaderBar deal={deal} onRefresh={reload} notify={notify} />
        <SetterActionRail deal={deal} onRefresh={reload} autoOpen />
        <SetterCommsPanel deal={deal} onRefresh={reload} />
      </div>
    );
  } else {
    // Idle, no deep link — manual pull-up (search by business, name, or phone).
    body = <SetterMerchantSearch onOpen={pullUp} />;
  }

  return (
    <div className="space-y-4">
      {body}
      {toast && (
        <div
          className={`text-sm font-medium ${
            toast.tone === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
