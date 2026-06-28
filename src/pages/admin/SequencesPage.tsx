import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowPathRoundedSquareIcon } from "@heroicons/react/24/outline";
import { getEnrollments, SEQUENCES, type SequenceEnrollment } from "../../services/followUpService";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  completed: "bg-gray-100 text-gray-500 dark:bg-gray-700",
  stopped: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

function entityLink(e: SequenceEnrollment): string | null {
  if (e.entity_type === "deal") return `/admin/deals/${e.entity_id}`;
  if (e.entity_type === "customer") return `/admin/customers/${e.entity_id}`;
  return null;
}

export default function SequencesPage() {
  const [rows, setRows] = useState<SequenceEnrollment[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getEnrollments(activeOnly).then(setRows).catch(() => setRows([])).finally(() => setLoading(false));
  }, [activeOnly]);

  const countByKey = (key: string) => rows.filter((r) => r.sequence_key === key).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ArrowPathRoundedSquareIcon className="w-6 h-6 text-ocean-blue" /> Follow-up Sequences
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Who's enrolled in each GHL follow-up sequence (A–F).</p>
        </div>
        <label className="text-sm text-gray-500 flex items-center gap-2">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
        </label>
      </div>

      {/* Per-sequence summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {SEQUENCES.map((s) => (
          <div key={s.key} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4" title={s.blurb}>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{countByKey(s.key)}</div>
            <div className="text-xs font-medium text-gray-700 dark:text-gray-200">Seq {s.key}</div>
            <div className="text-[11px] text-gray-400 leading-tight">{s.label}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <p className="text-gray-500">No {activeOnly ? "active " : ""}enrollments. They appear here as contacts enter GHL sequences (recorded via sync).</p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="py-3 px-4">Entity</th><th className="py-3 px-4">Sequence</th><th className="py-3 px-4">Step</th>
                <th className="py-3 px-4">Status</th><th className="py-3 px-4">Enrolled</th><th className="py-3 px-4">Last action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const href = entityLink(e);
                return (
                  <tr key={e.id} className="border-b border-gray-50 dark:border-gray-800">
                    <td className="py-2.5 px-4">
                      {href ? <Link to={href} className="text-ocean-blue hover:underline">{e.entity_type}</Link> : <span className="text-gray-500">{e.entity_type}</span>}
                    </td>
                    <td className="py-2.5 px-4 text-gray-900 dark:text-white">{e.sequence_label || `Seq ${e.sequence_key}`}</td>
                    <td className="py-2.5 px-4 text-gray-500">{e.current_step ?? "—"}</td>
                    <td className="py-2.5 px-4"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[e.status] ?? "bg-gray-100 text-gray-500"}`}>{e.status}</span></td>
                    <td className="py-2.5 px-4 text-gray-500">{e.enrolled_at ? new Date(e.enrolled_at).toLocaleDateString() : "—"}</td>
                    <td className="py-2.5 px-4 text-gray-500">{e.last_action_at ? new Date(e.last_action_at).toLocaleDateString() : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
