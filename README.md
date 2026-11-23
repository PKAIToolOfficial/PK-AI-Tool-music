# PK AI Tool

Node.js 20+ / Express application. Supabase is the single source of truth for sessions, credits, payment and KYC records. Provider secrets are only read by the server.

## Deploy / start
1. Create a Supabase project and run [`supabase/schema.sql`](supabase/schema.sql) in its SQL Editor.
2. In Railway, deploy the repository root with `npm start` and set `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY`. The service listens on Railway's `PORT` at `0.0.0.0`.
3. Set only provider variables needed for features you intend to use. Optional integrations do not prevent app startup. Never put secrets in frontend files.
4. Check `GET /api/health` for configured integration booleans. Missing provider model IDs disable only that integration.

Supabase service-role access bypasses RLS and must stay server-side. The schema enables RLS with no browser policies; all data access goes through this server. `DATA_DIR` is retained as a compatibility setting but Supabase is the only persistence source; no local JSON or secondary database writes occur.

## Features and constraints
- Chat: Groq model rotation, Gemini model rotation, DeepSeek and OpenAI fallback.
- Image: OpenAI, Fal.ai, Replicate, Hugging Face fallback. Video: configured Fal.ai then Replicate model. Fal/Replicate output is saved to R2 if configured; otherwise provider URL is returned.
- Voice: ElevenLabs, Fish Audio, then OpenAI TTS. Soundverse and Noiz are opt-in custom endpoint hooks (`*_API_URL`, key and model); Auphonic is an opt-in preset-based processing hook. Confirm exact endpoint/payload with the vendor account; unavailable optional integrations return a clear service error, not fake output.
- Crypto: configured deposit wallets are displayed. BTC/ETH transaction verification checks BlockCypher output recipient/value and configured confirmation count. Expected amount values are in smallest native units (BTC satoshis, ETH wei), keyed in `CRYPTO_EXPECTED_AMOUNTS_JSON`, e.g. `{ "BTC:creator_monthly":"12345", "ETH:creator_monthly":"5000000000000000" }`. The SQL RPC atomically grants credits only once for a verified payment. USDT ERC-20, TRX/TRC20 and BNB/BEP20 remain pending manual review; do not treat an ETH transfer as USDT. `BLOCKCYPHER_TOKEN` and wallet/amount config are required for automatic native BTC/ETH verification. Ensure the price-to-amount mapping, chain and wallet are checked before accepting money.
- KYC: Stripe Identity session generation and status storage. Stripe webhook signature validation is required to reflect completed verification.
- Web ads: readiness configuration is provided for AdSense; AdMob is not used in the web page. Google AdSense approval and policy compliance remain required.

## Webhooks
Configure Stripe webhook URL `https://YOUR_DOMAIN/api/webhooks/stripe`, subscribe to `identity.verification_session.verified` and `identity.verification_session.requires_input`, then set the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`. Coinbase is no longer needed for the implemented direct-wallet crypto flow.

## API
`GET /api/health`, `GET /api/session/:id`, `POST /api/route` (`chat|image|video|voice|music|audio_enhance|noiz`), `GET|POST /api/payments/crypto`, `GET|POST /api/security/kyc`, `POST /api/webhooks/stripe`.

## Railway variables
See `.env.example` for the complete variable names. At minimum, configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; then configure provider-specific keys/model IDs, deposit wallets, prices/expected amounts, Stripe Identity, R2 and AdSense as applicable. No guarantee of uninterrupted service is possible; provider quota, outages, account approval, and chain explorer limits apply.
