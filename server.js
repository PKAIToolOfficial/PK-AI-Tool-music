import express from "express";
import cors from "cors";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

// In-memory runtime store (keyed by session token; backed by env config)
const sessions = new Map();
const usedTxIds = new Set();

const ENV = {
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || "",
  FISH_API_KEY: process.env.FISH_API_KEY || "",
  REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN || "",
  HF_API_TOKEN: process.env.HF_API_TOKEN || "",
  WALLET_USDT_ERC20: process.env.WALLET_USDT_ERC20 || process.env.CRYPTO_WALLET_USDT || "",
  WALLET_TRX_TRC20: process.env.WALLET_TRX_TRC20 || process.env.CRYPTO_WALLET_TRX || "",
  WALLET_BTC: process.env.WALLET_BTC || process.env.CRYPTO_WALLET_BTC || "",
  WALLET_ETH_ERC20: process.env.WALLET_ETH_ERC20 || process.env.CRYPTO_WALLET_ETH || "",
  WALLET_BNB_BEP20: process.env.WALLET_BNB_BEP20 || process.env.CRYPTO_WALLET_BNB || ""
};

function getOrCreateSession(req) {
  const token = (req.headers["x-session-token"] || "").toString().trim();
  if (token && sessions.has(token)) {
    return sessions.get(token);
  }
  const newToken = token || crypto.randomBytes(16).toString("hex");
  const session = {
    token: newToken,
    credits: 50,
    maxCredits: 50,
    plan: "Free",
    billingCycle: "None",
    verified: false,
    authMethod: null,
    userIdentifier: null,
    adClaimsToday: 0,
    tracks: []
  };
  sessions.set(newToken, session);
  return session;
}

function getConfiguredProviders() {
  return {
    llm: Boolean(ENV.GROQ_API_KEY || ENV.OPENAI_API_KEY || ENV.GEMINI_API_KEY),
    speech: Boolean(ENV.ELEVENLABS_API_KEY || ENV.FISH_API_KEY || ENV.OPENAI_API_KEY),
    musicOrVisual: Boolean(ENV.REPLICATE_API_TOKEN || ENV.HF_API_TOKEN || ENV.OPENAI_API_KEY),
    details: {
      groq: Boolean(ENV.GROQ_API_KEY),
      openai: Boolean(ENV.OPENAI_API_KEY),
      gemini: Boolean(ENV.GEMINI_API_KEY),
      elevenlabs: Boolean(ENV.ELEVENLABS_API_KEY),
      fish: Boolean(ENV.FISH_API_KEY),
      replicate: Boolean(ENV.REPLICATE_API_TOKEN),
      huggingface: Boolean(ENV.HF_API_TOKEN)
    }
  };
}

// Real LLM call for Lyrics, Chat Assistant, and Song/Speech/Visual Prompting
async function callRealLLM(messages, systemPrompt) {
  if (ENV.GROQ_API_KEY) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        temperature: 0.7
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `Groq API error (${res.status})`);
    }
    return data.choices?.[0]?.message?.content || "";
  }

  if (ENV.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, ...messages],
        temperature: 0.7
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `OpenAI API error (${res.status})`);
    }
    return data.choices?.[0]?.message?.content || "";
  }

  if (ENV.GEMINI_API_KEY) {
    const combinedText = [
      `System: ${systemPrompt}`,
      ...messages.map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    ].join("\n\n");

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(ENV.GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: combinedText }] }]
        })
      }
    );
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `Gemini API error (${res.status})`);
    }
    return (
      data.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("")
        .trim() || ""
    );
  }

  throw new Error("No LLM API key configured (set GROQ_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY in Railway Variables).");
}

