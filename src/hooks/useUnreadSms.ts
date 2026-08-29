import { useCallback, useEffect, useState } from "react";
import supabase from "../supabase";

// Unread count for the shared company SMS line (JMP.chat), driving the badge on
// the "Text Messages" sidebar item.
//
// SHARED LINE ⇒ ORG-WIDE UNREAD. The whole floor works one number, so "unread"
// is a single number for everyone, not per-user: the moment any staff member
// opens a thread, sms_mark_read() stamps read_at and this count drops for all.
//
// CHEAP BY DESIGN. Never loads rows — it calls sms_unread_count() (a staff-gated
// SECURITY DEFINER RPC that rides the partial unread index) and stores the int.
// It refetches on three signals: mount, any sms_messages realtime change (a new
// inbound text OR a mark-read), and window focus (so a tab left open overnight
// re-syncs when the operator comes back).
//
// UNREADABLE ≠ ZERO. If the count read fails we keep the last known value and do
// NOT reset to 0 — a badge silently dropping to zero would hide a waiting merchant.

export function useUnreadSms(): number {
  const [count, setCount] = useState(0);

  const refetch = useCallback(async () => {
    const { data, error } = await supabase.rpc("sms_unread_count");
    if (error) return; // keep the last known count; never claim zero on a failed read
    if (typeof data === "number") setCount(data);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Realtime: any insert/update on sms_messages can change the unread count — a
  // new inbound text raises it, a mark-read (read_at set) lowers it.
  useEffect(() => {
    const channel = supabase
      .channel("sms-unread-badge")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sms_messages" },
        () => void refetch(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refetch]);

  // Re-sync when the operator returns to the tab (covers a missed realtime event).
  useEffect(() => {
    const onFocus = () => {
      if (!document.hidden) void refetch();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refetch]);

  return count;
}
