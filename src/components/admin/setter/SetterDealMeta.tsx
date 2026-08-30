// SetterDealMeta — the deal's "what & where from" line for the Setter Operations
// console: the products the merchant is shopping for (editable) and the campaign
// the deal is attributed to (read-only in Ops).
//
// Ported from the Revenue Playbook's context bar (ProductsChips + CampaignChip)
// so the two surfaces behave identically. The setter never leaves the console —
// products toggle inline (each toggle persists + reconciles GHL product-* tags),
// and the campaign is display-only here (attribution is edited from the deal /
// campaigns screens, not the setter floor).
//
// Standalone by contract: takes only { deal, onRefresh }, never re-fetches the
// deal, reuses the EXPORTED services.
import { useEffect, useState } from "react";
import { MegaphoneIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import type { DealWithCustomer, ProductInterest } from "@/types/deals";
import { PRODUCT_INTEREST_OPTIONS } from "@/types/deals";
import { updateDealProducts } from "@/services/dealService";
import { listCampaigns, campaignLabel } from "@/services/campaignService";
import type { Campaign } from "@/services/campaignService";
import { useUserProfile } from "@/context/UserProfileContext";

interface Props {
  deal: DealWithCustomer;
  onRefresh: () => void;
}

/**
 * Editable product chips — filled = selected, at least one always stays on. Each
 * toggle persists to deals.products_interested and reconciles the product-* tags
 * on the GHL contact (updateDealProducts → sync-deal-product-tags). Optimistic,
 * inline, no popup.
 */
function ProductsChips({ deal, onRefresh }: Props) {
  const fromDeal = (d: DealWithCustomer): ProductInterest[] =>
    d.products_interested && d.products_interested.length > 0
      ? d.products_interested
      : (["mca"] as ProductInterest[]);
  const [products, setProducts] = useState<ProductInterest[]>(fromDeal(deal));
  const [saving, setSaving] = useState<ProductInterest | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    setProducts(fromDeal(deal));
    setWarning(null);
  }, [deal.id, deal.products_interested]);

  async function toggle(value: ProductInterest) {
    const on = products.includes(value);
    if (on && products.length === 1) return; // keep at least one
    const next = on ? products.filter((p) => p !== value) : [...products, value];
    const prev = products;
    setProducts(next); // optimistic
    setWarning(null);
    setSaving(value);
    try {
      const res = await updateDealProducts(deal.id, next);
      setProducts(res.products);
      if (res.ghlWarning) setWarning(res.ghlWarning);
      onRefresh();
    } catch (e) {
      setProducts(prev); // revert
      setWarning(e instanceof Error ? e.message : "Could not save products.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Products:</span>
      {PRODUCT_INTEREST_OPTIONS.map((opt) => {
        const active = products.includes(opt.value);
        const busy = saving === opt.value;
        const lockLast = active && products.length === 1;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            disabled={busy || lockLast}
            title={
              lockLast
                ? `${opt.full} — at least one product must stay selected`
                : `${active ? "Remove" : "Add"} ${opt.full}`
            }
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
              active
                ? "bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
            } ${busy ? "opacity-60" : ""} ${lockLast ? "cursor-not-allowed" : ""}`}
          >
            {opt.label}
          </button>
        );
      })}
      {warning && (
        <span className="text-[11px] text-amber-600 dark:text-amber-400" title={warning}>
          ⚠ saved; GHL tags: {warning.length > 40 ? warning.slice(0, 40) + "…" : warning}
        </span>
      )}
    </div>
  );
}

/**
 * Read-only campaign chip — the STAMPED attribution (deal.campaign_id, the same
 * id every KPI join uses). Dial campaigns also show their tag ("which list did
 * this come from"). The /admin/campaigns link is gated on isAdmin exactly like
 * the playbook chip — a setter sees the chip, not a door they can't open.
 */
function CampaignChip({ campaign }: { campaign: Campaign }) {
  const { isAdmin } = useUserProfile();
  const isDial = campaign.channel === "outbound_dial";
  const body = (
    <>
      <MegaphoneIcon className="w-3 h-3" /> {campaignLabel(campaign)}
      {isDial && campaign.dial_tag && (
        <span className="font-mono text-[10px] opacity-70">{campaign.dial_tag}</span>
      )}
    </>
  );
  const cls =
    "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full " +
    (isDial
      ? "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300"
      : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300");
  const title = `Attributed to ${campaign.name}${isDial && campaign.dial_tag ? ` — dialed on ${campaign.dial_tag}` : ""}`;

  return isAdmin ? (
    <Link to="/admin/campaigns" className={`${cls} hover:underline`} title={title}>
      {body}
    </Link>
  ) : (
    <span className={cls} title={title}>
      {body}
    </span>
  );
}

/**
 * The Ops console has no campaign object on the deal — only deal.campaign_id — so
 * we resolve it via listCampaigns() (single-digit rows) and find the match. Amber
 * "No campaign" note when the deal is unattached.
 */
function CampaignLine({ deal }: { deal: DealWithCustomer }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!deal.campaign_id) {
      setCampaign(null);
      setLoading(false);
      return;
    }
    listCampaigns()
      .then((rows) => {
        if (cancelled) return;
        setCampaign(rows.find((c) => c.id === deal.campaign_id) ?? null);
      })
      .catch(() => {
        if (!cancelled) setCampaign(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deal.campaign_id]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">Campaign:</span>
      {loading ? (
        <span className="text-[11px] text-gray-400 dark:text-gray-500">…</span>
      ) : campaign ? (
        <CampaignChip campaign={campaign} />
      ) : (
        <span
          className="text-[11px] font-medium text-amber-600 dark:text-amber-400"
          title="This deal isn't attributed to a campaign — its results won't roll up into any campaign's KPIs."
        >
          ⚠ No campaign
        </span>
      )}
    </div>
  );
}

/**
 * Product selector (editable) + campaign attribution (read-only) for the Setter
 * Operations console.
 */
export default function SetterDealMeta({ deal, onRefresh }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <ProductsChips deal={deal} onRefresh={onRefresh} />
      <CampaignLine deal={deal} />
    </div>
  );
}
