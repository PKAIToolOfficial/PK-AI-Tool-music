const state = {
  token: localStorage.getItem("pk_session_token") || "",
  credits: 50,
  maxCredits: 50,
  plan: "Free",
  billingCycle: "None",
  verified: false,
  authMethod: null,
  userIdentifier: null,
  tracks: [],
  activeTrackId: null,
  selectedGender: "Auto",
  selectedMaxMode: "Off",
  selectedPersonalize: "Off",
  selectedCharacter: "None",
  attachedMedia: "",
  authMethodTab: "Gmail",
  planCycleTab: "Monthly",
  chatHistory: [],
  providers: null,
  wallets: {}
};

const apiHeaders = () => {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers["x-session-token"] = state.token;
  return headers;
};

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...apiHeaders(), ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

function updateCreditUI() {
  const pct = Math.max(0, Math.min(100, Math.round((state.credits / Math.max(1, state.maxCredits)) * 100)));
  const disp = document.getElementById("credits-display");
  const meter = document.getElementById("credits-meter");
  const banner = document.getElementById("out-of-credits-banner");
  const planBadge = document.getElementById("active-plan-badge");
  const sessionBadge = document.getElementById("session-badge");

  if (disp) disp.textContent = `${state.credits} / ${state.maxCredits}`;
  if (meter) meter.style.width = `${pct}%`;
  if (banner) banner.classList.toggle("show", state.credits <= 10);

  if (planBadge) {
    planBadge.textContent =
      state.billingCycle && state.billingCycle !== "None"
        ? `${state.plan} (${state.billingCycle})`
        : `${state.plan} Plan`;
  }

  if (sessionBadge) {
    sessionBadge.textContent = state.verified
      ? `Verified · ${state.authMethod}: ${state.userIdentifier}`
      : "Guest Session · Not Verified";
  }
}

function renderWallets() {
  const box = document.getElementById("wallet-addresses-box");
  if (!box) return;
  const entries = Object.entries(state.wallets || {});
  if (!entries.length) {
    box.innerHTML = `<div class="muted">Set WALLET_USDT_ERC20, WALLET_TRX_TRC20, WALLET_BTC, WALLET_ETH_ERC20, or WALLET_BNB_BEP20 in Railway Variables.</div>`;
    return;
  }
  box.innerHTML = entries
    .map(
      ([net, addr]) => `
      <div style="padding:8px 10px;border-radius:8px;background:#ffffff;border:1px solid var(--border-light);">
        <strong style="font-size:12px;">${escapeHtml(net)}</strong>
        <div class="muted" style="font-size:12px;">${
          addr ? escapeHtml(addr) : "Not configured in Railway Variables yet"
        }</div>
      </div>`
    )
    .join("");
}

