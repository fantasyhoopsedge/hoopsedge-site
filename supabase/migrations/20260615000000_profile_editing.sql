-- ============================================================================
-- FHE PROFILE EDITING
--
-- 1. Truncate username to 12 chars on auto-provision (so long Google display
--    names don't conflict with the new constraint).
-- 2. Add a CHECK constraint so usernames stay ≤ 12 chars at the DB layer.
-- 3. Create the `avatars` Storage bucket (public, 2 MB cap, image types only).
-- 4. RLS policies so users can manage only their own avatar object.
-- ============================================================================

-- ── 1. Update signup trigger to truncate username ────────────────────────────
create or replace function public.handle_new_user_signup()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, username, avatar_url, edge_points, analyst_badge)
  values (
    new.id,
    left(
      coalesce(
        new.raw_user_meta_data ->> 'name',
        new.raw_user_meta_data ->> 'full_name',
        split_part(new.email, '@', 1)
      ),
      12
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    0,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ── 2. Username length constraint ────────────────────────────────────────────
-- Trim any existing usernames > 12 chars before adding the constraint.
update public.profiles
  set username = left(username, 12)
  where char_length(username) > 12;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'username_max_12'
    and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint username_max_12 check (char_length(username) <= 12);
  end if;
end $$;

-- ── 3. Avatars Storage bucket ────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,  -- 2 MB
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do nothing;

-- ── 4. RLS on storage.objects for the avatars bucket ─────────────────────────
-- Objects are stored at <user_id>/avatar (path prefix = their own UUID).

-- Public read (avatars are public)
drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable" on storage.objects
  for select using (bucket_id = 'avatars');

-- Insert: users may only upload into their own folder
drop policy if exists "Users can upload own avatar" on storage.objects;
create policy "Users can upload own avatar" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Update: users may only overwrite their own avatar
drop policy if exists "Users can update own avatar" on storage.objects;
create policy "Users can update own avatar" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Delete: users may only remove their own avatar
drop policy if exists "Users can delete own avatar" on storage.objects;
create policy "Users can delete own avatar" on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
