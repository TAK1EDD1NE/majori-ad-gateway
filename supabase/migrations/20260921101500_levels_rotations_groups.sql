-- Levels + rotations + per-group Telegram chat ids
CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level text NOT NULL,            -- '4' | '3'
  rotation text NOT NULL,         -- 'rot1' | 'rot2' | 'rot3'
  label text NOT NULL,            -- display label, e.g. '4e année — Rotation 1'
  chat_id text NOT NULL,          -- Telegram group chat id (e.g. -100...)
  UNIQUE (level, rotation)
);
GRANT ALL ON public.groups TO service_role;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.students
  ADD COLUMN level text,
  ADD COLUMN rotation text;

CREATE INDEX students_level_rotation_idx ON public.students (level, rotation);
