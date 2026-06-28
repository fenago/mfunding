import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  WrenchScrewdriverIcon,
  CalculatorIcon,
  ClipboardDocumentCheckIcon,
  ClipboardIcon,
  CheckIcon,
  ArrowTopRightOnSquareIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import supabase from '../../supabase';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
type Category = 'calculator' | 'assessment';
type Intake = 'mca' | 'vcf' | 'contact' | 'conditional';

interface LeadTool {
  key: string;
  name: string;
  category: Category;
  path: string;
  intake: Intake;
  description: string | null;
  enabled: boolean;
  sort_order: number;
}

// Short, distinctive phrase used to approximate how many leads each tool
// generated. Best-effort only — matched against deals.lead_source_detail
// (ILIKE %phrase%). The closer-earnings tool is special-cased to count
// contact_submissions where subject ILIKE '%closer%'.
const COUNT_KEYWORD: Record<string, string> = {
  'vcf-savings': 'VCF',
  'mca-funding': 'Funding calculator',
  'mca-cost': 'Cost calculator',
  'funding-readiness': 'Readiness',
  'funding-matcher': 'Find Your Funding',
  'funding-affordability': 'How Much Can You Handle',
  'mca-debt-stress': 'Stress Test',
  'relief-qualifier': 'qualify for relief',
  'business-health': 'Business Health',
  'cashflow-gap': 'Cash Flow Gap',
};

