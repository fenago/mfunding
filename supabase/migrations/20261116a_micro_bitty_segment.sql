-- ═════════════════════════════════════════════════════════════════════════════
-- "Momentum Micro" cold-email campaign — PHASE 1: the target list (slug micro-bitty)
--
-- Micro merchant cash advances placed with Bitty Advance. This migration builds:
--   1. Email-verification storage on lead_records (mirrors customers.email_status /
--      email_verified_at / email_checked_at / email_bounce_reason).
--   2. A GHL DND snapshot (+ a run ledger proving the snapshot was COMPLETE).
--   3. Bitty industry reference + SIC→Bitty mapping (range table + keyword table).
--   4. campaign_segment_members — the durable segment, keyed by campaign_slug.
--   5. build_micro_bitty_segment() — the idempotent (re)builder.
--
-- ┌─ FOR instantly-enroll (phase3-wiring) ─────────────────────────────────────┐
-- │ READ: public.campaign_segment_members WHERE campaign_slug='micro-bitty'    │
-- │       AND enrolled_at IS NULL, joined to public.lead_records ON id =       │
-- │       lead_record_id. Email health = lead_records.email_status             │
-- │       (verified|catch_all|risky|invalid|bounced|unknown — the EmailHealth  │
-- │       type in supabase/functions/_shared/instantly.ts) plus                │
-- │       lead_records.email_verified_at. NULL email_status = NEVER VERIFIED → │
-- │       refuse. email_verify_error NOT NULL = the lookup itself failed       │
-- │       (unreadable) → refuse, it is not a verdict. Check also that          │
-- │       lead_records.email = campaign_segment_members.email (a verdict is    │
-- │       about one address). Stamp enrolled_at / instantly_campaign_id on     │
-- │       the member row when you enroll.                                      │
-- │ Verdicts are WRITTEN only through public.lead_record_record_verification() │
-- └────────────────────────────────────────────────────────────────────────────┘
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Verification storage on lead_records ─────────────────────────────────
-- Same vocabulary and same "bounce outranks prediction" rule as
-- recordVerification() in supabase/functions/_shared/instantly.ts.
alter table public.lead_records
  add column if not exists email_status        text,
  add column if not exists email_verified_at   timestamptz,
  add column if not exists email_checked_at    timestamptz,
  add column if not exists email_bounce_reason text,
  add column if not exists email_verify_raw    text,   -- Instantly's raw verification_status
  add column if not exists email_verify_error  text;   -- set when the LOOKUP failed (unreadable ≠ invalid)

do $$ begin
  alter table public.lead_records add constraint lead_records_email_status_check
    check (email_status is null or email_status in ('verified','catch_all','risky','invalid','bounced','unknown'));
exception when duplicate_object then null; end $$;

create index if not exists lead_records_email_status_idx
  on public.lead_records (email_status) where email_status is not null;

-- The ONE writer for a verdict. Never overwrites a proven bounce; never stamps a
-- verdict onto a row whose email changed since the lookup; a lookup error is stored
-- as health 'unknown' WITH email_verify_error so a reader can tell "Instantly could
-- not decide" from "we never got an answer".
create or replace function public.lead_record_record_verification(
  p_lead_record_id uuid, p_email text, p_health text, p_raw text,
  p_catch_all boolean, p_error text
) returns text
language plpgsql security definer set search_path = public as $$
declare v_cur text; v_n int;
begin
  if p_health not in ('verified','catch_all','risky','invalid','unknown') then
    raise exception 'lead_record_record_verification: bad health %', p_health using errcode = '22023';
  end if;
  select email_status into v_cur from lead_records where id = p_lead_record_id;
  if not found then return 'missing'; end if;
  if v_cur = 'bounced' then return 'kept_bounce'; end if;   -- proof outranks prediction
  update lead_records set
    email_status        = p_health,
    email_verified_at   = case when p_error is null then now() else email_verified_at end,
    email_checked_at    = now(),
    email_verify_raw    = p_raw,
    email_verify_error  = p_error,
    email_bounce_reason = case when p_health = 'invalid'
                            then 'Instantly: the mailbox does not exist (' || coalesce(p_raw,'invalid') || ')'
                            else null end
  where id = p_lead_record_id and lower(email) = lower(p_email);
  get diagnostics v_n = row_count;
  return case when v_n = 1 then 'written' else 'email_changed' end;
end $$;
revoke all on function public.lead_record_record_verification(uuid,text,text,text,boolean,text) from public, anon, authenticated;

-- ── 2. GHL DND snapshot ─────────────────────────────────────────────────────
-- lead_records carries no DND signal of its own, and GHL contact DND is the
-- suppression WAVV/LeadConnector honour. Pulled via POST /contacts/search with
-- filters dnd=true and dndSettings.Email.status=active (≈4 calls, not 239k).
-- A run counts only if rows_loaded equals what GHL reported as `total` — an
-- incomplete pull is UNREADABLE, and the builder refuses to run on it.
create table if not exists public.ghl_dnd_snapshot_runs (
  id            uuid primary key default gen_random_uuid(),
  taken_at      timestamptz not null default now(),
  reported_dnd       int not null,   -- GHL `total` for dnd=true
  reported_email_dnd int not null,   -- GHL `total` for dndSettings.Email.status=active
  loaded_dnd         int not null,
  loaded_email_dnd   int not null,
  complete      boolean generated always as
                  (reported_dnd = loaded_dnd and reported_email_dnd = loaded_email_dnd) stored,
  note          text
);
create table if not exists public.ghl_dnd_snapshot (
  run_id         uuid not null references public.ghl_dnd_snapshot_runs(id) on delete cascade,
  ghl_contact_id text not null,
  email          text,
  phone10        text,
  dnd            boolean not null default false,
  email_dnd      boolean not null default false,
  primary key (run_id, ghl_contact_id)
);
alter table public.ghl_dnd_snapshot_runs enable row level security;
alter table public.ghl_dnd_snapshot      enable row level security;
-- No policies: service-role / definer access only.

-- ── 3. Bitty industry reference + SIC mapping ───────────────────────────────
-- SOURCE OF TRUTH for labels and tiers: src/components/admin/funder/bittyIndustries.ts
-- (BITTY_PREFERRED / BITTY_STANDARD / BITTY_PROHIBITED, Oct-2026 guide). The rows
-- below are a transcription of that file; if it changes, change this table too.
-- merge_phrase = the words that go into the email's {{industry}} merge variable.
create table if not exists public.bitty_industries (
  label        text primary key,
  tier         text not null check (tier in ('preferred','standard','prohibited')),
  merge_phrase text
);
alter table public.bitty_industries enable row level security;
drop policy if exists bitty_industries_read on public.bitty_industries;
create policy bitty_industries_read on public.bitty_industries for select to authenticated using (true);

