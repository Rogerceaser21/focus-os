DROP POLICY IF EXISTS "Allow anonymous read access to app_configuration" ON public.app_configuration;

REVOKE SELECT ON public.app_configuration FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_app_configuration() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_app_configuration() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_app_configuration() FROM authenticated;

GRANT ALL ON public.app_configuration TO service_role;
GRANT EXECUTE ON FUNCTION public.get_app_configuration() TO service_role;