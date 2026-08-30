// Data Hygiene — build saved audiences ("smart lists") from the UCC / purchased /
// CRM books, then clean them (BatchData skip-trace, Apollo enrich, Twilio phone
// validation) so the dial floor only works reachable, dialable numbers.
//
// Three tabs: (1) Build a smart list, (2) Saved smart lists, (3) a selected list's
// detail — member table + action bar + provider balances + TCPA/DNC panel.
//
// Compliance: internal surface, but still never "loan" — MCA positions are advances.

import { useCallback, useEffect, useState } from "react";
import {
  CircleStackIcon,
  PlusIcon,
  Squares2X2Icon,
  ArrowPathIcon,
  ExclamationTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  TrashIcon,
  ArrowLeftIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { mustWrite } from "@/supabase/writes";
import SmartListBuilder from "@/components/admin/hygiene/SmartListBuilder";
import SmartListActions from "@/components/admin/hygiene/SmartListActions";
import ProviderBalanceStrip from "@/components/admin/hygiene/ProviderBalanceStrip";
import TcpaStatusPanel from "@/components/admin/hygiene/TcpaStatusPanel";
import {
  SOURCE_META,
  LINE_TYPE_META,
  fmtRelative,
  isMissingRelation,
  type SmartList,
  type SmartListMember,
  type SmartListSource,
} from "@/components/admin/hygiene/hygiene";

type Tab = "build" | "saved" | "detail";
const MEMBER_PAGE = 25;

function sourceChip(source: SmartListSource | null) {
  if (source && source !== "mixed" && SOURCE_META[source]) {
    const m = SOURCE_META[source];
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${m.chip}`}>{m.label}</span>;
  }
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300">{source ?? "—"}</span>;
}

export default function DataHygienePage() {
  const [tab, setTab] = useState<Tab>("saved");
  const [lists, setLists] = useState<SmartList[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);
  const [backendMissing, setBackendMissing] = useState(false);
  const [selected, setSelected] = useState<SmartList | null>(null);

  const loadLists = useCallback(async () => {
    setLoadingLists(true);
    setListErr(null);
    const { data, error } = await supabase
      .from("smart_lists")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingRelation(error)) {
        setBackendMissing(true);
        setLists([]);
      } else {
        setListErr(error.message);
      }
      setLoadingLists(false);
      return;
    }
    setBackendMissing(false);
    setLists((data as SmartList[]) ?? []);
    setLoadingLists(false);
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const openList = useCallback((list: SmartList) => {
    setSelected(list);
    setTab("detail");
  }, []);

  const handleSaved = useCallback(
    (list: SmartList) => {
      setLists((prev) => [list, ...prev.filter((l) => l.id !== list.id)]);
      openList(list);
    },
    [openList],
  );

  const deleteList = useCallback(
    async (list: SmartList) => {
      await mustWrite("delete smart_list", supabase.from("smart_lists").delete().eq("id", list.id));
      setLists((prev) => prev.filter((l) => l.id !== list.id));
      if (selected?.id === list.id) {
        setSelected(null);
        setTab("saved");
      }
    },
    [selected],
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <CircleStackIcon className="w-6 h-6 text-mint-green" /> Data Hygiene
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Build a saved audience from the UCC, purchased, or CRM books — then skip-trace, enrich, and validate the
            phones so the floor dials only what's reachable.
          </p>
        </div>
        <button onClick={loadLists} disabled={loadingLists} className="inline-flex items-center gap-2 text-sm text-ocean-blue hover:underline disabled:opacity-50">
          <ArrowPathIcon className={`w-4 h-4 ${loadingLists ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200 dark:border-gray-700">
        <TabButton active={tab === "build"} onClick={() => setTab("build")} icon={<PlusIcon className="w-4 h-4" />}>
          Build smart list
        </TabButton>
        <TabButton active={tab === "saved"} onClick={() => setTab("saved")} icon={<Squares2X2Icon className="w-4 h-4" />}>
          Saved smart lists{lists.length > 0 ? ` (${lists.length})` : ""}
        </TabButton>
        {selected && (
          <TabButton active={tab === "detail"} onClick={() => setTab("detail")} icon={<CircleStackIcon className="w-4 h-4" />}>
            {selected.name}
          </TabButton>
        )}
      </div>

      {backendMissing && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm text-amber-800 dark:text-amber-200 flex gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
          <span>The Data Hygiene tables aren't deployed yet (smart_lists not found). Apply the backend migration, then refresh.</span>
        </div>
      )}

      {/* ── Tab: Build ── */}
      {tab === "build" && <SmartListBuilder onSaved={handleSaved} />}

      {/* ── Tab: Saved ── */}
      {tab === "saved" && (
        <SavedLists
          lists={lists}
          loading={loadingLists}
          error={listErr}
          onOpen={openList}
          onDelete={deleteList}
          onBuild={() => setTab("build")}
        />
      )}

      {/* ── Tab: Detail ── */}
      {tab === "detail" && selected && (
        <ListDetail
          list={selected}
          onBack={() => setTab("saved")}
          onRefreshList={loadLists}
        />
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-mint-green text-mint-green"
          : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
      }`}
    >
      {icon}
      <span className="max-w-[16rem] truncate">{children}</span>
    </button>
  );
}

function SavedLists({
  lists,
  loading,
  error,
  onOpen,
  onDelete,
  onBuild,
}: {
  lists: SmartList[];
  loading: boolean;
  error: string | null;
  onOpen: (l: SmartList) => void;
  onDelete: (l: SmartList) => Promise<void>;
  onBuild: () => void;
}) {
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  useEffect(() => {
    if (!armedDelete) return;
    const t = setTimeout(() => setArmedDelete(null), 5000);
    return () => clearTimeout(t);
  }, [armedDelete]);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-900/20 p-4 text-sm text-rose-700 dark:text-rose-300">
        Couldn't load smart lists: {error}
      </div>
    );
  }
  if (loading) return <p className="text-sm text-gray-400">Loading smart lists…</p>;
  if (lists.length === 0) {
    return (
      <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <p className="text-gray-500 dark:text-gray-400">No smart lists yet.</p>
        <button onClick={onBuild} className="btn-primary btn-sm mt-3 inline-flex items-center gap-1.5">
          <PlusIcon className="w-4 h-4" /> Build your first smart list
        </button>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {lists.map((l) => (
        <div key={l.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <button onClick={() => onOpen(l)} className="min-w-0 text-left">
              <p className="font-semibold text-gray-900 dark:text-white truncate hover:text-mint-green">{l.name}</p>
              {l.description && <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{l.description}</p>}
            </button>
            {sourceChip(l.source)}
          </div>
          <div className="flex items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
            <span>
              <strong className="text-gray-800 dark:text-gray-200 tabular-nums">{(l.member_count ?? 0).toLocaleString()}</strong> members
            </span>
            <span>refreshed {fmtRelative(l.last_refreshed_at)}</span>
          </div>
          <div className="mt-auto flex items-center justify-between gap-2">
            <button onClick={() => onOpen(l)} className="btn-ghost btn-sm inline-flex items-center gap-1.5">
              Open <ChevronRightIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => (armedDelete === l.id ? onDelete(l) : setArmedDelete(l.id))}
              className={`text-xs inline-flex items-center gap-1 ${
                armedDelete === l.id ? "text-rose-700 dark:text-rose-300 font-semibold" : "text-gray-400 hover:text-rose-600"
              }`}
              title="Delete this smart list"
            >
              <TrashIcon className="w-4 h-4" /> {armedDelete === l.id ? "Confirm delete" : "Delete"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ListDetail({ list, onBack, onRefreshList }: { list: SmartList; onBack: () => void; onRefreshList: () => void }) {
  const [members, setMembers] = useState<SmartListMember[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const from = page * MEMBER_PAGE;
    const { data, error: err, count } = await supabase
      .from("smart_list_members")
      .select("*", { count: "exact" })
      .eq("smart_list_id", list.id)
      .order("created_at", { ascending: true })
      .range(from, from + MEMBER_PAGE - 1);
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setMembers((data as SmartListMember[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [list.id, page]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // After a spend run, refresh the member table (validation chips) + list card counts.
  const handleChanged = useCallback(() => {
    loadMembers();
    onRefreshList();
  }, [loadMembers, onRefreshList]);

  const totalPages = total != null ? Math.max(1, Math.ceil(total / MEMBER_PAGE)) : 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-ocean-blue hover:underline">
          <ArrowLeftIcon className="w-4 h-4" /> All smart lists
        </button>
        <div className="flex items-center gap-2">
          {sourceChip(list.source)}
          <span className="text-xs text-gray-500 dark:text-gray-400">
            <strong className="text-gray-800 dark:text-gray-200 tabular-nums">{(list.member_count ?? 0).toLocaleString()}</strong> members
          </span>
        </div>
      </div>

      {list.description && <p className="text-sm text-gray-600 dark:text-gray-300">{list.description}</p>}

      {/* Provider balances (shared with System Health). */}
      <ProviderBalanceStrip variant="page" />

      {/* Action bar — skip-trace / enrich / validate. */}
      <SmartListActions list={list} onChanged={handleChanged} />

      {/* TCPA / DNC dialability. */}
      <TcpaStatusPanel list={list} />

      {/* Member table. */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">Members</h3>
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {total != null && <span>{total.toLocaleString()} total</span>}
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40">
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <span>
              {page + 1} / {totalPages}
            </span>
            <button onClick={() => setPage((p) => (p + 1 < totalPages ? p + 1 : p))} disabled={page + 1 >= totalPages || loading} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40">
              <ChevronRightIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
        {error ? (
          <p className="p-4 text-sm text-rose-600 dark:text-rose-400">Couldn't load members: {error}</p>
        ) : loading && members.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">Loading members…</p>
        ) : members.length === 0 ? (
          <p className="p-4 text-sm text-gray-400">No members.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-2.5 px-4">Business</th>
                  <th className="py-2.5 px-4">Contact</th>
                  <th className="py-2.5 px-4">Phone</th>
                  <th className="py-2.5 px-4">Email</th>
                  <th className="py-2.5 px-4">Location</th>
                  <th className="py-2.5 px-4">Line type</th>
                  <th className="py-2.5 px-4">Validated</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const s = m.snapshot ?? {};
                  const lt = (m.line_type ?? "").toLowerCase();
                  const ltMeta = LINE_TYPE_META[lt];
                  return (
                    <tr key={m.id} className="border-b border-gray-50 dark:border-gray-800">
                      <td className="py-2.5 px-4 text-gray-900 dark:text-white">{s.business || "—"}</td>
                      <td className="py-2.5 px-4 text-gray-600 dark:text-gray-300">{s.contact || "—"}</td>
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {s.phone ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className={m.phone_reachable === false ? "text-gray-400 line-through" : "text-gray-900 dark:text-gray-100"}>{s.phone}</span>
                            {m.phone_reachable === false && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-semibold">unreachable</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-gray-600 dark:text-gray-300 max-w-[16rem] truncate">{s.email || "—"}</td>
                      <td className="py-2.5 px-4 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {[s.city, s.state].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="py-2.5 px-4">
                        {m.line_type ? (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ltMeta ? ltMeta.chip : "bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300"}`}>
                            {ltMeta ? ltMeta.label : m.line_type}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                        {m.phone_validated_at ? fmtRelative(m.phone_validated_at) : <span className="text-gray-400">not yet</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
