// DealAssistant — the closer's deal-desk AI, scoped to the ONE deal loaded in the
// Revenue Playbook.
//
// The use case is literal: the closer is ON THE PHONE with a funder who is asking
// for things. They type the question, they get the answer — no tab switching, no
// digging through the deal record. The edge function (deal-assistant) assembles
// the deal's full context (merchant, financials, stage, doc checklist, every
// funder it went to + what each said, underwriting, activity) and the model
// answers strictly from it.
//
// Answers are deliberately SHORT — a wall of text is useless on a live call.
import { useEffect, useRef, useState } from "react";
import { SparklesIcon, PaperAirplaneIcon, ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import type { DealWithCustomer } from "../../types/deals";

// supabase.functions.invoke stashes a non-2xx response's JSON body in
// error.context (a Response) — so callers who don't read it show the useless
// "Edge Function returned a non-2xx status code". Pull the server's { error }
// out so the closer sees the REAL message (403 not-your-deal, 502 provider down).
async function invokeThrow(error: unknown): Promise<never> {
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
    if (body?.error) throw new Error(body.error);
  }
  throw new Error((error as { message?: string } | null)?.message ?? "Request failed.");
}

interface Msg { role: "user" | "assistant"; content: string }

// One-tap prompts for the phone-call moment — the questions a closer actually
// asks with a funder on the line.
const STARTERS = [
  "What is the funder still waiting on?",
  "What stips are missing?",
  "Where is this deal in the pipeline?",
  "Summarize this merchant for me.",
];

// Minimal safe renderer: the model emits **bold** and "- " bullets. We render
// those as TEXT nodes only — never dangerouslySetInnerHTML, so no injection.
function Rendered({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const bullet = /^\s*[-•]\s+/.test(line);
        const body = bullet ? line.replace(/^\s*[-•]\s+/, "") : line;
        if (!body.trim()) return <div key={i} className="h-2" />;
        return (
          <div key={i} className={bullet ? "flex gap-1.5" : ""}>
            {bullet && <span className="text-mint-green shrink-0">•</span>}
            <span>
              {body.split(/(\*\*[^*]+\*\*)/g).map((tok, j) =>
                tok.startsWith("**") && tok.endsWith("**") ? (
                  <strong key={j} className="font-semibold text-midnight-blue dark:text-white">
                    {tok.slice(2, -2)}
                  </strong>
                ) : (
                  <span key={j}>{tok}</span>
                ),
              )}
            </span>
          </div>
        );
      })}
    </>
  );
}

export default function DealAssistant({ deal }: { deal: DealWithCustomer }) {
  // Open by default: the whole point is that a closer with a deal loaded can just
  // talk to it (often mid-call). Collapsed-by-default made it easy to miss entirely.
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const merchant = deal.customer?.business_name?.trim() || deal.deal_number || "this deal";

  // Switching leads must not carry the old deal's conversation over.
  useEffect(() => {
    setMsgs([]);
    setError(null);
    setInput("");
  }, [deal.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setError(null);
    // Send the history BEFORE this turn (the server appends the question itself).
    const history = msgs.slice(-8);
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setBusy(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("deal-assistant", {
        body: { deal_id: deal.id, question: q, history },
      });
      if (fnErr) await invokeThrow(fnErr);
      const answer = (data as { answer?: string } | null)?.answer?.trim();
      if (!answer) throw new Error("The assistant returned an empty answer.");
      setMsgs((m) => [...m, { role: "assistant", content: answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-ocean-blue/30 dark:border-ocean-blue/40 bg-gradient-to-br from-ocean-blue/5 to-mint-green/5 dark:from-ocean-blue/10 dark:to-mint-green/5 overflow-hidden">
      {/* Header — always visible, states the deal it is scoped to. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-ocean-blue/5 dark:hover:bg-ocean-blue/10 transition"
      >
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-ocean-blue text-white shrink-0">
          <SparklesIcon className="w-4 h-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-midnight-blue dark:text-white">
            Ask about this deal
          </span>
          <span className="block text-[11px] text-gray-500 dark:text-gray-400 truncate">
            Knows everything on <b>{merchant}</b> — stips, funders, pipeline. On a call? Ask here.
          </span>
        </span>
        <span className="ml-auto text-xs font-medium text-ocean-blue shrink-0">
          {open ? "Hide" : "Open"}
        </span>
      </button>

      {open && (
        <div className="border-t border-ocean-blue/20 dark:border-ocean-blue/30 px-4 py-3">
          {/* Transcript */}
          <div
            ref={scrollRef}
            className={`space-y-3 overflow-y-auto ${msgs.length || busy ? "max-h-80 mb-3" : ""}`}
          >
            {msgs.length === 0 && !busy && (
              <div className="flex items-start gap-2 text-[12px] text-gray-500 dark:text-gray-400 pb-1">
                <ChatBubbleLeftRightIcon className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Answers come straight from this deal's record — the merchant, the doc checklist, every
                  funder it went to and what they said. If it isn't on the deal, it'll tell you so.
                </span>
              </div>
            )}

            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl rounded-br-sm bg-ocean-blue px-3 py-2 text-[13px] text-white">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[92%] rounded-xl rounded-bl-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-[13px] leading-relaxed text-gray-700 dark:text-gray-200 space-y-0.5">
                    <Rendered text={m.content} />
                  </div>
                </div>
              ),
            )}

            {busy && (
              <div className="flex justify-start">
                <div className="rounded-xl rounded-bl-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-ocean-blue animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-ocean-blue animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-ocean-blue animate-bounce" />
                </div>
              </div>
            )}
          </div>

          {/* The real server error, verbatim — never "non-2xx status code". */}
          {error && (
            <div className="mb-3 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-[12px] text-red-800 dark:text-red-200">
              {error}
            </div>
          )}

          {/* One-tap starters — the phone-call questions. */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => ask(s)}
                className="rounded-full border border-ocean-blue/40 bg-white dark:bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-ocean-blue hover:bg-ocean-blue hover:text-white disabled:opacity-50 disabled:hover:bg-white dark:disabled:hover:bg-gray-800 dark:disabled:hover:text-ocean-blue transition"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={busy}
              placeholder="The funder's asking for something — what is it?"
              className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-[13px] text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:border-ocean-blue focus:outline-none focus:ring-1 focus:ring-ocean-blue disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="grid place-items-center w-9 h-9 shrink-0 rounded-lg bg-ocean-blue text-white hover:opacity-90 disabled:opacity-40"
              title="Ask"
            >
              <PaperAirplaneIcon className="w-4 h-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
