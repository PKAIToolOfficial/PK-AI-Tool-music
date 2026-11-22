const state = {
  credits: 50,
  dailyLimit: 50,
  tracks: [],
  currentTrack: null,
  config: null,
  subscription: {
    plan: 'Free',
    billingCycle: null,
    network: null,
    lastTxId: null,
    verifiedAt: null
  }
};

const els = {
  brandName: document.getElementById('brand-name'),
  navBtns: document.querySelectorAll('.nav-btn'),
  views: document.querySelectorAll('.view-section'),
  viewTitle: document.getElementById('view-title'),
  viewSubtitle: document.getElementById('view-subtitle'),
  creditCount: document.getElementById('credit-count'),
  creditBar: document.getElementById('credit-bar'),
  modePill: document.getElementById('mode-pill'),
  resetDailyBtn: document.getElementById('reset-daily-btn'),
  claimAdCreditsBtn: document.getElementById('claim-ad-credits-btn'),
  adInfoText: document.getElementById('ad-info-text'),

  customModeToggle: document.getElementById('custom-mode-toggle'),
  instrumentalToggle: document.getElementById('instrumental-toggle'),
  lyricsGroup: document.getElementById('lyrics-group'),
  trackLanguage: document.getElementById('track-language'),
  trackTitle: document.getElementById('track-title'),
  trackLyrics: document.getElementById('track-lyrics'),
  trackStyle: document.getElementById('track-style'),
  fillSampleLyrics: document.getElementById('fill-sample-lyrics'),
  qualityPreset: document.getElementById('quality-preset'),
  durationSelect: document.getElementById('duration-select'),
  voiceOriginality: document.getElementById('voice-originality'),
  voiceOriginalityVal: document.getElementById('voice-originality-val'),
  vocalFile: document.getElementById('vocal-file'),
  vocalFileName: document.getElementById('vocal-file-name'),
  generateBtn: document.getElementById('generate-btn'),
  generateStatus: document.getElementById('generate-status'),
  recentTracks: document.getElementById('recent-tracks'),
  libraryTracks: document.getElementById('library-tracks'),

  chatMessages: document.getElementById('chat-messages'),
  chatInput: document.getElementById('chat-input'),
  chatSendBtn: document.getElementById('chat-send-btn'),

  billingCycle: document.getElementById('billing-cycle'),
  cryptoNetwork: document.getElementById('crypto-network'),
  cryptoWalletsList: document.getElementById('crypto-wallets-list'),
  txHash: document.getElementById('tx-hash'),
  verifyCryptoBtn: document.getElementById('submit-crypto-btn'),
  cryptoStatus: document.getElementById('crypto-status'),
  envStatusList: document.getElementById('env-status-list'),

  audioEl: document.getElementById('audio-element'),
  playerTitle: document.getElementById('player-title'),
  playerStyle: document.getElementById('player-style'),
  playToggleBtn: document.getElementById('play-toggle-btn'),
  playerSeek: document.getElementById('player-seek'),
  playerTime: document.getElementById('player-time')
};

const viewMeta = {
  create: {
    title: 'Create Track Studio',
    subtitle: 'Create songs and vocals in any world language'
  },
  library: {
    title: 'My Library',
    subtitle: 'All generated tracks in your studio workspace'
  },
  chat: {
    title: 'Chat Assistant',
    subtitle: 'Lyrics, hooks, and production style prompts in any language'
  },
  upgrade: {
    title: 'Crypto Subscriptions',
    subtitle: 'Monthly & Yearly plans via direct Crypto wallet payment & TxID verification'
  },
  railway: {
    title: 'Railway Keys',
    subtitle: 'Environment variable configuration status from Railway'
  }
};

function saveLocalState() {
  localStorage.setItem(
    'pk_ai_tool_music_state',
    JSON.stringify({
      credits: state.credits,
      dailyLimit: state.dailyLimit,
      tracks: state.tracks,
      subscription: state.subscription
    })
  );
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem('pk_ai_tool_music_state');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (typeof parsed.credits === 'number') state.credits = parsed.credits;
    if (typeof parsed.dailyLimit === 'number') state.dailyLimit = parsed.dailyLimit;
    if (Array.isArray(parsed.tracks)) state.tracks = parsed.tracks;
    if (parsed.subscription) state.subscription = { ...state.subscription, ...parsed.subscription };
  } catch (_) {}
}

function getSelectedCost() {
  const opt = els.qualityPreset.options[els.qualityPreset.selectedIndex];
  return Number(opt?.dataset?.cost || 10);
}

