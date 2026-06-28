import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { routes } from "./router";

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
