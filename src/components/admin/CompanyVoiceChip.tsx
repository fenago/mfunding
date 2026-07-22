import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChatBubbleLeftRightIcon,
  ArrowTopRightOnSquareIcon,
  EyeIcon,
  EyeSlashIcon,
  ClipboardIcon,
  CheckIcon,
} from "@heroicons/react/24/outline";
import { getCompanyVoice, type CompanyVoice } from "../../services/platformService";

/**
 * The shared company phone line (Google Voice), one click from the playbook so a
 * closer can text/call a merchant on the company number without leaving the deal.
 *
 * The chip opens https://voice.google.com in a new tab. The shared login lives in
 * platform_settings.company_voice — readable ONLY by authenticated staff (a
 * RESTRICTIVE RLS policy gates that one key), never hardcoded in the repo. The
 * password shows masked with a click-to-reveal + copy, so it's there when a fresh
 * browser needs it but not sitting in plain sight on the screen.
 */
export default function CompanyVoiceChip() {
  const [creds, setCreds] = useState<CompanyVoice | null>(null);
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"user" | "pass" | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getCompanyVoice().then(setCreds);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setRevealed(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const url = creds?.url || "https://voice.google.com";

  const copy = useCallback(async (which: "user" | "pass", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  }, []);

  const hasLogin = !!(creds?.username || creds?.password);

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Text (or call) a merchant on the shared company Google Voice line"
        className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-200 dark:hover:bg-indigo-900/60 transition-colors"
      >
        <ChatBubbleLeftRightIcon className="w-3 h-3" /> Text — company line
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl p-3">
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
            Text (or call) merchants on the shared company Google Voice line. Sign in with the team login below.
          </p>

          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
          >
            <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" /> Open Google Voice
          </a>

          {hasLogin ? (
            <div className="mt-3 space-y-1.5">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Username</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-gray-800 dark:text-gray-200 truncate flex-1">
                    {creds?.username || "—"}
                  </span>
                  {creds?.username && (
                    <button
                      type="button"
                      onClick={() => void copy("user", creds.username)}
                      title="Copy username"
                      className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded"
                    >
                      {copied === "user" ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardIcon className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Password</p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-gray-800 dark:text-gray-200 truncate flex-1">
                    {creds?.password ? (revealed ? creds.password : "•".repeat(Math.min(creds.password.length, 12))) : "—"}
                  </span>
                  {creds?.password && (
                    <>
                      <button
                        type="button"
                        onClick={() => setRevealed((r) => !r)}
                        title={revealed ? "Hide password" : "Reveal password"}
                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded"
                      >
                        {revealed ? <EyeSlashIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void copy("pass", creds.password)}
                        title="Copy password"
                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded"
                      >
                        {copied === "pass" ? <CheckIcon className="w-3.5 h-3.5 text-emerald-500" /> : <ClipboardIcon className="w-3.5 h-3.5" />}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">
              No shared login on file yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
