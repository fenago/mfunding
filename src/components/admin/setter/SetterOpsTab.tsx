import { useCallback, useState } from "react";
import { ExclamationTriangleIcon, ArrowLeftIcon } from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import usePlaybookContact from "@/hooks/usePlaybookContact";
import BusinessPicker from "@/components/admin/BusinessPicker";
import SetterHeaderBar from "@/components/admin/setter/SetterHeaderBar";
import SetterSnapshot from "@/components/admin/setter/SetterSnapshot";
import SetterActionRail from "@/components/admin/setter/SetterActionRail";
import SetterCommsPanel from "@/components/admin/setter/SetterCommsPanel";
import SetterCallOutcome from "@/components/admin/setter/SetterCallOutcome";
import SetterNotes from "@/components/admin/setter/SetterNotes";
import SetterMerchantSearch from "@/components/admin/setter/SetterMerchantSearch";
import SetterDealList from "@/components/admin/setter/SetterDealList";
import SetterPortalCard from "@/components/admin/setter/SetterPortalCard";
import SetterDocSigning from "@/components/admin/setter/SetterDocSigning";
import SetterDndButton from "@/components/admin/setter/SetterDndButton";
import SetterContactsEditor from "@/components/admin/setter/SetterContactsEditor";
import SetterDealMeta from "@/components/admin/setter/SetterDealMeta";
import SetterConnectBank from "@/components/admin/setter/SetterConnectBank";

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

  // "Back to my deals" — when a deal is loaded, this flips the console back to the
  // idle view (search + my-deals list) WITHOUT clearing the hook's loaded deal, so
  // returning is instant. Opening any new merchant clears it again (see pullUp).
  const [showList, setShowList] = useState(false);

  // Manual pull-up delegate — both SetterMerchantSearch and SetterDealList resolve
  // a lookup (dealId or phone) and hand it here; the hook does the actual load.
  // Leaving the list is implicit in opening a merchant, so drop the override.
  const pullUp = useCallback(
    (lookup: Parameters<typeof openMerchant>[0]) => {
      setShowList(false);
      void openMerchant(lookup);
    },
    [openMerchant],
  );

  // The default idle view: search ANY merchant on top, the signed-in setter's own
  // book below it. Shown when nothing is loaded, and re-shown by "Back to my deals".
  const idleView = (
    <div className="space-y-4">
      <SetterMerchantSearch onOpen={pullUp} />
      <SetterDealList onOpen={pullUp} />
    </div>
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
        {idleView}
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
  } else if (deal && !showList) {
    // Loaded — the single-screen console. Application-first: the action rail's
    // primary is "Fill out application", and it auto-opens the first time a deal
    // resolves so capture leads. The "Back to my deals" affordance returns to the
    // idle list without losing the loaded merchant.
    body = (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setShowList(true)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-ocean-blue"
          title="Return to your book — the search box and your assigned deals"
        >
          <ArrowLeftIcon className="w-3.5 h-3.5" /> Back to my deals
        </button>
        <SetterHeaderBar deal={deal} onRefresh={reload} notify={notify} />
        {/* Context BEFORE action: the merchant facts strip sits right under the
            header so a setter reads the stack/revenue/ask before they dial. */}
        <SetterSnapshot deal={deal} onRefresh={reload} />
        {/* Product + campaign attribution context, right under the snapshot. */}
        <SetterDealMeta deal={deal} onRefresh={reload} />
        {/* Merchant-status row: portal invite / paperwork sent+signed / DND, three
            up on large screens and stacked on mobile so the setter sees where the
            merchant is before dialing. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SetterPortalCard deal={deal} onRefresh={reload} />
          <SetterDocSigning deal={deal} onRefresh={reload} />
          <SetterDndButton deal={deal} onRefresh={reload} />
        </div>
        <SetterActionRail deal={deal} onRefresh={reload} autoOpen />
        <SetterCommsPanel deal={deal} onRefresh={reload} />
        {/* Contact details + connect-bank sit right below comms — the setter edits
            extra emails/cells and hands over the bank/statements link in the same
            breath as reaching out; two columns on large screens, stacked on mobile. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SetterContactsEditor deal={deal} onRefresh={reload} />
          <SetterConnectBank deal={deal} onRefresh={reload} />
        </div>
        {/* Log-the-call and Notes side by side below the action/comms panels —
            two columns on large screens, stacked on mobile; both are self-contained
            and re-read the loaded deal through the same reload. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SetterCallOutcome deal={deal} onRefresh={reload} />
          <SetterNotes deal={deal} onRefresh={reload} />
        </div>
      </div>
    );
  } else {
    // Idle (no deep link) OR "Back to my deals" — the default view: search any
    // merchant on top, the setter's own book below.
    body = idleView;
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
