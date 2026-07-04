import { useEffect, useMemo, useState } from "react";
import {
  BuildingLibraryIcon,
  MagnifyingGlassIcon,
  GlobeAltIcon,
  PhoneIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  PlusIcon,
  TrashIcon,
  ArrowUturnLeftIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { mustWrite, tryWrite } from "@/supabase/writes";
import {
  FUNDERS,
  CATEGORY_LABELS,
  paperToTypes,
  type Funder,
  type FunderCategory,
} from "../../data/funderDirectory";

// lenders.status enum → friendly labels (matches LenderEditModal)
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "potential", label: "Prospect" },
  { value: "application_submitted", label: "Applied" },
  { value: "processing", label: "Processing" },
  { value: "approved", label: "Approved" },
  { value: "live_vendor", label: "Live" },
  { value: "affiliate_referral", label: "Affiliate / Referral" },
  { value: "rejected", label: "Rejected" },
  { value: "inactive", label: "Inactive" },
];

type AddState = { status: "idle" | "adding" | "added" | "error"; as?: string; msg?: string };

const CATS: (FunderCategory | "all")[] = [
  "all", "marketplace", "iso_whitelabel", "low_revenue", "mainstream", "platform", "direct",
];

const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Parse a dollar token like "$5K", "900K", "2.5M", "15,000" into a number.
function money(s: string): number | null {
  const m = s.replace(/[$,\s]/g, "").match(/^([\d.]+)([kmKM])?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const u = (m[2] || "").toLowerCase();
  if (u === "k") n *= 1_000;
  else if (u === "m") n *= 1_000_000;
  return Math.round(n);
}

// Best-effort extraction of structured underwriting fields from a criteria string,
// so the added lender record is filled in (not just name/website).
function parseCriteria(c?: string) {
  const out: {
    min_credit_score?: number;
    min_funding_amount?: number;
    max_funding_amount?: number;
    min_monthly_revenue?: number;
    min_time_in_business?: number;
  } = {};
  if (!c) return out;
  const credit =
    c.match(/credit(?:\s*score)?\s*(?:as low as|of|min[:.]?|:)?\s*(\d{3})/i) ||
    c.match(/(\d{3})\+?\s*(?:credit|fico)/i);
  if (credit) {
    const n = parseInt(credit[1], 10);
    if (n >= 300 && n <= 850) out.min_credit_score = n;
  }
  const range = c.match(/\$([\d.,]+\s*[kmKM]?)\s*[–—-]\s*\$?([\d.,]+\s*[kmKM]?)/);
  if (range) {
    const lo = money(range[1]);
    const hi = money(range[2]);
    if (lo) out.min_funding_amount = lo;
    if (hi) out.max_funding_amount = hi;
  } else {
    const upTo = c.match(/up to \$([\d.,]+\s*[kmKM]?)/i);
    if (upTo) { const v = money(upTo[1]); if (v) out.max_funding_amount = v; }
    const from = c.match(/from \$([\d.,]+\s*[kmKM]?)/i);
    if (from) { const v = money(from[1]); if (v) out.min_funding_amount = v; }
  }
  const rev = c.match(/\$([\d.,]+\s*[kK]?)\+?\s*\/?\s*mo\b/i);
  if (rev) { const v = money(rev[1]); if (v) out.min_monthly_revenue = v; }
  const moM = c.match(/(\d+)\+?\s*(?:mo\b|months?\b)/i);
  const yrM = c.match(/(\d+)\+?\s*(?:yr\b|years?\b)/i);
  if (moM) out.min_time_in_business = parseInt(moM[1], 10);
  else if (yrM) out.min_time_in_business = parseInt(yrM[1], 10) * 12;
  return out;
}

function Chip({ label, tone }: { label: string; tone: string }) {
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${tone}`}>{label}</span>;
}

export default function FunderDirectoryPage() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<FunderCategory | "all">("all");
  const [onlyLowRev, setOnlyLowRev] = useState(false);
  const [onlyWhiteLabel, setOnlyWhiteLabel] = useState(false);
  const [onlyApplyOnce, setOnlyApplyOnce] = useState(false);
  const [onlyIso, setOnlyIso] = useState(false);
  const [hideDead, setHideDead] = useState(false);
  const [hideInSystem, setHideInSystem] = useState(false);
  const [pickStatus, setPickStatus] = useState<Record<string, string>>({});
  const [addState, setAddState] = useState<Record<string, AddState>>({});
  const [liveLenders, setLiveLenders] = useState<{ n: string; status: string }[]>([]); // normalized name + lender status
  const [dbLenders, setDbLenders] = useState<Array<Record<string, unknown>>>([]); // full lender rows (so every lender shows in the directory)
  const [hidden, setHidden] = useState<string[]>([]); // funder_directory_hidden.funder_name (junk removed)
  const [notes, setNotes] = useState<Record<string, string>>({}); // funder_name → research note
  const [noteEditor, setNoteEditor] = useState<string | null>(null); // which funder's note is open
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [confirmHide, setConfirmHide] = useState<Record<string, boolean>>({});

  // Removed (junk) funders — persisted so removals stick for everyone.
  useEffect(() => {
    let alive = true;
    supabase
      .from("funder_directory_hidden")
      .select("funder_name")
      .then(({ data }) => {
        if (alive && data) setHidden(data.map((r: { funder_name: string }) => r.funder_name));
      });
    return () => { alive = false; };
  }, []);

  // Load research notes.
  useEffect(() => {
    let alive = true;
    supabase
      .from("funder_directory_notes")
      .select("funder_name, note")
      .then(({ data }) => {
        if (alive && data) {
          const m: Record<string, string> = {};
          for (const r of data as { funder_name: string; note: string }[]) m[r.funder_name] = r.note;
          setNotes(m);
        }
      });
    return () => { alive = false; };
  }, []);

  function openNote(name: string) {
    setNoteDraft(notes[name] ?? "");
    setNoteEditor(name);
  }
  async function saveNote(name: string) {
    setNoteSaving(true);
    try {
      const note = noteDraft.trim();
      if (note) {
        await mustWrite(
          "save funder note",
          supabase.from("funder_directory_notes").upsert(
            { funder_name: name, note, updated_at: new Date().toISOString() },
            { onConflict: "funder_name" },
          ),
        );
        setNotes((n) => ({ ...n, [name]: note }));
      } else {
        // cleared → delete the row (may affect 0 rows, so tryWrite)
        await tryWrite("clear funder note", supabase.from("funder_directory_notes").delete().eq("funder_name", name));
        setNotes((n) => { const next = { ...n }; delete next[name]; return next; });
      }
      setNoteEditor(null);
    } finally {
      setNoteSaving(false);
    }
  }

  // Live check against the lenders table so anything already added shows "In system".
  useEffect(() => {
    let alive = true;
    supabase
      .from("lenders")
      .select("id, company_name, status, website, paper_types, partnership_types, lender_types, min_funding_amount, max_funding_amount, min_credit_score, min_monthly_revenue, factor_rate_range, notes, submission_portal_url, primary_contact_phone")
      .then(({ data }) => {
        if (alive && data) {
          setDbLenders(data as Array<Record<string, unknown>>);
          setLiveLenders(
            data
              .map((r: { company_name: string; status: string }) => ({ n: norm(r.company_name), status: r.status }))
              .filter((x) => x.n),
          );
        }
      });
    return () => { alive = false; };
  }, []);

  const liveMatch = (f: Funder) => {
    const fn = norm(f.name);
    if (fn.length < 4) return undefined;
    return liveLenders.find((l) => l.n === fn || l.n.includes(fn) || fn.includes(l.n));
  };
  const isInSystem = (f: Funder) => f.inSystem || !!liveMatch(f);
  const statusOf = (f: Funder) => liveMatch(f)?.status; // live lender status, or undefined (static-only)

  // Every lender in the DB must appear in the directory. Build a synthetic Funder
  // row for each lender not already represented by a static directory entry.
  const syntheticFunders = useMemo<Funder[]>(() => {
    const staticNames = FUNDERS.map((f) => norm(f.name));
    const out: Funder[] = [];
    for (const l of dbLenders) {
      const name = String(l.company_name ?? "");
      const nn = norm(name);
      if (nn.length < 3) continue;
      if (staticNames.some((sn) => sn === nn || sn.includes(nn) || nn.includes(sn))) continue; // already represented
      const pt = (l.partnership_types as string[] | null) ?? [];
      const paperArr = (l.paper_types as string[] | null) ?? [];
      const letters = paperArr.map((p) => p[0]?.toUpperCase()).filter(Boolean) as string[];
      const paper = letters.length ? `${letters[0]}${letters.length > 1 ? "-" + letters[letters.length - 1] : ""}` : undefined;
      const lowRev = paperArr.includes("c_paper") || paperArr.includes("d_paper");
      const category: FunderCategory = pt.includes("marketplace") ? "marketplace" : pt.includes("white_label") ? "iso_whitelabel" : lowRev ? "low_revenue" : "direct";
      const crumbs: string[] = [];
      const mn = l.min_funding_amount as number | null, mx = l.max_funding_amount as number | null;
      if (mn || mx) crumbs.push(`$${Number(mn || 0).toLocaleString()}–$${Number(mx || 0).toLocaleString()}`);
      if (l.min_credit_score != null) crumbs.push(`${l.min_credit_score}+ FICO`);
      if (l.min_monthly_revenue != null) crumbs.push(`$${Number(l.min_monthly_revenue).toLocaleString()}/mo`);
      if (l.factor_rate_range) crumbs.push(String(l.factor_rate_range));
      out.push({
        name, category, paper, lowRev,
        whiteLabel: pt.includes("white_label"),
        applyOnce: pt.includes("marketplace"),
        isoProgram: true,
        website: (l.website as string) || undefined,
        applyUrl: (l.submission_portal_url as string) || undefined,
        phone: (l.primary_contact_phone as string) || undefined,
        criteria: crumbs.join(" · ") || (l.notes ? String(l.notes).slice(0, 140) : undefined),
        verified: "active",
        inSystem: true,
      });
    }
    return out;
  }, [dbLenders]);
  const allFunders = useMemo(() => [...FUNDERS, ...syntheticFunders], [syntheticFunders]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allFunders.filter((f) => {
      if (showRemoved ? !hidden.includes(f.name) : hidden.includes(f.name)) return false;
      if (cat !== "all" && f.category !== cat) return false;
      if (onlyLowRev && !f.lowRev) return false;
      if (onlyWhiteLabel && !f.whiteLabel) return false;
      if (onlyApplyOnce && !f.applyOnce) return false;
      if (onlyIso && !f.isoProgram) return false;
      if (hideDead && f.verified === "dead") return false;
      if (hideInSystem && isInSystem(f)) return false;
      if (needle) {
        const hay = `${f.name} ${f.criteria ?? ""} ${f.notes ?? ""} ${f.paper ?? ""} ${CATEGORY_LABELS[f.category]}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, cat, onlyLowRev, onlyWhiteLabel, onlyApplyOnce, onlyIso, hideDead, hideInSystem, liveLenders, hidden, showRemoved, allFunders]);

  const deadCount = useMemo(() => allFunders.filter((f) => f.verified === "dead").length, [allFunders]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inSystemCount = useMemo(() => allFunders.filter((f) => isInSystem(f)).length, [liveLenders, allFunders]);

  async function addToLenders(f: Funder) {
    const key = f.name;
    const status = pickStatus[key] || "potential";
    setAddState((s) => ({ ...s, [key]: { status: "adding" } }));
    try {
      const flags = [
        f.lowRev && "Low-revenue",
        f.whiteLabel && "White-label",
        f.applyOnce && "Apply-once (one app → many)",
        f.isoProgram && "ISO/partner program",
      ].filter(Boolean).join(", ");
      const notes = [
        `Category: ${CATEGORY_LABELS[f.category]}`,
        f.paper ? `Paper grade: ${f.paper}` : "",
        f.criteria ? `Criteria: ${f.criteria}` : "",
        flags ? `Flags: ${flags}` : "",
        f.verified ? `Site check: ${f.verified}` : "",
        f.website ? `Website: ${f.website}` : "",
      ].filter(Boolean).join("\n");
      const submissionNotes = [
        f.applyUrl ? `Broker/ISO apply: ${f.applyUrl}` : "",
        f.phone ? `Phone: ${f.phone}` : "",
      ].filter(Boolean).join("\n");
      const parsed = parseCriteria(f.criteria);
      const partnership: string[] = [];
      if (f.whiteLabel) partnership.push("white_label");
      if (f.applyOnce) partnership.push("marketplace");
      if (f.isoProgram) partnership.push("broker_iso");
      if (/affiliate|referral/i.test(`${f.criteria ?? ""} ${f.notes ?? ""}`)) partnership.push("referral");
      if (!partnership.length) partnership.push("direct");
      await mustWrite(
        "add funder to lenders",
        supabase.from("lenders").insert({
          company_name: f.name,
          website: f.website ?? null,
          lender_types: ["mca"],
          partnership_types: partnership,
          paper_types: paperToTypes(f.paper),
          primary_contact_phone: f.phone ?? null,
          min_credit_score: parsed.min_credit_score ?? null,
          min_funding_amount: parsed.min_funding_amount ?? null,
          max_funding_amount: parsed.max_funding_amount ?? null,
          min_monthly_revenue: parsed.min_monthly_revenue ?? null,
          min_time_in_business: parsed.min_time_in_business ?? null,
          status,
          submission_notes: submissionNotes || null,
          notes: notes || null,
        }),
      );
      setLiveLenders((prev) => (prev.some((l) => l.n === norm(f.name)) ? prev : [...prev, { n: norm(f.name), status }]));
      setAddState((s) => ({
        ...s,
        [key]: { status: "added", as: STATUS_OPTIONS.find((o) => o.value === status)?.label },
      }));
    } catch (e) {
      setAddState((s) => ({ ...s, [key]: { status: "error", msg: e instanceof Error ? e.message : "Failed" } }));
    }
  }

  async function handleHide(f: Funder) {
    if (!confirmHide[f.name]) { setConfirmHide((s) => ({ ...s, [f.name]: true })); return; }
    const ok = await tryWrite(
      "hide funder",
      supabase.from("funder_directory_hidden").insert({ funder_name: f.name }),
    );
    if (ok) setHidden((h) => (h.includes(f.name) ? h : [...h, f.name]));
    setConfirmHide((s) => ({ ...s, [f.name]: false }));
  }
  async function handleRestore(f: Funder) {
    // Delete-if-any: restoring a funder that isn't currently hidden legitimately
    // affects 0 rows, so tryWrite (no row assertion) rather than mustWrite.
    const ok = await tryWrite(
      "restore funder",
      supabase.from("funder_directory_hidden").delete().eq("funder_name", f.name),
    );
    if (ok) setHidden((h) => h.filter((n) => n !== f.name));
  }

  const toggleCls = (on: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
      on ? "bg-ocean-blue text-white border-ocean-blue" : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-ocean-blue"
    }`;

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-8">
      <div className="flex items-start gap-3 mb-2">
        <BuildingLibraryIcon className="w-8 h-8 text-mint-green flex-shrink-0" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Funder Partnership Directory</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-1">
            Research list of funders to partner with — marketplaces, ISO/white-label programs, low-revenue/subprime
            specialists, and direct funders. Eyeball the details, then use <b>Add to lenders</b> and pick the status
            (Prospect, Applied, Live…) — it lands in that exact section. Nothing is written until you click.
          </p>
        </div>
      </div>

      <div className="bg-ocean-blue/5 dark:bg-ocean-blue/10 border border-ocean-blue/20 rounded-xl p-3 mb-5 text-sm text-gray-700 dark:text-gray-300">
        <b>For your "declined for low revenue" problem:</b> filter <b>Low-revenue</b> — those funders take C/D paper
        (weak credit / low revenue / thin files). "Apply-once" = one application reaches many funders. "White-label" =
        fund under your own brand.
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <MagnifyingGlassIcon className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search funders…"
            className="pl-9 pr-3 py-2 w-64 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm outline-none focus:border-ocean-blue"
          />
        </div>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value as FunderCategory | "all")}
          className="py-2 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm outline-none focus:border-ocean-blue"
        >
          {CATS.map((c) => (
            <option key={c} value={c}>{c === "all" ? "All categories" : CATEGORY_LABELS[c as FunderCategory]}</option>
          ))}
        </select>
        <button className={toggleCls(onlyLowRev)} onClick={() => setOnlyLowRev((v) => !v)}>Low-revenue</button>
        <button className={toggleCls(onlyApplyOnce)} onClick={() => setOnlyApplyOnce((v) => !v)}>Apply-once</button>
        <button className={toggleCls(onlyWhiteLabel)} onClick={() => setOnlyWhiteLabel((v) => !v)}>White-label</button>
        <button className={toggleCls(onlyIso)} onClick={() => setOnlyIso((v) => !v)}>ISO program</button>
        <button className={toggleCls(hideDead)} onClick={() => setHideDead((v) => !v)}>Hide dead ({deadCount})</button>
        <button className={toggleCls(hideInSystem)} onClick={() => setHideInSystem((v) => !v)}>Hide in-system ({inSystemCount})</button>
        <button className={toggleCls(showRemoved)} onClick={() => setShowRemoved((v) => !v)}>{showRemoved ? "Viewing removed" : "Removed"} ({hidden.length})</button>
        <span className="ml-auto text-sm text-gray-500">{rows.length} of {FUNDERS.length} funders</span>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <th className="py-3 px-4 font-semibold">Funder</th>
              <th className="py-3 px-2 font-semibold">Category</th>
              <th className="py-3 px-2 font-semibold">Paper</th>
              <th className="py-3 px-2 font-semibold">Flags</th>
              <th className="py-3 px-2 font-semibold">Criteria / notes</th>
              <th className="py-3 px-2 font-semibold">Broker apply</th>
              <th className="py-3 px-4 font-semibold text-right">Add to lenders</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const st = addState[f.name];
              const inSys = isInSystem(f);
              const sysStatus = STATUS_OPTIONS.find((o) => o.value === statusOf(f))?.label;
              return (
                <tr key={f.name} className="border-b border-gray-100 dark:border-gray-700/50 align-top">
                  <td className="py-3 px-4">
                    <p className="font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">
                      {f.verified === "dead" && <span title="No live site found — likely defunct" className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />}
                      {f.verified === "active" && <span title="Verified live" className="w-2 h-2 rounded-full bg-mint-green flex-shrink-0" />}
                      {f.verified === "uncertain" && <span title="Unverified" className="w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />}
                      {f.name}
                    </p>
                    <div className="flex flex-col gap-0.5 mt-1">
                      {f.website && (
                        <a href={f.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-ocean-blue hover:underline">
                          <GlobeAltIcon className="w-3.5 h-3.5" />{f.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                        </a>
                      )}
                      {f.phone && (
                        <a href={`tel:${f.phone}`} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-300 hover:text-ocean-blue">
                          <PhoneIcon className="w-3.5 h-3.5" />{f.phone}
                        </a>
                      )}
                    </div>
                    {/* Research notes — jot "did I apply? what did they say?" */}
                    {noteEditor === f.name ? (
                      <div className="mt-1.5">
                        <textarea
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          rows={3}
                          autoFocus
                          placeholder="e.g. Hit Apply 7/4 — unsure if it submitted, following up…"
                          className="w-full text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-gray-900 dark:text-white"
                        />
                        <div className="flex items-center gap-2 mt-1">
                          <button onClick={() => saveNote(f.name)} disabled={noteSaving} className="text-[11px] font-semibold px-2 py-0.5 rounded bg-ocean-blue text-white hover:opacity-90 disabled:opacity-50">Save</button>
                          <button onClick={() => setNoteEditor(null)} className="text-[11px] text-gray-500 hover:text-gray-700">Cancel</button>
                        </div>
                      </div>
                    ) : notes[f.name] ? (
                      <button onClick={() => openNote(f.name)} className="mt-1.5 flex items-start gap-1 text-left text-[11px] text-amber-700 dark:text-amber-300 hover:underline">
                        <PencilSquareIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span className="whitespace-pre-wrap">{notes[f.name]}</span>
                      </button>
                    ) : (
                      <button onClick={() => openNote(f.name)} className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-ocean-blue">
                        <PencilSquareIcon className="w-3.5 h-3.5" /> Add note
                      </button>
                    )}
                  </td>
                  <td className="py-3 px-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{CATEGORY_LABELS[f.category]}</td>
                  <td className="py-3 px-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{f.paper ?? "—"}</td>
                  <td className="py-3 px-2">
                    <div className="flex flex-wrap gap-1 max-w-[130px]">
                      {inSys && <Chip label={sysStatus ? `In system · ${sysStatus}` : "In system"} tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" />}
                      {f.lowRev && <Chip label="Low-rev" tone="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" />}
                      {f.applyOnce && <Chip label="Apply-once" tone="bg-mint-green/15 text-mint-green" />}
                      {f.whiteLabel && <Chip label="White-label" tone="bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" />}
                      {f.isoProgram && <Chip label="ISO" tone="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" />}
                    </div>
                  </td>
                  <td className="py-3 px-2 text-xs text-gray-500 dark:text-gray-400 max-w-[280px]">{f.criteria || f.notes || "—"}</td>
                  <td className="py-3 px-2">
                    {f.applyUrl ? (
                      <a href={f.applyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ocean-blue hover:underline">
                        Apply <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {showRemoved ? (
                      <button
                        onClick={() => handleRestore(f)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-mint-green hover:underline"
                      >
                        <ArrowUturnLeftIcon className="w-4 h-4" /> Restore
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 justify-end">
                        {st?.status === "added" ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-mint-green">
                            <CheckCircleIcon className="w-4 h-4" /> Added as {st.as}
                          </span>
                        ) : inSys ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
                            <CheckCircleIcon className="w-4 h-4" /> In system{sysStatus ? ` · ${sysStatus}` : ""}
                          </span>
                        ) : (
                          <div className="flex items-center gap-1">
                            <select
                              value={pickStatus[f.name] || "potential"}
                              onChange={(e) => setPickStatus((s) => ({ ...s, [f.name]: e.target.value }))}
                              className="py-1 px-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-xs outline-none"
                            >
                              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <button
                              onClick={() => addToLenders(f)}
                              disabled={st?.status === "adding"}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-ocean-blue text-white text-xs font-semibold hover:opacity-90 disabled:opacity-60"
                            >
                              <PlusIcon className="w-3.5 h-3.5" />{st?.status === "adding" ? "Adding…" : "Add"}
                            </button>
                          </div>
                        )}
                        <button
                          onClick={() => handleHide(f)}
                          onBlur={() => setConfirmHide((s) => ({ ...s, [f.name]: false }))}
                          title="Remove from directory (junk)"
                          className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-xs font-medium ${
                            confirmHide[f.name] ? "bg-red-600 text-white" : "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                          }`}
                        >
                          <TrashIcon className="w-3.5 h-3.5" />{confirmHide[f.name] ? "Confirm" : ""}
                        </button>
                      </div>
                    )}
                    {st?.status === "error" && <p className="text-[10px] text-red-500 mt-1 text-right">{st.msg}</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
