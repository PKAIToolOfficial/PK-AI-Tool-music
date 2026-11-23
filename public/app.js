const state = { token: localStorage.getItem("pk_session_token") || "", history: [], health: null, payments: [] };
const $ = (id) => document.getElementById(id);
const titles = { chat: ["Chat", "What would you like to create?", "Ask, brainstorm, write, and explore with your AI assistant."], image: ["Image / Photo", "Bring an idea to life.", "Describe what you imagine and create an original image."], voice: ["Voice / Audio", "Give your words a voice.", "Turn a script into clear, natural-sounding audio."], payments: ["Crypto payments", "Manage a payment submission.", "Use a supported network and submit a transaction for review."], security: ["KYC / Security", "Your security matters.", "Review session security and identity-verification availability."], account: ["Points & plans", "Your workspace at a glance.", "Check your points, service status, and current access level."] };
function headers() { return { "content-type": "application/json", ...(state.token ? { "x-session-token": state.token } : {}) }; }
async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (data.session?.token) setToken(data.session.token);
  if (!res.ok) throw new Error(data.error || "That request could not be completed. Please try again.");
  return data;
}
function setToken(token) { state.token = token; localStorage.setItem("pk_session_token", token); }
function setNotice(text, type = "info") { const el = $("notice"); el.textContent = text; el.className = `notice ${type}`; el.hidden = !text; }
function loading(on, label = "Working on it…") { $("loading-text").textContent = label; $("loading-overlay").hidden = !on; }
function setBusy(button, busy, text) { if (!button) return; button.disabled = busy; if (busy) { button.dataset.original = button.innerHTML; button.textContent = text; } else if (button.dataset.original) { button.innerHTML = button.dataset.original; delete button.dataset.original; } }
function showTab(tab) {
  if (!titles[tab]) return;
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
  $("page-title").textContent = titles[tab][0]; $("section-title").textContent = titles[tab][1]; $("section-description").textContent = titles[tab][2];
  document.querySelector(".sidebar").classList.remove("open"); setNotice("");
}
function updateAccount(session = {}) {
  const points = Number(session.credits ?? 0); $("points-count").textContent = points.toLocaleString(); $("balance-points").textContent = points.toLocaleString(); $("account-plan").textContent = session.plan || "Free"; $("plan-label").textContent = `${session.plan || "Free"} plan`;
  $("session-short").textContent = session.token ? `${session.token.slice(0, 6)}…${session.token.slice(-4)}` : "Guest"; $("points-progress").style.width = `${Math.max(0, Math.min(100, points / 50 * 100))}%`;
}
function renderProviders(providers = {}) {
  const names = { groq: "Groq", googleAIStudio: "Google AI Studio / Gemini", openai: "OpenAI", deepseek: "DeepSeek", elevenlabs: "ElevenLabs", replicate: "Replicate", huggingface: "Hugging Face", noiz: "Noiz" };
  const details = providers.details || {}; $("provider-status").innerHTML = Object.entries(names).map(([key, name]) => `<div class="provider-row"><span><i class="status-dot ${details[key] ? "" : "off"}"></i>${name}</span><b class="${details[key] ? "ready" : "not-ready"}">${details[key] ? "Ready" : "Not configured"}</b></div>`).join("");
}
async function refreshHealth() {
  try {
    const data = await api("/api/health"); state.health = data; updateAccount(data.session); renderProviders(data.providers); $("connection-label").textContent = "Connected";
    const wallets = data.wallets || {}; updateWallet(wallets[$("payment-network").value]);
    await refreshSession();
  } catch (e) { $("connection-label").textContent = "Connection unavailable"; renderProviders({}); setNotice(e.message, "error"); }
}
function updateWallet(address) { const el = $("wallet-address"); el.textContent = address || "No wallet is configured for this network."; el.classList.toggle("empty", !address); }
async function refreshSession() {
  if (!state.token) return;
  try { const data = await api(`/api/session/${encodeURIComponent(state.token)}`); state.payments = data.payments || []; renderPayments(); }
  catch { state.payments = []; renderPayments(); }
}
function renderPayments() { const target = $("payment-list"); if (!state.payments.length) { target.innerHTML = '<p class="muted">No submitted payments.</p>'; return; } target.innerHTML = state.payments.map((p) => `<div class="payment-item"><span>${escapeHtml(p.network)} · ${new Date(p.createdAt).toLocaleDateString()}</span><b>${escapeHtml(p.status.replaceAll("_", " "))}</b></div>`).join(""); }
function escapeHtml(text) { return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]); }
function addMessage(role, text) { const row = document.createElement("div"); row.className = `message ${role}`; const icon = document.createElement("span"); icon.className = "message-avatar"; icon.textContent = role === "user" ? "P" : "✦"; const body = document.createElement("div"); const name = document.createElement("b"); name.textContent = role === "user" ? "You" : "PK Assistant"; const para = document.createElement("p"); para.textContent = text; body.append(name, para); row.append(icon, body); $("chat-messages").append(row); row.scrollIntoView({ block: "nearest" }); return row; }
async function submitRoute(action, prompt, extra = {}) { return api("/api/route", { method: "POST", body: JSON.stringify({ action, prompt, ...extra }) }); }
$("navigation").addEventListener("click", (e) => { const button = e.target.closest("[data-tab]"); if (button) showTab(button.dataset.tab); });
document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.go)));
$("menu-toggle").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
$("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const input = $("chat-prompt"), prompt = input.value.trim(), button = e.submitter; if (!prompt) return;
  addMessage("user", prompt); input.value = ""; const pending = addMessage("assistant", "Thinking…"); setBusy(button, true, "Thinking…");
  try { const data = await submitRoute("chat", prompt, { history: state.history }); pending.querySelector("p").textContent = data.reply; state.history.push({ role: "user", content: prompt }, { role: "assistant", content: data.reply }); }
  catch (err) { pending.querySelector("p").textContent = err.message; } finally { setBusy(button, false); }
});
$("image-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const button = e.submitter; setBusy(button, true, "Creating image…"); $("image-result").innerHTML = '<div class="empty-art"><span class="spin">✧</span><p>Creating your image…</p></div>';
  try { const data = await submitRoute("image", $("image-prompt").value.trim(), { size: $("image-size").value }); if (!data.imageUrl) throw new Error("No image was returned. Please try again."); const img = document.createElement("img"); img.src = data.imageUrl; img.alt = "AI-generated image"; $("image-result").replaceChildren(img); }
  catch (err) { $("image-result").innerHTML = `<div class="empty-art"><p>${escapeHtml(err.message)}</p></div>`; } finally { setBusy(button, false); }
});
$("voice-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const button = e.submitter; setBusy(button, true, "Generating voice…"); $("audio-result").replaceChildren();
  try { const data = await submitRoute("voice", $("voice-prompt").value.trim()); const audio = document.createElement("audio"); audio.controls = true; audio.src = data.audioUrl; audio.className = "audio-player"; $("audio-result").append(audio); }
  catch (err) { setNotice(err.message, "error"); } finally { setBusy(button, false); }
});
$("payment-network").addEventListener("change", () => updateWallet(state.health?.wallets?.[$("payment-network").value]));
$("payment-form").addEventListener("submit", async (e) => {
  e.preventDefault(); const button = e.submitter; setBusy(button, true, "Submitting…");
  try { const data = await api("/api/payments/crypto", { method: "POST", body: JSON.stringify({ network: $("payment-network").value, txid: $("payment-txid").value.trim() }) }); setNotice(data.message, "success"); $("payment-txid").value = ""; await refreshSession(); }
  catch (err) { setNotice(err.message, "error"); } finally { setBusy(button, false); }
});
async function refreshSecurity() { try { const data = await api("/api/security/kyc"); $("kyc-status").textContent = data.available ? `Status: ${data.status}` : "Identity verification unavailable"; $("kyc-description").textContent = data.message; } catch (e) { $("kyc-status").textContent = "Status could not be checked"; $("kyc-description").textContent = e.message; } }
$("check-security").addEventListener("click", refreshSecurity);
(async function init() { await refreshHealth(); await refreshSecurity(); })();
