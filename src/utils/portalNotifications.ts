// Shared classifier for portal messages so the inbox and the notification bell
// render the same icon + deep link for a given message.
//
// The confirmed `messages` schema has no `kind`/`action_path` columns yet, so we
// derive a kind from the subject/body (heuristic C, agreed with the team lead).
// If the backend later adds a real `kind` (and/or `action_path`), those win
// automatically — no UI change needed.
//
// Design bias: only mark a message as a no-reply NOTIFICATION when its text
// clearly matches a system event. Anything ambiguous is treated as a person
// message (reply shown). The compose box is always available regardless, so the
// merchant can always reach their advisor even if a message is misclassified.

import type { ComponentType } from "react";
import {
  SparklesIcon,
  DocumentTextIcon,
  DocumentCheckIcon,
  BuildingLibraryIcon,
  BanknotesIcon,
  BellAlertIcon,
  ChatBubbleLeftRightIcon,
} from "@heroicons/react/24/outline";
import type { PortalMessage } from "../services/portalService";

export type NotificationKind =
  | "offer"
  | "signature"
  | "doc"
  | "submission"
  | "funding"
  | "update"
  | "message";

export interface ClassifiedMessage {
  /** Derived (or column-provided) kind. */
  kind: NotificationKind;
  /** True for system notifications (no reply UI). False for person messages. */
  isNotification: boolean;
  /** Icon for the row. */
  Icon: ComponentType<{ className?: string }>;
  /** Where the "Take a look" deep link goes, or null (no actionable target). */
  deepLink: string | null;
}

/** Map a known kind to its icon + default deep link. */
const KIND_META: Record<
  NotificationKind,
  { Icon: ComponentType<{ className?: string }>; deepLink: string | null }
> = {
  offer: { Icon: SparklesIcon, deepLink: "/portal/offers" },
  signature: { Icon: DocumentCheckIcon, deepLink: "/portal" },
  doc: { Icon: DocumentTextIcon, deepLink: "/portal/documents" },
  submission: { Icon: BuildingLibraryIcon, deepLink: "/portal" },
  funding: { Icon: BanknotesIcon, deepLink: "/portal" },
  update: { Icon: BellAlertIcon, deepLink: "/portal" },
  message: { Icon: ChatBubbleLeftRightIcon, deepLink: null },
};

/** Normalize a backend-provided kind string onto our NotificationKind set. */
function normalizeKind(raw: string): NotificationKind {
  const k = raw.toLowerCase();
  if (k.includes("offer")) return "offer";
  if (k.includes("sign")) return "signature";
  if (k.includes("doc")) return "doc";
  if (k.includes("submission") || k.includes("submit")) return "submission";
  if (k.includes("fund") || k.includes("renew") || k.includes("paydown")) return "funding";
  return "update";
}

/** Derive a kind from a message's subject + body when there's no kind column.
 *  Returns "message" (person-to-person) when nothing clearly matches. */
function deriveKind(m: PortalMessage): NotificationKind {
  const text = `${m.subject ?? ""} ${m.body ?? ""}`.toLowerCase();

  if (/\boffer\b/.test(text)) return "offer";
  if (/signature|signed|ready to sign|e-?sign/.test(text)) return "signature";
  if (
    /document|bank statement|upload|stip|approved|rejected|needs another look/.test(text)
  ) {
    return "doc";
  }
  if (/submitted to|funding partner|in front of|reviewing your file/.test(text)) {
    return "submission";
  }
  if (/funded|paid in full|paydown|renewal|additional capital/.test(text)) {
    return "funding";
  }
  return "message";
}

/** Classify a message for display.
 *
 *  Once the backend adds the `kind`/`action_path` columns, a row carries a
 *  `kind` property: a non-null value is a system notification; NULL means a
 *  person-to-person message (reply enabled) — we do NOT run the heuristic on it.
 *  Before the columns exist, the fallback select omits the property entirely, so
 *  we derive the kind from the subject/body (heuristic C). We tell the two apart
 *  by whether the `kind` property is present on the row at all. */
export function classifyMessage(m: PortalMessage): ClassifiedMessage {
  const columnsPresent = Object.prototype.hasOwnProperty.call(m, "kind");

  let kind: NotificationKind;
  if (columnsPresent) {
    // NULL kind (person message) → "message"; otherwise normalize the value.
    kind = m.kind ? normalizeKind(m.kind) : "message";
  } else {
    kind = deriveKind(m);
  }

  const isNotification = kind !== "message";
  const meta = KIND_META[kind];
  // A backend-provided action_path always wins for the deep link.
  const deepLink = m.action_path || meta.deepLink;

  return { kind, isNotification, Icon: meta.Icon, deepLink };
}

/** Short relative-time label ("just now", "3h", "2d", or a date). */
export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
