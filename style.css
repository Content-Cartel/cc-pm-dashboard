/* ─────────────────────────────────────────────────────────────────
   CC PM Dashboard v5  ·  app.js
   Supabase-powered: board, phase stepper, checklist, team,
   deliverables, activity feed, settings, webhooks
   ───────────────────────────────────────────────────────────────── */

/* ── SUPABASE CONNECTION ─────────────────────────────────────────── */
const SUPABASE_URL = "https://andcsslmnogpuntfuouh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFuZGNzc2xtbm9ncHVudGZ1b3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMDQ2OTMsImV4cCI6MjA4Nzg4MDY5M30.3i0zOowv6SU4xWvGy506KMpzh8qp634iwfIH8FQVTgA";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── CONSTANTS ───────────────────────────────────────────────────── */
const DELIVERABLE_STATUSES = ['script', 'filming', 'editing', 'review', 'done'];
const STATUS_LABELS = { script: 'Script', filming: 'Filming', editing: 'Editing', review: 'Review', done: 'Done' };
const STATUS_COLORS = { script: '#A1A1AA', filming: '#D4A843', editing: '#3B82F6', review: '#F59E0B', done: '#22C55E' };
const N8N_WEBHOOK_URL = 'https://content-cartel-1.app.n8n.cloud/webhook/pm-deliverable';
const ANALYTICS_BASE = 'https://analytics.contentcartel.net/#/client/';

/* ── GLOBAL STATE ────────────────────────────────────────────────── */
let TEAM = [];
let CLIENTS = [];
let ACTIVITY_LOG = [];

/* ── LOAD DATA FROM SUPABASE ─────────────────────────────────────── */
async function loadData() {
  const [teamRes, clientRes, assignRes, checkRes, delivRes, settingsRes, activityRes] = await Promise.all([
    sb.from('team_members').select('*').order('id'),
    sb.from('clients').select('*').order('id'),
    sb.from('client_team').select('*'),
    sb.from('onboarding_checks').select('*').order('id'),
    sb.from('deliverables').select('*').order('created_at', { ascending: false }),
    sb.from('client_settings').select('*'),
    sb.from('activity_log').select('*').order('created_at', { ascending: false }).limit(200),
  ]);

  TEAM = (teamRes.data || []).map(t => ({
    id: t.id, initials: t.initials, name: t.name, role: t.role
  }));

  ACTIVITY_LOG = activityRes.data || [];

  const allDeliverables = delivRes.data || [];
  const allSettings = settingsRes.data || [];

  CLIENTS = (clientRes.data || []).map(c => {
    const client = {
      id: c.id,
      name: c.name,
      phase: c.phase,
      team: (assignRes.data || []).filter(a => a.client_id === c.id).map(a => a.team_member_id),
      deliverables: allDeliverables.filter(d => d.client_id === c.id),
      settings: allSettings.find(s => s.client_id === c.id) || null,
    };
    const clientChecks = (checkRes.data || []).filter(ch => ch.client_id === c.id);
    if (c.phase === 'onboarding' || clientChecks.length > 0) {
      client.onboardingChecks = clientChecks.map(ch => ({ id: ch.id, label: ch.label, done: ch.done }));
    }
    if (c.phase === 'special') {
      client.specialLabel = 'Event';
    }
    return client;
  });

  render();
}

/* ── SAVE FUNCTIONS (EXISTING) ───────────────────────────────────── */
async function saveNewClient(name) {
  const { data } = await sb.from('clients').insert({ name, phase: 'pipeline' }).select().single();
  if (data) logActivity(data.id, 'client_created', `"${name}" added to pipeline`);
  return data;
}

async function deleteClientDB(clientId) {
  const cl = getClient(clientId);
  await sb.from('clients').delete().eq('id', clientId);
  if (cl) logActivity(null, 'client_deleted', `"${cl.name}" removed`);
}

