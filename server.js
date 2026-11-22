const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const APP_NAME = process.env.APP_NAME || 'PK AI Tool Music';

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check for Railway
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', app: APP_NAME });
});

// Safe config & provider status (never exposes secret keys)
app.get('/api/config', (req, res) => {
  const dailyFreeCredits = Number(process.env.DAILY_FREE_CREDITS || 50);
  const tracksPerGenerate = Number(process.env.TRACKS_PER_GENERATE || 2);

  res.json({
    appName: APP_NAME,
    dailyFreeCredits,
    tracksPerGenerate,
    wallets: {
      usdtErc20: process.env.WALLET_USDT_ERC20 || '',
      trxTrc20: process.env.WALLET_TRX_TRC20 || '',
      btc: process.env.WALLET_BTC || '',
      ethErc20: process.env.WALLET_ETH_ERC20 || '',
      bnbBep20: process.env.WALLET_BNB_BEP20 || ''
    },
    providers: {
      groq: Boolean(process.env.GROQ_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
      deepseek: Boolean(process.env.DEEPSEEK_API_KEY),
      fal: Boolean(process.env.FAL_KEY),
      soundverse: Boolean(process.env.SOUNDVERSE_API_KEY),
      replicate: Boolean(process.env.REPLICATE_API_TOKEN),
      huggingface: Boolean(process.env.HUGGINGFACE_API_KEY),
      fishAudio: Boolean(process.env.FISH_AUDIO_API_KEY),
      elevenLabs: Boolean(process.env.ELEVENLABS_API_KEY),
      auphonic: Boolean(process.env.AUPHONIC_API_KEY),
      supabase: Boolean(process.env.SUPABASE_ANON_KEY),
      firebase: Boolean(process.env.FIREBASE_API_KEY),
      cloudflareR2: Boolean(process.env.R2_API_TOKEN)
    }
  });
});

// Real LLM call helper (Groq -> OpenAI -> DeepSeek -> Gemini)
async function callTextLLM(promptText, styleHint = '') {
  const systemPrompt =
    'You are the songwriting, music style, and studio assistant inside PK AI Tool Music. Write clear song titles, structured lyrics ([Verse], [Chorus], [Bridge]), and detailed natural music production/vocal style prompts.';

  const userPrompt = styleHint
    ? `Request: ${promptText}\nPreferred Style/Mood: ${styleHint}`
    : `Request: ${promptText}`;

  // 1. Groq (OpenAI-compatible)
  if (process.env.GROQ_API_KEY) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7
      })
    });
    if (r.ok) {
      const d = await r.json();
      const text = d?.choices?.[0]?.message?.content?.trim();
      if (text) return { provider: 'groq', text };
    }
  }

  // 2. OpenAI
  if (process.env.OPENAI_API_KEY) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7
      })
    });
    if (r.ok) {
      const d = await r.json();
      const text = d?.choices?.[0]?.message?.content?.trim();
      if (text) return { provider: 'openai', text };
    }
  }

  // 3. DeepSeek
  if (process.env.DEEPSEEK_API_KEY) {
    const r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7
      })
    });
    if (r.ok) {
      const d = await r.json();
      const text = d?.choices?.[0]?.message?.content?.trim();
      if (text) return { provider: 'deepseek', text };
    }
  }

  // 4. Gemini REST API
  if (process.env.GEMINI_API_KEY) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }]
      })
    });
    if (r.ok) {
      const d = await r.json();
      const text = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) return { provider: 'gemini', text };
    }
  }

  return null;
}

// Chat & Lyrics / Style endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, mood } = req.body || {};
    const promptText = String(message || '').trim();

    if (!promptText) {
      return res.status(400).json({ ok: false, error: 'براہ کرم پیغام یا موضوع لکھیں۔' });
    }

    const llmResult = await callTextLLM(promptText, mood);

    if (llmResult) {
      return res.json({
        ok: true,
        provider: llmResult.provider,
        reply: llmResult.text,
        suggestedTitle: promptText.slice(0, 40) || 'PK AI Original Song',
        suggestedStyle: mood
          ? `${mood}, natural studio vocals, clean mix, rich instrumentation`
          : 'natural studio vocals, clear acoustic & rhythmic arrangement, balanced mastering'
      });
    }

    return res.status(400).json({
      ok: false,
      error: 'Railway Variables میں کوئی فعال LLM API Key (GROQ / OPENAI / DEEPSEEK / GEMINI) نہیں ملی۔'
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Chat API error' });
  }
});

