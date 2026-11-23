import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const sessions = new Map();
const verification = new Map();
const usedTx = new Set();
const rates = new Map();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((value) => value.trim()).filter(Boolean) : true }));
app.use(express.static(path.join(root, "public"), { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
app.post("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), handleStripeWebhook);
app.use(express.json({ limit: process.env.MAX_BODY_SIZE || "2mb" }));

const wallets = {
  "USDT (ERC20)": process.env.WALLET_USDT_ERC20 || "",
  "TRX (TRC20)": process.env.WALLET_TRX_TRC20 || "",
  BTC: process.env.WALLET_BTC || "",
  "ETH (ERC20)": process.env.WALLET_ETH_ERC20 || "",
  "BNB (BEP20)": process.env.WALLET_BNB_BEP20 || ""
};
const harmfulPatterns = [
  /\b(?:child|minor|underage)\b.{0,60}\b(?:sexual|sex|nude|porn|explicit)\b/i,
  /\b(?:sexual|sex|nude|porn|explicit)\b.{0,60}\b(?:child|minor|underage)\b/i,
  /\b(?:build|make|assemble)\b.{0,50}\b(?:bomb|explosive|weapon)\b/i,
  /\b(?:kill|murder|attack)\b.{0,50}\b(?:person|people|school|workplace)\b/i
];

function getSession(req) {
  const token = String(req.get("x-session-token") || "").trim();
  if (/^[a-f0-9]{32,64}$/i.test(token) && sessions.has(token)) return sessions.get(token);
  const created = crypto.randomBytes(24).toString("hex");
  const session = { token: created, credits: 50, maxCredits: 50, plan: "Free", paid: false, verified: false, kycStatus: "not_started", tracks: [] };
  sessions.set(created, session);
  return session;
}
function publicSession(session) {
  return { token: session.token, credits: session.credits, maxCredits: session.maxCredits, plan: session.plan, paid: Boolean(session.paid), verified: Boolean(session.verified), kycStatus: session.kycStatus || "not_started" };
}
function requirePaid(req, res) {
  const session = getSession(req);
  if (!session.paid) { res.status(403).json({ error: "This feature is available only with a paid plan." }); return null; }
  return session;
}
function checkText(value) {
  if (typeof value === "string") return harmfulPatterns.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(checkText);
  if (value && typeof value === "object") return Object.values(value).some(checkText);
  return false;
}
function safeError(res, status, message) { return res.status(status).json({ error: message }); }
function rate(req, key, limit, windowMs) {
  const now = Date.now();
  const identity = `${key}:${String(req.ip || req.socket?.remoteAddress || "unknown")}`;
  const items = (rates.get(identity) || []).filter((time) => now - time < windowMs);
  if (items.length >= limit) return false;
  items.push(now); rates.set(identity, items); return true;
}
function base32Encode(buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, output = "";
  for (const byte of buffer) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function hotp(secret, counter) {
  const message = Buffer.alloc(8); message.writeUInt32BE(Math.floor(counter / 0x100000000), 0); message.writeUInt32BE(counter >>> 0, 4);
  const digest = crypto.createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const code = ((digest[offset] & 127) << 24 | (digest[offset + 1] & 255) << 16 | (digest[offset + 2] & 255) << 8 | (digest[offset + 3] & 255)) % 1000000;
  return code.toString().padStart(6, "0");
}
function totpCheck(secret, code) {
  const time = Math.floor(Date.now() / 30000);
  for (let offset = -1; offset <= 1; offset++) if (hotp(secret, time + offset) === String(code)) return true;
  return false;
}
async function fetchJson(url, options, timeout = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("The service could not complete this request.");
    return data;
  } finally { clearTimeout(timer); }
}

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("X-Frame-Options", "SAMEORIGIN");
  if (req.path.startsWith("/api/") && !rate(req, "api", 180, 60000)) return res.status(429).json({ error: "Too many requests. Please wait and try again." });
  if (req.method === "POST" && checkText(req.body)) return res.status(400).json({ error: "This request cannot be processed. Please change the content and try again." });
  next();
});

app.get("/healthz", (req, res) => res.status(200).json({ ok: true }));
app.get("/api/health", (req, res) => {
  const session = getSession(req);
  res.json({ ok: true, service: "PK AI Tool", timestamp: new Date().toISOString(), session: publicSession(session), wallets: Object.fromEntries(Object.entries(wallets).map(([key, value]) => [key, value || null])) });
});
app.get("/api/session/:id", (req, res) => { const session = getSession(req); if (req.params.id !== session.token) return safeError(res, 403, "Session access denied."); res.json({ ok: true, session: publicSession(session) }); });

function builtInChatFallback(prompt) {
  const normalized = prompt.trim().toLowerCase().replace(/[!?.]+$/, "");
  if (["hi", "hello", "hey", "good morning", "good evening", "good afternoon", "greetings"].includes(normalized)) {
    return "Hello! I'm ready to help with writing, planning, coding, learning, business, creative work, and your projects. What would you like to work on?";
  }
  if (/^(thanks|thank you|thx)$/.test(normalized)) return "You're welcome! Tell me what you'd like to do next.";
  if (/^(how are you|how's it going|how r u)$/.test(normalized)) return "I'm ready to help. What can we work on together?";
  if (/^(help|help me)$/.test(normalized)) return "I can help you write, summarize, translate, brainstorm, plan, debug, create prompts, or explore a task. Tell me what you need and I’ll start.";
  if (/^(who are you|what can you do|what is this)$/.test(normalized)) return "I’m a white-label creative assistant built into PK AI Tool. I can help with text, ideas, planning, writing, learning, and project workflows.";
  return "I’m ready to help. Please provide a little more detail about the task, topic, audience, or result you want.";
}

async function chatPrompt(prompt, history) {
  const attempts = [];
  const messages = [
    { role: "system", content: "You are a helpful, accurate, respectful platform assistant. Do not mention internal providers, models, owners, or infrastructure." },
    ...history.slice(-8).map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: String(item.content || "").slice(0, 4000) })),
    { role: "user", content: prompt }
  ];

  if (process.env.GROQ_API_KEY) attempts.push(async () => {
    const data = await fetchJson("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: process.env.GROQ_CHAT_MODEL || "llama-3.3-70b-versatile", messages, temperature: 0.7 }) });
    return data.choices?.[0]?.message?.content?.trim();
  });
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_STUDIO_API_KEY) attempts.push(async () => {
    const key = process.env.GOOGLE_AI_STUDIO_API_KEY || process.env.GEMINI_API_KEY;
    const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash"}:generateContent?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }) });
    return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  });
  if (process.env.OPENAI_API_KEY) attempts.push(async () => {
    const data = await fetchJson("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini", messages, temperature: 0.7 }) });
    return data.choices?.[0]?.message?.content?.trim();
  });
  if (process.env.DEEPSEEK_API_KEY) attempts.push(async () => {
    const data = await fetchJson("https://api.deepseek.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || "deepseek-chat", messages, temperature: 0.7 }) });
    return data.choices?.[0]?.message?.content?.trim();
  });

  for (const attempt of attempts) {
    try { const output = await attempt(); if (output) return output; } catch (_) {}
  }
  return builtInChatFallback(prompt);
}

