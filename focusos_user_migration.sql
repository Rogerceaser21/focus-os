-- ============================================================
-- FocusOS User Migration Script
-- Run this in your NEW Supabase project's SQL Editor (mshlbsgsyzzfxyxramjj)
-- This creates all 16 users with their original UUIDs
-- ============================================================

-- Step 1: Disable focusos auto-creation triggers so we don't get duplicate profiles/onboarding data
DROP TRIGGER IF EXISTS focusos_on_auth_user_created_profile ON auth.users;
DROP TRIGGER IF EXISTS focusos_on_auth_user_created_onboarding ON auth.users;
DROP TRIGGER IF EXISTS focusos_on_auth_user_created_registration ON auth.users;

-- Step 2: Insert all 16 users into auth.users
-- Password is set to a dummy bcrypt hash — users will need to use "Forgot Password" to set a new one
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, last_sign_in_at,
  confirmation_token, recovery_token, email_change_token_new,
  raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user
) VALUES
-- 1. t.oliva@outlook.es
('00000000-0000-0000-0000-000000000000', '4f97eb51-30fb-4cb0-b82e-10b40eea090e', 'authenticated', 'authenticated',
 't.oliva@outlook.es', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2026-01-29T15:17:01.900747Z', '2026-01-29T15:17:01.776084Z', '2026-02-25T13:27:34.773445Z', '2026-01-29T15:17:01.929667Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 2. stephenjames7025@hotmail.co.uk
('00000000-0000-0000-0000-000000000000', '6a1e1a18-d517-4864-a850-245f1f409757', 'authenticated', 'authenticated',
 'stephenjames7025@hotmail.co.uk', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2026-01-13T04:04:27.00198Z', '2026-01-13T04:04:26.874382Z', '2026-01-26T09:44:49.412986Z', '2026-01-13T04:04:27.026367Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 3. charlotte.hilton@ais.ae
('00000000-0000-0000-0000-000000000000', 'cb0f9ba7-cbbf-458e-9cbd-7ab047352a8c', 'authenticated', 'authenticated',
 'charlotte.hilton@ais.ae', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2026-01-11T05:54:36.544101Z', '2026-01-11T05:54:36.425923Z', '2026-01-27T02:57:57.079537Z', '2026-01-26T04:07:48.113866Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 4. toby.ayres@gmail.com
('00000000-0000-0000-0000-000000000000', 'c256a26d-5daf-42d9-a34b-8070b8b8decf', 'authenticated', 'authenticated',
 'toby.ayres@gmail.com', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2026-01-04T13:23:16.462857Z', '2026-01-04T13:23:16.337101Z', '2026-01-04T13:23:16.533625Z', '2026-01-04T13:23:16.477405Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 5. jasmina.sesar1@outlook.com
('00000000-0000-0000-0000-000000000000', '4b27bb68-0c45-4fcd-96d2-41f3d22ac2e3', 'authenticated', 'authenticated',
 'jasmina.sesar1@outlook.com', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2025-12-28T04:31:18.373119Z', '2025-12-28T04:31:18.250488Z', '2025-12-28T05:50:31.958452Z', '2025-12-28T04:31:18.390892Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 6. boyd.telford@ais.ae
('00000000-0000-0000-0000-000000000000', '9ad083ff-2a17-4a8b-a309-5b8894e10126', 'authenticated', 'authenticated',
 'boyd.telford@ais.ae', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2025-12-11T13:47:21.795461Z', '2025-12-11T13:47:21.707515Z', '2025-12-11T15:55:10.846476Z', '2025-12-11T13:47:21.807578Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 7. arezoo.alavi@gmail.com
('00000000-0000-0000-0000-000000000000', '137f60f8-c870-44a8-87f7-5e202cf9c65b', 'authenticated', 'authenticated',
 'arezoo.alavi@gmail.com', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2025-12-09T12:06:16.247512Z', '2025-12-09T12:06:16.207309Z', '2025-12-22T09:54:58.227155Z', '2025-12-13T16:27:41.776119Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 8. sara.seifen@ais.ae
('00000000-0000-0000-0000-000000000000', '35c41be3-1a20-450a-ae0f-0cfb9d7822ed', 'authenticated', 'authenticated',
 'sara.seifen@ais.ae', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2025-11-24T06:17:26.48634Z', '2025-11-24T06:17:26.472081Z', '2025-11-25T07:58:43.768562Z', '2025-11-25T07:58:43.686408Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 9. alisja.debruyn@ais.ae
('00000000-0000-0000-0000-000000000000', 'd78e4c0a-bcdc-4c93-9a3f-2d0f68665409', 'authenticated', 'authenticated',
 'alisja.debruyn@ais.ae', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2025-11-24T06:16:13.432151Z', '2025-11-24T06:16:13.405051Z', '2025-11-24T06:16:13.451181Z', '2025-11-24T06:16:13.442751Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 10. lauren.jordaan@ais.ae
('00000000-0000-0000-0000-000000000000', 'd0eb1596-7704-4bdf-b2de-a96d96172677', 'authenticated', 'authenticated',
 'lauren.jordaan@ais.ae', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2025-11-24T06:11:53.191069Z', '2025-11-24T06:11:53.152268Z', '2025-11-24T06:14:46.26387Z', '2025-11-24T06:14:46.258635Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 11. odene.truter@ais.ae
('00000000-0000-0000-0000-000000000000', '6b5a4910-b0ef-4926-9554-c9b3a460b111', 'authenticated', 'authenticated',
 'odene.truter@ais.ae', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2025-11-19T11:47:48.692009Z', '2025-11-19T11:47:48.609843Z', '2026-01-20T12:13:31.966644Z', '2025-11-19T11:53:17.374388Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 12. brooke.pickett@ais.ae
('00000000-0000-0000-0000-000000000000', '4feaa2b6-73b0-4e42-ad6a-301c2c38a561', 'authenticated', 'authenticated',
 'brooke.pickett@ais.ae', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2025-11-17T06:36:03.059284Z', '2025-11-17T06:36:03.016416Z', '2025-12-11T16:25:54.835652Z', '2025-12-09T11:47:42.459223Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 13. andrew.brown@ais.ae
('00000000-0000-0000-0000-000000000000', '37682c71-cc67-4c17-bf65-0a5d33c6cc43', 'authenticated', 'authenticated',
 'andrew.brown@ais.ae', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2025-11-11T04:06:00.40433Z', '2025-11-11T04:06:00.32066Z', '2025-11-17T03:09:57.836171Z', '2025-11-11T04:06:00.42132Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 14. ava.alavi@gmail.com
('00000000-0000-0000-0000-000000000000', 'c5ba00c7-c167-4644-b8fe-4db632cb251e', 'authenticated', 'authenticated',
 'ava.alavi@gmail.com', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2025-11-01T14:47:42.781958Z', '2025-11-01T14:47:42.760769Z', '2026-03-09T06:24:21.852047Z', '2026-03-09T06:24:21.847926Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 15. igor.sesar@ais.ae
('00000000-0000-0000-0000-000000000000', '774d56f9-f81b-46c6-9a1f-30c94e244cd8', 'authenticated', 'authenticated',
 'igor.sesar@ais.ae', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2025-11-01T12:43:12.902815Z', '2025-11-01T12:43:12.843187Z', '2026-03-10T09:57:03.348275Z', '2026-03-09T08:20:54.234974Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false),

-- 16. toby.ayres@ais.ae
('00000000-0000-0000-0000-000000000000', 'fc803ed5-0c10-449f-b3d9-a1122c0a9c11', 'authenticated', 'authenticated',
 'toby.ayres@ais.ae', '$2a$10$PznXtItQlMGSxWkFHaGMOOLGHPNjHPGBsNEEIBJTgqVehOrYL3S9G',
 '2026-03-06T08:03:01.56639Z', '2026-03-06T08:03:01.535479Z', '2026-03-06T13:48:25.248641Z', '2026-03-06T08:19:50.481573Z',
 '', '', '', '{"provider":"email","providers":["email"]}', '{}', false, false);

-- Step 3: Insert matching auth.identities rows (required for email login to work)
INSERT INTO auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) VALUES
('4f97eb51-30fb-4cb0-b82e-10b40eea090e', '4f97eb51-30fb-4cb0-b82e-10b40eea090e', 't.oliva@outlook.es', 'email',
 jsonb_build_object('sub', '4f97eb51-30fb-4cb0-b82e-10b40eea090e', 'email', 't.oliva@outlook.es', 'email_verified', true),
 '2026-01-29T15:17:01.929667Z', '2026-01-29T15:17:01.776084Z', '2026-02-25T13:27:34.773445Z'),

('6a1e1a18-d517-4864-a850-245f1f409757', '6a1e1a18-d517-4864-a850-245f1f409757', 'stephenjames7025@hotmail.co.uk', 'email',
 jsonb_build_object('sub', '6a1e1a18-d517-4864-a850-245f1f409757', 'email', 'stephenjames7025@hotmail.co.uk', 'email_verified', true),
 '2026-01-13T04:04:27.026367Z', '2026-01-13T04:04:26.874382Z', '2026-01-26T09:44:49.412986Z'),

('cb0f9ba7-cbbf-458e-9cbd-7ab047352a8c', 'cb0f9ba7-cbbf-458e-9cbd-7ab047352a8c', 'charlotte.hilton@ais.ae', 'email',
 jsonb_build_object('sub', 'cb0f9ba7-cbbf-458e-9cbd-7ab047352a8c', 'email', 'charlotte.hilton@ais.ae', 'email_verified', true),
 '2026-01-26T04:07:48.113866Z', '2026-01-11T05:54:36.425923Z', '2026-01-27T02:57:57.079537Z'),

('c256a26d-5daf-42d9-a34b-8070b8b8decf', 'c256a26d-5daf-42d9-a34b-8070b8b8decf', 'toby.ayres@gmail.com', 'email',
 jsonb_build_object('sub', 'c256a26d-5daf-42d9-a34b-8070b8b8decf', 'email', 'toby.ayres@gmail.com', 'email_verified', true),
 '2026-01-04T13:23:16.477405Z', '2026-01-04T13:23:16.337101Z', '2026-01-04T13:23:16.533625Z'),

('4b27bb68-0c45-4fcd-96d2-41f3d22ac2e3', '4b27bb68-0c45-4fcd-96d2-41f3d22ac2e3', 'jasmina.sesar1@outlook.com', 'email',
 jsonb_build_object('sub', '4b27bb68-0c45-4fcd-96d2-41f3d22ac2e3', 'email', 'jasmina.sesar1@outlook.com', 'email_verified', true),
 '2025-12-28T04:31:18.390892Z', '2025-12-28T04:31:18.250488Z', '2025-12-28T05:50:31.958452Z'),

('9ad083ff-2a17-4a8b-a309-5b8894e10126', '9ad083ff-2a17-4a8b-a309-5b8894e10126', 'boyd.telford@ais.ae', 'email',
 jsonb_build_object('sub', '9ad083ff-2a17-4a8b-a309-5b8894e10126', 'email', 'boyd.telford@ais.ae', 'email_verified', true),
 '2025-12-11T13:47:21.807578Z', '2025-12-11T13:47:21.707515Z', '2025-12-11T15:55:10.846476Z'),

('137f60f8-c870-44a8-87f7-5e202cf9c65b', '137f60f8-c870-44a8-87f7-5e202cf9c65b', 'arezoo.alavi@gmail.com', 'email',
 jsonb_build_object('sub', '137f60f8-c870-44a8-87f7-5e202cf9c65b', 'email', 'arezoo.alavi@gmail.com', 'email_verified', true),
 '2025-12-13T16:27:41.776119Z', '2025-12-09T12:06:16.207309Z', '2025-12-22T09:54:58.227155Z'),

('35c41be3-1a20-450a-ae0f-0cfb9d7822ed', '35c41be3-1a20-450a-ae0f-0cfb9d7822ed', 'sara.seifen@ais.ae', 'email',
 jsonb_build_object('sub', '35c41be3-1a20-450a-ae0f-0cfb9d7822ed', 'email', 'sara.seifen@ais.ae', 'email_verified', true),
 '2025-11-25T07:58:43.686408Z', '2025-11-24T06:17:26.472081Z', '2025-11-25T07:58:43.768562Z'),

('d78e4c0a-bcdc-4c93-9a3f-2d0f68665409', 'd78e4c0a-bcdc-4c93-9a3f-2d0f68665409', 'alisja.debruyn@ais.ae', 'email',
 jsonb_build_object('sub', 'd78e4c0a-bcdc-4c93-9a3f-2d0f68665409', 'email', 'alisja.debruyn@ais.ae', 'email_verified', true),
 '2025-11-24T06:16:13.442751Z', '2025-11-24T06:16:13.405051Z', '2025-11-24T06:16:13.451181Z'),

('d0eb1596-7704-4bdf-b2de-a96d96172677', 'd0eb1596-7704-4bdf-b2de-a96d96172677', 'lauren.jordaan@ais.ae', 'email',
 jsonb_build_object('sub', 'd0eb1596-7704-4bdf-b2de-a96d96172677', 'email', 'lauren.jordaan@ais.ae', 'email_verified', true),
 '2025-11-24T06:14:46.258635Z', '2025-11-24T06:11:53.152268Z', '2025-11-24T06:14:46.26387Z'),

('6b5a4910-b0ef-4926-9554-c9b3a460b111', '6b5a4910-b0ef-4926-9554-c9b3a460b111', 'odene.truter@ais.ae', 'email',
 jsonb_build_object('sub', '6b5a4910-b0ef-4926-9554-c9b3a460b111', 'email', 'odene.truter@ais.ae', 'email_verified', true),
 '2025-11-19T11:53:17.374388Z', '2025-11-19T11:47:48.609843Z', '2026-01-20T12:13:31.966644Z'),

('4feaa2b6-73b0-4e42-ad6a-301c2c38a561', '4feaa2b6-73b0-4e42-ad6a-301c2c38a561', 'brooke.pickett@ais.ae', 'email',
 jsonb_build_object('sub', '4feaa2b6-73b0-4e42-ad6a-301c2c38a561', 'email', 'brooke.pickett@ais.ae', 'email_verified', true),
 '2025-12-09T11:47:42.459223Z', '2025-11-17T06:36:03.016416Z', '2025-12-11T16:25:54.835652Z'),

('37682c71-cc67-4c17-bf65-0a5d33c6cc43', '37682c71-cc67-4c17-bf65-0a5d33c6cc43', 'andrew.brown@ais.ae', 'email',
 jsonb_build_object('sub', '37682c71-cc67-4c17-bf65-0a5d33c6cc43', 'email', 'andrew.brown@ais.ae', 'email_verified', true),
 '2025-11-11T04:06:00.42132Z', '2025-11-11T04:06:00.32066Z', '2025-11-17T03:09:57.836171Z'),

('c5ba00c7-c167-4644-b8fe-4db632cb251e', 'c5ba00c7-c167-4644-b8fe-4db632cb251e', 'ava.alavi@gmail.com', 'email',
 jsonb_build_object('sub', 'c5ba00c7-c167-4644-b8fe-4db632cb251e', 'email', 'ava.alavi@gmail.com', 'email_verified', true),
 '2026-03-09T06:24:21.847926Z', '2025-11-01T14:47:42.760769Z', '2026-03-09T06:24:21.852047Z'),

('774d56f9-f81b-46c6-9a1f-30c94e244cd8', '774d56f9-f81b-46c6-9a1f-30c94e244cd8', 'igor.sesar@ais.ae', 'email',
 jsonb_build_object('sub', '774d56f9-f81b-46c6-9a1f-30c94e244cd8', 'email', 'igor.sesar@ais.ae', 'email_verified', true),
 '2026-03-09T08:20:54.234974Z', '2025-11-01T12:43:12.843187Z', '2026-03-10T09:57:03.348275Z'),

('fc803ed5-0c10-449f-b3d9-a1122c0a9c11', 'fc803ed5-0c10-449f-b3d9-a1122c0a9c11', 'toby.ayres@ais.ae', 'email',
 jsonb_build_object('sub', 'fc803ed5-0c10-449f-b3d9-a1122c0a9c11', 'email', 'toby.ayres@ais.ae', 'email_verified', true),
 '2026-03-06T08:19:50.481573Z', '2026-03-06T08:03:01.535479Z', '2026-03-06T13:48:25.248641Z');

-- Step 4: Re-create the triggers
CREATE TRIGGER focusos_on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_new_user_profile();

CREATE TRIGGER focusos_on_auth_user_created_onboarding
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_new_user_onboarding();

CREATE TRIGGER focusos_on_auth_user_created_registration
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_new_user_registration();

-- Step 5: Insert all 16 users into focusos_users (app-specific registry)
INSERT INTO public.focusos_users (user_id, email, created_at) VALUES
('4f97eb51-30fb-4cb0-b82e-10b40eea090e', 't.oliva@outlook.es', '2026-01-29T15:17:01.776084Z'),
('6a1e1a18-d517-4864-a850-245f1f409757', 'stephenjames7025@hotmail.co.uk', '2026-01-13T04:04:26.874382Z'),
('cb0f9ba7-cbbf-458e-9cbd-7ab047352a8c', 'charlotte.hilton@ais.ae', '2026-01-11T05:54:36.425923Z'),
('c256a26d-5daf-42d9-a34b-8070b8b8decf', 'toby.ayres@gmail.com', '2026-01-04T13:23:16.337101Z'),
('4b27bb68-0c45-4fcd-96d2-41f3d22ac2e3', 'jasmina.sesar1@outlook.com', '2025-12-28T04:31:18.250488Z'),
('9ad083ff-2a17-4a8b-a309-5b8894e10126', 'boyd.telford@ais.ae', '2025-12-11T13:47:21.707515Z'),
('137f60f8-c870-44a8-87f7-5e202cf9c65b', 'arezoo.alavi@gmail.com', '2025-12-09T12:06:16.207309Z'),
('35c41be3-1a20-450a-ae0f-0cfb9d7822ed', 'sara.seifen@ais.ae', '2025-11-24T06:17:26.472081Z'),
('d78e4c0a-bcdc-4c93-9a3f-2d0f68665409', 'alisja.debruyn@ais.ae', '2025-11-24T06:16:13.405051Z'),
('d0eb1596-7704-4bdf-b2de-a96d96172677', 'lauren.jordaan@ais.ae', '2025-11-24T06:11:53.152268Z'),
('6b5a4910-b0ef-4926-9554-c9b3a460b111', 'odene.truter@ais.ae', '2025-11-19T11:47:48.609843Z'),
('4feaa2b6-73b0-4e42-ad6a-301c2c38a561', 'brooke.pickett@ais.ae', '2025-11-17T06:36:03.016416Z'),
('37682c71-cc67-4c17-bf65-0a5d33c6cc43', 'andrew.brown@ais.ae', '2025-11-11T04:06:00.32066Z'),
('c5ba00c7-c167-4644-b8fe-4db632cb251e', 'ava.alavi@gmail.com', '2025-11-01T14:47:42.760769Z'),
('774d56f9-f81b-46c6-9a1f-30c94e244cd8', 'igor.sesar@ais.ae', '2025-11-01T12:43:12.843187Z'),
('fc803ed5-0c10-449f-b3d9-a1122c0a9c11', 'toby.ayres@ais.ae', '2026-03-06T08:03:01.535479Z');

-- ============================================================
-- DONE! 16 users created in auth.users, auth.identities, AND focusos_users.
-- Next steps:
-- 1. Run focusos_combined_migration.sql FIRST to create all focusos_ tables
-- 2. Run this file SECOND to create users
-- 3. Import CSV data into each focusos_ table via Table Editor
-- 4. Users will need to use "Forgot Password" to set new passwords
-- ============================================================
