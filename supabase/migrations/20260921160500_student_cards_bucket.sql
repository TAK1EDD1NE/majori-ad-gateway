-- Private bucket for uploaded student-card photos.
-- Private (public = false): readable only via the service role (admin review),
-- never by anon clients. Verify function uploads to {student_id}/{timestamp}.{ext}.
INSERT INTO storage.buckets (id, name, public)
VALUES ('student-cards', 'student-cards', false)
ON CONFLICT (id) DO NOTHING;
