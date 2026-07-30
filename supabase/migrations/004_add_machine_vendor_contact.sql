-- MMS-026: add optional vendor contact information to machines.
-- ADD COLUMN IF NOT EXISTS keeps this migration safe to re-run and preserves
-- all existing machine records.

begin;

alter table machines add column if not exists vendor_company text;
alter table machines add column if not exists vendor_email text;
alter table machines add column if not exists vendor_phone text;

commit;