function renderCredits() {
  els.creditCount.textContent = `${state.credits} / ${state.dailyLimit}`;
  const pct = Math.max(0, Math.min(100, (state.credits / Math.max(1, state.dailyLimit)) * 100));
  els.creditBar.style.width = `${pct}%`;

  const cost = getSelectedCost();
  const qText = els.qualityPreset.value === 'high' ? 'High Studio Quality' : 'Standard Quality';
  const planBadge =
    state.subscription.plan === 'Pro Crypto'
      ? ` · ${state.subscription.billingCycle || 'Active'}`
      : ' · Free';
  els.modePill.textContent = `${qText} (${cost} Credits)${planBadge}`;
}

function switchView(viewName) {
  els.navBtns.forEach((b) => b.classList.toggle('active', b.dataset.view === viewName));
  els.views.forEach((v) => v.classList.toggle('active', v.id === `view-${viewName}`));
  const meta = viewMeta[viewName] || viewMeta.create;
  els.viewTitle.textContent = meta.title;
  els.viewSubtitle.textContent = meta.subtitle;
}

function appendChat(role, text) {
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.textContent = text;
  els.chatMessages.appendChild(div);
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function downloadTrack(track) {
  if (!track.audioUrl) return;
  const link = document.createElement('a');
  link.href = track.audioUrl;
  link.download = `${(track.title || 'pk-ai-track').replace(/\s+/g, '-').toLowerCase()}.mp3`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function extendTrack(track) {
  switchView('create');
  els.trackTitle.value = `${track.title.replace(/\s*\(Take \d+\)$/i, '')} (Extended)`;
  if (track.style) els.trackStyle.value = track.style;
  if (track.language && els.trackLanguage) els.trackLanguage.value = track.language;
  if (track.lyrics) els.trackLyrics.value = `${track.lyrics}\n\n[Outro / Extended]\n`;
  els.generateStatus.textContent = `Loaded "${track.title}" into Create for extension.`;
}

function deleteTrack(trackId) {
  state.tracks = state.tracks.filter((t) => t.id !== trackId);
  if (state.currentTrack?.id === trackId) {
    state.currentTrack = null;
    els.audioEl.removeAttribute('src');
    els.playerTitle.textContent = 'No track selected';
    els.playerStyle.textContent = 'Select a track to play';
  }
  saveLocalState();
  renderAllTracks();
}

function renderTrackList(container, list) {
  if (!list.length) {
    container.innerHTML = `<div class="muted">No tracks generated yet.</div>`;
    return;
  }

  container.innerHTML = '';
  list.forEach((track) => {
    const card = document.createElement('div');
    card.className = 'track-card';

    const info = document.createElement('div');
    const titleEl = document.createElement('strong');
    titleEl.textContent = track.title;
    const metaEl = document.createElement('div');
    metaEl.className = 'muted';
    const modeTag = track.instrumental ? 'Instrumental' : 'Vocal';
    metaEl.textContent = `${track.language || 'Any Language'} · ${modeTag} · ${track.style || 'Studio'} · ${track.durationMinutes || 2} min · Originality ${track.voiceOriginality ?? 85}% · ${track.provider || 'api'}`;
    info.appendChild(titleEl);
    info.appendChild(metaEl);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';
    actions.style.flexWrap = 'wrap';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'primary-btn small-btn';
    playBtn.textContent = track.audioUrl ? 'Play' : 'Select';
    playBtn.addEventListener('click', () => playTrack(track));
    actions.appendChild(playBtn);

    if (track.audioUrl) {
      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.className = 'secondary-btn small-btn';
      dlBtn.textContent = 'Download';
      dlBtn.addEventListener('click', () => downloadTrack(track));
      actions.appendChild(dlBtn);
    }

    const extBtn = document.createElement('button');
    extBtn.type = 'button';
    extBtn.className = 'ghost-btn small-btn';
    extBtn.textContent = 'Extend';
    extBtn.addEventListener('click', () => extendTrack(track));
    actions.appendChild(extBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'ghost-btn small-btn';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteTrack(track.id));
    actions.appendChild(delBtn);

    card.appendChild(info);
    card.appendChild(actions);
    container.appendChild(card);
  });
}

function renderAllTracks() {
  renderTrackList(els.recentTracks, state.tracks.slice(0, 6));
  renderTrackList(els.libraryTracks, state.tracks);
}

function playTrack(track) {
  state.currentTrack = track;
  els.playerTitle.textContent = track.title;
  els.playerStyle.textContent = `${track.language || 'Any Language'} · ${track.style || ''}`;
  const totalSec = Number(track.durationMinutes || 2) * 60;
  const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');
  els.playerTime.textContent = `00:00 / ${mins}:${secs}`;

  if (track.audioUrl) {
    els.audioEl.src = track.audioUrl;
    els.audioEl.play().catch(() => {});
  } else {
    els.audioEl.removeAttribute('src');
  }
}

function renderWallets(wallets = {}) {
  const entries = [
    { key: 'USDT (ERC20)', addr: wallets.usdtErc20 },
    { key: 'TRX (TRC20)', addr: wallets.trxTrc20 },
    { key: 'BTC', addr: wallets.btc },
    { key: 'ETH (ERC20)', addr: wallets.ethErc20 },
    { key: 'BNB (BEP20)', addr: wallets.bnbBep20 }
  ];

  els.cryptoWalletsList.innerHTML = '';
  entries.forEach((item) => {
    const row = document.createElement('div');
    const label = document.createElement('strong');
    label.textContent = `${item.key}: `;
    const val = document.createElement('span');
    val.textContent = item.addr || 'Not set in Railway Variables';
    row.appendChild(label);
    row.appendChild(val);
    els.cryptoWalletsList.appendChild(row);
  });
}

function renderEnvStatus(providers = {}) {
  els.envStatusList.innerHTML = '';
  Object.entries(providers).forEach(([name, active]) => {
    const card = document.createElement('div');
    card.className = 'status-card';
    const title = document.createElement('div');
    title.textContent = name;
    const badge = document.createElement('div');
    badge.className = active ? 'status-ok' : 'status-missing';
    badge.textContent = active ? 'Configured in Railway' : 'Not Set';
    card.appendChild(title);
    card.appendChild(badge);
    els.envStatusList.appendChild(card);
  });
}

async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    const data = await r.json();
    state.config = data;
    if (data.appName) {
      els.brandName.textContent = data.appName;
      document.title = `${data.appName} — Global AI Music & Vocal Studio`;
    }
    if (typeof data.dailyFreeCredits === 'number' && !localStorage.getItem('pk_ai_tool_music_state')) {
      state.dailyLimit = data.dailyFreeCredits;
      state.credits = data.dailyFreeCredits;
    }
    renderCredits();
    renderWallets(data.wallets || {});
    renderEnvStatus(data.providers || {});
  } catch (_) {
    renderCredits();
  }
}

