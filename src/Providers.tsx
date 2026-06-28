import { useEffect, Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SessionProvider } from "./context/SessionContext";
import { UserProfileProvider } from "./context/UserProfileContext";
import Analytics from "./components/Analytics";
import LoadingPage from "./pages/LoadingPage";
import { ThemeProvider } from "./lib/theme-context";

/** Scroll to hash element after navigation (e.g. /#apply) */
function HashScrollHandler() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;
    const id = hash.replace("#", "");
    // Wait for React to render, then scroll
    const timer = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    }, 300);
    return () => clearTimeout(timer);
  }, [hash]);

  return null;
}

const Providers = () => {
  return (
    <ThemeProvider>
      <SessionProvider>
        <UserProfileProvider>
          <HashScrollHandler />
          <Analytics />
          <Suspense fallback={<LoadingPage />}>
            <Outlet />
          </Suspense>
        </UserProfileProvider>
      </SessionProvider>
    </ThemeProvider>
  );
};

export default Providers;
