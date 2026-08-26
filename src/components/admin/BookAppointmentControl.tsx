import { useEffect, useRef, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { clearAppointment, scheduleAppointment } from "@/services/dealService";
import { dateTimeET, etDateTimeLocalToUtcIso, etDateTimeLocalValue, tomorrowAtEtIso } from "@/utils/time";

/**
 * "📅 Book appointment" — the Revenue Playbook's green-card control for booking a
 * REAL appointment with the merchant, and the booked state once one exists.
 *
 * An appointment is not a callback. A callback is a promise the app settles for
 * itself (logging an attempt clears it); an appointment is a meeting the merchant
 * AGREED to and was emailed an invite for, and it stands until its time arrives or
 * a human clears it. That distinction lives in the DB columns — this component
 * just never conflates the two words on screen.
 *
 * Booking is 30 minutes on the merchant-invited GHL calendar; the invite is not
 * optional and there is deliberately no toggle for it (unlike callbacks, where
 * inviting is a per-send judgement call). Everything is entered AS EASTERN.
 *
 * Cancel is an inline two-step arm/fire — the owner's rule is no browser popups.
 */
export default function BookAppointmentControl({
  dealId,
  appointmentAt,
  appointmentSyncedAt,
  appointmentSyncError,
  ownerUserId,
  onRefresh,
  onNotify,
  className = "",
}: {
  dealId: string;
  appointmentAt?: string | null;
  appointmentSyncedAt?: string | null;
  appointmentSyncError?: string | null;
  /** The signed-in app user booking it. Null books UNASSIGNED — never blocks. */
  ownerUserId: string | null;
  onRefresh: () => void;
  onNotify: (text: string, tone?: "ok" | "error") => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  // The armed Cancel disarms itself — same 5s window as AdHocSendMenu's armOrFire.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const booked = !!appointmentAt;
  // On the GHL calendar ⇔ the synced INSTANT equals the booked instant. A tick
  // left over from a previous time would be a lie, so compare values, not truthiness.
  const onCalendar =
    booked && !!appointmentSyncedAt && Date.parse(appointmentSyncedAt) === Date.parse(appointmentAt!);

  const cancel = async () => {
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    setBusy(true);
    try {
      await clearAppointment(dealId);
      onNotify("Appointment cancelled — the merchant's calendar invite is withdrawn.");
      onRefresh();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Couldn't cancel the appointment.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {booked ? (
        <>
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
            title="A booked appointment — the merchant was emailed an invite. It stands until its time arrives or you cancel it."
          >
            📅 Appt — {dateTimeET(appointmentAt!)}
            {onCalendar && (
              <span className="font-normal text-emerald-600 dark:text-emerald-400" title="The GHL calendar shows this exact time">
                · on calendar
              </span>
            )}
          </span>
          {/* Soft warnings ("booked UNASSIGNED") are real but never a failure — the
              appointment exists either way, so this stays a whisper, not an alarm. */}
          {!!appointmentSyncError && (
            <span
              className="text-[11px] font-medium text-amber-600 dark:text-amber-400"
              title={appointmentSyncError}
            >
              ⚠ {appointmentSyncError}
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-[11px] font-semibold px-2 py-0.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-ocean-blue hover:text-ocean-blue"
          >
            Reschedule
          </button>
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={busy}
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg border disabled:opacity-50 ${
              armed
                ? "border-red-500 bg-red-500 text-white hover:bg-red-600"
                : "border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-red-400 hover:text-red-500"
            }`}
          >
            {busy ? "Cancelling…" : armed ? "Tap again to cancel it" : "Cancel"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Book a 30-minute appointment — the merchant is emailed the invite automatically"
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/60 px-2.5 py-1 text-[11px] font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-500/10"
        >
          📅 Book appointment
        </button>
      )}

      {open && (
        <BookAppointmentDialog
          dealId={dealId}
          existingAt={appointmentAt ?? null}
          ownerUserId={ownerUserId}
          onClose={() => setOpen(false)}
          onSaved={(when) => {
            setOpen(false);
            onNotify(`Appointment booked — ${dateTimeET(when)}. The merchant gets the invite.`);
            onRefresh();
          }}
        />
      )}
    </div>
  );
}

/**
 * The date+time picker. Same shape as the Calendar page's "+ Schedule call"
 * dialog (ET datetime-local, explicit replace warning, a button that says what it
 * does) minus the deal picker — the playbook already knows whose appointment this
 * is — and minus the invite checkbox, which appointments don't have.
 */
function BookAppointmentDialog({
  dealId,
  existingAt,
  ownerUserId,
  onClose,
  onSaved,
}: {
  dealId: string;
  existingAt: string | null;
  ownerUserId: string | null;
  onClose: () => void;
  onSaved: (whenIso: string) => void;
}) {
  // Rescheduling opens on the time the merchant agreed to; a fresh booking opens
  // on tomorrow 10:00 AM ET — Eastern's tomorrow, not the browser's.
  const [dtLocal, setDtLocal] = useState(() =>
    etDateTimeLocalValue(existingAt ?? tomorrowAtEtIso(10, 0)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    const iso = etDateTimeLocalToUtcIso(dtLocal);
    if (!iso) {
      setError("Enter a date and time (ET).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await scheduleAppointment(dealId, iso, { ownerUserId });
      onSaved(iso);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Booking the appointment failed — try again.");
      setSaving(false);
    }
  };

  const fieldCls =
    "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-ocean-blue";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            {existingAt ? "Reschedule the appointment" : "Book an appointment"}
          </h3>
          <button
            onClick={onClose}
            title="Close"
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* An agreed time is never silently overwritten. */}
        {existingAt && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            ⚠ <b>Already booked — {dateTimeET(existingAt)}.</b> Saving <b>replaces</b> that time and the
            merchant gets an updated invite.
          </div>
        )}

        {/* When — entered AS Eastern, stored as the true instant. */}
        <label className="block">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Date &amp; time — <b>ET</b>
          </span>
          <input
            ref={inputRef}
            type="datetime-local"
            value={dtLocal}
            onChange={(e) => setDtLocal(e.target.value)}
            className={`${fieldCls} mt-1 tabular-nums`}
          />
        </label>

        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          <b>30 minutes.</b> The merchant is <b>invited automatically</b> — they get a confirmation and a
          reminder an hour before. It shows on your Calendar and stays put until it happens or you cancel it.
        </p>

        {error && <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-ocean-blue hover:bg-ocean-blue/90 disabled:opacity-50"
          >
            {saving
              ? "Booking…"
              : existingAt
                ? "Replace the time (re-invites the merchant)"
                : "Book it (invites the merchant)"}
          </button>
        </div>
      </div>
    </div>
  );
}
