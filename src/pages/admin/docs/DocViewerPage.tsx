// /admin/docs/:set/:slug — read one document.
//
// The body is the repo file, verbatim, rendered by the shared MarkdownDoc (text
// nodes only — no dangerouslySetInnerHTML anywhere in this app). The "source:"
// line is deliberate: a reader who spots something wrong should know which file
// to go fix, because docs/ is the single source of truth and this page is only a
// window onto it.

import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeftIcon,
  ArrowLongLeftIcon,
  ArrowLongRightIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import MarkdownDoc from "@/components/shared/MarkdownDoc";
import {
  SET_META,
  docNeighbors,
  getProjectDoc,
  tableOfContents,
} from "@/data/projectDocs";

export default function DocViewerPage() {
  const { set, slug } = useParams<{ set: string; slug: string }>();
  const doc = getProjectDoc(set, slug);

  // New document = new page, not a scroll continuation.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [set, slug]);

  const toc = useMemo(() => (doc ? tableOfContents(doc.body) : []), [doc]);
  const { prev, next } = useMemo(
    () => (doc ? docNeighbors(doc) : { prev: undefined, next: undefined }),
    [doc],
  );

  if (!doc) {
    return (
      <div className="p-6">
        <Link to="/admin/docs" className="text-sm text-ocean-blue hover:underline">
          ← All documentation
        </Link>
        <p className="mt-6 text-gray-500 dark:text-gray-400">Document not found.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl">
      <Link
        to="/admin/docs"
        className="inline-flex items-center gap-1 text-sm text-ocean-blue hover:underline"
      >
        <ArrowLeftIcon className="w-4 h-4" /> All documentation
      </Link>

      {/* Header */}
      <div className="mt-4">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          <DocumentTextIcon className="w-3.5 h-3.5" />
          {SET_META[doc.set].label} — {SET_META[doc.set].tagline}
        </span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{doc.title}</h1>
        <p className="mt-1 text-gray-500 dark:text-gray-400">{doc.blurb}</p>
        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
          source: <span className="font-mono">{doc.path}</span>
        </p>
      </div>

      {/* On this page */}
      {toc.length > 2 && (
        <nav className="mt-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            On this page
          </p>
          <ul className="mt-2 space-y-1">
            {toc.map((h) => (
              <li key={h.id} className={h.level === 3 ? "pl-4" : ""}>
                <a
                  href={`#${h.id}`}
                  className="text-sm text-gray-700 dark:text-gray-300 hover:text-ocean-blue dark:hover:text-sky-300 hover:underline"
                >
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* The document */}
      <article className="mt-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <MarkdownDoc source={doc.body} anchors />
      </article>

      {/* Prev / next within the set */}
      <nav className="mt-6 grid gap-3 sm:grid-cols-2">
        {prev ? (
          <Link
            to={`/admin/docs/${prev.set}/${prev.slug}`}
            className="group rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 transition hover:border-ocean-blue/60"
          >
            <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
              <ArrowLongLeftIcon className="w-4 h-4" /> Previous
            </span>
            <span className="mt-0.5 block text-sm font-semibold text-gray-900 dark:text-white group-hover:text-ocean-blue dark:group-hover:text-sky-300">
              {prev.title}
            </span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link
            to={`/admin/docs/${next.set}/${next.slug}`}
            className="group rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 transition hover:border-ocean-blue/60 sm:text-right"
          >
            <span className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 sm:justify-end">
              Next <ArrowLongRightIcon className="w-4 h-4" />
            </span>
            <span className="mt-0.5 block text-sm font-semibold text-gray-900 dark:text-white group-hover:text-ocean-blue dark:group-hover:text-sky-300">
              {next.title}
            </span>
          </Link>
        )}
      </nav>
    </div>
  );
}
