# PK AI Tool

PK AI Tool is a responsive Node.js/Express web application for AI chat, image generation, speech synthesis, hosted crypto checkout, and identity-verification status. Provider secrets remain server-side.

## Run locally

```sh
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`. Node.js 20+ is required. Run `npm run check` for JavaScript syntax checks.

## Railway deployment

Deploy the repository root with `npm start`; Railway's `PORT` is used and the server binds to `0.0.0.0`. In the Railway service settings, confirm the root directory is blank or `/`, the deployment branch is `main`, and the custom start command does not override `npm start`.

Set provider and integration secrets in Railway Variables. Set `APP_URL` to the public HTTPS domain. Attach a persistent volume and set `DATA_DIR` to its mount path. The included JSON store is for a **single running instance**; it is not safe for multiple replicas or high-volume billing. For horizontal scale, replace it with a managed transactional database before enabling real customer billing.

### AI providers

- Chat failover: `GROQ_API_KEY` (tries two models), `GOOGLE_AI_STUDIO_API_KEY` or `GEMINI_API_KEY` (tries two models), `DEEPSEEK_API_KEY`, then `OPENAI_API_KEY`.
- Images: `OPENAI_API_KEY`; optional `REPLICATE_API_TOKEN` plus `REPLICATE_IMAGE_MODEL` (owner/model), or `HUGGINGFACE_API_TOKEN` plus `HUGGINGFACE_IMAGE_MODEL` as fallbacks. Provider model access, account quota, and API availability are controlled by those vendors.
- Speech: `ELEVENLABS_API_KEY` plus `ELEVENLABS_VOICE_ID`, then `OPENAI_API_KEY` fallback.

`NOIZ_API_KEY` is not wired because no specific Noiz product/API endpoint and model contract was supplied. It is not safe to claim integration from the key alone.

### Payments and identity

- Crypto: set `COINBASE_COMMERCE_API_KEY`, `COINBASE_COMMERCE_WEBHOOK_SECRET`, and `APP_URL`. Configure Coinbase Commerce's webhook to `https://YOUR_DOMAIN/api/webhooks/coinbase` and subscribe to charge events including `charge:confirmed`. A verified confirmation grants the server-defined credits once; browser redirect or TxID submission alone never grants access.
- KYC: set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_URL` (or `KYC_RETURN_URL`). Configure Stripe Identity webhook at `https://YOUR_DOMAIN/api/webhooks/stripe` for `identity.verification_session.verified` and `identity.verification_session.requires_input`. Stripe hosts document collection; check legal, privacy, retention, and regional requirements before enabling it.
- Plans/prices are server-side defaults and can be overridden with `CREATOR_MONTHLY_USD`, `CREATOR_YEARLY_USD`, `STUDIO_MONTHLY_USD`, and `STUDIO_YEARLY_USD`.

Do not put secrets in frontend files or commit them. The app does not promise zero errors or uninterrupted operation: vendor outages, quota, network failures, deployment configuration, and compliance can still affect service. Keep a support/monitoring process and test webhooks in provider sandboxes before live sales.

## API

- `GET /api/health` — application, provider and integration configuration (never returns keys).
- `POST /api/route` — `{ "action": "chat|image|voice", "prompt": "..." }`.
- `GET /api/payments/crypto` — supported plans, configured wallets, checkout readiness.
- `POST /api/payments/crypto` — `{ "plan": "creator_monthly" }`, creates a hosted Coinbase Commerce checkout.
- `POST /api/webhooks/coinbase` — verifies signed charge events and applies confirmed plan credits idempotently.
- `GET|POST /api/security/kyc` — status / creates a Stripe Identity session.
- `POST /api/webhooks/stripe` — signature-verified KYC state updates.
- `GET /api/session/:sessionId` — own session and payment status (requires matching `x-session-token`).

The included services are a focused launch foundation, not every AI category. Music/video generation, Noiz, OAuth login, admin operations, taxes, refunds, and multi-tenant company/government controls require their own selected vendors, product requirements, and security review before advertising them as available.
