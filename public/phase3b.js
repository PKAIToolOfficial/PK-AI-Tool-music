(() => {
  const api = async (url, options = {}) => {
    const headers = { 'content-type': 'application/json' };
    const token = localStorage.getItem('pk_session_token');
    if (token) headers['x-session-token'] = token;
    const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request could not be completed.');
    return data;
  };
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  const addProfileUI = () => {
    const nav = document.querySelector('aside nav');
    const main = document.querySelector('main');
    if (!nav || !main || document.getElementById('profile-view')) return;

    const profileButton = document.createElement('button');
    profileButton.dataset.view = 'profile-view'; profileButton.textContent = 'Profile & Network'; nav.append(profileButton);

    const view = document.createElement('section'); view.id = 'profile-view'; view.className = 'view';
    view.innerHTML = `<div class="profile-grid"><article class="card"><h2>Edit profile</h2><form id="profile-form"><label>Display name<input id="profile-name" maxlength="50" required></label><label>Profile address<input id="profile-slug" pattern="[a-z0-9_-]{3,30}" maxlength="30" placeholder="creator-name" required></label><label>Bio<textarea id="profile-bio" maxlength="300" rows="4"></textarea></label><label>Avatar address<input id="profile-avatar" type="url" placeholder="https://…"></label><label>Cover address<input id="profile-cover" type="url" placeholder="https://…"></label><div id="social-links-editor"><button type="button" id="add-social-link">Add social link</button></div><button type="submit">Save profile</button></form><p id="profile-status" class="status"></p></article><article class="card"><h2>Network & referrals</h2><div id="profile-summary"></div><h3>Referral link</h3><p id="referral-link"></p><div id="referral-stats"></div><h3>Public profile preview</h3><div id="public-profile-preview"></div></article></div>`;
    main.append(view);

    nav.addEventListener('click', (event) => {
      const target = event.target.closest('[data-view]'); if (!target) return;
      document.querySelectorAll('main .view').forEach((item) => item.classList.toggle('active', item.id === target.dataset.view));
      document.querySelectorAll('aside nav button').forEach((item) => item.classList.toggle('active', item === target));
      if (target.dataset.view === 'profile-view') refreshProfile();
    });

    document.getElementById('add-social-link').addEventListener('click', () => {
      const row = document.createElement('div'); row.className = 'social-link-row';
      row.innerHTML = '<input class="social-label" maxlength="40" placeholder="Label"><input class="social-url" type="url" placeholder="https://…"><button type="button">Remove</button>';
      row.querySelector('button').addEventListener('click', () => row.remove());
      document.getElementById('social-links-editor').append(row);
    });
    document.getElementById('profile-form').addEventListener('submit', saveProfile);
  };

  async function refreshProfile() {
    try {
      const data = await api('/api/profile/me');
      const profile = data.profile;
      document.getElementById('profile-name').value = profile.displayName || '';
      document.getElementById('profile-slug').value = profile.slug || '';
      document.getElementById('profile-bio').value = profile.bio || '';
      document.getElementById('profile-avatar').value = profile.avatarUrl || '';
      document.getElementById('profile-cover').value = profile.coverUrl || '';
      const editor = document.getElementById('social-links-editor');
      for (const existing of editor.querySelectorAll('.social-link-row')) existing.remove();
      for (const link of profile.socialLinks || []) addSocialRow(link.label, link.url);

      document.getElementById('profile-summary').innerHTML = `<b>${escape(profile.displayName)}</b> ${profile.verified ? '<span class="gold">◆</span>' : ''}<p>${profile.followers || 0} followers · ${profile.following || 0} following</p>`;

      const referrals = await api('/api/referrals/me');
      document.getElementById('referral-link').innerHTML = `<a href="${escape(referrals.link)}" target="_blank" rel="noopener noreferrer">${escape(referrals.link)}</a>`;
      document.getElementById('referral-stats').innerHTML = `<p>Signups: ${referrals.signups} · Paid conversions: ${referrals.conversions}</p>`;

      const preview = await api(`/api/profile/${encodeURIComponent(profile.slug)}`);
      document.getElementById('public-profile-preview').innerHTML = `<b>${escape(preview.profile.displayName)}</b> ${preview.profile.verified ? '<span class="gold">◆</span>' : ''}<p>${escape(preview.profile.bio)}</p><p>${preview.profile.followers} followers · ${preview.profile.following} following</p>`;
    } catch (error) { document.getElementById('profile-status').textContent = error.message; }
  }

  function addSocialRow(label = '', url = '') {
    const row = document.createElement('div'); row.className = 'social-link-row';
    row.innerHTML = `<input class="social-label" maxlength="40" placeholder="Label" value="${escape(label)}"><input class="social-url" type="url" placeholder="https://…" value="${escape(url)}"><button type="button">Remove</button>`;
    row.querySelector('button').addEventListener('click', () => row.remove());
    document.getElementById('social-links-editor').append(row);
  }

  async function saveProfile(event) {
    event.preventDefault();
    const socialLinks = [...document.querySelectorAll('.social-link-row')].map((row) => ({ label: row.querySelector('.social-label').value, url: row.querySelector('.social-url').value })).filter((link) => link.label || link.url);
    try {
      const data = await api('/api/profile/me', { method: 'PUT', body: JSON.stringify({ displayName: document.getElementById('profile-name').value, slug: document.getElementById('profile-slug').value, bio: document.getElementById('profile-bio').value, avatarUrl: document.getElementById('profile-avatar').value || null, coverUrl: document.getElementById('profile-cover').value || null, socialLinks }) });
      document.getElementById('profile-status').textContent = 'Profile saved.';
      await refreshProfile();
    } catch (error) { document.getElementById('profile-status').textContent = error.message; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(addProfileUI, 650), { once: true });
  else setTimeout(addProfileUI, 650);
})();
