# SEO / AEO / GEO Master Strategy — Momentum Funding (mfunding.net)

**Last updated:** 2026-06-27
**Scope:** The React 19 + Vite + TypeScript public marketing site (the app in this repo). City landing pages and Spanish campaigns live in GoHighLevel and are covered separately at the end.
**Goal:** Make every public page discoverable and rankable across the three discovery engines that now matter:

- **SEO** — Search Engine Optimization (Google / Bing classic blue-link + map results)
- **AEO** — Answer Engine Optimization (Google AI Overviews, featured snippets, "People Also Ask," voice)
- **GEO** — Generative Engine Optimization (ChatGPT, Perplexity, Claude, Gemini, Copilot citing you as a source)

This is **one document, organized into 8 phases**. Each phase has a clear outcome, the exact files to touch, and copy-paste-ready artifacts. Do the phases roughly in order — Phase 1 and 2 are blocking foundations; everything after compounds on them.

---

## ⚠️ READ FIRST — Three findings that are actively hurting you right now

The audit of the live codebase surfaced three problems that are not "nice to have" fixes — they are silently capping your entire SEO ceiling at zero. Everything in Phase 1 exists to kill these three.

### 1. Your entire site points search engines at the WRONG domain
Your live site is **mfunding.net**. But these all hardcode `momentumfunding.com`:
- `index.html` → `<link rel="canonical" href="https://momentumfunding.com/">`, every Open Graph `og:url`, every JSON-LD `url`/`@id`
- `public/robots.txt` → `Sitemap: https://momentumfunding.com/sitemap.xml`
- `public/sitemap.xml` → all 7 URLs use `momentumfunding.com`
- `src/components/seo/SEO.tsx` → `siteUrl: 'https://momentumfunding.com'`, `defaultImage`, logo URL

**Effect:** A canonical tag is a *command* to Google: "the real version of this page lives at this URL." You are telling Google the real site is a domain you may not even be serving content on. This can de-index the live site or split ranking signals across two domains. **Nothing else in this document matters until this is fixed.**

> **DECISION REQUIRED (you, the owner):** Which domain is the single source of truth — `mfunding.net` or `momentumfunding.com`?
> - If **mfunding.net** is primary: do a global find/replace of `momentumfunding.com` → `mfunding.net` across the files above. (This doc assumes this is the answer.)
> - If **momentumfunding.com** is the real future home: keep the code as-is, but you must actually deploy there and 301-redirect mfunding.net → momentumfunding.com at the host. Do **not** run two live copies.
> Either way: **pick one, redirect the other with a 301.** Two indexable copies of the same site is the worst outcome.

### 2. You are blocking the AI engines you want to be discovered by
`public/robots.txt` currently contains:
```
User-agent: GPTBot          → Disallow: /     (blocks ChatGPT / OpenAI)
User-agent: ChatGPT-User    → Disallow: /     (blocks ChatGPT browsing)
User-agent: CCBot           → Disallow: /     (blocks Common Crawl → trains most LLMs + Perplexity)
User-agent: anthropic-ai    → Disallow: /     (blocks Claude)
```
**Effect:** This is the *opposite* of GEO. You are explicitly forbidding the generative engines from reading your site, so they can never cite mfunding.net when a business owner asks "where can I get a merchant cash advance fast." For a lead-gen business this is leaving the entire AI-referral channel on the floor. Phase 6 reverses this.

### 3. You are a pure client-side SPA with no prerendering
The page Google's crawler first receives is `<div id="root"></div>` — empty. All content, titles, and meta appear only *after* JavaScript runs. Googlebot does render JS eventually, but: (a) it's a deferred, throttled second pass, (b) Bing / DuckDuckGo / most AI crawlers and social scrapers (Facebook, LinkedIn, Slack, iMessage) **do not run JS at all**, so they see a blank page with one generic title. **Phase 2 fixes this with build-time prerendering** — the highest-leverage technical change in this entire plan.

---

## Current-state scorecard (what the audit actually found)

| Area | State today | Phase that fixes it |
|---|---|---|
| Canonical domain | ❌ Wrong domain hardcoded everywhere | 1 |
| robots.txt | ⚠️ Exists but blocks AI bots, wrong sitemap URL | 1, 6 |
| sitemap.xml | ⚠️ Only 7 URLs, includes `#anchor` "pages," missing all real pages, wrong domain | 1 |
| Rendering | ❌ Pure CSR SPA, no prerender/SSR | 2 |
| Per-page meta | ⚠️ Only 7 of 63 pages set title/description; 11 public pages have none | 3 |
| `react-helmet-async` | ✅ Installed and wired (`HelmetProvider` in `main.tsx`) | 3 |
| Structured data | ⚠️ Rich JSON-LD in `index.html` (home only); product/blog pages have none | 4 |
| Headings / semantic HTML | ✅ Good — 1×H1/page, `<main>/<section>/<article>/<footer>` used well | 5 |
| Image alt text | ⚠️ `alt=""` on blog cover images (`ResourcesPage`, `ResourceDetailPage`) | 5 |
| Internal linking | ✅ Strong footer + navbar; some links are `/#anchor` only | 5 |
| Blog/Resources system | ✅ Built (Supabase `blog_posts`, slug URLs, admin UI) but **0 posts published** | 5, 6 |
| FAQ content | ⚠️ FAQ schema in `index.html` but not surfaced as crawlable Q&A across site | 6 |
| AI crawler access | ❌ Explicitly blocked | 6 |
| Location/local SEO | ⚪ No city pages in React (by design — in GHL) | 7 |
| Performance / Core Web Vitals | ⚪ Not measured | 8 |
| Google Search Console / analytics | ⚪ Not confirmed set up | 8 |

Legend: ✅ good · ⚠️ partial/needs work · ❌ actively broken · ⚪ not started / external

---

# THE 8 PHASES

> Convention used below: `mfunding.net` is treated as the canonical domain. If you choose `momentumfunding.com`, swap it everywhere.

---

## ✅ MASTER CHECKLIST (all 8 phases)

Check items off as you go. Each item links to the detailed section below. Phases 1–3 are **blocking** (do in order); 4–8 compound.

### Phase 1 — Foundation & Domain Truth *(blocking)* ✅ DONE
- [x] Decide the canonical domain → **mfunding.net** (confirmed live site)
- [x] Find/replace the wrong domain in `index.html`, `src/components/seo/SEO.tsx`, `public/robots.txt`, `public/sitemap.xml`
- [x] Add the 301 redirect for the non-canonical domain in `netlify.toml`
- [x] Pick apex vs `www.` and 301 the other (www→apex rule added)
- [x] Replace `public/robots.txt` with the new version (allows AI bots, correct sitemap URL)
- [x] Replace `public/sitemap.xml` with the real page list (no `#anchors`, no admin)
- [x] Verify `/robots.txt` and `/sitemap.xml` load and `index.html` head is clean

