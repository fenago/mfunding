import { useEffect, useState } from "react";
import {
  InformationCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";

interface PageGuideProps {
  /** Short page name, e.g. "Marketing Vendors". */
  title: string;
  /** One-liner: what this page is. Always visible. */
  what: string;
  /** Why it matters / the value it delivers. */
  value: string;
  /** How to use it — string or list of steps. */
  howToUse: string | string[];
  /** How to read the info on the page — string or list. */
  howToRead: string | string[];
  /** Unique key for persisting collapsed state in localStorage. */
  storageKey: string;
}

const PREFIX = "pageguide:";

function toList(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v];
}

/**
 * A compact, collapsible summary header for admin pages. Answers four things:
 * what it is, why it matters, how to use it, and how to read the info.
 * The collapsed state is remembered per-user via localStorage.
 */
export default function PageGuide({
  title,
  what,
  value,
  howToUse,
  howToRead,
  storageKey,
}: PageGuideProps) {
  const key = PREFIX + storageKey;

  // Default to open; respect a previously stored preference.
  const [open, setOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(key) !== "hidden";
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, open ? "shown" : "hidden");
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [key, open]);

  const useItems = toList(howToUse);
  const readItems = toList(howToRead);

  return (
    <div className="mb-6 rounded-2xl border border-ocean-blue/20 bg-gradient-to-br from-ocean-blue/[0.06] to-mint-green/[0.06] dark:border-ocean-blue/30 dark:from-ocean-blue/10 dark:to-mint-green/10 shadow-sm">
      {/* Always-visible row: icon + title + one-line "what" + toggle */}
      <div className="flex items-start gap-3 p-4">
        <span className="flex-shrink-0 mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-lg bg-mint-green/15 text-mint-green">
          <InformationCircleIcon className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-midnight-blue dark:text-white leading-tight">
            {title}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{what}</p>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-ocean-blue hover:text-ocean-blue/80 rounded-md px-2 py-1 hover:bg-ocean-blue/10 transition-colors"
        >
          {open ? (
            <>
              Hide guide <ChevronUpIcon className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              Show guide <ChevronDownIcon className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>

      {/* Collapsible body */}
      {open && (
        <div className="px-4 pb-4 pl-[3.75rem] grid gap-4 sm:grid-cols-3 text-sm">
          <GuideBlock label="Why it matters">
            <p className="text-gray-600 dark:text-gray-300 leading-snug">{value}</p>
          </GuideBlock>
          <GuideBlock label="How to use it">
            <GuideContent items={useItems} />
          </GuideBlock>
          <GuideBlock label="How to read it">
            <GuideContent items={readItems} />
          </GuideBlock>
        </div>
      )}
    </div>
  );
}

function GuideBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-ocean-blue/80 dark:text-mint-green mb-1">
        {label}
      </p>
      {children}
    </div>
  );
}

function GuideContent({ items }: { items: string[] }) {
  if (items.length === 1) {
    return <p className="text-gray-600 dark:text-gray-300 leading-snug">{items[0]}</p>;
  }
  return (
    <ul className="list-disc pl-4 space-y-1 text-gray-600 dark:text-gray-300 leading-snug">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
