import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { routes } from "./router";
import { installEasternTime } from "./utils/time";

// EVERY time this app renders is Eastern — before a single component mounts.
// The business runs on ET; a closer whose laptop is set to Phoenix would otherwise see
// a callback of "1:00 PM", dial at 1pm Arizona time, and be three hours late to a call
// the merchant agreed to, with nothing on screen looking wrong. See utils/time.ts.
installEasternTime();

// ThemeProvider and the Session/UserProfile providers live inside the root
// route element (Providers, see src/router/index.tsx). HelmetProvider wraps the
// whole app so react-helmet-async can manage per-page <head> tags.
const router = createBrowserRouter(routes);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HelmetProvider>
      <RouterProvider router={router} />
    </HelmetProvider>
  </React.StrictMode>
);
