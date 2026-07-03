import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body: string;
  category: string;
  cover_image_url: string | null;
  author: string | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
}

export type BlogPostInput = Omit<BlogPost, "id" | "created_at">;

export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Published posts only (public). */
export async function listPublishedPosts(): Promise<BlogPost[]> {
  const { data, error } = await supabase
    .from("blog_posts").select("*").eq("published", true)
    .order("published_at", { ascending: false });
  if (error) throw error;
  return (data || []) as BlogPost[];
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  const { data, error } = await supabase.from("blog_posts").select("*").eq("slug", slug).maybeSingle();
  if (error) throw error;
  return (data as BlogPost) ?? null;
}

/** All posts incl. drafts (super-admin; RLS enforces). */
export async function listAllPosts(): Promise<BlogPost[]> {
  const { data, error } = await supabase.from("blog_posts").select("*").order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []) as BlogPost[];
}

export async function savePost(id: string | null, input: Partial<BlogPostInput>): Promise<BlogPost> {
  if (id) {
    const rows = await mustWrite<BlogPost>("update blog post", supabase.from("blog_posts").update(input).eq("id", id));
    return rows[0];
  }
  const rows = await mustWrite<BlogPost>("create blog post", supabase.from("blog_posts").insert(input));
  return rows[0];
}

export async function deletePost(id: string): Promise<void> {
  await mustWrite("delete blog post", supabase.from("blog_posts").delete().eq("id", id));
}
