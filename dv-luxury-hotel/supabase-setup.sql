-- Run this SQL in Supabase SQL Editor after the existing bookings and staff_users tables exist.
-- This adds guest ownership and safe guest self-service access.

alter table public.bookings
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Existing policies from the previous setup can remain. These policies add guest access for their own bookings.
create policy "Guests can view their own bookings"
on public.bookings for select to authenticated
using (user_id = auth.uid());

create policy "Guests can create their own bookings"
on public.bookings for insert to authenticated
with check (
  user_id = auth.uid()
  and status = 'pending'
  and payment_status = 'unpaid'
  and amount = 0
  and payment_reference is null
);

-- Guests may only see their own records. Staff access remains governed by the staff policy already created.