async function handleChatRequest(req, res) {
  try {
    const { prompt, history = [] } = req.body || {};
    if (typeof prompt !== "string" || !prompt.trim()) return safeError(res, 400, "Please enter a prompt.");
    if (prompt.trim().length > 12000) return safeError(res, 413, "The request is too long.");
    const reply = await chatPrompt(prompt.trim(), Array.isArray(history) ? history : []);
    return res.json({ ok: true, reply });
  } catch (_) {
    return res.json({ ok: true, reply: builtInChatFallback(req.body?.prompt || "Hi") });
  }
}

app.post("/api/route", async (req, res) => {
  try {
    const { action = "chat", prompt, history = [] } = req.body || {};
    if (typeof prompt !== "string" || !prompt.trim()) return safeError(res, 400, "Please enter a prompt.");
    if (prompt.length > 8000) return safeError(res, 413, "The request is too long.");
    if (action !== "chat") {
      if (!requirePaid(req, res)) return;
    }
    if (action === "chat") return handleChatRequest(req, res);
    return safeError(res, 503, "This tool is temporarily unavailable.");
  } catch (_) {
    return res.json({ ok: true, reply: builtInChatFallback(req.body?.prompt || "Hi") });
  }
});
app.post("/api/assistant/chat", handleChatRequest);

