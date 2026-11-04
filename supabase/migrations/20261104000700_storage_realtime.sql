-- =============================================================================
-- Spotter · 007 · Storage buckets & policies, Realtime publication
-- =============================================================================
-- Files are stored in Supabase Storage, never in Postgres. Every object lives under
-- a folder named after its owner: <bucket>/<auth.uid()>/<random-uuid>.<ext>
--
--   bucket            public?  limit   used for                     URL type
--   profile-images    yes      5 MB    avatars                      public URL
--   community-images  yes      5 MB    community covers             public URL
--   post-media        no       50 MB   post photos & videos         signed URL
--   story-media       no       50 MB   story photos & videos        signed URL
--
-- Private buckets can only be read (and signed) by users allowed to see the post or
-- story that references the file — the policies below reuse the table RLS rules.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-images',   'profile-images',   true,  5242880,  array['image/jpeg', 'image/png', 'image/webp']),
  ('community-images', 'community-images', true,  5242880,  array['image/jpeg', 'image/png', 'image/webp']),
  ('post-media',       'post-media',       false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']),
  ('story-media',      'story-media',      false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Write access: only inside your own folder, only in Spotter buckets.
create policy "spotter media: upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id in ('profile-images', 'community-images', 'post-media', 'story-media')
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "spotter media: replace own files" on storage.objects for update to authenticated
  using (bucket_id in ('profile-images', 'community-images', 'post-media', 'story-media')
         and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id in ('profile-images', 'community-images', 'post-media', 'story-media')
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "spotter media: delete own files" on storage.objects for delete to authenticated
  using (bucket_id in ('profile-images', 'community-images', 'post-media', 'story-media')
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Read access ---------------------------------------------------------------------
create policy "spotter media: public images readable" on storage.objects for select to authenticated
  using (bucket_id in ('profile-images', 'community-images'));

-- Post media: the owner, or anyone who can see a post that uses this file
-- (public.post_media RLS → public.posts RLS → visibility/followers/community rules).
create policy "spotter media: post media follows post visibility" on storage.objects for select to authenticated
  using (bucket_id = 'post-media'
         and ((storage.foldername(name))[1] = (select auth.uid())::text
              or exists (select 1 from public.post_media pm where pm.storage_path = objects.name)));

-- Story media: the owner, or anyone who can see an UNEXPIRED story using this file.
create policy "spotter media: story media follows story visibility" on storage.objects for select to authenticated
  using (bucket_id = 'story-media'
         and ((storage.foldername(name))[1] = (select auth.uid())::text
              or exists (select 1 from public.stories s where s.media_path = objects.name)));

-- -----------------------------------------------------------------------------
-- Realtime: only the tables the UI listens to. RLS is applied to every change
-- event, and the client always subscribes with a narrow filter.
--   notifications  → recipient_id=eq.<me>      (unread badge, Activity screen)
--   comments       → post_id=eq.<post>         (live comment threads)
--   posts          → id=in.(<visible ids>)     (live like / comment counters)
--                    user_id=in.(<following>)  ("new posts" pill on the feed)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.comments, public.posts;
  end if;
end $$;
