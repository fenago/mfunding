import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/solid";
import SignDocumentPanel from "../../components/portal/SignDocumentPanel";

/**
 * Standalone sign route (/portal/sign/:id). Kept working for email deep links;
 * inside the app, the dashboard opens the same panel in a modal instead. The
 * document renders as a properly formatted contract via the shared panel.
 */
export default function PortalSignPage() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();

  if (!documentId) {
    return null;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back
      </button>

      <SignDocumentPanel documentId={documentId} />
    </div>
  );
}
