# PK AI Tool

This is the Phase 3B implementation of creator profiles, public profile views, following, and referral tracking. The existing Railway environment variable names and application routes are preserved. No owner identity or infrastructure/provider information is included in public profile payloads.

## Railway / persistence

Run `npm install` after deploy so the server-only Supabase SDK is available. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are optional existing deployment settings: if both exist, run `supabase/phase3b-social.sql` in the Supabase SQL editor and profile/network data uses those tables. Otherwise set the existing `DATA_DIR` to a mounted Railway volume; the fallback JSON store supports a single application instance only. Never expose the Supabase service-role key to browser code.

The profile API is wired through the required Node bootstrap (`npm start`):
- `GET/PUT /api/profile/me`
- `GET /api/profile/:slug`
- `POST/DELETE /api/follows/:slug`
- `GET /api/referrals/me`, `POST /api/referrals/track`, and `POST /api/referrals/convert`

Referral conversions are recorded only after the existing paid session reports confirmed paid status. No monetary or credit rewards are issued automatically. Configure `APP_URL` for referral links. Set `DATA_DIR` if using the local single-instance persistence path.
