import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStore, saveStore } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY = process.env.MAX_BODY_SIZE || "2mb";
const store = await loadStore();
const sessions = store.sessions;
const payments = store.payments;
const wallets = {
  "USDT (ERC20)": process.env.WALLET_USDT_ERC20 || "",
  "TRX (TRC20)": process.env.WALLET_TRX_TRC20 || "",
  BTC: process.env.WALLET_BTC || "",
  "ETH (ERC20)": process.env.WALLET_ETH_ERC20 || "",
  "BNB (BEP20)": process.env.WALLET_BNB_BEP20 || ""
};

app.disable("x-powered-by");
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((x) => x.trim()) : true }));
app.use(express.json({ limit: MAX_BODY }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

const config = {
  groq: process.env.GROQ_API_KEY,
  google: process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GEMINI_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  deepseek: process.env.DEEPSEEK_API_KEY,
  replicate: process.env.REPLICATE_API_TOKEN,
  huggingface: process.env.HUGGINGFACE_API_TOKEN || process.env.HF_API_TOKEN,
  elevenlabs: process.env.ELEVENLABS_API_KEY,
  noiz: process.env.NOIZ_API_KEY
};

let persistChain = Promise.resolve();
function persist() {
  persistChain = persistChain.then(() => saveStore({ sessions, payments })).catch((err) => console.error("Store persistence failed:", err.message));
  return persistChain;
}
function sessionFor(req) {
  let token = String(req.get("x-session-token") || "").trim();
  if (!/^[a-f0-9]{32,64}$/i.test(token) || !sessions[token]) {
    token = crypto.randomBytes(24).toString("hex");
    sessions[token] = { token, credits: 50, plan: "Free", createdAt: new Date().toISOString(), kycStatus: "not_started" };
    void persist();
  }
  return sessions[token];
}
function safeSession(s) {
  return { token: s.token, credits: s.credits, plan: s.plan, createdAt: s.createdAt, kycStatus: s.kycStatus || "not_started" };
}
function configured() {
  return {
    llm: Boolean(config.groq || config.google || config.openai || config.deepseek),
    image: Boolean(config.openai),
    voice: Boolean(config.openai || config.elevenlabs),
    details: { groq: Boolean(config.groq), googleAIStudio: Boolean(config.google), gemini: Boolean(config.google), openai: Boolean(config.openai), deepseek: Boolean(config.deepseek), replicate: Boolean(config.replicate), huggingface: Boolean(config.huggingface), elevenlabs: Boolean(config.elevenlabs), noiz: Boolean(config.noiz) }
  };
}
async function requestJson(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally { clearTimeout(timer); }
}
async function openAICompatible({ base, key, model, messages }) {
  const res = await requestJson(`${base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages, temperature: 0.7 }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Provider returned HTTP ${res.status}`);
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Provider returned an empty response");
  return text;
}
async function gemini(model, key, messages) {
  const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content) }] }));
  const system = messages.find((m) => m.role === "system")?.content;
  const res = await requestJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Google AI returned HTTP ${res.status}`);
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("Google AI returned an empty response");
  return text;
}
async function routeChat(prompt, history = []) {
  const messages = [{ role: "system", content: "You are PK AI Tool, a helpful creative assistant. Be clear, respectful, and concise." }, ...history.slice(-10).filter((m) => ["user", "assistant"].includes(m.role)).map((m) => ({ role: m.role, content: String(m.content).slice(0, 8000) })), { role: "user", content: prompt }];
  const attempts = [];
  if (config.groq) for (const model of ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]) attempts.push(() => openAICompatible({ base: "https://api.groq.com/openai/v1", key: config.groq, model, messages }));
  if (config.google) for (const model of ["gemini-2.5-flash", "gemini-2.0-flash"]) attempts.push(() => gemini(model, config.google, messages));
  if (config.deepseek) attempts.push(() => openAICompatible({ base: "https://api.deepseek.com/v1", key: config.deepseek, model: "deepseek-chat", messages }));
  if (config.openai) attempts.push(() => openAICompatible({ base: "https://api.openai.com/v1", key: config.openai, model: "gpt-4o-mini", messages }));
  if (!attempts.length) throw Object.assign(new Error("AI chat is not configured. Add at least one supported provider key in your deployment environment."), { status: 503 });
  const errors = [];
  for (const attempt of attempts) { try { return await attempt(); } catch (e) { errors.push(e.message); } }
  console.error("All chat providers failed:", errors);
  throw Object.assign(new Error("AI providers are temporarily unavailable. Please try again shortly."), { status: 502 });
}

app.get("/api/health", (req, res) => {
  const s = sessionFor(req);
  res.json({ ok: true, service: "PK AI Tool", timestamp: new Date().toISOString(), providers: configured(), session: safeSession(s), wallets: Object.fromEntries(Object.entries(wallets).map(([k, v]) => [k, v || null])) });
});
app.get("/api/session/:sessionId", (req, res) => {
  const s = sessions[req.params.sessionId];
  if (!s) return res.status(404).json({ error: "Session not found. Refresh to start a new session." });
  if (req.get("x-session-token") !== s.token) return res.status(403).json({ error: "This session cannot be accessed with the current token." });
  res.json({ ok: true, session: safeSession(s), payments: payments.filter((p) => p.sessionToken === s.token).map(({ id, network, status, createdAt }) => ({ id, network, status, createdAt })) });
});
app.post("/api/route", async (req, res) => {
  const s = sessionFor(req);
  const { action = "chat", prompt, history = [] } = req.body || {};
  if (typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: "Please enter a prompt." });
  try {
    if (action === "chat") return res.json({ ok: true, action, reply: await routeChat(prompt.trim().slice(0, 12000), Array.isArray(history) ? history : []) });
    if (action === "image") {
      if (!config.openai) return res.status(503).json({ error: "Image generation is not configured. Set OPENAI_API_KEY in your deployment environment." });
      const resAI = await requestJson("https://api.openai.com/v1/images/generations", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.openai}` }, body: JSON.stringify({ model: "gpt-image-1", prompt: prompt.trim().slice(0, 4000), size: ["1024x1024", "1536x1024", "1024x1536"].includes(req.body.size) ? req.body.size : "1024x1024" }) }, 90000);
      const data = await resAI.json().catch(() => ({}));
      if (!resAI.ok) { console.error("Image provider error:", data?.error?.message || resAI.status); return res.status(502).json({ error: "Image generation failed. Please try a different prompt or try again later." }); }
      return res.json({ ok: true, action, imageUrl: data.data?.[0]?.url || (data.data?.[0]?.b64_json ? `data:image/png;base64,${data.data[0].b64_json}` : null) });
    }
    if (action === "voice") {
      const text = prompt.trim().slice(0, 4000);
      if (config.elevenlabs) {
        const voiceId = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
        const speech = await requestJson(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, { method: "POST", headers: { "content-type": "application/json", "xi-api-key": config.elevenlabs, accept: "audio/mpeg" }, body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }) }, 90000);
        if (!speech.ok) throw new Error("Voice provider could not complete the request");
        const audio = Buffer.from(await speech.arrayBuffer()).toString("base64");
        return res.json({ ok: true, action, audioUrl: `data:audio/mpeg;base64,${audio}` });
      }
      if (config.openai) {
        const speech = await requestJson("https://api.openai.com/v1/audio/speech", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.openai}` }, body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "mp3" }) }, 90000);
        if (!speech.ok) throw new Error("Voice provider could not complete the request");
        return res.json({ ok: true, action, audioUrl: `data:audio/mpeg;base64,${Buffer.from(await speech.arrayBuffer()).toString("base64")}` });
      }
      return res.status(503).json({ error: "Voice generation is not configured. Set ELEVENLABS_API_KEY or OPENAI_API_KEY." });
    }
    return res.status(400).json({ error: "Unsupported action. Choose chat, image, or voice." });
  } catch (error) {
    console.error("AI route failed:", error.message);
    res.status(error.status || 502).json({ error: error.status ? error.message : "The request could not be completed. Please try again later." });
  }
});
app.post("/api/payments/crypto", async (req, res) => {
  const s = sessionFor(req);
  const network = String(req.body?.network || "");
  const txid = String(req.body?.txid || "").trim();
  if (!Object.hasOwn(wallets, network)) return res.status(400).json({ error: "Choose a supported payment network." });
  if (!wallets[network]) return res.status(503).json({ error: "This payment wallet has not been configured by the site owner." });
  if (!txid || txid.length < 8 || txid.length > 200) return res.status(400).json({ error: "Enter a valid transaction reference." });
  if (payments.some((p) => p.txid.toLowerCase() === txid.toLowerCase())) return res.status(409).json({ error: "This transaction reference has already been submitted." });
  const payment = { id: crypto.randomUUID(), sessionToken: s.token, network, txid, status: "pending_review", createdAt: new Date().toISOString() };
  payments.push(payment);
  await persist();
  res.status(202).json({ ok: true, payment: { id: payment.id, network, status: payment.status, createdAt: payment.createdAt }, message: "Payment submitted for manual review. Credits are not added until payment is independently confirmed." });
});
app.get("/api/payments/crypto", (req, res) => res.json({ ok: true, wallets: Object.fromEntries(Object.entries(wallets).map(([k, v]) => [k, v || null])) }));
app.get("/api/security/kyc", (req, res) => { const s = sessionFor(req); res.json({ ok: true, status: s.kycStatus || "not_started", available: false, message: "Identity verification is not enabled. Do not submit identity documents until a verified KYC provider is configured." }); });
app.post("/api/security/kyc", (req, res) => res.status(503).json({ error: "KYC verification is not configured. No identity data was collected. The site owner must integrate a compliant identity-verification provider before enabling this feature." }));
app.use((err, req, res, next) => { console.error("Request error:", err.message); if (res.headersSent) return next(err); res.status(err.status || 400).json({ error: err.status === 413 ? "Request is too large." : "The request could not be processed." }); });
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const server = app.listen(PORT, () => console.log(`PK AI Tool listening on port ${PORT}`));
const shutdown = () => { server.close(() => { void persist().finally(() => process.exit(0)); }); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
