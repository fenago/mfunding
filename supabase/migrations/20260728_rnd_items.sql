-- R&D strategic game plan, made living.
-- Backs the /admin/rnd page: the owner's MCA operation build-out, captured as
-- interactive items (tasks with a status chip, links, notes, metric rows) that
-- persist their state instead of being a static brochure. One row per item.
--
-- kind: 'task'  → cycle-able status chip, counts toward the phase progress strip
--       'link'  → clickable resource (content.url or content.appLink)
--       'note'  → prose / rule / verdict (no status chip)
--       'metric'→ a row in a rendered table (content holds the columns)
--
-- MCA compliance: internal admin surface, but language stays honest — an MCA is
-- a purchase of future receivables ("advance"/"capital"/"funding"), never a loan.

create table if not exists public.rnd_items (
  id          uuid primary key default gen_random_uuid(),
  section     text not null,
  label       text not null,
  kind        text not null default 'task'
                check (kind in ('task','link','note','metric')),
  content     jsonb not null default '{}'::jsonb,
  status      text not null default 'todo'
                check (status in ('todo','doing','done','n_a')),
  sort_order  integer not null default 0,
  notes       text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null
);

comment on table public.rnd_items is
  'Living R&D game plan behind /admin/rnd. Each row is one plan item; tasks carry a cycle-able status, links/notes/metrics render as reference. Seeded once from the owner''s MCA operation build-out.';

create index if not exists rnd_items_section_sort_idx
  on public.rnd_items (section, sort_order);

-- ── RLS: admin + super_admin, all operations (the page writes from the client) ──
alter table public.rnd_items enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='rnd_items'
      and policyname='Admins manage rnd_items'
  ) then
    create policy "Admins manage rnd_items" on public.rnd_items
      for all
      using (exists (
        select 1 from public.profiles
        where profiles.id = auth.uid()
          and profiles.role in ('admin','super_admin')))
      with check (exists (
        select 1 from public.profiles
        where profiles.id = auth.uid()
          and profiles.role in ('admin','super_admin')));
  end if;
end$$;

