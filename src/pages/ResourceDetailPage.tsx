import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import ScrollToTop from "../components/ui/ScrollToTop";
import { getPostBySlug, type BlogPost } from "../services/blogService";

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
      <Navbar />
      <ScrollToTop />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-12">
        <Link to="/resources" className="text-sm text-ocean-blue hover:underline">← All resources</Link>
        {loading ? (
          <p className="text-gray-400 mt-6">Loading…</p>
        ) : !post || !post.published ? (
          <p className="text-gray-500 mt-6">Article not found.</p>
        ) : (
          <article className="mt-6">
            <span className="text-xs uppercase tracking-wide text-ocean-blue">{post.category}</span>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{post.title}</h1>
            <div className="text-sm text-gray-400 mt-2">
              {post.author && <span>{post.author} · </span>}
              {post.published_at && <span>{new Date(post.published_at).toLocaleDateString()}</span>}
            </div>
            {post.cover_image_url && <img src={post.cover_image_url} alt="" className="w-full rounded-xl mt-6" />}
            <div className="prose dark:prose-invert max-w-none mt-6 text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
              {post.body}
            </div>
          </article>
        )}
      </main>
      <Footer />
    </div>
  );
}
