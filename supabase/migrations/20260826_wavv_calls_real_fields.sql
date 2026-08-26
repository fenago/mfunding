-- wavv_calls: capture the fields the LIVE WAVV v3 call object actually carries.
--
-- The original table was designed against WAVV's published docs without a working
-- API key. With the key live (2026-08-26) an 8,015-row probe of GET /v3/calls
-- returned exactly these 18 keys and no others:
--
--   id teamId campaignId direction phone callerId contactId contactName
--   startedAt answeredAt endedAt seconds outcome disposition human note
--   summary recorded
--
-- Five of them had nowhere to land and were being dropped on the floor (they
-- survived only inside `raw`). Notably contactId, which is the GHL contact id in
-- the MFunding location (verified live against services.leadconnectorhq.com) —
-- the ONLY join key between a WAVV call and anything else we own.
--
-- There is NO per-agent / per-user field. See the agent_key comment below.

alter table public.wavv_calls
  add column if not exists team_id      text,
  add column if not exists campaign_id  text,
  add column if not exists contact_id   text,
  add column if not exists contact_name text,
  add column if not exists note         text;

comment on column public.wavv_calls.contact_id is
  'GHL contact id (MFunding location t7NmVR4WCy927j4Zon4b). Verified live. The only
   join key from a WAVV call to a lead/customer we own.';

comment on column public.wavv_calls.campaign_id is
  'WAVV dial-campaign id. The only server-side grouping axis WAVV honors as a filter
   on GET /v3/calls (?campaignId=). NOT a setter identity.';

comment on column public.wavv_calls.note is
  'Free-text note the dialer attaches to the call. Mostly auto-generated
   ("Played voicemail ...", "Auto-disposition", "Call blocked by carrier") but real
   setter notes appear here too ("Amount needed: 230k", "CS - 635-640").';

comment on column public.wavv_calls.agent_key is
  'ALWAYS NULL as of 2026-08-26 — and that is a property of WAVV, not a bug here.
   The v3 call object carries NO user/agent/member/seat/owner field; an 8,015-row
   live probe confirmed the complete key set. The key we hold is scoped to /calls
   only (/v3/users, /v3/team, /v3/campaigns all return 401 INVALID_API_KEY), so the
   roster cannot be fetched either, and /calls silently ignores unknown filter
   params (userId=, agentId=, expand=user all no-op rather than 400). Per-setter
   attribution is therefore NOT derivable from this API at its current scope.
   Do NOT proxy it from caller_id (only 2 shared numbers) or campaign_id — that
   would manufacture attribution that does not exist. Leave it NULL and render
   "Unattributed" until WAVV widens the key scope or adds the field.';

comment on column public.wavv_calls.answered_at is
  'Reliable. On the live probe answered_at IS NOT NULL agreed with seconds > 0 on
   all 8,015 rows (zero disagreements in either direction), so CONNECT can be
   defined as answered_at is not null. The seconds>0 fallback is not needed.';

-- contact_id drives every join to a lead/customer; campaign_id and
-- direction+started_at drive the scorecard's group-bys.
create index if not exists wavv_calls_contact_id_idx
  on public.wavv_calls (contact_id) where contact_id is not null;
create index if not exists wavv_calls_campaign_id_idx
  on public.wavv_calls (campaign_id) where campaign_id is not null;
create index if not exists wavv_calls_direction_started_idx
  on public.wavv_calls (direction, started_at desc);
create index if not exists wavv_calls_disposition_idx
  on public.wavv_calls (disposition) where disposition is not null;
