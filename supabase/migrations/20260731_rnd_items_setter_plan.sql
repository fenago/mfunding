-- R&D "Setter Operation — Build Plan" section.
-- A DETAILED, step-by-step build plan for a NEW, PARALLEL outbound line: two
-- Philippine-based setters dialing UCC lists, driving live calls to a complete
-- file (signed app + Plaid), then handing off to the existing business ONLY at
-- Bank Connected. Documented so a developer (Khalil) + the owner can execute it.
--
-- ⛔ PLAN ONLY. Seeds content into rnd_items; builds NONE of the infrastructure.
--    It builds all-new assets prefixed "SETTER" and must never modify the
--    existing MCA/VCF pipelines, playbooks, workflows, or doc templates.
--
-- Sections (all prefixed plan_ so the page can render them as a cluster right
-- after This Week; existing R&D content is untouched):
--   plan_intro       one note — the lead-in banner
--   plan_guardrails  4 hard rules (parallel-build guardrails)
--   plan_phases      Phases 0–5 as checkable tasks (content.phase groups them)
--   plan_pipeline    the 9 SETTER pipeline stages (colored cards)
--   plan_automations per-stage automations (table: stage / trigger / action)
--   plan_scripts     call scripts + resistance/fallback ladders + objection bank
--   plan_econ        unit economics (cost table + revenue-math notes + caveat)
--   plan_kpis        KPIs & targets (table: kpi / target / tier)
--   plan_funnel      funnel with targets (table: stage / count / note)
--
-- MCA compliance: internal surface, language stays honest — advance / capital /
-- funding, never "loan". JSON values use $j$…$j$ dollar-quoting so verbatim
-- scripts (apostrophes, quotes) need no escaping.

