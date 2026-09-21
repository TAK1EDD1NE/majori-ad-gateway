-- Public listing of configured groups for the verify form.
-- SECURITY DEFINER + explicit column list: exposes level/rotation/label only,
-- never chat_id (RLS on public.groups keeps blocking direct anon reads).
CREATE OR REPLACE FUNCTION public.list_groups()
RETURNS TABLE (level text, rotation text, label text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT g.level, g.rotation, g.label
  FROM public.groups g
  ORDER BY g.level DESC, g.rotation ASC;
$$;

REVOKE ALL ON FUNCTION public.list_groups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_groups() TO anon, authenticated;