function renderRailwayKeys() {
  const grid = document.getElementById("railway-keys-grid");
  if (!grid) return;
  const d = state.providers?.details || {};
  const items = [
    { name: "GROQ_API_KEY", active: d.groq, role: "Fast Lyrics, Chat & Prompt LLM" },
    { name: "OPENAI_API_KEY", active: d.openai, role: "LLM, TTS Speech & Image Generation" },
    { name: "GEMINI_API_KEY", active: d.gemini, role: "Gemini Lyrics & Studio Assistant" },
    { name: "ELEVENLABS_API_KEY", active: d.elevenlabs, role: "Voice & Speech Provider Key" },
    { name: "FISH_API_KEY", active: d.fish, role: "Speech / Audio Synthesis Key" },
    { name: "REPLICATE_API_TOKEN", active: d.replicate, role: "Music / Audio / Visual Models" }
  ];

  grid.innerHTML = items
    .map(
      (k) => `
      <div class="card">
        <div class="between">
          <strong style="font-size:13px;">${escapeHtml(k.name)}</strong>
          <span class="${k.active ? "badge-green" : "badge-purple"}">${k.active ? "Set on Server" : "Not Set"}</span>
        </div>
        <p class="muted mt-12">${escapeHtml(k.role)}</p>
      </div>`
    )
    .join("");
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderTrackList(containerId, list) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="muted">No tracks yet. Create a song or speech track in Studio.</div>`;
    return;
  }

  container.innerHTML = list
    .map(
      (t) => `
      <div class="track-card mt-12">
        <div class="flex-gap">
          <div class="track-thumb">${escapeHtml(t.duration || "02:00")}</div>
          <div>
            <strong>${escapeHtml(t.title)}</strong>
            <div class="muted">
              ${escapeHtml(t.model || "v6-mini")} · ${escapeHtml(t.styles || "")} · Workspace: ${escapeHtml(t.workspace || "Default Workspace")}
            </div>
          </div>
        </div>
        <div class="flex-gap">
          <button type="button" class="btn-green" onclick="playTrackById('${t.id}')">Play</button>
          <button type="button" class="btn-soft" onclick="toggleLikeTrack('${t.id}')">${t.liked ? "Liked" : "Like"}</button>
          <button type="button" class="btn-soft" onclick="extendTrackById('${t.id}')">Extend</button>
          <button type="button" class="btn-soft" onclick="downloadTrackById('${t.id}')">Download</button>
          <button type="button" class="btn-soft" onclick="deleteTrackById('${t.id}')">Delete</button>
        </div>
      </div>`
    )
    .join("");
}

function renderAllTracks() {
  renderTrackList("recent-tracks-container", state.tracks.slice(0, 6));

  const filterVal = document.getElementById("lib-filter-select")?.value || "all";
  const wsVal = document.getElementById("lib-workspace-select")?.value || "all";
  const qVal = (document.getElementById("lib-search-input")?.value || "").trim().toLowerCase();

  const filtered = state.tracks.filter((t) => {
    if (filterVal === "liked" && !t.liked) return false;
    if (filterVal === "instrumental" && t.type !== "instrumental") return false;
    if (filterVal === "vocal" && t.type !== "vocal") return false;
    if (wsVal !== "all" && (t.workspace || "Default Workspace") !== wsVal) return false;
    if (qVal) {
      const hay = `${t.title} ${t.styles} ${t.lyrics}`.toLowerCase();
      if (!hay.includes(qVal)) return false;
    }
    return true;
  });

  renderTrackList("library-tracks-container", filtered);
}

window.playTrackById = function (id) {
  const track = state.tracks.find((t) => t.id === id);
  if (!track) return;
  state.activeTrackId = track.id;

  const titleEl = document.getElementById("player-track-title");
  const metaEl = document.getElementById("player-track-meta");
  const clockEl = document.getElementById("player-clock");
  const audioEl = document.getElementById("player-audio-el");

  if (titleEl) titleEl.textContent = track.title;
  if (metaEl) metaEl.textContent = `${track.model} · ${track.styles}`;
  if (clockEl) clockEl.textContent = `00:00 / ${track.duration || "02:00"}`;

  if (audioEl) {
    if (track.audioUrl) {
      audioEl.src = track.audioUrl;
      audioEl.play().catch(() => {});
    } else {
      audioEl.removeAttribute("src");
    }
  }
};

window.toggleLikeTrack = async function (id) {
  try {
    const res = await apiFetch(`/api/tracks/${encodeURIComponent(id)}/like`, { method: "POST" });
    const idx = state.tracks.findIndex((t) => t.id === id);
    if (idx !== -1 && res.track) state.tracks[idx] = res.track;
    renderAllTracks();
  } catch (err) {
    alert(err.message);
  }
};

window.extendTrackById = function (id) {
  const track = state.tracks.find((t) => t.id === id);
  if (!track) return;
  switchMainSection("studio");
  const titleInput = document.getElementById("song-title-opt");
  const stylesInput = document.getElementById("song-styles");
  if (titleInput) titleInput.value = `${track.title} (Extended)`;
  if (stylesInput && track.styles) stylesInput.value = track.styles;
  document.getElementById("song-create-status").textContent = `Loaded "${track.title}" into Studio for extension.`;
};

window.downloadTrackById = function (id) {
  const track = state.tracks.find((t) => t.id === id);
  if (!track) return;

  if (track.audioUrl) {
    const a = document.createElement("a");
    a.href = track.audioUrl;
    a.download = `${track.title.replace(/[^a-z0-9-_]+/gi, "_")}.mp3`;
    a.click();
    return;
  }

  const content = [
    `Title: ${track.title}`,
    `Model: ${track.model}`,
    `Language: ${track.language || "Auto"}`,
    `Styles: ${track.styles || ""}`,
    `Duration: ${track.duration || "02:00"}`,
    "",
    track.lyrics || ""
  ].join("\n");

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${track.title.replace(/[^a-z0-9-_]+/gi, "_")}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

window.deleteTrackById = async function (id) {
  try {
    await apiFetch(`/api/tracks/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.tracks = state.tracks.filter((t) => t.id !== id);
    renderAllTracks();
  } catch (err) {
    alert(err.message);
  }
};

