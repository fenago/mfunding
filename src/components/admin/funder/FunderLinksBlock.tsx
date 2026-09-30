// Submission route vs partner portal vs the material itself — three different
// things a single "link" column would flatten into one.
import { useState } from "react";
import supabase from "@/supabase";
import {
  type ContactFields,
  type DocState,
  type LenderDoc,
  type ProfileRow,
  CREDENTIAL_LOOKS_LABELLED,
  DOC_TYPE_LABEL,
  clean,
} from "@/lib/funderDisclosure";
import { LinkLine, Quoted } from "./parts";

export function FunderLinksBlock({
  l,
  profile,
  profilesReadable,
  docs,
}: {
  l: ContactFields & { id: string; company_name: string };
  profile: ProfileRow | undefined;
  profilesReadable: boolean;
  docs: DocState;
}) {
  const [docErr, setDocErr] = useState<string | null>(null);
  const brokerPortal = clean(l.submission_portal_url);
  const profilePortal = clean(profile?.portal_url);
  const subNotes = clean(l.submission_notes);
  const hint = clean(profile?.portal_credentials_hint);
  const hintSafe = !!hint && CREDENTIAL_LOOKS_LABELLED.test(hint);
  const mine = docs.byLender[l.id] ?? [];
  // Same URL recorded in both columns is one portal, not two.
  const sameUrl = brokerPortal && profilePortal && brokerPortal.trim() === profilePortal.trim();

  const open = async (d: LenderDoc) => {
    setDocErr(null);
    if (!d.storage_path) {
      setDocErr(`${d.filename ?? "That file"} has no storage path recorded — it can't be opened from here.`);
      return;
    }
    const { data, error } = await supabase.storage.from("lender-documents").createSignedUrl(d.storage_path, 60);
    if (error || !data?.signedUrl) {
      setDocErr(`Could not open ${d.filename ?? "that file"} — ${error?.message ?? "no link came back"}.`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <div className="cgroup">
        <div className="ck">Partner portal — where you log in</div>
        {brokerPortal || profilePortal ? (
          <div className="portal">
            {brokerPortal && (
              <>
                <div className="pt">Broker / ISO portal</div>
                <LinkLine label="" url={brokerPortal} />
              </>
            )}
            {profilePortal && !sameUrl && (
              <>
                <div className="pt">{brokerPortal ? "Portal on the submission profile" : "Submission portal"}</div>
                <LinkLine label="" url={profilePortal} />
                {brokerPortal && (
                  <div className="cred">
                    Two different portal links are recorded for this funder. Neither has been confirmed as the current
                    one — try the broker portal first and tell Ops which works.
                  </div>
                )}
              </>
            )}
            {hint ? (
              hintSafe ? (
                <div className="cred">
                  <b>Credentials:</b> {hint}
                </div>
              ) : (
                <div className="credhold">
                  A credential hint is on file but it isn't labelled — it may be the credential itself, so it is not
                  shown here. Ask Ops.
                </div>
              )
            ) : profilesReadable ? (
              <div className="credhold">
                <b>Portal on file, no credentials recorded.</b> Someone has to request access — that's an action item,
                not a dead end.
              </div>
            ) : (
              <div className="credhold">Credentials unknown — the submission profile could not be read.</div>
            )}
          </div>
        ) : (
          <div className="cnone">No partner portal recorded for this funder.</div>
        )}
      </div>

      {subNotes && (
        <div className="cgroup">
          <Quoted label="Submission notes — quoted, not parsed" text={subNotes} />
        </div>
      )}

      <div className="cgroup">
        <div className="ck">Material we already hold</div>
        {!docs.readable ? (
          <div className="cunk">
            Stored material is UNKNOWN — `lender_documents` is admin-only and returned nothing for your account. Not
            "no material": ask Ops.
          </div>
        ) : mine.length === 0 ? (
          <div className="cnone">Nothing captured from this funder's packet yet.</div>
        ) : (
          <div className="doclist">
            {mine.map((d) => {
              // UCS stores two copies each of its ISO Agreement and Partner Info
              // Sheet — same filename, different bytes, both approved. Say that
              // out loud rather than silently showing one of them.
              const twins = mine.filter((x) => (x.filename ?? "") === (d.filename ?? "")).length;
              return (
                <div className="docrow" key={d.id}>
                  <span className="dt">{DOC_TYPE_LABEL[d.document_type ?? ""] ?? d.document_type ?? "file"}</span>
                  <span>{d.filename ?? "unnamed file"}</span>
                  {twins > 1 && (
                    <span className="dt" title="Same filename stored more than once, with different contents. Nobody has said which is current.">
                      {twins} copies
                    </span>
                  )}
                  <button type="button" className="docopen" onClick={() => open(d)}>
                    open
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {docErr && <div className="docerr">{docErr}</div>}
      </div>
    </>
  );
}
