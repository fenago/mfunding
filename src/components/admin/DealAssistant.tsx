// DealAssistant — the closer's deal-desk AI, scoped to ONE deal.
//
// The use case is literal: the closer is ON THE PHONE with a funder who is asking
// for things. They type the question, they get the answer — no tab switching, no
// digging through the deal record. The edge function (deal-assistant) assembles
// the deal's full context (merchant, financials, stage, doc checklist, every
// funder it went to + what each said, underwriting, activity) and the model
// answers strictly from it.
//
// Answers are deliberately SHORT — a wall of text is useless on a live call.
//
// PLACEMENT (one component, two triggers — never a second chat implementation):
//   • "floating" — the persistent bottom-right pill (Revenue Playbook). Its
//     open/closed choice STICKS in localStorage.
//   • "button"   — an inline trigger that sits in a page/panel header
//     ("💬 Ask about this file"), used on the deal detail page and the AI
//     underwriting panel. Opens the SAME fixed drawer; does not persist.
// Opening any instance closes the others (a window event), so two drawers never
// overlap at the same fixed corner.
import { useEffect, useRef, useState } from "react";
import { SparklesIcon, PaperAirplaneIcon, ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import supabase from "../../supabase";
import { modelLabel } from "../../services/platformService";

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

// Fallback one-tap prompts — used until the deal's own suggested chips load (and
// if that call fails). The questions a closer actually asks with a funder on the line.
const STARTERS = [
  "Which of our funders fit this file best?",
  "What is the funder still waiting on?",
  "Where is this deal in the pipeline?",
  "What's the single next action to move this deal?",
];

// Broadcast so opening one assistant closes any other open instance.
const OPEN_EVENT = "dealassistant:open";

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

interface DealAssistantProps {
  dealId: string;
  /** Merchant/deal label shown in the header. Falls back to "this file". */
  merchantLabel?: string | null;
  /** "floating" = persistent bottom-right pill; "button" = inline header trigger. */
  placement?: "floating" | "button";
  /** Label for the inline trigger (button placement only). */
  buttonLabel?: string;
  /** Optional class override for the inline trigger. */
  buttonClassName?: string;
}

export default function DealAssistant({
  dealId,
  merchantLabel,
  placement = "floating",
  buttonLabel = "Ask about this deal",
  buttonClassName,
}: DealAssistantProps) {
  // The floating pill remembers its open/closed choice (a closer working a queue
  // shouldn't have to re-open it). The inline button always starts closed.
  const [open, setOpen] = useState<boolean>(() => {
    if (placement !== "floating") return false;
    try { return localStorage.getItem("dealAssistantOpen") === "1"; } catch { return false; }
  });
  const setOpenSticky = (v: boolean) => {
    setOpen(v);
    if (placement === "floating") {
      try { localStorage.setItem("dealAssistantOpen", v ? "1" : "0"); } catch { /* private mode */ }
    }
  };
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Chips seeded from the deal's real state (loaded from the edge function on open).
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  // The model that answered the last turn — surfaced subtly in the footer.
  const [answeredModel, setAnsweredModel] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const instanceId = useRef(Math.random().toString(36).slice(2)).current;

  const merchant = merchantLabel?.trim() || "this file";

  // Switching deals must not carry the old deal's conversation or chips over.
  useEffect(() => {
    setMsgs([]);
    setError(null);
    setInput("");
    setSuggestions(null);
    setAnsweredModel(null);
  }, [dealId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  // Opening any assistant closes the others so two drawers never stack.
  useEffect(() => {
    function onOtherOpen(e: Event) {
      if ((e as CustomEvent).detail !== instanceId) setOpen(false);
    }
    window.addEventListener(OPEN_EVENT, onOtherOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOtherOpen);
  }, [instanceId]);

  function openMe() {
    setOpenSticky(true);
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: instanceId }));
  }

  // Load the deal's suggested chips the first time the panel opens on an empty
  // thread. Cheap (no LLM); silently falls back to STARTERS on any failure.
  useEffect(() => {
    if (!open || suggestions !== null || msgs.length) return;
    let alive = true;
    (async () => {
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("deal-assistant", {
          body: { deal_id: dealId, suggest: true },
        });
        if (fnErr) return; // fall back to STARTERS
        const s = (data as { suggestions?: string[] } | null)?.suggestions;
        if (alive && Array.isArray(s) && s.length) setSuggestions(s);
      } catch { /* fall back to STARTERS */ }
    })();
    return () => { alive = false; };
  }, [open, dealId, suggestions, msgs.length]);

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
        body: { deal_id: dealId, question: q, history },
      });
      if (fnErr) await invokeThrow(fnErr);
      const answer = (data as { answer?: string } | null)?.answer?.trim();
      if (!answer) throw new Error("The assistant returned an empty answer.");
      setAnsweredModel((data as { model?: string } | null)?.model ?? null);
      setMsgs((m) => [...m, { role: "assistant", content: answer }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const chips = suggestions ?? STARTERS;

  // The drawer body — shared by both placements.
  const drawer = (
    <div className="w-full flex flex-col max-h-[70vh] rounded-xl border border-ocean-blue/30 dark:border-ocean-blue/40 bg-white dark:bg-gray-900 shadow-2xl overflow-hidden">
      {/* Header — states the deal it is scoped to. Click to collapse. */}
      <button
        type="button"
        onClick={() => setOpenSticky(false)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left shrink-0 bg-gradient-to-br from-ocean-blue/5 to-mint-green/5 dark:from-ocean-blue/10 dark:to-mint-green/5 hover:bg-ocean-blue/10 transition"
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
        <span className="ml-auto text-xs font-medium text-ocean-blue shrink-0">Hide</span>
      </button>

      <div className="border-t border-ocean-blue/20 dark:border-ocean-blue/30 px-4 py-3 overflow-y-auto">
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

        {/* Subtle "answered by" footer — which model produced the last reply. */}
        {answeredModel && msgs.some((m) => m.role === "assistant") && !busy && (
          <div className="mb-2 text-right text-[10px] text-gray-400 dark:text-gray-500">
            Answered by {modelLabel(answeredModel)}
          </div>
        )}

        {/* The real server error, verbatim — never "non-2xx status code". */}
        {error && (
          <div className="mb-3 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-[12px] text-red-800 dark:text-red-200">
            {error}
          </div>
        )}

        {/* One-tap chips — seeded from THIS deal's state (or the fallback starters). */}
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {chips.map((s) => (
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
        )}

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
    </div>
  );

  // The fixed bottom-right dock — reachable from anywhere on the page (a closer
  // deep in the funder cards on a call is NOT at the top of the page).
  const dock = (
    <div className="fixed bottom-28 right-6 z-40 flex flex-col items-end w-[min(26rem,calc(100vw-3rem))] print:hidden">
      {drawer}
    </div>
  );

  // Inline header trigger (button placement).
  if (placement === "button") {
    return (
      <>
        <button
          type="button"
          onClick={openMe}
          className={
            buttonClassName ??
            "inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-ocean-blue border border-ocean-blue rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20"
          }
        >
          <ChatBubbleLeftRightIcon className="w-4 h-4" />
          {buttonLabel}
        </button>
        {open && dock}
      </>
    );
  }

  // Floating pill (default).
  return (
    <div className="fixed bottom-28 right-6 z-40 flex flex-col items-end w-[min(26rem,calc(100vw-3rem))] print:hidden">
      {!open ? (
        <button
          type="button"
          onClick={openMe}
          className="flex items-center gap-2 rounded-full bg-ocean-blue px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:opacity-90"
        >
          <SparklesIcon className="w-4 h-4" />
          {buttonLabel}
        </button>
      ) : (
        drawer
      )}
    </div>
  );
}