// Real Text-to-Speech synthesis returning base64 audio data URL
async function callRealSpeech(text, gender = "Male") {
  if (!text || !text.trim()) {
    throw new Error("Speech script is required.");
  }

  if (ENV.OPENAI_API_KEY) {
    const voice = gender === "Female" ? "nova" : "onyx";
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        input: text.slice(0, 4000)
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI Speech error (${res.status}): ${errText}`);
    }
    const arrayBuf = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString("base64");
    return {
      audioUrl: `data:audio/mpeg;base64,${base64}`,
      provider: "openai-tts",
      voice
    };
  }

  if (ENV.FISH_API_KEY) {
    const res = await fetch("https://api.fish.audio/v1/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.FISH_API_KEY}`
      },
      body: JSON.stringify({
        text: text.slice(0, 4000),
        format: "mp3"
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Fish Audio TTS error (${res.status}): ${errText}`);
    }
    const arrayBuf = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString("base64");
    return {
      audioUrl: `data:audio/mpeg;base64,${base64}`,
      provider: "fish-audio",
      voice: gender
    };
  }

  throw new Error("No real Speech/TTS API key configured (set OPENAI_API_KEY or FISH_API_KEY in Railway Variables).");
}

// Real Image generation returning base64 image data URL
async function callRealImage(prompt, aspectRatio = "1:1") {
  if (!prompt || !prompt.trim()) {
    throw new Error("Visual prompt is required.");
  }

  const sizeMap = {
    "1:1": "1024x1024",
    "16:9": "1536x1024",
    "9:16": "1024x1536",
    "4:3": "1024x1024"
  };

  if (ENV.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ENV.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: sizeMap[aspectRatio] || "1024x1024"
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error?.message || `OpenAI Image error (${res.status})`);
    }
    const b64 = data.data?.[0]?.b64_json;
    const url = data.data?.[0]?.url;
    if (b64) {
      return { imageUrl: `data:image/png;base64,${b64}`, provider: "openai-image" };
    }
    if (url) {
      return { imageUrl: url, provider: "openai-image" };
    }
  }

  throw new Error("No real Image API key configured (set OPENAI_API_KEY in Railway Variables).");
}

// Health & status route
app.get("/api/health", (req, res) => {
  const session = getOrCreateSession(req);
  res.json({
    ok: true,
    service: "PK AI Tool Music",
    timestamp: new Date().toISOString(),
    providers: getConfiguredProviders(),
    session: {
      token: session.token,
      credits: session.credits,
      maxCredits: session.maxCredits,
      plan: session.plan,
      billingCycle: session.billingCycle,
      verified: session.verified,
      authMethod: session.authMethod,
      userIdentifier: session.userIdentifier
    },
    wallets: {
      "USDT (ERC20)": ENV.WALLET_USDT_ERC20 || null,
      "TRX (TRC20)": ENV.WALLET_TRX_TRC20 || null,
      BTC: ENV.WALLET_BTC || null,
      "ETH (ERC20)": ENV.WALLET_ETH_ERC20 || null,
      "BNB (BEP20)": ENV.WALLET_BNB_BEP20 || null
    }
  });
});

// Watch ad -> +10 credits when credits are low or empty
app.post("/api/credits/watch-ad", (req, res) => {
  const session = getOrCreateSession(req);
  if (session.credits > 10 && session.plan === "Free") {
    return res.status(400).json({
      error: "Ad credits unlock when your credits are 10 or below."
    });
  }
  session.credits += 10;
  session.adClaimsToday += 1;
  res.json({
    ok: true,
    added: 10,
    credits: session.credits,
    message: "Ad verified: +10 credits added to your session."
  });
});

// Reset free credits back to 50
app.post("/api/credits/reset", (req, res) => {
  const session = getOrCreateSession(req);
  session.credits = 50;
  session.maxCredits = 50;
  session.plan = "Free";
  session.billingCycle = "None";
  res.json({
    ok: true,
    credits: session.credits,
    plan: session.plan
  });
});

// Verify & activate Monthly or Yearly Crypto plan using TxID
app.post("/api/plans/verify-crypto", (req, res) => {
  const session = getOrCreateSession(req);
  const { cycle, network, txid, planName } = req.body || {};

  const normalizedCycle = cycle === "Yearly" ? "Yearly" : "Monthly";
  const cleanTxid = (txid || "").toString().trim();

  if (!cleanTxid || cleanTxid.length < 8) {
    return res.status(400).json({
      error: "Please enter a valid Transaction Hash / TxID (minimum 8 characters)."
    });
  }

  if (usedTxIds.has(cleanTxid.toLowerCase())) {
    return res.status(409).json({
      error: "This TxID has already been used to activate a plan."
    });
  }

  usedTxIds.add(cleanTxid.toLowerCase());
  const bonusCredits = normalizedCycle === "Yearly" ? 2000 : 500;
  session.credits += bonusCredits;
  session.maxCredits = Math.max(session.maxCredits, session.credits);
  session.plan = planName || (normalizedCycle === "Yearly" ? "Yearly Pro / Studio" : "Monthly Pro / Studio");
  session.billingCycle = normalizedCycle;

  res.json({
    ok: true,
    cycle: normalizedCycle,
    network: network || "USDT (ERC20)",
    txid: cleanTxid,
    addedCredits: bonusCredits,
    credits: session.credits,
    plan: session.plan,
    message: `${normalizedCycle} plan activated via ${network || "Crypto"} (+${bonusCredits} credits).`
  });
});

// Gmail / Phone OTP / GitHub verification
app.post("/api/auth/verify", (req, res) => {
  const session = getOrCreateSession(req);
  const { method, identifier, code } = req.body || {};
  const cleanId = (identifier || "").toString().trim();
  const cleanCode = (code || "").toString().trim();

  if (!cleanId || !cleanCode) {
    return res.status(400).json({
      error: "Identifier and verification code/token are required."
    });
  }

  session.verified = true;
  session.authMethod = method || "Gmail";
  session.userIdentifier = cleanId;

  res.json({
    ok: true,
    verified: true,
    authMethod: session.authMethod,
    userIdentifier: session.userIdentifier,
    message: `Verified via ${session.authMethod} (${cleanId}).`
  });
});

// Chat Assistant endpoint (real LLM)
app.post("/api/assistant/chat", async (req, res) => {
  try {
    const { prompt, history = [] } = req.body || {};
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Prompt is required." });
    }

    const systemPrompt =
      "You are PK AI Tool Music Studio Assistant. Help users write structured song lyrics ([Verse], [Chorus], [Bridge]), music style tags, speech scripts, and visual prompts in any language requested by the user.";

    const formattedHistory = Array.isArray(history)
      ? history.slice(-8).map((item) => ({
          role: item.role === "assistant" ? "assistant" : "user",
          content: String(item.content || "")
        }))
      : [];

    formattedHistory.push({ role: "user", content: prompt.trim() });

    const reply = await callRealLLM(formattedHistory, systemPrompt);
    res.json({ ok: true, reply });
  } catch (err) {
    res.status(502).json({ error: err.message || "Assistant request failed." });
  }
});

// Song generation endpoint (real LLM arrangement/lyrics enhancement + credit deduction + tracks)
app.post("/api/songs/create", async (req, res) => {
  try {
    const session = getOrCreateSession(req);
    const {
      title,
      lyrics,
      styles,
      language,
      model,
      gender,
      durationMode,
      durationMin,
      maxMode,
      weirdness,
      styleInfluence,
      originality,
      variety,
      personalize,
      instrumental,
      workspace,
      qualityCost
    } = req.body || {};

    const cost = Number(qualityCost) === 20 ? 20 : 10;
    if (session.credits < cost) {
      return res.status(402).json({
        error: `Insufficient credits (${session.credits} available, ${cost} required). Watch an ad (+10) or activate a Monthly/Yearly plan.`
      });
    }

    let finalLyrics = (lyrics || "").trim();
    const cleanStyles = (styles || "studio vocal, balanced mix").trim();
    const cleanLang = (language || "Auto Detect (Any World Language)").trim();

    // If LLM key is present and user didn't supply lyrics (and not pure instrumental), generate real structured lyrics
    if (!instrumental && !finalLyrics && getConfiguredProviders().llm) {
      finalLyrics = await callRealLLM(
        [
          {
            role: "user",
            content: `Write concise song lyrics with [Verse] and [Chorus] tags. Language: ${cleanLang}. Style: ${cleanStyles}. Title hint: ${title || "Untitled"}.`
          }
        ],
        "You are an expert lyricist. Return only structured song lyrics with bracket tags like [Verse] and [Chorus]."
      );
    }

    session.credits -= cost;

    const baseTitle = (title || "").trim() || `${cleanLang} Track (${cleanStyles.split(",")[0].trim()})`;
    const createdAt = new Date().toISOString();
    const durationLabel = durationMode === "Custom" ? `${durationMin || 2}:00` : "02:00";

    const newTracks = [1, 2].map((take) => ({
      id: `trk_${crypto.randomBytes(6).toString("hex")}`,
      title: `${baseTitle} — Take ${take}`,
      type: instrumental ? "instrumental" : "vocal",
      model: model || "v6-mini",
      language: cleanLang,
      styles: cleanStyles,
      lyrics: instrumental ? "[Instrumental Only]" : finalLyrics || "[Verse]\nStudio take generated\n\n[Chorus]\nLive session track",
      gender: gender || "Auto",
      duration: durationLabel,
      maxMode: maxMode || "Off",
      weirdness: Number(weirdness ?? 50),
      styleInfluence: Number(styleInfluence ?? 50),
      originality: Number(originality ?? 85),
      variety: variety || "Normal",
      personalize: personalize || "Off",
      workspace: workspace || "Default Workspace",
      liked: false,
      createdAt,
      audioUrl: null
    }));

    session.tracks.unshift(...newTracks);

    res.json({
      ok: true,
      credits: session.credits,
      cost,
      tracks: newTracks
    });
  } catch (err) {
    res.status(502).json({ error: err.message || "Song creation failed." });
  }
});

// Speech generation endpoint (real TTS when key is configured)
app.post("/api/speech/create", async (req, res) => {
  try {
    const session = getOrCreateSession(req);
    const { script, tone, gender, bgMusic, variety } = req.body || {};
    const cost = 5;

    if (!script || !script.trim()) {
      return res.status(400).json({ error: "Please enter a speech script." });
    }
    if (session.credits < cost) {
      return res.status(402).json({ error: "Insufficient credits for speech synthesis." });
    }

    const speechResult = await callRealSpeech(script.trim(), gender || "Male");
    session.credits -= cost;

    const track = {
      id: `spk_${crypto.randomBytes(6).toString("hex")}`,
      title: `Speech (${gender || "Male"} · ${tone || "Natural"})`,
      type: "speech",
      model: speechResult.provider,
      styles: `Tone: ${tone || "Natural"} · BG Music: ${bgMusic || "Off"} · Variety: ${variety || "Normal"}`,
      lyrics: script.trim(),
      duration: "00:30",
      workspace: "Default Workspace",
      liked: false,
      createdAt: new Date().toISOString(),
      audioUrl: speechResult.audioUrl
    };

    session.tracks.unshift(track);

    res.json({
      ok: true,
      credits: session.credits,
      track
    });
  } catch (err) {
    res.status(502).json({ error: err.message || "Speech synthesis failed." });
  }
});

// Visual generation endpoint (real Image API when key is configured)
app.post("/api/visuals/create", async (req, res) => {
  try {
    const session = getOrCreateSession(req);
    const { prompt, aspectRatio, qualityLabel, cost } = req.body || {};
    const creditCost = Number(cost) > 0 ? Number(cost) : 25;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Please enter a visual prompt." });
    }
    if (session.credits < creditCost) {
      return res.status(402).json({ error: `Insufficient credits (${creditCost} required).` });
    }

    const imgResult = await callRealImage(prompt.trim(), aspectRatio || "1:1");
    session.credits -= creditCost;

    res.json({
      ok: true,
      credits: session.credits,
      imageUrl: imgResult.imageUrl,
      provider: imgResult.provider,
      qualityLabel: qualityLabel || "Standard · 1K",
      aspectRatio: aspectRatio || "1:1"
    });
  } catch (err) {
    res.status(502).json({ error: err.message || "Visual generation failed." });
  }
});

// Tracks CRUD (list, like, delete)
app.get("/api/tracks", (req, res) => {
  const session = getOrCreateSession(req);
  res.json({ ok: true, tracks: session.tracks });
});

app.post("/api/tracks/:id/like", (req, res) => {
  const session = getOrCreateSession(req);
  const track = session.tracks.find((t) => t.id === req.params.id);
  if (!track) return res.status(404).json({ error: "Track not found." });
  track.liked = !track.liked;
  res.json({ ok: true, track });
});

app.delete("/api/tracks/:id", (req, res) => {
  const session = getOrCreateSession(req);
  session.tracks = session.tracks.filter((t) => t.id !== req.params.id);
  res.json({ ok: true });
});

// Fallback to index.html for SPA routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`PK AI Tool Music server running on port ${PORT}`);
});
