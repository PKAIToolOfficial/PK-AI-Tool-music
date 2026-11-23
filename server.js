import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((x) => x.trim()).filter(Boolean) : true }));
app.use(express.json({ limit: process.env.MAX_BODY_SIZE || "2mb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));

const sessions = new Map();
const txIds = new Set();
const providerConfig = {
  groq: Boolean(process.env.GROQ_API_KEY),
  gemini: Boolean(process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GEMINI_API_KEY),
  openai: Boolean(process.env.OPENAI_API_KEY),
  deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
  fal: Boolean(process.env.FAL_KEY),
  replicate: Boolean(process.env.REPLICATE_API_TOKEN),
  huggingface: Boolean(process.env.HUGGINGFACE_API_TOKEN),
  elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
  fish: Boolean(process.env.FISH_AUDIO_API_KEY || process.env.FISH_API_KEY)
};
const wallets = {
  "USDT (ERC20)": process.env.WALLET_USDT_ERC20 || "",
  "TRX (TRC20)": process.env.WALLET_TRX_TRC20 || "",
  BTC: process.env.WALLET_BTC || "",
  "ETH (ERC20)": process.env.WALLET_ETH_ERC20 || "",
  "BNB (BEP20)": process.env.WALLET_BNB_BEP20 || ""
};

function getSession(req) {
  const token = String(req.get("x-session-token") || "").trim();
  if (/^[a-f0-9]{32,64}$/i.test(token) && sessions.has(token)) return sessions.get(token);
  const newToken = crypto.randomBytes(24).toString("hex");
  const session = { token: newToken, credits: 50, maxCredits: 50, plan: "Free", paid: false, verified: false, tracks: [], kycStatus: "not_started", pinSet: false }; 
  sessions.set(newToken, session);
  return session;
}
function publicSession(session) {
  return { token: session.token, credits: session.credits, maxCredits: session.maxCredits, plan: session.plan, paid: session.paid, verified: session.verified, kycStatus: session.kycStatus || "not_started" };
}
function requirePaid(req, res) {
  const session = getSession(req);
  if (!session.paid) {
    res.status(403).json({ error: "This feature is available only with a paid plan." });
    return null;
  }
  return session;
}
async function fetchJson(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { const r = await fetch(url, { ...options, signal: controller.signal }); const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error("The service is temporarily unavailable."); return data; }
  finally { clearTimeout(timer); }
}
async function routeChat(prompt, history) {
  const messages = [{ role: "system", content: "You are the PK AI Tool assistant. Give accurate, helpful, respectful answers." }, ...history.slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 4000) })), { role: "user", content: prompt }];
  const attempts = [];
  if (process.env.GROQ_API_KEY) attempts.push(async () => { const d = await fetchJson("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: process.env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile", messages }) }); return d.choices?.[0]?.message?.content; });
  if (process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GEMINI_API_KEY) attempts.push(async () => { const key = process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GEMINI_API_KEY; const d = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash"}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }); return d.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim(); });
  if (process.env.OPENAI_API_KEY) attempts.push(async () => { const d = await fetchJson("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini", messages }) }); return d.choices?.[0]?.message?.content; });
  if (process.env.DEEPSEEK_API_KEY) attempts.push(async () => { const d = await fetchJson("https://api.deepseek.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || "deepseek-chat", messages }) }); return d.choices?.[0]?.message?.content; });
  for (const attempt of attempts) { try { const result = await attempt(); if (result) return result; } catch (_) {} }
  throw new Error(attempts.length ? "The AI service is temporarily unavailable. Please try again shortly." : "The AI service is not configured.");
}

app.get("/api/health", (req, res) => { const s = getSession(req); res.json({ ok: true, service: "PK AI Tool", timestamp: new Date().toISOString(), providers: { chat: Boolean(process.env.GROQ_API_KEY || process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY), media: Boolean(process.env.FAL_KEY || process.env.REPLICATE_API_TOKEN || process.env.OPENAI_API_KEY), voice: Boolean(process.env.ELEVENLABS_API_KEY || process.env.FISH_AUDIO_API_KEY || process.env.FISH_API_KEY || process.env.OPENAI_API_KEY), optionalIntegrations: Boolean(process.env.SOUNDVERSE_API_KEY || process.env.NOIZ_API_KEY || process.env.AUPHONIC_API_KEY) }, session: publicSession(s), wallets: Object.fromEntries(Object.entries(wallets).map(([k,v]) => [k,v||null])) }); });
app.get("/api/session/:id", (req, res) => { const s = getSession(req); if (req.params.id !== s.token) return res.status(403).json({ error: "Session access denied." }); res.json({ ok: true, session: publicSession(s) }); });
app.post("/api/route", async (req, res) => { try { const { action = "chat", prompt, history = [] } = req.body || {}; if (typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: "Please enter a prompt." }); if (action !== "chat") { const s = requirePaid(req, res); if (!s) return; } if (action === "chat") return res.json({ ok: true, reply: await routeChat(prompt.trim().slice(0, 12000), Array.isArray(history) ? history : []) }); return res.status(503).json({ error: "This premium tool is not available yet. A provider-ready workflow will appear when its integration is configured." }); } catch (_) { res.status(502).json({ error: "The service could not complete this request. Please try again shortly." }); } });
app.get("/api/payments/crypto", (req, res) => res.json({ ok: true, wallets: Object.fromEntries(Object.entries(wallets).map(([k,v]) => [k,v||null])) }));
app.post("/api/payments/crypto", (req, res) => { const s = getSession(req); const { network, txid, planId } = req.body || {}; if (!Object.hasOwn(wallets, String(network || ""))) return res.status(400).json({ error: "Select a supported network." }); if (!txid || String(txid).trim().length < 8) return res.status(400).json({ error: "Enter a valid transaction reference." }); const clean = String(txid).trim(); if (txIds.has(clean.toLowerCase())) return res.status(409).json({ error: "This transaction reference has already been submitted." }); txIds.add(clean.toLowerCase()); res.status(202).json({ ok: true, status: "pending_review", message: "Submitted for verification. Your plan will be activated only after confirmation." }); });
app.post("/api/plans/verify-crypto", (req, res) => { const s = getSession(req); const { txid, cycle } = req.body || {}; if (!txid || String(txid).trim().length < 8) return res.status(400).json({ error: "Enter a valid transaction reference." }); if (txIds.has(String(txid).trim().toLowerCase())) return res.status(409).json({ error: "This transaction reference has already been submitted." }); txIds.add(String(txid).trim().toLowerCase()); res.status(202).json({ ok: true, status: "pending_review", message: "Submitted for verification. Paid access remains locked until confirmation." }); });
app.get("/api/security/kyc", (req, res) => { const s = getSession(req); res.json({ ok: true, status: s.kycStatus, available: Boolean(process.env.STRIPE_SECRET_KEY), message: process.env.STRIPE_SECRET_KEY ? "Secure identity verification is available." : "Identity verification is not configured." }); });
app.post("/api/security/kyc", (req, res) => res.status(process.env.STRIPE_SECRET_KEY ? 503 : 503).json({ error: "Identity verification must be completed through the configured secure provider." });
app.post("/api/auth/verify", (req, res) => { const s = getSession(req); const { identifier, code } = req.body || {}; if (!identifier || !code) return res.status(400).json({ error: "Verification details are required." }); s.verified = true; res.json({ ok: true, verified: true, message: "Identity verification status updated." }); });
app.post("/api/credits/watch-ad", (req, res) => { const s = getSession(req); if (s.credits > 10 && s.plan === "Free") return res.status(400).json({ error: "Credits are available when the free balance is low." }); s.credits += 10; res.json({ ok: true, credits: s.credits, message: "Bonus credits added." }); });
app.post("/api/credits/reset", (req, res) => { const s = getSession(req); if (s.paid) return res.status(400).json({ error: "Paid plans cannot be reset with the free-tier reset action." }); s.credits = 50; s.maxCredits = 50; res.json({ ok: true, credits: s.credits, plan: s.plan }); });
app.post("/api/songs/create", async (req, res) => { const s = requirePaid(req, res); if (!s) return; const cost = 10; if (s.credits < cost) return res.status(402).json({ error: "Not enough credits." }); s.credits -= cost; const track = { id: `track_${crypto.randomBytes(8).toString("hex")}`, title: req.body?.title || "Untitled Track", type: req.body?.instrumental ? "instrumental" : "vocal", createdAt: new Date().toISOString(), lyrics: req.body?.lyrics || "", audioUrl: null }; s.tracks.unshift(track); res.json({ ok: true, credits: s.credits, tracks: [track] }); });
app.post("/api/speech/create", async (req, res) => { const s = requirePaid(req, res); if (!s) return; res.status(503).json({ error: "Voice generation is temporarily unavailable." }); });
app.post("/api/visuals/create", async (req, res) => { const s = requirePaid(req, res); if (!s) return; res.status(503).json({ error: "Visual generation is temporarily unavailable." }); });
app.get("/api/tracks", (req, res) => { const s = getSession(req); res.json({ ok: true, tracks: s.tracks }); });
app.post("/api/tracks/:id/like", (req, res) => { const s = getSession(req); const t = s.tracks.find((x) => x.id === req.params.id); if (!t) return res.status(404).json({ error: "Item not found." }); t.liked = !t.liked; res.json({ ok: true, track: t }); });
app.delete("/api/tracks/:id", (req, res) => { const s = getSession(req); s.tracks = s.tracks.filter((x) => x.id !== req.params.id); res.json({ ok: true }); });
app.use((err, req, res, next) => { if (res.headersSent) return next(err); res.status(err.status || 500).json({ error: "The request could not be processed." }); });
app.get("*", (req, res, next) => { if (req.path.startsWith("/api/") || path.extname(req.path)) return res.status(404).json({ error: "Not found." }); res.sendFile(path.join(__dirname, "public", "index.html"), (e) => e && next(e)); });
const server = app.listen(PORT, "0.0.0.0", () => console.log(`PK AI Tool listening on port ${PORT}`));
function shutdown(){ server.close(()=>process.exit(0)); setTimeout(()=>process.exit(1),10000).unref(); } process.on("SIGTERM",shutdown); process.on("SIGINT",shutdown);
