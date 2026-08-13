-- Deal attribution for dial campaigns.
--
-- A deal created from a GHL contact today gets campaign_id = NULL: ghl-webhook's
-- insert simply does not set it (live-transfer-intake is the only path that
-- attributes, and it does so by tracking email/phone, which a dial campaign has
-- no equivalent of).
--
-- WHY A TRIGGER RATHER THAN EDITING ghl-webhook:
--   • ghl-webhook is the most safety-critical function in the project (stage
--     mirroring, timestamp stamping, commission creation). Adding attribution
--     there risks that machinery for an analytics field.
--   • Deals are created from SEVERAL paths (ghl-webhook, bulk-lead-import,
--     intakes). A trigger attributes all of them uniformly; editing one function
--     would attribute one of them.
--   • The webhook would need the contact's TAGS, which for some event shapes
--     means an extra GHL API call per deal. The trigger needs no API call at all:
--     we already know which dial_tag we pushed a contact under, in
--     lead_records.push_tags, keyed by ghl_contact_id.
--
-- NEVER FAILS THE INSERT. Attribution is analytics; a deal must be created even
-- if attribution cannot be resolved. Everything is wrapped so any error leaves
-- campaign_id NULL and lets the row through.
create index if not exists lead_records_ghl_contact_idx
  on public.lead_records (ghl_contact_id) where ghl_contact_id is not null;

create or replace function public.deals_attribute_dial_campaign()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_campaign uuid;
begin
  -- Only fill a gap; never override an attribution another path already made.
  if new.campaign_id is not null or new.ghl_contact_id is null then
    return new;
  end if;
  begin
    select c.id into v_campaign
      from public.lead_records r
      join public.campaigns c
        on c.dial_tag is not null and r.push_tags @> array[c.dial_tag]
     where r.ghl_contact_id = new.ghl_contact_id
     order by r.pushed_at desc nulls last
     limit 1;
    if v_campaign is not null then
      new.campaign_id := v_campaign;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$fn$;
comment on function public.deals_attribute_dial_campaign() is
  'BEFORE INSERT on deals: when campaign_id is null, resolve it from the dial_tag this contact was pushed under (lead_records.push_tags -> campaigns.dial_tag). No GHL call needed. Never overrides an existing attribution and never fails the insert.';

drop trigger if exists trg_deals_attribute_dial_campaign on public.deals;
create trigger trg_deals_attribute_dial_campaign
  before insert on public.deals
  for each row execute function public.deals_attribute_dial_campaign();