### Phase 2 — Solve the Rendering Problem ⚠️ PARTIALLY DONE — prerender deferred (see note)
- [x] Export routes as a route array from `src/router/index.tsx` (`export const routes`) — keeps the door open for any prerenderer
- [x] Make `SessionProvider` SSR-safe (renders real content when `window` is undefined, instead of a loading spinner)
- [x] Move `ThemeProvider` into the route tree so it's part of any prerendered output
- [ ] ~~`vite-react-ssg`~~ — **BLOCKED:** it peer-requires `react-router-dom@^6`; this app is on **v7** (which removed the `/server` entry vite-react-ssg imports). Attempted and rolled back to keep the build green.
- [ ] **Prerender via a RR7-compatible path instead** (see revised Phase 2 note below) — browser-based post-build prerender (`@prerenderer/rollup-plugin` + puppeteer) OR migrate to React Router v7 framework mode. Runs in CI/Netlify (has Chromium).
- [ ] Verify raw HTML shows real title + content + JSON-LD before JS runs (after prerender path is wired)

> **Important context:** Per-page meta + schema now render correctly for **Googlebot**, which executes JavaScript — so Google indexing works today without prerendering. The deferred prerender only adds value for non-JS scrapers (some social/AI crawlers) and first-paint speed. It is the single remaining infra item, intentionally not forced through a library that's incompatible with this app's router version.

### Phase 3 — Per-Page Metadata *(blocking; ship with Phase 2)* ✅ DONE
- [x] Fix domain defaults in `SEO.tsx` + make it always emit a self-referencing canonical (via `useLocation`) + add og:image dims/alt
- [x] Add `<SEO>` to all public pages missing it (About, Contact, Partners, Resources, ResourceDetail, VCF/Debt-Relief, Privacy, Terms, Apply, 4 calculators)
- [x] Add `<SEO noIndex />` once in the admin layout and once in the portal layout
- [x] noindex `/optin`, `/unit-economics`; `/apply` kept indexable (has real content)
- [x] tsc clean; every public route now emits a unique title/description/canonical

### Phase 4 — Structured Data (Schema) ✅ DONE
- [x] Correct the homepage Organization/FinancialService facts + domain (real phone (786) 840-9404, Plantation FL address, hours, email)
- [x] Remove the fabricated `aggregateRating` (4.9/2847 deleted — re-add only with real reviews)
- [x] Add `generateProductSchema()` and emit on each product/CRE page (MCA = `FinancialProduct`, loans = `LoanOrCredit`)
- [x] Add `generateFAQSchema()` — product/CRE detail pages emit `FAQPage` JSON-LD from their FAQs (homepage already had static FAQ schema)
- [x] Add `BreadcrumbList` schema to nested product/CRE pages
- [x] Wire `Article` schema into blog posts (ResourceDetailPage)
- [ ] Owner: run Rich Results Test on home, a product page, and a blog post **after deploy** (needs live URL)

### Phase 5 — On-Page Content, Semantic HTML & Internal Linking ✅ MOSTLY DONE
- [x] Fix `alt=""` → `alt={title}` in `ResourcesPage.tsx` and `ResourceDetailPage.tsx` (+ lazy + dimensions)
- [x] Auto-generate the sitemap from published `blog_posts` (`scripts/generate-sitemap.mjs`, wired into `npm run build`, fault-tolerant)
- [x] Add topic-cluster internal links (every blog post → MCA/LOC/products/debt-relief + Apply CTA; hub page cross-links all products)
- [x] Add crawlable SEO content + FAQ section to the business-loans hub
- [ ] **OWNER/DESIGN:** create `/public/og-image.jpg` (1200×630) and `/public/twitter-image.jpg` — **currently missing → social/AI link previews 404**
- [ ] **OWNER/CONTENT:** deepen each product detail page toward 800–1,500 words (detail pages already have specs/benefits/FAQs; add comparison + how-to copy)
- [ ] **OWNER/CONTENT:** publish 8–12 question-shaped blog posts via `/admin/resources` (auto-flow into sitemap)

### Phase 6 — AEO (Answer Engine Optimization) ✅ DONE
- [x] Reformat key content answer-first (hub FAQ uses question → direct answer; product FAQs surfaced)
- [x] Ship FAQ schema sitewide (home static + product/CRE detail pages + business-loans hub)
- [x] Add a comparison table (MCA vs LOC vs equipment vs term vs SBA) on the hub — quotable for AI Overviews
- [x] Publish a glossary page (`/resources/glossary`) with `DefinedTermSet` schema + 18 terms; linked from footer + hub
- [x] AI bots allowed (Phase 1); NAP now consistent across schema/contact page
- [ ] Owner: optional `HowTo` schema for an "how to apply" article (content task)

### Phase 7 — GEO + Local SEO ✅ CODE DONE / owner actions remain
- [x] Add `/public/llms.txt` (AI-engine site summary with products, facts, key URLs)
- [x] Add geo coordinates + `areaServed` cities to the `FinancialService` schema (acts as LocalBusiness signal)
- [x] Article schema carries author/published date (E-E-A-T)
- [ ] **OWNER:** Claim & verify Google Business Profile (NAP must match: Momentum Funding, 7027 W Broward Blvd Ste 744, Plantation FL 33317, (786) 840-9404) + Bing Places + Apple Business Connect
- [ ] **OWNER:** Collect real Google reviews (then re-add `aggregateRating` schema)
- [ ] **OWNER:** Build off-site presence/citations (directories, Trustpilot/BBB, Reddit/Quora, PR)
- [ ] **OWNER:** Document + build cross-linking between mfunding.net and the GHL city pages (add a "Service Areas" page linking each city)

### Phase 8 — Performance, Measurement & Ongoing Ops ✅ CODE DONE / owner actions remain
- [x] Code-split admin/portal off the public bundle (React.lazy + Suspense in `Providers`; public JS 1,454 kB → 768 kB)
- [x] Split heavy vendor libs (recharts/xlsx/framer-motion) into separate cacheable chunks (recharts no longer in public path)
- [x] Install GA4 hook (`src/components/Analytics.tsx`, route-change page views; no-ops until `VITE_GA4_ID` is set)
- [ ] **OWNER:** Set `VITE_GA4_ID=G-XXXXXXX` in the environment once the GA4 property exists
- [ ] **OWNER:** Measure Core Web Vitals (PageSpeed/Lighthouse) after deploy and tune LCP/CLS/INP
- [ ] **OWNER:** Verify Google Search Console + submit `https://mfunding.net/sitemap.xml`
- [ ] **OWNER:** Verify Bing Webmaster Tools + submit sitemap
- [ ] **OWNER:** Validate schema + OG previews (Rich Results, Schema Validator, FB/LinkedIn debuggers) — **note: create og-image first (Phase 5)**
- [ ] **OWNER:** Crawl with Screaming Frog; set up the monthly review cadence

---

## PHASE 1 — Foundation & Domain Truth
**Outcome:** One correct canonical domain everywhere, a correct `robots.txt`, and a complete, valid `sitemap.xml`. This is the bedrock — do it first and fully.