-- ── Seed (idempotent: only when the table is empty, so it never clobbers the
--    owner's edits or re-adds items he deleted) ─────────────────────────────
do $$
begin
  if not exists (select 1 from public.rnd_items) then
    insert into public.rnd_items (section, kind, label, content, sort_order) values

    -- THE 8-STEP MCA OPERATION ---------------------------------------------
    ('operation','task','Dial the UCC list',
      '{"who":"Setter","numbers":"200 dials/day → 380 answers/mo","step":1}',1),
    ('operation','task','Qualify + ask for the payoff letter on the call',
      '{"who":"Setter","numbers":"50 qualified/mo","step":2}',2),
    ('operation','task','Complete the file: e-sign app + statements + stip pack',
      '{"who":"Setter → Owner recovers stalls → Processor QCs","numbers":"30 apps → 13–20 complete","step":3,"appLink":"/admin/playbooks","appLinkLabel":"Revenue Playbook","alreadyBuilt":true}',3),
    ('operation','task','Package + submit in funder order',
      '{"who":"Processor","numbers":"13–20/mo","step":4}',4),
    ('operation','task','Underwrite',
      '{"who":"Funder","numbers":"~50% get offers","step":5}',5),
    ('operation','task','Chase stips (assume funders won''t)',
      '{"who":"Processor","numbers":"~10 live files","step":6}',6),
    ('operation','task','Present the offer, close',
      '{"who":"Owner","numbers":"15 min × 7–10/mo","step":7}',7),
    ('operation','task','Contracts, ACH, wire',
      '{"who":"Funder","numbers":"2–3 funded/mo","step":8}',8),
    ('operation','note','Off-menu paths',
      '{"body":"Declines → Plata.BIZ. Renewals fire at 50–60% paid down."}',9),

    -- BUILD PHASE 1 — Weeks 1–2, Infrastructure (owner, ~$600) --------------
    ('build_infra','task','GHL e-sign app + branded upload page + SMS cadence',
      '{"cost":"~$600 (phase)","detail":"Cadence: 15 min / 2 hrs / next morning.","alreadyBuilt":true,"appLink":"/admin/playbooks","appLinkLabel":"Revenue Playbook"}',1),
    ('build_infra','task','Plaid Trial application under OSP.net',
      '{"detail":"Best-odds framing — new entity, identity-verification-driven approval. Ceiling: 10 Production Items total, one-way upgrade.","link":"https://dashboard.plaid.com/support/new","linkLabel":"Plaid support ticket"}',2),
    ('build_infra','task','Book the Lendflow demo',
      '{"detail":"Widget only — their credentials, no marketplace.","link":"https://lendflow.com","linkLabel":"lendflow.com"}',3),
    ('build_infra','task','Purchase MoneyThumb',
      '{"cost":"$549","detail":"Bank-statement conversion + analysis.","link":"https://www.moneythumb.com","linkLabel":"moneythumb.com"}',4),
    ('build_infra','task','Email all 7 funders',
      '{"detail":"Ask each: submission-to-offer time on complete files? who chases approval stips? what volume unlocks an ISO rep?","appLink":"/admin/funder-directory","appLinkLabel":"Funder Directory"}',5),
    ('build_infra','task','Synergy: demand credits + test the new collection flow',
      '{"detail":"Demand a credit on every sub-60-second transfer. Route the remaining transfers through the new collection flow as a live test.","appLink":"/admin/lead-partner","appLinkLabel":"Lead Partner (Synergy)"}',6),

    -- BUILD PHASE 2 — Weeks 3–4, Staffing (~$1,500/mo) ---------------------
    ('build_staffing','task','Hire 2 setters',
      '{"cost":"~$1,500/mo","detail":"Sources: OnlineJobs.ph, Techmart, The Calling Agency. Paid on verified complete files — never on appointments."}',1),
    ('build_staffing','task','Engage a per-deal scrubber from DailyFunder',
      '{"detail":"QC + packaging on each file before it goes out.","link":"https://dailyfunder.com/forum","linkLabel":"DailyFunder forum"}',2),
    ('build_staffing','task','Buy UCC data (~850 records/mo)',
      '{"detail":"Filter for original advances $100K+ — the free deal-size doubler."}',3),

    -- BUILD PHASE 3 — Months 2–3, Prove it (~$2,500/mo all-in) --------------
    ('build_prove','task','Hit 4,000+ dials',
      '{"cost":"~$2,500/mo all-in"}',1),
    ('build_prove','task','Land 25+ clean submissions','{}',2),
    ('build_prove','task','Fund 1–3 deals','{}',3),
    ('build_prove','task','Lever: connect rate 9% → 12%',
      '{"detail":"Weekly lever — squeeze the dial-to-answer conversion."}',4),
    ('build_prove','task','Lever: complete-file rate 45% → 65%',
      '{"detail":"Weekly lever — squeeze qualified calls into complete files."}',5),
    ('build_prove','note','Kill criterion',
      '{"body":"Zero funded on 20+ clean submissions = the list or funder mix is wrong — and you found that out for $2,500, not $25,000."}',6),

    -- MONEY GROWTH (table) --------------------------------------------------
    ('economics','metric','Prove',
      '{"months":"1–3","team":"1–2 setters + scrubber","deals":"2–3","gross":"$8–12K","ownerHrs":"3"}',1),
    ('economics','metric','Multiply',
      '{"months":"4–9","team":"3 setters + 1 processor","deals":"8–10 (renewals start)","gross":"$50–70K","ownerHrs":"8"}',2),
    ('economics','metric','Compound',
      '{"months":"10–18","team":"6 setters + 2 processors + closer","deals":"20+ (renewal book mature)","gross":"$120–165K","ownerHrs":"12 → closer takes it"}',3),

    -- THE THREE MULTIPLIERS -------------------------------------------------
    ('multipliers','note','Deal size',
      '{"gain":"2×, free","body":"UCC filter to $100K+ originals doubles the average advance at zero added cost."}',1),
    ('multipliers','note','Commission',
      '{"gain":"+50%","body":"Concentrate volume in 2–3 funders to move your points from 10% → 15%."}',2),
    ('multipliers','note','Renewals',
      '{"gain":"compounding","body":"Every funded deal renews at month 4–5 at near-zero cost and roughly double the close rate."}',3),

    -- RULES THAT KEEP IT ALIVE ---------------------------------------------
    ('rules','note','Setter never touches bank credentials.','{}',1),
    ('rules','note','Processor QCs every file — one doctored statement can end a funder relationship.','{}',2),
    ('rules','note','Scrub cells for TCPA before dialing.','{}',3),
    ('rules','note','Read the clawback window in every ISO agreement before spending commissions.','{}',4),
    ('rules','note','Plan on 2–2.5 funded per seat at scale, not 3.','{}',5),
    ('rules','note','Assume setter turnover at 4–6 months.','{}',6),
    ('rules','note','The closer gets hired at Phase 3 — when there''s flow to feed them, not before.','{}',7),

    -- THIS WEEK -------------------------------------------------------------
    ('this_week','task','Mon — Plaid Trial app + funder email','{}',1),
    ('this_week','task','Tue — Synergy credit demand + Lendflow demo request','{}',2),
    ('this_week','task','Wed–Thu — GHL build','{}',3),
    ('this_week','task','Fri — setter job posts + UCC data order','{}',4),

    -- PLAID TRIAL STRATEGY (R&D) -------------------------------------------
    ('plaid','note','Verdict: a 2-week pilot, not infrastructure',
      '{"body":"The Trial exists to generate evidence for the full Production application — not to be the finished plumbing.","odds":"Trial ~70%+ · full Production ~coin-flip (better as OSP)"}',1),
    ('plaid','note','Constraint',
      '{"body":"Only NEW Plaid accounts with no prior Production application. Ceiling: 10 Production Items total (10 bank connections, ever). The upgrade is one-way. Review is identity-verification-driven — ~2–3 day manual review if flagged."}',2),
    ('plaid','task','Path 1 — Support ticket to convert the existing team',
      '{"odds":"low–moderate","link":"https://dashboard.plaid.com/support/new","linkLabel":"Open a Plaid ticket"}',3),
    ('plaid','task','Path 2 — Fresh account under a different entity (Agentic Voice Inc / OSP.net)',
      '{"odds":"good","detail":"Own EIN / domain / site. Must be truthful: a software platform collecting bank statements with user permission for business financing applications."}',4),
    ('plaid','task','Path 3 — OSP.net applies as the multi-tenant SaaS platform, MFunding as tenant #1',
      '{"odds":"best","recommended":true,"detail":"Cleanest long-term posture — the platform holds the Plaid relationship, MFunding is tenant #1."}',5),

    -- VENDOR / LINK DIRECTORY ----------------------------------------------
    ('vendors','link','OnlineJobs.ph',
      '{"url":"https://www.onlinejobs.ph","purpose":"Setter hiring — VA marketplace"}',1),
    ('vendors','link','The Calling Agency',
      '{"url":"https://thecallingagency.com","purpose":"Setter hiring — managed callers"}',2),
    ('vendors','link','Techmart',
      '{"url":"https://www.google.com/search?q=Techmart+outbound+calling+staffing","purpose":"Setter hiring","unverified":true}',3),
    ('vendors','link','DailyFunder forum',
      '{"url":"https://dailyfunder.com/forum","purpose":"Per-deal scrubbers — QC + packaging"}',4),
    ('vendors','link','MoneyThumb',
      '{"url":"https://www.moneythumb.com","purpose":"Statement conversion + analysis — $549"}',5),
    ('vendors','link','Plaid dashboard support',
      '{"url":"https://dashboard.plaid.com/support/new","purpose":"Trial → Production upgrade path"}',6),
    ('vendors','link','Lendflow',
      '{"url":"https://lendflow.com","purpose":"Underwriting widget demo"}',7),
    ('vendors','link','Plata.BIZ',
      '{"url":"https://plata.biz","purpose":"Decline monetization","unverified":true}',8),
    ('vendors','link','UCC data purchase',
      '{"url":"https://www.google.com/search?q=UCC+filing+data+MCA+list+provider","purpose":"~850 records/mo, filter $100K+ originals","unverified":true}',9),
    ('vendors','link','Synergy Direct',
      '{"appLink":"/admin/lead-partner","purpose":"Live-transfer partner — demand credits on every sub-60-second transfer"}',10);
  end if;
end$$;
