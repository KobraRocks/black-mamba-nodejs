const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

function jsonForScript(data) {
  return JSON.stringify(data || null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function renderStatCards(stats) {
  const cards = Array.isArray(stats?.cards) ? stats.cards : [];
  if (cards.length === 0) return '';
  const items = cards.map((card) => {
    const key = escapeHtml(card.key || 'card');
    const value = escapeHtml(card.value ?? 0);
    const label = escapeHtml(card.label || '');
    return `
      <article class="bm-admin__card" data-stat-card="${key}">
        <div class="bm-admin__card-value" data-stat-value>${value}</div>
        <div class="bm-admin__card-label">${label}</div>
      </article>
    `;
  }).join('');
  return `<div class="bm-admin__stats-grid">${items}</div>`;
}

function renderBreakdowns(stats) {
  const breakdowns = stats?.breakdowns || {};
  const entries = Object.entries(breakdowns);
  if (!entries.length) return '';
  return entries.map(([featureKey, detail]) => {
    const header = escapeHtml(detail?.label || featureKey);
    const description = escapeHtml(detail?.description || '');
    const rows = Array.isArray(detail?.roles) ? detail.roles : [];
    const listItems = rows.map((row) => {
      const roleKey = escapeHtml(row.key || 'role');
      const label = escapeHtml(row.label || row.key || '');
      const count = escapeHtml(row.count ?? 0);
      return `
        <li class="bm-admin__breakdown-item" data-stat-breakdown-item data-role="${roleKey}">
          <span class="bm-admin__breakdown-count" data-stat-count>${count}</span>
          <span class="bm-admin__breakdown-label">${label}</span>
        </li>
      `;
    }).join('');
    return `
      <section class="bm-admin__breakdown" data-stat-breakdown data-feature="${escapeHtml(featureKey)}">
        <header class="bm-admin__breakdown-header">
          <h3 class="bm-admin__breakdown-title">${header}</h3>
          <p class="bm-admin__breakdown-description">${description}</p>
        </header>
        <ul class="bm-admin__breakdown-list">${listItems}</ul>
      </section>
    `;
  }).join('');
}

function renderStats(stats) {
  return `${renderStatCards(stats)}${renderBreakdowns(stats)}`;
}

function renderFeatureHeaders(features) {
  return features.map((feature) => `
    <th scope="col">${escapeHtml(feature.name || feature.key)}</th>
  `).join('');
}

function renderFeatureCell(user, feature) {
  const featureKey = feature.key;
  const info = user.features?.[featureKey] || {};
  const value = info.role || feature.defaultRole;
  const label = escapeHtml(feature.name || featureKey);
  const options = Array.isArray(feature.roles) ? feature.roles : [];
  const optionMarkup = options.map((opt) => {
    const key = escapeHtml(opt.key || '');
    const optLabel = escapeHtml(opt.label || opt.key || '');
    const selected = opt.key === value ? ' selected' : '';
    return `<option value="${key}"${selected}>${optLabel}</option>`;
  }).join('');
  return `
    <td>
      <label class="bm-admin__select">
        <span class="bm-admin__select-label">${label}</span>
        <select
          class="bm-admin__select-control"
          data-bm-role-select
          data-user-id="${escapeHtml(user.id)}"
          data-feature="${escapeHtml(featureKey)}"
          data-original-value="${escapeHtml(value)}"
          aria-label="${label} role for ${escapeHtml(user.email)}"
        >
          ${optionMarkup}
        </select>
      </label>
    </td>
  `;
}

function renderUserRows(features, users) {
  return users.map((user) => {
    const email = escapeHtml(user.email || '');
    const featureCells = features.map((feature) => renderFeatureCell(user, feature)).join('');
    return `
      <tr data-user-row="${escapeHtml(user.id)}">
        <th scope="row">${email}</th>
        ${featureCells}
      </tr>
    `;
  }).join('');
}

export default function superAdminIndex({ assigns }) {
  const dashboard = assigns?.dashboard || {};
  const pageTitle = assigns?.pageTitle || 'Super Admin';
  const features = Array.isArray(dashboard.features) ? dashboard.features : [];
  const users = Array.isArray(dashboard.users) ? dashboard.users : [];
  const stats = dashboard.stats || {};
  const updateTemplate = '/super_admin/users/:user_id/features/:feature';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pageTitle)}</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body class="bm-body">
    <main class="bm-admin" data-bm-super-admin data-update-template="${escapeHtml(updateTemplate)}">
      <header class="bm-admin__header">
        <div class="bm-admin__badge">Super admin</div>
        <h1 class="bm-admin__title">${escapeHtml(pageTitle)}</h1>
        <p class="bm-admin__subtitle">Assign feature roles, monitor adoption, and unlock tooling for your teams.</p>
      </header>
      <section class="bm-admin__flash" data-bm-flash role="status" aria-live="polite"></section>
      <section class="bm-admin__stats" data-bm-stats>
        ${renderStats(stats)}
      </section>
      <section class="bm-admin__table">
        <h2 class="bm-admin__table-title">Feature access</h2>
        <div class="bm-admin__table-wrapper">
          <table class="bm-admin__grid" data-bm-users>
            <thead>
              <tr>
                <th scope="col">User</th>
                ${renderFeatureHeaders(features)}
              </tr>
            </thead>
            <tbody>
              ${renderUserRows(features, users)}
            </tbody>
          </table>
        </div>
      </section>
    </main>
    <script id="bm-super-admin-data" type="application/json">${jsonForScript(dashboard)}</script>
    <script>
      (function () {
        const root = document.querySelector('[data-bm-super-admin]');
        if (!root) return;
        const dataEl = document.getElementById('bm-super-admin-data');
        let snapshot = {};
        try { snapshot = JSON.parse(dataEl.textContent || '{}') || {}; } catch { snapshot = {}; }
        const flash = root.querySelector('[data-bm-flash]');
        const updateTemplate = root.dataset.updateTemplate || '';
        const cssEscape = (value) => {
          if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(String(value));
          }
          return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch);
        };

        function showFlash(message, type) {
          if (!flash) return;
          flash.textContent = message || '';
          flash.dataset.variant = type || 'info';
        }

        function updateCards(cards = []) {
          for (const card of cards) {
            const key = card?.key;
            if (!key) continue;
            const selector = '[data-stat-card="' + cssEscape(String(key)) + '"] [data-stat-value]';
            const node = root.querySelector(selector);
            if (node) node.textContent = card.value != null ? String(card.value) : '0';
          }
        }

        function updateBreakdowns(breakdowns = {}) {
          for (const [featureKey, detail] of Object.entries(breakdowns)) {
            const scope = root.querySelector('[data-stat-breakdown][data-feature="' + cssEscape(featureKey) + '"]');
            if (!scope) continue;
            const roles = Array.isArray(detail?.roles) ? detail.roles : [];
            for (const role of roles) {
              const roleSelector = '[data-stat-breakdown-item][data-role="' + cssEscape(String(role.key || '')) + '"] [data-stat-count]';
              const item = scope.querySelector(roleSelector);
              if (item) item.textContent = role.count != null ? String(role.count) : '0';
            }
          }
        }

        function updateRow(user) {
          if (!user || !user.id) return;
          const rowSelector = '[data-user-row="' + cssEscape(String(user.id)) + '"]';
          const row = root.querySelector(rowSelector);
          if (!row || !user.features) return;
          const selects = row.querySelectorAll('[data-bm-role-select]');
          for (const select of selects) {
            const featureKey = select.dataset.feature;
            const detail = user.features[featureKey];
            if (detail && detail.role) {
              select.value = detail.role;
              select.dataset.originalValue = detail.role;
            }
          }
        }

        function handleResponse(json) {
          if (!json || typeof json !== 'object') return;
          if (json.stats) {
            updateCards(json.stats.cards);
            updateBreakdowns(json.stats.breakdowns);
            snapshot.stats = json.stats;
          }
          if (json.user) {
            updateRow(json.user);
          }
        }

        root.addEventListener('focus', (event) => {
          const select = event.target.closest('[data-bm-role-select]');
          if (!select) return;
          select.dataset.originalValue = select.value;
        }, true);

        root.addEventListener('change', (event) => {
          const select = event.target.closest('[data-bm-role-select]');
          if (!select) return;
          const userId = select.dataset.userId;
          const feature = select.dataset.feature;
          const value = select.value;
          if (!userId || !feature || !updateTemplate) return;
          const url = updateTemplate
            .replace(':user_id', encodeURIComponent(String(userId)))
            .replace(':feature', encodeURIComponent(String(feature)));
          const previous = select.dataset.originalValue || value;
          select.disabled = true;
          fetch(url, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ role: value })
          })
            .then((res) => res.json().catch(() => ({})))
            .then((json) => {
              if (!json || json.ok !== true) {
                const message = json?.error || 'Unable to update role';
                showFlash(message, 'error');
                select.value = previous;
                return;
              }
              showFlash('Role updated', 'success');
              handleResponse(json);
            })
            .catch((err) => {
              showFlash(err?.message || 'Network error', 'error');
              select.value = previous;
            })
            .finally(() => {
              select.disabled = false;
              select.dataset.originalValue = select.value;
            });
        });

        if (snapshot && snapshot.stats) {
          updateCards(snapshot.stats.cards);
          updateBreakdowns(snapshot.stats.breakdowns);
        }
      }());
    </script>
  </body>
</html>`;
}
