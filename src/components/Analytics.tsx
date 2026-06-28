import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Lightweight GA4 loader. No-ops unless VITE_GA4_ID is set, so it's safe to ship
// before the property exists. Set VITE_GA4_ID=G-XXXXXXX in the environment to enable.
const GA4_ID: string | undefined = import.meta.env.VITE_GA4_ID;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let injected = false;

function inject() {
  if (injected || !GA4_ID || typeof document === "undefined") return;
  injected = true;
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", GA4_ID, { send_page_view: false });
}

export default function Analytics() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (!GA4_ID) return;
    inject();
    window.gtag?.("event", "page_view", {
      page_path: pathname + search,
      page_location: window.location.href,
    });
  }, [pathname, search]);

  return null;
}
