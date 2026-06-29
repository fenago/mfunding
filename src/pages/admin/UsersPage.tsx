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
} from "@heroicons/react/24/outline";
import { useUserProfile, type UserRole } from "../../context/UserProfileContext";
import {
  adminListUsers,
  adminSetRole,
  adminUpdateFields,
  adminSetPaused,
  adminSetPassword,
  adminLogoutUser,
  adminDeleteUser,
  ROLE_OPTIONS,
  type AdminUser,
} from "../../services/adminUserService";
import { ACCESS_GROUPS, ROLE_LABELS } from "../../config/roleAccess";

const ROLE_BADGE: Record<UserRole, string> = {
  user: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  closer: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
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
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [pwUser, setPwUser] = useState<AdminUser | null>(null);
  const [confirm, setConfirm] = useState<{ user: AdminUser; kind: "delete" | "logout" } | null>(null);
  const [showRoles, setShowRoles] = useState(false);

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
          <button onClick={() => setShowRoles((v) => !v)} className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
            <ShieldCheckIcon className="w-4 h-4" /> What each role sees
          </button>
          <button onClick={load} className="inline-flex items-center gap-1 text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
            <ArrowPathIcon className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

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
                        <div className="font-medium text-gray-900 dark:text-white">
                          {fullName(u)}
                          {isSelf && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{u.email ?? "—"}</div>
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
        New teammates appear here automatically once they sign up at{" "}
        <code className="text-gray-500">/auth/sign-up</code>. Then set their role above. "User" = a merchant/customer.
      </p>

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
                  <td colSpan={5} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
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
