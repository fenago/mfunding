import { useEffect } from "react";
import { CheckCircleIcon } from "@heroicons/react/24/outline";
import Navbar from "../components/landing/Navbar";
import Footer from "../components/landing/Footer";
import ScrollToTop from "../components/ui/ScrollToTop";

// MFunding "MCA Funding Application" — GoHighLevel form (MFunding.net sub-account).
// Submissions flow straight into the CRM and (via the GHL "Form Submitted" workflow)
// create a New Lead opportunity in the MFunding MCA Pipeline.
const GHL_FORM_ID = "Ow1imQrxjJN9yfDUiBG3";
const GHL_EMBED_SCRIPT = "https://link.msgsndr.com/js/form_embed.js";

const TRUST = [
  "No upfront fees",
  "Checking your options won't affect your credit",
  "Funding typically in 24–48 hours",
];

export default function ApplyPage() {
  // Load GHL's form embed script once (handles iframe auto-resize).
  useEffect(() => {
    if (document.querySelector(`script[src="${GHL_EMBED_SCRIPT}"]`)) return;
    const s = document.createElement("script");
    s.src = GHL_EMBED_SCRIPT;
    s.async = true;
    document.body.appendChild(s);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <Navbar />
      <ScrollToTop />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-12">
        <div className="mb-6 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">
            Get the working capital your business needs
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            Takes about 3 minutes. A funding specialist will follow up the same day.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2">
            {TRUST.map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
                <CheckCircleIcon className="w-4 h-4 text-emerald-500" /> {t}
              </span>
            ))}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-2 sm:p-4 shadow-sm">
          <iframe
            src={`https://api.leadconnectorhq.com/widget/form/${GHL_FORM_ID}`}
            id={`inline-${GHL_FORM_ID}`}
            title="MCA Funding Application"
            data-form-id={GHL_FORM_ID}
            data-form-name="MCA Funding Application"
            data-layout-iframe-id={`inline-${GHL_FORM_ID}`}
            data-height="1600"
            style={{ width: "100%", minHeight: "1600px", border: "none", borderRadius: "8px" }}
          />
        </div>

        <p className="text-xs text-gray-400 text-center mt-4">
          This is not a loan application — MCA products are a purchase of future receivables.
        </p>
      </main>
      <Footer />
    </div>
  );
}
