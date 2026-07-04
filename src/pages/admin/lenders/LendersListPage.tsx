import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  BuildingLibraryIcon,
  GlobeAltIcon,
  ArrowTopRightOnSquareIcon,
  BookOpenIcon,
  MapIcon,
} from "@heroicons/react/24/outline";
import { ChartBarIcon, ArrowRightIcon } from "@heroicons/react/24/outline";
import supabase from "../../../supabase";
import LenderEditModal from "../../../components/lenders/LenderEditModal";
import { getFunderScoreboard, type FunderScore } from "../../../services/dealService";
import { PARTNERSHIP_LABEL, PARTNERSHIP_COLOR } from "../../../data/partnershipTypes";
import { PROGRAM_SELECT, money, type LenderProgram } from "../../../data/lenderPrograms";

type LenderStatus = "potential" | "application_submitted" | "processing" | "approved" | "live_vendor" | "affiliate_referral" | "rejected" | "inactive";
type PaperType = "a_paper" | "b_paper" | "c_paper" | "d_paper";

interface Lender {
  id: string;
  company_name: string;
  website: string | null;
  status: LenderStatus;
  lender_types: string[];
  partnership_types: string[] | null;
  paper_types: PaperType[];
  min_credit_score: number | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<LenderStatus, { label: string; color: string; priority: number }> = {
  live_vendor: { label: "Live Vendor", color: "bg-emerald-100 text-emerald-800", priority: 1 },
  approved: { label: "Approved", color: "bg-green-100 text-green-800", priority: 2 },
  processing: { label: "Processing", color: "bg-yellow-100 text-yellow-800", priority: 3 },
  application_submitted: { label: "Applied", color: "bg-blue-100 text-blue-800", priority: 4 },
  potential: { label: "Potential", color: "bg-gray-100 text-gray-800", priority: 5 },
  affiliate_referral: { label: "Affiliate / Referral", color: "bg-amber-100 text-amber-800", priority: 6 },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800", priority: 7 },
  inactive: { label: "Inactive", color: "bg-gray-100 text-gray-600", priority: 8 },
};

const PAPER_TYPE_CONFIG: Record<PaperType, { label: string; description: string; color: string; minScore: number; maxScore: number }> = {
  a_paper: { label: "A Paper", description: "700+ credit, clean", color: "bg-green-100 text-green-800", minScore: 700, maxScore: 850 },
  b_paper: { label: "B Paper", description: "600-699 credit", color: "bg-blue-100 text-blue-800", minScore: 600, maxScore: 699 },
  c_paper: { label: "C Paper", description: "500-599 credit", color: "bg-yellow-100 text-yellow-800", minScore: 500, maxScore: 599 },
  d_paper: { label: "D Paper", description: "Below 500, stacked", color: "bg-red-100 text-red-800", minScore: 0, maxScore: 499 },
};

// Status order for display (most relevant first)
const STATUS_ORDER: LenderStatus[] = [
  "live_vendor",
  "approved",
  "processing",
  "application_submitted",
  "potential",
  "affiliate_referral",
  "rejected",
  "inactive",
];

export default function LendersListPage() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [paperTypeFilter, setPaperTypeFilter] = useState<string>("");
  const [creditScoreFilter, setCreditScoreFilter] = useState<string>("");
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  useEffect(() => {
    fetchLenders();
    // Refresh when the tab regains focus so lenders added elsewhere (e.g. the
    // Funder Directory) show up without a manual reload.
    const refresh = () => { if (document.visibilityState === "visible") fetchLenders(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [programs, setPrograms] = useState<Record<string, LenderProgram>>({});

  const fetchLenders = async () => {
    setIsLoading(true);
    const [{ data, error }, { data: progs }] = await Promise.all([
      supabase.from("lenders").select("*").order("company_name", { ascending: true }),
      supabase.from("lender_programs").select(PROGRAM_SELECT).eq("product_type", "mca").eq("is_active", true),
    ]);
    if (error) {
      console.error("Error fetching lenders:", error);
    } else {
      setLenders(data || []);
    }
    const pm: Record<string, LenderProgram> = {};
    for (const p of (progs || []) as LenderProgram[]) pm[p.lender_id] = p;
    setPrograms(pm);
    setIsLoading(false);
  };

  const filteredLenders = lenders
    .filter((lender) => {
      if (searchQuery) {
        // Ignore spaces/punctuation so "1west" matches "1 West", etc.
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!norm(lender.company_name).includes(norm(searchQuery))) return false;
      }
      if (statusFilter && lender.status !== statusFilter) {
        return false;
      }
      if (paperTypeFilter && (!lender.paper_types || !lender.paper_types.includes(paperTypeFilter as PaperType))) {
        return false;
      }
      if (creditScoreFilter) {
        const score = parseInt(creditScoreFilter);
        // Check if lender can handle this credit score based on their paper types or min_credit_score
        if (lender.min_credit_score && score < lender.min_credit_score) {
          return false;
        }
        // Also filter by paper type ranges if paper_types is set
        if (lender.paper_types && lender.paper_types.length > 0) {
          const canHandle = lender.paper_types.some((pt) => {
            const config = PAPER_TYPE_CONFIG[pt];
            return score >= config.minScore && score <= config.maxScore;
          });
          if (!canHandle) return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      // Sort by status priority first, then by company name
      const priorityA = STATUS_CONFIG[a.status]?.priority || 99;
      const priorityB = STATUS_CONFIG[b.status]?.priority || 99;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.company_name.localeCompare(b.company_name);
    });

  // Group lenders by status for sectioned display
  const groupedLenders = STATUS_ORDER.reduce((acc, status) => {
    const lendersInStatus = filteredLenders.filter((l) => l.status === status);
    if (lendersInStatus.length > 0) {
      acc[status] = lendersInStatus;
    }
    return acc;
  }, {} as Record<LenderStatus, Lender[]>);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-mint-green"></div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Lenders</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage your funding partners and lender relationships
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/admin/funder-guide"
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <MapIcon className="w-5 h-5" />
            Funder Guide
          </Link>
          <Link
            to="/admin/lenders/resources"
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <BookOpenIcon className="w-5 h-5" />
            Lender Resources
          </Link>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="btn-primary flex items-center gap-2"
          >
            <PlusIcon className="w-5 h-5" />
            Add Lender
          </button>
        </div>
      </div>

      {/* Funder scoreboard — how each funder is actually performing on real deals */}
      <FunderScoreboard />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search lenders..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-field pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-field w-40"
        >
          <option value="">All Status</option>
          {Object.entries(STATUS_CONFIG).map(([value, config]) => (
            <option key={value} value={value}>
              {config.label}
            </option>
          ))}
        </select>
        <select
          value={paperTypeFilter}
          onChange={(e) => setPaperTypeFilter(e.target.value)}
          className="input-field w-36"
        >
          <option value="">All Paper</option>
          {Object.entries(PAPER_TYPE_CONFIG).map(([value, config]) => (
            <option key={value} value={value}>
              {config.label}
            </option>
          ))}
        </select>
        <div className="relative">
          <input
            type="number"
            placeholder="Credit Score"
            value={creditScoreFilter}
            onChange={(e) => setCreditScoreFilter(e.target.value)}
            className="input-field w-32"
            min="300"
            max="850"
          />
        </div>
        {(statusFilter || paperTypeFilter || creditScoreFilter || searchQuery) && (
          <button
            onClick={() => {
              setStatusFilter("");
              setPaperTypeFilter("");
              setCreditScoreFilter("");
              setSearchQuery("");
            }}
            className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Lenders Grid - Grouped by Status */}
      {filteredLenders.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <BuildingLibraryIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            No lenders found
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            {searchQuery || statusFilter
              ? "Try adjusting your filters"
              : "Get started by adding your first lender"}
          </p>
          {!searchQuery && !statusFilter && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-primary inline-flex items-center gap-2"
            >
              <PlusIcon className="w-5 h-5" />
              Add Lender
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedLenders).map(([status, lendersInGroup]) => (
            <div key={status}>
              {/* Status Section Header */}
              <div className="flex items-center gap-3 mb-4">
                <span
                  className={`px-3 py-1 text-sm font-semibold rounded-full ${
                    STATUS_CONFIG[status as LenderStatus]?.color
                  }`}
                >
                  {STATUS_CONFIG[status as LenderStatus]?.label}
                </span>
                <span className="text-sm text-gray-500">
                  {lendersInGroup.length} {lendersInGroup.length === 1 ? "lender" : "lenders"}
                </span>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>

              {/* Lenders Grid */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {lendersInGroup.map((lender) => (
                  <Link
                    key={lender.id}
                    to={`/admin/lenders/${lender.id}`}
                    className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 hover:shadow-lg hover:border-ocean-blue/30 transition-all"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="font-semibold text-gray-900 dark:text-white">
                        {lender.company_name}
                      </h3>
                    </div>

                    {lender.website && (
                      <div className="flex items-center gap-2 text-sm text-ocean-blue mb-2">
                        <GlobeAltIcon className="w-4 h-4" />
                        <span className="truncate">{lender.website.replace(/^https?:\/\//, "")}</span>
                        <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                      </div>
                    )}

                    {lender.primary_contact_name && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Contact: {lender.primary_contact_name}
                      </p>
                    )}

                    {/* MCA approval basics + hard document requirements (from the Funder Approval Matrix) */}
                    {programs[lender.id] && <ProgramSummary p={programs[lender.id]} />}

                    {/* Partnership Types — how we work with this funder */}
                    {lender.partnership_types && lender.partnership_types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {lender.partnership_types.map((type) => (
                          <span
                            key={type}
                            className={`px-2 py-0.5 text-xs rounded font-semibold ${PARTNERSHIP_COLOR[type] || "bg-gray-100 text-gray-600"}`}
                          >
                            {PARTNERSHIP_LABEL[type] || type}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Paper Types */}
                    {lender.paper_types && lender.paper_types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-3">
                        {lender.paper_types.map((type) => (
                          <span
                            key={type}
                            className={`px-2 py-0.5 text-xs rounded font-medium ${PAPER_TYPE_CONFIG[type]?.color || "bg-gray-100 text-gray-600"}`}
                          >
                            {PAPER_TYPE_CONFIG[type]?.label || type}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Lender Types */}
                    {lender.lender_types && lender.lender_types.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {lender.lender_types.slice(0, 3).map((type) => (
                          <span
                            key={type}
                            className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
                          >
                            {type.replace(/_/g, " ")}
                          </span>
                        ))}
                        {lender.lender_types.length > 3 && (
                          <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                            +{lender.lender_types.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Lender Modal */}
      <LenderEditModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSave={fetchLenders}
      />
    </div>
  );
}

// Compact MCA approval basics + HARD document requirements shown on each lender
// card — the "can I send this deal here, and what docs do they need" glance.
function ProgramSummary({ p }: { p: LenderProgram }) {
  const uw: string[] = [];
  if (p.approval_min != null || p.approval_max != null) uw.push(`${money(p.approval_min)}–${money(p.approval_max)}`);
  if (p.min_credit_score != null) uw.push(`${p.min_credit_score}+ FICO`);
  if (p.monthly_revenue_required != null) uw.push(`${money(p.monthly_revenue_required)}/mo`);
  if (p.time_in_business_months != null) uw.push(`${p.time_in_business_months}mo TIB`);
  if (p.cost_of_capital) uw.push(p.cost_of_capital);

  const docs: string[] = [];
  if (p.doc_bank_statement_months) docs.push(`${p.doc_bank_statement_months}mo bank stmts`);
  if (p.doc_application) docs.push("Application");
  if (p.doc_photo_id) docs.push("Photo ID");
  if (p.doc_voided_check) docs.push("Voided check");
  if (p.doc_proof_of_ownership) docs.push("Proof of ownership");
  if (p.doc_tax_financials === "required") docs.push("Tax return");

  if (!uw.length && !docs.length) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {uw.length > 0 && (
        <p className="text-xs text-gray-600 dark:text-gray-300 leading-snug">{uw.join(" · ")}</p>
      )}
      {docs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-0.5">Docs&nbsp;req.</span>
          {docs.map((d) => (
            <span key={d} className="inline-block px-1.5 py-0.5 text-[11px] rounded font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              {d}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Funder scoreboard ─────────────────────────
// A compact, collapsible stats strip at the top of the Lenders page: for every
// funder with ≥1 submission, how they're actually performing — submissions,
// replies, offers, accepts, funder-declines, offer win-rate, avg factor, and
// avg response time. Built from one aggregate query (getFunderScoreboard).

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const hr = ms / 3_600_000;
  if (hr < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hr < 48) return `${hr.toFixed(hr < 10 ? 1 : 0)}h`;
  return `${(hr / 24).toFixed(1)}d`;
}

// AI decline-reason category → short human label for the scoreboard.
const DECLINE_REASON_LABELS: Record<string, string> = {
  low_revenue: "Low revenue",
  industry: "Industry",
  time_in_business: "Time in business",
  credit: "Credit",
  existing_positions: "Too many positions",
  missing_docs: "Missing docs",
  state: "State",
  other: "Other",
};
const declineReasonLabel = (cat: string | null): string =>
  cat ? (DECLINE_REASON_LABELS[cat] ?? cat.replace(/_/g, " ")) : "—";

function FunderScoreboard() {
  const [rows, setRows] = useState<FunderScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [sortKey, setSortKey] = useState<string>("accepted");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    getFunderScoreboard()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the scoreboard"))
      .finally(() => setLoading(false));
  }, []);

  const valueOf = (r: FunderScore, k: string): number | string => {
    if (k === "lenderName") return r.lenderName.toLowerCase();
    if (k === "replyRate") return r.submissions ? r.replies / r.submissions : -1;
    if (k === "offerRate") return r.submissions ? r.offers / r.submissions : -1;
    if (k === "openRate") return r.submissions ? r.opens / r.submissions : -1;
    const v = (r as unknown as Record<string, number | null>)[k];
    return v == null ? -1 : v;
  };
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = valueOf(a, sortKey), bv = valueOf(b, sortKey);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir]);
  const toggleSort = (k: string) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  };
  const sortableHead = (k: string, label: string, align = "text-right") => (
    <th className={`py-2 px-2 font-semibold ${align}`}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-0.5 hover:text-ocean-blue ${sortKey === k ? "text-ocean-blue" : ""}`}>
        {label}{sortKey === k && <span className="text-[9px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  // Nothing to show until there's real submission history — stay out of the way.
  if (!loading && !error && rows.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-3 flex items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-white">
          <ChartBarIcon className="w-5 h-5 text-ocean-blue" /> Funder scoreboard
          {!loading && <span className="text-xs font-normal text-gray-400">{rows.length} active</span>}
        </span>
        <ArrowRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="px-5 pb-5">
          {loading ? (
            <p className="text-sm text-gray-400">Loading funder performance…</p>
          ) : error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="flex justify-end mb-2">
                <Link to="/admin/analytics/lenders" className="inline-flex items-center gap-1 text-xs font-semibold text-ocean-blue hover:underline">
                  Full Funder Performance dashboard (charts, per-funder detail) <ArrowRightIcon className="w-3 h-3" />
                </Link>
              </div>
              <table className="w-full text-sm min-w-[1180px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    {sortableHead("lenderName", "Funder", "text-left pr-3")}
                    {sortableHead("submissions", "Sent")}
                    {sortableHead("replies", "Replies")}
                    {sortableHead("replyRate", "Reply %")}
                    {sortableHead("offers", "Offers")}
                    {sortableHead("offerRate", "Offer %")}
                    {sortableHead("accepted", "Accepted")}
                    {sortableHead("funderDeclines", "Declines")}
                    <th className="py-2 px-2 text-left font-semibold" title="Most common AI-classified reason this funder passes on files">Top decline reason</th>
                    {sortableHead("acceptanceRate", "Win rate")}
                    {sortableHead("avgFactor", "Avg factor")}
                    {sortableHead("openRate", "Open %")}
                    {sortableHead("avgTimeToOpenMs", "Avg open")}
                    {sortableHead("avgResponseMs", "Avg response")}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => {
                    const replyRate = r.submissions ? (r.replies / r.submissions) * 100 : null;
                    const offerRate = r.submissions ? (r.offers / r.submissions) * 100 : null;
                    return (
                    <tr key={r.lenderId} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="py-2 pr-3">
                        <Link to={`/admin/lenders/${r.lenderId}`} className="font-medium text-ocean-blue hover:underline">
                          {r.lenderName}
                        </Link>
                      </td>
                      <td className="py-2 px-2 text-right text-gray-700 dark:text-gray-200">{r.submissions}</td>
                      <td className="py-2 px-2 text-right text-gray-700 dark:text-gray-200">{r.replies}</td>
                      <td className="py-2 px-2 text-right text-gray-500 dark:text-gray-400">{replyRate == null ? "—" : `${replyRate.toFixed(0)}%`}</td>
                      <td className="py-2 px-2 text-right text-gray-700 dark:text-gray-200">{r.offers}</td>
                      <td className="py-2 px-2 text-right text-gray-500 dark:text-gray-400">{offerRate == null ? "—" : `${offerRate.toFixed(0)}%`}</td>
                      <td className="py-2 px-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">{r.accepted}</td>
                      <td className="py-2 px-2 text-right text-gray-500 dark:text-gray-400">{r.funderDeclines}</td>
                      <td className="py-2 px-2 text-left">
                        {r.topDeclineReason ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                            {declineReasonLabel(r.topDeclineReason)}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-right text-gray-700 dark:text-gray-200">{r.acceptanceRate == null ? "—" : `${r.acceptanceRate.toFixed(0)}%`}</td>
                      <td className="py-2 px-2 text-right text-gray-700 dark:text-gray-200">{r.avgFactor == null ? "—" : `${r.avgFactor.toFixed(2)}x`}</td>
                      <td className="py-2 px-2 text-right text-gray-500 dark:text-gray-400">{r.submissions ? `${((r.opens / r.submissions) * 100).toFixed(0)}%` : "—"}</td>
                      <td className="py-2 px-2 text-right text-gray-700 dark:text-gray-200">{fmtDuration(r.avgTimeToOpenMs)}</td>
                      <td className="py-2 pl-2 text-right text-gray-700 dark:text-gray-200">{fmtDuration(r.avgResponseMs)}</td>
                    </tr>
                  );})}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-gray-400">
                Click any column to sort. Reply %/Offer %/Open % are of Sent; Win rate = accepted ÷ offers. <b>Avg open</b> = how fast the funder reads our submission. Only funders with ≥1 submission appear.
                <span className="text-amber-600 dark:text-amber-400"> Open metrics populate once the GHL "Email Opened → webhook" workflow is turned on (see Task Board).</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
