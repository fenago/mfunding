-- Some people who dial are not setters. ══════════════════════════════════════
--
-- Khalil Lyons is tech support. He has 3 outbound calls in ghl_call_log and no
-- `closers` row, so Setter Performance renders him as an UNLINKED setter — a
-- defect badge that invites the next person to "fix" it by giving him a closers
-- row, which would fold tech-support calls into sales activity forever.
--
-- There is no third state today: a dialing human is either an attributed setter
-- or a broken one. This adds the missing one — NOT A SETTER — as data ops can
-- maintain, rather than a name hardcoded in a query.
--
-- And it excludes them VISIBLY. Every excluded row lands in
-- v_setter_dial_calls_excluded with the reason attached, so the page can say
-- "3 calls excluded (non-setter)" instead of quietly rendering 3 fewer dials.
-- A silent drop is indistinguishable from a sync gap, and that is how
-- under-reporting starts.

-- ── 1. The roster ────────────────────────────────────────────────────────────

create table if not exists public.dial_metric_exclusions (
  id              uuid primary key default gen_random_uuid(),
  -- The GHL user whose calls these are. Matches ghl_call_log.ghl_user_id, and
  -- (through closers.ghl_user_id) the WAVV side of the same person.
  ghl_user_id     text unique,
  -- A WAVV dialer LINE, for a phone that is not a setter line at all. Optional;
  -- most exclusions are people, not lines.
  wavv_caller_id  text unique,
  person_name     text not null,
  -- Shown in the UI next to the excluded count. Say what they actually do.
  reason          text not null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  constraint dial_metric_exclusions_needs_a_key
    check (ghl_user_id is not null or wavv_caller_id is not null)
);

comment on table public.dial_metric_exclusions is
  'People and dialer lines whose outbound calls are NOT setter sales activity (tech support, admins, test lines). Excluded from v_setter_dial_calls and surfaced in v_setter_dial_calls_excluded so the exclusion is visible rather than silent. Maintained by ops — never hardcode a name in a query.';

alter table public.dial_metric_exclusions enable row level security;

drop policy if exists dial_metric_exclusions_read on public.dial_metric_exclusions;
create policy dial_metric_exclusions_read on public.dial_metric_exclusions
  for select using (public.is_staff_reader((select auth.uid())));

drop policy if exists dial_metric_exclusions_write on public.dial_metric_exclusions;
create policy dial_metric_exclusions_write on public.dial_metric_exclusions
  for all using (public.is_ops_staff((select auth.uid())))
        with check (public.is_ops_staff((select auth.uid())));

grant select on public.dial_metric_exclusions to authenticated;
grant all    on public.dial_metric_exclusions to service_role;

-- ── 2. Khalil ────────────────────────────────────────────────────────────────

insert into public.dial_metric_exclusions (ghl_user_id, person_name, reason)
values ('tOWjFjnSMkrzdy269Cbw', 'Khalil Lyons',
        'Tech support — not a setter. His outbound calls are support calls, not dials.')
on conflict (ghl_user_id) do update
  set person_name = excluded.person_name,
      reason      = excluded.reason,
      active      = true;

-- ── 3. v_setter_dial_calls_all — one definition, exclusion carried as a column ─
-- The existing body verbatim, plus excluded_reason / excluded_person. Keeping a
-- single base view is the point: the filtered view and the excluded view are two
-- WHERE clauses over it, so "what counts as excluded" can never drift between
-- the number shown and the number explained.

-- security_invoker = true, carried over from the view this replaces: both source
-- tables' RLS still governs, and admin/super_admin — the only roles that can open
-- Setter Performance — satisfy both. Dropping it would make the view run as its
-- owner and quietly bypass wavv_calls / ghl_call_log RLS.
drop view if exists public.v_setter_dial_calls_all cascade;
create view public.v_setter_dial_calls_all
with (security_invoker = true) as
 SELECT v.wavv_call_id,
    'wavv'::text AS source,
    v.started_at,
    v.answered_at,
    v.ended_at,
    v.seconds,
    v.outcome,
    v.disposition,
    v.human,
    v.recorded,
    v.phone,
    v.contact_id,
    v.contact_name,
    v.campaign_id,
    v.caller_id,
    v.setter_id,
    v.caller_label,
    v.mapping_source,
    v.setter_name,
    v.setter_email,
    v.is_attributed,
    v.note,
    v.summary,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM ghl_call_log g2
              WHERE g2.direction = 'outbound'::text AND g2.called_at IS NOT NULL AND v.phone IS NOT NULL AND "right"(regexp_replace(COALESCE(g2.to_number, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) = "right"(regexp_replace(v.phone, '[^0-9]'::text, ''::text, 'g'::text), 10) AND "right"(regexp_replace(v.phone, '[^0-9]'::text, ''::text, 'g'::text), 10) <> ''::text AND g2.called_at >= (v.started_at - '01:00:00'::interval) AND g2.called_at <= (v.started_at + '01:00:00'::interval) AND abs(EXTRACT(epoch FROM v.started_at - g2.called_at)) <= (180 + COALESCE(v.seconds, 0))::numeric)) THEN 'ghl'::text
            ELSE NULL::text
        END AS also_seen_in,
    xw.reason      AS excluded_reason,
    xw.person_name AS excluded_person
   FROM v_wavv_outbound_setter_calls v
     LEFT JOIN closers cxw ON cxw.user_id = v.setter_id
     LEFT JOIN dial_metric_exclusions xw
            ON xw.active
           AND ( (xw.wavv_caller_id IS NOT NULL AND xw.wavv_caller_id = v.caller_id)
              OR (xw.ghl_user_id    IS NOT NULL AND xw.ghl_user_id    = cxw.ghl_user_id) )