async function updatePhase(clientId, newPhase) {
  const cl = getClient(clientId);
  const oldPhase = cl ? cl.phase : '?';
  await sb.from('clients').update({ phase: newPhase }).eq('id', clientId);
  if (cl) logActivity(clientId, 'phase_changed', `"${cl.name}" moved from ${oldPhase} to ${newPhase}`);
}

async function addTeamMemberDB(clientId, memberId) {
  await sb.from('client_team').insert({ client_id: clientId, team_member_id: memberId });
  const cl = getClient(clientId);
  const m = getTeamMember(memberId);
  if (cl && m) logActivity(clientId, 'team_added', `${m.name} added to "${cl.name}"`);
}

async function removeTeamMemberDB(clientId, memberId) {
  await sb.from('client_team').delete().eq('client_id', clientId).eq('team_member_id', memberId);
  const cl = getClient(clientId);
  const m = getTeamMember(memberId);
  if (cl && m) logActivity(clientId, 'team_removed', `${m.name} removed from "${cl.name}"`);
}

async function toggleCheckDB(checkId, done) {
  await sb.from('onboarding_checks').update({
    done,
    completed_at: done ? new Date().toISOString() : null
  }).eq('id', checkId);
}

async function createOnboardingChecks(clientId) {
  const labels = [
    'Welcome kit sent', 'Story Call scheduled', 'Battle Plan Call scheduled',
    'Client AI built', 'Content strategy done', 'First video filmed', 'GHL snapshot cloned'
  ];
  const rows = labels.map(label => ({ client_id: clientId, label, done: false }));
  const { data } = await sb.from('onboarding_checks').insert(rows).select();
  return (data || []).map(ch => ({ id: ch.id, label: ch.label, done: ch.done }));
}

/* ── DELIVERABLE CRUD ────────────────────────────────────────────── */
async function createDeliverable(clientId, title, directorLed) {
  const { data } = await sb.from('deliverables').insert({
    client_id: clientId,
    title,
    status: 'script',
    director_led: directorLed
  }).select().single();

  if (data) {
    const cl = getClient(clientId);
    if (cl) cl.deliverables.unshift(data);
    logActivity(clientId, 'deliverable_created', `"${title}" created${directorLed ? ' (Director-led)' : ''}`);
    fireWebhook('deliverable_created', {
      client_name: cl ? cl.name : '',
      client_id: clientId,
      deliverable_title: title,
      deliverable_id: data.id,
      director_led: directorLed,
    });
  }
  return data;
}

async function updateDeliverableStatus(id, newStatus, clientId) {
  const cl = getClient(clientId);
  const deliv = cl ? cl.deliverables.find(d => d.id === id) : null;
  const oldStatus = deliv ? deliv.status : '?';

  const updates = { status: newStatus, updated_at: new Date().toISOString() };
  if (newStatus === 'done') updates.done_at = new Date().toISOString();
  else updates.done_at = null;

  await sb.from('deliverables').update(updates).eq('id', id);

  if (deliv) {
    deliv.status = newStatus;
    deliv.updated_at = updates.updated_at;
    deliv.done_at = updates.done_at;
  }

  logActivity(clientId, 'deliverable_status_changed',
    `"${deliv ? deliv.title : '?'}" moved from ${STATUS_LABELS[oldStatus] || oldStatus} to ${STATUS_LABELS[newStatus]}`);

  fireWebhook('deliverable_status_changed', {
    client_name: cl ? cl.name : '',
    client_id: clientId,
    deliverable_title: deliv ? deliv.title : '',
    deliverable_id: id,
    old_status: oldStatus,
    new_status: newStatus,
  });
}

async function deleteDeliverable(id, clientId) {
  const cl = getClient(clientId);
  const deliv = cl ? cl.deliverables.find(d => d.id === id) : null;
  await sb.from('deliverables').delete().eq('id', id);
  if (cl) cl.deliverables = cl.deliverables.filter(d => d.id !== id);
  if (deliv) logActivity(clientId, 'deliverable_deleted', `"${deliv.title}" deleted`);
}

