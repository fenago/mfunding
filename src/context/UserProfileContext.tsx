import { createContext, useContext, useEffect, useState } from "react";
import supabase from "../supabase";
import { mustWrite } from "@/supabase/writes";
import { useSession } from "./SessionContext";

export type UserRole = "user" | "closer" | "employee" | "admin" | "super_admin";

const PROFILE_COLS =
  "id, email, display_name, first_name, last_name, role, avatar_url, company_name, business_address, company_phone, ein";
const IMPERSONATE_KEY = "mf_impersonate_uid";

export interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: UserRole;
  avatar_url: string | null;
  company_name: string | null;
  business_address: string | null;
  company_phone: string | null;
  ein: string | null;
}

interface UserProfileContextType {
  /** Effective profile — the impersonated user when impersonating, otherwise the real one. */
  profile: UserProfile | null;
  isLoading: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isCloser: boolean;
  /** Any internal backend user: closer, admin, or super_admin. */
  isStaff: boolean;
  refetchProfile: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: Error | null }>;

  // --- Impersonation ("view as") — super_admin only ---
  /** The actual signed-in user's profile, regardless of impersonation. */
  realProfile: UserProfile | null;
  /** True when a super_admin is viewing the app as another user. */
  isImpersonating: boolean;
  /** The user id whose data the app should reflect (impersonated id, else real id). */
  effectiveUserId: string | null;
  startImpersonation: (userId: string) => Promise<{ error: Error | null }>;
  stopImpersonation: () => void;
}

const UserProfileContext = createContext<UserProfileContextType>({
  profile: null,
  isLoading: true,
  isAdmin: false,
  isSuperAdmin: false,
  isCloser: false,
  isStaff: false,
  refetchProfile: async () => {},
  updateProfile: async () => ({ error: null }),
  realProfile: null,
  isImpersonating: false,
  effectiveUserId: null,
  startImpersonation: async () => ({ error: null }),
  stopImpersonation: () => {},
});

export const useUserProfile = () => {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error("useUserProfile must be used within a UserProfileProvider");
  }
  return context;
};

type Props = { children: React.ReactNode };

export const UserProfileProvider = ({ children }: Props) => {
  const { session } = useSession();
  const [realProfile, setRealProfile] = useState<UserProfile | null>(null);
  const [impersonated, setImpersonated] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = async () => {
    if (!session?.user?.id) {
      setRealProfile(null);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select(PROFILE_COLS)
        .eq("id", session.user.id)
        .single();

      if (error) {
        console.error("Error fetching profile:", error);
        setRealProfile(null);
      } else {
        setRealProfile(data as UserProfile);
      }
    } catch (err) {
      console.error("Error fetching profile:", err);
      setRealProfile(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Restore an impersonation session (e.g. after a page reload) once we know the
  // real user is a super_admin. Only super_admins may impersonate.
  useEffect(() => {
    if (realProfile?.role !== "super_admin") {
      setImpersonated(null);
      return;
    }
    const stored = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(IMPERSONATE_KEY) : null;
    if (stored && stored !== realProfile.id && !impersonated) {
      supabase
        .from("profiles")
        .select(PROFILE_COLS)
        .eq("id", stored)
        .single()
        .then(({ data }) => {
          if (data) setImpersonated(data as UserProfile);
          else sessionStorage.removeItem(IMPERSONATE_KEY);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realProfile?.id, realProfile?.role]);

  const isImpersonating = !!impersonated && realProfile?.role === "super_admin";
  const profile = isImpersonating ? impersonated : realProfile;

  // Employees get the same app access as admins, minus the super-admin-only
  // screens (which gate on isSuperAdmin). So employee is folded into isAdmin.
  const isAdmin =
    profile?.role === "admin" || profile?.role === "super_admin" || profile?.role === "employee";
  const isSuperAdmin = profile?.role === "super_admin";
  const isCloser = profile?.role === "closer";
  const isStaff = isCloser || isAdmin;

  const startImpersonation = async (userId: string): Promise<{ error: Error | null }> => {
    if (realProfile?.role !== "super_admin") {
      return { error: new Error("Only super admins can impersonate users") };
    }
    if (userId === realProfile.id) {
      return { error: new Error("You are already yourself") };
    }
    const { data, error } = await supabase.from("profiles").select(PROFILE_COLS).eq("id", userId).single();
    if (error || !data) {
      return { error: (error as unknown as Error) ?? new Error("User not found") };
    }
    sessionStorage.setItem(IMPERSONATE_KEY, userId);
    setImpersonated(data as UserProfile);
    return { error: null };
  };

  const stopImpersonation = () => {
    sessionStorage.removeItem(IMPERSONATE_KEY);
    setImpersonated(null);
  };

  const updateProfile = async (updates: Partial<UserProfile>): Promise<{ error: Error | null }> => {
    // Always writes to the real signed-in user — impersonation is view-only.
    if (!session?.user?.id) {
      return { error: new Error("No user session") };
    }

    try {
      await mustWrite("update profile", supabase.from("profiles").update(updates).eq("id", session.user.id));

      await fetchProfile();
      return { error: null };
    } catch (err) {
      console.error("Error updating profile:", err);
      return { error: err as Error };
    }
  };

  return (
    <UserProfileContext.Provider
      value={{
        profile,
        isLoading,
        isAdmin,
        isSuperAdmin,
        isCloser,
        isStaff,
        refetchProfile: fetchProfile,
        updateProfile,
        realProfile,
        isImpersonating,
        effectiveUserId: profile?.id ?? session?.user?.id ?? null,
        startImpersonation,
        stopImpersonation,
      }}
    >
      {children}
    </UserProfileContext.Provider>
  );
};
