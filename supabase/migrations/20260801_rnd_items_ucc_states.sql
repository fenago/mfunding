-- R&D "UCC Bulk-Data — 52-jurisdiction table" + "Phase U — UCC List Machine".
-- REFERENCE DATA + PLAN ONLY. Seeds content into rnd_items; builds NO ingestion
-- code. Two additive pieces, both idempotent and guarded so they never clobber
-- the owner's edits or re-add deleted rows:
--
--   1. section 'ucc_states' — one note per US jurisdiction (50 states + DC + PR =
--      52), tiered 1–5 by how buy-able the bulk data is, plus a methodology
--      header and a Guam/USVI territories footnote. Rendered as tier-grouped,
--      scannable cards with clickable source/search links.
--
--   2. Phase U tasks appended to the existing 'plan_phases' cluster (content.phase
--      = 'Phase U …') so they render after Phase 5 in Build Phases, plus one
--      UCC-economics note in 'plan_econ'. Clearly marked NOT YET GREENLIT.
--
-- Research date 2026-08-01. Every price is transcribed as published — never
-- guessed. 'scrapable' = the page TYPE only (HTML / SPA / API / captcha), NOT a
-- robots.txt or ToS legal review. Aged/third-party figures are flagged
-- (North Carolina's price is a 2017 IACA survey figure — verify).
--
-- JSON uses $j$…$j$ dollar-quoting; prose avoids inner double quotes so no JSON
-- escaping is needed. Apostrophes are safe inside dollar-quoted strings.

-- ── 1. UCC bulk-data table ────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from public.rnd_items where section = 'ucc_states') then
    insert into public.rnd_items (section, kind, label, content, sort_order) values

    -- METHODOLOGY HEADER (rendered above the tiers) -----------------------
    ('ucc_states','note','UCC Bulk-Data Sourcing — read me first',
      $j$ {"header":true,"body":"Research date 2026-08-01. Every claim is cited to an official source; prices are transcribed AS PUBLISHED — never guessed. scrapable describes the page TYPE only (plain HTML / JS SPA / API / captcha) — it is NOT a robots.txt or Terms-of-Service legal review, which must happen before any automated pull. Third-party and aged figures are flagged: North Carolina's price is from a 2017 IACA survey — verify with NC SOS before relying on it."} $j$, 0),

    -- ── TIER 1 — FREE ───────────────────────────────────────────────────
    ('ucc_states','note','Virginia',
      $j$ {"tier":"1","bulk_available":"Yes — FREE. SCC Open Data Portal: Filing Details + Lien Details CSV + CKAN REST API","price":"$0","free_option":"Full data free (CSV + API)","search_url":"https://cis.scc.virginia.gov","source":"https://odgavaprod.ogopendata.com (CKAN)","scrapable":"API — CKAN REST","notes":"Standout — the single best free full-data source. Filing Details + Lien Details datasets."} $j$, 1),
    ('ucc_states','note','Colorado',
      $j$ {"tier":"1","bulk_available":"Yes — FREE full UCC datasets on data.colorado.gov (Socrata API)","price":"$0","free_option":"Full data free (Socrata) + free search","search_url":"https://www.coloradosos.gov/ucc","source":"https://data.colorado.gov (Socrata)","scrapable":"API — Socrata","notes":"On-site free download is farm-product EFS only — the full data is on the open-data portal."} $j$, 2),
    ('ucc_states','note','Oregon',
      $j$ {"tier":"1","bulk_available":"Yes — FREE last-month filings list on data.oregon.gov (Socrata CSV/API)","price":"$0 last-month list; custom extracts fee unpublished","free_option":"Last-month filings free + free search","search_url":"https://secure.sos.state.or.us/ucc","source":"https://data.oregon.gov (Socrata)","scrapable":"API — Socrata","notes":"Custom full extracts via request form — fee not published."} $j$, 3),
    ('ucc_states','note','Connecticut',
      $j$ {"tier":"1","bulk_available":"Yes — registry data extract FREE on data.ct.gov; UCC image subscription $1,000/yr","price":"Data extract $0; images $1,000/yr","free_option":"Registry extract free","search_url":"https://portal.ct.gov/SOTS","source":"data.ct.gov · portal.ct.gov/SOTS bulk-data page","scrapable":"Portal / data extract","notes":"Images are the only paid piece."} $j$, 4),

    -- ── TIER 2 — CHEAP BULK ─────────────────────────────────────────────
    ('ucc_states','note','California',
      $j$ {"tier":"2","bulk_available":"Yes — master unload; WEEKLY DATA UNLOADS FREE","price":"Master data $100 / images $800 / both $900; weekly updates FREE","free_option":"Free weekly data unloads","search_url":"https://bizfileonline.sos.ca.gov","source":"https://bpd.cdn.sos.ca.gov/ucc/ucc-fee-schedule.pdf","scrapable":"JS SPA (bizfile)","notes":"$100 to seed + free weekly deltas = cheapest ongoing full-state feed."} $j$, 5),
    ('ucc_states','note','New Jersey',
      $j$ {"tier":"2","bulk_available":"Yes — bulk by DATE RANGE via njportal.com/ucc/SearchBulk","price":"~$0.0185/record + $0.005 admin (~$0.02/rec)","free_option":"—","search_url":"https://www.njportal.com/ucc/SearchBulk","source":"njportal.com/ucc/SearchBulk","scrapable":"Portal — date-range pulls","notes":"Cheapest per-record anywhere — pull only the fresh window you need."} $j$, 6),
    ('ucc_states','note','Idaho',
      $j$ {"tier":"2","bulk_available":"Yes — UCC data $125/download (bi-weekly full replacement, tab-delimited)","price":"Data $125/download; images $125; no subscription","free_option":"Search $3","search_url":"https://sos.idaho.gov/ucc","source":"sos.idaho.gov/ucc","scrapable":"Download — tab-delimited","notes":"No subscription required; bi-weekly full replacement."} $j$, 7),
    ('ucc_states','note','Iowa',
      $j$ {"tier":"2","bulk_available":"Yes — Master File UCC $300 one-time (weekly/monthly options); Corp+UCC $500","price":"UCC master $300; Corp+UCC $500","free_option":"Free search","search_url":"https://sos.iowa.gov","source":"sos.iowa.gov/business/pdf/MasterFileAgmt.pdf","scrapable":"Master file (signed agreement)","notes":"Requires a signed Master File Agreement."} $j$, 8),
    ('ucc_states','note','North Dakota',
      $j$ {"tier":"2","bulk_available":"Yes — entire DB CSV $500; refresh $500; updated 1st and 16th","price":"$500 full CSV; $500 refresh","free_option":"Free search","search_url":"https://cis.sos.nd.gov","source":"cis.sos.nd.gov","scrapable":"CSV download","notes":"Cheapest full-DB tier; refreshed twice monthly (1st + 16th)."} $j$, 9),
    ('ucc_states','note','Washington',
      $j$ {"tier":"2","bulk_available":"Yes — DOL (not SOS): full DB $500 / $1,000 w/ images; weekly updates $150","price":"Full DB $500; w/ images $1,000; updates $150/wk","free_option":"Free search responses","search_url":"https://www.dol.wa.gov","source":"ucc@dol.wa.gov · 360-664-6616","scrapable":"reCAPTCHA on site","notes":"Administered by the Dept. of Licensing, not the SOS."} $j$, 10),
    ('ucc_states','note','Texas',
      $j$ {"tier":"2","bulk_available":"Yes — master unload $1,150 (full DB snapshot, JSON) + daily updates","price":"Master $1,150; daily updates $65 data / $65 images / $90 both","free_option":"SOSDirect search $1","search_url":"https://www.sos.state.tx.us/ucc/bulk-order.shtml","source":"sos.state.tx.us/ucc/bulk-order.shtml","scrapable":"Bulk order — JSON","notes":"Biggest-volume state. Files ready ~30 days after order; updates cover the last 30 days."} $j$, 11),
    ('ucc_states','note','Michigan',
      $j$ {"tier":"2","bulk_available":"Yes — data $500/4-wk, $3,000/6mo; images $6,000/yr","price":"Data $500/4-wk or $3,000/6mo; images $6,000/yr","free_option":"Free Debtor Quick Search","search_url":"https://www.michigan.gov/lara","source":"517-335-6167","scrapable":"Behind MiLogin for full search","notes":"Free Debtor Quick Search; full UCC-11 behind MiLogin."} $j$, 12),
    ('ucc_states','note','Wisconsin',
      $j$ {"tier":"2","bulk_available":"Yes — DFI: monthly Data Refresh $500; $250/weekly file (data+images)","price":"Monthly refresh $500; weekly file $250","free_option":"Search $7","search_url":"https://wims.dfi.wi.gov","source":"DFI-UCC@dfi.wisconsin.gov","scrapable":"Data refresh / weekly file","notes":"Administered by the Dept. of Financial Institutions."} $j$, 13),
    ('ucc_states','note','Maine',
      $j$ {"tier":"2","bulk_available":"Yes — UCC data with weekly updates $300; Corp+UCC $600/mo","price":"UCC data $300 (weekly updates); Corp+UCC $600/mo","free_option":"—","search_url":"https://www.maine.gov/sos","source":"maine.gov/sos bulk-data","scrapable":"Data extract (subscriber search)","notes":"Individual search is subscriber-only."} $j$, 14),
    ('ucc_states','note','North Carolina',
      $j$ {"tier":"2","unverified":true,"bulk_available":"Yes — full DB via FTP subscription, updated at least weekly","price":"$750 setup + $250/yr","free_option":"—","search_url":"https://www.sosnc.gov","source":"18 NCAC 05B rules","scrapable":"FTP subscription","notes":"Price is a 2017 IACA survey figure — VERIFY directly with NC SOS before relying on it."} $j$, 15),

    -- ── TIER 3 — MODERATE ───────────────────────────────────────────────
    ('ucc_states','note','Arizona',
      $j$ {"tier":"3","bulk_available":"Yes — full index or monthly index subscription","price":"Full index $2,000 data / $24,000 w/ images; monthly sub $1,800/yr data or $4,800/yr images; single issue $800","free_option":"—","search_url":"https://azsos.gov","source":"azsos.gov","scrapable":"Data subscription (8–12wk delivery)","notes":"Collateral is NOT in the data. Delivery 8–12 weeks."} $j$, 16),
    ('ucc_states','note','Georgia',
      $j$ {"tier":"3","bulk_available":"Yes — GSCCCA (clerks authority, not SOS): download/transfer subscription","price":"$200 daily / $750 weekly / $1,500 monthly (1995–present)","free_option":"—","search_url":"https://www.gsccca.org/docs/ucc-documents/bulkapp.pdf","source":"gsccca.org/docs/ucc-documents/bulkapp.pdf","scrapable":"Paid account required for search","notes":"Search needs a paid account ($14.95–29.95/mo)."} $j$, 17),
    ('ucc_states','note','Kentucky',
      $j$ {"tier":"3","bulk_available":"Yes — UCC filings $1,500/mo; images $300/mo","price":"Filings $1,500/mo; images $300/mo","free_option":"Free active-index search","search_url":"https://sos.ky.gov","source":"sos.ky.gov bulk-data page","scrapable":"Data subscription","notes":"Free active-index search on the SOS site."} $j$, 18),
    ('ucc_states','note','South Dakota',
      $j$ {"tier":"3","bulk_available":"Yes — full DB $1,500 first + $750/mo or $250/wk updates","price":"$1,500 first + $750/mo (or $250/wk); image weekly $175","free_option":"Search sub $300/yr","search_url":"https://sdsos.gov","source":"sdsos.gov","scrapable":"Data subscription","notes":"Search subscription $300/yr."} $j$, 19),
    ('ucc_states','note','Utah',
      $j$ {"tier":"3","bulk_available":"Yes — subscription (Dept. of Commerce)","price":"$1,000/mo or $6,000/6mo","free_option":"—","search_url":"https://ucc.utah.gov","source":"ucc.utah.gov","scrapable":"Data subscription","notes":"Search $12/name. Administered by the Dept. of Commerce."} $j$, 20),
    ('ucc_states','note','Massachusetts',
      $j$ {"tier":"3","bulk_available":"Yes — data extract $4,800/yr or $100/wk; images $1,200/yr","price":"Data $4,800/yr or $100/wk; images $1,200/yr","free_option":"Free individual search","search_url":"https://www.sec.state.ma.us/cor","source":"950 CMR 140.11","scrapable":"Data extract","notes":"The $100/wk option makes fresh-window pulls affordable."} $j$, 21),
    ('ucc_states','note','Rhode Island',
      $j$ {"tier":"3","bulk_available":"Yes — data $1,500 setup + $4,800/yr; data+images $3,000 + $8,400/yr","price":"Data $1,500 setup + $4,800/yr; +images $3,000 + $8,400/yr","free_option":"Free search","search_url":"https://business.sos.ri.gov","source":"business.sos.ri.gov","scrapable":"ASP.NET","notes":"—"} $j$, 22),
    ('ucc_states','note','Louisiana',
      $j$ {"tier":"3","bulk_available":"Direct Access $400/yr — unlimited USAGE (access, NOT a data extract)","price":"$400/yr unlimited access; certified searches $30 via parish clerks","free_option":"—","search_url":"https://uccweb.sos.la.gov","source":"uccweb.sos.la.gov","scrapable":"Access subscription (no extract)","notes":"This buys ACCESS, not a bulk data file — you would have to scrape it."} $j$, 23),
    ('ucc_states','note','New York',
      $j$ {"tier":"3","bulk_available":"NO index extract — image retrieval $300/mo only","price":"Images $300/mo (TIFF by file date); copies $5/$10","free_option":"FREE public search","search_url":"https://appext20.dos.ny.gov/pls/ucc_public","source":"appext20.dos.ny.gov/pls/ucc_public","scrapable":"Yes — frame-based, no captcha/login (classically scrapable)","notes":"No data extract sold; but the free public search is classically scrapable."} $j$, 24),
    ('ucc_states','note','Hawaii',
      $j$ {"tier":"3","bulk_available":"Images only — no structured extract","price":"$1,000/mo unlimited or $50/mo + $3/doc ($1/page)","free_option":"—","search_url":"https://bocdataext.hi.wcicloud.com","source":"Bureau of Conveyances (DLNR)","scrapable":"Login required; images only","notes":"Bureau of Conveyances (DLNR) — no structured data feed."} $j$, 25),

    -- ── TIER 4 — EXPENSIVE (avoid unless needed) ────────────────────────
    ('ucc_states','note','South Carolina',
      $j$ {"tier":"4","bulk_available":"Yes — monthly CSV subscription (fiscal-year, ACH only, no proration)","price":"$12,000/yr + Tyler subscriber fee","free_option":"—","search_url":"https://ucconline.sc.gov","source":"ucconline.sc.gov","scrapable":"Monthly CSV","notes":"Fiscal-year billing, ACH only, no proration."} $j$, 26),
    ('ucc_states','note','Nevada',
      $j$ {"tier":"4","bulk_available":"Yes — one-time download or weekly (data only)","price":"$10,000 one-time or $250/wk","free_option":"—","search_url":"https://www.nvsos.gov","source":"nvsos.gov (Project Orion, Mar 2025)","scrapable":"Data download","notes":"Weekly $250 is the sane entry point vs the $10K one-time."} $j$, 27),
    ('ucc_states','note','Minnesota',
      $j$ {"tier":"4","bulk_available":"Yes — initial dataset + weekly subscription","price":"$9,600 initial; 3-mo weekly sub $2,400; images 3-mo $1,500","free_option":"—","search_url":"https://mblsportal.sos.state.mn.us","source":"mblsportal.sos.state.mn.us","scrapable":"Data extract (signed license)","notes":"Requires a signed license."} $j$, 28),
    ('ucc_states','note','Indiana',
      $j$ {"tier":"4","bulk_available":"Yes — bulk via INBiz","price":"$9,500 + $500/update","free_option":"Free search w/ images","search_url":"https://inbiz.in.gov","source":"inbiz.in.gov","scrapable":"Free search incl. images","notes":"Free search includes images — scraping may beat the $9,500 bulk."} $j$, 29),
    ('ucc_states','note','Kansas',
      $j$ {"tier":"4","bulk_available":"Yes — bulk UCC enrollment (2026 regs)","price":"$7,500/entity enrollment","free_option":"—","search_url":"https://www.sos.ks.gov","source":"Kansas 2026 regs","scrapable":"Subscription required for search","notes":"Unofficial per-name searches run $8–10."} $j$, 30),

    -- ── TIER 5 — CONTACT / UNPUBLISHED / NONE ───────────────────────────
    ('ucc_states','note','Alabama',
      $j$ {"tier":"5","bulk_available":"No bulk published — contact 334-353-0203","price":"Not published","free_option":"Free Advanced Search","search_url":"https://www.sos.alabama.gov","source":"334-353-0203","scrapable":"Plain HTML","notes":"—"} $j$, 31),
    ('ucc_states','note','Alaska',
      $j$ {"tier":"5","bulk_available":"No bulk — DNR Recorder (not SOS)","price":"Not published","free_option":"Free search","search_url":"https://dnr.alaska.gov/ssd/recoff/Ucc/search","source":"DNR Recorder Office","scrapable":"Plain HTML","notes":"Inactive filings purged annually."} $j$, 32),
    ('ucc_states','note','Arkansas',
      $j$ {"tier":"5","bulk_available":"Bulk via INA portal (ark.org) — price not itemized","price":"Not itemized — contact 1-888-233-0325","free_option":"Free search","search_url":"https://www.ark.org","source":"INA portal (ark.org)","scrapable":"Portal","notes":"Per-record pricing likely."} $j$, 33),
    ('ucc_states','note','Delaware',
      $j$ {"tier":"5","bulk_available":"No bulk — closed system (authorized filers/searchers only)","price":"Certified search $25/debtor","free_option":"None — no public portal","search_url":"","source":"DE Dept. of State (closed system)","scrapable":"No public portal","notes":"No public search, no bulk — authorized users only."} $j$, 34),
    ('ucc_states','note','Florida',
      $j$ {"tier":"5","bulk_available":"No published bulk — privatized to Image API LLC since 2001","price":"Not published — call 850-222-8526","free_option":"Free search","search_url":"https://www.floridaucc.com/search","source":"floridaucc.com (Image API LLC)","scrapable":"Vendor portal","notes":"Sunbiz free downloads are corporate-only, NOT UCC."} $j$, 35),
    ('ucc_states','note','Illinois',
      $j$ {"tier":"5","bulk_available":"No self-serve bulk (FOIA/contact 217-782-7519)","price":"FOIA / contact","free_option":"FREE index search","search_url":"https://apps.ilsos.gov/uccsearch","source":"217-782-7519","scrapable":"Plain HTML, no captcha","notes":"Free index search is plain HTML with no captcha — scrapable."} $j$, 36),
    ('ucc_states','note','Maryland',
      $j$ {"tier":"5","bulk_available":"No bulk published — SDAT (not SOS)","price":"Not published — sdat.ucc@maryland.gov / 410-767-1459","free_option":"Free search","search_url":"https://egov.maryland.gov","source":"SDAT — sdat.ucc@maryland.gov","scrapable":"ASP.NET","notes":"—"} $j$, 37),
    ('ucc_states','note','Mississippi',
      $j$ {"tier":"5","bulk_available":"No published bulk","price":"Detail behind subscription","free_option":"Free basic search (STAR portal)","search_url":"https://www.sos.ms.gov","source":"601-359-1633","scrapable":"Portal — detail behind subscription","notes":"STAR portal: basic search free, detail behind subscription."} $j$, 38),
    ('ucc_states','note','Missouri',
      $j$ {"tier":"5","bulk_available":"No bulk published — 573-751-4628","price":"UCC-11 $27","free_option":"Login portal","search_url":"https://bsd.sos.mo.gov","source":"573-751-4628","scrapable":"Login portal","notes":"—"} $j$, 39),
    ('ucc_states','note','Montana',
      $j$ {"tier":"5","bulk_available":"UccCore pipe-delimited full snapshot exists — price NOT published","price":"Not published — 406-444-2468","free_option":"Free search","search_url":"https://biz.sosmt.gov","source":"406-444-2468","scrapable":"Pipe-delimited snapshot","notes":"Snapshot covers Filings/Debtors/SecuredParties/Amendments. Corp bulk is $0.02/rec (proxy only)."} $j$, 40),
    ('ucc_states','note','Nebraska',
      $j$ {"tier":"5","bulk_available":"Batch searches only (special-request form)","price":"Name search $4.50 (subscriber); doc-# search free","free_option":"Doc-# search free","search_url":"https://www.nebraska.gov/uccsr","source":"nebraska.gov/uccsr","scrapable":"Special-request batch","notes":"No standing bulk file — batch requests via form."} $j$, 41),
    ('ucc_states','note','New Hampshire',
      $j$ {"tier":"5","bulk_available":"No bulk","price":"Searches $10–50 by speed","free_option":"—","search_url":"https://quickstart.sos.nh.gov","source":"quickstart.sos.nh.gov","scrapable":"Portal","notes":"—"} $j$, 42),
    ('ucc_states','note','New Mexico',
      $j$ {"tier":"5","bulk_available":"No bulk published — 1-800-477-3632","price":"Not published","free_option":"Portal search","search_url":"https://enterprise.sos.nm.gov","source":"1-800-477-3632","scrapable":"Portal","notes":"—"} $j$, 43),
    ('ucc_states','note','Ohio',
      $j$ {"tier":"5","bulk_available":"NO UCC bulk (business-entity bulk only)","price":"—","free_option":"FREE search incl. images","search_url":"https://ucc.ohiosos.gov","source":"ucc.ohiosos.gov","scrapable":"Free search incl. images","notes":"Free search includes images — scrapable in lieu of bulk."} $j$, 44),
    ('ucc_states','note','Oklahoma',
      $j$ {"tier":"5","bulk_available":"No bulk published — Oklahoma County Clerk is the central UCC office","price":"Not published","free_option":"Search","search_url":"https://okcc.online","source":"Oklahoma County Clerk","scrapable":"Portal","notes":"UCC centralized at the County Clerk, not the SOS."} $j$, 45),
    ('ucc_states','note','Pennsylvania',
      $j$ {"tier":"5","bulk_available":"No bulk","price":"$12/debtor-name search","free_option":"—","search_url":"https://file.dos.pa.gov","source":"file.dos.pa.gov","scrapable":"Portal","notes":"—"} $j$, 46),
    ('ucc_states','note','Tennessee',
      $j$ {"tier":"5","bulk_available":"Product exists (Purchase Database Downloads) — price only inside the portal after login","price":"Behind login","free_option":"—","search_url":"https://tnbear.tn.gov","source":"tnbear.tn.gov","scrapable":"Login portal","notes":"Price shown only after logging in."} $j$, 47),
    ('ucc_states','note','Vermont',
      $j$ {"tier":"5","bulk_available":"No bulk advertised — contact SOS","price":"Not advertised","free_option":"FREE uncertified search","search_url":"https://bizfilings.vermont.gov/uccsearch","source":"bizfilings.vermont.gov/uccsearch","scrapable":"Portal","notes":"—"} $j$, 48),
    ('ucc_states','note','West Virginia',
      $j$ {"tier":"5","bulk_available":"Bulk products listed (all/new UCC monthly/weekly/daily + images) — price behind a monthly account","price":"Behind monthly account","free_option":"Free search","search_url":"https://apps.wv.gov/sos/ucc","source":"apps.wv.gov/sos/ucc","scrapable":"Account-gated pricing","notes":"Products exist; pricing requires an account."} $j$, 49),
    ('ucc_states','note','Wyoming',
      $j$ {"tier":"5","bulk_available":"No bulk found","price":"Search needs e-filing subscription","free_option":"—","search_url":"https://sos.wyo.gov","source":"sos.wyo.gov","scrapable":"Subscription portal","notes":"—"} $j$, 50),
    ('ucc_states','note','District of Columbia',
      $j$ {"tier":"5","bulk_available":"No bulk advertised — Recorder of Deeds (OTR)","price":"Registration required (vendor)","free_option":"Search via vendor","search_url":"https://washington.dc.publicsearch.us","source":"Recorder of Deeds (OTR) via publicsearch.us","scrapable":"Vendor portal (registration)","notes":"—"} $j$, 51),
    ('ucc_states','note','Puerto Rico',
      $j$ {"tier":"5","bulk_available":"No bulk advertised — Depto. de Estado RTC (Ley 21-2012)","price":"$25 filing/search/cert","free_option":"Account portal","search_url":"https://uccapp.estado.pr.gov","source":"uccapp.estado.pr.gov","scrapable":"Account portal","notes":"—"} $j$, 52),

    -- ── TERRITORIES FOOTNOTE (Guam, USVI) ───────────────────────────────
    ('ucc_states','note','Guam',
      $j$ {"tier":"footnote","bulk_available":"No online search evident — Dept. of Rev & Tax, Regulatory Div","price":"—","source":"671-635-1844","notes":"No online UCC search evident."} $j$, 53),
    ('ucc_states','note','U.S. Virgin Islands',
      $j$ {"tier":"footnote","bulk_available":"Online filing/search since 2019 — no bulk","price":"—","source":"Lt. Governor — Corporations & Trademarks","notes":"Online filing/search since 2019; no bulk product."} $j$, 54);
  end if;
