import supabase from "../supabase";
import type { SubISO, SubISOFormData } from "../types/commissions";

export async function getAllSubISOs(): Promise<SubISO[]> {
  const { data, error } = await supabase
    .from("sub_isos")
    .select("*")
    .order("company_name", { ascending: true });

  if (error) throw error;
  return (data || []) as SubISO[];
}

export async function getSubISOById(id: string): Promise<SubISO> {
  const { data, error } = await supabase
    .from("sub_isos")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as SubISO;
}

export async function createSubISO(formData: SubISOFormData): Promise<SubISO> {
  const { data: { user } } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("sub_isos")
    .insert({ ...formData, created_by: user?.id })
    .select()
    .single();

  if (error) throw error;
  return data as SubISO;
}

export async function updateSubISO(id: string, formData: Partial<SubISOFormData>): Promise<SubISO> {
  const { data, error } = await supabase
    .from("sub_isos")
    .update(formData)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as SubISO;
}

export async function deleteSubISO(id: string) {
  const { error } = await supabase.from("sub_isos").delete().eq("id", id);
  if (error) throw error;
}

export async function getSubISODealStats(subISOId: string) {
  const { data: commissions, error } = await supabase
    .from("commissions")
    .select("gross_commission, override_amount, payment_status, created_at")
    .eq("sub_iso_id", subISOId);

  if (error) throw error;

  const all = commissions || [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thisMonth = all.filter((c) => c.created_at >= monthStart);

  return {
    totalDeals: all.length,
    totalOverrideEarned: all.reduce((sum, c) => sum + (c.override_amount || 0), 0),
    totalGrossCommission: all.reduce((sum, c) => sum + (c.gross_commission || 0), 0),
    pendingPayments: all.filter((c) => c.payment_status === 'pending').length,
    thisMonthDeals: thisMonth.length,
    thisMonthOverride: thisMonth.reduce((sum, c) => sum + (c.override_amount || 0), 0),
  };
}

export async function getActiveSubISOCount(): Promise<number> {
  const { count, error } = await supabase
    .from("sub_isos")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");

  if (error) throw error;
  return count || 0;
}
