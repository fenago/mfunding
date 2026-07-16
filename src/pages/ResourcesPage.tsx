// ResourcesPage — the "Field Dispatch" library on the Momentum OS design.
// Restyled in place: same route (/resources), same blog data source. The list of
// published posts renders as a dispatch board of filing-card tiles.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ScrollToTop from "../components/ui/ScrollToTop";
import { OS_CSS, useOSFonts, OSSection, Eyebrow, Display, Lede } from "../components/landing/os/OSKit";
import OSNav from "../components/landing/os/OSNav";
import OSFooter from "../components/landing/os/OSFooter";
import { listPublishedPosts, type BlogPost } from "../services/blogService";
import SEO from "../components/seo/SEO";

export default function ResourcesPage() {
  useOSFonts();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { listPublishedPosts().then(setPosts).catch(() => setPosts([])).finally(() => setLoading(false)); }, []);

  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{CSS}</style>
      <SEO
        title="Business Funding Resources & Guides"
        description="Guides on business funding, merchant cash advances, cash flow, and growth — from the Momentum Funding team. Learn how to qualify, compare options, and get funded fast."
        keywords="business funding guides, merchant cash advance guide, business cash flow tips, how to get business funding"
      />
      <ScrollToTop />
      <OSNav />

      <OSSection tone="panel" id="resources">
        <div className="osres-head">
          <Eyebrow>FIELD DISPATCH</Eyebrow>
          <Display>
            GUIDES FROM THE<br /><span className="os-go">FUNDING DESK.</span>
          </Display>
          <Lede>
            Straight-talk playbooks on <strong>getting funded</strong>, reading your{" "}
            <strong>cash flow</strong>, and growing a business the bank overlooked. No fluff,
            no jargon — just what actually moves a deal.
          </Lede>
        </div>

        <div className="osres-boardtop">
          <span className="osres-boardtitle">RESOURCE LIBRARY · BOARD</span>
          <span className="osres-boardnote">
            {loading ? "LOADING…" : `${posts.length} ${posts.length === 1 ? "ENTRY" : "ENTRIES"} ON FILE`}
          </span>
        </div>

        {loading ? (
          <div className="osres-note os-mono">Loading the board…</div>
        ) : posts.length === 0 ? (
          <div className="osres-note os-mono">No articles filed yet — check back soon.</div>
        ) : (
          <div className="osres-grid" role="list">
            {posts.map((p, i) => (
              <Link key={p.id} to={`/resources/${p.slug}`} className="osres-card" role="listitem">
                {p.cover_image_url && (
                  <span className="osres-cover">
                    <img src={p.cover_image_url} alt={p.title} loading="lazy" width={640} height={360} />
                  </span>
                )}
                <span className="osres-body">
                  <span className="osres-meta">
                    <span className="osres-idx os-mono">{String(i + 1).padStart(2, "0")}</span>
                    <span className="osres-cat os-mono">{p.category}</span>
                  </span>
                  <span className="osres-title">{p.title}</span>
                  {p.excerpt && <span className="osres-excerpt">{p.excerpt}</span>}
                  <span className="osres-foot">
                    {p.published_at && (
                      <span className="osres-date os-mono">{new Date(p.published_at).toLocaleDateString()}</span>
                    )}
                    <span className="osres-read">Read <span aria-hidden>→</span></span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </OSSection>

      <OSFooter />
    </div>
  );
}

const CSS = `
.osres-head{max-width:44em;margin-bottom:40px}

.osres-boardtop{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  font-family:'Space Mono',monospace;font-size:12px;letter-spacing:.14em;color:var(--muted);
  padding:0 2px 12px;border-bottom:1px solid var(--hair);margin-bottom:24px;
}
.osres-boardnote{color:var(--faint)}
.osres-note{padding:40px 2px;color:var(--muted);font-size:13px;letter-spacing:.06em}

.osres-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px}
.osres-card{
  position:relative;display:flex;flex-direction:column;
  background:linear-gradient(180deg,var(--panel),var(--panel2));
  border:1px solid var(--hair);border-radius:14px;overflow:hidden;text-decoration:none;
  transition:border-color .18s,transform .18s;
}
.osres-card::before{
  content:"";position:absolute;left:0;top:0;bottom:0;width:2px;
  background:linear-gradient(180deg,var(--go),var(--go-deep));opacity:0;transition:opacity .18s;z-index:2;
}
.osres-card:hover{border-color:rgba(22,217,146,.35);transform:translateY(-3px)}
.osres-card:hover::before{opacity:1}

.osres-cover{display:block;position:relative;aspect-ratio:16/9;overflow:hidden;background:var(--panel2)}
.osres-cover img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s}
.osres-card:hover .osres-cover img{transform:scale(1.04)}

.osres-body{display:flex;flex-direction:column;gap:10px;padding:22px 24px 20px;flex:1}
.osres-meta{display:flex;align-items:center;gap:12px}
.osres-idx{font-size:12px;color:var(--faint);letter-spacing:.06em}
.osres-cat{
  font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--go-text);
  border:1px solid var(--hair);border-radius:999px;padding:4px 11px;
}
.osres-title{font-size:19px;font-weight:700;line-height:1.28;color:var(--tx);letter-spacing:.005em}
.osres-excerpt{font-size:14.5px;line-height:1.6;color:var(--lede);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.osres-foot{
  margin-top:auto;padding-top:8px;display:flex;align-items:center;justify-content:space-between;gap:12px;
}
.osres-date{font-size:11.5px;letter-spacing:.06em;color:var(--faint)}
.osres-read{font-size:13px;font-weight:600;color:var(--go-text);display:inline-flex;align-items:center;gap:7px}

@media (max-width:760px){
  .osres-grid{grid-template-columns:1fr}
}
`;
