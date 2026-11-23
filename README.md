# PK AI Tool

This Node.js/Express service deploys from the repository root on Railway with `npm start` and binds to the Railway-provided `PORT` on `0.0.0.0`. Railway health checks use `/healthz`. `npm run check` runs syntax checks for the server and Phase 2/3 extension modules.

The startup bootstrap loads the security, paid workspace/team, and profile/referral middleware and injects their browser assets while leaving the existing main server routes intact. Configure `DATA_DIR` as a mounted persistent volume for profile and workspace JSON persistence. Existing sessions remain process-local, so run one Railway instance until session storage is moved to a shared database. For Supabase-backed profiles, set the already documented `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` variables, then run `supabase/phase3b-social.sql` in the Supabase SQL editor. No new required Railway variables were introduced.

External workspace destinations open as normal HTTPS links; they are not proxied or embedded. Team invitations are copyable, single-use, time-limited URLs; no outbound email service is assumed. Media provider keys alone do not enable music or FFmpeg pipelines in this repository; configure a supported media integration before advertising those workflows as active.
