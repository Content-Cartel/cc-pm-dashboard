/* ─────────────────────────────────────────────────────────────────
   CC PM Dashboard v6  ·  app.js
   Supabase-powered: board, phase stepper, onboarding checklist,
   weekly production checklist, team, activity feed, settings, webhooks
   ───────────────────────────────────────────────────────────────── */

/* ── SUPABASE CONNECTION ─────────────────────────────────────────── */
const SUPABASE_URL = "https://andcsslmnogpuntfuouh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFuZGNzc2xtbm9ncHVudGZ1b3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMDQ2OTMsImV4cCI6MjA4Nzg4MDY5M30.3i0zOowv6SU4xWvGy506KMpzh8qp634iwfIH8FQVTgA";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* ── CONSTANTS ───────────────────────────────────────────────────── */
const CHECKLIST_STEPS = [
  { key: 'scripts_sent',      label: 'Scripts sent',              owner: 'LF Creative' },
  { key: 'footage_received',  label: 'Footage received',          owner: 'Client / CSM' },
  { key: 'edit_delivered',    label: 'Edit delivered',             owner: 'LF Editor' },
  { key: 'qc_approved',      label: 'QC approved',                owner: 'LF Creative' },
  { key: 'published',        label: 'Published',                   owner: 'Auto / SF Creative' },
  { key: 'cta_active',       label: 'CTA / Lead Magnet Active',   owner: 'Growth / CSM' },
];

const N8N_CHECKLIST_WEBHOOK_URL = 'https://content-cartel-1.app.n8n.cloud/webhook/pm-checklist';
const N8N_PHASE_WEBHOOK_URL = 'https://content-cartel-1.app.n8n.cloud/webhook/pm-phase-change';
const N8N_EDIT_DELIVERED_WEBHOOK_URL = 'https://content-cartel-1.app.n8n.cloud/webhook/pm-edit-delivered';
const ANALYTICS_BASE = 'https://analytics.contentcartel.net/#/client/';

const SHORTS_STEPS = [
  { key: 'shorts_edited',    label: 'Shorts edited',    owner: 'SF Editor' },
  { key: 'shorts_published', label: 'Shorts published', owner: 'SF Creative' },
];
const ALL_STEPS = [...CHECKLIST_STEPS, ...SHORTS_STEPS];

/* ── GLOBAL STATE ────────────────────────────────────────────────── */
let TEAM = [];
let CLIENTS = [];
let ACTIVITY_LOG = [];

