import supabase from "../supabase";
import type { Closer, CloserFormData, CloserCommissionSummary } from "../types/commissions";

export async function getAllClosers(): Promise<Closer[]> {
  const { data, error } = await supabase
    .from("closers")
    .select("*")
    .order("first_name", { ascending: true });

  if (error) throw error;
  return (data || []) as Closer[];
}

export async function getCloserById(id: string): Promise<Closer> {
  const { data, error } = await supabase
    .from("closers")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data as Closer;
}

export async function createCloser(formData: CloserFormData): Promise<Closer> {
  const { data, error } = await supabase
    .from("closers")
    .insert(formData)
    .select()
    .single();

  if (error) throw error;
  return data as Closer;
}

export async function updateCloser(id: string, formData: Partial<CloserFormData>): Promise<Closer> {
  const { data, error } = await supabase
    .from("closers")
    .update(formData)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Closer;
}

export async function deleteCloser(id: string) {
  const { error } = await supabase.from("closers").delete().eq("id", id);
  if (error) throw error;
}

export async function getCloserPerformance(closerId: string): Promise<CloserCommissionSummary> {
  const closer = await getCloserById(closerId);

  // Fetch commission data for this closer
  const { data: commissions, error } = await supabase
    .from("commissions")
    .select("gross_commission, closer_amount, created_at, deal:deals(amount_funded)")
    .eq("closer_id", closerId);

  if (error) throw error;

  const allCommissions = commissions || [];

  // This month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thisMonthCommissions = allCommissions.filter((c) => c.created_at >= monthStart);

  const totalGross = allCommissions.reduce((sum, c) => sum + (c.gross_commission || 0), 0);
  const totalCloserPayout = allCommissions.reduce((sum, c) => sum + (c.closer_amount || 0), 0);
  const dealAmounts = allCommissions
    .map((c) => {
      const deal = c.deal as unknown as { amount_funded: number | null } | null;
      return deal?.amount_funded || 0;
    })
    .filter((a) => a > 0);
  const avgDealSize = dealAmounts.length > 0
    ? dealAmounts.reduce((a, b) => a + b, 0) / dealAmounts.length
    : 0;

  return {
    closer,
    totalDeals: allCommissions.length,
    totalFunded: closer.total_deals_funded,
    closeRate: closer.close_rate,
    totalGrossCommission: totalGross,
    totalCloserPayout: totalCloserPayout,
    avgDealSize,
    thisMonthDeals: thisMonthCommissions.length,
    thisMonthCommission: thisMonthCommissions.reduce(
      (sum, c) => sum + (c.closer_amount || 0),
      0
    ),
  };
}

export async function getActiveCloserCount(): Promise<number> {
  const { count, error } = await supabase
    .from("closers")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");

  if (error) throw error;
  return count || 0;
}
