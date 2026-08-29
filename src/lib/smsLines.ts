// The company SMS numbers (sending "lines"). Today there is exactly one — the
// JMP.chat number bridged over XMPP — but the feature is architected for more so
// that adding a second number (see the runbook on the admin page) is a data
// change, not a code change.
//
// DEFENSIVE BY CONTRACT: the `sms_lines` table is being added by the backend in
// parallel. If it does not exist yet, is unreadable, or is empty, every reader
// here FALLS BACK to the one known line rather than crashing or showing nothing.
// An unreadable line list must never leave the compose box with no "from" number.
import supabase from "@/supabase";

export interface SmsLine {
  /** NULL only for the hardcoded fallback — a real row always has an id. */
  id: string | null;
  phone: string; // E.164
  label: string;
  provider?: string | null;
  jid?: string | null;
  is_active?: boolean | null;
  is_default?: boolean | null;
}

/** The one number we know exists even with no table behind it. */
export const FALLBACK_LINE: SmsLine = {
  id: null,
  phone: "+17865041159",
  label: "Main line",
  provider: "jmp",
  jid: "mfunding@xmpp.chat",
  is_active: true,
  is_default: true,
};

/** Active lines, default first. Always returns at least the fallback line —
 *  never an empty array, never a throw. */
export async function loadActiveSmsLines(): Promise<SmsLine[]> {
  try {
    const { data, error } = await supabase
      .from("sms_lines")
      .select("id,phone,label,provider,jid,is_active,is_default")
      .eq("is_active", true)
      .order("is_default", { ascending: false })
      .order("label", { ascending: true });
    if (error || !data || data.length === 0) return [FALLBACK_LINE];
    return data as SmsLine[];
  } catch {
    return [FALLBACK_LINE];
  }
}

/** The default line to send from: the one flagged is_default, else the first. */
export function defaultLine(lines: SmsLine[]): SmsLine {
  return lines.find((l) => l.is_default) ?? lines[0] ?? FALLBACK_LINE;
}
