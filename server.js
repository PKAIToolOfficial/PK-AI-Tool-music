import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { loadStore, saveStore } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const store = await loadStore();
const sessions = store.sessions;
const payments = store.payments;
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const production = process.env.NODE_ENV === "production";
const wallets = {
  "USDT (ERC20)": process.env.WALLET_USDT_ERC20 || "",
  "TRX (TRC20)": process.env.WALLET_TRX_TRC20 || "",
  BTC: process.env.WALLET_BTC || "",
  "ETH (ERC20)": process.env.WALLET_ETH_ERC20 || "",
  "BNB (BEP20)": process.env.WALLET_BNB_BEP20 || ""
};
const providers = {
  groq: process.env.GROQ_API_KEY,
  google: process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GEMINI_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  deepseek: process.env.DEEPSEEK_API_KEY,
  replicate: process.env.REPLICATE_API_TOKEN,
  huggingface: process.env.HUGGINGFACE_API_TOKEN || process.env.HF_API_TOKEN,
  elevenlabs: process.env.ELEVENLABS_API_KEY
};
const catalog = {
  creator_monthly: { name: "Creator Monthly", amount: Number(process.env.CREATOR_MONTHLY_USD) || 8, credits: 500 },
  creator_yearly: { name: "Creator Yearly", amount: Number(process.env.CREATOR_YEARLY_USD) || 76.8, credits: 6000 },
  studio_monthly: { name: "Studio Monthly", amount: Number(process.env.STUDIO_MONTHLY_USD) || 24, credits: 2000 },
  studio_yearly: { name: "Studio Yearly", amount: Number(process.env.STUDIO_YEARLY_USD) || 230.4, credits: 24000 }
};

