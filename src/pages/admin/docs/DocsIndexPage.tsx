// /admin/docs — the documentation library index.
//
// Staff-only by virtue of living under AdminProtectedRoute (isStaff = closer,
// employee, admin, super_admin). Merchants (role `user`) never reach this route.
//
// Two sets, two cards. The text is read straight out of docs/ at build time —
// see src/data/projectDocs.ts.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpenIcon,
  BriefcaseIcon,
  CodeBracketIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import {
  DOC_SETS,
  PROJECT_DOCS,
  SET_META,
  docsInSet,
  type DocSet,
  type ProjectDoc,
} from "@/data/projectDocs";

const SET_ICON: Record<DocSet, React.ComponentType<{ className?: string }>> = {
  functional: BriefcaseIcon,
  technical: CodeBracketIcon,
};

// Set-level accent, so the two groups read as two things at a glance.
const SET_ACCENT: Record<DocSet, { chip: string; rail: string }> = {
  functional: {
    chip: "bg-mint-green/15 text-emerald-700 dark:bg-mint-green/20 dark:text-mint-green",
    rail: "bg-mint-green",
  },
  technical: {
    chip: "bg-ocean-blue/10 text-ocean-blue dark:bg-ocean-blue/25 dark:text-sky-300",
    rail: "bg-ocean-blue",
  },
};

function DocRow({ doc }: { doc: ProjectDoc }) {
  return (
    <Link
      to={`/admin/docs/${doc.set}/${doc.slug}`}
      className="group flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 transition hover:border-ocean-blue/60 hover:shadow-sm dark:hover:border-ocean-blue/60"
    >
      <span className={`mt-1.5 h-8 w-1 shrink-0 rounded-full ${SET_ACCENT[doc.set].rail} opacity-60 group-hover:opacity-100`} />
      <span className="min-w-0">
        <span className="block font-semibold text-gray-900 dark:text-white group-hover:text-ocean-blue dark:group-hover:text-sky-300">
          {doc.title}
        </span>
        <span className="block text-sm text-gray-600 dark:text-gray-400 mt-0.5">{doc.blurb}</span>
        <span className="block text-[11px] font-mono text-gray-400 dark:text-gray-500 mt-1">{doc.path}</span>
      </span>
    </Link>
  );
}

export default function DocsIndexPage() {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return PROJECT_DOCS;
    return PROJECT_DOCS.filter((d) =>
      `${d.title} ${d.blurb} ${d.path}`.toLowerCase().includes(needle),
    );
  }, [q]);

  const hits = (set: DocSet) => filtered.filter((d) => d.set === set);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-start gap-3">
        <BookOpenIcon className="w-8 h-8 shrink-0 text-ocean-blue" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Documentation</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            How this business and this platform actually work. Written from the live code and the live
            database — where an older planning doc disagrees, these win.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative mt-6 max-w-md">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter documents…"
          className="input-field pl-9"
        />
      </div>

      {filtered.length === 0 && (
        <p className="mt-8 text-gray-500 dark:text-gray-400">
          Nothing matches “{q}”.
        </p>
      )}

      {DOC_SETS.map((set) => {
        const docs = hits(set);
        if (docs.length === 0) return null;
        const Icon = SET_ICON[set];
        const total = docsInSet(set).length;
        return (
          <section key={set} className="mt-8">
            <div className="flex flex-wrap items-center gap-2">
              <Icon className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {SET_META[set].label}
              </h2>
              <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${SET_ACCENT[set].chip}`}>
                {SET_META[set].tagline}
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {docs.length === total ? `${total} docs` : `${docs.length} of ${total}`}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {docs.map((doc) => (
                <DocRow key={`${doc.set}/${doc.slug}`} doc={doc} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