const INTAKE_BADGE: Record<Intake, { label: string; cls: string }> = {
  mca: { label: 'MCA', cls: 'bg-mint-green/15 text-teal border-mint-green/30' },
  vcf: { label: 'VCF', cls: 'bg-purple-100 text-purple-700 border-purple-200' },
  contact: { label: 'Contact', cls: 'bg-ocean-blue/10 text-ocean-blue border-ocean-blue/20' },
  conditional: { label: 'Conditional', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
};

// ----------------------------------------------------------------------------
// Lead count: best-effort, resilient. Returns a number or null ("—").
// ----------------------------------------------------------------------------
async function fetchLeadCount(tool: LeadTool): Promise<number | null> {
  try {
    if (tool.key === 'closer-earnings') {
      const { count, error } = await supabase
        .from('contact_submissions')
        .select('id', { count: 'exact', head: true })
        .ilike('subject', '%closer%');
      if (error) return null;
      return count ?? 0;
    }
    const keyword = COUNT_KEYWORD[tool.key];
    if (!keyword) return null;
    const { count, error } = await supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .ilike('lead_source_detail', '%' + keyword + '%');
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Toggle switch (matches admin styling)
// ----------------------------------------------------------------------------
function Toggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      aria-pressed={enabled}
      className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
        enabled ? 'bg-mint-green' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <motion.div
        className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md"
        animate={{ left: enabled ? '1.75rem' : '0.25rem' }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />
    </button>
  );
}

// ----------------------------------------------------------------------------
// Single tool row
// ----------------------------------------------------------------------------
function ToolRow({
  tool,
  count,
  onToggle,
  saving,
  savedAt,
}: {
  tool: LeadTool;
  count: number | null | undefined;
  onToggle: (tool: LeadTool) => void;
  saving: boolean;
  savedAt: number | null;
}) {
  const [copied, setCopied] = useState(false);
  const url = (typeof window !== 'undefined' ? window.location.origin : '') + tool.path;
  const badge = INTAKE_BADGE[tool.intake];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className={`bg-white rounded-2xl p-5 shadow-sm border transition-colors ${
        tool.enabled ? 'border-gray-100' : 'border-gray-200 bg-gray-50/60'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`font-semibold ${tool.enabled ? 'text-midnight-blue' : 'text-gray-500'}`}>
              {tool.name}
            </h3>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${badge.cls}`}>
              {badge.label}
            </span>
            {!tool.enabled && (
              <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-gray-200 text-gray-500">
                Hidden
              </span>
            )}
          </div>
          {tool.description && (
            <p className="text-sm text-gray-500 mt-1">{tool.description}</p>
          )}

          {/* Public URL + copy */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-mono text-ocean-blue hover:underline break-all"
            >
              {url}
              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5 flex-shrink-0" />
            </a>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {copied ? (
                <>
                  <CheckIcon className="w-3.5 h-3.5 text-mint-green" /> Copied
                </>
              ) : (
                <>
                  <ClipboardIcon className="w-3.5 h-3.5" /> Copy link
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right rail: lead count + toggle */}
        <div className="flex flex-col items-end gap-3 flex-shrink-0">
          <div className="text-right">
            <div className="flex items-center justify-end gap-1 text-gray-700">
              <UsersIcon className="w-4 h-4 text-teal" />
              <span className="text-xl font-bold tabular-nums">
                {count === undefined ? '…' : count === null ? '—' : count.toLocaleString()}
              </span>
            </div>
            <p className="text-[10px] uppercase tracking-wide text-gray-400">leads (approx)</p>
          </div>

          <div className="flex items-center gap-2">
            <AnimatePresence>
              {saving && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-[10px] text-gray-400"
                >
                  saving…
                </motion.span>
              )}
              {!saving && savedAt && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-[10px] text-mint-green flex items-center gap-0.5"
                >
                  <CheckIcon className="w-3 h-3" /> saved
                </motion.span>
              )}
            </AnimatePresence>
            <Toggle enabled={tool.enabled} onChange={() => onToggle(tool)} disabled={saving} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------
export default function LeadToolsPage() {
  const [tools, setTools] = useState<LeadTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Record<string, number>>({});

  // Load tools
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from('lead_tools').select('*').order('sort_order');
      if (!active) return;
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      setTools((data ?? []) as LeadTool[]);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load lead counts once tools are known (best-effort)
  useEffect(() => {
    if (tools.length === 0) return;
    let active = true;
    (async () => {
      const entries = await Promise.all(
        tools.map(async (t) => [t.key, await fetchLeadCount(t)] as const),
      );
      if (!active) return;
      setCounts(Object.fromEntries(entries));
    })();
    return () => {
      active = false;
    };
  }, [tools]);

  const toggle = async (tool: LeadTool) => {
    const next = !tool.enabled;
    setSavingKey(tool.key);
    // Optimistic update
    setTools((prev) => prev.map((t) => (t.key === tool.key ? { ...t, enabled: next } : t)));
    const { error } = await supabase.from('lead_tools').update({ enabled: next }).eq('key', tool.key);
    setSavingKey(null);
    if (error) {
      // Revert on failure
      setTools((prev) => prev.map((t) => (t.key === tool.key ? { ...t, enabled: !next } : t)));
      setError('Failed to update "' + tool.name + '": ' + error.message);
      return;
    }
    setSavedKeys((prev) => ({ ...prev, [tool.key]: Date.now() }));
    setTimeout(() => {
      setSavedKeys((prev) => {
        const copy = { ...prev };
        delete copy[tool.key];
        return copy;
      });
    }, 2000);
  };

  const calculators = useMemo(() => tools.filter((t) => t.category === 'calculator'), [tools]);
  const assessments = useMemo(() => tools.filter((t) => t.category === 'assessment'), [tools]);
  const enabledCount = tools.filter((t) => t.enabled).length;

  const renderGroup = (
    title: string,
    Icon: React.ElementType,
    list: LeadTool[],
  ) => (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-midnight-blue flex items-center gap-2">
        <Icon className="w-5 h-5 text-mint-green" />
        {title}
        <span className="text-sm font-normal text-gray-400">({list.length})</span>
      </h2>
      {list.length === 0 ? (
        <p className="text-sm text-gray-400">No {title.toLowerCase()} found.</p>
      ) : (
        <div className="space-y-3">
          {list.map((tool) => (
            <ToolRow
              key={tool.key}
              tool={tool}
              count={tool.key in counts ? counts[tool.key] : undefined}
              onToggle={toggle}
              saving={savingKey === tool.key}
              savedAt={savedKeys[tool.key] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-8 py-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <WrenchScrewdriverIcon className="w-7 h-7 text-mint-green" />
              Lead Tools
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1 max-w-2xl">
              Calculators and assessments that capture leads on the public Free Tools hub. Toggle a
              tool off to hide it from the public hub and pause it — it stops appearing and stops
              taking new leads immediately.
            </p>
          </div>
          {!loading && (
            <div className="text-right bg-mint-green/10 dark:bg-mint-green/20 rounded-lg px-4 py-2">
              <p className="text-xs text-mint-green font-medium uppercase tracking-wide">Live</p>
              <p className="font-semibold text-gray-700 dark:text-gray-200">
                {enabledCount} of {tools.length} enabled
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="p-8 space-y-8 max-w-4xl">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-white border border-gray-100 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {renderGroup('Calculators', CalculatorIcon, calculators)}
            {renderGroup('Assessments', ClipboardDocumentCheckIcon, assessments)}
            <p className="text-xs text-gray-400">
              Lead counts are approximate — matched on lead-source text and shown as a directional
              signal, not an exact attribution.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