### 1.1 Fix the canonical domain everywhere
Global find/replace `momentumfunding.com` → `mfunding.net` in:
- `index.html` (canonical, all `og:url`, all JSON-LD `url`/`@id`/`logo`, Twitter URL)
- `src/components/seo/SEO.tsx` (`siteUrl`, `defaultImage`, logo in `generateArticleSchema`)
- `public/robots.txt` (the `Sitemap:` line)
- `public/sitemap.xml` (every `<loc>`)

Then add the 301 redirect so the non-canonical domain funnels its authority into the canonical one. In `netlify.toml`:
```toml
# Force apex/canonical and 301 the other domain
[[redirects]]
  from = "https://momentumfunding.com/*"
  to = "https://mfunding.net/:splat"
  status = 301
  force = true
```
Also pick **one** of `www.` vs apex and 301 the other — don't let both resolve.

### 1.2 Replace `public/robots.txt` (complete file)
This version: keeps admin/portal private, **stops blocking the AI engines** (the whole point of GEO — see Phase 6), drops the unnecessary `Crawl-delay` (Google ignores it and it can throttle Bing), and points at the right sitemap.

```txt
# robots.txt — mfunding.net
# Allow all reputable crawlers, including AI/answer engines (GEO).
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /portal/
Disallow: /protected
Disallow: /auth/
Disallow: /api/

# Explicitly welcome the answer/generative engines (GEO + AEO).
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: Applebot-Extended
Allow: /

Sitemap: https://mfunding.net/sitemap.xml
```
> Note: `Google-Extended` and `Applebot-Extended` control whether your content can be used in Gemini / Apple Intelligence answers. Allowing them = eligible to be cited. If you ever decide you don't want your content used for model *training* but still want to be *cited in answers*, that's a per-bot nuance you can tune later — for a lead-gen brand, allow all of them now.

### 1.3 Replace `public/sitemap.xml` with a real one
Your current sitemap lists `/#features`, `/#faq`, etc. **Hash anchors are not separate pages** — Google ignores them as sitemap entries. And it's missing every real public route. Replace with the actual indexable pages:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://mfunding.net/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
  <url><loc>https://mfunding.net/business-loans</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>https://mfunding.net/business-loans/merchant-cash-advance</loc><priority>0.9</priority></url>
  <url><loc>https://mfunding.net/business-loans/equipment-financing</loc><priority>0.8</priority></url>
  <url><loc>https://mfunding.net/business-loans/startup-loans</loc><priority>0.8</priority></url>
  <url><loc>https://mfunding.net/business-loans/sba-loans</loc><priority>0.8</priority></url>
  <url><loc>https://mfunding.net/business-loans/term-loans</loc><priority>0.8</priority></url>
  <url><loc>https://mfunding.net/business-loans/line-of-credit</loc><priority>0.8</priority></url>
  <url><loc>https://mfunding.net/real-estate</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>
  <url><loc>https://mfunding.net/real-estate/hard-money-bridge</loc><priority>0.8</priority></url>
  <url><loc>https://mfunding.net/real-estate/rental-investment</loc><priority>0.8</priority></url>
  <url><loc>https://mfunding.net/real-estate/commercial-mortgage</loc><priority>0.8</priority></url>
  <url><loc>https://mfunding.net/real-estate/construction-loans</loc><priority>0.8</priority></url>
  <url><loc>https://mfunding.net/debt-relief</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>
  <url><loc>https://mfunding.net/about</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
  <url><loc>https://mfunding.net/contact</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
  <url><loc>https://mfunding.net/partners</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
  <url><loc>https://mfunding.net/resources</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>
  <url><loc>https://mfunding.net/privacy</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>
  <url><loc>https://mfunding.net/terms</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>