app.disable("x-powered-by");
app.set("trust proxy", 1);
const allowedOrigins = process.env.CORS_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins?.length ? allowedOrigins : production ? false : true }));
// Provider webhooks require the original, unparsed request bytes for signature validation.
app.post("/api/webhooks/coinbase", express.raw({ type: "application/json", limit: "1mb" }), handleCoinbaseWebhook);
app.post("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), handleStripeWebhook);
app.use(express.json({ limit: process.env.MAX_BODY_SIZE || "1mb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: production ? "1h" : 0, index: "index.html" }));

let persistChain = Promise.resolve();
function persist() {
  persistChain = persistChain.then(() => saveStore({ sessions, payments })).catch((error) => {
    console.error("Persistent store write failed:", error.message);
  });
  return persistChain;
}
function sessionFor(req) {
  const token = String(req.get("x-session-token") || "").trim();
  if (/^[a-f0-9]{48}$/i.test(token) && sessions[token]) return sessions[token];
  const newToken = crypto.randomBytes(24).toString("hex");
  sessions[newToken] = { token: newToken, credits: 50, plan: "Free", createdAt: new Date().toISOString(), kycStatus: "not_started", tracks: [] };
  void persist();
  return sessions[newToken];
}
function safeSession(s) {
  return { token: s.token, credits: s.credits, plan: s.plan, createdAt: s.createdAt, kycStatus: s.kycStatus || "not_started" };
}
function providerStatus() {
  return {
    details: {
      groq: Boolean(providers.groq), googleAIStudio: Boolean(providers.google), gemini: Boolean(providers.google),
      openai: Boolean(providers.openai), deepseek: Boolean(providers.deepseek), replicate: Boolean(providers.replicate),
      huggingface: Boolean(providers.huggingface), elevenlabs: Boolean(providers.elevenlabs), stripe: Boolean(stripe),
      coinbaseCommerce: Boolean(process.env.COINBASE_COMMERCE_API_KEY)
    }
  };
}
async function fetchWithTimeout(url, options = {}, timeout = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
async function compatibleChat(base, key, model, messages) {
  const response = await fetchWithTimeout(`${base}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0.7 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Provider HTTP ${response.status}`);
  const result = data.choices?.[0]?.message?.content;
  if (!result) throw new Error("Provider returned no text");
  return result;
}
async function googleChat(model, key, messages) {
  const contents = messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] }));
  const system = messages.find((message) => message.role === "system")?.content;
  const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Google AI HTTP ${response.status}`);
  const result = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!result) throw new Error("Google AI returned no text");
  return result;
}
async function routeChat(prompt, history = []) {
  const messages = [
    { role: "system", content: "You are PK AI Tool, a capable, helpful creative and professional assistant. Be accurate, clear, and respectful." },
    ...history.slice(-10).filter((item) => ["user", "assistant"].includes(item.role) && typeof item.content === "string").map((item) => ({ role: item.role, content: item.content.slice(0, 8000) })),
    { role: "user", content: prompt }
  ];
  const attempts = [];
  if (providers.groq) for (const model of ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]) attempts.push(() => compatibleChat("https://api.groq.com/openai/v1", providers.groq, model, messages));
  if (providers.google) for (const model of ["gemini-2.5-flash", "gemini-2.0-flash"]) attempts.push(() => googleChat(model, providers.google, messages));
  if (providers.deepseek) attempts.push(() => compatibleChat("https://api.deepseek.com/v1", providers.deepseek, "deepseek-chat", messages));
  if (providers.openai) attempts.push(() => compatibleChat("https://api.openai.com/v1", providers.openai, "gpt-4o-mini", messages));
  if (!attempts.length) throw Object.assign(new Error("Chat is not configured. Add a supported LLM key in Railway Variables."), { status: 503 });
  for (const attempt of attempts) { try { return await attempt(); } catch (error) { console.warn("AI provider attempt failed:", error.message); } }
  throw Object.assign(new Error("AI providers are temporarily unavailable. Please try again."), { status: 502 });
}
async function generateImage(prompt, size) {
  if (providers.openai) {
    const response = await fetchWithTimeout("https://api.openai.com/v1/images/generations", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${providers.openai}` },
      body: JSON.stringify({ model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1", prompt, size })
    }, 90000);
    const data = await response.json().catch(() => ({}));
    if (response.ok && (data.data?.[0]?.url || data.data?.[0]?.b64_json)) return data.data[0].url || `data:image/png;base64,${data.data[0].b64_json}`;
    console.warn("OpenAI image attempt failed:", data?.error?.message || response.status);
  }
  if (providers.replicate && process.env.REPLICATE_IMAGE_MODEL) {
    const response = await fetchWithTimeout(`https://api.replicate.com/v1/models/${process.env.REPLICATE_IMAGE_MODEL}/predictions`, {
      method: "POST", headers: { authorization: `Bearer ${providers.replicate}`, "content-type": "application/json", Prefer: "wait=60" },
      body: JSON.stringify({ input: { prompt, aspect_ratio: size === "1536x1024" ? "landscape_4_3" : size === "1024x1536" ? "portrait_4_3" : "1:1" } })
    }, 90000);
    const data = await response.json().catch(() => ({}));
    if (response.ok && (data.output?.[0] || data.output)) return Array.isArray(data.output) ? data.output[0] : data.output;
    console.warn("Replicate image attempt failed:", data?.detail || response.status);
  }
  if (providers.huggingface && process.env.HUGGINGFACE_IMAGE_MODEL) {
    const response = await fetchWithTimeout(`https://router.huggingface.co/hf-inference/models/${encodeURIComponent(process.env.HUGGINGFACE_IMAGE_MODEL)}`, {
      method: "POST", headers: { authorization: `Bearer ${providers.huggingface}`, "content-type": "application/json", accept: "image/png" }, body: JSON.stringify({ inputs: prompt })
    }, 90000);
    if (response.ok) return `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
    console.warn("Hugging Face image attempt failed:", response.status);
  }
  throw Object.assign(new Error("Image generation failed or is not configured. Configure OPENAI_API_KEY, or set a supported Replicate/Hugging Face image model."), { status: 503 });
}
async function generateVoice(text) {
  if (providers.elevenlabs) {
    const voiceId = process.env.ELEVENLABS_VOICE_ID;
    if (voiceId) {
      const response = await fetchWithTimeout(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: "POST", headers: { "content-type": "application/json", "xi-api-key": providers.elevenlabs, accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" })
      }, 90000);
      if (response.ok) return `data:audio/mpeg;base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
      console.warn("ElevenLabs attempt failed:", response.status);
    }
  }
  if (providers.openai) {
    const response = await fetchWithTimeout("https://api.openai.com/v1/audio/speech", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${providers.openai}` },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "mp3" })
    }, 90000);
    if (response.ok) return `data:audio/mpeg;base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
    console.warn("OpenAI voice attempt failed:", response.status);
  }
  throw Object.assign(new Error("Voice generation is unavailable. Configure ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID, or OPENAI_API_KEY."), { status: 503 });
}