insert into public.bitty_industries (label, tier, merge_phrase) values
 ('Advertising','preferred','advertising'),('Agriculture, Forestry, Fishing','preferred','agriculture'),
 ('Ambulance','preferred','ambulance'),('Architectural / Engineering','preferred','architecture and engineering'),
 ('Assisted Facility','preferred','assisted living'),('Auto Repair','preferred','auto repair'),
 ('Barber Shops','preferred','barber shop'),('Beauty Salons','preferred','salon'),('Car Rental','preferred','car rental'),
 ('Car Wash','preferred','car wash'),('Child Day Care','preferred','child care'),
 ('Computer Systems Design','preferred','IT services'),('Cosmetics / Hair Ext. / Supply','preferred','beauty supply'),
 ('CPA Office / Accountant','preferred','accounting'),('Dentist','preferred','dental'),
 ('Doctor / Physician / Specialist','preferred','medical practice'),('Drinking Alcohol','preferred','bar'),
 ('Driving School','preferred','driving school'),('Drycleaner / Laundry','preferred','dry cleaning'),
 ('Employment / Staffing','preferred','staffing'),('Fitness Center','preferred','fitness'),('Florist','preferred','florist'),
 ('Food Truck','preferred','food truck'),('Furniture / Home Retail','preferred','home furnishings'),
 ('Gas Station','preferred','gas station'),('Graphic Design','preferred','design'),
 ('Grocery / Food / Bev. Retail','preferred','grocery'),('Home Health Care','preferred','home health care'),
 ('Insurance','preferred','insurance agency'),('Interior Design','preferred','interior design'),
 ('Janitorial','preferred','janitorial'),('Lab / Imaging','preferred','lab'),('Landscaping','preferred','landscaping'),
 ('Lawyer','preferred','law practice'),('Manufacturing','preferred','manufacturing'),
 ('Mental Health','preferred','counseling practice'),('Mortgage Broker','preferred','mortgage'),
 ('Nail Salon','preferred','nail salon'),('Oil / Gas Support Activities','preferred','oilfield services'),
 ('Other Information','preferred','media'),('Other Legal Services','preferred','legal services'),
 ('Pest','preferred','pest control'),('Pet Care','preferred','pet care'),('Photography','preferred','photography'),
 ('Real Estate Lessor','preferred','property rental'),('Restaurant - Full-service','preferred','restaurant'),
 ('Restaurant - Limited-service','preferred','restaurant'),('Septic Tank','preferred','septic'),
 ('Spa / Tattoo / Wax','preferred','spa'),('Sports / Hobby / Music Retail','preferred','retail'),
 ('Sports / Recreation Instruction','preferred','instruction'),('Telecommunications','preferred','telecom'),
 ('Tobacco / Vape','preferred','smoke shop'),('Trade Show / Convention','preferred','events'),
 ('Travel Agency / Arrangement','preferred','travel'),('Tutoring','preferred','tutoring'),('Veterinary','preferred','veterinary'),
 ('Accommodation','standard','hospitality'),('Appliance Repair','standard','repair'),('Auto Body Shop','standard','auto body'),
 ('Auto Parts / Tires','standard','auto parts'),('Boat / Marine','standard','marine'),('Catering','standard','catering'),
 ('Chiropractor','standard','chiropractic'),('Clothing / Shoes / Acc. Retail','standard','retail'),
 ('Construction - Carpentry','standard','carpentry'),('Construction - Electrician','standard','electrical'),
 ('Construction - Flooring','standard','flooring'),('Construction - Gen. Remodeler','standard','contracting'),
 ('Construction - New Home Builder','standard','home building'),('Construction - Other Unclass.','standard','construction'),
 ('Construction - Painting','standard','painting'),('Construction - Plumbing / HVAC','standard','plumbing and HVAC'),
 ('Construction - Roofing','standard','roofing'),('Construction - Site Prep / Excav.','standard','excavation'),
 ('Consulting - Management','standard','consulting'),('Drywall','standard','drywall'),
 ('Electronics / Appliance Retail','standard','electronics retail'),('Fine Arts School','standard','arts instruction'),
 ('Funeral Home','standard','funeral services'),('General Merchandise Retail','standard','retail'),
 ('Health / Personal Care Retail','standard','health retail'),('Investment Advisor','standard','financial advisory'),
 ('Jewelry','standard','jewelry'),('Marketing','standard','marketing'),('Medical Transport (non-emerg.)','standard','medical transport'),
 ('Movie / Music','standard','media production'),('Moving','standard','moving'),('Notary','standard','notary'),
 ('Online Seller','standard','e-commerce'),('Other Arts / Entertain. / Rec.','standard','entertainment'),
 ('Other Education','standard','education'),('Other Finance','standard','financial services'),
 ('Other Misc. Retail','standard','retail'),('Other Personal Services','standard','service'),
 ('Other Prof / Sci / Tech Services','standard','professional services'),
 ('Other Services - Bldgs / Dwellings','standard','building services'),('Public Administration','standard',null),
 ('Real Estate Agent / Broker','standard','real estate'),('Real Estate / Other Activities','standard','real estate'),
 ('Rental Center / Consumer / Gen.','standard','equipment rental'),('Security Guard / Investigation','standard','security'),
 ('Security Systems','standard','security systems'),('Solar','standard','solar'),('Taxi / Limo / Shuttle','standard','transportation'),
 ('Towing / Roadside','standard','towing'),('Trucking','standard','trucking'),('T-shirt / Printing','standard','printing'),
 ('Wholesale','standard','wholesale'),
 ('Auto Dealer / New, Used','prohibited',null),('Bail Bonds','prohibited',null),('Cannabis','prohibited',null),
 ('Crypto','prohibited',null),('Debt Collections','prohibited',null),('Gambling','prohibited',null),('Guns','prohibited',null),
 ('Health Supplements','prohibited',null),('Money Service Businesses','prohibited',null),('Not-for-profit','prohibited',null),
 ('Pawn Shops','prohibited',null),('Psychic Services','prohibited',null),('Religious / Grantmaking / Civic','prohibited',null),
 ('Sexual Content','prohibited',null)
on conflict (label) do update set tier = excluded.tier, merge_phrase = excluded.merge_phrase;

