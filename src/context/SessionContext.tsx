import { createContext, useContext, useEffect, useState } from "react";
import supabase from "../supabase";
import LoadingPage from "../pages/LoadingPage";
import { Session } from "@supabase/supabase-js";

const SessionContext = createContext<{
  session: Session | null;
}>({
  session: null,
});

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
};

type Props = { children: React.ReactNode };
export const SessionProvider = ({ children }: Props) => {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const authStateListener = supabase.auth.onAuthStateChange(
      async (_, session) => {
        setSession(session);
        setIsLoading(false);
      }
    );

    return () => {
      authStateListener.data.subscription.unsubscribe();
    };
  }, [supabase]);

  // During build-time prerendering / SSR there is no browser, so the auth
  // listener never fires and isLoading would stay true forever — which would
  // bake a loading spinner into every prerendered page. Render real content
  // in that case (auth re-resolves on the client after hydration).
  const isServer = typeof window === "undefined";

  return (
    <SessionContext.Provider value={{ session }}>
      {isLoading && !isServer ? <LoadingPage /> : children}
    </SessionContext.Provider>
  );
};