/* ── LOAD DATA FROM SUPABASE ─────────────────────────────────────── */
async function loadData() {
  const [teamRes, clientRes, assignRes, checkRes, weeklyRes, settingsRes, activityRes] = await Promise.all([
    sb.from('team_members').select('*').order('id'),
    sb.from('clients').select('*').order('id'),
    sb.from('client_team').select('*'),
    sb.from('onboarding_checks').select('*').order('id'),
    sb.from('weekly_checklist').select('*').order('week_start', { ascending: false }),
    sb.from('client_settings').select('*'),
    sb.from('activity_log').select('*').order('created_at', { ascending: false }).limit(200),
  ]);

  TEAM = (teamRes.data || []).map(t => ({
    id: t.id, initials: t.initials, name: t.name, role: t.role
  }));

  ACTIVITY_LOG = activityRes.data || [];

  const allWeeklies = weeklyRes.data || [];
  const allSettings = settingsRes.data || [];
  const thisWeek = getCurrentWeekStart();
  const lastWeek = getPreviousWeekStart();

  CLIENTS = (clientRes.data || []).map(c => {
    const client = {
      id: c.id,
      name: c.name,
      phase: c.phase,
      team: (assignRes.data || []).filter(a => a.client_id === c.id).map(a => a.team_member_id),
      weeklyChecklist: null,
      prevWeekChecklist: null,
      settings: allSettings.find(s => s.client_id === c.id) || null,
    };
    const clientWeeklies = allWeeklies.filter(w => w.client_id === c.id);
    client.weeklyChecklist = clientWeeklies.find(w => w.week_start === thisWeek) || null;
    client.prevWeekChecklist = clientWeeklies.find(w => w.week_start === lastWeek) || null;

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

/* ── SAVE FUNCTIONS ────────────────────────────────────────────── */
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
  fireWebhookTo(N8N_PHASE_WEBHOOK_URL, 'phase_changed', {
    client_name: cl ? cl.name : '', client_id: clientId,
    old_phase: oldPhase, new_phase: newPhase,
  });
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

/* ── WEEKLY CHECKLIST CRUD ──────────────────────────────────────── */
async function ensureWeeklyChecklist(clientId) {
  const weekStart = getCurrentWeekStart();
  const cl = getClient(clientId);
  if (cl && cl.weeklyChecklist && cl.weeklyChecklist.week_start === weekStart) {
    return cl.weeklyChecklist;
  }
  // Check if it exists in DB
  const { data: existing } = await sb.from('weekly_checklist')
    .select('*')
    .eq('client_id', clientId)
    .eq('week_start', weekStart)
    .maybeSingle();

  if (existing) {
    if (cl) cl.weeklyChecklist = existing;
    return existing;
  }

  // Create new row for this week
  const { data: created } = await sb.from('weekly_checklist')
    .insert({ client_id: clientId, week_start: weekStart })
    .select()
    .single();

  if (cl && created) cl.weeklyChecklist = created;
  return created;
}

async function toggleChecklistStep(clientId, stepKey, done, actor) {
  const checklist = await ensureWeeklyChecklist(clientId);
  if (!checklist) return;

  const updates = {};
  updates[stepKey] = done;
  updates[stepKey + '_at'] = done ? new Date().toISOString() : null;
  updates[stepKey + '_by'] = done ? (actor || '') : '';

  await sb.from('weekly_checklist').update(updates).eq('id', checklist.id);

  // Update local state
  Object.assign(checklist, updates);

  const cl = getClient(clientId);
  const stepLabel = ALL_STEPS.find(s => s.key === stepKey)?.label || stepKey;
  const detail = actor
    ? `${actor} ${done ? 'checked' : 'unchecked'} "${stepLabel}" for "${cl?.name || '?'}"`
    : `"${stepLabel}" ${done ? 'checked' : 'unchecked'} for "${cl?.name || '?'}"`;

  logActivity(clientId, 'checklist_step_toggled', detail, actor);

  // Fire webhook for n8n
  const activeSteps = cl ? getActiveSteps(cl) : CHECKLIST_STEPS;
  fireWebhookTo(N8N_CHECKLIST_WEBHOOK_URL, 'checklist_step_toggled', {
    client_name: cl?.name || '',
    client_id: clientId,
    step: stepKey,
    step_label: stepLabel,
    done: done,
    actor: actor || '',
    week_start: checklist.week_start,
    progress: checklistProgress(checklist, activeSteps),
  });

  // Slack notification when an edit is delivered (LF or Shorts)
  if ((stepKey === 'edit_delivered' || stepKey === 'shorts_edited') && done) {
    fireWebhookTo(N8N_EDIT_DELIVERED_WEBHOOK_URL, 'edit_delivered', {
      client_name: cl?.name || '',
      client_id: clientId,
      step: stepKey,
      step_label: stepLabel,
      actor: actor || '',
      slack_channel: cl?.settings?.slack_channel || '',
      week_start: checklist.week_start,
    });
  }

  // Auto-detect: all active steps complete → fire week-complete webhook
  if (done) {
    const allDone = activeSteps.every(s => checklist[s.key]);
    if (allDone) {
      fireWebhookTo(N8N_CHECKLIST_WEBHOOK_URL, 'week_complete', {
        client_name: cl?.name || '',
        client_id: clientId,
        slack_channel: cl?.settings?.slack_channel || '',
        week_start: checklist.week_start,
      });
      logActivity(clientId, 'week_complete', `All weekly steps completed for "${cl?.name || '?'}" 🎉`, actor);
    }
  }
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

/* ── WEBHOOKS ────────────────────────────────────────────────────── */
async function fireWebhookTo(url, eventType, payload) {
  try {
    await fetch(url, {
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

/* ── WEEK HELPERS ─────────────────────────────────────────────── */
function getCurrentWeekStart() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().split('T')[0]; // "YYYY-MM-DD"
}

function getPreviousWeekStart() {
  const current = new Date(getCurrentWeekStart() + 'T00:00:00');
  current.setDate(current.getDate() - 7);
  return current.toISOString().split('T')[0];
}

function checklistProgress(checklist, steps) {
  steps = steps || CHECKLIST_STEPS;
  if (!checklist) return { done: 0, total: steps.length };
  let done = 0;
  for (const step of steps) {
    if (checklist[step.key]) done++;
  }
  return { done, total: steps.length };
}

function shortsEnabled(client) {
  return client.settings && client.settings.shorts_per_week > 0;
}

function getActiveSteps(client) {
  return shortsEnabled(client) ? ALL_STEPS : CHECKLIST_STEPS;
}

function checklistProgressHTML(client) {
  const steps = getActiveSteps(client);
  const prog = checklistProgress(client.weeklyChecklist, steps);
  if (prog.done === prog.total) {
    return `<span class="volume-counter on-track">${prog.done}/${prog.total} this wk</span>`;
  } else if (prog.done > 0) {
    return `<span class="volume-counter">${prog.done}/${prog.total} this wk</span>`;
  }
  return `<span class="volume-counter behind">0/${prog.total} this wk</span>`;
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
  const prodClients = CLIENTS.filter(c => c.phase === "production" || c.phase === "special");
  if (pillProd) pillProd.textContent = `${prodClients.length} in production`;
  const totalChecked = prodClients.reduce((sum, c) => sum + checklistProgress(c.weeklyChecklist, getActiveSteps(c)).done, 0);
  const totalPossible = prodClients.reduce((sum, c) => sum + getActiveSteps(c).length, 0);
  if (pillDeliv) pillDeliv.textContent = `${totalChecked}/${totalPossible} steps done`;
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
          CLIENTS.push({ id: saved.id, name: saved.name, phase: saved.phase, team: [], weeklyChecklist: null, prevWeekChecklist: null, settings: null });
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
  const avatarsHTML = c.team && c.team.length
    ? `<div class="card-avatars-group"><span class="card-team-label">Team:</span><div class="card-avatars">${c.team.slice(0,3).map(avatarHTML).join("")}</div></div>`
    : '';
  const specialHTML = c.specialLabel
    ? `<span class="special-badge">${c.specialLabel}</span>`
    : '';

  const prog = checklistProgress(c.weeklyChecklist);
  const prevProg = checklistProgress(c.prevWeekChecklist);
  const prevHTML = c.prevWeekChecklist
    ? `<span class="prev-week-indicator" title="Last week">${prevProg.done === prevProg.total ? '✅' : prevProg.done + '/' + prevProg.total}</span>`
    : '';

  return `
    <div class="client-card" data-id="${c.id}">
      <div class="card-name">${c.name}</div>
      ${specialHTML}
      <div class="card-deliverables">
        ${checklistProgressHTML(c)}
        ${prevHTML}
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

  // Action links — build from all configured URLs
  const sett = client.settings || {};
  const hasAnalytics = sett.metricool_id && sett.metricool_id.trim();
  const clientLinks = [
    { url: sett.gdrive_url,            label: '📁 Google Drive' },
    { url: sett.sf_scripts_url,        label: '📝 SF Scripts' },
    { url: sett.lf_scripts_url,        label: '📝 LF Scripts' },
    { url: sett.main_links_url,        label: '📎 Main Links' },
    { url: sett.kpis_url,              label: '📈 KPIs' },
    { url: sett.growth_ops_url,        label: '🚀 Growth Ops' },
    { url: sett.written_content_url,   label: '✏️ Written Content' },
    { url: sett.ai_url,                label: '🤖 AI' },
    { url: sett.social_dashboard_url,  label: '📱 Social Dashboard' },
  ].filter(l => l.url && l.url.trim());

  const hasAnyLinks = hasAnalytics || clientLinks.length > 0;
  const actionLinksHTML = hasAnyLinks ? `
    <div class="action-links">
      ${hasAnalytics ? `<a class="action-link-btn" href="${ANALYTICS_BASE}${sett.metricool_id.trim()}" target="_blank" rel="noopener">📊 Analytics ↗</a>` : ''}
      ${clientLinks.map(l => `<a class="action-link-btn" href="${l.url.trim()}" target="_blank" rel="noopener">${l.label} ↗</a>`).join('')}
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

  // Onboarding checklist (onboarding phase only)
  const onboardingChecklistSection = client.onboardingChecks ? `
    <div class="detail-section">
      <div class="detail-section-title">Onboarding Checklist
        ${prog ? `<span class="checklist-count">${prog.done}/${prog.total}</span>` : ''}
      </div>
      <div id="checklist-${client.id}">
        ${client.onboardingChecks.map((item, i) => `
          <div class="checklist-item onboarding-check ${item.done ? 'done' : ''}" data-client="${client.id}" data-idx="${i}">
            <div class="check-box ${item.done ? 'checked' : ''}">
              <span class="check-icon">✓</span>
            </div>
            <span class="checklist-label">${item.label}</span>
          </div>`).join("")}
      </div>
    </div>` : '';

  // Weekly production checklist (production/special phase only)
  const isProduction = client.phase === 'production' || client.phase === 'special';
  const wc = client.weeklyChecklist;
  const wcProg = checklistProgress(wc);
  const prevWc = client.prevWeekChecklist;
  const prevWcProg = checklistProgress(prevWc);

  const hasShorts = shortsEnabled(client);
  const allSteps = getActiveSteps(client);
  const combinedProg = checklistProgress(wc, allSteps);
  const prevCombinedProg = checklistProgress(prevWc, getActiveSteps(client));

  function renderStepRows(steps, startIdx) {
    return steps.map((step, i) => {
      const isDone = wc ? wc[step.key] : false;
      const doneAt = wc ? wc[step.key + '_at'] : null;
      const doneBy = wc ? wc[step.key + '_by'] : '';
      return `
      <div class="checklist-item weekly-check ${isDone ? 'done' : ''}" data-client="${client.id}" data-step="${step.key}" data-idx="${startIdx + i}">
        <div class="check-box ${isDone ? 'checked' : ''}">
          <span class="check-icon">✓</span>
        </div>
        <span class="checklist-label">${step.label}</span>
        <span class="checklist-owner">${step.owner}</span>
        ${isDone && doneBy ? `<span class="checklist-actor">${escHTML(doneBy)}</span>` : ''}
        ${isDone && doneAt ? `<span class="checklist-time">${timeAgo(doneAt)}</span>` : ''}
      </div>`;
    }).join("");
  }

  const weeklyChecklistSection = isProduction ? `
    <div class="detail-section">
      <div class="detail-section-title">
        Weekly Checklist
        <span class="checklist-count" id="wcCount">${combinedProg.done}/${combinedProg.total}</span>
        ${prevWc ? `<span class="prev-week-badge">${prevCombinedProg.done === prevCombinedProg.total ? 'Last wk: ✅' : 'Last wk: ' + prevCombinedProg.done + '/' + prevCombinedProg.total}</span>` : ''}
        ${combinedProg.done === combinedProg.total && combinedProg.total > 0 ? '<span class="week-complete-badge">Week Complete 🎉</span>' : ''}
      </div>
      <div id="weeklyChecklist-${client.id}">
        <div class="checklist-divider">Long Form</div>
        ${renderStepRows(CHECKLIST_STEPS, 0)}
        ${hasShorts ? `
          <div class="checklist-divider">Shorts</div>
          ${renderStepRows(SHORTS_STEPS, CHECKLIST_STEPS.length)}
        ` : ''}
      </div>
    </div>` : '';

  // Settings section
  const settingsSection = `
    <div class="detail-section">
      <div class="detail-section-title">Settings</div>

      <div class="settings-group-label">Core</div>
      <div class="settings-row">
        <span class="settings-label">Videos / week</span>
        <input class="settings-input" id="settVpw" type="number" min="0" placeholder="0" value="${sett.videos_per_week || 0}" style="max-width:100px" />
      </div>
      <div class="settings-row">
        <span class="settings-label">Shorts / week</span>
        <input class="settings-input" id="settSpw" type="number" min="0" placeholder="0" value="${sett.shorts_per_week || 0}" style="max-width:100px" />
      </div>
      <div class="settings-row">
        <span class="settings-label">Metricool ID</span>
        <input class="settings-input" id="settMetricool" type="text" placeholder="brand-id" value="${escHTML(sett.metricool_id || '')}" />
      </div>
      <div class="settings-row">
        <span class="settings-label">Slack Channel</span>
        <input class="settings-input" id="settSlack" type="text" placeholder="#client-cc-internal" value="${escHTML(sett.slack_channel || '')}" />
      </div>
      <div class="settings-group-label">GHL Integration</div>
      <div class="settings-row">
        <span class="settings-label">Location ID</span>
        <input class="settings-input" id="settGhlLocationId" type="text" placeholder="GHL location/sub-account ID" value="${escHTML(sett.ghl_location_id || '')}" />
      </div>
      <div class="settings-row">
        <span class="settings-label">API Token</span>
        <input class="settings-input" id="settGhlToken" type="password" placeholder="${sett.ghl_location_id ? '••••••• (saved — enter new to replace)' : 'pit-xxxxx (Private Integration token)'}" value="" />
      </div>
      <div class="settings-row">
        <span class="settings-label">Status</span>
        <span id="ghlStatus" style="font-size:13px;color:${sett.ghl_location_id ? 'var(--green,#22c55e)' : 'var(--text-muted)'}">${sett.ghl_location_id ? 'Connected' : 'Not configured'}</span>
      </div>
      <div class="settings-row">
        <span class="settings-label">Lead Value ($/lead)</span>
        <input class="settings-input" id="settLeadValue" type="number" min="0" step="0.01" placeholder="e.g. 10.00" value="${sett.lead_value_dollars || ''}" />
      </div>

      <div class="settings-group-label">Client Links</div>
      <div class="settings-row">
        <span class="settings-label">📁 Google Drive</span>
        <input class="settings-input" id="settGdrive" type="url" placeholder="https://drive.google.com/..." value="${escHTML(sett.gdrive_url || '')}" />
      </div>
      <div class="settings-row">
        <span class="settings-label">📝 SF Scripts</span>
        <input class="settings-input" id="settSfScripts" type="url" placeholder="https://docs.google.com/..." value="${escHTML(sett.sf_scripts_url || '')}" />
      </div>
      <div class="settings-row">
        <span class="settings-label">📝 LF Scripts</span>
        <input class="settings-input" id="settLfScripts" type="url" placeholder="https://docs.google.com/..." value="${escHTML(sett.lf_scripts_url || '')}" />
      </div>
      <div class="settings-row">
        <span class="settings-label">📎 Main Links</span>
        <input class="settings-input" id="settMainLinks" type="url" placeholder="https://..." value="${escHTML(sett.main_links_url || '')}" />
      </div>
      <div class="settings-row">
        <span class="settings-label">📈 KPIs</span>
        <input class="settings-input" id="settKpis" type="url" placeholder="https://..." value="${escHTML(sett.kpis_url || '')}" />
      </div>
      <div class="settings-row">
        <span class="settings-label">🚀 Growth Ops</span>
        <input class="settings-input" id="settGrowthOps" type="url" placeholder="https://..." value="${escHTML(sett.growth_ops_url || '')}" />
      </div>
      <div class="settings-row">
        <span class="settings-label">✏️ Written Content</span>
        <input class="settings-input" id="settWrittenContent" type="url" placeholder="https://docs.google.com/..." value="${escHTML(sett.written_content_url || '')}" />
      </div>
      <div class="settings-row">
        <span class="settings-label">🤖 AI</span>
        <input class="settings-input" id="settAi" type="url" placeholder="https://..." value="${escHTML(sett.ai_url || '')}" />
      </div>
      <div class="settings-row">
        <span class="settings-label">📱 Social Dashboard</span>
        <input class="settings-input" id="settSocialDashboard" type="url" placeholder="https://..." value="${escHTML(sett.social_dashboard_url || '')}" />
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
    ${onboardingChecklistSection}
    ${weeklyChecklistSection}
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

  // Onboarding checklist toggle
  root.querySelectorAll(".onboarding-check").forEach(item => {
    item.addEventListener("click", async () => {
      const idx = parseInt(item.dataset.idx);
      const cid = parseInt(item.dataset.client);
      const cl = getClient(cid);
      if (!cl || !cl.onboardingChecks) return;
      const check = cl.onboardingChecks[idx];
      check.done = !check.done;
      await toggleCheckDB(check.id, check.done);
      logActivity(clientId, 'checklist_toggled', `"${check.label}" ${check.done ? 'completed' : 'unchecked'} for "${cl.name}"`);

      // Auto-advance: all onboarding steps done → move to production
      const allOnboardingDone = cl.onboardingChecks.every(c => c.done);
      if (allOnboardingDone && check.done) {
        await updatePhase(clientId, 'production');
        cl.phase = 'production';
        logActivity(clientId, 'auto_advanced', `"${cl.name}" auto-moved to Production (onboarding complete) 🚀`);
        renderClientDetail(root, clientId);
        return;
      }

      item.classList.toggle("done", check.done);
      item.querySelector(".check-box").classList.toggle("checked", check.done);
      const prog2 = onboardingProgress(cl);
      const countEl = root.querySelector(".checklist-count");
      if (countEl && prog2) countEl.textContent = `${prog2.done}/${prog2.total}`;
    });
  });

  // Weekly production checklist toggle
  root.querySelectorAll(".weekly-check").forEach(item => {
    item.addEventListener("click", async () => {
      const cid = parseInt(item.dataset.client);
      const stepKey = item.dataset.step;
      const cl = getClient(cid);
      if (!cl) return;

      const wc2 = cl.weeklyChecklist;
      const currentlyDone = wc2 ? wc2[stepKey] : false;
      const newDone = !currentlyDone;

      // Get actor name (prompted once, saved in localStorage)
      let actor = '';
      if (newDone) {
        actor = localStorage.getItem('cc_pm_actor') || '';
        if (!actor) {
          actor = prompt('Your name or initials:') || '';
          if (actor) localStorage.setItem('cc_pm_actor', actor);
        }
      }

      await toggleChecklistStep(cid, stepKey, newDone, actor);
      renderClientDetail(root, cid);
    });
  });

  // ── SETTINGS ────────────────────────────────────────────────
  const saveSettingsBtn = root.querySelector("#saveSettingsBtn");
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", async () => {
      const ghlLocationId = root.querySelector("#settGhlLocationId").value.trim();
      const ghlToken = root.querySelector("#settGhlToken").value.trim();

      // Save settings to Supabase (token is NOT stored in Supabase)
      await saveClientSettings(clientId, {
        videos_per_week:     parseInt(root.querySelector("#settVpw").value) || 0,
        shorts_per_week:     parseInt(root.querySelector("#settSpw").value) || 0,
        metricool_id:        root.querySelector("#settMetricool").value.trim(),
        slack_channel:       root.querySelector("#settSlack").value.trim(),
        ghl_location_id:     ghlLocationId,
        lead_value_dollars:  parseFloat(root.querySelector("#settLeadValue").value) || 0,
        gdrive_url:          root.querySelector("#settGdrive").value.trim(),
        sf_scripts_url:      root.querySelector("#settSfScripts").value.trim(),
        lf_scripts_url:      root.querySelector("#settLfScripts").value.trim(),
        main_links_url:      root.querySelector("#settMainLinks").value.trim(),
        kpis_url:            root.querySelector("#settKpis").value.trim(),
        growth_ops_url:      root.querySelector("#settGrowthOps").value.trim(),
        written_content_url: root.querySelector("#settWrittenContent").value.trim(),
        ai_url:              root.querySelector("#settAi").value.trim(),
        social_dashboard_url:root.querySelector("#settSocialDashboard").value.trim(),
      });

      // If GHL token provided, store it on the analytics server
      if (ghlLocationId && ghlToken) {
        try {
          const tokenUrl = `https://analytics.contentcartel.net/api/ghl/set-token?` +
            `adminKey=cc-secret-12&locationId=${encodeURIComponent(ghlLocationId)}` +
            `&token=${encodeURIComponent(ghlToken)}`;
          const res = await fetch(tokenUrl);
          if (!res.ok) throw new Error(`Token save failed: ${res.status}`);
          const statusEl = root.querySelector("#ghlStatus");
          if (statusEl) { statusEl.textContent = "Connected"; statusEl.style.color = "var(--green,#22c55e)"; }
        } catch (err) {
          console.error("GHL token save error:", err);
          const statusEl = root.querySelector("#ghlStatus");
          if (statusEl) { statusEl.textContent = "Token save failed — check console"; statusEl.style.color = "#ef4444"; }
        }
      }

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
