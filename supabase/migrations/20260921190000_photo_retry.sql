-- Photos must never block a student's invite: if the card upload fails, the
-- verification continues and the student is flagged so the admin knows the
-- card is missing and why (see verify.functions.ts — invite-first flow).
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS photo_missing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photo_error text;