do $$
begin
  if not exists (select 1 from public.rnd_items where section like 'plan_%') then
    insert into public.rnd_items (section, kind, label, content, sort_order) values

    -- INTRO ---------------------------------------------------------------
    ('plan_intro','note','Setter Operation — a NEW parallel line',
      $j$ {"body":"Two Philippine-based setters dial UCC lists all day, drive every live call to a COMPLETE FILE (e-signed app + Plaid bank connect), and hand off to the existing business ONLY at Bank Connected. It builds all-new assets prefixed SETTER and must never modify the existing MCA/VCF pipelines, playbooks, workflows, or doc templates. Execute phase by phase; tap each step's chip as it lands. This is a plan surface — nothing here is built yet."} $j$, 1),

    -- PARALLEL-BUILD GUARDRAILS (hard rules) ------------------------------
    ('plan_guardrails','note','All new assets are prefixed "SETTER"; the existing pipelines, playbooks, workflows and doc templates are READ-ONLY to this project.', $j$ {} $j$, 1),
    ('plan_guardrails','note','Handoff to the main business happens ONLY at Bank Connected (complete file). The setter pipeline is upstream — never entangled with the existing flow.', $j$ {} $j$, 2),
    ('plan_guardrails','note','The existing business keeps running untouched; this line gets its OWN campaign codes for clean audit separation.', $j$ {} $j$, 3),
    ('plan_guardrails','note','TCPA: scrub cells before dialing; DNC is honored globally.', $j$ {} $j$, 4),

    -- PHASES 0–5 (checkable tasks; content.phase groups them) -------------
    -- Phase 0
    ('plan_phases','task','Choose the power dialer (demo both, then decide)',
      $j$ {"phase":"Phase 0 — Decisions & Purchases (owner)","step":"0.1","who":"Owner","detail":"Front-runners: Hot Prospector ($137–497/mo flat, 3-line parallel, built for GHL, bring-your-own-Twilio) vs PowerDialer.ai (~$45–199/user/mo, up to 5-line parallel, native GHL sync, PH-carrier-optimized). Book demos of both; test call quality WITH a PH-based tester; verify true two-way GHL sync of dispositions. Decision gate: pick one, start with power + 3-line parallel; go predictive only at 10+ agents."} $j$, 1),
    ('plan_phases','task','Buy 2 GHL phone numbers (one per setter)',
      $j$ {"phase":"Phase 0 — Decisions & Purchases (owner)","step":"0.2","who":"Owner","cost":"~$1–3/mo each + usage","detail":"Settings → Phone Numbers → Add Number; 954 area code preferred. Label \"SETTER 1 PH\" / \"SETTER 2 PH\". Do NOT add them to the corp ring group. (True cost is far below the $50 guess.)"} $j$, 2),
    ('plan_phases','task','Order UCC list data (+ optional aged Synergy ammo)',
      $j$ {"phase":"Phase 0 — Decisions & Purchases (owner)","step":"0.3","who":"Owner","cost":"~$500–850/mo","detail":"Klover Data — filter for $100K+ originals (the free deal-size doubler). Optionally layer aged Synergy data as extra dialing ammo.","appLink":"/admin/rnd","appLinkLabel":"See Vendor Directory below"} $j$, 3),
    -- Phase 1
    ('plan_phases','task','Create the pipeline: SETTER — Outbound (PH), 9 stages',
      $j$ {"phase":"Phase 1 — GHL Infrastructure (dev, ~2–3 days)","step":"1.1","who":"Dev","detail":"An all-new pipeline with 9 distinct-colored stages — see The SETTER Pipeline below for the verbatim stage names + definitions. Never touch the MCA or VCF pipelines."} $j$, 4),
    ('plan_phases','task','Wire the per-stage automations',
      $j$ {"phase":"Phase 1 — GHL Infrastructure (dev, ~2–3 days)","step":"1.2","who":"Dev","detail":"See the Per-Stage Automations table. House rule (July 13): stage moves NEVER auto-send docs — the packet workflow is enrollment-only, with no trigger."} $j$, 5),
    ('plan_phases','task','Build the dead-simple packet: one email, two buttons',
      $j$ {"phase":"Phase 1 — GHL Infrastructure (dev, ~2–3 days)","step":"1.3","who":"Dev","detail":"(a) Combined e-sign doc \"SETTER — Application + Broker Disclosure (Combined)\": duplicate content from the 04C application + Broker Comp Disclosure into ONE new D&C template — never edit the originals (doc-editor gotchas: fillable fields do not pre-fill, autolink corrupts merge tags, reload-after-save to verify). (b) \"Connect your bank — 60 seconds\" button → per-merchant my.mfunding.net/connect-bank/<token> from a new custom field setter_connect_bank_url, minted by a small edge function (send-setter-packet: mints the Plaid link → writes the custom field → enrolls in SETTER 01). Email copy (advance/funding, never loan): \"Two quick steps: 1) tap to review + sign (30s)  2) tap to securely connect your bank (60s — we never see your login).\""} $j$, 6),
    -- Phase 2
    ('plan_phases','task','Add a new Revenue Playbook: "Setter Operation" (parallel)',
      $j$ {"phase":"Phase 2 — App Build (dev, ~3–4 days)","step":"2.1","who":"Dev","detail":"Study src/data/playbooks.ts and ADD a new playbook definition — never modify the existing MCA playbook. Steps mirror the 9 stages, each with the say-this script, the packet-send action, the Plaid status chip, and the handoff step.","appLink":"/admin/playbooks","appLinkLabel":"Revenue Playbook"} $j$, 7),
    ('plan_phases','task','Build the setter scorecard / daily dashboards',
      $j$ {"phase":"Phase 2 — App Build (dev, ~3–4 days)","step":"2.2","who":"Dev","detail":"Daily per-setter: dials, live conversations, application attempts, signed, Plaid connected, fallback appts (data from dialer sync + pipeline stages). Daily targets on the card: 320–350 dials · 38–45 convos · 22–28 attempts · 2–3 signed · 1.5–2 Plaid."} $j$, 8),
    ('plan_phases','task','Wire setter KPIs into the Campaign Audit patterns',
      $j$ {"phase":"Phase 2 — App Build (dev, ~3–4 days)","step":"2.3","who":"Dev","detail":"Cost-per-signed and cost-per-funded per list source, reusing the existing Campaign Audit patterns. This line gets its own campaign codes for audit separation."} $j$, 9),
    -- Phase 3
    ('plan_phases','task','Post the setter roles',
      $j$ {"phase":"Phase 3 — Hiring 2 PH Setters (owner+dev, parallel to Phases 1–2, ~2 weeks)","step":"3.1","who":"Owner","detail":"Post on OnlineJobs.ph, The Calling Agency, Techmart. JD core: full-time MCA appointment-to-application setter, US business hours, fluent English, prior US outbound sales, own quiet workspace + stable internet (25 Mbps+), dialer/CRM experience a plus."} $j$, 10),
    ('plan_phases','task','Set the setter comp plan (never per appointment booked)',
      $j$ {"phase":"Phase 3 — Hiring 2 PH Setters (owner+dev, parallel to Phases 1–2, ~2 weeks)","step":"3.2","who":"Owner","detail":"$550/mo base + $45/signed agreement + $75/Plaid connected + $8/fallback appointment shown + $120/funded override. Strong performer ≈ $3,000–4,500/mo. NEVER pay per appointment booked. All-in for 2 setters ≈ $3,200–3,400/mo (~$10/hr equivalent)."} $j$, 11),
    ('plan_phases','task','Screen + secure: voice → roleplay → paid trial → hire',
      $j$ {"phase":"Phase 3 — Hiring 2 PH Setters (owner+dev, parallel to Phases 1–2, ~2 weeks)","step":"3.3","who":"Owner","detail":"Voice sample → live roleplay on the objection scripts → paid 3-day trial on aged data → hire. Security: setters NEVER touch bank credentials; individual logins only; MFA required; offboarding = same-day revocation (per the Access Control Policy)."} $j$, 12),
    ('plan_phases','task','Run training week',
      $j$ {"phase":"Phase 3 — Hiring 2 PH Setters (owner+dev, parallel to Phases 1–2, ~2 weeks)","step":"3.4","who":"Owner","detail":"Scripts + objection drills + tool walkthrough (dialer, GHL, packet send, Plaid explainer) + listen to the best real calls."} $j$, 13),
    -- Phase 4
    ('plan_phases','task','Finalize + drill the call scripts',
      $j$ {"phase":"Phase 4 — Scripts","step":"4.1","who":"Owner + Dev","detail":"See the Setter Scripts block below. Load the opener, application close, Plaid pivot, resistance ladder, fallback ladder, and objection bank into training and the Setter playbook. Owner to confirm/replace the draft objection responses with the approved verbatim set."} $j$, 14),
    -- Phase 5
    ('plan_phases','task','Weeks 1–2 ramp: heavy call review + daily scorecards',
      $j$ {"phase":"Phase 5 — Launch & Scale Gates","step":"5.1","who":"Owner","detail":"Heavy call review; daily scorecards posted in the group chat; announce every Signed and every Plaid connected."} $j$, 15),
    ('plan_phases','task','KILL CRITERION: 20+ clean submissions, zero fundings → stop',
      $j$ {"phase":"Phase 5 — Launch & Scale Gates","step":"5.2","who":"Owner","detail":"20+ clean submissions with zero fundings → STOP and diagnose the list/funder mix. You learned that for ~$2,500, not $25,000."} $j$, 16),
    ('plan_phases','task','Scale gate: add setter #3 only after the bar is met',
      $j$ {"phase":"Phase 5 — Launch & Scale Gates","step":"5.3","who":"Owner","detail":"Add setter #3 only after 45–60 days of consistent per-setter targets AND first funded deals. October milestone: 3–4 funded/mo = the exact bar Zach @ Greenbox set + the Bitty reapplication window."} $j$, 17),

    -- THE SETTER PIPELINE — 9 stages --------------------------------------
    ('plan_pipeline','note','New List Lead',        $j$ {"stageNum":1,"color":"gray","stageName":"New List Lead","definition":"Raw record, untouched."} $j$, 1),
    ('plan_pipeline','note','Dialing',              $j$ {"stageNum":2,"color":"blue","stageName":"Dialing","definition":"Actively worked."} $j$, 2),
    ('plan_pipeline','note','Live Conversation',    $j$ {"stageNum":3,"color":"teal","stageName":"Live Conversation","definition":"Real conversation — qualifying."} $j$, 3),
    ('plan_pipeline','note','Application Attempt',  $j$ {"stageNum":4,"color":"purple","stageName":"Application Attempt","definition":"Packet sent live on the call."} $j$, 4),
    ('plan_pipeline','note','Signed',               $j$ {"stageNum":5,"color":"orange","stageName":"Signed","definition":"Application + agreement signed."} $j$, 5),
    ('plan_pipeline','note','Bank Connected',       $j$ {"stageNum":6,"color":"green","stageName":"Bank Connected","definition":"Plaid done — COMPLETE FILE. Handoff to the main business pipeline happens HERE.","handoff":true} $j$, 6),
    ('plan_pipeline','note','Fallback Appointment', $j$ {"stageNum":7,"color":"yellow","stageName":"Fallback Appointment","definition":"Would not sign now; follow-up booked."} $j$, 7),
    ('plan_pipeline','note','Not Interested / DNC', $j$ {"stageNum":8,"color":"red","stageName":"Not Interested / DNC","definition":"Closed — honors do-not-call."} $j$, 8),
    ('plan_pipeline','note','Recycle / Nurture',    $j$ {"stageNum":9,"color":"brown","stageName":"Recycle / Nurture","definition":"Re-dial later."} $j$, 9),

    -- PER-STAGE AUTOMATIONS (table) ---------------------------------------
    ('plan_automations','metric','Application Attempt',
      $j$ {"trigger":"None — enrollment only","action":"Enroll in the \"SETTER 01 — Packet Send\" workflow. Stage moves NEVER auto-send docs (house rule, July 13)."} $j$, 1),
    ('plan_automations','metric','Signed',
      $j$ {"trigger":"Stage → Signed","action":"Internal notification."} $j$, 2),
    ('plan_automations','metric','Bank Connected',
      $j$ {"trigger":"Stage → Bank Connected","action":"Notify owner/closer + create a deal in the MAIN pipeline. HANDOFF POINT — only here does the record enter the existing business flow.","handoff":true} $j$, 3),
    ('plan_automations','metric','Fallback Appointment',
      $j$ {"trigger":"Stage → Fallback Appointment","action":"Confirmation + reminder cadence."} $j$, 4),
    ('plan_automations','metric','Recycle / Nurture',
      $j$ {"trigger":"Stage → Recycle","action":"30-day re-dial cadence + Sequence-F-style reactivation."} $j$, 5),
    ('plan_automations','metric','Not Interested / DNC',
      $j$ {"trigger":"Stage → DNC","action":"Write to the suppression list."} $j$, 6),

    -- SCRIPTS -------------------------------------------------------------
    ('plan_scripts','note','Opener (pattern interrupt)',
      $j$ {"script":"Hi [First Name], this is [Setter] with Momentum Funding — quick question… Are you currently open to an extra $20K–$100K in working capital for the business if the terms made sense, or are you all set on funding right now?"} $j$, 1),
    ('plan_scripts','note','Application close',
      $j$ {"script":"I'll send you a short agreement right now — takes 30 seconds to sign. Once that's done we can pull your numbers and show you exact options. Sending now — open it while we're on the phone."} $j$, 2),
    ('plan_scripts','note','Plaid pivot',
      $j$ {"script":"Perfect, signature came through. Last step — connect your bank through Plaid, takes about a minute; it's read-only, we never see your login. Sending the link — click it while we're on."} $j$, 3),
    ('plan_scripts','note','Plaid resistance ladder',
      $j$ {"ladder":[{"label":"Soft","text":"It's the same system your bank uses for apps like Venmo — read-only, we never see your login or password."},{"label":"Strong","text":"We can do it that way, or you email PDF statements — but that slows everything down by days, and funders move fastest on the cleanest files."},{"label":"Final","text":"No problem — let's lock a quick time to finish it together so you don't lose the spot. (Convert to a Fallback Appointment.)"}]} $j$, 4),
    ('plan_scripts','note','Application decline → fallback appointment ladder',
      $j$ {"draft":true,"ladder":[{"label":"Offer the time","text":"Totally fair. Let's book 15 minutes so you can review it with your numbers in front of you — I'll hold your file open and we finish it live."},{"label":"Lower the bar","text":"Even just a quick look — no commitment. I'll send a calendar link and we'll go through it together."},{"label":"Recycle","text":"All good — I'll check back when the timing's better. (Move to Recycle / Nurture.)"}]} $j$, 5),
    ('plan_scripts','note','Objection bank',
      $j$ {"draft":true,"objections":[{"q":"Not interested","a":"Fair enough — most owners I call weren't looking. Quick one: if I could get you $20K–$100K at terms that actually made sense, is that worth 60 seconds, or truly a no?"},{"q":"Who is this / where'd you get my number?","a":"This is [Setter] with Momentum Funding — we work with business owners on working capital. Your business came up on a public UCC filing list. Want me to take you off, or is a little extra capital useful right now?"},{"q":"Just send me an email","a":"Happy to — but the offer depends on your numbers, so give me 60 seconds now and I'll email you something real instead of a brochure. Fair?"},{"q":"I'm busy","a":"I'll be quick — 30 seconds. Are you open to extra working capital if the terms made sense, yes or no? If yes, I'll book a better time."},{"q":"Already funded / already have an advance","a":"Perfect — that's actually who we help most. A lot of owners add a position or line up a renewal at better terms. Want to see what you'd qualify for?"},{"q":"I'm not giving my bank info","a":"Totally get it — it's read-only, the same tech your bank uses for Venmo, and we never see your login. Or we can do PDF statements, it's just slower. (Then run the Plaid resistance ladder.)"},{"q":"Let me check with my partner","a":"Smart — let's book 15 minutes with both of you so nobody's relaying numbers second-hand. I'll hold your file open."},{"q":"What's the rate / what are the terms?","a":"Great question — the honest answer is it depends on your numbers, which is exactly why the next step is a quick look at your statements. Once we have those I'll show you 2+ real options side by side, no guessing."}]} $j$, 6),

    -- UNIT ECONOMICS (cost table + notes) ---------------------------------
    ('plan_econ','metric','2 setters',              $j$ {"amount":"$3,200–3,400/mo"} $j$, 1),
    ('plan_econ','metric','Power dialer',           $j$ {"amount":"$300–500/mo"} $j$, 2),
    ('plan_econ','metric','Lead data',              $j$ {"amount":"$2,000–4,000/mo"} $j$, 3),
    ('plan_econ','metric','GHL + phone numbers',    $j$ {"amount":"$300–400/mo"} $j$, 4),
    ('plan_econ','metric','TOTAL',                  $j$ {"amount":"$5,800–8,300/mo","total":true} $j$, 5),
    ('plan_econ','note','Revenue math',
      $j$ {"body":"Avg deal $40K × 10 points = $4,000 per funded. Break-even ≈ 2 funded/mo."} $j$, 6),
    ('plan_econ','note','Model at ramp',
      $j$ {"body":"14,000–15,500 dials → 1,700–1,900 conversations (12%) → 45–55 signed → 32–40 Plaid → 16–22 funded → $64K–88K/mo revenue."} $j$, 7),
    ('plan_econ','note','Honesty caveat',
      $j$ {"caveat":true,"body":"These conversion rates are the model's ASSUMPTIONS, not yet demonstrated by our own funnel (138 leads → 1 submission historically). Treat months 1–3 as the proving period — targets, not forecasts."} $j$, 8),

    -- KPIs & TARGETS (table) ----------------------------------------------
    ('plan_kpis','metric','Dials',                  $j$ {"target":"≥ 320","tier":"Daily / setter"} $j$, 1),
    ('plan_kpis','metric','Live conversations',     $j$ {"target":"≥ 38 (12% contact)","tier":"Daily / setter"} $j$, 2),
    ('plan_kpis','metric','Application attempts',   $j$ {"target":"≥ 22","tier":"Daily / setter"} $j$, 3),
    ('plan_kpis','metric','Signed',                 $j$ {"target":"≥ 2","tier":"Daily / setter"} $j$, 4),
    ('plan_kpis','metric','Plaid connected',        $j$ {"target":"≥ 1.5","tier":"Daily / setter"} $j$, 5),
    ('plan_kpis','metric','Fallback appointments',  $j$ {"target":"4–6","tier":"Daily / setter"} $j$, 6),
    ('plan_kpis','metric','Signed',                 $j$ {"target":"10–14","tier":"Weekly / setter"} $j$, 7),
    ('plan_kpis','metric','Plaid connected',        $j$ {"target":"8–11","tier":"Weekly / setter"} $j$, 8),
    ('plan_kpis','metric','Signed → Plaid',         $j$ {"target":"≥ 70%","tier":"Funnel"} $j$, 9),
    ('plan_kpis','metric','Plaid → submitted',      $j$ {"target":"≥ 90%","tier":"Funnel"} $j$, 10),
    ('plan_kpis','metric','Submitted → approved',   $j$ {"target":"~ 50%","tier":"Funnel"} $j$, 11),
    ('plan_kpis','metric','Approved → funded',      $j$ {"target":"~ 80%","tier":"Funnel"} $j$, 12),
    ('plan_kpis','metric','Cost per signed',        $j$ {"target":"≤ $150","tier":"Funnel"} $j$, 13),
    ('plan_kpis','metric','Cost per funded',        $j$ {"target":"≤ $600","tier":"Funnel"} $j$, 14),
    ('plan_kpis','metric','List quality',           $j$ {"target":"via Campaign Audit (email hard-bad %, contact rate)","tier":"Funnel"} $j$, 15),

    -- FUNNEL WITH TARGETS (table, monthly @ 2 setters) --------------------
    ('plan_funnel','metric','Dials',                $j$ {"count":"14,500","note":"—"} $j$, 1),
    ('plan_funnel','metric','Conversations',        $j$ {"count":"1,750","note":"12% contact"} $j$, 2),
    ('plan_funnel','metric','Application attempts', $j$ {"count":"1,050","note":"—"} $j$, 3),
    ('plan_funnel','metric','Signed',               $j$ {"count":"48","note":"+12–15 from fallback appts → ~46–49 realistic"} $j$, 4),
    ('plan_funnel','metric','Plaid',                $j$ {"count":"34","note":"—"} $j$, 5),
    ('plan_funnel','metric','Submitted',            $j$ {"count":"34","note":"—"} $j$, 6),
    ('plan_funnel','metric','Approved',             $j$ {"count":"17","note":"50%"} $j$, 7),
    ('plan_funnel','metric','Funded',               $j$ {"count":"13–16","note":"80%"} $j$, 8),
    ('plan_funnel','metric','Revenue',              $j$ {"count":"$52K–64K","note":"Stretch (aggressive): 18–20 funded / $72–80K","total":true} $j$, 9);
  end if;
end$$;
