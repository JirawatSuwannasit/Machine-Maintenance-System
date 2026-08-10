-- MMS-027 Stage A: bootstrap application role and section assignments.
--
-- Apply this migration first. Do not apply the future Stage B business-table
-- RLS cutover until a product owner has assigned and verified at least one
-- role=admin, section=NULL row in public.user_access.

begin;

create table public.user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text,
  section text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_access_role_check
    check (role is null or role in ('admin', 'user')),
  constraint user_access_section_check
    check (section is null or section in ('REL', 'GP', 'FA', 'CAL')),
  constraint user_access_assignment_check
    check (
      (role is null and section is null)
      or (role = 'admin' and section is null)
      or (role = 'user' and section in ('REL', 'GP', 'FA', 'CAL'))
    )
);

comment on table public.user_access is
  'Application access assignments. Manage only in Supabase Dashboard Table Editor.';
comment on column public.user_access.role is 'Application role: admin, user, or NULL while pending.';
comment on column public.user_access.section is 'User work section: REL, GP, FA, CAL; NULL for admins and pending accounts.';

-- Trigger-owned synchronization is deliberately separate from application
-- authorization. The function has a fixed search path and all relations are
-- schema-qualified. Empty string is used only for an auth identity without an
-- email, keeping the required NOT NULL invariant without inventing an address.
create or replace function public.sync_auth_user_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.user_access (user_id, email, role, section)
    values (new.id, coalesce(new.email, ''), null, null)
    on conflict (user_id) do update
      set email = excluded.email,
          updated_at = now();
  elsif new.email is distinct from old.email then
    update public.user_access
       set email = coalesce(new.email, ''),
           updated_at = now()
     where user_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_auth_user_access() from public;
revoke all on function public.sync_auth_user_access() from anon;
revoke all on function public.sync_auth_user_access() from authenticated;

drop trigger if exists trg_auth_users_sync_user_access on auth.users;
create trigger trg_auth_users_sync_user_access
  after insert or update of email on auth.users
  for each row
  execute function public.sync_auth_user_access();

-- Existing accounts remain pending. Never infer or bootstrap an administrator.
insert into public.user_access (user_id, email, role, section)
select users.id, coalesce(users.email, ''), null, null
from auth.users as users
on conflict (user_id) do update
  set email = excluded.email,
      updated_at = now();

create or replace function public.set_user_access_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_user_access_updated_at() from public;
revoke all on function public.set_user_access_updated_at() from anon;
revoke all on function public.set_user_access_updated_at() from authenticated;

create trigger trg_user_access_set_updated_at
  before update on public.user_access
  for each row
  execute function public.set_user_access_updated_at();

-- These SECURITY DEFINER helpers avoid recursive user_access RLS evaluation.
-- They expose only the current authenticated user's authorization values.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select access.role
  from public.user_access as access
  where access.user_id = auth.uid()
$$;

create or replace function public.current_app_section()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select access.section
  from public.user_access as access
  where access.user_id = auth.uid()
$$;

create or replace function public.has_app_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_access as access
    where access.user_id = auth.uid()
      and (
        (access.role = 'admin' and access.section is null)
        or (access.role = 'user' and access.section in ('REL', 'GP', 'FA', 'CAL'))
      )
  )
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_access as access
    where access.user_id = auth.uid()
      and access.role = 'admin'
      and access.section is null
  )
$$;

create or replace function public.can_work_on_machine(machine_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_app_admin()
    or exists (
      select 1
      from public.user_access as access
      join public.machines as machine
        on machine.id = machine_uuid
       and machine.location = access.section
      where access.user_id = auth.uid()
        and access.role = 'user'
        and access.section in ('REL', 'GP', 'FA', 'CAL')
    )
$$;

revoke all on function public.current_app_role() from public, anon;
revoke all on function public.current_app_section() from public, anon;
revoke all on function public.has_app_access() from public, anon;
revoke all on function public.is_app_admin() from public, anon;
revoke all on function public.can_work_on_machine(uuid) from public, anon;

grant execute on function public.current_app_role() to authenticated;
grant execute on function public.current_app_section() to authenticated;
grant execute on function public.has_app_access() to authenticated;
grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.can_work_on_machine(uuid) to authenticated;

alter table public.user_access enable row level security;

create policy user_access_select_own
on public.user_access
for select
to authenticated
using (auth.uid() = user_id);

-- Intentionally no INSERT, UPDATE, or DELETE policy. Application admins and
-- users are both read-only; project-owner Dashboard access is the management
-- path. Existing maintenance policies are intentionally untouched in Stage A.

commit;