/* ── CLIENT SETTINGS ─────────────────────────────────────────────── */
async function saveClientSettings(clientId, settings) {
  const existing = getClient(clientId)?.settings;
  if (existing) {
    await sb.from('client_settings').update(settings).eq('client_id', clientId);
    Object.assign(existing, settings);
  } else {
    const { data } = await sb.from('client_settings').insert({ client_id: clientId, ...settings }).select().single();
    const cl = getClient(clientId);
    if (cl && data) cl.settings = data;
  }
  logActivity(clientId, 'settings_updated', `Settings updated for "${getClient(clientId)?.name || '?'}"`);
}

/* ── ACTIVITY LOG ────────────────────────────────────────────────── */
async function logActivity(clientId, action, detail, actor, meta) {
  const row = {
    client_id: clientId,
    action: action,
    detail: detail,
    actor: actor || '',
    meta: meta || {},
  };
  const { data } = await sb.from('activity_log').insert(row).select().single();
  if (data) ACTIVITY_LOG.unshift(data);
}

/* ── WEBHOOK ─────────────────────────────────────────────────────── */
async function fireWebhook(eventType, payload) {
  try {
    await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: eventType, timestamp: new Date().toISOString(), ...payload }),
    });
  } catch (e) {
    // fire-and-forget: never block UI
  }
}

/* ── HELPERS ────────────────────────────────────────────────────── */
function getClient(id) { return CLIENTS.find(c => c.id === id); }
function getTeamMember(id) { return TEAM.find(t => t.id === id); }

function avatarHTML(memberId) {
  const m = getTeamMember(memberId);
  if (!m) return '';
  return `<span class="avatar" title="${m.name}">${m.initials}</span>`;
}

function onboardingProgress(client) {
  if (!client.onboardingChecks) return null;
  const done = client.onboardingChecks.filter(c => c.done).length;
  const total = client.onboardingChecks.length;
  return { done, total, pct: Math.round((done / total) * 100) };
}

function activeDeliverables(client) {
  return (client.deliverables || []).filter(d => d.status !== 'done');
}

function doneThisWeek(client) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return (client.deliverables || []).filter(d => d.status === 'done' && d.done_at && new Date(d.done_at) >= weekAgo).length;
}

function volumeHTML(client) {
  const done = doneThisWeek(client);
  const target = client.settings?.videos_per_week || 0;
  if (target === 0) return `<span class="volume-counter">${done} done this wk</span>`;
  const cls = done >= target ? 'on-track' : 'behind';
  return `<span class="volume-counter ${cls}">${done}/${target} this wk</span>`;
}

