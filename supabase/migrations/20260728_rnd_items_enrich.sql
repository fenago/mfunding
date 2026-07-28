-- Enrich the R&D vendor directory + funder-outreach task with REAL, verified
-- contact details (URLs that resolve, tappable phones, mailto emails). Anything
-- that could not be verified from a live source is flagged unverified — never a
-- guessed link (honest-data rule). Runs against the already-seeded rows.

-- Vendor directory: overwrite each row's content with verified fields ----------
update public.rnd_items set content =
  '{"url":"https://www.onlinejobs.ph/","purpose":"Setter hiring — direct-hire Filipino VA marketplace. Plans $299–$349/mo to contact workers.","note":"No public phone or email — contact is in-app only."}'
  where section='vendors' and label='OnlineJobs.ph';

update public.rnd_items set label='The Calling Agency', content =
  '{"url":"https://callingagency.com/","purpose":"Setter hiring — outsourced cold-calling + appointment-setting.","phone":"+18888750799","phoneDisplay":"(888) 875-0799","note":"Domain is callingagency.com (no \"the\"). Email hidden behind their contact form."}'
  where section='vendors' and label='The Calling Agency';

update public.rnd_items set content =
  '{"purpose":"Setter hiring — appears to be a small overseas call-center recruiter.","unverified":true,"note":"Could not verify a homepage, phone, or email from any live source. Confirm the entity before relying on it — no link is provided rather than a guessed one."}'
  where section='vendors' and label='Techmart';

update public.rnd_items set content =
  '{"url":"https://dailyfunder.com/forumdisplay.php/2-Merchant-Cash-Advance","purpose":"Per-deal scrubbers + processors — the MCA industry forum (MCA subforum).","note":"Contact via forum registration / PM; no public phone or email."}'
  where section='vendors' and label='DailyFunder forum';

update public.rnd_items set content =
  '{"url":"https://www.moneythumb.com/mca/","purpose":"Bank-statement analysis + PDF conversion — PDF Insights scorecard + Thumbprint fraud check.","email":"support@moneythumb.com","note":"The MCA product is quote/subscription-based and demo-gated — no public price. The ~$549 belief is unverified and likely the separate desktop PDF converter, not the MCA tool. Request a quote."}'
  where section='vendors' and label='MoneyThumb';

update public.rnd_items set label='Plaid Dashboard support', content =
  '{"url":"https://dashboard.plaid.com/","purpose":"Trial → Production support — open a case inside the Plaid Dashboard (the /support/new path redirects into the case flow).","note":"Docs: plaid.com/docs/support. No public support phone — ticket / dashboard based."}'
  where section='vendors' and label='Plaid dashboard support';

update public.rnd_items set content =
  '{"url":"https://www.lendflow.com/","purpose":"Underwriting widget demo — embedded lending infra with a 75+ lender network.","note":"Contact via Book a Demo; no public phone or email."}'
  where section='vendors' and label='Lendflow';

update public.rnd_items set content =
  '{"purpose":"Owner lists this for decline monetization.","unverified":true,"note":"plata.biz returns a 404 and could not be verified as a decline-monetization service. Confirm the correct entity before relying on it — no link provided."}'
  where section='vendors' and label='Plata.BIZ';

-- Replace the single UCC-data placeholder with three real providers -----------
delete from public.rnd_items where section='vendors' and label='UCC data purchase';

insert into public.rnd_items (section, kind, label, content, sort_order) values
  ('vendors','link','Klover Data',
    '{"url":"https://kloverdata.com/leads/financial-leads/ucc-leads/","purpose":"UCC data (~850 records/mo, filter $100K+ originals) — real-time + aged UCC/MCA filing lists, TCPA/DNC-scrubbed, same-day. Quote-based.","phone":"+13059061958","phoneDisplay":"(305) 906-1958","email":"info@kloverdata.com"}',9),
  ('vendors','link','MailingLists.com — UCC lists',
    '{"url":"https://mailinglists.com/ucc-lists","purpose":"UCC secured-loan / MCA filing lists — 30M+ records (D&B partner). Quote-based (researched estimate).","phone":"+19149488300","phoneDisplay":"(914) 948-8300","note":"Email not published — phone-first."}',11),
  ('vendors','link','Salesgenie (Data Axle) — UCC leads',
    '{"url":"https://www.salesgenie.com/leads/ucc-leads/","purpose":"UCC filing lead lists — established data vendor (Data Axle). Subscription/quote.","unverified":true,"note":"Pricing is a researched estimate; phone not confirmed on the UCC page."}',12);

-- Synergy Direct: attach the real record we hold in marketing_vendors ---------
update public.rnd_items set content =
  '{"appLink":"/admin/lead-partner","appLinkLabel":"Lead Partner (Synergy)","url":"https://synergydirectsolution.com","purpose":"Live-transfer partner — demand a credit on every sub-60-second transfer.","phone":"+18664280172","phoneDisplay":"(866) 428-0172","email":"support@synergydirectsolution.com"}'
  where section='vendors' and label='Synergy Direct';

-- Build-phase Synergy task: same tappable contact inline ---------------------
update public.rnd_items set content =
  '{"detail":"Demand a credit on every sub-60-second transfer. Route the remaining transfers through the new collection flow as a live test.","appLink":"/admin/lead-partner","appLinkLabel":"Lead Partner (Synergy)","phone":"+18664280172","phoneDisplay":"(866) 428-0172","email":"support@synergydirectsolution.com"}'
  where section='build_infra' and label='Synergy: demand credits + test the new collection flow';