// Navigation
els.navBtns.forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// Controls
els.instrumentalToggle?.addEventListener('change', () => {
  if (els.lyricsGroup) {
    els.lyricsGroup.style.display = els.instrumentalToggle.checked ? 'none' : 'block';
  }
});

els.qualityPreset.addEventListener('change', renderCredits);
els.voiceOriginality.addEventListener('input', () => {
  els.voiceOriginalityVal.textContent = `${els.voiceOriginality.value}%`;
});

els.vocalFile.addEventListener('change', () => {
  const file = els.vocalFile.files?.[0];
  els.vocalFileName.textContent = file
    ? `Selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`
    : 'No audio file selected';
});

els.fillSampleLyrics.addEventListener('click', () => {
  if (!els.trackLyrics.value.trim()) {
    els.trackLyrics.value =
      '[Verse 1]\nUnder the open sky we find our voice\nEvery melody echoes across the night\n\n[Chorus]\nSing it out loud, let the rhythm rise\nA new sound shining bright';
  }
});

els.resetDailyBtn.addEventListener('click', () => {
  state.credits = state.dailyLimit;
  saveLocalState();
  renderCredits();
});

els.claimAdCreditsBtn.addEventListener('click', () => {
  state.credits += 10;
  if (state.credits > state.dailyLimit && state.subscription.plan === 'Free') {
    state.dailyLimit = state.credits;
  }
  saveLocalState();
  renderCredits();
  els.adInfoText.textContent = '+10 reward credits added from ad slot.';
});

// Track Generation (2 tracks per request)
els.generateBtn.addEventListener('click', async () => {
  const cost = getSelectedCost();
  if (state.credits < cost) {
    els.generateStatus.textContent = `Insufficient credits (${cost} required). Use Rewarded Ad or Crypto Subscription.`;
    return;
  }

  const payload = {
    language: els.trackLanguage?.value || 'Auto / Any Language',
    title: els.trackTitle.value.trim() || 'PK AI Track',
    lyrics: els.instrumentalToggle?.checked ? '' : els.trackLyrics.value.trim(),
    style: els.trackStyle.value.trim() || 'Natural Studio Vocals & Music',
    customMode: Boolean(els.customModeToggle?.checked ?? true),
    instrumental: Boolean(els.instrumentalToggle?.checked),
    qualityPreset: els.qualityPreset.value,
    voiceOriginality: Number(els.voiceOriginality.value),
    durationMinutes: Number(els.durationSelect.value),
    hasVocalSample: Boolean(els.vocalFile.files?.[0]),
    creditCost: cost
  };

  els.generateBtn.disabled = true;
  els.generateStatus.textContent = 'Generating 2 tracks via connected APIs...';

  try {
    const r = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();

    if (!r.ok || !data.ok) {
      els.generateStatus.textContent = data.error || 'Generation request failed.';
      return;
    }

    state.credits = Math.max(0, state.credits - cost);
    state.tracks = [...(data.tracks || []), ...state.tracks];
    saveLocalState();
    renderCredits();
    renderAllTracks();
    els.generateStatus.textContent = `Generated ${data.tracks?.length || 2} tracks (${cost} credits used).`;
  } catch (err) {
    els.generateStatus.textContent = err.message || 'Network error while generating tracks.';
  } finally {
    els.generateBtn.disabled = false;
  }
});