UNION ALL
 SELECT 'ghl:'::text || g.ghl_message_id AS wavv_call_id,
    'ghl'::text AS source,
    g.called_at AS started_at,
        CASE
            WHEN g.call_status = ANY (ARRAY['completed'::text, 'voicemail'::text]) THEN g.called_at
            ELSE NULL::timestamp with time zone
        END AS answered_at,
        CASE
            WHEN (g.call_status = ANY (ARRAY['completed'::text, 'voicemail'::text])) AND COALESCE(g.duration_seconds, 0) > 0 THEN g.called_at + make_interval(secs => g.duration_seconds::double precision)
            ELSE NULL::timestamp with time zone
        END AS ended_at,
    g.duration_seconds AS seconds,
    g.call_status AS outcome,
    NULLIF(btrim(g.disposition), ''::text) AS disposition,
    NULL::boolean AS human,
    NULL::boolean AS recorded,
    NULLIF("right"(regexp_replace(COALESCE(g.to_number, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) AS phone,
    g.ghl_contact_id AS contact_id,
    COALESCE(NULLIF(btrim(cu.business_name), ''::text), NULLIF(btrim(concat_ws(' '::text, cu.first_name, cu.last_name)), ''::text)) AS contact_name,
    NULL::text AS campaign_id,
    NULLIF("right"(regexp_replace(COALESCE(g.from_number, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10), ''::text) AS caller_id,
    cl.user_id AS setter_id,
    'GHL / LeadConnector line'::text AS caller_label,
    'ghl_user'::text AS mapping_source,
    COALESCE(sd.name, NULLIF(btrim(g.ghl_user_name), ''::text)) AS setter_name,
    p.email AS setter_email,
    cl.user_id IS NOT NULL AS is_attributed,
    NULL::text AS note,
    NULL::text AS summary,
    NULL::text AS also_seen_in,
    xg.reason      AS excluded_reason,
    xg.person_name AS excluded_person
   FROM ghl_call_log g
     LEFT JOIN deals d ON d.id = g.deal_id
     LEFT JOIN customers cu ON cu.id = d.customer_id
     LEFT JOIN closers cl ON cl.ghl_user_id = g.ghl_user_id
     LEFT JOIN staff_directory sd ON sd.id = cl.user_id
     LEFT JOIN profiles p ON p.id = cl.user_id
     LEFT JOIN dial_metric_exclusions xg
            ON xg.active AND xg.ghl_user_id IS NOT NULL AND xg.ghl_user_id = g.ghl_user_id
  WHERE g.direction = 'outbound'::text AND g.called_at IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM wavv_calls w
          WHERE w.direction = 'outbound'::text AND w.phone IS NOT NULL AND "right"(regexp_replace(w.phone, '[^0-9]'::text, ''::text, 'g'::text), 10) = "right"(regexp_replace(COALESCE(g.to_number, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) AND "right"(regexp_replace(COALESCE(g.to_number, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) <> ''::text AND w.started_at >= (g.called_at - '01:00:00'::interval) AND w.started_at <= (g.called_at + '01:00:00'::interval) AND abs(EXTRACT(epoch FROM w.started_at - g.called_at)) <= (180 + COALESCE(w.seconds, 0))::numeric));

comment on view public.v_setter_dial_calls_all is
  'Every deduped outbound dial from both dialers, INCLUDING calls by people who are not setters. excluded_reason is null for a real setter dial. Read v_setter_dial_calls for metrics and v_setter_dial_calls_excluded for what was left out.';

-- ── 4. The two windows onto it ───────────────────────────────────────────────
-- v_setter_dial_calls keeps EXACTLY the column list it had, so the page's
-- CALL_COLS / LOG_COLS select lists keep working untouched.

drop view if exists public.v_setter_dial_calls;
create view public.v_setter_dial_calls
with (security_invoker = true) as
  select wavv_call_id, source, started_at, answered_at, ended_at, seconds, outcome,
         disposition, human, recorded, phone, contact_id, contact_name, campaign_id,
         caller_id, setter_id, caller_label, mapping_source, setter_name, setter_email,
         is_attributed, note, summary, also_seen_in
    from public.v_setter_dial_calls_all
   where excluded_reason is null;

comment on view public.v_setter_dial_calls is
  'Setter dials only — both dialers, deduped, with calls by known non-setters (dial_metric_exclusions) removed. Those removed rows are NOT lost: they are in v_setter_dial_calls_excluded with a reason, so the page can report them.';

drop view if exists public.v_setter_dial_calls_excluded;
create view public.v_setter_dial_calls_excluded
with (security_invoker = true) as
  select wavv_call_id, source, started_at, seconds, outcome, disposition, phone,
         contact_name, caller_id, setter_name, excluded_person, excluded_reason
    from public.v_setter_dial_calls_all
   where excluded_reason is not null;

comment on view public.v_setter_dial_calls_excluded is
  'The dials v_setter_dial_calls left out and why. Count these over the same date range and SAY the number — an unexplained gap between the dialer and the dashboard is how under-reporting hides.';

grant select on public.v_setter_dial_calls_all      to authenticated, service_role;
grant select on public.v_setter_dial_calls          to authenticated, service_role;
grant select on public.v_setter_dial_calls_excluded to authenticated, service_role;
