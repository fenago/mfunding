import { useState, useEffect, useCallback } from "react";
import supabase from "../supabase";

export type EntityType = "customer" | "lender" | "marketing_vendor";

export interface ActivityEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  interaction_type: string;
  subject: string | null;
  content: string | null;
  old_status: string | null;
  new_status: string | null;
  call_duration: number | null;
  call_outcome: string | null;
  follow_up_date: string | null;
  logged_by: string | null;
  logged_by_name?: string;
  created_at: string;
}

export function useActivityLog(entityType: EntityType, entityId: string | undefined) {
  const [activities, setActivities] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchActivities = useCallback(async () => {
    if (!entityId) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from("activity_log")
      .select(
        `
        *,
        profiles:logged_by (
          first_name,
          last_name
        )
      `
      )
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching activity log:", error);
    } else if (data) {
      const mapped = data.map((item: any) => ({
        ...item,
        logged_by_name: item.profiles
          ? `${item.profiles.first_name || ""} ${item.profiles.last_name || ""}`.trim()
          : null,
      }));
      setActivities(mapped);
    }
    setIsLoading(false);
  }, [entityType, entityId]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const addActivity = async (data: {
    interaction_type: string;
    subject?: string;
    content: string;
    follow_up_date?: string;
    created_at?: string;
  }) => {
    if (!entityId) return;

    const insertData: any = {
      entity_type: entityType,
      entity_id: entityId,
      interaction_type: data.interaction_type,
      subject: data.subject || null,
      content: data.content,
      follow_up_date: data.follow_up_date || null,
    };

    if (data.created_at) {
      insertData.created_at = data.created_at;
    }

    const { error } = await supabase.from("activity_log").insert(insertData);

    if (error) {
      console.error("Error adding activity:", error);
      throw error;
    }

    await fetchActivities();
  };

  return { activities, isLoading, addActivity, refetch: fetchActivities };
}
