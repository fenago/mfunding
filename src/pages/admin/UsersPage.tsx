import { useEffect, useMemo, useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import {
  UsersIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  EyeIcon,
  EllipsisVerticalIcon,
  KeyIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  ArrowRightOnRectangleIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ShieldCheckIcon,
  UserPlusIcon,
  ClipboardDocumentIcon,
  CheckCircleIcon,
  IdentificationIcon,
  BanknotesIcon,
  MapPinIcon,
  DocumentTextIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import supabase from "@/supabase";
import { type PayoutProfile } from "@/services/payoutService";
import { useUserProfile, type UserRole } from "../../context/UserProfileContext";
import {
  adminListUsers,
  adminInvite,
  adminSetRole,
  adminUpdateFields,
  adminSetPaused,
  adminSetPassword,
  adminLogoutUser,
  adminDeleteUser,
  ROLE_OPTIONS,
  type AdminUser,
  type AdminInviteResult,
} from "../../services/adminUserService";
import { ACCESS_GROUPS, ROLE_LABELS } from "../../config/roleAccess";

const ROLE_BADGE: Record<UserRole, string> = {
  user: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  closer: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  employee: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  admin: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  super_admin: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const fullName = (u: AdminUser) =>
  u.display_name?.trim() ||
  [u.first_name, u.last_name].filter(Boolean).join(" ").trim() ||
  u.email?.split("@")[0] ||
  "Unnamed user";

const since = (iso: string | null) => {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export default function UsersPage() {
  const { profile, startImpersonation } = useUserProfile();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AdminUser | null>(null);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [pwUser, setPwUser] = useState<AdminUser | null>(null);
  const [confirm, setConfirm] = useState<{ user: AdminUser; kind: "delete" | "logout" } | null>(null);
  const [showRoles, setShowRoles] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await adminListUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((u) =>
      [u.email, u.first_name, u.last_name, u.display_name, u.company_name]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    );
  }, [rows, search]);

  async function run(id: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
      flash(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  async function viewAs(u: AdminUser) {
    setError(null);
    const { error } = await startImpersonation(u.id);
    if (error) return setError(error.message);
    navigate(u.role === "user" ? "/portal" : "/admin");
  }

  async function changeRole(u: AdminUser, role: UserRole) {
    if (role === u.role) return;
    setRows((prev) => prev.map((r) => (r.id === u.id ? { ...r, role } : r)));
    await run(u.id, () => adminSetRole(u.id, role), `Role updated to ${role}`);
  }

  const input =
    "mt-1 w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100";

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <UsersIcon className="w-6 h-6 text-ocean-blue" /> Users
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Manage accounts, roles, and access. Change roles, reset passwords, pause, impersonate, or remove users.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInvite((v) => !v)}
            className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg font-semibold text-white bg-ocean-blue hover:opacity-90"
          >
            <UserPlusIcon className="w-4 h-4" /> Invite user
          </button>
          <button onClick={() => setShowRoles((v) => !v)} className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
            <ShieldCheckIcon className="w-4 h-4" /> What each role sees
          </button>
          <button onClick={load} className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
            <ArrowPathIcon className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {showInvite && (
        <InvitePanel
          inputClass={input}
          onClose={() => setShowInvite(false)}
          onInvited={(msg) => {
            load();
            flash(msg);
          }}
        />
      )}

      {showRoles && <RolePermissions onClose={() => setShowRoles(false)} />}

      <div className="relative max-w-sm">
        <MagnifyingGlassIcon className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, company…"
          className="pl-9 pr-3 py-2 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-visible">
        {loading ? (
          <p className="p-6 text-sm text-gray-400">Loading users…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-gray-500">No users found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last sign-in</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map((u) => {
                  const isSelf = u.id === profile?.id;
                  const busy = busyId === u.id;
                  return (
                    <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setViewing(u)}
                          className="text-left group"
                          title={`View ${fullName(u)}'s profile & payout`}
                        >
                          <div className="font-medium text-gray-900 dark:text-white group-hover:text-ocean-blue group-hover:underline">
                            {fullName(u)}
                            {isSelf && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{u.email ?? "—"}</div>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[u.role]}`}>
                            {ROLE_OPTIONS.find((r) => r.value === u.role)?.label ?? u.role}
                          </span>
                          <select
                            value={u.role}
                            disabled={isSelf || busy}
                            title={isSelf ? "You can't change your own role" : undefined}
                            onChange={(e) => changeRole(u, e.target.value as UserRole)}
                            className="text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 px-2 py-1 disabled:opacity-40"
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {u.paused ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            Paused
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{since(u.last_sign_in_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {!isSelf && (
                            <button
                              onClick={() => viewAs(u)}
                              title={`View the app as ${fullName(u)}`}
                              className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline text-sm"
                            >
                              <EyeIcon className="w-4 h-4" /> View as
                            </button>
                          )}
                          {/* Native disclosure used as a kebab menu (closes on outside click via blur). */}
                          <details className="relative">
                            <summary className="list-none cursor-pointer p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
                              <EllipsisVerticalIcon className="w-5 h-5" />
                            </summary>
                            <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1 text-sm">
                              <MenuItem icon={IdentificationIcon} onClick={() => setViewing(u)}>
                                View profile &amp; payout
                              </MenuItem>
                              <MenuItem icon={PencilSquareIcon} onClick={() => setEditing(u)}>
                                Edit details
                              </MenuItem>
                              <MenuItem icon={KeyIcon} onClick={() => setPwUser(u)}>
                                Reset password
                              </MenuItem>
                              {!isSelf && (
                                <MenuItem
                                  icon={u.paused ? PlayCircleIcon : PauseCircleIcon}
                                  onClick={() => run(u.id, () => adminSetPaused(u.id, !u.paused), u.paused ? "User resumed" : "User paused")}
                                >
                                  {u.paused ? "Resume access" : "Pause access"}
                                </MenuItem>
                              )}
                              {!isSelf && (
                                <MenuItem icon={ArrowRightOnRectangleIcon} onClick={() => setConfirm({ user: u, kind: "logout" })}>
                                  Force log out
                                </MenuItem>
                              )}
                              {!isSelf && (
                                <MenuItem icon={TrashIcon} danger onClick={() => setConfirm({ user: u, kind: "delete" })}>
                                  Delete user
                                </MenuItem>
                              )}
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">
        Use <strong>Invite user</strong> to create a teammate's account and email them a set-password link. Anyone who
        signs up at <code className="text-gray-500">/auth/sign-up</code> also lands here as a "User" — set their role above.
        "User" = a merchant/customer.
      </p>

      {viewing && <UserDetailDrawer user={viewing} onClose={() => setViewing(null)} />}

      {editing && (
        <EditModal
          user={editing}
          inputClass={input}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            flash("Details saved");
          }}
        />
      )}
      {pwUser && (
        <PasswordModal
          user={pwUser}
          inputClass={input}
          onClose={() => setPwUser(null)}
          onSaved={() => {
            setPwUser(null);
            flash("Password updated");
          }}
        />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.kind === "delete" ? "Delete user?" : "Force log out?"}
          body={
            confirm.kind === "delete"
              ? `This permanently deletes ${fullName(confirm.user)} (${confirm.user.email}). This cannot be undone.`
              : `This signs ${fullName(confirm.user)} out of all devices. They can sign back in unless paused.`
          }
          danger={confirm.kind === "delete"}
          confirmLabel={confirm.kind === "delete" ? "Delete" : "Log out"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const c = confirm;
            setConfirm(null);
            run(
              c.user.id,
              () => (c.kind === "delete" ? adminDeleteUser(c.user.id) : adminLogoutUser(c.user.id)),
              c.kind === "delete" ? "User deleted" : "User logged out"
            );
          }}
        />
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        // close the <details> menu
        (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
        onClick();
      }}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 ${
        danger ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-200"
      }`}
    >
      <Icon className="w-4 h-4" /> {children}
    </button>
  );
}

/**
 * Inline "Invite user" panel — create a staff account, set their role, and send the
 * set-password email in one submit. Inline by design (owner rule: no browser popups).
 *
 * The returned link is shown on success and is NOT decoration: this project has no
 * custom auth SMTP, so Supabase's built-in mailer is rate-limited and may not deliver
 * to arbitrary addresses. The link is the dependable delivery path.
 */
function InvitePanel({
  inputClass,
  onClose,
  onInvited,
}: {
  inputClass: string;
  onClose: () => void;
  onInvited: (msg: string) => void;
}) {
  const [form, setForm] = useState({ email: "", first_name: "", last_name: "", role: "closer" as UserRole });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AdminInviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const email = form.email.trim();
    if (!email) return setErr("Enter their work email.");
    setSaving(true);
    setErr(null);
    try {
      const res = await adminInvite({
        email,
        firstName: form.first_name.trim(),
        lastName: form.last_name.trim(),
        role: form.role,
      });
      setResult(res);
      const label = ROLE_OPTIONS.find((r) => r.value === res.role)?.label ?? res.role;
      onInvited(
        res.email_sent
          ? `Invited ${res.email} as ${label} — password-setup email sent`
          : `Created ${res.email} as ${label} — send them the link below`
      );
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to invite user");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setErr("Couldn't copy automatically — select the link and copy it manually.");
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Invite a teammate</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Creates their account, sets their role, and emails them a link to choose a password.
          </p>
        </div>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">
          Close
        </button>
      </div>

      {err && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> {err}
        </div>
      )}

      {result ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircleIcon className="w-5 h-5 shrink-0" />
            <span>
              <strong>{result.email}</strong> is set up as{" "}
              {ROLE_OPTIONS.find((r) => r.value === result.role)?.label ?? result.role}.{" "}
              {result.email_sent ? "A password-setup email is on its way." : "No email was sent."}
            </span>
          </div>

          {result.warning && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              {result.warning}
            </div>
          )}

          {result.invite_link && (
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Set-password link — send this if the email doesn't arrive. It expires in about an hour;
                after that they can request a fresh one from the sign-in page.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={result.invite_link} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} font-mono text-xs`} />
                <button
                  type="button"
                  onClick={() => copyLink(result.invite_link!)}
                  className="mt-1 shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <ClipboardDocumentIcon className="w-4 h-4" /> {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button
              onClick={() => {
                setResult(null);
                setErr(null);
                setForm({ email: "", first_name: "", last_name: "", role: "closer" });
              }}
              className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              Invite another
            </button>
            <button onClick={onClose} className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-ocean-blue hover:opacity-90">
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="sm:col-span-2 text-sm text-gray-600 dark:text-gray-300">
              Work email <span className="text-red-500">*</span>
              <input
                type="email"
                required
                autoComplete="off"
                className={inputClass}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@company.com"
              />
            </label>
            <label className="text-sm text-gray-600 dark:text-gray-300">
              First name
              <input className={inputClass} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            </label>
            <label className="text-sm text-gray-600 dark:text-gray-300">
              Last name
              <input className={inputClass} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            </label>
            <label className="text-sm text-gray-600 dark:text-gray-300">
              Role
              <select
                className={inputClass}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-gray-400 mt-1">
                Appointment setters and closers both use <strong>Closer</strong>. "User" = a merchant/customer.
              </span>
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-ocean-blue hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Inviting…" : "Send invite"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function RolePermissions({ onClose }: { onClose: () => void }) {
  const roles = ROLE_LABELS;
  const dot = (on: boolean) =>
    on ? (
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />
    ) : (
      <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-200 dark:bg-gray-600" />
    );

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">What each role can see</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Screens visible per role. Green = has access.</p>
        </div>
        <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-600">Hide</button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        {roles.map((r) => (
          <div key={r.role} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
            <div className="font-semibold text-gray-900 dark:text-white text-sm">{r.label}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{r.blurb}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto mt-5">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-3 py-2 font-medium">Screen</th>
              {roles.map((r) => (
                <th key={r.role} className="px-3 py-2 font-medium text-center">
                  {r.role === "super_admin" ? "Super" : r.role === "user" ? "User" : r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACCESS_GROUPS.map((g) => (
              <Fragment key={g.title}>
                <tr className="bg-gray-50 dark:bg-gray-900/50">
                  <td colSpan={roles.length + 1} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {g.title}
                  </td>
                </tr>
                {g.items.map((it) => (
                  <tr key={g.title + it.name} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{it.name}</td>
                    {roles.map((r) => (
                      <td key={r.role} className="px-3 py-2 text-center">
                        {dot(it.roles.includes(r.role))}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditModal({
  user,
  inputClass,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  inputClass: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    first_name: user.first_name ?? "",
    last_name: user.last_name ?? "",
    display_name: user.display_name ?? "",
    company_name: user.company_name ?? "",
    company_phone: user.company_phone ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await adminUpdateFields(user.id, {
        first_name: form.first_name || null,
        last_name: form.last_name || null,
        display_name: form.display_name || null,
        company_name: form.company_name || null,
        company_phone: form.company_phone || null,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Edit user" subtitle={user.email ?? undefined}>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-sm text-gray-600 dark:text-gray-300">
          First name
          <input className={inputClass} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
        </label>
        <label className="text-sm text-gray-600 dark:text-gray-300">
          Last name
          <input className={inputClass} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
        </label>
        <label className="col-span-2 text-sm text-gray-600 dark:text-gray-300">
          Display name
          <input className={inputClass} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        </label>
        <label className="text-sm text-gray-600 dark:text-gray-300">
          Company
          <input className={inputClass} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
        </label>
        <label className="text-sm text-gray-600 dark:text-gray-300">
          Phone
          <input className={inputClass} value={form.company_phone} onChange={(e) => setForm({ ...form, company_phone: e.target.value })} />
        </label>
      </div>
      <ModalActions onCancel={onClose} onConfirm={save} confirmLabel={saving ? "Saving…" : "Save changes"} busy={saving} />
    </Modal>
  );
}

function PasswordModal({
  user,
  inputClass,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  inputClass: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (pw.length < 8) return setErr("Password must be at least 8 characters");
    setSaving(true);
    setErr(null);
    try {
      await adminSetPassword(user.id, pw);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to set password");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Reset password" subtitle={user.email ?? undefined}>
      {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
      <label className="block mt-4 text-sm text-gray-600 dark:text-gray-300">
        New password
        <input
          type="text"
          autoComplete="new-password"
          className={inputClass}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="At least 8 characters"
        />
      </label>
      <p className="text-xs text-gray-400 mt-2">Share this with the user securely. They'll stay signed in until they next sign out.</p>
      <ModalActions onCancel={onClose} onConfirm={save} confirmLabel={saving ? "Saving…" : "Set password"} busy={saving} />
    </Modal>
  );
}

function ConfirmModal({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel} title={title}>
      <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{body}</p>
      <ModalActions onCancel={onCancel} onConfirm={onConfirm} confirmLabel={confirmLabel} danger={danger} />
    </Modal>
  );
}

function Modal({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onCancel,
  onConfirm,
  confirmLabel,
  danger,
  busy,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="mt-6 flex justify-end gap-3">
      <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={busy}
        className={`px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${
          danger ? "bg-red-600 hover:bg-red-700" : "bg-ocean-blue hover:opacity-90"
        }`}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

/** Full profile row read directly from `profiles` (super_admin RLS allows it). */
interface FullProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  email: string | null;
  role: UserRole | null;
  phone_number: string | null;
  whatsapp_number: string | null;
  contact_email: string | null;
  country: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  timezone: string | null;
  bio: string | null;
  company_name: string | null;
  ein: string | null;
  business_address: string | null;
}

const PROFILE_DETAIL_COLS =
  "id, first_name, last_name, display_name, email, role, phone_number, whatsapp_number, contact_email, country, address_line1, address_line2, city, state, postal_code, timezone, bio, company_name, ein, business_address";

const PAYOUT_METHOD_LABELS: Record<string, string> = {
  wise: "Wise",
  payoneer: "Payoneer",
  zelle: "Zelle",
  gcash: "GCash",
  bank_ph: "PH bank transfer",
  other: "Other",
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;

/**
 * Read-only detail panel for one user — full profile + how they get paid + tax
 * status. Slides in from the right (in-app drawer, not a browser popup).
 * Queries profiles + payout_profiles directly; super_admin RLS permits both.
 * Sensitive values (bank account #, Zelle handle, foreign TIN, EIN) render
 * masked with a per-field Show toggle so payroll can reveal on demand.
 */
function UserDetailDrawer({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [profileErr, setProfileErr] = useState<string | null>(null);
  const [payout, setPayout] = useState<PayoutProfile | null>(null);
  const [payoutErr, setPayoutErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setProfileErr(null);
      setPayoutErr(null);
      const [pRes, payRes] = await Promise.all([
        supabase.from("profiles").select(PROFILE_DETAIL_COLS).eq("id", user.id).single(),
        supabase.from("payout_profiles").select("*").eq("profile_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      if (pRes.error) setProfileErr(pRes.error.message);
      else setProfile(pRes.data as unknown as FullProfile);
      if (payRes.error) setPayoutErr(payRes.error.message);
      else setPayout((payRes.data as PayoutProfile | null) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const name = fullName(user);
  const method = payout?.preferred_method || "";
  const address = profile
    ? [profile.address_line1, profile.address_line2, [profile.city, profile.state].filter(Boolean).join(", "), profile.postal_code, profile.country]
        .filter((v) => v && v.trim())
        .join("\n")
    : "";
  const isUS = (profile?.country || "").toLowerCase() === "united states";
  const hasPayoutMethod = !!payout && !!method;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md h-full overflow-y-auto bg-white dark:bg-gray-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">{name}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{user.email ?? "—"}</p>
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[user.role]}`}>
              {ROLE_OPTIONS.find((r) => r.value === user.role)?.label ?? user.role}
            </span>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-600"
            title="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading details…</p>}

          {!loading && (
            <>
              {/* Profile */}
              <Section icon={IdentificationIcon} title="Profile">
                {profileErr ? (
                  <InlineErr msg={profileErr} />
                ) : (
                  <dl className="space-y-2">
                    <DRow label="First name" value={profile?.first_name} />
                    <DRow label="Last name" value={profile?.last_name} />
                    <DRow label="Display name" value={profile?.display_name} />
                    <DRow label="Login email" value={profile?.email ?? user.email} />
                    <DRow label="Contact email" value={profile?.contact_email} />
                    <DRow label="Phone" value={profile?.phone_number} />
                    <DRow label="WhatsApp" value={profile?.whatsapp_number} />
                    <DRow label="Country" value={profile?.country} />
                    <DRow label="Timezone" value={profile?.timezone} />
                    <DRow label="Bio" value={profile?.bio} />
                  </dl>
                )}
              </Section>

              {/* Mailing address */}
              {!profileErr && (
                <Section icon={MapPinIcon} title="Mailing address">
                  {address ? (
                    <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-line">{address}</p>
                  ) : (
                    <p className="text-sm text-gray-400">No address on file.</p>
                  )}
                </Section>
              )}

              {/* How they get paid */}
              <Section icon={BanknotesIcon} title="How they get paid">
                {payoutErr ? (
                  <InlineErr msg={payoutErr} />
                ) : !hasPayoutMethod ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-200">
                    <ExclamationTriangleIcon className="w-5 h-5 shrink-0" />
                    <span>
                      <strong>No payment method on file</strong> — this person can&apos;t be paid yet.
                    </span>
                  </div>
                ) : (
                  <dl className="space-y-2">
                    <DRow
                      label="Method"
                      value={PAYOUT_METHOD_LABELS[method] ?? method}
                    />
                    <DRow label="Account holder" value={payout?.account_holder_name} />
                    <DRow label="Currency" value={payout?.currency} />
                    {method === "wise" && <DRow label="Wise email" value={payout?.wise_email} />}
                    {method === "payoneer" && <DRow label="Payoneer email" value={payout?.payoneer_email} />}
                    {method === "zelle" && (
                      <>
                        <DRow label="Zelle handle" value={payout?.zelle_handle} sensitive />
                        <DRow label="Name on Zelle" value={payout?.zelle_name} />
                      </>
                    )}
                    {method === "gcash" && (
                      <>
                        <DRow label="GCash number" value={payout?.gcash_number} />
                        <DRow label="Name on GCash" value={payout?.gcash_name} />
                      </>
                    )}
                    {method === "bank_ph" && (
                      <>
                        <DRow label="Bank" value={payout?.bank_name} />
                        <DRow label="Account name" value={payout?.bank_account_name} />
                        <DRow label="Account number" value={payout?.bank_account_number} sensitive />
                        <DRow label="Branch" value={payout?.bank_branch} />
                        <DRow label="SWIFT / BIC" value={payout?.bank_swift_bic} />
                      </>
                    )}
                    {method === "other" && (
                      <>
                        <DRow label="Method name" value={payout?.other_method_name} />
                        <DRow label="Details" value={payout?.other_method_details} />
                      </>
                    )}
                    <DRow label="Notes for payroll" value={payout?.payout_notes} />
                  </dl>
                )}
              </Section>

              {/* Tax status */}
              {!profileErr && (
                <Section icon={DocumentTextIcon} title="Tax status">
                  {isUS ? (
                    <dl className="space-y-2">
                      <DRow label="Tax country" value="United States (1099)" />
                      <DRow label="Company / entity" value={profile?.company_name} />
                      <DRow label="EIN" value={profile?.ein} sensitive />
                      <DRow label="Business address" value={profile?.business_address} />
                    </dl>
                  ) : (
                    <dl className="space-y-2">
                      <DRow label="Tax country" value={payout?.tax_country || profile?.country} />
                      <DRow
                        label="Foreign status (W-8BEN)"
                        value={
                          payout?.foreign_status_certified
                            ? `Certified not a U.S. person${
                                fmtDate(payout?.foreign_status_certified_at) ? ` · ${fmtDate(payout?.foreign_status_certified_at)}` : ""
                              }`
                            : "Not certified"
                        }
                      />
                      <DRow label="Foreign tax ID" value={payout?.foreign_tax_id} sensitive />
                    </dl>
                  )}
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
        <Icon className="w-4 h-4" /> {title}
      </h3>
      {children}
    </div>
  );
}

function InlineErr({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
      <ExclamationTriangleIcon className="w-5 h-5 shrink-0" /> {msg}
    </div>
  );
}

/** One label/value row. Sensitive values render masked with a Show toggle. */
function DRow({
  label,
  value,
  sensitive,
}: {
  label: string;
  value: string | null | undefined;
  sensitive?: boolean;
}) {
  const [show, setShow] = useState(false);
  const has = !!value && value.trim().length > 0;
  return (
    <div className="grid grid-cols-3 gap-3">
      <dt className="col-span-1 text-xs text-gray-500 dark:text-gray-400 pt-0.5">{label}</dt>
      <dd className="col-span-2 text-sm text-gray-900 dark:text-gray-100 break-words">
        {!has ? (
          <span className="text-gray-400">—</span>
        ) : sensitive ? (
          <span className="inline-flex items-center gap-2">
            <span className="font-mono">{show ? value : "•".repeat(Math.min(value!.length, 12))}</span>
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="text-xs font-medium text-ocean-blue hover:underline"
            >
              {show ? "Hide" : "Show"}
            </button>
          </span>
        ) : (
          <span className="whitespace-pre-line">{value}</span>
        )}
      </dd>
    </div>
  );
}
