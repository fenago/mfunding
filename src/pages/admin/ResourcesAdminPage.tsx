import { useEffect, useState } from "react";
import { BookOpenIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { listAllPosts, savePost, deletePost, slugify, type BlogPost } from "../../services/blogService";

const BLANK = {
  slug: "", title: "", excerpt: "", body: "", category: "general",
  cover_image_url: "", author: "", published: false,
};

export default function ResourcesAdminPage() {
  const [rows, setRows] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof BLANK>(BLANK);
  const [busy, setBusy] = useState(false);

  async function load() { setLoading(true); try { setRows(await listAllPosts()); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);

  function add() { setEditId(null); setForm(BLANK); setOpen(true); }
  function edit(p: BlogPost) {
    setEditId(p.id);
    setForm({
      slug: p.slug, title: p.title, excerpt: p.excerpt ?? "", body: p.body, category: p.category,
      cover_image_url: p.cover_image_url ?? "", author: p.author ?? "", published: p.published,
    });
    setOpen(true);
  }
  async function save() {
    setBusy(true);
    try {
      const slug = form.slug.trim() || slugify(form.title);
      const wasPublished = rows.find((r) => r.id === editId)?.published;
      await savePost(editId, {
        ...form, slug,
        published_at: form.published && !wasPublished ? new Date().toISOString() : (rows.find((r) => r.id === editId)?.published_at ?? null),
      });
      setOpen(false); load();
    } finally { setBusy(false); }
  }
  async function remove(id: string) { await deletePost(id); load(); }

  const input = "mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BookOpenIcon className="w-6 h-6 text-ocean-blue" /> Resources / Blog
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Write and publish articles shown at /resources.</p>
        </div>
        <button onClick={add} className="btn-primary inline-flex items-center gap-2"><PlusIcon className="w-4 h-4" /> New post</button>
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="py-3 px-4">Title</th><th className="py-3 px-4">Category</th><th className="py-3 px-4">Status</th><th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 dark:border-gray-800">
                  <td className="py-3 px-4 font-medium text-gray-900 dark:text-white">{p.title}<div className="text-xs text-gray-400 font-mono">/{p.slug}</div></td>
                  <td className="py-3 px-4 text-gray-500">{p.category}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${p.published ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-gray-700"}`}>
                      {p.published ? "published" : "draft"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button onClick={() => edit(p)} className="text-ocean-blue hover:underline mr-3">Edit</button>
                    <button onClick={() => remove(p.id)} className="text-gray-400 hover:text-red-500"><TrashIcon className="w-4 h-4 inline" /></button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-gray-400">No posts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 dark:text-white mb-4">{editId ? "Edit" : "New"} post</h3>
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-sm"><span className="text-gray-500">Title</span>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={input} /></label>
                <label className="text-sm"><span className="text-gray-500">Slug (auto if blank)</span>
                  <input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder={slugify(form.title)} className={input} /></label>
                <label className="text-sm"><span className="text-gray-500">Category</span>
                  <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={input} /></label>
                <label className="text-sm"><span className="text-gray-500">Author</span>
                  <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} className={input} /></label>
                <label className="text-sm sm:col-span-2"><span className="text-gray-500">Cover image URL</span>
                  <input value={form.cover_image_url} onChange={(e) => setForm({ ...form, cover_image_url: e.target.value })} className={input} /></label>
              </div>
              <label className="text-sm block"><span className="text-gray-500">Excerpt</span>
                <textarea value={form.excerpt} onChange={(e) => setForm({ ...form, excerpt: e.target.value })} className={`${input} h-16`} /></label>
              <label className="text-sm block"><span className="text-gray-500">Body</span>
                <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className={`${input} h-48 font-mono`} /></label>
              <label className="text-sm flex items-center gap-2">
                <input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} /> Published
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-gray-500">Cancel</button>
              <button onClick={save} disabled={busy || !form.title} className="btn-primary text-sm disabled:opacity-60">{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
