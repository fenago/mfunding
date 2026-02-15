import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { SessionProvider } from "./context/SessionContext";
import { UserProfileProvider } from "./context/UserProfileContext";

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
    <SessionProvider>
      <UserProfileProvider>
        <HashScrollHandler />
        <Outlet />
      </UserProfileProvider>
    </SessionProvider>
  );
};

export default Providers;
