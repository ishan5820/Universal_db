-- Universal_db enables RLS automatically for newly-created public tables by
-- means of this platform-provisioned event-trigger function. Event triggers do
-- not require browser roles to execute their handler directly, so remove the
-- default PUBLIC function grant flagged by the Security Advisor.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
