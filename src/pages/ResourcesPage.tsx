import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpenIcon } from "@heroicons/react/24/outline";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import ScrollToTop from "../components/ui/ScrollToTop";
import { listPublishedPosts, type BlogPost } from "../services/blogService";

export default function ResourcesPage() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { listPublishedPosts().then(setPosts).catch(() => setPosts([])).finally(() => setLoading(false)); }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Navbar />
      <ScrollToTop />
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <BookOpenIcon className="w-12 h-12 text-ocean-blue mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Resources</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">Guides on business funding, cash flow, and growth.</p>
        </div>

        {loading ? (
          <p className="text-center text-gray-400">Loading…</p>
        ) : posts.length === 0 ? (
          <p className="text-center text-gray-500">No articles yet — check back soon.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-6">
            {posts.map((p) => (
              <Link key={p.id} to={`/resources/${p.slug}`}
                className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:border-ocean-blue transition-colors">
                {p.cover_image_url && <img src={p.cover_image_url} alt="" className="w-full h-40 object-cover" />}
                <div className="p-5">
                  <span className="text-xs uppercase tracking-wide text-ocean-blue">{p.category}</span>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white mt-1">{p.title}</h2>
                  {p.excerpt && <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 line-clamp-3">{p.excerpt}</p>}
                  {p.published_at && <p className="text-xs text-gray-400 mt-3">{new Date(p.published_at).toLocaleDateString()}</p>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