end$$;

-- ── 2. Phase U — UCC List Machine (appended to plan_phases) ───────────────
do $$
begin
  if not exists (
    select 1 from public.rnd_items
    where section = 'plan_phases' and content->>'phase' like 'Phase U%'
  ) then
    insert into public.rnd_items (section, kind, label, content, sort_order) values
    ('plan_phases','task','Acquire Tier-1/2 starter UCC sources',
      $j$ {"phase":"Phase U — UCC List Machine (build on greenlight — NOT YET GREENLIT)","step":"U.1","who":"Owner","cost":"~$600 one-time","detail":"Free-first: Virginia (instant), Colorado, Oregon. Then California ($100 via bizfile) + New Jersey (per-record account). Optional at start: Texas ($1,150 — biggest volume). Expansion: Idaho / Iowa / North Dakota. Deliver files/credentials to the dev. See the UCC Bulk-Data table for exact prices + links.","appLink":"/admin/rnd","appLinkLabel":"UCC Bulk-Data table"} $j$, 18),
    ('plan_phases','task','ph-ucc-ingest: normalized filings table + per-state parsers',
      $j$ {"phase":"Phase U — UCC List Machine (build on greenlight — NOT YET GREENLIT)","step":"U.2","who":"Dev","detail":"ph_ucc_filings table (state, filing_no, filed_date, debtor name/address, secured_party, lapse/status, raw jsonb) + per-state parsers (CSV / JSON / Socrata / CKAN) + freshness tracking."} $j$, 19),
    ('plan_phases','task','MCA-position detector (secured-party matcher + stack scoring)',
      $j$ {"phase":"Phase U — UCC List Machine (build on greenlight — NOT YET GREENLIT)","step":"U.3","who":"Dev","detail":"Secured-party matcher seeded from our lenders DB + known-funder aliases (Calabria / Nav Kapital / FUNNDED / UNIFIE / etc.), fuzzy matching, stack-depth scoring (# of MCA filings per debtor), recency scoring — output = ranked fresh-position leads."} $j$, 20),
    ('plan_phases','task','Skip-trace provider + append pipeline',
      $j$ {"phase":"Phase U — UCC List Machine (build on greenlight — NOT YET GREENLIT)","step":"U.4","who":"Owner + Dev","cost":"~$0.10–0.20/hit","detail":"Owner (15 min): sign up BatchSkipTracing or IDI, API key to the vault. Dev: append phones/emails onto matched debtors."} $j$, 21),
    ('plan_phases','task','Scrub, suppress, dedupe → load to campaign + GHL',
      $j$ {"phase":"Phase U — UCC List Machine (build on greenlight — NOT YET GREENLIT)","step":"U.5","who":"Dev","detail":"TCPA cell-scrub + DNC suppression + dedupe vs existing contacts → load to campaign PH-UCC-2026-001 + GHL contacts tagged ph-ucc → PH pipeline New List Lead."} $j$, 22),
    ('plan_phases','task','Refresh crons per state cadence + freshness SLA',
      $j$ {"phase":"Phase U — UCC List Machine (build on greenlight — NOT YET GREENLIT)","step":"U.6","who":"Dev","detail":"Per-state refresh crons (CA weekly free files, OR monthly, ND 1st/16th, NJ date-range pulls) + freshness SLA metric: dial within N days of filing."} $j$, 23);
  end if;
end$$;

-- ── 3. UCC list-machine economics note (appended to plan_econ) ────────────
do $$
begin
  if not exists (
    select 1 from public.rnd_items
    where section = 'plan_econ' and label = 'UCC list machine economics'
  ) then
    insert into public.rnd_items (section, kind, label, content, sort_order) values
    ('plan_econ','note','UCC list machine economics',
      $j$ {"body":"A freshly manufactured UCC lead runs about $0.15–0.30 all-in (skip-trace dominated) vs $1–5 for stale resold data. The freshness window IS the edge — dial within days of the filing. (Build on greenlight — not yet greenlit for code.)"} $j$, 9);
  end if;
end$$;
