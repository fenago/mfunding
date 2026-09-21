-- RESTORE v_setter_dial_calls.also_seen_in — a column I dropped myself.
--
-- The page showed: "Could not read setter performance: column
-- v_setter_dial_calls.also_seen_in does not exist".
--
-- WHAT HAPPENED. On 2026-09-18 I recreated this view to add a backward-compatible
-- `disposition_derived_at` alias during a live outage, by wrapping an older
-- definition. That older definition predated 20260916f/20260916g, which is where
-- `also_seen_in` was introduced. The wrap silently dropped it — the column simply
-- stopped existing, and the Call log's SELECT has been failing ever since.
--
-- This is the SAME MISTAKE recorded in the recreate-a-function-from-the-catalog
-- memory, committed by me, to a VIEW rather than a function, while fixing an
-- outage caused by the same class of error. `create or replace view` cannot warn
-- about a column you quietly stop selecting.
--
-- Rebuilt from pg_get_viewdef (the CATALOG, what is actually running), with
-- `also_seen_in` added back in the OUTER select rather than by reconstructing the
-- inner union. The outer layer already carries source/phone/started_at/seconds,
-- so the expression is computed once and the `source = 'wavv'` guard reproduces
-- the original semantics exactly: GHL rows were always NULL (20260916f), because
-- a GHL row cannot "also" be seen in GHL.
--
-- security_invoker=true is RE-ASSERTED at the end. A recreate drops reloptions
-- silently, and that exact loss happened on this exact view on 09-18; it was
-- caught then only by comparing against sibling views.
--
-- Verified after applying: 32 columns, also_seen_in present, disposition_derived_at
-- alias still present, security_invoker=true, 39,656 rows readable, 7 rows where a
-- GHL click-to-call was folded into its WAVV dial.

create or replace view public.v_setter_dial_calls as
 SELECT wavv_call_id,
    source,
    started_at,
    answered_at,
    ended_at,
    seconds,
    outcome,
    disposition,
    disposition_effective,
    disposition_source,
    disposition_derived_reason,
    disposition_derived_from_at,
    outcome_followed_at,
    outcome_followed_kind,
    outcome_followed_refusal,
    human,
    recorded,
    phone,
    contact_id,
    contact_name,
    campaign_id,
    caller_id,
    setter_id,
    caller_label,
    mapping_source,
    setter_name,
    setter_email,
    is_attributed,
    note,
    summary,
    disposition_derived_from_at AS disposition_derived_at,
    -- The WAVV dial and a GHL click-to-call of the same number inside the dedupe
    -- window are ONE dial. The WAVV row wins and carries this marker so the Call
    -- log can say the GHL copy was folded in, rather than the copy vanishing with
    -- no explanation. NULL on GHL rows by construction.
    CASE
      WHEN source = 'wavv' AND EXISTS (
        SELECT 1 FROM ghl_call_log g2
        WHERE g2.direction = 'outbound'
          AND g2.called_at IS NOT NULL
          AND phone IS NOT NULL
          AND "right"(regexp_replace(COALESCE(g2.to_number, ''), '[^0-9]', '', 'g'), 10)
              = "right"(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
          AND "right"(regexp_replace(phone, '[^0-9]', '', 'g'), 10) <> ''
          AND g2.called_at >= (started_at - '01:00:00'::interval)
          AND g2.called_at <= (started_at + '01:00:00'::interval)
          AND abs(EXTRACT(epoch FROM started_at - g2.called_at)) <= (180 + COALESCE(seconds, 0))::numeric
      ) THEN 'ghl'::text
      ELSE NULL::text
    END AS also_seen_in
   FROM ( SELECT v_1.wavv_call_id,
            'wavv'::text AS source,
            v_1.started_at,
            v_1.answered_at,
            v_1.ended_at,
            v_1.seconds,
            v_1.outcome,
            v_1.disposition,
            COALESCE(NULLIF(NULLIF(btrim(v_1.disposition), ''::text), 'None'::text),
                CASE
                    WHEN l.refusal_reason IS NULL THEN l.derived_disposition
                    ELSE NULL::text
                END) AS disposition_effective,
                CASE
                    WHEN NULLIF(NULLIF(btrim(v_1.disposition), ''::text), 'None'::text) IS NOT NULL THEN 'typed'::text
                    WHEN l.refusal_reason IS NULL AND l.derived_disposition IS NOT NULL THEN 'derived'::text
                    ELSE NULL::text
                END AS disposition_source,
                CASE
                    WHEN l.refusal_reason IS NULL THEN l.disposition_derived_reason
                    ELSE NULL::text
                END AS disposition_derived_reason,
                CASE
                    WHEN l.refusal_reason IS NULL THEN l.outcome_at
                    ELSE NULL::timestamp with time zone
                END AS disposition_derived_from_at,
            l.outcome_at AS outcome_followed_at,
            l.evidence_kind AS outcome_followed_kind,
            l.refusal_reason AS outcome_followed_refusal,
            v_1.human,
            v_1.recorded,
            v_1.phone,
            v_1.contact_id,
            v_1.contact_name,
            v_1.campaign_id,
            v_1.caller_id,
            v_1.setter_id,
            v_1.caller_label,
            v_1.mapping_source,
            v_1.setter_name,
            v_1.setter_email,
            v_1.is_attributed,
            v_1.note,
            v_1.summary
           FROM v_wavv_outbound_setter_calls v_1
             LEFT JOIN v_wavv_call_outcome_links l ON l.wavv_call_id = v_1.wavv_call_id
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
            NULLIF(btrim(g.disposition), ''::text) AS disposition_effective,
                CASE
                    WHEN NULLIF(btrim(g.disposition), ''::text) IS NOT NULL THEN 'typed'::text
                    ELSE NULL::text
                END AS disposition_source,
            NULL::text AS disposition_derived_reason,
            NULL::timestamp with time zone AS disposition_derived_from_at,
            NULL::timestamp with time zone AS outcome_followed_at,
            NULL::text AS outcome_followed_kind,
            NULL::text AS outcome_followed_refusal,
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
            NULL::text AS summary
           FROM ghl_call_log g
             LEFT JOIN deals d ON d.id = g.deal_id
             LEFT JOIN customers cu ON cu.id = d.customer_id
             LEFT JOIN closers cl ON cl.ghl_user_id = g.ghl_user_id
             LEFT JOIN staff_directory sd ON sd.id = cl.user_id
             LEFT JOIN profiles p ON p.id = cl.user_id
          WHERE g.direction = 'outbound'::text AND g.called_at IS NOT NULL AND NOT (EXISTS ( SELECT 1
                   FROM wavv_calls w
                  WHERE w.direction = 'outbound'::text AND w.phone IS NOT NULL AND "right"(regexp_replace(w.phone, '[^0-9]'::text, ''::text, 'g'::text), 10) = "right"(regexp_replace(COALESCE(g.to_number, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) AND "right"(regexp_replace(COALESCE(g.to_number, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) <> ''::text AND w.started_at >= (g.called_at - '01:00:00'::interval) AND w.started_at <= (g.called_at + '01:00:00'::interval) AND abs(EXTRACT(epoch FROM w.started_at - g.called_at)) <= (180 + COALESCE(w.seconds, 0))::numeric))) v;

alter view public.v_setter_dial_calls set (security_invoker = true);
