#!/usr/bin/env node
/**
 * Build-time sitemap generator for mfunding.net.
 *
 * Writes public/sitemap.xml from:
 *   1. A fixed list of public marketing routes (always included), and
 *   2. Published blog posts pulled from Supabase (/resources/:slug), if reachable.
 *
 * This script is intentionally fault-tolerant: if Supabase credentials are
 * missing or the project is paused/unreachable, it still writes a valid sitemap
 * with the static routes and exits 0 so the build never fails.
 *
 * Wired into `npm run build` via the build script in package.json.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SITE = 'https://mfunding.net';
const OUT = resolve(ROOT, 'public/sitemap.xml');

// Static public routes (keep in sync with the router's public routes).
const STATIC = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/business-loans', changefreq: 'weekly', priority: '0.9' },
  { loc: '/business-loans/merchant-cash-advance', priority: '0.9' },
  { loc: '/business-loans/equipment-financing', priority: '0.8' },
  { loc: '/business-loans/startup-loans', priority: '0.8' },
  { loc: '/business-loans/sba-loans', priority: '0.8' },
  { loc: '/business-loans/term-loans', priority: '0.8' },
  { loc: '/business-loans/line-of-credit', priority: '0.8' },
  { loc: '/real-estate', changefreq: 'weekly', priority: '0.9' },
  { loc: '/real-estate/hard-money-bridge', priority: '0.8' },
  { loc: '/real-estate/rental-investment', priority: '0.8' },
  { loc: '/real-estate/commercial-mortgage', priority: '0.8' },
  { loc: '/real-estate/construction-loans', priority: '0.8' },
  { loc: '/debt-relief', changefreq: 'monthly', priority: '0.8' },
  { loc: '/calculators/mca-debt-relief', changefreq: 'monthly', priority: '0.7' },
  { loc: '/calculators/how-much-can-i-get', changefreq: 'monthly', priority: '0.7' },
  { loc: '/calculators/advance-cost', changefreq: 'monthly', priority: '0.7' },
  { loc: '/about', changefreq: 'monthly', priority: '0.6' },
  { loc: '/contact', changefreq: 'monthly', priority: '0.6' },
  { loc: '/partners', changefreq: 'monthly', priority: '0.6' },
  { loc: '/resources', changefreq: 'weekly', priority: '0.7' },
  { loc: '/resources/glossary', changefreq: 'monthly', priority: '0.6' },
  { loc: '/privacy', changefreq: 'yearly', priority: '0.3' },
  { loc: '/terms', changefreq: 'yearly', priority: '0.3' },
];

/** Minimal .env loader so this works locally without extra deps. */
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

async function fetchBlogSlugs() {
  loadEnv();
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.warn('[sitemap] Supabase env not set — emitting static routes only.');
    return [];
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(
      `${url}/rest/v1/blog_posts?select=slug,published_at&published=eq.true`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: ctrl.signal }
    );
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = await res.json();
    console.log(`[sitemap] ${rows.length} published post(s) added.`);
    return rows.map((r) => ({
      loc: `/resources/${r.slug}`,
      lastmod: r.published_at ? String(r.published_at).slice(0, 10) : undefined,
      priority: '0.6',
    }));
  } catch (e) {
    console.warn(`[sitemap] Could not reach Supabase (${e.message}) — static routes only.`);
    return [];
  }
}

function toXml(entries) {
  const urls = entries
    .map((e) => {
      const parts = [`<loc>${SITE}${e.loc}</loc>`];
      if (e.lastmod) parts.push(`<lastmod>${e.lastmod}</lastmod>`);
      if (e.changefreq) parts.push(`<changefreq>${e.changefreq}</changefreq>`);
      if (e.priority) parts.push(`<priority>${e.priority}</priority>`);
      return `  <url>${parts.join('')}</url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

const blog = await fetchBlogSlugs();
writeFileSync(OUT, toXml([...STATIC, ...blog]));
console.log(`[sitemap] Wrote ${STATIC.length + blog.length} URLs to public/sitemap.xml`);