function statusBadgeHTML(status) {
  return `<span class="status-badge" data-status="${status}">${STATUS_LABELS[status] || status}</span>`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── ROUTER ───────────────────────────────────────────────────── */
function getRoute() {
  const hash = location.hash || "#/";
  const path = hash.slice(1) || "/";
  if (path.startsWith("/client/")) {
    return { view: "client", id: parseInt(path.split("/client/")[1]) };
  }
  return { view: "pipeline" };
}

function navigate(path) { location.hash = path; }

function render() {
  const route = getRoute();
  const root = document.getElementById("appRoot");
  root.innerHTML = "";
  root.style.animation = "none";
  root.offsetHeight;
  root.style.animation = "";

  const backLink = document.getElementById("backLink");
  if (backLink) backLink.classList.toggle("visible", route.view === "client");

  if (route.view === "client") {
    renderClientDetail(root, route.id);
  } else {
    renderPipeline(root);
  }

  // Update stat pills
  const pillClients = document.getElementById("pillClients");
  const pillProd = document.getElementById("pillProduction");
  const pillDeliv = document.getElementById("pillDeliverables");
  if (pillClients) pillClients.textContent = `${CLIENTS.length} clients`;
  const prodCount = CLIENTS.filter(c => c.phase === "production" || c.phase === "special").length;
  if (pillProd) pillProd.textContent = `${prodCount} in production`;
  // Total active deliverables across all clients
  const totalActive = CLIENTS.reduce((sum, c) => sum + activeDeliverables(c).length, 0);
  if (pillDeliv) pillDeliv.textContent = `${totalActive} active`;
}

window.addEventListener("hashchange", render);
document.addEventListener("DOMContentLoaded", loadData);

/* ── PIPELINE VIEW ──────────────────────────────────────────────── */
function renderPipeline(root) {
  const pipelineClients   = CLIENTS.filter(c => c.phase === "pipeline");
  const onboardingClients = CLIENTS.filter(c => c.phase === "onboarding");
  const productionClients = CLIENTS.filter(c => c.phase === "production" || c.phase === "special");

  const board = document.createElement("div");
  board.className = "pipeline-board";

  board.appendChild(buildCol("Pipeline", "Closing soon", pipelineClients, pipelineCardHTML));
  board.appendChild(buildCol("Onboarding", "Getting set up", onboardingClients, onboardingCardHTML));
  board.appendChild(buildCol("In Production", "Content running", productionClients, productionCardHTML));

  root.appendChild(board);

  // Add Client button
  const addBar = document.createElement("div");
  addBar.className = "add-client-bar";
  addBar.innerHTML = `<button class="add-client-btn" id="addClientBtn">+ New Client</button>`;
  root.appendChild(addBar);

  // Bind card clicks
  root.querySelectorAll(".client-card[data-id]").forEach(card => {
    card.addEventListener("click", () => navigate(`/client/${card.dataset.id}`));
  });

  // Add client handler
  const addClientBtn = root.querySelector("#addClientBtn");
  if (addClientBtn) {
    addClientBtn.addEventListener("click", () => {
      const bar = root.querySelector(".add-client-bar");
      bar.innerHTML = `
        <div class="add-client-form">
          <input type="text" class="add-client-input" id="newClientName" placeholder="Client name..." autofocus />
          <button class="btn-primary" id="confirmAddClient">Add</button>
          <button class="btn-cancel" id="cancelAddClient">Cancel</button>
        </div>
      `;
      const input = bar.querySelector("#newClientName");
      input.focus();
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") bar.querySelector("#confirmAddClient").click();
        if (e.key === "Escape") bar.querySelector("#cancelAddClient").click();
      });
      bar.querySelector("#confirmAddClient").addEventListener("click", async () => {
        const name = input.value.trim();
        if (!name) return;
        const saved = await saveNewClient(name);
        if (saved) {
          CLIENTS.push({ id: saved.id, name: saved.name, phase: saved.phase, team: [], deliverables: [], settings: null });
          render();
        }
      });
      bar.querySelector("#cancelAddClient").addEventListener("click", () => render());
    });
  }
}

function buildCol(title, subtitle, clients, cardFn) {
  const col = document.createElement("div");
  col.className = "pipeline-col";
  col.innerHTML = `
    <div class="col-header">
      <div class="col-title-group">
        <span class="col-title">${title}</span>
        <span class="col-subtitle">${subtitle}</span>
      </div>
      <span class="col-count">${clients.length}</span>
    </div>
    <div class="col-body">
      ${clients.length === 0 ? '<div class="empty-state">No clients here</div>' : clients.map(cardFn).join("")}
    </div>`;
  return col;
}

function pipelineCardHTML(c) {
  return `
    <div class="client-card muted" data-id="${c.id}">
      <div class="card-name">${c.name}</div>
    </div>`;
}

