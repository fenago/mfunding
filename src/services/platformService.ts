import supabase from "../supabase";

// Key-value platform settings (white-label branding + misc super-admin config).

export interface Branding {
  company_name: string;
  tagline: string;
  primary_color: string;
  accent_color: string;
  logo_url: string;
  support_email: string;
}

export const DEFAULT_BRANDING: Branding = {
  company_name: "Momentum Funding",
  tagline: "Business funding, fast.",
  primary_color: "#0A3D62",
  accent_color: "#34C759",
  logo_url: "",
  support_email: "",
};

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await supabase.from("platform_settings").select("value").eq("key", key).maybeSingle();
  return { ...fallback, ...((data?.value as Partial<T>) ?? {}) };
}

export async function saveSetting<T>(key: string, value: T): Promise<void> {
  const { error } = await supabase.from("platform_settings").upsert({ key, value }, { onConflict: "key" });
  if (error) throw error;
}

export const getBranding = () => getSetting<Branding>("branding", DEFAULT_BRANDING);
export const saveBranding = (b: Branding) => saveSetting("branding", b);
