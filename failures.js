/* ─────────────────────────────────────────────────────────────────
   CC PM Dashboard · failures.js
   Failure Log + System Health views. Loaded after app.js and depends
   on globals: sb, CLIENTS, getClient, escHTML, navigate, logActivity.

   Wires three top-level entry points used by app.js:
     - window.renderFailureLog(root)   → #/failures
     - window.renderSystemHealth(root) → #/health
     - window.failureBadgeHTML(client) → small red dot on cards
   ───────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const STATIONS = ['Onboarding', 'Strategy', 'Production', 'Distribution', 'Reporting'];
  const STATUSES = ['Open', 'In-progress', 'Resolved', 'Blocked'];
  const SOURCES  = ['manual', 'cc-client-agent', 'n8n', 'qc-tool', 'attribution-tracker'];

  // Default owner per station — Kayla confirms before shipping. Used to
  // pre-fill the "+ New entry" modal so logging is one-click for the common case.
  const STATION_OWNER = {
    'Onboarding':   'Kayla',
    'Strategy':     'Moi',
    'Production':   'Saad',
    'Distribution': 'Vedant',
    'Reporting':    'Vedant',
  };

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  // ── State ──────────────────────────────────────────────────────
  // FAILURES is hydrated by app.js loadData(). Filter state is local.
  let filterStation = '';
  let filterStatus  = 'open-active'; // 'open-active' = Open + In-progress
  let filterOwner   = '';
  let filterSource  = '';
  let filterClient  = '';

  // ── Helpers ────────────────────────────────────────────────────
  function getFailures()  { return window.FAILURES || []; }

  function isEscalated(f) {
    return f.status === 'Open' &&
           (Date.now() - new Date(f.date_logged).getTime()) > SEVEN_DAYS_MS;
  }

  function clientName(clientId) {
    if (!clientId) return '—';
    const c = (typeof getClient === 'function') ? getClient(clientId) : null;
    return c ? c.name : `#${clientId}`;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function applyFilters(failures) {
    return failures.filter(f => {
      if (filterStation && f.station !== filterStation) return false;
      if (filterStatus === 'open-active' && f.status !== 'Open' && f.status !== 'In-progress') return false;
      if (filterStatus && filterStatus !== 'open-active' && f.status !== filterStatus) return false;
      if (filterOwner  && f.owner !== filterOwner)   return false;
      if (filterSource && f.source !== filterSource) return false;
      if (filterClient && String(f.client_id || '') !== String(filterClient)) return false;
      return true;
    });
  }

  function ownerOptions() {
    const ownersFromTeam = (typeof TEAM !== 'undefined' && Array.isArray(TEAM)) ? TEAM.map(t => t.name) : [];
    const ownersFromLog  = Array.from(new Set(getFailures().map(f => f.owner).filter(Boolean)));
    const all = Array.from(new Set([
      ...Object.values(STATION_OWNER),
      ...ownersFromTeam,
      ...ownersFromLog,
    ])).sort();
    return all;
  }

  // ── Data ───────────────────────────────────────────────────────
  async function reloadFailures() {
    const { data, error } = await sb.from('failure_log')
      .select('*')
      .order('date_logged', { ascending: false });
    if (error) {
      console.error('[failures] Failed to load:', error.message);
      return;
    }
    window.FAILURES = data || [];
  }

  async function insertFailure(entry) {
    const { error } = await sb.from('failure_log').insert(entry);
    if (error) {
      alert(`Could not log failure: ${error.message}`);
      return false;
    }
    if (typeof logActivity === 'function') {
      logActivity(entry.client_id || null, 'failure_logged', `Failure logged: ${entry.what_broke}`);
    }
    return true;
  }

  async function updateFailure(id, patch) {
    const { error } = await sb.from('failure_log').update(patch).eq('id', id);
    if (error) {
      alert(`Update failed: ${error.message}`);
      return false;
    }
    return true;
  }

  async function deleteFailure(id) {
    const { error } = await sb.from('failure_log').delete().eq('id', id);
    if (error) {
      alert(`Delete failed: ${error.message}`);
      return false;
    }
    return true;
  }

  // ── Failure Log view ───────────────────────────────────────────
  function renderFailureLog(root) {
    const all = getFailures();
    const filtered = applyFilters(all);

    const owners = ownerOptions();

    const filtersHTML = `
      <div class="failure-filters">
        <select id="ffStation" class="settings-input">
          <option value="">All stations</option>
          ${STATIONS.map(s => `<option value="${s}" ${s === filterStation ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select id="ffStatus" class="settings-input">
          <option value="open-active" ${filterStatus === 'open-active' ? 'selected' : ''}>Open + In-progress</option>
          <option value="">All statuses</option>
          ${STATUSES.map(s => `<option value="${s}" ${s === filterStatus ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select id="ffOwner" class="settings-input">
          <option value="">All owners</option>
          ${owners.map(o => `<option value="${escHTML(o)}" ${o === filterOwner ? 'selected' : ''}>${escHTML(o)}</option>`).join('')}
        </select>
        <select id="ffSource" class="settings-input">
          <option value="">All sources</option>
          ${SOURCES.map(s => `<option value="${s}" ${s === filterSource ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select id="ffClient" class="settings-input">
          <option value="">All clients</option>
          ${(CLIENTS || []).map(c => `<option value="${c.id}" ${String(c.id) === String(filterClient) ? 'selected' : ''}>${escHTML(c.name)}</option>`).join('')}
        </select>
        <button class="btn-cancel" id="ffClearBtn">Clear filters</button>
      </div>`;

    const headerHTML = `
      <div class="failure-header">
        <div>
          <div class="detail-name">Failure Log</div>
          <div class="detail-section-subtitle">${filtered.length} of ${all.length} entries · CSM: Kayla · Reviewed Friday + monthly</div>
        </div>
        <div class="failure-header-actions">
          <a class="topbar-link" href="#/health">System Health →</a>
          <button class="btn-primary" id="ffNewBtn">+ New entry</button>
        </div>
      </div>`;

    const tableHTML = filtered.length === 0
      ? `<div class="empty-state">No entries match these filters.</div>`
      : `
        <table class="failure-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Station</th>
              <th>Client</th>
              <th>What broke</th>
              <th>Owner</th>
              <th>Status</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(rowHTML).join('')}
          </tbody>
        </table>`;

    root.innerHTML = `
      <section class="failure-page">
        ${headerHTML}
        ${filtersHTML}
        ${tableHTML}
      </section>`;

    bindFailureLog(root);
  }

  function rowHTML(f) {
    const escalated = isEscalated(f);
    return `
      <tr class="failure-row ${escalated ? 'failure-row-escalated' : ''}" data-id="${f.id}">
        <td class="failure-date">${fmtDate(f.date_logged)}</td>
        <td><span class="failure-station failure-station-${f.station.toLowerCase()}">${f.station}</span></td>
        <td>${f.client_id ? `<a href="#/client/${f.client_id}">${escHTML(clientName(f.client_id))}</a>` : '—'}</td>
        <td class="failure-what">${escHTML(f.what_broke)}${escalated ? ' <span class="failure-escalate-flag">🚨 escalate</span>' : ''}</td>
        <td>${escHTML(f.owner)}</td>
        <td>
          <select class="failure-status-select failure-status-${f.status.toLowerCase().replace(' ', '-')}" data-id="${f.id}">
            ${STATUSES.map(s => `<option value="${s}" ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>
        <td><span class="failure-source">${escHTML(f.source)}</span></td>
        <td>
          <button class="failure-row-edit" data-id="${f.id}" title="Edit details">…</button>
          <button class="failure-row-delete" data-id="${f.id}" title="Delete">×</button>
        </td>
      </tr>`;
  }

  function bindFailureLog(root) {
    // Filter dropdowns
    root.querySelector('#ffStation').addEventListener('change', e => { filterStation = e.target.value; renderFailureLog(root); });
    root.querySelector('#ffStatus' ).addEventListener('change', e => { filterStatus  = e.target.value; renderFailureLog(root); });
    root.querySelector('#ffOwner'  ).addEventListener('change', e => { filterOwner   = e.target.value; renderFailureLog(root); });
    root.querySelector('#ffSource' ).addEventListener('change', e => { filterSource  = e.target.value; renderFailureLog(root); });
    root.querySelector('#ffClient' ).addEventListener('change', e => { filterClient  = e.target.value; renderFailureLog(root); });
    root.querySelector('#ffClearBtn').addEventListener('click', () => {
      filterStation = ''; filterStatus = 'open-active'; filterOwner = ''; filterSource = ''; filterClient = '';
      renderFailureLog(root);
    });

    // Inline status change
    root.querySelectorAll('.failure-status-select').forEach(sel => {
      sel.addEventListener('change', async e => {
        const id = parseInt(e.target.dataset.id);
        const next = e.target.value;
        const ok = await updateFailure(id, { status: next });
        if (ok) {
          await reloadFailures();
          renderFailureLog(root);
        }
      });
    });

    // Edit row → modal
    root.querySelectorAll('.failure-row-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        const f = getFailures().find(x => x.id === id);
        if (!f) return;
        openEditModal(root, f);
      });
    });

    // Delete (two-click confirm)
    root.querySelectorAll('.failure-row-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id);
        if (btn.dataset.confirm === '1') {
          const ok = await deleteFailure(id);
          if (ok) {
            await reloadFailures();
            renderFailureLog(root);
          }
        } else {
          btn.dataset.confirm = '1';
          btn.textContent = '?';
          setTimeout(() => {
            if (btn.isConnected) { btn.dataset.confirm = '0'; btn.textContent = '×'; }
          }, 2000);
        }
      });
    });

    // New entry button
    root.querySelector('#ffNewBtn').addEventListener('click', () => openNewModal(root));
  }

  // ── New / Edit modal ───────────────────────────────────────────
  function openNewModal(root) {
    openModal(root, null);
  }

  function openEditModal(root, f) {
    openModal(root, f);
  }

  function openModal(root, existing) {
    const isEdit = !!existing;
    const f = existing || {
      station: 'Onboarding',
      client_id: null,
      what_broke: '',
      owner: STATION_OWNER['Onboarding'],
      status: 'Open',
      resolution_notes: '',
      client_confirmation_sent: false,
      source: 'manual',
    };

    const overlay = document.createElement('div');
    overlay.className = 'cc-modal-overlay';
    overlay.innerHTML = `
      <div class="cc-modal failure-modal">
        <div class="cc-modal-header">
          <div class="cc-modal-title">${isEdit ? 'Edit failure' : 'Log a failure'}</div>
          <button class="cc-modal-close" type="button">×</button>
        </div>
        <div class="cc-modal-body">
          <label class="settings-label">Station
            <select id="fmStation" class="settings-input">
              ${STATIONS.map(s => `<option value="${s}" ${s === f.station ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </label>
          <label class="settings-label">Client (optional)
            <select id="fmClient" class="settings-input">
              <option value="">— none —</option>
              ${(CLIENTS || []).map(c => `<option value="${c.id}" ${String(c.id) === String(f.client_id) ? 'selected' : ''}>${escHTML(c.name)}</option>`).join('')}
            </select>
          </label>
          <label class="settings-label">What broke
            <textarea id="fmWhat" class="settings-input" rows="2" placeholder="One-sentence description">${escHTML(f.what_broke || '')}</textarea>
          </label>
          <label class="settings-label">Owner
            <input id="fmOwner" type="text" class="settings-input" value="${escHTML(f.owner || '')}" placeholder="Who's responsible" />
          </label>
          <label class="settings-label">Status
            <select id="fmStatus" class="settings-input">
              ${STATUSES.map(s => `<option value="${s}" ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </label>
          <label class="settings-label">Source
            <select id="fmSource" class="settings-input">
              ${SOURCES.map(s => `<option value="${s}" ${s === f.source ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </label>
          <label class="settings-label">Resolution notes
            <textarea id="fmNotes" class="settings-input" rows="3" placeholder="Filled in when closed">${escHTML(f.resolution_notes || '')}</textarea>
          </label>
          <label class="settings-checkbox">
            <input id="fmConfirm" type="checkbox" ${f.client_confirmation_sent ? 'checked' : ''} />
            Client confirmation sent
          </label>
        </div>
        <div class="cc-modal-footer">
          <button class="btn-cancel" id="fmCancel">Cancel</button>
          <button class="btn-primary" id="fmSave">${isEdit ? 'Save changes' : 'Log failure'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.cc-modal-close').addEventListener('click', close);
    overlay.querySelector('#fmCancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Auto-fill owner when station changes (only on new entries to avoid clobbering)
    overlay.querySelector('#fmStation').addEventListener('change', e => {
      if (!isEdit) {
        overlay.querySelector('#fmOwner').value = STATION_OWNER[e.target.value] || '';
      }
    });

    overlay.querySelector('#fmSave').addEventListener('click', async () => {
      const what = overlay.querySelector('#fmWhat').value.trim();
      const owner = overlay.querySelector('#fmOwner').value.trim();
      if (!what)  { alert('What broke is required.'); return; }
      if (!owner) { alert('Owner is required.'); return; }

      const payload = {
        station: overlay.querySelector('#fmStation').value,
        client_id: overlay.querySelector('#fmClient').value ? parseInt(overlay.querySelector('#fmClient').value) : null,
        what_broke: what,
        owner,
        status: overlay.querySelector('#fmStatus').value,
        source: overlay.querySelector('#fmSource').value,
        resolution_notes: overlay.querySelector('#fmNotes').value.trim() || null,
        client_confirmation_sent: overlay.querySelector('#fmConfirm').checked,
      };

      const ok = isEdit
        ? await updateFailure(existing.id, payload)
        : await insertFailure(payload);
      if (!ok) return;

      close();
      await reloadFailures();
      renderFailureLog(document.getElementById('appRoot'));
    });
  }

  // ── System Health view ─────────────────────────────────────────
  function renderSystemHealth(root) {
    const failures = getFailures();
    const now = Date.now();

    const last7  = failures.filter(f => now - new Date(f.date_logged).getTime() < SEVEN_DAYS_MS);
    const last30 = failures.filter(f => now - new Date(f.date_logged).getTime() < THIRTY_DAYS_MS);
    const open   = failures.filter(f => f.status === 'Open' || f.status === 'In-progress');

    const stationStats = STATIONS.map(s => {
      const open7  = last7.filter(f => f.station === s && (f.status === 'Open' || f.status === 'In-progress')).length;
      const open30 = last30.filter(f => f.station === s && (f.status === 'Open' || f.status === 'In-progress')).length;
      return { station: s, open7, open30 };
    });

    const stationCardsHTML = stationStats.map(s => `
      <div class="health-station-card">
        <div class="health-station-name">${s.station}</div>
        <div class="health-station-counts">
          <div><span class="health-num">${s.open7}</span><span class="health-label">7d open</span></div>
          <div><span class="health-num">${s.open30}</span><span class="health-label">30d open</span></div>
        </div>
      </div>
    `).join('');

    const agentFailures = failures
      .filter(f => f.source && f.source !== 'manual')
      .slice(0, 50);

    const agentRowsHTML = agentFailures.length === 0
      ? '<div class="empty-state">No automated failures logged.</div>'
      : `<table class="failure-table">
          <thead><tr><th>Date</th><th>Source</th><th>Station</th><th>Client</th><th>What broke</th><th>Status</th></tr></thead>
          <tbody>
            ${agentFailures.map(f => `
              <tr>
                <td class="failure-date">${fmtDate(f.date_logged)}</td>
                <td><span class="failure-source">${escHTML(f.source)}</span></td>
                <td><span class="failure-station failure-station-${f.station.toLowerCase()}">${f.station}</span></td>
                <td>${f.client_id ? `<a href="#/client/${f.client_id}">${escHTML(clientName(f.client_id))}</a>` : '—'}</td>
                <td class="failure-what">${escHTML(f.what_broke)}</td>
                <td><span class="failure-status-pill failure-status-${f.status.toLowerCase().replace(' ', '-')}">${f.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;

    // Per-client open failure summary
    const perClient = {};
    for (const f of open) {
      if (!f.client_id) continue;
      if (!perClient[f.client_id]) perClient[f.client_id] = { count: 0, latest: f };
      perClient[f.client_id].count += 1;
      if (new Date(f.date_logged) > new Date(perClient[f.client_id].latest.date_logged)) {
        perClient[f.client_id].latest = f;
      }
    }
    const perClientRows = Object.entries(perClient)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([cid, info]) => `
        <tr>
          <td><a href="#/client/${cid}">${escHTML(clientName(parseInt(cid)))}</a></td>
          <td><span class="failure-badge">${info.count}</span></td>
          <td>${escHTML(info.latest.what_broke)}</td>
          <td class="failure-date">${fmtDate(info.latest.date_logged)}</td>
        </tr>`).join('');

    const perClientHTML = Object.keys(perClient).length === 0
      ? '<div class="empty-state">No clients have open failures.</div>'
      : `<table class="failure-table">
          <thead><tr><th>Client</th><th>Open</th><th>Most recent</th><th>When</th></tr></thead>
          <tbody>${perClientRows}</tbody>
        </table>`;

    root.innerHTML = `
      <section class="health-page">
        <div class="failure-header">
          <div>
            <div class="detail-name">System Health</div>
            <div class="detail-section-subtitle">${last7.length} this week · ${last30.length} this month · ${open.length} currently open</div>
          </div>
          <div class="failure-header-actions">
            <a class="topbar-link" href="#/failures">Failure Log →</a>
          </div>
        </div>

        <div class="health-section">
          <div class="health-section-title">By station</div>
          <div class="health-station-grid">${stationCardsHTML}</div>
        </div>

        <div class="health-section">
          <div class="health-section-title">Automated failures (latest 50)</div>
          ${agentRowsHTML}
        </div>

        <div class="health-section">
          <div class="health-section-title">Open failures by client</div>
          ${perClientHTML}
        </div>
      </section>`;
  }

  // ── Per-client badge (used on cards + client detail header) ────
  function failureBadgeHTML(clientId) {
    if (!clientId) return '';
    const open = getFailures().filter(f =>
      f.client_id === clientId && (f.status === 'Open' || f.status === 'In-progress')
    );
    if (open.length === 0) return '';
    const escalated = open.some(isEscalated);
    return `<span class="failure-badge ${escalated ? 'failure-badge-escalated' : ''}" title="${open.length} open failure${open.length === 1 ? '' : 's'}${escalated ? ' (one+ escalated)' : ''}">${open.length}</span>`;
  }

  // ── Expose ─────────────────────────────────────────────────────
  window.renderFailureLog   = renderFailureLog;
  window.renderSystemHealth = renderSystemHealth;
  window.failureBadgeHTML   = failureBadgeHTML;
  window.reloadFailures     = reloadFailures;
})();
