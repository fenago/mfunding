// ResourceDetailPage — the long-form article template on the Momentum OS design.
// Restyled in place: same route (/resources/:slug), same blog data + SEO/schema.
// The priority here is beautiful, calm long-form reading typography inside the OS look:
// a narrow measure, generous line height, mono meta, and the green signal used sparingly.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ScrollToTop from "../components/ui/ScrollToTop";
import { OS_CSS, useOSFonts } from "../components/landing/os/OSKit";
import OSNav from "../components/landing/os/OSNav";
import OSFooter from "../components/landing/os/OSFooter";
import { getPostBySlug, type BlogPost } from "../services/blogService";
import SEO, { generateArticleSchema } from "../components/seo/SEO";

export default function ResourceDetailPage() {
  useOSFonts();
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    getPostBySlug(slug).then(setPost).catch(() => setPost(null)).finally(() => setLoading(false));
  }, [slug]);

  return (
    <div className="os-root">
      <style>{OS_CSS}</style>
      <style>{CSS}</style>
      <ScrollToTop />
      <OSNav />

      <main className="osart-main">
        <div className="os-container">
          <Link to="/resources" className="osart-back os-mono">← ALL RESOURCES</Link>

          {loading ? (
            <p className="osart-note os-mono">Loading…</p>
          ) : !post || !post.published ? (
            <p className="osart-note os-mono">Article not found.</p>
          ) : (
            <article className="osart">
              <SEO
                title={post.title}
                description={post.excerpt ?? post.title}
                canonical={`https://mfunding.net/resources/${post.slug}`}
                ogType="article"
                ogImage={post.cover_image_url ?? undefined}
                structuredData={generateArticleSchema({
                  title: post.title,
                  description: post.excerpt ?? "",
                  url: `https://mfunding.net/resources/${post.slug}`,
                  image: post.cover_image_url ?? "https://mfunding.net/og-image.jpg",
                  datePublished: post.published_at ?? post.created_at,
                  author: post.author ?? "Momentum Funding",
                })}
              />

              <header className="osart-head">
                <span className="osart-cat os-mono">{post.category}</span>
                <h1 className="osart-title">{post.title}</h1>
                <div className="osart-byline os-mono">
                  {post.author && <span>{post.author}</span>}
                  {post.author && post.published_at && <span className="osart-dot" aria-hidden>·</span>}
                  {post.published_at && <span>{new Date(post.published_at).toLocaleDateString()}</span>}
                </div>
              </header>

              {post.cover_image_url && (
                <figure className="osart-cover">
                  <img src={post.cover_image_url} alt={post.title} loading="lazy" />
                </figure>
              )}

              <div className="osart-body">{post.body}</div>

              {/* Internal links — every article funnels to money pages (topic-cluster linking) */}
              <aside className="osart-explore">
                <span className="osart-explore-eyebrow os-mono"><span className="osart-eyedot" />EXPLORE FUNDING OPTIONS</span>
                <div className="osart-chips">
                  <Link to="/business-loans/merchant-cash-advance" className="osart-chip">Merchant Cash Advance</Link>
                  <Link to="/business-loans/line-of-credit" className="osart-chip">Business Line of Credit</Link>
                  <Link to="/business-loans" className="osart-chip">All Funding Products</Link>
                  <Link to="/debt-relief" className="osart-chip">MCA Debt Relief</Link>
                </div>
                <Link to="/apply" className="osart-cta">Apply for funding <span aria-hidden>→</span></Link>
              </aside>
            </article>
          )}
        </div>
      </main>

      <OSFooter />
    </div>
  );
}

const CSS = `
.osart-main{background:var(--ink);padding:44px 0 96px;min-height:60vh}
.osart-back{
  display:inline-block;font-size:12px;letter-spacing:.14em;color:var(--muted);
  text-decoration:none;transition:color .15s;
}
.osart-back:hover{color:var(--go-text)}
.osart-note{color:var(--muted);margin-top:32px;font-size:13px;letter-spacing:.06em}

/* narrow reading column */
.osart{max-width:720px;margin:0 auto}
.osart-head{margin-top:34px}
.osart-cat{
  display:inline-block;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--go-text);
  border:1px solid var(--hair);border-radius:999px;padding:5px 13px;
}
.osart-title{
  font-family:'Anton',sans-serif;font-weight:400;text-transform:uppercase;letter-spacing:.006em;
  line-height:.98;font-size:clamp(30px,5vw,50px);color:var(--tx);margin:18px 0 0;
}
.osart-byline{margin-top:18px;font-size:12.5px;letter-spacing:.06em;color:var(--faint);display:flex;gap:9px;align-items:center}
.osart-dot{color:var(--go-text)}

.osart-cover{margin:34px 0 0;border:1px solid var(--hair);border-radius:16px;overflow:hidden;background:var(--panel2)}
.osart-cover img{width:100%;display:block}

/* long-form body — plain text (whitespace preserved) rendered as a calm reading measure */
.osart-body{
  margin-top:38px;
  font-family:'Inter',sans-serif;font-size:18px;line-height:1.75;color:var(--lede);
  white-space:pre-wrap;letter-spacing:.002em;
}
.osart-body strong{color:var(--tx);font-weight:600}

/* explore aside */
.osart-explore{margin-top:56px;padding-top:34px;border-top:1px solid var(--hair)}
.osart-explore-eyebrow{
  font-size:12px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase;
  display:inline-flex;align-items:center;gap:10px;
}
.osart-eyedot{width:8px;height:8px;border-radius:9px;background:var(--go);box-shadow:0 0 0 4px rgba(22,217,146,.16)}
.osart-chips{margin-top:20px;display:flex;flex-wrap:wrap;gap:12px}
.osart-chip{
  font-size:13.5px;font-weight:500;color:var(--tx);text-decoration:none;
  border:1px solid var(--hair);border-radius:999px;padding:9px 17px;
  transition:border-color .15s,color .15s,background .15s;
}
.osart-chip:hover{border-color:var(--go-text);color:var(--go-text);background:rgba(22,217,146,.06)}
.osart-cta{
  display:inline-flex;align-items:center;gap:10px;margin-top:28px;
  background:var(--go);color:var(--on-green);font-weight:700;font-size:15px;
  padding:14px 26px;border-radius:10px;text-decoration:none;
  box-shadow:0 10px 30px -8px rgba(22,217,146,.5);transition:transform .15s,box-shadow .15s;
}
.osart-cta:hover{transform:translateY(-2px);box-shadow:0 16px 40px -10px rgba(22,217,146,.6)}

@media (max-width:820px){
  .osart-body{font-size:17px}
}
@media (prefers-reduced-motion:reduce){
  .osart-cta:hover{transform:none}
}
`;
