-- Make the exclusion lookup hashable. ════════════════════════════════════════
--
-- 20260916f attached the exclusion with ONE join carrying an OR across two key
-- spaces:
--
--   LEFT JOIN dial_metric_exclusions xw
--          ON xw.active
--         AND ( (xw.wavv_caller_id IS NOT NULL AND xw.wavv_caller_id = v.caller_id)
--            OR (xw.ghl_user_id    IS NOT NULL AND xw.ghl_user_id    = cxw.ghl_user_id) )
--
-- An OR across two different columns is not an equi-join, so the planner cannot
-- hash it. It fell back to a per-row BitmapOr probe — TWO index scans for EVERY
-- WAVV row, against a table holding ONE row:
--
--   Nested Loop Left Join            52.2ms   buffers 23,796
--     -> everything else              23.3ms   buffers  5,290
--     -> Bitmap Heap Scan on dial_metric_exclusions, loops=9253
--                                             buffers 18,506
--
-- 78% of the buffers and more than half the time, to discover nothing matched.
-- That lands on the HOT path: the Funnel/Setters aggregate pass fires up to 18
-- of these page queries in parallel on every range change (CALL_COLS, which is
-- also why `also_seen_in` is kept a prunable correlated subquery and nothing
-- else may become one). It measured 24.8ms -> 52.5ms on a 7-day slice.
--
-- The fix is two plain equi-joins instead of one OR'd join. Each is sargable
-- against the unique index on its own key, the 1-row table hashes to nothing,
-- and excluded_reason becomes a coalesce of the two. Identical semantics, same
-- column list, same security_invoker — so the two dependent views need no change
-- and `create or replace` suffices (no drop, no cascade).

create or replace view public.v_setter_dial_calls_all
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
    -- A line can be excluded, or the person behind it can be. Two separate
    -- equi-joins, never one OR: see the header.
    COALESCE(xwl.reason,      xwp.reason)      AS excluded_reason,
    COALESCE(xwl.person_name, xwp.person_name) AS excluded_person
   FROM v_wavv_outbound_setter_calls v
     LEFT JOIN closers cxw ON cxw.user_id = v.setter_id
     LEFT JOIN dial_metric_exclusions xwl
            ON xwl.active AND xwl.wavv_caller_id = v.caller_id
     LEFT JOIN dial_metric_exclusions xwp
            ON xwp.active AND xwp.ghl_user_id = cxw.ghl_user_id
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
            ON xg.active AND xg.ghl_user_id = g.ghl_user_id
  WHERE g.direction = 'outbound'::text AND g.called_at IS NOT NULL AND NOT (EXISTS ( SELECT 1
           FROM wavv_calls w
          WHERE w.direction = 'outbound'::text AND w.phone IS NOT NULL AND "right"(regexp_replace(w.phone, '[^0-9]'::text, ''::text, 'g'::text), 10) = "right"(regexp_replace(COALESCE(g.to_number, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) AND "right"(regexp_replace(COALESCE(g.to_number, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) <> ''::text AND w.started_at >= (g.called_at - '01:00:00'::interval) AND w.started_at <= (g.called_at + '01:00:00'::interval) AND abs(EXTRACT(epoch FROM w.started_at - g.called_at)) <= (180 + COALESCE(w.seconds, 0))::numeric));

comment on view public.v_setter_dial_calls_all is
  'Every deduped outbound dial from both dialers, INCLUDING calls by people who are not setters. excluded_reason is null for a real setter dial. Read v_setter_dial_calls for metrics and v_setter_dial_calls_excluded for what was left out. The exclusion is attached as two sargable equi-joins (line key, person key) and never as one OR''d join — an OR across the two key spaces forces a per-row BitmapOr probe that doubled the aggregate read (20260916g).';
