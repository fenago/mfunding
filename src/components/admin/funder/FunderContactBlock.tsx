// Who to chase, who else is on file, where the deal goes, and what we hold —
// with every absent field saying "not recorded" out loud.
import { type ContactFields, type DocState, type ProfileRow, clean, mentionsContact } from "@/lib/funderDisclosure";
import { CopyMini, LinkLine, MailLine, PhoneText, Quoted } from "./parts";
import { FunderLinksBlock } from "./FunderLinksBlock";
import { FX } from "./tw";

export function FunderContactBlock({
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
  const name = clean(l.primary_contact_name);
  const email = clean(l.primary_contact_email);
  const phone = clean(l.primary_contact_phone);
  const site = clean(l.website);
  // `contacts` is jsonb — shape-check it rather than trusting the column.
  const people = (Array.isArray(l.contacts) ? l.contacts : []).filter(
    (p) => clean(p?.name) || clean(p?.email) || clean(p?.phone),
  );
  // The primary rep is usually repeated inside `contacts` — don't print them twice.
  const others = people.filter((p) => !email || clean(p.email)?.toLowerCase() !== email.toLowerCase());

  const subTo = clean(profile?.to_email);
  const subCc = (profile?.cc_emails ?? []).map(clean).filter((x): x is string => !!x);
  const subPortal = clean(profile?.portal_url);
  const catalogSub = clean(l.submission_email);

  const profNote = clean(profile?.internal_notes);
  const lenderNote = clean(l.notes);
  const notes: { k: string; v: string }[] = [];
  if (mentionsContact(profNote)) notes.push({ k: "From the submission profile's notes", v: profNote as string });
  if (mentionsContact(lenderNote)) notes.push({ k: "From the funder record's notes", v: lenderNote as string });

  return (
    <div className={FX.contact}>
      <div className={FX.cgroup}>
        <div className={FX.ck}>Who to chase — the rep</div>
        {name ? <div className={FX.cline}><span className={FX.who}>{name}</span></div> : <div className={FX.cnone}>Name not recorded.</div>}
        {email ? <MailLine label="Email" email={email} /> : <div className={FX.cnone}>Email not recorded.</div>}
        {phone ? (
          <div className={FX.cline}>
            <span className={FX.lbl}>Phone</span>
            <span>
              <PhoneText text={phone} />
            </span>
            <CopyMini value={phone} what="phone number" />
          </div>
        ) : (
          <div className={FX.cnone}>Phone not recorded.</div>
        )}
      </div>

      <div className={FX.cgroup}>
        <div className={FX.ck}>Other people on file</div>
        {others.length === 0 ? (
          <div className={FX.cnone}>No other contacts recorded for this funder.</div>
        ) : (
          others.map((p, i) => (
            <div className={FX.cperson} key={`${clean(p.email) ?? clean(p.phone) ?? i}`}>
              <div className={FX.cline}>
                <span className={FX.who}>{clean(p.name) ?? "Name not recorded"}</span>
                {clean(p.title) && <span className={FX.lbl}>{clean(p.title)}</span>}
              </div>
              {clean(p.email) && <MailLine label="Email" email={clean(p.email) as string} />}
              {clean(p.phone) && (
                <div className={FX.cline}>
                  <span className={FX.lbl}>Phone</span>
                  <span>
                    <PhoneText text={clean(p.phone) as string} />
                  </span>
                  <CopyMini value={clean(p.phone) as string} what="phone number" />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className={FX.cgroup}>
        <div className={FX.ck}>Where the deal goes — submission</div>
        {!profilesReadable ? (
          <>
            <div className={FX.cunk}>
              Submission recipe UNKNOWN — the profile table came back empty or unreadable for your account. Not
              "no address": ask Ops before sending anything.
            </div>
            {catalogSub && <MailLine label="Catalog" email={catalogSub} />}
          </>
        ) : subTo || subPortal || catalogSub ? (
          <>
            {subTo && <MailLine label="Deals to" email={subTo} />}
            {subCc.map((cc) => (
              <MailLine key={cc} label="CC" email={cc} />
            ))}
            {subPortal && (
              <div className={FX.cline}>
                <span className={FX.lbl}>Portal</span>
                <a className={FX.cmail} href={subPortal} target="_blank" rel="noreferrer">
                  {subPortal}
                </a>
              </div>
            )}
            {!subTo && !subPortal && catalogSub && (
              <>
                <MailLine label="Catalog" email={catalogSub} />
                <div className={FX.cnone}>
                  From the funder record, not from a send recipe — no submission profile is set up for this funder.
                </div>
              </>
            )}
          </>
        ) : (
          <div className={FX.cnone}>No submission address or portal recorded for this funder.</div>
        )}
      </div>

      {notes.length > 0 && (
        <div className={FX.cgroup}>
          {notes.map((n) => (
            <Quoted key={n.k} label={`${n.k} — quoted, not parsed into fields`} text={n.v} />
          ))}
        </div>
      )}

      <FunderLinksBlock l={l} profile={profile} profilesReadable={profilesReadable} docs={docs} />

      <div className={FX.cgroup}>
        {site ? (
          <LinkLine label="Website" url={site} />
        ) : (
          <div className={FX.cnone}>Website not recorded.</div>
        )}
      </div>
    </div>
  );
}