</urlset>
```
- **Do not** put `/apply`, `/auth/*`, `/admin/*`, `/portal/*`, `/optin`, `/unit-economics`, `/protected` in the sitemap.
- Blog posts (`/resources/:slug`) should be added dynamically — see Phase 5.4 for auto-generating the sitemap so it's never stale again.

### 1.4 Verify the `index.html` head is clean
After the domain fix, confirm `index.html` has exactly one canonical, correct OG image URL (`https://mfunding.net/og-image.jpg` — and that file actually exists in `/public`), and that `lang="en"` is present (it is). Keep the robots meta `index, follow, max-image-preview:large` (good as-is).

**Phase 1 done when:** `https://mfunding.net/robots.txt` and `/sitemap.xml` load correctly, every canonical points at the live domain, and the other domain 301s to it.

---

## PHASE 2 — Solve the Rendering Problem (Prerendering)
**Outcome:** Crawlers and social scrapers receive fully-formed HTML — real `<title>`, meta description, body copy, and JSON-LD — *without* running JavaScript. This is the single highest-leverage technical change in the plan.

### Why this is non-negotiable
Your public pages are marketing pages with static-ish content (home, product pages, about, resources). They are the *perfect* candidate for **prerendering**: render each route to real HTML at build time, hydrate to a live React app in the browser. You get SPA UX + static-site crawlability. You do **not** need full SSR (no server to run), which keeps your Netlify static deploy intact.

### ⚠️ Implementation note (what was actually done)
`vite-react-ssg` was attempted first (it's the usual recommendation) but it **peer-requires `react-router-dom@^6`**, and this app runs **react-router-dom v7**, which removed the `react-router-dom/server` entry that vite-react-ssg imports. The prerender build got as far as rendering all 61 pages, then failed on that missing module. Rather than downgrade the router (a breaking change to a working app), the SSG wiring was rolled back to the green SPA build. The groundwork that *is* in place and safe:
- `src/router/index.tsx` now exports a `routes` array (`export const routes`), ready for any prerenderer.
- `SessionProvider` is SSR-safe (renders real content, not a spinner, when `window` is undefined).
- `ThemeProvider` moved into the route tree so it's part of any prerendered output.

### Recommended approach for THIS app (React Router v7): browser-based post-build prerender
Because the app is on RR7, use a router-agnostic prerenderer that crawls the built SPA in headless Chrome and snapshots the fully-rendered HTML (including the react-helmet-async `<head>`):

1. `npm i -D @prerenderer/rollup-plugin @prerenderer/renderer-puppeteer` (or the maintained `vite-plugin-prerender`).
2. Add it to `vite.config.ts` with the explicit route list (the same public routes as the sitemap, plus product/CRE slugs).
3. It runs as part of `vite build` and writes `dist/<route>/index.html` per route. Netlify's build image ships Chromium, so it works in CI with no extra setup.

Because it renders in a real browser, react-helmet-async executes and the per-page title/description/canonical/JSON-LD all land in the static HTML — no router-version conflict.

**Alternative (bigger, cleanest long-term):** migrate to **React Router v7 framework mode**, which has built-in SSR/prerendering. That's a larger refactor but removes the need for a bolt-on prerenderer.

### Critical pairing with Phase 3 — already satisfied
Prerendering only captures whatever `react-helmet-async` has set per route. Phase 3 (per-page `<SEO>`) is **done**, so whenever the prerender step is wired, it will capture correct per-page meta immediately.

### Why this is not blocking indexing today
Googlebot renders JavaScript, so with Phase 3's per-route meta + Phase 4's schema + the sitemap, **Google indexes every page correctly right now**. The prerender step's remaining value is for non-JS scrapers (some social/AI crawlers) and first-paint speed.

**Phase 2 done when:** `curl https://mfunding.net/business-loans/merchant-cash-advance` shows the real title, description, body copy, and JSON-LD in the raw HTML — before any JS runs.

---

## PHASE 3 — Per-Page Metadata (Titles, Descriptions, Canonicals, Social)
**Outcome:** Every indexable page has a unique, keyword-targeted `<title>`, a compelling meta description, a self-referencing canonical, and correct Open Graph/Twitter tags. Every non-public page is `noindex`.

You already have the machinery: `src/components/seo/SEO.tsx` + `react-helmet-async`. The problem is **only 7 of 63 pages use it.** Fix the component's defaults (domain), then add `<SEO>` to every public page and `noIndex` to every private one.

### 3.1 Harden the `SEO` component
In `src/components/seo/SEO.tsx`:
- Update `siteUrl`, `defaultImage`, and the logo URL in `generateArticleSchema` to `mfunding.net` (Phase 1).
- **Always emit a canonical**, not only when one is passed. Change the logic so the canonical defaults to `siteUrl + current path`. A missing canonical on a JS-routed SPA means duplicate-URL risk (trailing slash, query params, etc.).
- Confirm `og:image:width`/`height` and `og:image:alt` are emitted (helps link previews).

### 3.2 Add `<SEO>` to every PUBLIC page that's missing it
These public, indexable pages currently set **no** title/description — add a tailored `<SEO>` to each:

| Page file | Suggested `<title>` | Primary keyword target |
|---|---|---|
| `AboutPage.tsx` | About Momentum Funding — Small Business Capital | brand + trust |
| `ContactPage.tsx` | Contact Momentum Funding — Talk to a Funding Advisor | brand + contact |
| `PartnersPage.tsx` | Referral Partner Program — Earn Per Funded Deal | "funding referral partner program" |
| `ResourcesPage.tsx` | Business Funding Resources & Guides | "business funding guides" |
| `ResourceDetailPage.tsx` | *(dynamic — `post.title`)* | per-article long-tail |
| `VCFReliefPage.tsx` | MCA Debt Relief & Restructuring | "MCA debt relief", "merchant cash advance consolidation" |
| `PrivacyPolicyPage.tsx` | Privacy Policy | brand (low priority, still needs canonical) |
| `TermsOfServicePage.tsx` | Terms of Service | brand |

Example for a static page:
```tsx
import SEO from '@/components/seo/SEO'

<SEO
  title="MCA Debt Relief & Restructuring"
  description="Drowning in daily merchant cash advance payments? Momentum Funding helps small businesses restructure, consolidate, and reduce MCA debt. Free consultation, no upfront fees."
  canonical="https://mfunding.net/debt-relief"
  keywords="MCA debt relief, merchant cash advance consolidation, restructure MCA, reduce daily payments"
/>
```

Example for a dynamic blog page (`ResourceDetailPage.tsx`):
```tsx
<SEO
  title={post.title}
  description={post.excerpt ?? post.title}
  canonical={`https://mfunding.net/resources/${post.slug}`}
  ogType="article"
  ogImage={post.cover_image_url ?? undefined}
  structuredData={generateArticleSchema({
    title: post.title,
    description: post.excerpt ?? '',
    url: `https://mfunding.net/resources/${post.slug}`,
    image: post.cover_image_url ?? 'https://mfunding.net/og-image.jpg',
    datePublished: post.published_at ?? post.created_at,
    author: post.author ?? 'Momentum Funding',
  })}
/>
```

### 3.3 `noindex` every PRIVATE / utility page
Add `<SEO noIndex />` (or reuse `AdminPageSEO` / `SignInPageSEO`) to:
- All `/admin/*` pages (40+) — wrap once in the admin layout so you don't repeat it.
- All `/portal/*` pages and `/protected`.
- `/auth/sign-in` (already noindex via `SignInPageSEO` ✓), and add noindex to `/optin` and `/unit-economics` (thin/internal).
- `/apply` — judgment call: it embeds the GHL form. Keep it indexable **only** if it has real surrounding copy; otherwise canonical it to the relevant product page.

> The fastest win here: add the noindex `<SEO>` once in the **admin layout component** and once in the **portal layout component** so all child routes inherit it.

### 3.4 Title/description copywriting rules (apply to all)
- **Title:** ≤ 60 chars, primary keyword first, brand last. "Merchant Cash Advance — Funding in 24–48 Hours | Momentum Funding".
- **Description:** 140–160 chars, include the keyword + a number + a CTA ("93% approval, no collateral, apply in minutes").
- **Unique per page** — no two pages share a title.
- Match the `<h1>` intent to the `<title>` intent (you already have clean single-H1s per page — good).

**Phase 3 done when:** every public route shows a unique title/description in browser dev tools, and every admin/portal route emits `noindex`.

---

## PHASE 4 — Structured Data (Schema.org / JSON-LD)
**Outcome:** Rich results in Google (star ratings, FAQ accordions, breadcrumbs, sitelinks) and machine-readable facts that AI engines quote verbatim. Schema is the #1 lever for both rich snippets (SEO) and being cited correctly (GEO/AEO).

You already have strong JSON-LD in `index.html` (FinancialService + WebSite + ItemList + FAQPage + BreadcrumbList) — but it only loads on the homepage. Extend the pattern to the rest of the site via the `structuredData` prop the `<SEO>` component already supports.

### 4.1 Organization / FinancialService (site-wide, once)
Keep the homepage `FinancialService` block but **correct the facts and the domain**:
- `url`, `@id`, `logo` → `mfunding.net`
- `telephone` → (786) 840-9404, `email` → info@mfunding.net, `address` → 7027 W Broward Blvd, Suite 744, Plantation, FL 33317 (from ContactPage — make schema match the visible NAP exactly; NAP consistency matters for local/AEO).
- `aggregateRating`: **only keep this if it's real and verifiable.** Fake review counts (the current `4.9 / 2847 reviews`) are a Google manual-action risk *and* destroy trust when an AI engine cross-checks. Either back it with genuine Google reviews or remove the `aggregateRating` node. (See Phase 8 — get real reviews.)

### 4.2 Product pages → `FinancialProduct` / `LoanOrCredit` schema
Each `/business-loans/:slug` and `/real-estate/:slug` page should emit product schema with the real terms from your `src/data/products` and `src/data/cre-products` data. Build a `generateProductSchema()` helper next to `generateArticleSchema()`:
```ts
{
  '@context': 'https://schema.org',
  '@type': 'LoanOrCredit',          // use FinancialProduct for MCA (it's not a loan)
  name: product.name,
  description: product.description,
  provider: { '@type': 'FinancialService', name: 'Momentum Funding' },
  amount: { '@type': 'MonetaryAmount', minValue: 5000, maxValue: 3000000, currency: 'USD' },
  // do NOT label an MCA an interestRate/loan — see compliance note below
}
```
> **Compliance (from CLAUDE.md):** For **MCA** products use `FinancialProduct` and the language "advance / purchase of future receivables / working capital" — never "loan," never `interestRate`. For actual **loans** (SBA, term, equipment, CRE), `LoanOrCredit` with rate fields is correct. The schema must respect the same product-aware language rule as the rest of the site.

### 4.3 FAQ schema on every page that answers questions
Move the homepage FAQ into a reusable `<FAQ>` component that renders **both** the visible accordion **and** `FAQPage` JSON-LD from the same data array. Then put product-specific FAQs on each product page (e.g., on the MCA page: "Is an MCA a loan?", "How fast can I get funded?", "What credit score do I need?"). This is the bridge into Phase 6 (AEO) — FAQ schema is what wins "People Also Ask" and AI Overview citations.

### 4.4 BreadcrumbList on all nested pages
Emit `BreadcrumbList` schema on product/CRE/blog detail pages (Home › Business Loans › Merchant Cash Advance). Drives breadcrumb rich results and helps crawlers understand hierarchy.

### 4.5 Article schema on blog posts
Already scaffolded (`generateArticleSchema`) — just wire it in (done in Phase 3.2 example). Ensure `datePublished`/`dateModified`/`author`/`publisher` are populated.

**Phase 4 done when:** Google's [Rich Results Test](https://search.google.com/test/rich-results) passes with no errors on the homepage, a product page, and a blog post, and reports the eligible rich-result types (FAQ, Breadcrumb, Article, Product).

---

## PHASE 5 — On-Page Content, Semantic HTML & Internal Linking
**Outcome:** Each page is a strong, self-contained answer to a real query, with clean semantics, descriptive images, and a tight internal link graph. Your structure is already good here — this phase is about depth and the few defects.

### 5.1 Fix the image alt defects (quick win)
- `src/pages/ResourcesPage.tsx` → change `alt=""` to `alt={p.title}` on blog cover images.
- `src/pages/ResourceDetailPage.tsx` → change `alt=""` to `alt={post.title}`.
- Audit other `<img>`: team photos already use `alt={member.name}` ✓. Anywhere an image is purely decorative, keep `alt=""` *intentionally* (that's correct) — but content images must describe the image.

### 5.2 Image performance (feeds Phase 8 Core Web Vitals)
- Add `loading="lazy"` to below-the-fold images and `width`/`height` (or aspect-ratio) to every `<img>` to prevent layout shift (CLS).
- Serve hero/OG images as WebP/AVIF. Ensure `/public/og-image.jpg` (1200×630) actually exists — OG tags reference it.
- Add `fetchpriority="high"` to the LCP hero image.

### 5.3 Content depth on money pages
Product hub and detail pages currently run ~400 words. For competitive funding keywords, deepen the **detail** pages to 800–1,500 words of genuinely useful copy:
- What it is, who it's for, typical amounts/terms, how fast, qualification requirements, pros/cons, how it compares to alternatives, step-by-step "how to apply."
- Write to the question, not the keyword. Each product page should answer the 5–8 questions a business owner actually types.
- Keep the MCA-vs-loan language discipline throughout.

### 5.4 Publish the blog — and auto-generate the sitemap from it
The Resources system is built but has **0 published posts**. An empty `/resources` is a weak signal. Plan an initial 8–12 articles targeting bottom-of-funnel + question queries (these double as AEO/GEO fuel in Phase 6):
- "Is a merchant cash advance a loan?" / "MCA vs. business loan: which is right?"
- "How to qualify for business funding with bad credit"
- "How fast can you get a merchant cash advance?"
- "What is a factor rate and how does it work?"
- "How to get out of MCA debt" (ties to `/debt-relief`)
- "SBA 7(a) vs. term loan vs. line of credit"
- City/industry angle: "Business funding for [restaurants/construction/trucking]"

**Automate the sitemap** so it's never stale: add a build step (or Supabase edge function) that queries `blog_posts WHERE published = true` and writes `/resources/:slug` entries into `sitemap.xml` at build time. Tie this into the `vite-react-ssg` `includedRoutes` from Phase 2 so each published post is also prerendered.

### 5.5 Internal linking
- Replace homepage `/#anchor` nav targets with real crawlable destinations where possible, or ensure the anchor sections also exist as standalone indexable pages. `/#how-it-works`, `/#faq`, `/#case-study` are not separate URLs — fine for UX, but don't treat them as landing pages.
- From each blog post, link to the relevant product page (`/business-loans/merchant-cash-advance`) and to `/apply`. From product pages, link to 2–3 related products and relevant blog posts. This "topic cluster" linking is what concentrates ranking authority on your money pages.
- Keep the strong footer (it already links every product + legal + company page ✓).

### 5.6 Semantic HTML (mostly done — verify)
You already use one `<h1>` per page and `<main>/<section>/<article>/<footer>` well. Verify: navbar uses a real `<nav>`, the blog detail uses `<article>` (it does ✓), and heading order never skips (h1→h2→h3, no jumping to h4).

**Phase 5 done when:** no `alt=""` on content images, money pages are 800+ words, at least 8 blog posts are published and in the sitemap, and every blog post links out to a product + apply page.

---

## PHASE 6 — AEO (Answer Engine Optimization)
**Outcome:** You win featured snippets, "People Also Ask," Google AI Overviews, and voice answers — the zero-click surfaces where a business owner gets your answer (and brand) without scrolling.

AEO is mostly **content structure** + the schema from Phase 4 + the FAQ system. Generative engines and Google's AI extract *answers*, so format content as extractable answers.

### 6.1 Question-first content format
- Use the **literal question as an `<h2>`/`<h3>`**, immediately followed by a 40–55 word direct answer in the first sentence, then expand. ("**Is a merchant cash advance a loan?** No — an MCA is not a loan. It's the purchase of a portion of your business's future receivables…")
- This "inverted pyramid" (answer first, detail after) is exactly what gets lifted into snippets and AI Overviews.

### 6.2 Ship the FAQ system everywhere (from Phase 4.3)
Visible FAQ accordion + `FAQPage` JSON-LD on: home, each product page, `/debt-relief`, and `/business-loans` hub. This is the highest-ROI AEO asset for a funding brand because the queries are so question-shaped.

### 6.3 Structured, comparison, and "how-to" content
- **Tables** for comparisons (MCA vs. term loan vs. LOC: speed, amount, credit needed, cost structure). AI engines love tables — they get quoted directly.
- **`HowTo` schema** + numbered steps for "How to apply for business funding" (the 9-stage funnel makes natural step content).
- **Definitions/glossary**: your CLAUDE.md "Key Terminology" table is a ready-made glossary page (factor rate, retrieval rate, stips, points…). Publish it at `/resources/glossary` — glossary pages are AEO magnets.

### 6.4 Reverse the AI-bot block (this is the unlock)
This was done in Phase 1.2's robots.txt, but it's worth restating: **as long as `GPTBot`/`PerplexityBot`/`ClaudeBot`/`CCBot` are `Disallow`, none of your AEO/GEO content can ever be cited.** Confirm the new robots.txt is live.

### 6.5 Entity clarity
AI engines answer best when they're sure *who you are*. Make sure the Organization schema, the visible NAP (footer/contact), and your Google Business Profile all state the same name, address, phone, and description. Consistency = the engine trusts and cites you.

**Phase 6 done when:** Rich Results Test shows valid FAQ schema on 4+ pages, AI bots are allowed in robots.txt, and your top-5 question pages lead with a direct ≤55-word answer under an `<h2>` phrased as the question.

---

## PHASE 7 — GEO (Generative Engine Optimization) + Local/Location SEO
**Outcome:** ChatGPT, Perplexity, Claude, Gemini, and Copilot cite mfunding.net when users ask funding questions; and you capture local "near me" / city-level intent.

### 7.1 GEO — get cited by generative engines
GEO is won less by on-site tweaks and more by **being a credible, citable entity across the web.** With AI crawlers now allowed (Phase 1) and answer-shaped content live (Phase 6), add:
- **Third-party presence & mentions.** LLMs cite sources they encounter repeatedly: get listed/reviewed on industry directories, answer questions on Reddit/Quora about MCA/business funding, get a few PR mentions or guest posts. Citations and brand mentions are the currency of GEO.
- **Statistics and original data.** Generative engines preferentially quote pages with concrete numbers, dates, and named sources. Your funnel metrics, funding stats, and "average time to fund" make quotable, citable facts — present them cleanly with sources.
- **Clear authorship & dates.** Put author + published/updated dates on articles (Article schema, Phase 4.5). LLMs weight freshness and authorship.
- **`llms.txt` (optional, emerging).** Consider adding a `/public/llms.txt` summarizing what Momentum Funding is, your products, service areas, and key URLs — a growing convention some AI tools read to understand a site quickly. Low cost, future-facing.
- **Conversational long-tail content.** People ask AI in full sentences. Target "what's the fastest way to get $50k for my business with bad credit" — exactly the question-pages from Phase 6.

### 7.2 Local SEO — Google Business Profile (do this regardless of code)
You have a real FL address (Plantation, FL). This is free, high-ROI, and entirely off-codebase:
- Claim/verify **Google Business Profile** for Momentum Funding at 7027 W Broward Blvd, Suite 744. Category: "Loan agency" / "Financial consultant."
- Make NAP **identical** to the site footer and Organization schema (Phase 4.1).
- Collect **real** Google reviews (this is also how you legitimately earn the `aggregateRating` schema instead of faking it).
- Add to Bing Places and Apple Business Connect too (Apple Maps feeds Siri/Apple Intelligence).
- Add `LocalBusiness`/`FinancialService` schema with `geo` coordinates and `areaServed`.

### 7.3 City/location pages — coordinate with GHL
Per CLAUDE.md, city landing pages (Indianapolis, Phoenix, Columbus, DC, Sacramento, Miami) live on **GoHighLevel** at `funding.mfunding.com/[city]`, and Spanish campaigns too — they're **not** in this React app (the audit confirmed: cities appear only as example data in the case-study section, no `/phoenix` routes, no Spanish pages/i18n).
- **Decision point:** if you want those city pages to rank organically (not just receive paid traffic), they need the same SEO treatment as this doc — unique titles, schema, real content, and they must be in a sitemap GHL exposes. GHL pages are separately crawlable; make sure they're indexable and internally linked from this React site (e.g., a "Service Areas" page on mfunding.net linking to each city page) so authority flows.
- Cross-link both directions: React site → GHL city pages, and city pages → main product pages. Otherwise the two properties don't reinforce each other.
- If organic city ranking becomes a priority, consider building the city pages natively in React (where you control schema/prerender) instead of GHL — but that's a bigger decision; for now, coordinate.

### 7.4 Spanish-language SEO (future)
The Spanish campaigns are GHL-only today. If/when you want Spanish organic traffic on the main site, you'd add `hreflang` tags and `/es/` routes — out of scope now, flagged for later.

**Phase 7 done when:** Google Business Profile is verified with consistent NAP and real reviews, AI engines are allowed + answer-content is live, and there's a documented cross-linking plan between mfunding.net and the GHL city pages.

---

## PHASE 8 — Performance, Measurement & Ongoing Operations
**Outcome:** Fast Core Web Vitals, full visibility into how you're being crawled and ranked, and a repeatable monthly cadence so SEO compounds instead of decaying.

### 8.1 Core Web Vitals (Google ranking factor)
Measure with [PageSpeed Insights](https://pagespeed.web.dev/) and Lighthouse, then fix the usual SPA culprits:
- **LCP:** prerendering (Phase 2) already helps massively. Add `fetchpriority="high"` to the hero image; preload the hero/font.
- **CLS:** set explicit dimensions on all images (Phase 5.2); reserve space for the animated metrics so they don't shift layout.
- **INP/JS:** `framer-motion` is heavy — code-split with `React.lazy` for admin/portal routes (they should never load on public pages) and lazy-load below-the-fold animation. Check the Vite bundle; split vendor chunks.
- Self-host fonts or use `font-display: swap`.

### 8.2 Stand up measurement (do this early — you can't improve what you can't see)
- **Google Search Console** — verify mfunding.net (DNS or the existing meta tag), submit the new sitemap, watch Coverage/Indexing and Core Web Vitals reports. This is how you'll confirm Phase 1–2 actually got pages indexed.
- **Bing Webmaster Tools** — verify + submit sitemap (also feeds ChatGPT search, which uses Bing's index — a GEO twofer).
- **Google Analytics 4** (or privacy-friendly Plausible) for organic traffic.
- After deploy, use GSC's **URL Inspection → "Test live URL" → "View rendered HTML"** to confirm Google sees your prerendered content with real meta + JSON-LD.

### 8.3 Validate everything
- [Rich Results Test](https://search.google.com/test/rich-results) — schema on each template (home, product, blog, FAQ).
- [Schema Markup Validator](https://validator.schema.org/).
- Facebook Sharing Debugger + LinkedIn Post Inspector — confirm OG previews render (this is where the CSR-without-prerender problem shows up most visibly; Phase 2 fixes it).
- Crawl the live site with Screaming Frog (free ≤500 URLs) to catch broken links, missing titles, redirect chains, orphan pages.

### 8.4 Monthly operating cadence
- Publish 2–4 new question-shaped blog posts/month (Phase 5/6 pipeline) → auto-added to sitemap.
- Review GSC: which queries are impressions-without-clicks (improve titles), which pages are indexed vs. excluded (fix), what's your CTR.
- Refresh `dateModified` on updated articles (freshness signal for both SEO and GEO).
- Re-run Rich Results + PageSpeed after any significant template change.
- Watch for the real `aggregateRating` to become legitimate as reviews accumulate, then (and only then) keep it in schema.

**Phase 8 done when:** GSC + Bing + GA4 are live and receiving data, the sitemap is submitted and indexing, Core Web Vitals are "Good" on mobile, and you have a recurring monthly SEO review on the calendar.

---

# Quick-reference: do-this-first checklist

If you do nothing else this week, do these five — they unblock everything:

1. **[Phase 1]** Pick the canonical domain and find/replace `momentumfunding.com` → `mfunding.net` everywhere; 301 the other domain.
2. **[Phase 1/6]** Replace `robots.txt` to stop blocking AI crawlers and point at the real sitemap.
3. **[Phase 1]** Replace `sitemap.xml` with the real page list (no `#anchors`, no admin).
4. **[Phase 2+3]** Stand up `vite-react-ssg` prerendering **and** add `<SEO>` to all public pages (ship together).
5. **[Phase 8]** Verify Google Search Console + Bing Webmaster Tools and submit the sitemap.

---

# Appendix A — Files this plan touches

| File | Phase | Change |
|---|---|---|
| `index.html` | 1, 4 | Fix domain in canonical/OG/JSON-LD; correct org facts |
| `public/robots.txt` | 1, 6 | Full replace — allow AI bots, fix sitemap URL |
| `public/sitemap.xml` | 1, 5 | Full replace; later auto-generate |
| `netlify.toml` | 1 | Add 301 redirect for non-canonical domain |
| `src/components/seo/SEO.tsx` | 3, 4 | Fix domain defaults; always-emit canonical; add `generateProductSchema` |
| `src/main.tsx` | 2 | Switch to `ViteReactSSG` |
| `src/router/index.tsx` | 2 | Export `routes` array for SSG |
| `package.json` | 2 | `vite-react-ssg` dep + build script |
| `vite.config.ts` | 2, 8 | SSG config; manual chunks / code-split |
| `src/pages/*` (11 public pages) | 3 | Add `<SEO>` |
| Admin/Portal layout components | 3 | Add `<SEO noIndex />` once |
| `src/pages/ResourcesPage.tsx`, `ResourceDetailPage.tsx` | 5 | Fix `alt=""` → `alt={title}`; add Article/SEO |
| New `<FAQ>` component | 4, 6 | Visible accordion + `FAQPage` JSON-LD |
| New `/public/llms.txt` (optional) | 7 | AI-engine site summary |
| Blog content (`blog_posts`) | 5, 6 | Publish 8–12 question-shaped articles |

# Appendix B — The three discovery engines at a glance

| | SEO | AEO | GEO |
|---|---|---|---|
| **Engine** | Google/Bing blue links + maps | AI Overviews, snippets, PAA, voice | ChatGPT, Perplexity, Claude, Gemini |
| **Wins by** | Crawlable HTML, titles, links, authority | Question-format content + FAQ/HowTo schema | Citable entity, allowed crawlers, quotable facts |
| **Biggest blocker today** | CSR (no prerender) + wrong domain | FAQ not surfaced sitewide | AI bots blocked in robots.txt |
| **Fixed in** | Phase 1, 2, 3, 5, 8 | Phase 4, 6 | Phase 1, 6, 7 |

# Appendix C — Beyond SEO/AEO/GEO: every other discovery channel to cover

You asked if there are others. Yes — "discoverable everywhere" means more than the big three acronyms. Here's the complete map, what each one is, whether it matters for a funding brokerage, and where it's handled in this plan. Don't let the acronym soup distract you: most collapse into work you're already doing in Phases 1–8. The ones marked **ADD** are net-new and worth doing.

| Discipline | What it is | Worth it for you? | Where handled |
|---|---|---|---|
| **SXO** — Search Experience Optimization | Google increasingly ranks on *experience*: Core Web Vitals, mobile UX, dwell time, low pogo-sticking. Rankings + UX merged. | **High** | Phase 8 (CWV) + Phase 5 (content depth so people don't bounce) |
| **SMO** — Social Media Optimization | Perfect link previews + shareable content on FB/LinkedIn/X/iMessage/Slack. Driven by OG/Twitter tags + a real OG image. | **Medium** — funding gets shared by partners/referrers | Phase 3 (OG/Twitter) + Phase 2 (prerender so scrapers see them) |
| **LLMO / AIO** — LLM Optimization | Synonym for GEO/AEO — being the answer inside generative tools. Same playbook. | **High** | Phases 4, 6, 7 (already covered) |
| **VSO** — Voice Search Optimization | "Hey Siri, business loans near me." Conversational, local, question-shaped, featured-snippet-driven. | **Medium** | Phase 6 (question content) + Phase 7 (local/GBP) |
| **E-E-A-T** — Experience, Expertise, Authoritativeness, Trust | Google's quality framework. **Critical for "YMYL" (Your Money or Your Life) sites — and a funding/finance site is squarely YMYL.** Google holds finance content to a higher trust bar. | **VERY High** — **ADD** | See C.1 below — partly Phase 4/5/7, but needs dedicated work |
| **Local SEO / Map Pack** | Google Business Profile, NAP consistency, local citations, reviews. | **High** — you have a real FL address | Phase 7.2 |
| **Video SEO** | YouTube is the #2 search engine + video carousels in Google. "How MCA works" explainer videos rank and embed. | **Medium** — **ADD if you make video** | C.2 below |
| **Image SEO** | Descriptive alt, filenames, image sitemap → Google Images traffic. | **Low–Medium** | Phase 5.1/5.2 |
| **App Store Optimization (ASO)** | Only if you ship a mobile app. | **N/A** — you have no app | — |
| **Marketplace/Directory SEO** | Ranking on third-party platforms (Trustpilot, BBB, Lendio-style directories, Yelp, industry lists) that themselves rank #1 for your terms — and feed GEO citations. | **High** — **ADD** | C.3 below |
| **Reputation / Review optimization** | Reviews drive map-pack rank, rich-result stars, *and* AI trust. | **High** — **ADD** | C.1 + Phase 7.2 |

### C.1 E-E-A-T — the one you can't skip (YMYL)
A business-funding site is **YMYL** — content that can affect someone's finances. Google applies its strictest quality standards here, and AI engines weight trust signals heavily before citing a finance source. Concrete, actionable:
- **Named authors with credentials** on every article and key page. Dr. E. Lee (Founder), Stephanie Decker (VP Sales), Carlos Marquez (VP Ops) already exist on the About page — give them author bylines + `Person` schema with `jobTitle` and link articles to them.
- **About/Trust page depth:** real company history, FL registration, physical address, team photos (you have these ✓), funder relationships, "how we make money" transparency (you're paid by funders, never the merchant — say it; it's in CLAUDE.md compliance).
- **Trust signals visible:** licenses/registrations, security badges, real testimonials with names, BBB/Trustpilot links, privacy/terms (you have ✓).
- **Citations & sources** in content — link claims to authoritative sources (SBA.gov, Fed data). YMYL content that cites authorities ranks and gets quoted by AI.
- **No fake numbers.** The `4.9 / 2847 reviews` and `$2B+ funded` style claims must be true and ideally backed by a verifiable source. For YMYL, fabricated trust signals are both a manual-action risk and a GEO credibility killer. (Restated from Phase 4.1 — it matters that much.)

### C.2 Video SEO (ADD if you invest in video)
If you produce explainer videos ("What is a merchant cash advance?", "How fast can I get funded?"):
- Host on YouTube (own the #2 search engine) **and** embed on the matching page with `VideoObject` schema.
- Optimize YouTube title/description/tags for the same keywords as the page.
- Videos win video carousels in Google + get surfaced in AI answers.

### C.3 Off-site / marketplace presence (ADD — also fuels GEO)
For competitive funding terms, third-party platforms often outrank any brand site — so *be on them*:
- **Trustpilot, BBB, Google reviews** — claim profiles, gather reviews (also powers C.1 + Phase 7).
- **Industry directories / comparison sites** — get listed where business owners shop for funding.
- **Reddit / Quora** — answer MCA/funding questions authentically; these pages rank *and* are heavily cited by Perplexity/ChatGPT (direct GEO win).
- **PR / guest posts** — a few mentions on finance/SMB sites build the authority and citations that both Google E-E-A-T and LLMs reward.

> **Bottom line:** The only net-new disciplines worth dedicated effort are **E-E-A-T (YMYL trust)**, **off-site/marketplace presence**, and optionally **video**. Everything else folds into the 8 phases you already have.

---

# Appendix D — Keyword Research & Targeting Map (actionable)

Keywords mapped to the page that should own them, with intent and priority. **Intent legend:** TOF = top-of-funnel (research) · MOF = mid · **BOF = bottom-of-funnel (ready to apply — your money keywords)**. Prioritize BOF first; it converts to funded deals fastest.

> **Compliance reminder (CLAUDE.md):** for MCA, target "advance / funding / working capital," never "MCA loan." Keep loan terminology only for actual loan products (SBA, term, equipment, CRE).

### D.1 Page → primary + secondary keyword assignments

| Page | Primary keyword (BOF unless noted) | Secondary / long-tail to weave in |
|---|---|---|
| `/` Home | small business funding | fast business funding, business funding when banks say no, working capital for small business |
| `/business-loans` hub | business funding options | types of business financing, small business capital, alternative business funding |
| `/business-loans/merchant-cash-advance` | merchant cash advance | MCA funding, business cash advance, revenue-based funding, cash advance for business |
| `/business-loans/equipment-financing` | equipment financing | equipment loans for business, finance business equipment, heavy equipment financing |
| `/business-loans/startup-loans` | startup business loans | funding for new business, startup capital, business loans for startups |
| `/business-loans/sba-loans` | SBA 7(a) loan | SBA loan requirements, how to get an SBA loan, SBA loan for small business |
| `/business-loans/term-loans` | business term loan | small business term loan, fixed business loan, long-term business financing |
| `/business-loans/line-of-credit` | business line of credit | revolving business credit, LOC for small business, business credit line |
| `/real-estate` hub | commercial real estate financing | CRE loans, real estate investment financing |
| `/real-estate/hard-money-bridge` | hard money bridge loan | fix and flip loan, bridge financing real estate, hard money lender |
| `/real-estate/rental-investment` | rental property loan | DSCR loan, investment property financing, rental property mortgage |
| `/real-estate/commercial-mortgage` | commercial mortgage | commercial property loan, commercial real estate mortgage |
| `/real-estate/construction-loans` | construction loan | ground-up construction financing, commercial construction loan |
| `/debt-relief` | MCA debt relief | merchant cash advance consolidation, get out of MCA debt, restructure MCA, MCA settlement |
| `/partners` | funding referral partner program (MOF) | ISO partner program, become a funding broker, refer clients for funding |
| `/resources` + posts | *(question keywords — see D.2)* | TOF/MOF educational |

### D.2 Question keywords (TOF/MOF) → blog posts (these fuel AEO + GEO)
Each becomes a `/resources/:slug` article, formatted answer-first per Phase 6.1:
- "is a merchant cash advance a loan" → MCA vs loan explainer
- "how to get business funding with bad credit"
- "how fast can I get a merchant cash advance"
- "what is a factor rate" + "how does MCA payback work"
- "merchant cash advance vs business loan" / "MCA vs line of credit"
- "how to qualify for an SBA loan"
- "best business funding for [restaurants / construction / trucking / retail]" (industry long-tails)
- "how to get out of merchant cash advance debt" → links to `/debt-relief`
- "what documents do I need for business funding" (maps to your stips list)
- "how much does a merchant cash advance cost"

### D.3 Local keyword pattern (Phase 7 — GHL city pages + a "Service Areas" page)
Template: `[product] + [city]`. Highest-value combos for your target markets:
- "business funding Indianapolis" / "merchant cash advance Indianapolis"
- "small business loans Phoenix" / "business funding Phoenix AZ"
- "business funding Columbus Ohio" · "Cincinnati"
- "business funding Washington DC" / "Northern Virginia"
- "business funding Sacramento" · "business funding Miami / South Florida"
- "business funding near me" (drives map pack — Phase 7.2)
- Spanish (GHL, future): "financiamiento para negocios", "adelanto de efectivo para negocios"

### D.4 Negative / avoid list
- Don't target "personal loan," "payday loan," "consumer loan" — wrong audience, wrong compliance, brand risk.
- For MCA pages avoid "MCA loan," "merchant cash advance loan," "cash advance interest rate" — compliance violation (it's not a loan / has no interest rate; it's a factor rate).

### D.5 How to *do* the keyword research (so this list becomes data-driven, not guesses)
The list above is your starting hypothesis. Validate and expand it with real volume/difficulty data — actionable steps:
1. **Google Search Console (once live, Phase 8)** — your single best source: it shows the exact queries already bringing impressions. Mine "impressions, low CTR" queries → optimize those titles first. This is free, first-party, and beats any tool.
2. **Free/low-cost tools:** Google Keyword Planner (volume), Google autocomplete + "People Also Ask" + "Searches related to" (free long-tail mining), AnswerThePublic, Ahrefs/Semrush free tiers or Ubersuggest for difficulty.
3. **Competitor mining:** run 2–3 competing ISO/funding sites through Ahrefs/Semrush "Organic Keywords" to see what ranks for them.
4. **Cross-reference your Google Ads data** — you already run 5 campaigns (CLAUDE.md). The keywords/search terms that convert in *paid* are proven money keywords to also pursue *organically* (free, and you already know they convert). This is the fastest shortcut you have.
5. **Map → assign → write:** every validated keyword gets exactly one owner page (avoid two pages targeting the same term = "keyword cannibalization"). Update the table in D.1 as you learn.

> **Want me to build this out as a live spreadsheet?** I can pull your Google Ads converting search terms (via the GHL/ads data) and your future GSC queries into a prioritized keyword tracker with volume + assigned page + status. Say the word and I'll generate it.

---
*This document is the single source of truth for Momentum Funding's discovery strategy. Work the phases in order; Phases 1–3 are blocking, 4–8 compound. Appendix C covers the other disciplines (the only net-new ones are E-E-A-T/YMYL trust, off-site presence, and video). Appendix D is your keyword map — validate it with GSC + your existing paid-search data. Keep the MCA-is-not-a-loan language discipline (per CLAUDE.md) in every piece of content and schema you produce.*
