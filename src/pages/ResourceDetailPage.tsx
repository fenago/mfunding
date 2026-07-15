import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import ScrollToTop from "../components/ui/ScrollToTop";
import { getPostBySlug, type BlogPost } from "../services/blogService";
import SEO, { generateArticleSchema } from "../components/seo/SEO";

export default function ResourceDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    getPostBySlug(slug).then(setPost).catch(() => setPost(null)).finally(() => setLoading(false));
  }, [slug]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Navbar lightBg />
      <ScrollToTop />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-12">
        <Link to="/resources" className="text-sm text-ocean-blue hover:underline">← All resources</Link>
        {loading ? (
          <p className="text-gray-400 mt-6">Loading…</p>
        ) : !post || !post.published ? (
          <p className="text-gray-500 mt-6">Article not found.</p>
        ) : (
          <article className="mt-6">
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
            <span className="text-xs uppercase tracking-wide text-ocean-blue">{post.category}</span>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{post.title}</h1>
            <div className="text-sm text-gray-400 mt-2">
              {post.author && <span>{post.author} · </span>}
              {post.published_at && <span>{new Date(post.published_at).toLocaleDateString()}</span>}
            </div>
            {post.cover_image_url && <img src={post.cover_image_url} alt={post.title} loading="lazy" className="w-full rounded-xl mt-6" />}
            <div className="prose dark:prose-invert max-w-none mt-6 text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
              {post.body}
            </div>

            {/* Internal links — every article funnels to money pages (topic-cluster linking) */}
            <aside className="mt-12 border-t border-gray-200 dark:border-gray-700 pt-8">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Explore funding options</h2>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link to="/business-loans/merchant-cash-advance" className="text-sm px-4 py-2 rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-ocean-blue hover:text-ocean-blue transition-colors">Merchant Cash Advance</Link>
                <Link to="/business-loans/line-of-credit" className="text-sm px-4 py-2 rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-ocean-blue hover:text-ocean-blue transition-colors">Business Line of Credit</Link>
                <Link to="/business-loans" className="text-sm px-4 py-2 rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-ocean-blue hover:text-ocean-blue transition-colors">All Funding Products</Link>
                <Link to="/debt-relief" className="text-sm px-4 py-2 rounded-full border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-ocean-blue hover:text-ocean-blue transition-colors">MCA Debt Relief</Link>
              </div>
              <Link to="/apply" className="inline-block mt-6 px-6 py-3 rounded-xl bg-ocean-blue text-white font-semibold hover:opacity-90 transition-opacity">
                Apply for funding →
              </Link>
            </aside>
          </article>
        )}
      </main>
      <Footer />
    </div>
  );
}
