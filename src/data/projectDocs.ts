// Project Documentation library — the registry behind /admin/docs.
//
// SINGLE SOURCE OF TRUTH IS `docs/`. The markdown is NOT copied into src/. It is
// pulled straight out of the repo at build time with Vite's raw glob, so editing
// `docs/functional/05-money-and-commissions.md` changes the page and nothing else
// has to be touched. (Same trick closerDocs.ts uses for the two reference docs,
// just globbed instead of imported one file at a time.)
//
// Vite 6 API: `query: "?raw", import: "default"`. The old `as: "raw"` form is
// deprecated — do not reintroduce it.
//
// Titles come from each file's own `# ` heading, so a renamed chapter renames
// itself here too. Only the one-line blurbs live in this file, because a summary
// of a document is not something the document contains.

import { headingSlugger } from "@/lib/markdownAnchors";

// ⚠️ SECURITY — WHAT YOU PUT IN THIS GLOB BECOMES PUBLIC.
//
// Anything globbed here is compiled into a client JS chunk and served as a static
// asset. The /admin/docs route guard controls NAVIGATION, not the asset: a logged-out
// stranger can fetch `dist/assets/projectDocs-*.js` directly and read every byte of
// it. The guard hides the page; it does not make the content secret.
//
// So a document that names open vulnerabilities or unrotated credentials must NEVER
// be bundled — publishing it would hand an attacker a map of a live system holding
// merchant SSNs and bank details.
//
// The exclusion MUST live in the glob pattern itself (a leading `!` negation), not in
// a runtime .filter() over the result. With `eager: true` Vite inlines every MATCHED
// file into the chunk at BUILD time — so filtering the object afterwards hides the doc
// from the page while leaving its full text sitting in the shipped JS. Verified: the
// naive filter still left the security doc greppable in dist/. Exclude at the glob.
//
// Before adding a doc, ask: "am I willing for this to be on the open internet?" If the
// honest answer is no, it does not belong in the bundle — it needs an authenticated
// channel (a JWT-checking edge function, or Storage behind RLS). Tracked as a TODO.

