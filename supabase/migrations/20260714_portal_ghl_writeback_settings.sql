-- Portal → GHL write-back config (P1 of the portal-in-playbook plan).
--
-- merchant-doc-uploaded stops the GHL doc-chase for a contact the moment their
-- portal upload satisfies the ask, via contact-level workflow removal
-- (DELETE /contacts/{id}/workflow/{workflowId} — verified live 2026-07-13,
-- returns 200 {"succeeded":true}). The workflow IDs live HERE, in settings,
-- never hardcoded in function code:
--
--   mca06_workflow_id — "MCA 06 - Bank Statements (Seq A)": removed when the
--                       deal's bank-statement request is satisfied.
--   mca05_workflow_id — "MCA 05 - Docs Collected" (non-bank stips chase):
--                       removed when ALL required non-bank requests are in.
--
-- Both IDs verified against the live MFunding location (t7NmVR4WCy927j4Zon4b)
-- workflow list on 2026-07-14. ON CONFLICT DO NOTHING so a later owner edit in
-- Admin → Settings is never clobbered by a re-run.

insert into public.platform_settings (key, value)
values (
  'portal_ghl_writeback',
  jsonb_build_object(
    'mca05_workflow_id', 'd7f5985a-b9a7-4753-aea8-195dd24271e0',
    'mca06_workflow_id', 'f2472211-4c93-494f-aca2-1c7c6bfc7e25'
  )
)
on conflict (key) do nothing;
