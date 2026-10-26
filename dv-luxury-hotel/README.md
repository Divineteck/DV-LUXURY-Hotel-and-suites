# DV-LUXURY Hotel and Suites — Supabase-connected starter

This package adds guest account sign-up/login, guest booking history, Supabase booking inserts, and a staff-only booking dashboard. It is a development starter, not yet a complete production hotel/payment system.

## 1. Configure Supabase in Acode
1. Open `config.js`.
2. Replace `PASTE_YOUR_PROJECT_URL_HERE` with your Supabase Project URL.
3. Replace `PASTE_YOUR_PUBLISHABLE_KEY_HERE` with your Supabase Publishable key.
4. Save. Do not use a secret/service_role key in browser files.

## 2. Run database setup
In Supabase → SQL Editor, run `supabase-setup.sql`. This expects the `bookings` and `staff_users` tables from the earlier setup already exist. If you have not created those tables, stop and create them first.

## 3. Guest sign-up/login
Open `auth.html` in a browser or deploy the folder to a static host. Guest registration uses Supabase Auth. If email confirmation is enabled, the user must click the confirmation email before signing in.

## 4. Staff login
Open `admin.html`. Sign in with the staff Auth user you created earlier. The user must also have a matching row in `public.staff_users`; do not create staff roles from the public website.

## Important limitations
- Guest bookings require the user to sign in. Booking records are stored in Supabase. The guest-facing page can view only its own records under RLS.
- The current public reservation form still asks the guest to enter their name/email/phone; the app does not yet auto-fill these from the signed-in profile.
- Prices shown on the website are demo prices. The client does not set the trusted `amount` field; it remains zero until a secure pricing/payment workflow is built.
- Payments, verified receipts, live room availability, email notifications, password reset UI, and production deployment configuration are not implemented yet. Do not accept real payments or treat a request as confirmed until these are added and tested.
- Test with dummy bookings first.