/** Eagerly bundled: path (relative to this file) → raw markdown string. */
const RAW = import.meta.glob(
  [
    "../../docs/**/*.md",
    // NEVER BUNDLE: names open vulnerabilities and credentials awaiting rotation.
    "!../../docs/technical/08-security-posture.md",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

export type DocSet = "functional" | "technical";

export interface ProjectDoc {
  set: DocSet;
  /** URL segment + filename stem, e.g. "05-money-and-commissions" or "README". */
  slug: string;
  /** First `# ` heading in the file. */
  title: string;
  /** One-line "why you'd open this". */
  blurb: string;
  /** Repo-relative path, shown to the reader: "docs/functional/05-….md". */
  path: string;
  /** The markdown itself. */
  body: string;
}

export const SET_META: Record<DocSet, { label: string; tagline: string }> = {
  functional: {
    label: "Functional",
    tagline: "How the business + product work",
  },
  technical: {
    label: "Technical",
    tagline: "How it's built",
  },
};

/** One-liners, keyed "<set>/<slug>". Anything unlisted falls back to a generic line. */
const BLURBS: Record<string, string> = {
  "functional/README": "Start here — what this set covers and who each chapter is for.",
  "functional/01-the-business": "What an ISO actually is, what we sell, and how we get paid.",
  "functional/02-roles-and-access": "The five roles and exactly which screens each one opens.",
  "functional/03-deal-lifecycle": "Stranger fills out a form → funder wires the money. The whole machine.",
  "functional/04-closer-day-to-day": "The four screens a closer lives in, and what to do on each.",
  "functional/05-money-and-commissions": "Points, splits, renewals, clawbacks — the commission model in plain English.",
  "functional/06-super-admin-guide": "The owner-only surfaces: finances, funder network, analytics, config.",
  "functional/07-closer-onboarding": "The document package a new closer reads, signs, and returns.",
  "functional/08-funder-network": "Funder statuses, tiers, and how a deal gets matched and submitted.",
  "functional/09-glossary": "Every term you'll hear on day one, in the order you'll hear it.",

  "technical/README": "Start here — scope, and the code/DB-wins source-of-truth rule.",
  "technical/01-architecture": "Stack, build, chunking, hosting, and how the pieces fit together.",
  "technical/02-data-model": "58 live tables, RLS everywhere, and the two different closer identifiers.",
  "technical/03-auth-and-rbac": "The three independent authorization layers — all three must pass.",
  "technical/04-edge-functions": "Every edge function, what it does, and its shared-module deps.",
  "technical/05-integrations": "GHL, Supabase, Plaid, Instantly, the LLM provider layer.",
  "technical/06-subsystems": "Commissions, playbooks, underwriting, lead routing — the load-bearing code.",
  "technical/07-conventions-and-operations": "Coding conventions, deploy steps, and the rules that bite.",
  "technical/08-security-posture": "What's exposed, what's rotated, what's still open.",
  "technical/09-doc-drift": "Where the planning docs contradict the live code. The code wins.",
};

/** First `# Heading` in the file; falls back to the slug. */
function titleOf(md: string, slug: string): string {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : slug;
}

function build(): ProjectDoc[] {
  const docs: ProjectDoc[] = [];

  for (const [globPath, body] of Object.entries(RAW)) {
    // "../../docs/functional/05-money-and-commissions.md"
    const m = globPath.match(/docs\/(functional|technical)\/(.+)\.md$/);
    if (!m) continue;
    const set = m[1] as DocSet;
    const slug = m[2];
    const key = `${set}/${slug}`;
    docs.push({
      set,
      slug,
      title: titleOf(body, slug),
      blurb: BLURBS[key] ?? "Reference document.",
      path: `docs/${set}/${slug}.md`,
      body,
    });
  }

  // README first, then numbered chapters in order.
  return docs.sort((a, b) => {
    if (a.set !== b.set) return a.set < b.set ? -1 : 1;
    const ra = a.slug.toLowerCase() === "readme";
    const rb = b.slug.toLowerCase() === "readme";
    if (ra !== rb) return ra ? -1 : 1;
    return a.slug.localeCompare(b.slug, "en", { numeric: true });
  });
}

export const PROJECT_DOCS: ProjectDoc[] = build();

export const DOC_SETS: DocSet[] = ["functional", "technical"];

export function docsInSet(set: DocSet): ProjectDoc[] {
  return PROJECT_DOCS.filter((d) => d.set === set);
}

export function getProjectDoc(set?: string, slug?: string): ProjectDoc | undefined {
  if (!set || !slug) return undefined;
  return PROJECT_DOCS.find((d) => d.set === set && d.slug === slug);
}

/** Prev/next within the doc's own set, so navigation never jumps sets. */
export function docNeighbors(doc: ProjectDoc): { prev?: ProjectDoc; next?: ProjectDoc } {
  const siblings = docsInSet(doc.set);
  const i = siblings.findIndex((d) => d.slug === doc.slug);
  return { prev: siblings[i - 1], next: siblings[i + 1] };
}

/** `## ` / `### ` headings → in-page table of contents. */
export interface TocEntry {
  id: string;
  text: string;
  level: 2 | 3;
}

export function tableOfContents(md: string): TocEntry[] {
  const out: TocEntry[] = [];
  const slug = headingSlugger(); // same slugger MarkdownDoc renders ids with
  for (const line of md.split("\n")) {
    const m = line.match(/^(#{2,3})\s+(.+)$/);
    if (!m) continue;
    const raw = m[2].trim();
    out.push({
      id: slug(raw),
      text: raw.replace(/[*`]/g, "").trim(),
      level: m[1].length as 2 | 3,
    });
  }
  return out;
}