// Vocal / TTS / Audio generation helper (Fish Audio / ElevenLabs / fal.ai)
async function generateAudioFromApi({ title, lyrics, style, qualityPreset, durationMinutes, voiceOriginality }) {
  const cleanText = String(lyrics || title || style || 'PK AI Tool Music Track').trim();
  const isHigh = qualityPreset === 'high';

  // Try Fish Audio TTS if configured
  if (process.env.FISH_AUDIO_API_KEY) {
    const r = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}`,
        model: 's2.1-pro-free'
      },
      body: JSON.stringify({
        text: cleanText.slice(0, 1500),
        format: 'mp3'
      })
    });

    if (r.ok) {
      const arrayBuffer = await r.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');
      return {
        provider: 'fish-audio',
        audioUrl: `data:audio/mpeg;base64,${base64Audio}`,
        meta: {
          title,
          style,
          qualityPreset,
          durationMinutes,
          voiceOriginality,
          highQualityMode: isHigh
        }
      };
    }
  }

  // Try ElevenLabs TTS if configured
  if (process.env.ELEVENLABS_API_KEY) {
    const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${defaultVoiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: cleanText.slice(0, 1500),
        model_id: 'eleven_multilingual_v2'
      })
    });

    if (r.ok) {
      const arrayBuffer = await r.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');
      return {
        provider: 'elevenlabs',
        audioUrl: `data:audio/mpeg;base64,${base64Audio}`,
        meta: {
          title,
          style,
          qualityPreset,
          durationMinutes,
          voiceOriginality,
          highQualityMode: isHigh
        }
      };
    }
  }

  return {
    provider: 'configured-pipeline',
    audioUrl: null,
    meta: {
      title,
      style,
      qualityPreset,
      durationMinutes,
      voiceOriginality,
      highQualityMode: isHigh,
      note: 'API key present; connect specific music/audio model endpoint for non-TTS generation.'
    }
  };
}

// Generate 2 tracks per generation request
app.post('/api/generate', async (req, res) => {
  try {
    const {
      title,
      lyrics,
      style,
      qualityPreset,
      voiceOriginality,
      durationMinutes,
      hasVocalSample,
      creditCost
    } = req.body || {};

    const cleanTitle = String(title || 'PK AI Track').trim() || 'PK AI Track';
    const cleanStyle = String(style || 'Natural Studio Vocals & Music').trim();
    const cost = Number(creditCost || (qualityPreset === 'high' ? 20 : 10));
    const originality = Number(voiceOriginality ?? 85);
    const duration = Number(durationMinutes || 2);

    const hasAnyAudioOrMusicKey = Boolean(
      process.env.FAL_KEY ||
        process.env.SOUNDVERSE_API_KEY ||
        process.env.REPLICATE_API_TOKEN ||
        process.env.HUGGINGFACE_API_KEY ||
        process.env.FISH_AUDIO_API_KEY ||
        process.env.ELEVENLABS_API_KEY
    );

    if (!hasAnyAudioOrMusicKey) {
      return res.status(400).json({
        ok: false,
        error: 'Railway Variables میں کوئی میوزک یا وائس API Key سیٹ نہیں ہے۔'
      });
    }

    const generated1 = await generateAudioFromApi({
      title: `${cleanTitle} (Take 1)`,
      lyrics,
      style: cleanStyle,
      qualityPreset: qualityPreset || 'standard',
      durationMinutes: duration,
      voiceOriginality: originality
    });

    const generated2 = await generateAudioFromApi({
      title: `${cleanTitle} (Take 2)`,
      lyrics,
      style: cleanStyle,
      qualityPreset: qualityPreset || 'standard',
      durationMinutes: duration,
      voiceOriginality: originality
    });

    const tracks = [generated1, generated2].map((item, idx) => ({
      id: `${Date.now()}-${idx + 1}`,
      title: `${cleanTitle} (Take ${idx + 1})`,
      style: cleanStyle,
      lyrics: lyrics || '',
      qualityPreset: qualityPreset || 'standard',
      voiceOriginality: originality,
      durationMinutes: duration,
      hasVocalSample: Boolean(hasVocalSample),
      creditUsed: idx === 0 ? cost : 0,
      provider: item.provider,
      audioUrl: item.audioUrl,
      createdAt: new Date().toISOString()
    }));

    return res.json({ ok: true, tracks });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Generation error' });
  }
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} running on port ${PORT}`);
});
