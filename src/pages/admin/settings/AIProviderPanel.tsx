import { useCallback, useEffect, useState } from "react";
import {
  BoltIcon, CheckCircleIcon, XCircleIcon, ArrowPathIcon,
} from "@heroicons/react/24/outline";
import {
  LLM_PROVIDERS, LLM_TASKS, defaultModelFor,
  getLLMSettings, saveLLMSettings, getKeyStatus, setProviderKey, testActiveProvider,
  type LLMSettings, type TestResult,
} from "../../../services/llmProviderService";

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

const inputCls =
  "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ocean-blue/40";

export default function AIProviderPanel() {
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [keyStatus, setKeyStatus] = useState<Record<string, boolean>>({});
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, ks] = await Promise.all([getLLMSettings(), getKeyStatus().catch(() => ({}))]);
      setSettings(s);
      setKeyStatus(ks);
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const setActiveProvider = (provider: string) => {
    setSettings((prev) =>
      prev ? { ...prev, provider, model: defaultModelFor(provider) || prev.model } : prev);
  };

  const setOverride = (task: string, field: "provider" | "model", value: string) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const overrides = { ...prev.task_overrides };
      const cur = { ...(overrides[task] ?? {}) };
      if (field === "provider") {
        if (!value) { delete cur.provider; } else { cur.provider = value; cur.model = defaultModelFor(value); }
      } else {
        if (!value) delete cur.model; else cur.model = value;
      }
      if (!cur.provider && !cur.model) delete overrides[task];
      else overrides[task] = cur;
      return { ...prev, task_overrides: overrides };
    });
  };

  const onSave = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    try {
      await saveLLMSettings(settings);
      setMessage({ kind: "ok", text: "AI provider settings saved." });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const onSaveKey = async (provider: string) => {
    const val = (keyInputs[provider] ?? "").trim();
    if (!val) return;
    setSavingKey(provider);
    setMessage(null);
    try {
      await setProviderKey(provider, val);
      setKeyInputs((prev) => ({ ...prev, [provider]: "" }));
      setKeyStatus((prev) => ({ ...prev, [provider]: true }));
      setMessage({ kind: "ok", text: `Key saved for ${provider}.` });
    } catch (e) {
      setMessage({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSavingKey(null);
    }
  };

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testActiveProvider());
    } catch (e) {
      setTestResult({ ok: false, provider: settings?.provider ?? "", model: settings?.model ?? "", latency_ms: 0, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  if (loading && !settings) {
    return <Card title="AI Provider"><p className="text-sm text-gray-400">Loading…</p></Card>;
  }
  if (!settings) return null;

  return (
    <Card
      title="AI Provider"
      action={
        <button onClick={refresh} disabled={loading}
          className="px-2.5 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60 inline-flex items-center gap-1.5">
          <ArrowPathIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      }
    >
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Switch the model that powers funder matching and reply classification. Keys are stored server-side and never shown here.
      </p>

      {/* Active provider + model */}
      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Active provider</label>
          <select value={settings.provider} onChange={(e) => setActiveProvider(e.target.value)} className={inputCls}>
            {LLM_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Model</label>
          <input value={settings.model} onChange={(e) => setSettings({ ...settings, model: e.target.value })}
            placeholder={defaultModelFor(settings.provider)} className={inputCls} />
        </div>
      </div>

      {/* Per-task overrides */}
      <div className="mb-5">
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Per-task overrides (optional)</div>
        <div className="space-y-2">
          {LLM_TASKS.map((t) => {
            const ov = settings.task_overrides[t.id] ?? {};
            return (
              <div key={t.id} className="grid sm:grid-cols-3 gap-2 items-center">
                <div className="text-sm text-gray-700 dark:text-gray-300">{t.label}</div>
                <select value={ov.provider ?? ""} onChange={(e) => setOverride(t.id, "provider", e.target.value)} className={inputCls}>
                  <option value="">Use active provider</option>
                  {LLM_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <input value={ov.model ?? ""} onChange={(e) => setOverride(t.id, "model", e.target.value)}
                  placeholder={ov.provider ? defaultModelFor(ov.provider) : "model (optional)"}
                  disabled={!ov.provider} className={`${inputCls} disabled:opacity-50`} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Save + Test */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <button onClick={onSave} disabled={saving}
          className="px-4 py-2 text-sm font-medium text-white bg-ocean-blue rounded-lg hover:opacity-90 disabled:opacity-60">
          {saving ? "Saving…" : "Save settings"}
        </button>
        <button onClick={onTest} disabled={testing}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60 inline-flex items-center gap-2">
          <BoltIcon className={`w-4 h-4 ${testing ? "animate-pulse" : ""}`} /> {testing ? "Testing…" : "Test connection"}
        </button>
        {message && (
          <span className={`text-sm ${message.kind === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {message.text}
          </span>
        )}
      </div>

      {testResult && (
        <div className={`mb-6 p-3 rounded-lg text-sm ${testResult.ok ? "bg-emerald-50 dark:bg-emerald-900/20" : "bg-red-50 dark:bg-red-900/20"}`}>
          <div className="flex items-center gap-2 font-medium">
            {testResult.ok ? <CheckCircleIcon className="w-5 h-5 text-emerald-600" /> : <XCircleIcon className="w-5 h-5 text-red-600" />}
            {testResult.ok ? "Connection working" : "Connection failed"}
            <span className="text-gray-400 font-normal">· {testResult.provider} / {testResult.model} · {testResult.latency_ms} ms</span>
          </div>
          {testResult.ok
            ? testResult.sample && <div className="mt-1 text-gray-600 dark:text-gray-300">Response: “{testResult.sample}”</div>
            : <div className="mt-1 text-red-600 dark:text-red-400 break-words">{testResult.error}</div>}
        </div>
      )}

      {/* Provider API keys (write-only) */}
      <div>
        <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Provider API keys</div>
        <div className="space-y-2">
          {LLM_PROVIDERS.map((p) => (
            <div key={p.id} className="grid sm:grid-cols-[10rem_1fr_auto] gap-2 items-center">
              <div className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                {p.label}
                {keyStatus[p.id] && <span className="text-emerald-600 dark:text-emerald-400 text-xs inline-flex items-center gap-0.5"><CheckCircleIcon className="w-4 h-4" /> key set</span>}
              </div>
              <input type="password" autoComplete="off" value={keyInputs[p.id] ?? ""}
                onChange={(e) => setKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                placeholder={keyStatus[p.id] ? "•••••••• (set — enter to replace)" : "Paste API key"}
                className={inputCls} />
              <button onClick={() => onSaveKey(p.id)} disabled={savingKey === p.id || !(keyInputs[p.id] ?? "").trim()}
                className="px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
                {savingKey === p.id ? "Saving…" : "Save key"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