app.get("/api/security/kyc", (req, res) => { const session=getSession(req); const record=verification.get(session.token)||{}; res.json({ok:true,status:record.kycStatus||session.kycStatus||"not_started",country:record.country||null,documentType:record.documentType||null,faceStatus:record.faceStatus||"not_started",available:Boolean(process.env.STRIPE_SECRET_KEY),message:"Use the secure international identity verification workflow."}); });
app.post("/api/security/kyc", async (req, res) => { const session=getSession(req); const record=verification.get(session.token)||{}; const country=String(req.body?.country||"").trim().toUpperCase(); const documentType=String(req.body?.documentType||"").trim(); if(!/^[A-Z]{2}$/.test(country)||!documentType) return safeError(res,400,"Select your country and document type."); if(!["passport","national_id","residence_permit","driving_license"].includes(documentType)) return safeError(res,400,"Choose a supported document type."); record.country=country;record.documentType=documentType;record.kycStatus="submitted";verification.set(session.token,record);session.kycStatus="submitted";
  if(process.env.STRIPE_SECRET_KEY){ try{ const params=new URLSearchParams({type:"document",return_url:process.env.KYC_RETURN_URL||process.env.APP_URL||""});params.set("metadata[session_token]",session.token);const r=await fetch("https://api.stripe.com/v1/identity/verification_sessions",{method:"POST",headers:{authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`,"content-type":"application/x-www-form-urlencoded"},body:params});const data=await r.json();if(!r.ok||!data.url)throw new Error();record.kycStatus=data.status||"requires_input";record.providerSession=data.id||null;session.kycStatus=record.kycStatus;verification.set(session.token,record);return res.json({ok:true,status:record.kycStatus,url:data.url}); }catch(_){ return safeError(res,502,"Secure verification could not be started. Please try again later."); }}
  return res.json({ok:true,status:"submitted",message:"Verification details submitted for structured review."});
});

app.post("/api/security/totp/setup", (req,res)=>{const session=getSession(req);const record=verification.get(session.token)||{};const secret=crypto.randomBytes(20);record.totpSecret=secret;record.totpEnabled=false;verification.set(session.token,record);const encoded=base32Encode(secret);const issuer="PK AI Tool";const otpauth=`otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(session.token.slice(0,8))}?secret=${encoded}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30&algorithm=SHA1`;return res.json({ok:true,provisioningUri:otpauth,secret:encoded,issuer:"Platform Security"});});
app.post("/api/security/totp/verify",(req,res)=>{const session=getSession(req);const record=verification.get(session.token)||{};if(!record.totpSecret)return safeError(res,400,"Set up the authenticator first.");const code=String(req.body?.code||"").replace(/[^0-9]/g,"");if(!/^\d{6}$/.test(code)||!totpCheck(record.totpSecret,code))return safeError(res,401,"The verification code is incorrect.");record.totpEnabled=true;verification.set(session.token,record);return res.json({ok:true,enabled:true});});

app.post("/api/security/email/setup",async(req,res)=>{const session=getSession(req);const email=String(req.body?.email||"").trim().toLowerCase();if(!/^.{3,254}@.{2,255}$/.test(email)||email.includes(" "))return safeError(res,400,"Enter a valid email address.");const code=crypto.randomInt(100000,999999).toString();const record=verification.get(session.token)||{};record.email=email;record.emailCode=code;record.emailStatus="pending";verification.set(session.token,record);if(process.env.EMAIL_VERIFICATION_API_URL&&process.env.EMAIL_VERIFICATION_API_KEY){try{await fetchJson(process.env.EMAIL_VERIFICATION_API_URL,{method:"POST",headers:{authorization:`Bearer ${process.env.EMAIL_VERIFICATION_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({email,code})},30000);return res.json({ok:true,status:"pending",message:"Verification code sent."});}catch(_){return safeError(res,502,"Email verification could not be started. Please try again later.");}}return res.json({ok:true,status:"pending",demoCode:process.env.NODE_ENV!=="production"?code:undefined,message:"Email verification service is not configured."});});
app.post("/api/security/email/verify",(req,res)=>{const session=getSession(req);const record=verification.get(session.token)||{};if(!record.emailCode)return safeError(res,400,"Request an email verification code first.");if(String(req.body?.code||"")!==record.emailCode)return safeError(res,401,"The email code is incorrect.");record.emailStatus="verified";delete record.emailCode;verification.set(session.token,record);return res.json({ok:true,status:"verified"});});

app.post("/api/security/mobile/setup",async(req,res)=>{const session=getSession(req);const phone=String(req.body?.phone||"").trim();if(!/^\+[1-9][0-9]{7,14}$/.test(phone))return safeError(res,400,"Enter a phone number in international format.");const code=crypto.randomInt(100000,999999).toString();const record=verification.get(session.token)||{};record.phone=phone;record.mobileCode=code;record.mobileStatus="pending";verification.set(session.token,record);if(process.env.MOBILE_VERIFICATION_API_URL&&process.env.MOBILE_VERIFICATION_API_KEY){try{await fetchJson(process.env.MOBILE_VERIFICATION_API_URL,{method:"POST",headers:{authorization:`Bearer ${process.env.MOBILE_VERIFICATION_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({phone,code})},30000);return res.json({ok:true,status:"pending",message:"Verification code sent."});}catch(_){return safeError(res,502,"Mobile verification could not be started. Please try again later.");}}return safeError(res,503,"Mobile verification service is not configured.");});
app.post("/api/security/mobile/verify",(req,res)=>{const session=getSession(req);const record=verification.get(session.token)||{};if(!record.mobileCode)return safeError(res,400,"Request a mobile verification code first.");if(String(req.body?.code||"")!==record.mobileCode)return safeError(res,401,"The mobile code is incorrect.");record.mobileStatus="verified";delete record.mobileCode;verification.set(session.token,record);return res.json({ok:true,status:"verified"});});

app.post("/api/security/biometric/challenge",(req,res)=>{const session=getSession(req);const record=verification.get(session.token)||{};const challenge=crypto.randomBytes(32).toString("base64url");record.biometricChallenge=challenge;record.faceStatus="challenge_created";verification.set(session.token,record);return res.json({ok:true,challenge,mode:"provider_or_device"});});
app.post("/api/security/biometric/verify",async(req,res)=>{const session=getSession(req);const record=verification.get(session.token)||{};if(!record.biometricChallenge)return safeError(res,400,"Create a verification challenge first.");if(process.env.BIOMETRIC_VERIFICATION_API_URL&&process.env.BIOMETRIC_VERIFICATION_API_KEY){try{const data=await fetchJson(process.env.BIOMETRIC_VERIFICATION_API_URL,{method:"POST",headers:{authorization:`Bearer ${process.env.BIOMETRIC_VERIFICATION_API_KEY}`,"content-type":"application/json"},body:JSON.stringify({challenge:record.biometricChallenge,attestation:req.body?.attestation||null,publicKey:req.body?.publicKey||null})},30000);if(data?.verified!==true)return safeError(res,422,"Biometric verification was not confirmed.");record.faceStatus="verified";verification.set(session.token,record);return res.json({ok:true,status:"verified"});}catch(_){return safeError(res,502,"Biometric verification could not be completed.");}}return safeError(res,503,"Device verification service is not configured.");});

app.get("/api/security/verification",(req,res)=>{const session=getSession(req);const record=verification.get(session.token)||{};res.json({ok:true,kyc:record.kycStatus||session.kycStatus||"not_started",country:record.country||null,documentType:record.documentType||null,emailStatus:record.emailStatus||"not_started",mobileStatus:record.mobileStatus||"not_started",totpEnabled:Boolean(record.totpEnabled),faceStatus:record.faceStatus||"not_started",goldenBadge:Boolean(session.verified||session.paid)});});

app.get("/api/payments/crypto",(req,res)=>res.json({ok:true,wallets:Object.fromEntries(Object.entries(wallets).map(([key,value])=>[key,value||null]))}));
app.post("/api/payments/crypto",(req,res)=>{const session=getSession(req);const network=String(req.body?.network||"");const txid=String(req.body?.txid||"").trim();if(!Object.hasOwn(wallets,network))return safeError(res,400,"Select a supported network.");if(!txid||txid.length<8||txid.length>200)return safeError(res,400,"Enter a valid transaction reference.");if(usedTx.has(txid.toLowerCase()))return safeError(res,409,"This transaction reference has already been submitted.");usedTx.add(txid.toLowerCase());return res.status(202).json({ok:true,status:"pending_review",message:"Submitted for verification. Paid access remains locked until confirmation."});});
app.post("/api/plans/verify-crypto",(req,res)=>{const session=getSession(req);const txid=String(req.body?.txid||"").trim();if(!txid||txid.length<8||txid.length>200)return safeError(res,400,"Enter a valid transaction reference.");if(usedTx.has(txid.toLowerCase()))return safeError(res,409,"This transaction reference has already been submitted.");usedTx.add(txid.toLowerCase());return res.status(202).json({ok:true,status:"pending_review",message:"Submitted for verification. Paid access remains locked until confirmation."});});

app.post("/api/credits/watch-ad",(req,res)=>{const session=getSession(req);if(session.credits>10&&session.plan=== "Free")return safeError(res,400,"Credit bonus is available when the free balance is low.");session.credits+=10;return res.json({ok:true,credits:session.credits,message:"Bonus credits added."});});
app.post("/api/credits/reset",(req,res)=>{const session=getSession(req);if(session.paid)return safeError(res,400,"Paid plans cannot be reset with the free-tier action.");session.credits=50;session.maxCredits=50;session.plan="Free";return res.json({ok:true,credits:session.credits,plan:session.plan});});
app.post("/api/songs/create",(req,res)=>{const session=requirePaid(req,res);if(!session)return;if(session.credits<10)return safeError(res,402,"Not enough credits.");session.credits-=10;const track={id:`track_${crypto.randomBytes(8).toString("hex")}`,title:String(req.body?.title||"Untitled Track").slice(0,200),type:req.body?.instrumental?"instrumental":"vocal",createdAt:new Date().toISOString(),lyrics:String(req.body?.lyrics||"").slice(0,50000),audioUrl:null};session.tracks.unshift(track);return res.json({ok:true,credits:session.credits,tracks:[track]});});
app.post("/api/speech/create",(req,res)=>{if(!requirePaid(req,res))return;return safeError(res,503,"Voice generation is temporarily unavailable.");});
app.post("/api/visuals/create",(req,res)=>{if(!requirePaid(req,res))return;return safeError(res,503,"Visual generation is temporarily unavailable.");});
app.get("/api/tracks",(req,res)=>res.json({ok:true,tracks:getSession(req).tracks}));
app.post("/api/tracks/:id/like",(req,res)=>{const session=getSession(req);const track=session.tracks.find((item)=>item.id===req.params.id);if(!track)return safeError(res,404,"Item not found.");track.liked=!track.liked;return res.json({ok:true,track});});
app.delete("/api/tracks/:id",(req,res)=>{const session=getSession(req);session.tracks=session.tracks.filter((item)=>item.id!==req.params.id);return res.json({ok:true});});

async function handleStripeWebhook(req,res){const secret=process.env.STRIPE_WEBHOOK_SECRET;if(!secret||!req.body)return res.status(400).send("Webhook not configured");const signature=req.get("stripe-signature")||"";const parts=Object.fromEntries(signature.split(",").map((part)=>part.trim().split("=",2)).filter((item)=>item.length===2));const timestamp=parts.t;if(!timestamp)return res.status(400).send("Invalid webhook signature");const payload=req.body.toString("utf8");const expected=crypto.createHmac("sha256",secret).update(`${timestamp}.${payload}`).digest("hex");const valid=parts.v1?.split(" ").some((candidate)=>candidate.length===expected.length&&crypto.timingSafeEqual(Buffer.from(candidate),Buffer.from(expected)));if(!valid)return res.status(400).send("Invalid webhook signature");let event;try{event=JSON.parse(payload);}catch{return res.status(400).send("Invalid event");}if(event.type?.startsWith("identity.verification_session.")){const object=event.data?.object;const token=object?.metadata?.session_token;if(token&&sessions.has(token)){const session=sessions.get(token);const record=verification.get(token)||{};record.kycStatus=object.status||record.kycStatus||"in_review";session.kycStatus=record.kycStatus;if(object.status=== "verified")session.verified=true;verification.set(token,record);}}return res.json({received:true});}

app.use((error,req,res,next)=>{if(res.headersSent)return next(error);return res.status(error.status||500).json({error:"The request could not be processed."});});
app.get("*",(req,res,next)=>{if(req.path.startsWith("/api/")||path.extname(req.path))return res.status(404).json({error:"Not found."});return res.sendFile(path.join(root,"public","index.html"),(error)=>error&&next(error));});
const server=app.listen(PORT,"0.0.0.0",()=>console.log(`PK AI Tool listening on port ${PORT}`));
function shutdown(){server.close(()=>process.exit(0));setTimeout(()=>process.exit(1000),10000).unref();}process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
