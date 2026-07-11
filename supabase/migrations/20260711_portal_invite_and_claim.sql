-- 0.2 — Portal invite plumbing.
--
-- 1) customers.portal_invited_at — stamped by the merchant-invite edge function
--    when a magic-link invite is sent (drives sent/accepted status in admin UI).
-- 2) handle_new_user() extended with claim-by-email: when a NEW auth user's
--    verified email exact-matches EXACTLY ONE customer with a null user_id, link
--    that customer to the new user. Ambiguous (2+) matches do nothing. This is
--    the fallback path for merchants who self-sign-up instead of using an invite.

alter table public.customers
  add column if not exists portal_invited_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  match_ids uuid[];
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));

  -- Claim-by-email fallback (exact match only; ambiguous does nothing).
  if new.email is not null then
    select array_agg(id) into match_ids
    from public.customers
    where lower(email) = lower(new.email) and user_id is null;

    if array_length(match_ids, 1) = 1 then
      update public.customers set user_id = new.id where id = match_ids[1];
    end if;
  end if;

  return new;
end;
$$;
