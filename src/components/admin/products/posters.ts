// ─────────────────────────────────────────────────────────────────────────────
// The merchant handout for each product line — the link, not the words.
//
// The sheets themselves already exist and are already built: the copy lives in
// `scripts/one-pagers/content.mjs`, the layout in `template.mjs`, and
// `node scripts/one-pagers/build.mjs` renders each one to a single Letter page
// of HTML plus a real vector PDF. This file exists only so the Products page
// can HAND one over, which was the missing half — five compliance-passed
// sheets were sitting in `public/programs/` with nothing in the app linking to
// them.
//
// Two things this file is deliberately not:
//
//  1. It is NOT a second copy of the words. Nothing merchant-facing is written
//     here. The sheets went through a compliance pass (commit 3615115) that
//     stripped approval promises, timing claims, pricing and funder names; a
//     paraphrase rendered in the app would route around that review entirely.
//  2. It does NOT invent a link for a sheet that is not published. Debt Relief
//     is built to `docs/one-pagers/restricted/` ON PURPOSE — a file in
//     `public/` is served whether or not anything links to it, and debt relief
//     is a prohibited content category for A2P 10DLC. That line therefore gets
//     a `withheld` entry which prints the reason, rather than a download that
//     quietly publishes the one product whose public pages we pulled.
//
// ⚠ COUPLING: `slug` must match `slug` in scripts/one-pagers/content.mjs. The
// published path is `/programs/<slug>.{pdf,html}`, served straight out of
// `public/`. Rename a sheet there and the download here 404s, so rename both.
// ─────────────────────────────────────────────────────────────────────────────

export type Poster =
  | {
      state: "published";
      /** Matches `slug` in scripts/one-pagers/content.mjs. */
      slug: string;
      /** Served from public/programs. */
      pdf: string;
      html: string;
    }
  | {
      state: "withheld";
      slug: string;
      /** Where the built sheet actually lives, so it can still be handed over. */
      builtTo: string;
      /** Why it is not downloadable. Printed, not hidden. */
      why: string;
    };

const published = (slug: string): Poster => ({
  state: "published",
  slug,
  pdf: `/programs/${slug}.pdf`,
  html: `/programs/${slug}.html`,
});

/** Keyed by `ProductLine.id` in ./lines. Every line has an entry. */
export const POSTERS: Record<string, Poster> = {
  micro: published("momentum-micro"),
  wc: published("momentum-working-capital"),
  bridge: published("momentum-bridge"),
  term: published("momentum-term-and-line-of-credit"),
  gig: published("momentum-gig"),
  relief: {
    state: "withheld",
    slug: "momentum-debt-relief",
    builtTo: "docs/one-pagers/restricted/momentum-debt-relief.pdf",
    why:
      "This sheet is built, but it is deliberately kept out of public/ and out of the deployed site. Debt relief is a PROHIBITED content category for A2P 10DLC, our public pages for it were pulled for exactly that reason, and a file in public/ is published whether or not anything links to it. Hand it to a merchant who has already come to us — on a call, or attached to an email. Do not put it behind a link on this brand, and do not send it by SMS.",
  },
};

/** What every sheet leaves out, so nobody has to open one to find out. */
export const POSTER_OMITS = [
  "No funder is named",
  "No pricing, factor or rate",
  "No approval or timing promise",
  "No commission figure",
];
