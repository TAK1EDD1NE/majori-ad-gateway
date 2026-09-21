CREATE TABLE public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  prenom text NOT NULL,
  joined boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX students_nom_prenom_idx ON public.students (lower(btrim(nom)), lower(btrim(prenom)));
GRANT ALL ON public.students TO service_role;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_attempts_ip_created_idx ON public.verification_attempts (ip, created_at DESC);
GRANT ALL ON public.verification_attempts TO service_role;
ALTER TABLE public.verification_attempts ENABLE ROW LEVEL SECURITY;