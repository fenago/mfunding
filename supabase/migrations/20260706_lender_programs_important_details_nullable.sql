-- FIX: "Failed to save changes" on the lender admin page (2026-07-06)
--
-- Root cause: lender_programs.important_details was NOT NULL (default '{}').
-- The lender detail page's valuesToPayload() emits `null` for empty `list`-type
-- fields, and the top "Save Changes" button (handleSaveAll -> persistMca) sends
-- that payload on every save. An empty Important Details list therefore sent
-- important_details = null, tripping:
--   ERROR 23502: null value in column "important_details" of relation
--   "lender_programs" violates not-null constraint
-- which mustWrite() re-threw, surfacing as alert("Failed to save changes").
--
-- Same pattern as the earlier lender_programs.required_documents fix.
-- Drop NOT NULL (default stays '{}') so an explicit null is accepted.
-- Applied hot; recorded here for version control.

alter table public.lender_programs alter column important_details drop not null;
