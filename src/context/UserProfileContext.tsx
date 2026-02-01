import { createContext, useContext, useEffect, useState } from "react";
import supabase from "../supabase";
import { useSession } from "./SessionContext";

export type UserRole = "user" | "admin" | "super_admin";

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
  profile: UserProfile | null;
  isLoading: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  refetchProfile: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: Error | null }>;
}

const UserProfileContext = createContext<UserProfileContextType>({
  profile: null,
  isLoading: true,
  isAdmin: false,
  isSuperAdmin: false,
  refetchProfile: async () => {},
  updateProfile: async () => ({ error: null }),
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
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = async () => {
    if (!session?.user?.id) {
      setProfile(null);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, display_name, first_name, last_name, role, avatar_url, company_name, business_address, company_phone, ein")
        .eq("id", session.user.id)
        .single();

      if (error) {
        console.error("Error fetching profile:", error);
        setProfile(null);
      } else {
        setProfile(data as UserProfile);
      }
    } catch (err) {
      console.error("Error fetching profile:", err);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, [session?.user?.id]);

  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const isSuperAdmin = profile?.role === "super_admin";

  const updateProfile = async (updates: Partial<UserProfile>): Promise<{ error: Error | null }> => {
    if (!session?.user?.id) {
      return { error: new Error("No user session") };
    }

    try {
      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", session.user.id);

      if (error) {
        console.error("Error updating profile:", error);
        return { error: error as unknown as Error };
      }

      // Refresh the profile data
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
        refetchProfile: fetchProfile,
        updateProfile,
      }}
    >
      {children}
    </UserProfileContext.Provider>
  );
};
