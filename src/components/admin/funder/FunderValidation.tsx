// ─────────────────────────────────────────────────────────────────────────────
// Funder validation — the panel a setter works through on the phone.
//
// Why a PASS and not a flag: a `validated` boolean on `lenders` would be a lie
// within a quarter. Phone numbers rot — that is the entire reason this tab
// exists, and Highland Hill's dead line is the proof. So every run through the
// list writes a NEW `funder_validations` row and the old one is kept. The card
// shows the newest and its date, and a date that is eight months old says
// something a green tick never would.
//
// Three contracts this file must honour, each learned the hard way:
//
//  1. THE PARENT ROW GOES IN ITS OWN STATEMENT. `funder_validation_checks` has
//     no author column; its RLS policies test ownership of the parent
//     `funder_validations` row. A CTE that inserts parent and child together
//     fails with 42501, because the parent is not visible to the policy's
//     subquery inside the same statement. Insert the pass, read the id, then
//     upsert checks.
//
//  2. PHONES ARE STORED AS DIGITS. `funder_contact_verifications.endpoint_value`
//     is constrained to ^[0-9]+$ on purpose. The call buttons dedupe and match
//     on digits, so a stored "(954) 280-0359" would be a row that silently
//     never colours the button it was written to colour. Strip before writing.
//
//  3. A CAPTURED SUBMISSION ADDRESS IS A CLAIM, NEVER A WRITE. What a funder
//     says on a phone call does not touch `lenders.submission_email`. These
//     addresses receive merchants' full bank statements; a redirected one is a
//     data breach, and "someone told us on the phone" is exactly the channel an
//     attacker would use. It is recorded here and a human promotes it.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import supabase from "@/supabase";
import { clean } from "@/lib/funderDisclosure";
import {
  type Endpoint,
  type EndpointVerification,
  type ValCheck,
  type ValItem,
  type ValPass,
  daysSinceValidated,
  endpointKey,
  validationStale,
} from "./validationUtil";
import { mustWrite } from "@/supabase/writes";
import {
  BTN_QUIET,
  CHIP_BAD,
  CHIP_LIVE,
  CHIP_NEUTRAL,
  CHIP_WARN,
  ERRTEXT,
  FIELD,
  INK,
  INK_FAINT,
  INK_SOFT,
  KEY,
  LINE,
  NONE,
} from "./ink";

export type {
  AnswerType,
  Endpoint,
  EndpointVerification,
  ValCheck,
  ValItem,
  ValPass,
} from "./validationUtil";

const RESULT_LABEL: Record<EndpointVerification["result"], string> = {
  works: "Works",
  dead: "Dead",
  wrong_party: "Wrong party",
  no_answer: "No answer",
  bounced: "Bounced",
  unknown: "Unknown",
};

const PHONE_RESULTS: EndpointVerification["result"][] = ["works", "no_answer", "wrong_party", "dead"];
const EMAIL_RESULTS: EndpointVerification["result"][] = ["works", "bounced", "wrong_party", "dead"];