function onboardingCardHTML(c) {
  const prog = onboardingProgress(c);
  const progressHTML = prog
    ? `<div class="card-progress">
        <div class="progress-label">Setup: ${prog.done} of ${prog.total} done</div>
        <div class="progress-track"><div class="progress-fill" style="width:${prog.pct}%"></div></div>
       </div>`
    : '';
  const avatarsHTML = c.team && c.team.length
    ? `<div class="card-avatars-group"><span class="card-team-label">Team:</span><div class="card-avatars">${c.team.slice(0,3).map(avatarHTML).join("")}</div></div>`
    : '';

  return `
    <div class="client-card" data-id="${c.id}">
      <div class="card-name">${c.name}</div>
      ${progressHTML}
      ${avatarsHTML ? `<div class="card-footer">${avatarsHTML}</div>` : ''}
    </div>`;
}

function productionCardHTML(c) {
  const active = activeDeliverables(c).length;
  const avatarsHTML = c.team && c.team.length
    ? `<div class="card-avatars-group"><span class="card-team-label">Team:</span><div class="card-avatars">${c.team.slice(0,3).map(avatarHTML).join("")}</div></div>`
    : '';
  const specialHTML = c.specialLabel
    ? `<span class="special-badge">${c.specialLabel}</span>`
    : '';

  return `
    <div class="client-card" data-id="${c.id}">
      <div class="card-name">${c.name}</div>
      ${specialHTML}
      <div class="card-deliverables">
        <span class="card-active-count">${active} active</span>
        ${volumeHTML(c)}
      </div>
      ${avatarsHTML ? `<div class="card-footer">${avatarsHTML}</div>` : ''}
    </div>`;
}

