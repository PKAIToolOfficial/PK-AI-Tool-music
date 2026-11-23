# PK AI Tool

A responsive web dashboard for AI chat, image generation, voice synthesis, crypto payment submissions, and security/KYC status. The Node.js/Express backend keeps provider secrets on the server and serves the frontend from `public/`.

## Run locally

```sh
npm install
cp .env.example .env
# Add provider keys to .env (never commit secrets)
npm start
```

Open `http://localhost:3000`. Node.js 20+ is recommended. `npm run check` performs syntax checks.

## Deploy on Railway

Connect this GitHub repository and deploy with the included `railway.json`; the service runs `npm start` and listens on `PORT`. Add provider keys in Railway **Variables**—never place them in frontend code or commit them. For persistent sessions/payment submissions, attach a Railway Volume and set `DATA_DIR` to its mount path. The default local filesystem can be ephemeral on hosted platforms; for multi-instance production use a managed database and shared session store.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `GROQ_API_KEY` | Groq chat with automatic model fallback |
| `GOOGLE_AI_STUDIO_API_KEY` or `GEMINI_API_KEY` | Gemini chat fallback |
| `DEEPSEEK_API_KEY` | DeepSeek chat fallback |
| `OPENAI_API_KEY` | Chat fallback, image generation, and voice fallback |
| `ELEVENLABS_API_KEY` | Voice generation (preferred when configured) |
| `ELEVENLABS_VOICE_ID` | Optional ElevenLabs voice ID |
| `REPLICATE_API_TOKEN`, `HUGGINGFACE_API_TOKEN`, `NOIZ_API_KEY` | Detected and reported; additional provider-specific integrations can be added when their model/API requirements are selected |
| `WALLET_USDT_ERC20`, `WALLET_TRX_TRC20`, `WALLET_BTC`, `WALLET_ETH_ERC20`, `WALLET_BNB_BEP20` | Public deposit addresses for crypto payment instructions |
| `DATA_DIR` | Persistent writable directory for session and payment records |
| `CORS_ORIGIN` | Optional comma-separated allowed origins; unset allows cross-origin requests |
| `PORT` | Listening port (Railway sets this automatically) |

## API

- `GET /api/health` — service status, provider readiness, wallets, and current session.
- `GET /api/session/:sessionId` — session status (requires matching `x-session-token`).
- `POST /api/route` — `{ "action": "chat|image|voice", "prompt": "..." }`.
- `GET /api/payments/crypto` — configured wallet addresses.
- `POST /api/payments/crypto` — `{ "network": "BTC", "txid": "..." }`; records a **pending** manual review, never grants credits based only on a user-supplied TxID.
- `GET|POST /api/security/kyc` — status and safe unavailable response. KYC document collection is intentionally disabled until a compliant identity provider is integrated.

The app does not claim that a crypto payment or identity is verified when no verification service is connected. Payment submissions remain pending and require independent operator review. Do not use the built-in JSON store for multi-instance/high-volume deployments; use a managed database before scaling horizontally.