-- SIC (4-digit, 1987 manual) ranges → Bitty label. The NARROWEST matching range wins,
-- so a specific code can sit inside a broad division default. A SIC4 with no row
-- here is UNMAPPED and stays out of the segment (we do not guess an industry —
-- Bitty's own form says a wrong industry is an auto-decline).
create table if not exists public.bitty_sic_map (
  sic4_lo int not null, sic4_hi int not null,
  label   text not null references public.bitty_industries(label),
  note    text,
  primary key (sic4_lo, sic4_hi)
);
alter table public.bitty_sic_map enable row level security;

truncate public.bitty_sic_map;
insert into public.bitty_sic_map (sic4_lo, sic4_hi, label, note) values
 -- Division A: agriculture
 (100,699,'Agriculture, Forestry, Fishing','crops/livestock'),(700,799,'Agriculture, Forestry, Fishing','ag services default'),
 (741,742,'Veterinary',null),(751,752,'Pet Care','boarding/grooming/training'),
 (781,783,'Landscaping','lawn/garden/tree'),(800,999,'Agriculture, Forestry, Fishing','forestry/fishing'),
 -- Division B: mining — only oil & gas field services
 (1381,1389,'Oil / Gas Support Activities',null),
 -- Division C: construction
 (1520,1521,'Construction - Gen. Remodeler','1521 = general contractors, single-family (remodel/home improvement dominate)'),
 (1522,1522,'Construction - Other Unclass.',null),(1531,1531,'Construction - New Home Builder','operative builders'),
 (1540,1549,'Construction - Other Unclass.','nonresidential building'),(1600,1699,'Construction - Other Unclass.','heavy/civil'),
 (1711,1711,'Construction - Plumbing / HVAC',null),(1721,1721,'Construction - Painting',null),
 (1731,1731,'Construction - Electrician',null),(1740,1799,'Construction - Other Unclass.','special trades default'),
 (1742,1742,'Drywall',null),(1743,1743,'Construction - Flooring','tile'),(1751,1751,'Construction - Carpentry',null),
 (1752,1752,'Construction - Flooring',null),(1761,1761,'Construction - Roofing',null),
 (1794,1795,'Construction - Site Prep / Excav.','excavation/demolition'),
 -- Division D: manufacturing
 (2000,3999,'Manufacturing',null),(2710,2749,'Other Information','publishing'),
 (2750,2759,'T-shirt / Printing','commercial printing'),(3482,3484,'Guns','small arms / ammunition'),
 -- Division E: transportation, communications, utilities
 (4110,4199,'Taxi / Limo / Shuttle','local/suburban transit, taxi, bus, limo'),
 (4212,4213,'Trucking',null),(4214,4214,'Moving','local trucking with storage (movers)'),(4215,4215,'Trucking','courier'),
 (4225,4226,'Real Estate Lessor','self-storage / warehousing'),
 (4400,4499,'Boat / Marine','water transportation'),(4720,4729,'Travel Agency / Arrangement',null),
 (4731,4731,'Trucking','freight arrangement'),(4810,4899,'Telecommunications',null),
 (4959,4959,'Other Services - Bldgs / Dwellings','sanitary services NEC (mold/remediation)'),
 -- Division F: wholesale
 (5000,5199,'Wholesale',null),
 -- Division G: retail
 (5200,5299,'Furniture / Home Retail','building materials/hardware/garden'),
 (5300,5399,'General Merchandise Retail',null),(5400,5499,'Grocery / Food / Bev. Retail',null),
 (5510,5521,'Auto Dealer / New, Used',null),(5531,5531,'Auto Parts / Tires',null),(5541,5541,'Gas Station',null),
 (5551,5551,'Boat / Marine','boat dealers'),(5561,5599,'Auto Dealer / New, Used','RV/motorcycle/misc vehicle dealers — conservative'),
 (5600,5699,'Clothing / Shoes / Acc. Retail',null),(5710,5719,'Furniture / Home Retail',null),
 (5722,5722,'Electronics / Appliance Retail',null),(5731,5734,'Electronics / Appliance Retail',null),
 (5735,5736,'Sports / Hobby / Music Retail','records/musical instruments'),
 (5812,5812,'Restaurant - Full-service','eating places (keyword table refines limited-service/catering)'),
 (5813,5813,'Drinking Alcohol',null),(5900,5999,'Other Misc. Retail','misc retail default'),
 (5912,5912,'Health / Personal Care Retail','pharmacies'),(5921,5921,'Grocery / Food / Bev. Retail','liquor stores'),
 (5941,5941,'Sports / Hobby / Music Retail',null),(5944,5944,'Jewelry',null),(5945,5945,'Sports / Hobby / Music Retail',null),
 (5946,5946,'Electronics / Appliance Retail','camera'),(5948,5948,'Clothing / Shoes / Acc. Retail','luggage'),
 (5961,5961,'Online Seller','catalog / mail-order / e-commerce'),(5992,5992,'Florist',null),
 (5993,5993,'Tobacco / Vape',null),(5995,5995,'Health / Personal Care Retail','optical goods'),
 -- Division H: finance, insurance, real estate
 (6000,6098,'Other Finance','banks/credit unions'),(6099,6099,'Money Service Businesses','check cashing/money transfer'),
 (6110,6159,'Other Finance','credit institutions'),(6162,6163,'Mortgage Broker',null),
 (6211,6289,'Investment Advisor','brokers/dealers/advisors'),(6310,6399,'Insurance','carriers'),(6411,6411,'Insurance',null),
 (6510,6519,'Real Estate Lessor',null),(6531,6531,'Real Estate Agent / Broker',null),
 (6541,6553,'Real Estate / Other Activities','title/developers/cemetery subdividers'),
 (6710,6799,'Other Finance','holding/investment offices'),(6732,6732,'Religious / Grantmaking / Civic','educational/religious/charitable trusts'),
 -- Division I: services
 (7010,7041,'Accommodation',null),(7211,7216,'Drycleaner / Laundry',null),(7217,7217,'Other Services - Bldgs / Dwellings','carpet cleaning'),
 (7218,7219,'Drycleaner / Laundry',null),(7221,7221,'Photography',null),(7231,7231,'Beauty Salons',null),
 (7241,7241,'Barber Shops',null),(7251,7251,'Other Personal Services','shoe repair'),(7261,7261,'Funeral Home',null),
 (7291,7291,'CPA Office / Accountant','tax return preparation'),(7299,7299,'Other Personal Services','misc personal (keyword table refines)'),
 (7311,7319,'Advertising',null),(7322,7322,'Debt Collections',null),(7323,7323,'Other Prof / Sci / Tech Services','credit reporting'),
 (7331,7331,'Advertising','direct mail'),(7334,7334,'T-shirt / Printing','photocopying'),(7335,7335,'Photography','commercial'),
 (7336,7336,'Graphic Design',null),(7338,7338,'Other Prof / Sci / Tech Services','secretarial/court reporting'),
 (7342,7342,'Pest',null),(7349,7349,'Janitorial',null),(7352,7359,'Rental Center / Consumer / Gen.','equipment rental'),
 (7361,7363,'Employment / Staffing',null),(7371,7379,'Computer Systems Design',null),
 (7381,7381,'Security Guard / Investigation',null),(7382,7382,'Security Systems',null),(7383,7383,'Other Information','news syndicates'),
 (7384,7384,'Photography','photofinishing'),(7389,7389,'Other Prof / Sci / Tech Services','business services NEC (generic)'),
 (7513,7515,'Car Rental','auto/truck rental & leasing'),(7519,7519,'Rental Center / Consumer / Gen.','trailer rental'),
 (7532,7532,'Auto Body Shop',null),(7533,7539,'Auto Repair',null),(7542,7542,'Car Wash',null),(7549,7549,'Auto Repair','automotive services NEC'),
 (7622,7629,'Appliance Repair',null),(7631,7631,'Jewelry','watch/jewelry repair'),(7641,7641,'Other Personal Services','upholstery'),
 (7690,7699,'Other Personal Services','misc repair'),
 (7810,7849,'Movie / Music','film/video production, theaters, rental'),(7911,7911,'Fine Arts School','dance studios'),
 (7922,7929,'Other Arts / Entertain. / Rec.','theatre/bands/entertainers'),(7930,7999,'Other Arts / Entertain. / Rec.',null),
 (7948,7948,'Gambling','racing incl. track operation — conservative'),(7991,7991,'Fitness Center',null),
 (8011,8011,'Doctor / Physician / Specialist',null),(8021,8021,'Dentist',null),(8031,8031,'Doctor / Physician / Specialist','osteopaths'),
 (8041,8041,'Chiropractor',null),(8042,8049,'Doctor / Physician / Specialist','optometrists/podiatrists/practitioners NEC'),
 (8050,8059,'Assisted Facility','nursing/personal care'),(8063,8063,'Mental Health','psychiatric hospitals'),
 (8071,8072,'Lab / Imaging','medical/dental labs'),(8082,8082,'Home Health Care',null),
 (8090,8099,'Doctor / Physician / Specialist','outpatient/health services NEC'),
 (8111,8111,'Lawyer',null),(8200,8299,'Other Education',null),(8299,8299,'Tutoring','schools & educational services NEC (tutoring dominant)'),
 (8322,8322,'Mental Health','individual & family services / counseling'),(8331,8331,'Other Education','job training'),
 (8351,8351,'Child Day Care',null),(8361,8361,'Assisted Facility','residential care'),(8399,8399,'Not-for-profit','social services NEC'),
 (8410,8422,'Other Arts / Entertain. / Rec.','museums/zoos'),(8611,8611,'Not-for-profit','business associations'),
 (8620,8661,'Religious / Grantmaking / Civic','professional/labor/civic/political/religious orgs'),(8699,8699,'Not-for-profit',null),
 (8711,8713,'Architectural / Engineering','engineering/architecture/surveying'),(8721,8721,'CPA Office / Accountant',null),
 (8731,8733,'Other Prof / Sci / Tech Services','research'),(8734,8734,'Lab / Imaging','testing labs'),
 (8741,8742,'Consulting - Management',null),(8743,8743,'Marketing','public relations'),
 (8744,8744,'Other Prof / Sci / Tech Services',null),(8748,8748,'Consulting - Management','business consulting NEC'),
 (8999,8999,'Other Prof / Sci / Tech Services','services NEC'),
 -- Division J: public administration (9999 = nonclassified → deliberately UNMAPPED)
 (9100,9799,'Public Administration',null);

-- Description keyword overrides — applied BEFORE the SIC ranges. Mostly the kill-list:
-- a "BAIL BONDS" description under a generic code is still bail bonds. Lowest priority
-- number wins. Patterns are Postgres ARE, matched case-insensitively with ~*.
create table if not exists public.bitty_sic_keyword_map (
  pattern  text primary key,
  label    text not null references public.bitty_industries(label),
  priority int  not null default 100
);
alter table public.bitty_sic_keyword_map enable row level security;

truncate public.bitty_sic_keyword_map;
insert into public.bitty_sic_keyword_map (pattern, label, priority) values
 -- prohibited (priority 10 — always wins)
 ('\mBAIL\M','Bail Bonds',10),('\mPAWN','Pawn Shops',10),
 ('CANNABIS|MARIJUANA|DISPENSAR|\mCBD\M|\mHEMP\M','Cannabis',10),
 ('\mGUNS?\M|FIREARM|AMMUNITION|SHOOTING RANGE|GUNSMITH','Guns',10),
 ('PSYCHIC|ASTROLOG|FORTUNE TELL|SPIRITUALIST','Psychic Services',10),
 ('CHECK CASH|MONEY TRANSFER|MONEY ORDER|CURRENCY EXCHANGE|PAYDAY','Money Service Businesses',10),
 ('COLLECTION AGENC|DEBT COLLECT|COLLECTION SERVICE|\mCOLLECTIONS\M','Debt Collections',10),
 ('NON-?PROFIT|CHARIT|\mNOT[- ]FOR[- ]PROFIT','Not-for-profit',10),
 ('CHURCH|RELIGIOUS|MINISTR|SYNAGOG|MOSQUE|TEMPLE','Religious / Grantmaking / Civic',10),
 ('CASINO|GAMBL|\mBINGO\M|LOTTER|SWEEPSTAKE','Gambling',10),
 ('VITAMIN|SUPPLEMENT','Health Supplements',10),
 ('CRYPTO|BITCOIN|BLOCKCHAIN','Crypto',10),
 ('SOCIAL SERVICE|WELFARE','Not-for-profit',10),
 ('ADULT ENTERTAIN|ADULT BOOK|ADULT VIDEO|ESCORT SERV|STRIP CLUB|\mEROTIC','Sexual Content',10),
 ('AUTOMOBILE DEALERS|\mCAR DEALERS|AUTO DEALERS|\mUSED CAR|MOTORCYCLE DEALERS|NEW & USED CAR','Auto Dealer / New, Used',10),
 -- specific refinements (priority 50)
 ('AUTO GLASS|AUTOMOBILE GLASS|WINDSHIELD','Auto Repair',50),('MUSIC INSTRUCTION|ART INSTRUCTION|\mDANC','Fine Arts School',50),
 ('\mNAIL','Nail Salon',50),('MASSAGE|TATTOO|DAY SPA|BEAUTY & DAY|MEDICAL SPA|HEALTH SPA|SPAS - HEALTH|WAXING|ELECTROLYSIS','Spa / Tattoo / Wax',50),
 ('AMBULANCE','Ambulance',50),('MEDICAL TRANSPORT|NON-?EMERGENCY','Medical Transport (non-emerg.)',50),
 ('TOWING|WRECKER SERV|ROADSIDE','Towing / Roadside',50),('\mSOLAR','Solar',50),
 ('FOOD TRUCK|MOBILE FOOD','Food Truck',50),('CATERER|CATERING','Catering',50),
 ('FAST FOOD|CARRY OUT|TAKE OUT|PIZZA|SANDWICH|\mDELIS?\M|DELICATESSEN|COFFEE|\mCAFE|DONUT|ICE CREAM|JUICE|SMOOTHIE|BAGEL','Restaurant - Limited-service',60),
 ('DRIVING SCHOOL|DRIVING INSTRUCTION|DRIVER TRAINING','Driving School',50),('TUTOR','Tutoring',50),
 ('\mMOVERS\M|\mMOVING\M','Moving',50),('FLORIST','Florist',50),('LIMOUSINE','Taxi / Limo / Shuttle',50),
 ('NOTAR','Notary',50),('INTERIOR DESIGN|INTERIOR DECORAT','Interior Design',50),
 ('TRADE SHOW|CONVENTION & MEETING|CONVENTION CENTER','Trade Show / Convention',50),('PROPERTY MANAGEMENT','Real Estate / Other Activities',50),
 ('SEPTIC','Septic Tank',50),('COSMETIC|HAIR EXTENSION|BEAUTY SUPPL','Cosmetics / Hair Ext. / Supply',60),
 ('\mPET\M|GROOMING|DOG TRAIN|KENNEL','Pet Care',60),('YOGA|MARTIAL ARTS|KARATE|PERSONAL TRAINER|SWIM.*INSTRUCT|GOLF INSTRUCT','Sports / Recreation Instruction',60),
 ('SCREEN PRINT|T-SHIRT|EMBROIDER','T-shirt / Printing',60),('\mVAPE|VAPOR|SMOKE SHOP','Tobacco / Vape',60),
 ('\mTRAVEL','Travel Agency / Arrangement',70),('PSYCHOLOG|PSYCHOTHERAP|MENTAL HEALTH|BEHAVIORAL HEALTH|MARRIAGE & FAMILY|COUNSELORS-LICENSED','Mental Health',70);

-- ⚠️ THE UCC FILE'S SIC COLUMN DOES NOT DESCRIBE THE COMPANY ON ITS ROW (measured
-- 2026-11-16 on the built segment): of UCC companies whose NAME says the trade, the SIC
-- agreed only 2–11% of the time (…TRUCKING → "DUCT SYSTEMS", "STAIR TREADS", "EATING
-- PLACES"; ROOF → "PARTY SUPPLIES"). raw->>'SIC_DESCRIPTION' matches the loaded column,
-- so the vendor file itself is misaligned, not our loader. Email/name/company ARE aligned.
-- Consequence: the {{industry}} merge is filled ONLY from the company name (bitty_name_token_map);
-- a SIC-derived label is kept for the record but never shown to a merchant.
drop table if exists public.bitty_name_keyword_map;  -- superseded same day by the token map
create table if not exists public.bitty_name_token_map (
  token    text primary key,              -- one word, or a two-word phrase ("HOME HEALTH")
  label    text not null references public.bitty_industries(label),
  priority int  not null default 100      -- lowest wins; prohibited = 10
);
alter table public.bitty_name_token_map enable row level security;
-- Tokens/bigrams + hash join, NOT a regex table: 100 regexes × 155K names blew the
-- 2-minute ceiling; an equality join on ~600K tokens takes seconds.
truncate public.bitty_name_token_map;
insert into public.bitty_name_token_map (token, label, priority) values
 ('ACADEMY','Other Education',65),
 ('ACCOUNTING','CPA Office / Accountant',40),
 ('ADVERTISING','Advertising',50),
 ('AESTHETICS','Spa / Tattoo / Wax',45),
 ('COLLECTION AGENCY','Debt Collections',10),
 ('AIR CONDITIONING','Construction - Plumbing / HVAC',40),
 ('ALARM','Security Systems',45),
 ('ALARMS','Security Systems',45),
 ('AMBULANCE','Ambulance',40),
 ('AMMO','Guns',10),
 ('AMMUNITION','Guns',10),
 ('ANIMAL HOSPITAL','Veterinary',40),
 ('APPAREL','Clothing / Shoes / Acc. Retail',50),
 ('ARBOR','Landscaping',40),
 ('ARBORIST','Landscaping',40),
 ('ARMORY','Guns',10),
 ('ASPHALT','Construction - Other Unclass.',60),
 ('ASSISTED LIVING','Assisted Facility',40),
 ('ATTORNEY','Lawyer',45),
 ('ATTORNEYS','Lawyer',45),
 ('AUTO BODY','Auto Body Shop',40),
 ('AUTO CARE','Auto Repair',50),
 ('AUTO DEALER','Auto Dealer / New, Used',10),
 ('AUTO GROUP','Auto Dealer / New, Used',10),
 ('AUTO MART','Auto Dealer / New, Used',10),
 ('AUTO REPAIR','Auto Repair',50),
 ('AUTO SALES','Auto Dealer / New, Used',10),
 ('AUTO SERVICE','Auto Repair',50),
 ('AUTOMOTIVE','Auto Repair',50),
 ('AUTOMOTIVE GROUP','Auto Dealer / New, Used',10),
 ('BAGEL','Restaurant - Limited-service',45),
 ('BAGELS','Restaurant - Limited-service',45),
 ('BAIL','Bail Bonds',10),
 ('BAIL BONDS','Bail Bonds',10),
 ('BAILBONDS','Bail Bonds',10),
 ('BAPTIST','Religious / Grantmaking / Civic',10),
 ('BAR','Drinking Alcohol',62),
 ('BARBECUE','Restaurant - Full-service',50),
 ('BARBER','Barber Shops',40),
 ('BARBERS','Barber Shops',40),
 ('BARBERSHOP','Barber Shops',40),
 ('BBQ','Restaurant - Full-service',50),
 ('BEAUTY','Beauty Salons',50),
 ('BED AND BREAKFAST','Accommodation',45),
 ('BEHAVIORAL','Mental Health',45),
 ('BISTRO','Restaurant - Full-service',50),
 ('BITCOIN','Crypto',10),
 ('BLOCKCHAIN','Crypto',10),
 ('BODY SHOP','Auto Body Shop',40),
 ('BOOKKEEPING','CPA Office / Accountant',40),
 ('BOUTIQUE','Clothing / Shoes / Acc. Retail',50),
 ('BROW','Spa / Tattoo / Wax',45),
 ('BROWS','Spa / Tattoo / Wax',45),
 ('BUILDERS','Construction - Other Unclass.',60),
 ('BURGER','Restaurant - Limited-service',45),
 ('BURGERS','Restaurant - Limited-service',45),
 ('CABINET','Construction - Carpentry',45),
 ('CABINETRY','Construction - Carpentry',45),
 ('CABINETS','Construction - Carpentry',45),
 ('CAFE','Restaurant - Limited-service',45),
 ('CANINE','Pet Care',50),
 ('CANNABIS','Cannabis',10),
 ('CANTINA','Restaurant - Full-service',50),
 ('CAR LOT','Auto Dealer / New, Used',10),
 ('CAR SALES','Auto Dealer / New, Used',10),
 ('CAR WASH','Car Wash',40),
 ('CAREGIVERS','Home Health Care',40),
 ('CAREGIVING','Home Health Care',40),
 ('CARPENTRY','Construction - Carpentry',45),
 ('CARRIER','Trucking',50),
 ('CARRIERS','Trucking',50),
 ('CASINO','Gambling',10),
 ('CATERER','Catering',40),
 ('CATERERS','Catering',40),
 ('CATERING','Catering',40),
 ('CBD','Cannabis',10),
 ('CELLULAR','Telecommunications',45),
 ('CHARITABLE','Not-for-profit',10),
 ('CHARITIES','Not-for-profit',10),
 ('CHARITY','Not-for-profit',10),
 ('CHAUFFEUR','Taxi / Limo / Shuttle',45),
 ('CHECK CASHING','Money Service Businesses',10),
 ('CHILD CARE','Child Day Care',40),
 ('CHILDCARE','Child Day Care',40),
 ('CHIROPRACTIC','Chiropractor',40),
 ('CHURCH','Religious / Grantmaking / Civic',10),
 ('CHURCHES','Religious / Grantmaking / Civic',10),
 ('CIGAR','Tobacco / Vape',40),
 ('CIGARS','Tobacco / Vape',40),
 ('CLEANING','Janitorial',45),
 ('CLINIC','Doctor / Physician / Specialist',55),
 ('CLOTHING','Clothing / Shoes / Acc. Retail',50),
 ('COFFEE','Restaurant - Limited-service',45),
 ('COLLECTION AGENCIES','Debt Collections',10),
 ('COLLISION','Auto Body Shop',40),
 ('COMPUTER','Computer Systems Design',50),
 ('COMPUTERS','Computer Systems Design',50),
 ('CONCRETE','Construction - Other Unclass.',60),
 ('CONSTRUCTION','Construction - Other Unclass.',60),
 ('CONSULTANTS','Consulting - Management',60),
 ('CONSULTING','Consulting - Management',60),
 ('CONTRACTING','Construction - Other Unclass.',60),
 ('CONTRACTOR','Construction - Other Unclass.',60),
 ('CONTRACTORS','Construction - Other Unclass.',60),
 ('COUNSELING','Mental Health',45),
 ('CPA','CPA Office / Accountant',40),
 ('CPAS','CPA Office / Accountant',40),
 ('CREMATION','Funeral Home',40),
 ('CROSSFIT','Fitness Center',45),
 ('CRYPTO','Crypto',10),
 ('CUSTODIAL','Janitorial',45),
 ('CUSTOM HOMES','Construction - New Home Builder',45),
 ('DAIRY','Agriculture, Forestry, Fishing',50),
 ('DANCE','Fine Arts School',50),
 ('DAY CARE','Child Day Care',40),
 ('DAYCARE','Child Day Care',40),
 ('DEBT COLLECTION','Debt Collections',10),
 ('DEBT COLLECTORS','Debt Collections',10),
 ('DELI','Restaurant - Limited-service',45),
 ('DEMOLITION','Construction - Site Prep / Excav.',40),
 ('DENTAL','Dentist',40),
 ('DENTISTRY','Dentist',40),
 ('DERMATOLOGY','Doctor / Physician / Specialist',55),
 ('DETAILING','Car Wash',40),
 ('DINER','Restaurant - Full-service',50),
 ('DIOCESE','Religious / Grantmaking / Civic',10),
 ('DIRT WORK','Construction - Site Prep / Excav.',40),
 ('DISPENSARY','Cannabis',10),
 ('DISTRIBUTING','Wholesale',55),
 ('DISTRIBUTION','Wholesale',55),
 ('DISTRIBUTORS','Wholesale',55),
 ('DOG','Pet Care',50),
 ('DOGS','Pet Care',50),
 ('DONUT','Restaurant - Limited-service',45),
 ('DONUTS','Restaurant - Limited-service',45),
 ('DRIVING SCHOOL','Driving School',35),
 ('DRYWALL','Drywall',40),
 ('EARLY LEARNING','Child Day Care',40),
 ('EATERY','Restaurant - Full-service',50),
 ('ELECTRIC','Construction - Electrician',45),
 ('ELECTRICAL','Construction - Electrician',45),
 ('ELECTRICIAN','Construction - Electrician',45),
 ('ELECTRICIANS','Construction - Electrician',45),
 ('EMBROIDERY','T-shirt / Printing',45),
 ('EMPLOYMENT','Employment / Staffing',40),
 ('ESTHETICS','Spa / Tattoo / Wax',45),
 ('EXCAVATING','Construction - Site Prep / Excav.',40),
 ('EXCAVATION','Construction - Site Prep / Excav.',40),
 ('EXTERMINATING','Pest',40),
 ('EXTERMINATOR','Pest',40),
 ('EXTERMINATORS','Pest',40),
 ('FABRICATION','Manufacturing',50),
 ('FABRICATORS','Manufacturing',50),
 ('FARM','Agriculture, Forestry, Fishing',50),
 ('FARMS','Agriculture, Forestry, Fishing',50),
 ('FASHION','Clothing / Shoes / Acc. Retail',50),
 ('FASHIONS','Clothing / Shoes / Acc. Retail',50),
 ('FELLOWSHIP','Religious / Grantmaking / Civic',10),
 ('FENCE','Construction - Other Unclass.',60),
 ('FENCING','Construction - Other Unclass.',60),
 ('FIREARM','Guns',10),
 ('FIREARMS','Guns',10),
 ('FITNESS','Fitness Center',45),
 ('FLOORING','Construction - Flooring',45),
 ('FLOORS','Construction - Flooring',45),
 ('FLORAL','Florist',40),
 ('FLORIST','Florist',40),
 ('FLOWERS','Florist',40),
 ('FOOD TRUCK','Food Truck',35),
 ('FOOD MART','Grocery / Food / Bev. Retail',45),
 ('FOUNDATION','Not-for-profit',10),
 ('FOUNDATION REPAIR','Construction - Other Unclass.',5),
 ('FREIGHT','Trucking',50),
 ('FUEL STOP','Gas Station',45),
 ('FUNERAL','Funeral Home',40),
 ('FURNITURE','Furniture / Home Retail',45),
 ('GAMING','Gambling',10),
 ('GARAGE','Auto Repair',50),
 ('GARAGE DOOR','Construction - Other Unclass.',40),
 ('GARAGE DOORS','Construction - Other Unclass.',40),
 ('GAS STATION','Gas Station',45),
 ('GRADING','Construction - Site Prep / Excav.',40),
 ('GRAPHIC','Graphic Design',50),
 ('GRAPHICS','Graphic Design',50),
 ('GRILL','Restaurant - Full-service',50),
 ('GROCERIES','Grocery / Food / Bev. Retail',45),
 ('GROCERY','Grocery / Food / Bev. Retail',45),
 ('GROOMING','Pet Care',50),
 ('GROUP HOME','Assisted Facility',40),
 ('GUN','Guns',10),
 ('GUNS','Guns',10),
 ('GUNSMITH','Guns',10),
 ('GYM','Fitness Center',45),
 ('HAIR','Beauty Salons',50),
 ('HANDYMAN','Construction - Gen. Remodeler',45),
 ('HAULING','Trucking',50),
 ('HEATING','Construction - Plumbing / HVAC',40),
 ('HEMP','Cannabis',10),
 ('HOME BUILDERS','Construction - New Home Builder',45),
 ('HOME BUILDER','Construction - New Home Builder',45),
 ('HOME CARE','Home Health Care',40),
 ('HOME HEALTH','Home Health Care',40),
 ('HOME IMPROVEMENT','Construction - Gen. Remodeler',45),
 ('HOME IMPROVEMENTS','Construction - Gen. Remodeler',45),
 ('HOMECARE','Home Health Care',40),
 ('HOOKAH','Tobacco / Vape',40),
 ('HOSPICE','Home Health Care',40),
 ('HOTEL','Accommodation',45),
 ('HOTELS','Accommodation',45),
 ('HVAC','Construction - Plumbing / HVAC',40),
 ('ICE CREAM','Restaurant - Limited-service',45),
 ('IN HOME','Home Health Care',40),
 ('INN','Accommodation',45),
 ('INSULATION','Drywall',40),
 ('INSURANCE','Insurance',40),
 ('INVESTIGATIONS','Security Guard / Investigation',55),
 ('IT SERVICES','Computer Systems Design',50),
 ('JANITORIAL','Janitorial',45),
 ('JEWELER','Jewelry',45),
 ('JEWELERS','Jewelry',45),
 ('JEWELRY','Jewelry',45),
 ('JEWELS','Jewelry',45),
 ('JIU JITSU','Sports / Recreation Instruction',45),
 ('JIUJITSU','Sports / Recreation Instruction',45),
 ('JUICE','Restaurant - Limited-service',45),
 ('K9','Pet Care',50),
 ('KARATE','Sports / Recreation Instruction',45),
 ('KITCHEN','Restaurant - Full-service',50),
 ('LANDSCAPE','Landscaping',40),
 ('LANDSCAPERS','Landscaping',40),
 ('LANDSCAPES','Landscaping',40),
 ('LANDSCAPING','Landscaping',40),
 ('LASH','Spa / Tattoo / Wax',45),
 ('LASHES','Spa / Tattoo / Wax',45),
 ('LAW','Lawyer',45),
 ('LAW FIRM','Lawyer',45),
 ('LAW OFFICE','Lawyer',45),
 ('LAW OFFICES','Lawyer',45),
 ('LAWN','Landscaping',40),
 ('LAWNS','Landscaping',40),
 ('LEGAL','Other Legal Services',55),
 ('LIMO','Taxi / Limo / Shuttle',45),
 ('LIMOUSINE','Taxi / Limo / Shuttle',45),
 ('LIQUOR','Grocery / Food / Bev. Retail',45),
 ('LIQUORS','Grocery / Food / Bev. Retail',45),
 ('LOGISTICS','Trucking',50),
 ('LOTTERY','Gambling',10),
 ('LOUNGE','Drinking Alcohol',62),
 ('MACHINE SHOP','Manufacturing',50),
 ('MACHINING','Manufacturing',50),
 ('MAID','Janitorial',45),
 ('MAIDS','Janitorial',45),
 ('MANUFACTURER','Manufacturing',50),
 ('MANUFACTURERS','Manufacturing',50),
 ('MANUFACTURING','Manufacturing',50),
 ('MARIJUANA','Cannabis',10),
 ('MARKETING','Marketing',50),
 ('MARTIAL ARTS','Sports / Recreation Instruction',45),
 ('MASONRY','Construction - Other Unclass.',60),
 ('MASSAGE','Spa / Tattoo / Wax',45),
 ('MATTRESS','Furniture / Home Retail',45),
 ('MEAT','Grocery / Food / Bev. Retail',45),
 ('MEATS','Grocery / Food / Bev. Retail',45),
 ('MECHANIC','Auto Repair',50),
 ('MECHANICS','Auto Repair',50),
 ('MEDICAL','Doctor / Physician / Specialist',55),
 ('MEDICAL TRANSPORT','Medical Transport (non-emerg.)',40),
 ('MEDICAL TRANSPORTATION','Medical Transport (non-emerg.)',40),
 ('MEDSPA','Spa / Tattoo / Wax',45),
 ('MENTAL HEALTH','Mental Health',45),
 ('MILLWORK','Construction - Carpentry',45),
 ('MINISTRIES','Religious / Grantmaking / Civic',10),
 ('MINISTRY','Religious / Grantmaking / Civic',10),
 ('MONEY SERVICES','Money Service Businesses',10),
 ('MONEY TRANSFER','Money Service Businesses',10),
 ('MONTESSORI','Child Day Care',40),
 ('MORTGAGE','Mortgage Broker',40),
 ('MORTUARY','Funeral Home',40),
 ('MOSQUE','Religious / Grantmaking / Civic',10),
 ('MOTEL','Accommodation',45),
 ('MOTORS','Auto Dealer / New, Used',10),
 ('MOVERS','Moving',40),
 ('MOVING','Moving',40),
 ('NAIL','Nail Salon',40),
 ('NAILS','Nail Salon',40),
 ('NEMT','Medical Transport (non-emerg.)',40),
 ('NON-PROFIT','Not-for-profit',10),
 ('NONPROFIT','Not-for-profit',10),
 ('NURSING','Assisted Facility',40),
 ('NUTRITION','Health Supplements',10),
 ('ORCHARD','Agriculture, Forestry, Fishing',50),
 ('ORCHARDS','Agriculture, Forestry, Fishing',50),
 ('ORTHODONTICS','Dentist',40),
 ('PAINTERS','Construction - Painting',40),
 ('PAINTING','Construction - Painting',40),
 ('PARISH','Religious / Grantmaking / Civic',10),
 ('PAVING','Construction - Other Unclass.',60),
 ('PAWN','Pawn Shops',10),
 ('PAWNBROKER','Pawn Shops',10),
 ('PAWNBROKERS','Pawn Shops',10),
 ('PAWNSHOP','Pawn Shops',10),
 ('PAYDAY','Money Service Businesses',10),
 ('PEDIATRICS','Doctor / Physician / Specialist',55),
 ('PEST','Pest',40),
 ('PET','Pet Care',50),
 ('PETS','Pet Care',50),
 ('PHARMACY','Health / Personal Care Retail',45),
 ('PHOTO','Photography',45),
 ('PHOTOGRAPHER','Photography',45),
 ('PHOTOGRAPHY','Photography',45),
 ('PHYSICAL THERAPY','Doctor / Physician / Specialist',55),
 ('PHYSICIAN','Doctor / Physician / Specialist',55),
 ('PHYSICIANS','Doctor / Physician / Specialist',55),
 ('PILATES','Fitness Center',45),
 ('PIZZA','Restaurant - Limited-service',45),
 ('PIZZERIA','Restaurant - Limited-service',45),
 ('PLASTER','Drywall',40),
 ('PLASTERING','Drywall',40),
 ('PLUMBER','Construction - Plumbing / HVAC',40),
 ('PLUMBERS','Construction - Plumbing / HVAC',40),
 ('PLUMBING','Construction - Plumbing / HVAC',40),
 ('POOL','Other Services - Bldgs / Dwellings',55),
 ('POOLS','Other Services - Bldgs / Dwellings',55),
 ('PRESCHOOL','Child Day Care',40),
 ('PRINTING','T-shirt / Printing',45),
 ('PROPERTIES','Real Estate Lessor',55),
 ('PROPERTY MANAGEMENT','Real Estate Lessor',55),
 ('PSYCHIATRIC','Mental Health',45),
 ('PSYCHIATRY','Mental Health',45),
 ('PSYCHIC','Psychic Services',10),
 ('PSYCHICS','Psychic Services',10),
 ('PSYCHOLOGICAL','Mental Health',45),
 ('PSYCHOLOGY','Mental Health',45),
 ('PSYCHOTHERAPY','Mental Health',45),
 ('PUB','Drinking Alcohol',62),
 ('RANCH','Agriculture, Forestry, Fishing',50),
 ('RANCHES','Agriculture, Forestry, Fishing',50),
 ('REAL ESTATE','Real Estate Agent / Broker',45),
 ('REALTOR','Real Estate Agent / Broker',45),
 ('REALTORS','Real Estate Agent / Broker',45),
 ('REALTY','Real Estate Agent / Broker',45),
 ('RECRUITING','Employment / Staffing',40),
 ('REMODEL','Construction - Gen. Remodeler',45),
 ('REMODELING','Construction - Gen. Remodeler',45),
 ('RENOVATION','Construction - Gen. Remodeler',45),
 ('RENOVATIONS','Construction - Gen. Remodeler',45),
 ('RESTAURANT','Restaurant - Full-service',50),
 ('RESTAURANTS','Restaurant - Full-service',50),
 ('ROOFER','Construction - Roofing',40),
 ('ROOFERS','Construction - Roofing',40),
 ('ROOFING','Construction - Roofing',40),
 ('SALON','Beauty Salons',50),
 ('SALOON','Drinking Alcohol',62),
 ('SCHOOL','Other Education',65),
 ('SCREEN PRINTING','T-shirt / Printing',45),
 ('SECURITY','Security Guard / Investigation',55),
 ('SENIOR LIVING','Assisted Facility',40),
 ('SEPTIC','Septic Tank',40),
 ('SHOES','Clothing / Shoes / Acc. Retail',50),
 ('SHUTTLE','Taxi / Limo / Shuttle',45),
 ('SITE WORK','Construction - Site Prep / Excav.',40),
 ('SITEWORK','Construction - Site Prep / Excav.',40),
 ('SMOKE','Tobacco / Vape',40),
 ('SMOOTHIE','Restaurant - Limited-service',45),
 ('SMOOTHIES','Restaurant - Limited-service',45),
 ('SOFTWARE','Computer Systems Design',50),
 ('SOLAR','Solar',40),
 ('SPA','Spa / Tattoo / Wax',45),
 ('STAFFING','Employment / Staffing',40),
 ('GAS STATIONS','Gas Station',45),
 ('STEAKHOUSE','Restaurant - Full-service',50),
 ('SUITES','Accommodation',45),
 ('SUPERMARKET','Grocery / Food / Bev. Retail',45),
 ('SUPPLEMENT','Health Supplements',10),
 ('SUPPLEMENTS','Health Supplements',10),
 ('SUSHI','Restaurant - Full-service',50),
 ('SWEEPSTAKES','Gambling',10),
 ('SYNAGOGUE','Religious / Grantmaking / Civic',10),
 ('T SHIRT','T-shirt / Printing',45),
 ('T SHIRTS','T-shirt / Printing',45),
 ('TACO','Restaurant - Limited-service',45),
 ('TACOS','Restaurant - Limited-service',45),
 ('TAEKWONDO','Sports / Recreation Instruction',45),
 ('TAQUERIA','Restaurant - Full-service',50),
 ('TATTOO','Spa / Tattoo / Wax',45),
 ('TATTOOS','Spa / Tattoo / Wax',45),
 ('TAVERN','Drinking Alcohol',62),
 ('TAX PREPARATION','CPA Office / Accountant',40),
 ('TAX SERVICE','CPA Office / Accountant',40),
 ('TAX SERVICES','CPA Office / Accountant',40),
 ('TAXI','Taxi / Limo / Shuttle',45),
 ('TECHNOLOGIES','Computer Systems Design',50),
 ('TELECOM','Telecommunications',45),
 ('TELECOMMUNICATIONS','Telecommunications',45),
 ('TEMPLE','Religious / Grantmaking / Civic',10),
 ('TERMITE','Pest',40),
 ('THC','Cannabis',10),
 ('TILE','Construction - Flooring',45),
 ('TIRE','Auto Parts / Tires',45),
 ('TIRES','Auto Parts / Tires',45),
 ('TOBACCO','Tobacco / Vape',40),
 ('TOURS','Travel Agency / Arrangement',55),
 ('TOWING','Towing / Roadside',40),
 ('TRANSMISSION','Auto Repair',50),
 ('TRANSMISSIONS','Auto Repair',50),
 ('TRAVEL','Travel Agency / Arrangement',55),
 ('TRAVEL CENTER','Gas Station',45),
 ('TREE CARE','Landscaping',40),
 ('TREE SERVICE','Landscaping',40),
 ('TREE SERVICES','Landscaping',40),
 ('FOOD TRUCKS','Food Truck',35),
 ('TRUCK LINE','Trucking',50),
 ('TRUCK LINES','Trucking',50),
 ('TRUCKING','Trucking',50),
 ('TSHIRT','T-shirt / Printing',45),
 ('TUTORING','Tutoring',40),
 ('TUTORS','Tutoring',40),
 ('URGENT CARE','Doctor / Physician / Specialist',55),
 ('USED CARS','Auto Dealer / New, Used',10),
 ('VAPE','Tobacco / Vape',40),
 ('VET CLINIC','Veterinary',40),
 ('VETERINARY','Veterinary',40),
 ('VITAMIN','Health Supplements',10),
 ('VITAMINS','Health Supplements',10),
 ('WAX','Spa / Tattoo / Wax',45),
 ('WAXING','Spa / Tattoo / Wax',45),
 ('WEB DESIGN','Computer Systems Design',50),
 ('WELDING','Manufacturing',50),
 ('WHOLESALE','Wholesale',55),
 ('WHOLESALERS','Wholesale',55),
 ('WINGS','Restaurant - Limited-service',45),
 ('WIRELESS','Telecommunications',45),
 ('WOODWORK','Construction - Carpentry',45),
 ('WOODWORKING','Construction - Carpentry',45),
 ('WRECKER','Towing / Roadside',40),
 ('YOGA','Sports / Recreation Instruction',45);

-- Resolve a vendor SIC code string to a 4-digit SIC. The vendor files mangle codes:
-- 8-digit (normal), 7/5/3-digit (a dropped leading zero: 7820409 = 0782-0409),
-- 6/4-digit (short forms), 12+-digit (zero-padded 3-digit groups that disagree with
-- their own descriptions → treated as unreadable), and words in the code column.
create or replace function public.bitty_sic4(p_code text) returns int
language sql immutable as $$
  select case
    when p_code is null or p_code ~ '[A-Za-z]' then null
    else (select case
            when length(d) < 3 or length(d) >= 12 then null
            else left(case when length(d) % 2 = 1 then '0' || d else d end, 4)::int
          end
          from (select regexp_replace(p_code, '\D', '', 'g') d) x)
  end
$$;

-- ── 4. The durable segment ──────────────────────────────────────────────────
create table if not exists public.campaign_segment_members (
  id              uuid primary key default gen_random_uuid(),
  campaign_slug   text not null,
  lead_record_id  uuid not null references public.lead_records(id) on delete cascade,
  source          text not null check (source in ('ucc','trigger','aged')),
  email           text not null,           -- lowercased; the address the verdict must be about
  first_name      text,
  company         text,
  state           text,
  timezone        text,
  ghl_contact_id  text,
  bitty_industry  text references public.bitty_industries(label),
  bitty_tier      text,
  industry_merge  text,                    -- {{industry}} merge value — set ONLY from the company name; NULL = use generic copy
  industry_basis  text,                    -- company_name | sic_keyword | sic_code | sic_description | null
  monthly_revenue_floor numeric,           -- trigger: the monthly figure we qualified on
  wavv_soft_no    boolean not null default false,  -- WAVV 'Not Interested' on this phone (soft-no, NOT DNC)
  built_at        timestamptz not null default now(),
  dnd_run_id      uuid references public.ghl_dnd_snapshot_runs(id),
  enrolled_at     timestamptz,             -- stamped by instantly-enroll
  instantly_campaign_id text,
  unique (campaign_slug, lead_record_id),
  unique (campaign_slug, email)
);
create index if not exists campaign_segment_members_pending_idx
  on public.campaign_segment_members (campaign_slug) where enrolled_at is null;
alter table public.campaign_segment_members enable row level security;
drop policy if exists campaign_segment_members_admin_read on public.campaign_segment_members;
create policy campaign_segment_members_admin_read on public.campaign_segment_members
  for select to authenticated
  using ((select exists (select 1 from public.profiles p
                         where p.id = auth.uid() and p.role in ('admin','super_admin'))));

-- ── 5. Builder ──────────────────────────────────────────────────────────────
-- Idempotent: drops NOT-YET-ENROLLED members of the slug and re-inserts the
-- currently-eligible set; enrolled members are never touched and never re-added.
-- REFUSES to run without a COMPLETE GHL DND snapshot newer than p_max_dnd_age:
-- a DND source we cannot read is not a clear DND source.
create or replace function public.build_micro_bitty_segment(p_max_dnd_age interval default interval '48 hours')
returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '600s' as $$
declare
  v_run uuid; v_n int; v_slug constant text := 'micro-bitty';
begin
  select id into v_run from ghl_dnd_snapshot_runs
   where complete and taken_at > now() - p_max_dnd_age
   order by taken_at desc limit 1;
  if v_run is null then
    raise exception 'build_micro_bitty_segment: no COMPLETE GHL DND snapshot newer than % — DND is unreadable, refusing to build', p_max_dnd_age
      using errcode = 'P0001';
  end if;

  delete from campaign_segment_members where campaign_slug = v_slug and enrolled_at is null;

  -- Staged through ANALYZEd temp tables, not one CTE: as a single statement the planner
  -- mis-estimated the 80K-row joins (rows=103) and the build blew the 2-minute ceiling.
  create temp table _mb_base on commit drop as
    select lr.id, lr.lead_type, lr.first_name, lr.company, lr.state, lr.state_inferred, lr.timezone_inferred,
           lr.ghl_contact_id, lr.sic_code, upper(coalesce(lr.sic_description,'')) d, lr.revenue, lr.revenue_text,
           lr.revenue_band_basis, lr.revenue_band_low, lr.revenue_band_high, lr.created_at,  -- never lr.*: raw jsonb makes the heap 145MB
           lower(trim(lr.email)) em, right(regexp_replace(coalesce(lr.phone,''),'\D','','g'),10) p10
      from lead_records lr
     where lr.lead_type in ('ucc','trigger')
       and lr.email is not null and lr.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       and coalesce(lr.is_dup_of_prior, false) = false
       and coalesce(lr.email_status, '') not in ('invalid','bounced');
  analyze _mb_base;

  -- description → sic4, learned from rows whose code column IS readable, then → label.
  create temp table _mb_desc on commit drop as
    select x.d, (select m.label from bitty_sic_map m where x.s4 between m.sic4_lo and m.sic4_hi
                  order by m.sic4_hi - m.sic4_lo limit 1) label
      from (select d, mode() within group (order by s4) s4
              from (select d, bitty_sic4(sic_code) s4 from _mb_base where lead_type = 'ucc' and d <> '') y
             where s4 is not null group by d) x;
  analyze _mb_desc;
  -- Industry is resolved once per DISTINCT (description, code) pair (~7.7K), never per row.
  create temp table _mb_pair on commit drop as
    select p.d, p.sic_code, kw.label kw_label, cl.label code_label, dl.label desc_label
      from (select distinct d, sic_code from _mb_base where lead_type = 'ucc') p
      left join lateral (select k.label from bitty_sic_keyword_map k where p.d ~* k.pattern
                          order by k.priority, k.pattern limit 1) kw on true
      left join lateral (select m.label from bitty_sic_map m where bitty_sic4(p.sic_code) between m.sic4_lo and m.sic4_hi
                          order by m.sic4_hi - m.sic4_lo limit 1) cl on true
      left join _mb_desc dl on dl.d = p.d;
  analyze _mb_pair;

  -- Company-name industry (the only basis trusted for the merge variable — see the
  -- SIC warning above): split the name into words + adjacent-word bigrams, hash-join.
  create temp table _mb_name on commit drop as
    with w as (
      select b.id, t.w, t.i
        from _mb_base b,
             unnest(regexp_split_to_array(trim(regexp_replace(upper(coalesce(b.company,'')), '[^A-Z0-9]+', ' ', 'g')), ' '))
               with ordinality t(w, i)),
    tok as (select id, w tok from w
            union all
            select w1.id, w1.w || ' ' || w2.w from w w1 join w w2 on w2.id = w1.id and w2.i = w1.i + 1)
    select distinct on (tok.id) tok.id, m.label
      from tok join bitty_name_token_map m on m.token = tok.tok
     order by tok.id, m.priority, m.token;
  analyze _mb_name;

  -- Every DND / do-not-email signal this codebase holds, flattened to three keys.
  create temp table _mb_sup_cust on commit drop as
    select c.email, c.additional_emails, c.phone, c.ghl_contact_id, c.ghl_contact_ids from customers c
     where c.do_not_contact
        or c.email_status in ('invalid','bounced')
        or exists (select 1 from deals d where d.customer_id = c.id     -- an OPEN deal: leave it to its closer
                    and d.status not in ('dead','declined','funded','renewal_eligible','restructure_executed','servicing'));
  create temp table _mb_sup_em on commit drop as
    select lower(trim(email)) em from ghl_dnd_snapshot where run_id = v_run and (dnd or email_dnd) and email is not null
    union select lower(trim(email)) from _mb_sup_cust where email is not null
    union select lower(trim(x)) from _mb_sup_cust, unnest(coalesce(additional_emails,'{}')) x;
  create temp table _mb_sup_p10 on commit drop as
    select phone10 p10 from ghl_dnd_snapshot where run_id = v_run and (dnd or email_dnd) and coalesce(phone10,'') <> ''
    union select right(regexp_replace(phone,'\D','','g'),10) from _mb_sup_cust where coalesce(phone,'') <> ''
    union select right(regexp_replace(phone,'\D','','g'),10) from sms_opt_outs
    union select right(regexp_replace(phone,'\D','','g'),10) from wavv_calls where disposition = 'Do Not Contact';
  create temp table _mb_sup_cid on commit drop as
    select ghl_contact_id cid from ghl_dnd_snapshot where run_id = v_run and (dnd or email_dnd)
    union select ghl_contact_id from _mb_sup_cust where ghl_contact_id is not null
    union select x from _mb_sup_cust, unnest(coalesce(ghl_contact_ids,'{}')) x
    union select contact_id from wavv_calls where disposition = 'Do Not Contact' and contact_id is not null;
  create temp table _mb_soft_no on commit drop as
    select distinct right(regexp_replace(phone,'\D','','g'),10) p10 from wavv_calls where disposition = 'Not Interested';
  analyze _mb_sup_em; analyze _mb_sup_p10; analyze _mb_sup_cid; analyze _mb_soft_no;

  create temp table _mb_eligible on commit drop as
    select b.*,
           coalesce(nm.label, pl.kw_label, pl.code_label, pl.desc_label) label,
           coalesce(pl.kw_label, pl.code_label, pl.desc_label) sic_label,
           nm.label name_label,
           case when nm.label is not null then 'company_name'
                when b.lead_type <> 'ucc' then null
                when pl.kw_label is not null then 'sic_keyword'
                when pl.code_label is not null then 'sic_code'
                when pl.desc_label is not null then 'sic_description' end basis,
           case when b.lead_type <> 'trigger' then null
                -- the trigger file's column header is literally "Monthly Revenue"
                when b.revenue_band_basis is null and b.revenue is not null and b.revenue < 10000000 then b.revenue
                -- "50k"/"$20K": the parser stored band_low=50 — a parse artifact; read the text
                when b.revenue_text ~* '^\s*\$?\s*[0-9][0-9,]*(\.[0-9]+)?\s*k\s*$'
                  then replace(substring(b.revenue_text from '([0-9][0-9,]*(\.[0-9]+)?)'), ',', '')::numeric * 1000
                -- D&B-style ANNUAL band text pasted into the monthly column → monthly floor = low/12
                when b.revenue_band_basis = 'annual' and b.revenue_band_low is not null
                  and b.revenue_text ~* 'million|less than|over|to|-' then b.revenue_band_low / 12.0
                else null end monthly   -- null = unreadable → excluded
      from _mb_base b
      left join _mb_pair pl on b.lead_type = 'ucc' and pl.d = b.d and pl.sic_code is not distinct from b.sic_code
      left join _mb_name nm on nm.id = b.id
     where not exists (select 1 from _mb_sup_em  s where s.em  = b.em)
       and not exists (select 1 from _mb_sup_p10 s where b.p10 <> '' and s.p10 = b.p10)
       and not exists (select 1 from _mb_sup_cid s where s.cid = b.ghl_contact_id)
       and not exists (select 1 from campaign_segment_members m where m.campaign_slug = v_slug and m.lead_record_id = b.id)
       and not exists (select 1 from campaign_segment_members m where m.campaign_slug = v_slug and m.email = b.em);
  -- A prohibited industry by EITHER the company name or the SIC excludes (conservative).
  delete from _mb_eligible e
   where exists (select 1 from bitty_industries bi where bi.tier = 'prohibited' and bi.label in (e.name_label, e.sic_label));
  delete from _mb_eligible e where not (
        (e.lead_type = 'ucc' and e.label is not null
          and exists (select 1 from bitty_industries bi where bi.label = e.label and bi.tier in ('preferred','standard'))
          and e.label <> 'Public Administration'  -- Bitty lists it, but city halls and fire departments are not merchants
          -- negative revenue screen only: a UCC row whose ANNUAL revenue is known and below Bitty's $5K/mo floor
          and not (e.revenue_band_basis is null and e.revenue is not null and e.revenue >= 1000 and e.revenue < 60000)
          and not (e.revenue_band_basis = 'annual' and e.revenue_band_high is not null and e.revenue_band_high < 60000))
     or (e.lead_type = 'trigger' and e.monthly >= 5000));

  insert into campaign_segment_members (
    campaign_slug, lead_record_id, source, email, first_name, company, state, timezone, ghl_contact_id,
    bitty_industry, bitty_tier, industry_merge, industry_basis, monthly_revenue_floor, wavv_soft_no, dnd_run_id)
  select v_slug, d.id, d.lead_type, d.em, nullif(trim(initcap(d.first_name)),''), d.company,
         coalesce(d.state, d.state_inferred), d.timezone_inferred, d.ghl_contact_id,
         d.label, bi.tier,
         case when d.basis = 'company_name' then bi.merge_phrase end,  -- never a SIC-derived phrase
         d.basis, d.monthly,
         exists (select 1 from _mb_soft_no sn where sn.p10 <> '' and sn.p10 = d.p10), v_run
    from (select distinct on (e.em) e.*   -- one member per email: prefer UCC, then preferred tier, then oldest row
            from _mb_eligible e left join bitty_industries bi2 on bi2.label = e.label
           order by e.em, (e.lead_type = 'ucc') desc, (bi2.tier = 'preferred') desc nulls last, e.created_at, e.id) d
    left join bitty_industries bi on bi.label = d.label;
  get diagnostics v_n = row_count;

  return jsonb_build_object('campaign_slug', v_slug, 'inserted', v_n, 'dnd_run_id', v_run,
    'enrolled_kept', (select count(*) from campaign_segment_members where campaign_slug = v_slug and enrolled_at is not null));
end $$;
revoke all on function public.build_micro_bitty_segment(interval) from public, anon, authenticated;