/* ── CLIENT DETAIL VIEW ─────────────────────────────────────────── */
function renderClientDetail(root, clientId) {
  const client = getClient(clientId);
  if (!client) {
    root.innerHTML = `<div class="empty-state">Client not found. <a href="#/">← Back</a></div>`;
    return;
  }

  const prog = onboardingProgress(client);

  // Phase stepper
  const phases = [
    { key: "pipeline",   label: "Pipeline",      desc: "Closing soon" },
    { key: "onboarding", label: "Onboarding",    desc: "Getting set up" },
    { key: "production", label: "In Production", desc: "Content running" },
  ];
  const currentIdx = phases.findIndex(p => p.key === client.phase || (client.phase === "special" && p.key === "production"));

  const stepperHTML = `
    <div class="phase-stepper">
      ${phases.map((p, i) => {
        const isCurrent = i === currentIdx;
        const isDone = i < currentIdx;
        const cls = isCurrent ? "current" : isDone ? "done" : "";
        return `
          <button class="phase-step ${cls}" data-phase="${p.key}" ${isCurrent ? 'disabled' : ''}>
            <span class="phase-step-num">${isDone ? '✓' : i + 1}</span>
            <span class="phase-step-text">
              <span class="phase-step-label">${p.label}</span>
              <span class="phase-step-desc">${p.desc}</span>
            </span>
          </button>
          ${i < phases.length - 1 ? '<span class="phase-step-arrow">→</span>' : ''}`;
      }).join("")}
    </div>`;

  // Action links
  const sett = client.settings || {};
  const hasAnalytics = sett.metricool_id && sett.metricool_id.trim();
  const hasDrive = sett.gdrive_url && sett.gdrive_url.trim();
  const actionLinksHTML = (hasAnalytics || hasDrive) ? `
    <div class="action-links">
      ${hasAnalytics ? `<a class="action-link-btn" href="${ANALYTICS_BASE}${sett.metricool_id.trim()}" target="_blank" rel="noopener">📊 View Analytics ↗</a>` : ''}
      ${hasDrive ? `<a class="action-link-btn" href="${sett.gdrive_url.trim()}" target="_blank" rel="noopener">📁 Google Drive ↗</a>` : ''}
    </div>` : '';

  // Team section
  const teamMembers = (client.team || []).map(id => getTeamMember(id)).filter(Boolean);
  const teamSection = `
    <div class="detail-section">
      <div class="detail-section-title">Team</div>
      ${teamMembers.length ? teamMembers.map(m => `
        <div class="team-member-row">
          <span class="avatar" style="width:28px;height:28px;font-size:11px;flex-shrink:0">${m.initials}</span>
          <span class="team-member-name">${m.name}</span>
          <span class="team-member-role">${m.role}</span>
          <button class="remove-member-btn" data-member-id="${m.id}" title="Remove ${m.name}">×</button>
        </div>`).join("") : '<div class="empty-hint">No team members assigned</div>'}
      <div style="padding-top:10px">
        <select class="add-member-select" id="addMemberSelect">
          <option value="">+ Add team member...</option>
          ${TEAM.filter(m => !(client.team || []).includes(m.id)).map(m =>
            `<option value="${m.id}">${m.name} — ${m.role}</option>`
          ).join("")}
        </select>
      </div>
    </div>`;

  // Onboarding checklist
  const checklistSection = client.onboardingChecks ? `
    <div class="detail-section">
      <div class="detail-section-title">Onboarding Checklist
        ${prog ? `<span class="checklist-count">${prog.done}/${prog.total}</span>` : ''}
      </div>
      <div id="checklist-${client.id}">
        ${client.onboardingChecks.map((item, i) => `
          <div class="checklist-item ${item.done ? 'done' : ''}" data-client="${client.id}" data-idx="${i}">
            <div class="check-box ${item.done ? 'checked' : ''}">
              <span class="check-icon">✓</span>
            </div>
            <span class="checklist-label">${item.label}</span>
          </div>`).join("")}
      </div>
    </div>` : '';

  // Deliverables section
  const delivs = client.deliverables || [];
  const activeCount = activeDeliverables(client).length;
  const delivSection = `
    <div class="detail-section">
      <div class="detail-section-title">
        Deliverables
        <span class="section-count">${activeCount} active</span>
        <button class="section-add-btn" id="addDelivBtn">+ Add</button>
      </div>
      <div id="delivAddArea"></div>
      <div id="delivList">
        ${delivs.length === 0 ? '<div class="empty-hint">No deliverables yet</div>' : delivs.map(d => `
          <div class="deliverable-row" data-deliv-id="${d.id}">
            <span class="deliverable-title">${escHTML(d.title)}</span>
            ${d.director_led ? '<span class="director-flag">Director</span>' : ''}
            <span class="status-badge" data-status="${d.status}" data-deliv-id="${d.id}">${STATUS_LABELS[d.status]}</span>
            <span class="deliverable-time">${timeAgo(d.updated_at || d.created_at)}</span>
            <button class="deliverable-delete" data-deliv-id="${d.id}" title="Delete">×</button>
          </div>`).join("")}
      </div>
    </div>`;

  // Settings section
  const settingsSection = `
    <div class="detail-section">
      <div class="detail-section-title">Settings</div>
      <div class="settings-row">
        <span class="settings-label">Google Drive URL</span>
        <input class="settings-input" id="settGdrive" type="url" placeholder="https://drive.google.com/..." value="${escHTML(sett.gdrive_url || '')}" />
      </div>
      <div class="settings-row">
        <span class="settings-label">Videos / week</span>
        <input class="settings-input" id="settVpw" type="number" min="0" placeholder="0" value="${sett.videos_per_week || 0}" style="max-width:100px" />
      </div>
      <div class="settings-row">
        <span class="settings-label">Metricool ID</span>
        <input class="settings-input" id="settMetricool" type="text" placeholder="brand-id" value="${escHTML(sett.metricool_id || '')}" />
      </div>
      <button class="btn-save" id="saveSettingsBtn">Save Settings</button>
    </div>`;

  // Activity feed
  const clientActivity = ACTIVITY_LOG.filter(a => a.client_id === clientId).slice(0, 15);
  const activitySection = `
    <div class="detail-section">
      <div class="detail-section-title">Recent Activity</div>
      ${clientActivity.length === 0 ? '<div class="empty-hint">No activity yet</div>' : clientActivity.map(a => `
        <div class="activity-item">
          <span class="activity-detail">${escHTML(a.detail)}</span>
          <span class="activity-time">${timeAgo(a.created_at)}</span>
        </div>`).join("")}
    </div>`;

  root.innerHTML = `
    <div class="detail-header">
      <div class="detail-name">${client.name}</div>
      <button class="delete-client-btn" id="deleteClientBtn" title="Remove client">Remove</button>
    </div>
    ${actionLinksHTML}
    ${stepperHTML}
    ${teamSection}
    ${checklistSection}
    ${delivSection}
    ${settingsSection}
    ${activitySection}
  `;

  // ── BIND EVENTS ─────────────────────────────────────────────

  // Delete client
  const deleteBtn = root.querySelector("#deleteClientBtn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      deleteBtn.textContent = "Confirm?";
      deleteBtn.classList.add("confirm");
      deleteBtn.addEventListener("click", async () => {
        await deleteClientDB(clientId);
        const idx = CLIENTS.findIndex(c => c.id === clientId);
        if (idx !== -1) CLIENTS.splice(idx, 1);
        navigate("/");
      }, { once: true });
      setTimeout(() => {
        if (deleteBtn && !deleteBtn.classList.contains("gone")) {
          deleteBtn.textContent = "Remove";
          deleteBtn.classList.remove("confirm");
        }
      }, 3000);
    }, { once: true });
  }

  // Phase stepper clicks
  root.querySelectorAll(".phase-step:not([disabled])").forEach(btn => {
    btn.addEventListener("click", async () => {
      const newPhase = btn.dataset.phase;
      const cl = getClient(clientId);
      if (!cl) return;
      await updatePhase(clientId, newPhase);
      cl.phase = newPhase;
      if (newPhase === "onboarding" && !cl.onboardingChecks) {
        cl.onboardingChecks = await createOnboardingChecks(clientId);
      }
      renderClientDetail(root, clientId);
    });
  });

  // Remove member
  root.querySelectorAll(".remove-member-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const memberId = parseInt(btn.dataset.memberId);
      const cl = getClient(clientId);
      if (!cl) return;
      await removeTeamMemberDB(clientId, memberId);
      cl.team = (cl.team || []).filter(id => id !== memberId);
      renderClientDetail(root, clientId);
    });
  });

  // Add member
  const addSelect = root.querySelector("#addMemberSelect");
  if (addSelect) {
    addSelect.addEventListener("change", async (e) => {
      const memberId = parseInt(e.target.value);
      if (!memberId) return;
      const cl = getClient(clientId);
      if (!cl) return;
      if (!cl.team) cl.team = [];
      if (!cl.team.includes(memberId)) {
        await addTeamMemberDB(clientId, memberId);
        cl.team.push(memberId);
      }
      renderClientDetail(root, clientId);
    });
  }

  // Checklist toggle
  root.querySelectorAll(".checklist-item").forEach(item => {
    item.addEventListener("click", async () => {
      const idx = parseInt(item.dataset.idx);
      const cid = parseInt(item.dataset.client);
      const cl = getClient(cid);
      if (!cl || !cl.onboardingChecks) return;
      const check = cl.onboardingChecks[idx];
      check.done = !check.done;
      await toggleCheckDB(check.id, check.done);
      item.classList.toggle("done", check.done);
      item.querySelector(".check-box").classList.toggle("checked", check.done);
      const prog2 = onboardingProgress(cl);
      const countEl = root.querySelector(".checklist-count");
      if (countEl && prog2) countEl.textContent = `${prog2.done}/${prog2.total}`;
      logActivity(clientId, 'checklist_toggled', `"${check.label}" ${check.done ? 'completed' : 'unchecked'} for "${cl.name}"`);
    });
  });

  // ── DELIVERABLES ────────────────────────────────────────────

  // Add deliverable button
  const addDelivBtn = root.querySelector("#addDelivBtn");
  const addArea = root.querySelector("#delivAddArea");
  if (addDelivBtn && addArea) {
    addDelivBtn.addEventListener("click", () => {
      addArea.innerHTML = `
        <div class="add-deliverable-form">
          <input type="text" class="add-deliverable-input" id="newDelivTitle" placeholder="Video title..." autofocus />
          <label class="director-check-label"><input type="checkbox" id="newDelivDirector" /> Director-led</label>
          <button class="btn-primary" id="confirmAddDeliv">Add</button>
          <button class="btn-cancel" id="cancelAddDeliv">Cancel</button>
        </div>`;
      const inp = addArea.querySelector("#newDelivTitle");
      inp.focus();
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addArea.querySelector("#confirmAddDeliv").click();
        if (e.key === "Escape") addArea.querySelector("#cancelAddDeliv").click();
      });
      addArea.querySelector("#confirmAddDeliv").addEventListener("click", async () => {
        const title = inp.value.trim();
        if (!title) return;
        const dirLed = addArea.querySelector("#newDelivDirector").checked;
        await createDeliverable(clientId, title, dirLed);
        renderClientDetail(root, clientId);
      });
      addArea.querySelector("#cancelAddDeliv").addEventListener("click", () => {
        addArea.innerHTML = '';
      });
    });
  }

  // Status badge clicks → dropdown
  root.querySelectorAll(".status-badge[data-deliv-id]").forEach(badge => {
    badge.addEventListener("click", (e) => {
      e.stopPropagation();
      // Close any existing dropdown
      document.querySelectorAll(".status-dropdown").forEach(d => d.remove());

      const delivId = parseInt(badge.dataset.delivId);
      const currentStatus = badge.dataset.status;

      const dropdown = document.createElement("div");
      dropdown.className = "status-dropdown";
      dropdown.innerHTML = DELIVERABLE_STATUSES.map(s => `
        <div class="status-dropdown-item ${s === currentStatus ? 'current' : ''}" data-status="${s}">
          <span class="status-dot" style="background:${STATUS_COLORS[s]}"></span>
          ${STATUS_LABELS[s]}
        </div>`).join("");

      badge.style.position = 'relative';
      badge.appendChild(dropdown);

      dropdown.querySelectorAll(".status-dropdown-item").forEach(item => {
        item.addEventListener("click", async (e2) => {
          e2.stopPropagation();
          const newStatus = item.dataset.status;
          if (newStatus === currentStatus) { dropdown.remove(); return; }
          await updateDeliverableStatus(delivId, newStatus, clientId);
          renderClientDetail(root, clientId);
        });
      });

      // Close on outside click
      const closeDropdown = (evt) => {
        if (!dropdown.contains(evt.target)) {
          dropdown.remove();
          document.removeEventListener("click", closeDropdown);
        }
      };
      setTimeout(() => document.addEventListener("click", closeDropdown), 0);
    });
  });

  // Delete deliverable
  root.querySelectorAll(".deliverable-delete").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const delivId = parseInt(btn.dataset.delivId);
      await deleteDeliverable(delivId, clientId);
      renderClientDetail(root, clientId);
    });
  });

  // ── SETTINGS ────────────────────────────────────────────────
  const saveSettingsBtn = root.querySelector("#saveSettingsBtn");
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", async () => {
      const gdrive = root.querySelector("#settGdrive").value.trim();
      const vpw = parseInt(root.querySelector("#settVpw").value) || 0;
      const metricool = root.querySelector("#settMetricool").value.trim();
      await saveClientSettings(clientId, {
        gdrive_url: gdrive,
        videos_per_week: vpw,
        metricool_id: metricool,
      });
      saveSettingsBtn.textContent = "Saved ✓";
      saveSettingsBtn.classList.add("saved");
      setTimeout(() => {
        saveSettingsBtn.textContent = "Save Settings";
        saveSettingsBtn.classList.remove("saved");
      }, 2000);
      // Re-render to update action links
      renderClientDetail(root, clientId);
    });
  }
}

/* ── UTILITY ─────────────────────────────────────────────────────── */
function escHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