app.get("/api/health", (req, res) => {
  const session = sessionFor(req);
  res.json({ ok: true, service: "PK AI Tool", timestamp: new Date().toISOString(), providers: providerStatus(), session: safeSession(session), wallets: Object.fromEntries(Object.entries(wallets).map(([name, value]) => [name, value || null])), integrations: { cryptoCheckout: Boolean(process.env.COINBASE_COMMERCE_API_KEY), identityVerification: Boolean(stripe), persistence: process.env.DATA_DIR ? "configured" : "local-filesystem" } });
});
app.get("/api/session/:sessionId", (req, res) => {
  const session = sessions[req.params.sessionId];
  if (!session) return res.status(404).json({ error: "Session not found. Start a new session." });
  if (req.get("x-session-token") !== session.token) return res.status(403).json({ error: "Session access denied." });
  res.json({ ok: true, session: safeSession(session), payments: payments.filter((payment) => payment.sessionToken === session.token).map(({ id, plan, status, createdAt, checkoutUrl }) => ({ id, plan, status, createdAt, checkoutUrl })) });
});
app.post("/api/route", async (req, res) => {
  sessionFor(req);
  const { action = "chat", prompt, history = [] } = req.body || {};
  if (typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: "Please enter a prompt." });
  const clean = prompt.trim().slice(0, action === "voice" ? 4000 : action === "image" ? 4000 : 12000);
  try {
    if (action === "chat") return res.json({ ok: true, action, reply: await routeChat(clean, Array.isArray(history) ? history : []) });
    if (action === "image") {
      const size = ["1024x1024", "1536x1024", "1024x1536"].includes(req.body.size) ? req.body.size : "1024x1024";
      return res.json({ ok: true, action, imageUrl: await generateImage(clean, size) });
    }
    if (action === "voice") return res.json({ ok: true, action, audioUrl: await generateVoice(clean) });
    return res.status(400).json({ error: "Choose chat, image, or voice." });
  } catch (error) {
    console.error("AI action failed:", error.message);
    res.status(error.status || 502).json({ error: error.status ? error.message : "The AI service could not complete this request. Try again shortly." });
  }
});
app.get("/api/payments/crypto", (req, res) => res.json({ ok: true, wallets: Object.fromEntries(Object.entries(wallets).map(([name, value]) => [name, value || null])), plans: catalog, checkoutAvailable: Boolean(process.env.COINBASE_COMMERCE_API_KEY) }));
app.post("/api/payments/crypto", async (req, res) => {
  const session = sessionFor(req);
  if (!process.env.COINBASE_COMMERCE_API_KEY) return res.status(503).json({ error: "Crypto checkout is not configured. Add COINBASE_COMMERCE_API_KEY in Railway Variables." });
  const plan = catalog[String(req.body?.plan || "")];
  if (!plan) return res.status(400).json({ error: "Select a valid plan." });
  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
  try {
    const response = await fetchWithTimeout("https://api.commerce.coinbase.com/charges", {
      method: "POST", headers: { "content-type": "application/json", "X-CC-Api-Key": process.env.COINBASE_COMMERCE_API_KEY, "X-CC-Version": "2018-03-22" },
      body: JSON.stringify({ name: plan.name, description: `${plan.credits} PK AI Tool points`, pricing_type: "fixed_price", local_price: { amount: plan.amount.toFixed(2), currency: "USD" }, metadata: { sessionToken: session.token, planId: String(req.body.plan) }, redirect_url: `${baseUrl}/?payment=success`, cancel_url: `${baseUrl}/?payment=cancelled` })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.data?.id || !data.data?.hosted_url) { console.error("Coinbase Commerce charge creation failed:", data); return res.status(502).json({ error: "Could not start crypto checkout. Please try again later." }); }
    const payment = { id: crypto.randomUUID(), chargeId: data.data.id, sessionToken: session.token, planId: String(req.body.plan), status: "pending", createdAt: new Date().toISOString(), checkoutUrl: data.data.hosted_url };
    payments.push(payment); await persist();
    res.status(201).json({ ok: true, checkoutUrl: payment.checkoutUrl, payment: { id: payment.id, status: payment.status, plan: plan.name } });
  } catch (error) { console.error("Crypto checkout error:", error.message); res.status(502).json({ error: "Crypto checkout is temporarily unavailable." }); }
});
async function handleCoinbaseWebhook(req, res) {
  const secret = process.env.COINBASE_COMMERCE_WEBHOOK_SECRET;
  const signature = req.get("X-CC-Webhook-Signature");
  if (!secret || !signature || !Buffer.isBuffer(req.body)) return res.status(400).send("Webhook not configured");
  const expected = crypto.createHmac("sha256", secret).update(req.body).digest();
  let received; try { received = Buffer.from(signature, "hex"); } catch { return res.status(400).send("Invalid signature"); }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return res.status(400).send("Invalid signature");
  let event; try { event = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).send("Invalid JSON"); }
  if (event.type === "charge:confirmed") {
    const charge = event.data;
    const payment = payments.find((item) => item.chargeId === charge?.id);
    if (payment && payment.status !== "confirmed") {
      const session = sessions[payment.sessionToken]; const plan = catalog[payment.planId];
      if (session && plan) { session.credits += plan.credits; session.plan = plan.name; payment.status = "confirmed"; payment.confirmedAt = new Date().toISOString(); await persist(); }
    }
  }
  res.json({ received: true });
}
app.get("/api/security/kyc", (req, res) => {
  const session = sessionFor(req);
  res.json({ ok: true, status: session.kycStatus || "not_started", available: Boolean(stripe), message: stripe ? "Identity verification is provided by Stripe Identity. Documents are submitted directly to Stripe." : "Identity verification is unavailable until STRIPE_SECRET_KEY is configured." });
});
app.post("/api/security/kyc", async (req, res) => {
  const session = sessionFor(req);
  if (!stripe) return res.status(503).json({ error: "Identity verification is not configured. Add STRIPE_SECRET_KEY in Railway Variables." });
  try {
    const verification = await stripe.identity.verificationSessions.create({ type: "document", return_url: process.env.KYC_RETURN_URL || process.env.APP_URL || `${req.protocol}://${req.get("host")}`, metadata: { sessionToken: session.token } });
    session.kycStatus = verification.status || "requires_input"; session.kycSessionId = verification.id; await persist();
    res.status(201).json({ ok: true, url: verification.url, status: session.kycStatus });
  } catch (error) { console.error("Stripe Identity session error:", error.message); res.status(502).json({ error: "Could not start identity verification. Please try again later." }); }
});
async function handleStripeWebhook(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(400).send("Webhook not configured");
  let event; try { event = stripe.webhooks.constructEvent(req.body, req.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET); }
  catch (error) { return res.status(400).send(`Webhook signature invalid: ${error.message}`); }
  if (event.type === "identity.verification_session.verified" || event.type === "identity.verification_session.requires_input") {
    const verification = event.data.object;
    const session = sessions[verification.metadata?.sessionToken];
    if (session && session.kycSessionId === verification.id) { session.kycStatus = verification.status; await persist(); }
  }
  res.json({ received: true });
}

