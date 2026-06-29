import { useNavigate } from "react-router-dom";
import { EyeIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { useUserProfile } from "../../context/UserProfileContext";

const nameOf = (p: { display_name: string | null; first_name: string | null; last_name: string | null; email: string | null } | null) =>
  p?.display_name?.trim() ||
  [p?.first_name, p?.last_name].filter(Boolean).join(" ").trim() ||
  p?.email ||
  "user";

/**
 * Persistent banner shown while a super_admin is impersonating ("viewing as")
 * another user. Rendered above the route tree so the exit control is always
 * reachable — even when the impersonated role would be redirected away from /admin.
 */
export default function ImpersonationBanner() {
  const { isImpersonating, profile, realProfile, stopImpersonation } = useUserProfile();
  const navigate = useNavigate();

  if (!isImpersonating) return null;

  const exit = () => {
    stopImpersonation();
    navigate("/admin/users");
  };

  return (
    <div className="sticky top-0 z-[100] w-full bg-amber-500 text-amber-950 shadow-md">
      <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm font-medium">
        <EyeIcon className="w-4 h-4 shrink-0" />
        <span>
          Viewing as <strong>{nameOf(profile)}</strong>{" "}
          <span className="opacity-70">({profile?.role})</span> — you are signed in as {nameOf(realProfile)}.
        </span>
        <button
          onClick={exit}
          className="inline-flex items-center gap-1 rounded-full bg-amber-950 text-amber-50 px-3 py-1 text-xs font-semibold hover:bg-amber-900"
        >
          <XMarkIcon className="w-3.5 h-3.5" /> Exit impersonation
        </button>
      </div>
    </div>
  );
}