window.focusCryptoPlan = function (planName, cycle) {
  const cycleSel = document.getElementById("crypto-plan-cycle");
  const msg = document.getElementById("crypto-activate-msg");
  if (cycleSel) cycleSel.value = cycle === "Yearly" ? "Yearly" : "Monthly";
  if (msg) msg.textContent = `Selected ${planName} (${cycle}). Send crypto to a configured wallet and submit TxID below.`;
  document.getElementById("crypto-txid-input")?.focus();
};

function switchMainSection(sectionName) {
  document.querySelectorAll(".view-section").forEach((sec) => {
    sec.classList.toggle("active", sec.id === `section-${sectionName}`);
  });
  document.querySelectorAll(".side-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === sectionName);
  });
}

function bindUI() {
  // Sidebar navigation
  document.querySelectorAll(".side-link").forEach((btn) => {
    btn.addEventListener("click", () => switchMainSection(btn.dataset.section));
  });

  document.getElementById("quick-login-btn")?.addEventListener("click", () => switchMainSection("auth"));
  document.getElementById("banner-plan-trigger")?.addEventListener("click", () => switchMainSection("plans"));

  // Studio tabs (Songs / Speech / Visuals)
  document.querySelectorAll(".studio-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.studioTab;
      document.querySelectorAll(".studio-mode-btn").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".sub-mode-panel").forEach((p) => p.classList.toggle("active", p.id === `studio-${tab}`));
    });
  });

  // Simple / Advanced toggle for Songs
  document.querySelectorAll("[data-complexity]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-complexity]").forEach((b) => b.classList.toggle("active", b === btn));
      const isSimple = btn.dataset.complexity === "simple";
      const lyricsField = document.getElementById("song-lyrics-field");
      if (lyricsField) lyricsField.style.display = isSimple ? "block" : "block";
    });
  });

  // Sliders
  const bindSlider = (id, outId) => {
    const inp = document.getElementById(id);
    const out = document.getElementById(outId);
    inp?.addEventListener("input", () => {
      if (out) out.textContent = `${inp.value}%`;
    });
  };
  bindSlider("slider-weirdness", "val-weirdness");
  bindSlider("slider-style-inf", "val-style-inf");
  bindSlider("slider-originality", "val-originality");

  // Gender / MaxMode / Personalize buttons
  document.querySelectorAll(".gender-pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedGender = btn.dataset.gender;
      document.querySelectorAll(".gender-pick").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  document.querySelectorAll(".maxmode-pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedMaxMode = btn.dataset.max;
      document.querySelectorAll(".maxmode-pick").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  document.querySelectorAll(".pers-pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedPersonalize = btn.dataset.pers;
      document.querySelectorAll(".pers-pick").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  // Quick style tags
  document.querySelectorAll(".style-tag").forEach((tagBtn) => {
    tagBtn.addEventListener("click", () => {
      tagBtn.classList.toggle("active");
      const stylesInp = document.getElementById("song-styles");
      if (!stylesInp) return;
      const activeTags = [...document.querySelectorAll(".style-tag.active")].map((el) => el.dataset.tag);
      stylesInp.value = activeTags.join(", ");
    });
  });

  // Sample lyrics helper
  document.getElementById("btn-sample-lyrics")?.addEventListener("click", () => {
    const ta = document.getElementById("song-lyrics");
    if (ta) {
      ta.value = "[Verse]\nWrite your lyrics here, one line at a time\nEvery line you add is a line we'll sing\n\n[Chorus]\nA chorus to repeat with rhythm and soul";
    }
  });

  // Media attachment buttons (+ Audio / + Voice / + Inspo)
  const hiddenInput = document.getElementById("hidden-media-input");
  const attachNote = document.getElementById("media-attach-note");

  document.getElementById("btn-add-audio")?.addEventListener("click", () => {
    if (!hiddenInput) return;
    hiddenInput.accept = "audio/*";
    hiddenInput.click();
  });

  document.getElementById("btn-add-inspo")?.addEventListener("click", () => {
    if (!hiddenInput) return;
    hiddenInput.accept = "image/*,audio/*";
    hiddenInput.click();
  });

  document.getElementById("btn-add-voice")?.addEventListener("click", () => {
    const voiceName = prompt("Enter Voice preset / name (e.g., Warm Tenor, Clear Alto):");
    if (voiceName && voiceName.trim()) {
      state.attachedMedia = `Voice: ${voiceName.trim()}`;
      if (attachNote) attachNote.textContent = `Attached: ${state.attachedMedia}`;
    }
  });

  hiddenInput?.addEventListener("change", () => {
    const f = hiddenInput.files?.[0];
    if (f) {
      state.attachedMedia = `File: ${f.name}`;
      if (attachNote) attachNote.textContent = `Attached: ${state.attachedMedia}`;
    }
  });

  // Visuals mode toggle (Image / Video) & Character
  document.getElementById("vis-mode-image")?.addEventListener("click", (e) => {
    e.target.classList.add("active");
    document.getElementById("vis-mode-video")?.classList.remove("active");
  });
  document.getElementById("vis-mode-video")?.addEventListener("click", (e) => {
    e.target.classList.add("active");
    document.getElementById("vis-mode-image")?.classList.remove("active");
  });
  document.getElementById("vis-add-character")?.addEventListener("click", () => {
    const charName = prompt("Choose or create Character (e.g., Disconaut, Chrome Contessa, Disco Dude):");
    if (charName && charName.trim()) {
      state.selectedCharacter = charName.trim();
      const badge = document.getElementById("selected-character-badge");
      if (badge) badge.textContent = `Character: ${state.selectedCharacter}`;
    }
  });

  // Create Song
  document.getElementById("btn-create-song")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("song-create-status");
    const btn = document.getElementById("btn-create-song");
    try {
      if (btn) btn.disabled = true;
      if (statusEl) statusEl.textContent = "Generating 2 tracks via server...";

      const payload = {
        title: document.getElementById("song-title-opt")?.value || "",
        lyrics: document.getElementById("song-lyrics")?.value || "",
        styles: document.getElementById("song-styles")?.value || "",
        language: document.getElementById("song-language")?.value || "Auto Detect (Any World Language)",
        model: document.getElementById("song-model-select")?.value || "v6-mini",
        gender: state.selectedGender,
        durationMode: document.getElementById("song-duration-mode")?.value || "Auto",
        durationMin: Number(document.getElementById("song-duration-min")?.value || 2),
        maxMode: state.selectedMaxMode,
        weirdness: Number(document.getElementById("slider-weirdness")?.value || 50),
        styleInfluence: Number(document.getElementById("slider-style-inf")?.value || 50),
        originality: Number(document.getElementById("slider-originality")?.value || 85),
        variety: document.getElementById("song-variety")?.value || "Normal",
        personalize: state.selectedPersonalize,
        instrumental: Boolean(document.getElementById("chk-instrumental")?.checked),
        workspace: document.getElementById("song-workspace")?.value || "Default Workspace",
        qualityCost: Number(document.getElementById("song-quality")?.value || 10)
      };

      const data = await apiFetch("/api/songs/create", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      state.credits = data.credits;
      if (Array.isArray(data.tracks)) {
        state.tracks.unshift(...data.tracks);
      }
      updateCreditUI();
      renderAllTracks();
      if (statusEl) statusEl.textContent = `Created ${data.tracks?.length || 2} tracks (-${data.cost} credits).`;
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Create Speech
  document.getElementById("btn-create-speech")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("speech-status");
    try {
      if (statusEl) statusEl.textContent = "Synthesizing speech...";
      const data = await apiFetch("/api/speech/create", {
        method: "POST",
        body: JSON.stringify({
          script: document.getElementById("speech-script")?.value || "",
          tone: document.getElementById("speech-tone")?.value || "",
          gender: document.getElementById("speech-gender")?.value || "Male",
          bgMusic: document.getElementById("speech-bg-music")?.value || "Off",
          variety: document.getElementById("speech-variety")?.value || "Normal"
        })
      });
      state.credits = data.credits;
      if (data.track) state.tracks.unshift(data.track);
      updateCreditUI();
      renderAllTracks();
      if (statusEl) statusEl.textContent = "Speech track created and added to Library.";
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    }
  });

  // Create Visual
  document.getElementById("btn-create-visual")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("visual-status");
    const sel = document.getElementById("visual-quality");
    const opt = sel?.options[sel.selectedIndex];
    const cost = Number(opt?.dataset?.cost || 25);

    try {
      if (statusEl) statusEl.textContent = "Generating visual...";
      const data = await apiFetch("/api/visuals/create", {
        method: "POST",
        body: JSON.stringify({
          prompt: document.getElementById("visual-prompt")?.value || "",
          aspectRatio: document.getElementById("visual-aspect")?.value || "1:1",
          qualityLabel: sel?.value || "Standard · 1K",
          cost
        })
      });
      state.credits = data.credits;
      updateCreditUI();
      if (statusEl) {
        statusEl.innerHTML = data.imageUrl
          ? `Visual generated: <a href="${data.imageUrl}" target="_blank" rel="noopener">Open generated image</a>`
          : "Visual request completed.";
      }
    } catch (err) {
      if (statusEl) statusEl.textContent = `Error: ${err.message}`;
    }
  });

  // Watch Ad (+10 Credits)
  const handleWatchAd = async () => {
    try {
      const data = await apiFetch("/api/credits/watch-ad", { method: "POST" });
      state.credits = data.credits;
      state.maxCredits = Math.max(state.maxCredits, state.credits);
      updateCreditUI();
      alert(data.message || "+10 credits added.");
    } catch (err) {
      alert(err.message);
    }
  };
  document.getElementById("watch-ad-btn")?.addEventListener("click", handleWatchAd);
  document.getElementById("banner-ad-trigger")?.addEventListener("click", handleWatchAd);

  // Reset credits
  document.getElementById("reset-credits-btn")?.addEventListener("click", async () => {
    try {
      const data = await apiFetch("/api/credits/reset", { method: "POST" });
      state.credits = data.credits;
      state.maxCredits = 50;
      state.plan = data.plan;
      state.billingCycle = "None";
      updateCreditUI();
    } catch (err) {
      alert(err.message);
    }
  });

  // Monthly / Yearly toggle in Plans
  document.getElementById("cycle-toggle-monthly")?.addEventListener("click", (e) => {
    state.planCycleTab = "Monthly";
    e.target.classList.add("active");
    document.getElementById("cycle-toggle-yearly")?.classList.remove("active");
    document.getElementById("pro-price-label").innerHTML = `$8 <span class="muted">/ month</span>`;
    document.getElementById("prem-price-label").innerHTML = `$24 <span class="muted">/ month</span>`;
  });

  document.getElementById("cycle-toggle-yearly")?.addEventListener("click", (e) => {
    state.planCycleTab = "Yearly";
    e.target.classList.add("active");
    document.getElementById("cycle-toggle-monthly")?.classList.remove("active");
    document.getElementById("pro-price-label").innerHTML = `$96 <span class="muted">/ year</span>`;
    document.getElementById("prem-price-label").innerHTML = `$288 <span class="muted">/ year</span>`;
  });

  // Crypto TxID activation
  document.getElementById("crypto-activate-btn")?.addEventListener("click", async () => {
    const msgEl = document.getElementById("crypto-activate-msg");
    try {
      const data = await apiFetch("/api/plans/verify-crypto", {
        method: "POST",
        body: JSON.stringify({
          cycle: document.getElementById("crypto-plan-cycle")?.value || "Monthly",
          network: document.getElementById("crypto-network-sel")?.value || "USDT (ERC20)",
          txid: document.getElementById("crypto-txid-input")?.value || ""
        })
      });
      state.credits = data.credits;
      state.maxCredits = Math.max(state.maxCredits, state.credits);
      state.plan = data.plan;
      state.billingCycle = data.cycle;
      updateCreditUI();
      if (msgEl) msgEl.textContent = data.message;
    } catch (err) {
      if (msgEl) msgEl.textContent = `Error: ${err.message}`;
    }
  });

  // Auth method tabs & verify
  document.querySelectorAll(".auth-method-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.authMethodTab = btn.dataset.method;
      document.querySelectorAll(".auth-method-btn").forEach((b) => b.classList.toggle("active", b === btn));
      const lbl = document.getElementById("auth-user-label");
      const inp = document.getElementById("auth-user-input");
      if (state.authMethodTab === "Gmail") {
        if (lbl) lbl.textContent = "Gmail Address";
        if (inp) inp.placeholder = "user@gmail.com";
      } else if (state.authMethodTab === "Phone OTP") {
        if (lbl) lbl.textContent = "Phone Number";
        if (inp) inp.placeholder = "+92 300 0000000 / +91 98000 00000";
      } else {
        if (lbl) lbl.textContent = "GitHub Username or Email";
        if (inp) inp.placeholder = "github-username";
      }
    });
  });

  document.getElementById("auth-submit-btn")?.addEventListener("click", async () => {
    const fb = document.getElementById("auth-feedback");
    try {
      const data = await apiFetch("/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({
          method: state.authMethodTab,
          identifier: document.getElementById("auth-user-input")?.value || "",
          code: document.getElementById("auth-otp-input")?.value || ""
        })
      });
      state.verified = data.verified;
      state.authMethod = data.authMethod;
      state.userIdentifier = data.userIdentifier;
      updateCreditUI();
      if (fb) fb.textContent = data.message;
    } catch (err) {
      if (fb) fb.textContent = `Error: ${err.message}`;
    }
  });

  // Chat Assistant
  document.getElementById("assistant-send-btn")?.addEventListener("click", async () => {
    const inp = document.getElementById("assistant-prompt-input");
    const log = document.getElementById("assistant-log");
    const prompt = (inp?.value || "").trim();
    if (!prompt || !log) return;

    log.innerHTML += `<div class="track-card"><div><strong>You:</strong> ${escapeHtml(prompt)}</div></div>`;
    inp.value = "";

    try {
      const data = await apiFetch("/api/assistant/chat", {
        method: "POST",
        body: JSON.stringify({ prompt, history: state.chatHistory })
      });
      state.chatHistory.push({ role: "user", content: prompt }, { role: "assistant", content: data.reply });
      log.innerHTML += `<div class="track-card"><div><strong>Assistant:</strong><br/>${escapeHtml(data.reply).replaceAll("\n", "<br/>")}</div></div>`;
      log.scrollTop = log.scrollHeight;
    } catch (err) {
      log.innerHTML += `<div class="track-card"><div><strong>Error:</strong> ${escapeHtml(err.message)}</div></div>`;
    }
  });

  // Library search & filters
  ["lib-filter-select", "lib-workspace-select", "lib-search-input"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderAllTracks);
    document.getElementById(id)?.addEventListener("change", renderAllTracks);
  });

  // Articles / Menu guide tabs
  const articleMap = {
    products: {
      title: "Products & Studio Modules",
      body: "<strong>Studio (Songs):</strong> Generate vocal tracks or instrumentals in any world language with Simple/Advanced controls, [Verse]/[Chorus] lyrics tags, Styles, Vocal Gender, Duration (1–20 min), Weirdness, Style Influence, and Voice Originality.<br/><br/><strong>Speech (BETA):</strong> Convert scripts into speech with tone, gender, background music toggle, and variety.<br/><br/><strong>Visuals:</strong> Image and Video generation with Character selection, Style Guide, Aspect Ratio, and frame controls.<br/><br/><strong>Library & Workspaces:</strong> Search, filter, play, extend, download, and delete tracks."
    },
    guides: {
      title: "How It Works & FAQ",
      body: "1. Choose Songs, Speech, or Visuals.<br/>2. Add lyrics/script/prompt and style tags.<br/>3. Adjust Vocal Gender, Duration, Weirdness, or Style Influence.<br/>4. Click Create to generate tracks and manage them in Library.<br/>5. If free credits run low, watch an ad (+10 credits) or activate a Monthly or Yearly Crypto plan."
    },
    "plans-guide": {
      title: "Monthly & Yearly Plans Guide",
      body: "Both <strong>Monthly</strong> and <strong>Yearly</strong> billing cycles are supported. Send payment to a configured wallet address on Railway and submit your Transaction Hash / TxID under <strong>Monthly & Yearly Plans</strong> to activate credits."
    },
    policies: {
      title: "Terms, Privacy, Safety & Community Guidelines",
      body: "Users are responsible for the lyrics, audio, scripts, and visual prompts they submit and must follow copyright, safety, and community guidelines. API keys and crypto wallet addresses remain stored in Railway environment variables."
    }
  };

  document.querySelectorAll(".article-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".article-btn").forEach((b) => {
        b.classList.remove("btn-green");
        b.classList.add("btn-soft");
      });
      btn.classList.remove("btn-soft");
      btn.classList.add("btn-green");
      const item = articleMap[btn.dataset.article];
      const card = document.getElementById("article-content-card");
      if (item && card) {
        card.innerHTML = `<h3>${item.title}</h3><p class="muted">${item.body}</p>`;
      }
    });
  });
}

async function initApp() {
  bindUI();
  try {
    const health = await apiFetch("/api/health");
    if (health.session?.token) {
      state.token = health.session.token;
      localStorage.setItem("pk_session_token", state.token);
    }
    state.credits = health.session?.credits ?? 50;
    state.maxCredits = health.session?.maxCredits ?? 50;
    state.plan = health.session?.plan || "Free";
    state.billingCycle = health.session?.billingCycle || "None";
    state.verified = Boolean(health.session?.verified);
    state.authMethod = health.session?.authMethod || null;
    state.userIdentifier = health.session?.userIdentifier || null;
    state.providers = health.providers || null;
    state.wallets = health.wallets || {};

    const tracksRes = await apiFetch("/api/tracks");
    state.tracks = Array.isArray(tracksRes.tracks) ? tracksRes.tracks : [];
  } catch (_) {
    // Keep initial local state if health check is unreachable
  }

  updateCreditUI();
  renderWallets();
  renderRailwayKeys();
  renderAllTracks();
}

document.addEventListener("DOMContentLoaded", initApp);