function resultChip(r: EndpointVerification["result"]) {
  if (r === "works") return CHIP_LIVE;
  if (r === "dead" || r === "bounced") return CHIP_BAD;
  if (r === "unknown") return CHIP_NEUTRAL;
  return CHIP_WARN;
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

// ── One checklist row ────────────────────────────────────────────────────────

function ItemRow({
  item,
  check,
  disabled,
  onChange,
}: {
  item: ValItem;
  check: ValCheck | undefined;
  disabled: boolean;
  onChange: (patch: { checked?: boolean; value?: string | null }) => void;
}) {
  // Local mirror so typing is not round-tripped on every keystroke. Committed
  // on blur. `check?.value` re-seeds it when the pass is switched.
  const [draft, setDraft] = useState(check?.value ?? "");
  useEffect(() => setDraft(check?.value ?? ""), [check?.value, check?.id]);

  const checked = check?.checked ?? false;
  const commit = () => {
    const v = draft.trim() === "" ? null : draft.trim();
    if (v !== (check?.value ?? null)) onChange({ value: v });
  };

  const inputId = `vi-${item.key}`;

  return (
    <div className="flex flex-col gap-[4px] py-[6px]">
      <div className="flex items-start gap-[8px]">
        <input
          type="checkbox"
          id={inputId}
          className="mt-[3px] w-[15px] h-[15px] shrink-0 accent-[#157049] cursor-pointer disabled:cursor-not-allowed"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange({ checked: e.target.checked })}
        />
        <label htmlFor={inputId} className={`text-[12.5px] ${INK} leading-[1.45] cursor-pointer`}>
          {item.label}
          {item.is_required && <span className="text-[#b7791f] dark:text-[#dcab55] font-bold"> *</span>}
        </label>
      </div>

      {clean(item.help) && <div className={`text-[11px] ${INK_FAINT} leading-[1.4] pl-[23px]`}>{item.help}</div>}

      {item.answer_type !== "none" && item.answer_type !== "bool" && (
        <div className="pl-[23px]">
          {item.answer_type === "longtext" ? (
            <textarea
              className={FIELD}
              rows={2}
              value={draft}
              disabled={disabled}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              aria-label={item.label}
            />
          ) : item.answer_type === "choice" ? (
            <select
              className={FIELD}
              value={draft}
              disabled={disabled}
              onChange={(e) => {
                setDraft(e.target.value);
                onChange({ value: e.target.value === "" ? null : e.target.value });
              }}
              aria-label={item.label}
            >
              <option value="">—</option>
              {(item.choices ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={FIELD}
              type={item.answer_type === "date" ? "date" : "text"}
              inputMode={
                item.answer_type === "money" || item.answer_type === "number"
                  ? "numeric"
                  : item.answer_type === "phone"
                    ? "tel"
                    : undefined
              }
              value={draft}
              disabled={disabled}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              aria-label={item.label}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Endpoint verification ────────────────────────────────────────────────────

function EndpointBlock({
  endpoints,
  verifications,
  disabled,
  onVerify,
}: {
  endpoints: Endpoint[];
  verifications: EndpointVerification[];
  disabled: boolean;
  onVerify: (ep: Endpoint, result: EndpointVerification["result"]) => void;
}) {
  const latest = useMemo(() => {
    const m = new Map<string, EndpointVerification>();
    // Rows arrive newest-first; keep the first seen per endpoint.
    for (const v of verifications) {
      const k = `${v.endpoint_kind}:${v.endpoint_value}`;
      if (!m.has(k)) m.set(k, v);
    }
    return m;
  }, [verifications]);

  if (endpoints.length === 0) {
    return <div className={NONE}>No phone or email on this funder to verify.</div>;
  }

  return (
    <div className="flex flex-col gap-[9px]">
      {endpoints.map((ep) => {
        const prior = latest.get(`${ep.kind}:${endpointKey(ep.kind, ep.shown)}`);
        const results = ep.kind === "phone" ? PHONE_RESULTS : EMAIL_RESULTS;
        return (
          <div key={`${ep.kind}-${ep.shown}`} className="flex flex-col gap-[4px]">
            <div className="flex flex-wrap items-baseline gap-[7px]">
              <span className={`text-[12.5px] font-bold ${INK} tabular-nums`}>{ep.shown}</span>
              {clean(ep.label) && <span className={`text-[11px] ${INK_FAINT}`}>{ep.label}</span>}
              {prior && (
                <span className={resultChip(prior.result)}>
                  {RESULT_LABEL[prior.result]} · {new Date(prior.verified_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-[5px]">
              {results.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={disabled}
                  onClick={() => onVerify(ep, r)}
                  className={
                    BTN_QUIET + (prior?.result === r ? " ring-2 ring-[#c08a2d] ring-offset-1" : "")
                  }
                >
                  {RESULT_LABEL[r]}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── The panel ────────────────────────────────────────────────────────────────

export function FunderValidation({
  lenderId,
  items,
  itemsReadable,
  latestPass,
  endpoints,
  me,
  onPassChanged,
}: {
  lenderId: string;
  items: ValItem[];
  itemsReadable: boolean;
  latestPass: ValPass | null;
  endpoints: Endpoint[];
  me: { id: string; label: string } | null;
  onPassChanged: (p: ValPass) => void;
}) {
  const [pass, setPass] = useState<ValPass | null>(latestPass);
  const [checks, setChecks] = useState<ValCheck[]>([]);
  const [verifs, setVerifs] = useState<EndpointVerification[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => setPass(latestPass), [latestPass]);

  // Load the answers for the current pass, plus this funder's whole
  // verification history (history, not just this pass — a number proved dead
  // in August is still dead in October).
  useEffect(() => {
    let live = true;
    void (async () => {
      const vp = supabase
        .from("funder_contact_verifications")
        .select("id, lender_id, endpoint_kind, endpoint_value, endpoint_label, result, reaches, note, verified_at")
        .eq("lender_id", lenderId)
        .order("verified_at", { ascending: false });
      const cp = pass
        ? supabase
            .from("funder_validation_checks")
            .select("id, validation_id, item_key, checked, value, note")
            .eq("validation_id", pass.id)
        : null;

      const [vr, cr] = await Promise.all([vp, cp ?? Promise.resolve({ data: [], error: null })]);
      if (!live) return;
      if (!vr.error) setVerifs((vr.data ?? []) as EndpointVerification[]);
      if (cr && !cr.error) setChecks((cr.data ?? []) as ValCheck[]);
    })();
    return () => {
      live = false;
    };
  }, [lenderId, pass]);

  const byKey = useMemo(() => {
    const m = new Map<string, ValCheck>();
    for (const c of checks) m.set(c.item_key, c);
    return m;
  }, [checks]);

  const sections = useMemo(() => {
    const m = new Map<string, ValItem[]>();
    for (const it of [...items].sort((a, b) => a.sort - b.sort)) {
      const arr = m.get(it.section);
      if (arr) arr.push(it);
      else m.set(it.section, [it]);
    }
    return [...m.entries()];
  }, [items]);

  const required = useMemo(() => items.filter((i) => i.is_required), [items]);
  const doneCount = checks.filter((c) => c.checked).length;
  const doneRequired = required.filter((i) => byKey.get(i.key)?.checked).length;

  const flash = () => setSavedAt(Date.now());

  /** Create the pass on first interaction. Its own statement — see contract 1. */
  const ensurePass = useCallback(async (): Promise<ValPass | null> => {
    if (pass) return pass;
    if (!me) {
      setErr("Sign-in not resolved, so there is nothing to attribute this to. Reload the page.");
      return null;
    }
    // validated_by is omitted deliberately: it defaults to auth.uid() and the
    // policy's WITH CHECK rejects any explicit value that is not the caller.
    const rows = await mustWrite<ValPass>(
      "Start funder validation",
      supabase.from("funder_validations").insert({
        lender_id: lenderId,
        validated_by_label: me.label,
      }),
    );
    const p = rows[0];
    setPass(p);
    onPassChanged(p);
    return p;
  }, [pass, me, lenderId, onPassChanged]);

  async function saveItem(item: ValItem, patch: { checked?: boolean; value?: string | null }) {
    setErr(null);
    try {
      const p = await ensurePass();
      if (!p) return;
      const existing = byKey.get(item.key);
      const next = {
        validation_id: p.id,
        item_key: item.key,
        checked: patch.checked ?? existing?.checked ?? false,
        value: patch.value !== undefined ? patch.value : (existing?.value ?? null),
      };
      const rows = await mustWrite<ValCheck>(
        `Save validation answer (${item.key})`,
        supabase.from("funder_validation_checks").upsert(next, { onConflict: "validation_id,item_key" }),
      );
      setChecks((cs) => {
        const out = cs.filter((c) => c.item_key !== item.key);
        out.push(rows[0]);
        return out;
      });
      flash();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function patchPass(patch: Partial<Pick<ValPass, "is_complete" | "validated_on" | "summary" | "outcome">>) {
    setErr(null);
    setBusy(true);
    try {
      const p = await ensurePass();
      if (!p) return;
      const rows = await mustWrite<ValPass>(
        "Update funder validation",
        supabase.from("funder_validations").update(patch).eq("id", p.id),
      );
      setPass(rows[0]);
      onPassChanged(rows[0]);
      flash();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(ep: Endpoint, result: EndpointVerification["result"]) {
    setErr(null);
    try {
      const p = await ensurePass();
      const stored = endpointKey(ep.kind, ep.shown);
      if (ep.kind === "phone" && stored === "") {
        // A vanity number like "(833) 3-ROKBIZ" has no dialable digits. Say so
        // rather than writing a row the check constraint would reject anyway.
        setErr(`"${ep.shown}" has no digits to record. Verify the number it actually dials instead.`);
        return;
      }
      const rows = await mustWrite<EndpointVerification>(
        "Record contact verification",
        supabase.from("funder_contact_verifications").insert({
          lender_id: lenderId,
          validation_id: p?.id ?? null,
          endpoint_kind: ep.kind,
          endpoint_value: stored,
          endpoint_label: ep.label,
          result,
        }),
      );
      setVerifs((vs) => [rows[0], ...vs]);
      flash();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function startFresh() {
    if (!me) return;
    setBusy(true);
    setErr(null);
    try {
      const rows = await mustWrite<ValPass>(
        "Start a new funder validation",
        supabase.from("funder_validations").insert({ lender_id: lenderId, validated_by_label: me.label }),
      );
      setChecks([]);
      setPass(rows[0]);
      onPassChanged(rows[0]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!itemsReadable) {
    return (
      <div>
        <div className={KEY}>Validation</div>
        <div className="text-[12px] font-bold text-[#b7791f] dark:text-[#dcab55]">
          The validation checklist could not be read by your account. UNKNOWN, not empty — do not treat this funder as
          unvalidated.
        </div>
      </div>
    );
  }

  const stale = pass?.is_complete && validationStale(pass);
  const locked = !me;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-[10px] mb-[8px]">
        <div className={`${KEY} mb-0`}>Validation</div>
        {pass ? (
          <span className={pass.is_complete ? (stale ? CHIP_WARN : CHIP_LIVE) : CHIP_NEUTRAL}>
            {pass.is_complete ? `Validated ${fmtDate(pass.validated_on)}` : "In progress"}
          </span>
        ) : (
          <span className={CHIP_NEUTRAL}>Never validated</span>
        )}
        <span className={`text-[11px] ${INK_FAINT} tabular-nums`}>
          {doneCount} of {items.length} confirmed · {doneRequired} of {required.length} required
        </span>
        {savedAt !== null && (
          <span className="text-[11px] font-bold text-[#1f8a5b] dark:text-[#54c68d]">saved</span>
        )}
      </div>

      {stale && (
        <div className={`${CHIP_WARN} inline-block mb-[8px]`}>
          Validated {daysSinceValidated(pass!.validated_on)} days ago — numbers rot, re-check before relying on this.
        </div>
      )}

      {/* The two controls he asked for: the tick and the date. */}
      <div className={`flex flex-wrap items-center gap-[14px] border ${LINE} rounded-[9px] px-[11px] py-[9px] mb-[10px]`}>
        <label className="flex items-center gap-[7px] cursor-pointer">
          <input
            type="checkbox"
            className="w-[16px] h-[16px] accent-[#157049] cursor-pointer"
            checked={pass?.is_complete ?? false}
            disabled={locked || busy}
            onChange={(e) => void patchPass({ is_complete: e.target.checked })}
          />
          <span className={`text-[12.5px] font-extrabold ${INK}`}>Validated</span>
        </label>

        <label className="flex items-center gap-[7px]">
          <span className={`text-[11.5px] ${INK_FAINT}`}>on</span>
          <input
            type="date"
            className={`${FIELD} w-auto`}
            value={pass?.validated_on ?? new Date().toISOString().slice(0, 10)}
            disabled={locked || busy}
            onChange={(e) => void patchPass({ validated_on: e.target.value })}
            aria-label="Date validated"
          />
        </label>

        {pass && (
          <span className={`text-[11px] ${INK_FAINT}`}>
            by {clean(pass.validated_by_label) ?? "not recorded"}
          </span>
        )}

        {pass?.is_complete && (
          <button type="button" className={BTN_QUIET} disabled={busy} onClick={() => void startFresh()}>
            Re-validate
          </button>
        )}
      </div>

      {/* Endpoint verification — this is what recolours the call buttons. */}
      <div className="mb-[10px]">
        <div className={KEY}>Do the numbers and addresses work?</div>
        <EndpointBlock endpoints={endpoints} verifications={verifs} disabled={locked} onVerify={(e, r) => void verify(e, r)} />
      </div>

      {/* The checklist. */}
      <div className="flex flex-col gap-[2px]">
        {sections.map(([name, its]) => {
          const isOpen = open.has(name);
          const sectionDone = its.filter((i) => byKey.get(i.key)?.checked).length;
          return (
            <div key={name} className={`border-t ${LINE} pt-[6px]`}>
              <button
                type="button"
                className="w-full flex items-center justify-between gap-[8px] bg-transparent border-0 p-0 cursor-pointer text-left"
                onClick={() =>
                  setOpen((s) => {
                    const n = new Set(s);
                    if (n.has(name)) n.delete(name);
                    else n.add(name);
                    return n;
                  })
                }
                aria-expanded={isOpen}
              >
                <span className={`text-[12px] font-extrabold ${INK_SOFT}`}>
                  {isOpen ? "▾" : "▸"} {name}
                </span>
                <span className={`text-[11px] ${INK_FAINT} tabular-nums`}>
                  {sectionDone}/{its.length}
                </span>
              </button>
              {isOpen && (
                <div className="pl-[2px] pb-[6px]">
                  {its.map((it) => (
                    <ItemRow
                      key={it.key}
                      item={it}
                      check={byKey.get(it.key)}
                      disabled={locked}
                      onChange={(patch) => void saveItem(it, patch)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={`text-[11px] ${INK_FAINT} mt-[8px] leading-[1.45]`}>
        Answers are saved as you go, against your name. Anything captured here — including a submission address — is
        recorded as what the funder <em>said</em>; it never overwrites the funder record on its own.
      </div>

      {err && <div className={`${ERRTEXT} mt-[6px]`}>Not saved — {err}</div>}
      {locked && <div className={`${NONE} mt-[6px]`}>Sign-in not resolved. Reload the page before validating.</div>}
    </div>
  );
}

