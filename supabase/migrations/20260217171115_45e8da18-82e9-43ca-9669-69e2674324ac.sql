-- Update admin user email and password
-- Note: This uses Supabase's auth.users table admin update
SELECT auth.uid(); -- placeholder, actual update below

-- Update email
UPDATE auth.users 
SET email = 'admin@orlandoeventvenue.org',
    raw_app_meta_data = raw_app_meta_data || '{"provider":"email","providers":["email"]}'::jsonb,
    raw_user_meta_data = raw_user_meta_data || '{}'::jsonb,
    encrypted_password = crypt('Orla123$%^', gen_salt('bf')),
    email_confirmed_at = now(),
    updated_at = now()
WHERE id = 'ed7baf6b-ad58-4b2a-887e-3e78595f9984';