// Chat Assistant
async function sendChatMessage() {
  const msg = els.chatInput.value.trim();
  if (!msg) return;

  appendChat('user', msg);
  els.chatInput.value = '';
  els.chatSendBtn.disabled = true;

  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        mood: els.trackStyle.value.trim(),
        language: els.trackLanguage?.value || 'Auto / Any Language'
      })
    });
    const data = await r.json();
    if (!r.ok || !data.ok) {
      appendChat('bot', data.error || 'Unable to get response from LLM API.');
      return;
    }
    appendChat('bot', data.reply);
    if (data.suggestedStyle && !els.trackStyle.value.trim()) {
      els.trackStyle.value = data.suggestedStyle;
    }
  } catch (err) {
    appendChat('bot', err.message || 'Chat request failed.');
  } finally {
    els.chatSendBtn.disabled = false;
  }
}

els.chatSendBtn.addEventListener('click', sendChatMessage);
els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

// Crypto Subscription Verification (Monthly / Yearly only, no cards)
els.verifyCryptoBtn.addEventListener('click', async () => {
  const txHash = els.txHash.value.trim();
  const billingCycle = els.billingCycle?.value || 'Monthly';
  const network = els.cryptoNetwork?.value || 'USDT (ERC20)';

  if (!txHash || txHash.length < 10) {
    els.cryptoStatus.textContent = 'Please enter a valid Crypto Transaction Hash / TxID.';
    return;
  }

  els.verifyCryptoBtn.disabled = true;
  els.cryptoStatus.textContent = 'Verifying crypto transaction hash...';

  try {
    const r = await fetch('/api/crypto/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash, billingCycle, network })
    });
    const data = await r.json();

    if (!r.ok || !data.ok) {
      els.cryptoStatus.textContent = data.error || 'Could not verify TxID.';
      return;
    }

    const bonusCredits = billingCycle === 'Yearly' ? 2000 : 500;
    state.subscription = {
      plan: 'Pro Crypto',
      billingCycle,
      network,
      lastTxId: txHash,
      verifiedAt: data.verifiedAt || new Date().toISOString()
    };
    state.dailyLimit = Math.max(state.dailyLimit, bonusCredits);
    state.credits += bonusCredits;
    saveLocalState();
    renderCredits();
    els.cryptoStatus.textContent = `Verified (${network} · ${billingCycle}). Added +${bonusCredits} credits.`;
  } catch (err) {
    els.cryptoStatus.textContent = err.message || 'Verification error.';
  } finally {
    els.verifyCryptoBtn.disabled = false;
  }
});

// Audio Player controls
els.playToggleBtn.addEventListener('click', () => {
  if (!els.audioEl.src) return;
  if (els.audioEl.paused) els.audioEl.play().catch(() => {});
  else els.audioEl.pause();
});

els.audioEl.addEventListener('timeupdate', () => {
  if (!els.audioEl.duration || Number.isNaN(els.audioEl.duration)) return;
  const pct = (els.audioEl.currentTime / els.audioEl.duration) * 100;
  els.playerSeek.value = String(pct);
  const curMin = String(Math.floor(els.audioEl.currentTime / 60)).padStart(2, '0');
  const curSec = String(Math.floor(els.audioEl.currentTime % 60)).padStart(2, '0');
  const durMin = String(Math.floor(els.audioEl.duration / 60)).padStart(2, '0');
  const durSec = String(Math.floor(els.audioEl.duration % 60)).padStart(2, '0');
  els.playerTime.textContent = `${curMin}:${curSec} / ${durMin}:${durSec}`;
});

els.playerSeek.addEventListener('input', () => {
  if (!els.audioEl.duration || Number.isNaN(els.audioEl.duration)) return;
  els.audioEl.currentTime = (Number(els.playerSeek.value) / 100) * els.audioEl.duration;
});

loadLocalState();
renderCredits();
renderAllTracks();
loadConfig();