app.use((error, req, res, next) => {
  console.error("Request rejected:", error.message);
  if (res.headersSent) return next(error);
  res.status(error.status === 413 ? 413 : 400).json({ error: error.status === 413 ? "Request is too large." : "Invalid request." });
});
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || path.extname(req.path)) return res.status(404).json({ error: "Not found." });
  res.sendFile(path.join(__dirname, "public", "index.html"), (error) => error && next(error));
});
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`PK AI Tool listening on 0.0.0.0:${PORT}; providers=${JSON.stringify(providerStatus().details)}`);
  if (production && !process.env.DATA_DIR) console.warn("DATA_DIR is unset: JSON persistence may be ephemeral on Railway. Attach a persistent volume.");
  if (process.env.COINBASE_COMMERCE_API_KEY && !process.env.COINBASE_COMMERCE_WEBHOOK_SECRET) console.warn("Coinbase Commerce webhook secret is missing; successful payments will not be credited automatically.");
  if (stripe && !process.env.STRIPE_WEBHOOK_SECRET) console.warn("Stripe webhook secret is missing; KYC status will not update automatically.");
});
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  const timer = setTimeout(() => process.exit(1), 10000); timer.unref();
  server.close(async () => { await persist(); clearTimeout(timer); process.exit(0); });
}
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
