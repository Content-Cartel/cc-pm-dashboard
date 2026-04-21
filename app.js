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

const SF_STEPS = [
  { key: 'sf_clips_delivered', label: 'SF clips delivered', owner: 'SF Editor' },
  { key: 'sf_qc_approved',    label: 'SF QC approved',     owner: 'SF Creative' },
  { key: 'sf_published',      label: 'SF published',       owner: 'Auto / SF Creative' },
];
const WRITTEN_STEPS = [
  { key: 'wc_draft_sent', label: 'Draft sent',     owner: 'Copywriter' },
  { key: 'wc_approved',   label: 'WC approved',    owner: 'CSM / Client' },
  { key: 'wc_published',  label: 'WC published',   owner: 'Growth / CSM' },
];
const ALL_STEPS = [...CHECKLIST_STEPS, ...SF_STEPS, ...WRITTEN_STEPS];

const FUNNEL_STEPS = [
  { key: 'funnel_lead_magnet',    label: 'Lead Magnet Live' },
  { key: 'funnel_vsl_routing',    label: 'VSL Routing Active' },
  { key: 'funnel_dm_automation',  label: 'DM Automation Firing' },
];

/* ── GLOBAL STATE ────────────────────────────────────────────────── */
let TEAM = [];
let CLIENTS = [];
let ACTIVITY_LOG = [];

/* ── LOAD DATA FROM SUPABASE ─────────────────────────────────────── */
async function loadData() {
  // ── Dashboard password gate ──
  if (!sessionStorage.getItem('cc_dashboard_auth')) {
    renderDashboardGate();
    return;
  }

  const [teamRes, clientRes, assignRes, checkRes, weeklyRes, settingsRes, activityRes, goalsRes, calRes, tasksRes] = await Promise.all([
    sb.from('team_members').select('*').order('id'),
    sb.from('clients').select('*').order('id'),
    sb.from('client_team').select('*'),
    sb.from('onboarding_checks').select('*').order('id'),
    sb.from('weekly_checklist').select('*').order('week_start', { ascending: false }),
    sb.from('client_settings').select('*'),
    sb.from('activity_log').select('*').order('created_at', { ascending: false }).limit(200),
    sb.from('client_goals').select('*').order('created_at', { ascending: false }),
    sb.from('client_calendar_entries').select('*').order('publish_date', { ascending: true, nullsFirst: false }),
    sb.from('client_tasks').select('*').order('created_at', { ascending: false }),
  ]);

  TEAM = (teamRes.data || []).map(t => ({
    id: t.id, initials: t.initials, name: t.name, role: t.role
  }));

  ACTIVITY_LOG = activityRes.data || [];

  const allWeeklies = weeklyRes.data || [];
  const allSettings = settingsRes.data || [];
  const thisWeek = getCurrentWeekStart();
  const lastWeek = getPreviousWeekStart();

  const allGoals = goalsRes.data || [];
  const allCalendarEntries = calRes.data || [];
  const allTasks = tasksRes.data || [];

  CLIENTS = (clientRes.data || []).map(c => {
    const client = {
      id: c.id,
      name: c.name,
      phase: c.phase,
      team: (assignRes.data || []).filter(a => a.client_id === c.id).map(a => a.team_member_id),
      weeklyChecklist: null,
      prevWeekChecklist: null,
      settings: allSettings.find(s => s.client_id === c.id) || null,
      goals: allGoals.filter(g => g.client_id === c.id),
      calendarEntries: allCalendarEntries.filter(e => e.client_id === c.id),
      tasks: allTasks.filter(t => t.client_id === c.id),
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
  const { error } = await sb.from('clients').delete().eq('id', clientId);
  if (error) {
    alert(`Delete failed: ${error.message}\n\nIf this client is in production, run supabase-migration-8-client-cascade.sql in Supabase.`);
    throw error;
  }
  if (cl) await logActivity(null, 'client_deleted', `"${cl.name}" removed`);
}

async function cloneClientDB(sourceClientId, newName) {
  const source = getClient(sourceClientId);
  if (!source) return;

  // 1. Create new client in pipeline
  const { data: newClient } = await sb.from('clients').insert({ name: newName, phase: 'pipeline' }).select().single();
  if (!newClient) return;

  // 2. Copy client_settings (if any)
  if (source.settings) {
    const settingsCopy = { ...source.settings };
    delete settingsCopy.id;
    delete settingsCopy.client_id;
    delete settingsCopy.created_at;
    settingsCopy.client_id = newClient.id;
    await sb.from('client_settings').insert(settingsCopy);
  }

  // 3. Copy active client_goals (reset current_value)
  const activeGoals = (source.goals || []).filter(g => g.status === 'active');
  if (activeGoals.length > 0) {
    const goalCopies = activeGoals.map(g => {
      const copy = { ...g };
      delete copy.id;
      delete copy.created_at;
      copy.client_id = newClient.id;
      copy.current_value = null;
      return copy;
    });
    await sb.from('client_goals').insert(goalCopies);
  }

  // 4. Copy client_team assignments
  if (source.team && source.team.length > 0) {
    const teamRows = source.team.map(memberId => ({ client_id: newClient.id, team_member_id: memberId }));
    await sb.from('client_team').insert(teamRows);
  }

  // 5. Log activity
  await logActivity(newClient.id, 'client_cloned', `"${newName}" cloned from "${source.name}"`);

  // 6. Reload and navigate
  await loadData();
  navigate(`/client/${newClient.id}`);
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
    'All links were duplicated (scripts, drive, slack, etc)',
    'Team was assigned',
    'Onboarding Doc Sent to client',
    'Onboarding call with client finished',
    'Strategy call made',
    'Client AI was made',
    'First LF videos planned (topic/script)',
    'First SF videos planned (topic/script)',
    'Access to YouTube as a manager',
    'Client Sent Branding Material',
    'Funnel + Lead Magnet planned (alongside GHL creation/duplication)',
    'Client Socials connected to metricool',
    'First recording planned',
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

  // Slack notification when an edit is delivered (LF or SF clips)
  if ((stepKey === 'edit_delivered' || stepKey === 'sf_clips_delivered') && done) {
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
      logActivity(clientId, 'week_complete', `All weekly steps completed for "${cl?.name || '?'}"`, actor);
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

function sfEnabled(client) {
  return client.settings && client.settings.shorts_per_week > 0;
}

function writtenEnabled(client) {
  return client.settings && client.settings.written_per_week > 0;
}

function getActiveSteps(client) {
  let steps = [...CHECKLIST_STEPS];
  if (sfEnabled(client)) steps = steps.concat(SF_STEPS);
  if (writtenEnabled(client)) steps = steps.concat(WRITTEN_STEPS);
  return steps;
}

function getActiveStepsByType(client) {
  const lf = CHECKLIST_STEPS;
  const sf = sfEnabled(client) ? SF_STEPS : [];
  const wc = writtenEnabled(client) ? WRITTEN_STEPS : [];
  return { lf, sf, wc };
}

function checklistProgressHTML(client) {
  const steps = getActiveSteps(client);
  const prog = checklistProgress(client.weeklyChecklist, steps);
  const lfProg = checklistProgress(client.weeklyChecklist, CHECKLIST_STEPS);
  const hasSf = sfEnabled(client);
  const hasWc = writtenEnabled(client);

  let parts = [`${lfProg.done}/${lfProg.total} LF`];
  if (hasSf) {
    const sfProg = checklistProgress(client.weeklyChecklist, SF_STEPS);
    parts.push(`${sfProg.done}/${sfProg.total} SF`);
  }
  if (hasWc) {
    const wcProg = checklistProgress(client.weeklyChecklist, WRITTEN_STEPS);
    parts.push(`${wcProg.done}/${wcProg.total} WC`);
  }

  const label = parts.join(' · ');
  if (prog.done === prog.total && prog.total > 0) {
    return `<span class="volume-counter on-track">${label}</span>`;
  } else if (prog.done > 0) {
    return `<span class="volume-counter">${label}</span>`;
  }
  return `<span class="volume-counter behind">${label}</span>`;
}

function postedProgressHTML(client) {
  const sett = client.settings || {};
  const wc = client.weeklyChecklist;
  const vpw = sett.videos_per_week || 0;
  const spw = sett.shorts_per_week || 0;
  const wpw = sett.written_per_week || 0;
  if (vpw === 0 && spw === 0 && wpw === 0) return '';

  const lfP = wc ? (wc.lf_posted || 0) : 0;
  const sfP = wc ? (wc.sf_posted || 0) : 0;
  const wcP = wc ? (wc.wc_posted || 0) : 0;

  let pills = [];
  if (vpw > 0) pills.push(`<span class="card-posted-pill ${lfP >= vpw ? 'done' : ''}">${lfP}/${vpw} LF</span>`);
  if (spw > 0) pills.push(`<span class="card-posted-pill ${sfP >= spw ? 'done' : ''}">${sfP}/${spw} SF</span>`);
  if (wpw > 0) pills.push(`<span class="card-posted-pill ${wcP >= wpw ? 'done' : ''}">${wcP}/${wpw} WC</span>`);
  return `<div class="card-posted-row">${pills.join('')}</div>`;
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

/* ── CLIENT LINKS HELPER ──────────────────────────────────────────
   Single source of truth for the per-client tool links shown both on the
   client detail page (Quick Links) and in the topbar Tools dropdown. */
function buildClientLinks(client) {
  const sett = (client && client.settings) || {};
  const links = [
    { url: sett.gdrive_url,           label: 'Google Drive' },
    { url: sett.sf_scripts_url,       label: 'SF Scripts' },
    { url: sett.lf_scripts_url,       label: 'LF Scripts' },
    { url: sett.main_links_url,       label: 'Main Links' },
    { url: sett.kpis_url,             label: 'KPIs' },
    { url: sett.growth_ops_url,       label: 'Growth Ops' },
    { url: sett.written_content_url,  label: 'Written Content' },
    { url: sett.ai_url,               label: 'AI' },
    { url: sett.social_dashboard_url, label: 'Social Dashboard' },
    { url: sett.dna_doc_url,          label: 'Client DNA Doc' },
    { url: 'https://qc.contentcartel.net/dna', label: 'DNA / Client Prompt' },
  ].filter(l => l.url && l.url.trim());
  const analytics = sett.metricool_id && sett.metricool_id.trim()
    ? { url: ANALYTICS_BASE + sett.metricool_id.trim(), label: 'Analytics' }
    : null;
  return { analytics, links };
}

/* ── MODAL HELPER ─────────────────────────────────────────────────
   Minimal overlay modal. onSave receives the body element and may return
   `false` to keep the modal open (validation failure). */
function openModal({ title, bodyHTML, onSave, saveLabel }) {
  saveLabel = saveLabel || 'Save';
  const overlay = document.createElement('div');
  overlay.className = 'cc-modal-overlay';
  overlay.innerHTML = `
    <div class="cc-modal" role="dialog" aria-modal="true">
      <div class="cc-modal-header">
        <div class="cc-modal-title">${escHTML(title)}</div>
        <button class="cc-modal-close" type="button" aria-label="Close">×</button>
      </div>
      <div class="cc-modal-body">${bodyHTML}</div>
      <div class="cc-modal-footer">
        <button class="btn-cancel cc-modal-cancel" type="button">Cancel</button>
        <button class="btn-primary cc-modal-save" type="button">${escHTML(saveLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.cc-modal-close').addEventListener('click', close);
  overlay.querySelector('.cc-modal-cancel').addEventListener('click', close);
  overlay.querySelector('.cc-modal-save').addEventListener('click', async () => {
    const saveBtn = overlay.querySelector('.cc-modal-save');
    saveBtn.disabled = true;
    try {
      const result = await onSave(overlay.querySelector('.cc-modal-body'));
      if (result === false) saveBtn.disabled = false;
      else close();
    } catch (e) {
      saveBtn.disabled = false;
      console.error('Modal save error:', e);
    }
  });
  // Auto-focus first input
  const firstInput = overlay.querySelector('input, textarea, select');
  if (firstInput) firstInput.focus();
  return { close, overlay };
}
window.openModal = openModal;

/* ── DASHBOARD PASSWORD GATE ────────────────────────────────────── */
const COMPANY_PASSWORD = 'cc2025';
const DASHBOARD_PASSWORD = 'ccpm2025';

function renderDashboardGate() {
  // Hide topbar pills while locked
  const pills = document.getElementById('statPills');
  if (pills) pills.style.visibility = 'hidden';

  const root = document.getElementById('appRoot');
  root.innerHTML = `
    <div class="company-gate">
      <div class="gate-card">
        <img src="./logo.png" alt="Content Cartel" style="height:64px;width:auto;margin-bottom:16px;">
        <div class="gate-title">PM Dashboard</div>
        <p class="gate-desc">Enter the dashboard password to continue.</p>
        <input type="password" class="settings-input" id="dashGatePw" placeholder="Password..." autofocus />
        <button class="btn-primary" id="dashGateSubmit" style="margin-top:10px;width:100%">Unlock</button>
        <div class="gate-error" id="dashGateError" style="display:none">Incorrect password</div>
      </div>
    </div>`;

  const pwInput = root.querySelector('#dashGatePw');
  const submitBtn = root.querySelector('#dashGateSubmit');
  const errEl = root.querySelector('#dashGateError');

  const tryUnlock = () => {
    if (pwInput.value === DASHBOARD_PASSWORD) {
      sessionStorage.setItem('cc_dashboard_auth', '1');
      if (pills) pills.style.visibility = '';
      loadData();
    } else {
      errEl.style.display = 'block';
      pwInput.value = '';
      pwInput.focus();
    }
  };
  submitBtn.addEventListener('click', tryUnlock);
  pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
}

/* ── ROUTER ───────────────────────────────────────────────────── */

function getRoute() {
  const hash = location.hash || "#/";
  const path = hash.slice(1) || "/";
  const calMatch = path.match(/^\/client\/(\d+)\/calendar$/);
  if (calMatch) {
    return { view: "clientCalendar", id: parseInt(calMatch[1]) };
  }
  if (path.startsWith("/client/")) {
    return { view: "client", id: parseInt(path.split("/client/")[1]) };
  }
  if (path === "/company") {
    return { view: "company" };
  }
  if (path === "/team") {
    return { view: "team" };
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
  if (backLink) {
    const showBack = route.view === "client" || route.view === "clientCalendar" || route.view === "company" || route.view === "team";
    backLink.classList.toggle("visible", showBack);
    if (route.view === "clientCalendar") {
      backLink.setAttribute("href", `#/client/${route.id}`);
      backLink.textContent = "← Back to client";
    } else {
      backLink.setAttribute("href", "#/");
      backLink.textContent = "← All Clients";
    }
  }

  if (route.view === "client") {
    renderClientDetail(root, route.id);
  } else if (route.view === "clientCalendar") {
    if (typeof window.renderClientCalendar === "function") {
      window.renderClientCalendar(root, route.id);
    } else {
      root.innerHTML = `<div class="empty-state">Calendar module not loaded.</div>`;
    }
  } else if (route.view === "company") {
    renderCompanyLinks(root);
  } else if (route.view === "team") {
    renderTeamManagement(root);
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
document.addEventListener("DOMContentLoaded", mountToolsDropdown);

/* ── TOOLS DROPDOWN ───────────────────────────────────────────────
   Topbar entry point for global + per-client tools. Trigger lives in
   index.html; this function wires the click handler and renders the
   panel content from current CLIENTS at open time. */
function mountToolsDropdown() {
  const trigger = document.getElementById('toolsBtn');
  const panel   = document.getElementById('toolsDropdown');
  if (!trigger || !panel) return;

  const close = () => {
    panel.hidden = true;
    trigger.classList.remove('open');
    document.removeEventListener('click', onDocClick);
  };
  const onDocClick = (e) => {
    if (!panel.contains(e.target) && e.target !== trigger) close();
  };

  function renderPanel() {
    panel.innerHTML = `
      <div class="tools-section">
        <div class="tools-label">Global</div>
        <a class="tools-link" href="https://qc.contentcartel.net/dna" target="_blank" rel="noopener">QC Tool ↗</a>
        <a class="tools-link" href="https://analytics.contentcartel.net/" target="_blank" rel="noopener">Analytics ↗</a>
        <a class="tools-link" href="https://content-cartel-1.app.n8n.cloud" target="_blank" rel="noopener">n8n ↗</a>
        <a class="tools-link" href="#/company" data-internal>Company Links</a>
        <a class="tools-link" href="#/team" data-internal>Team</a>
      </div>
      <div class="tools-section tools-section-client">
        <div class="tools-label">Per-client</div>
        <input type="search" id="toolsClientPicker" class="tools-search" placeholder="Pick a client..." autocomplete="off" />
        <div class="tools-client-results" id="toolsClientResults"></div>
        <div class="tools-client-links" id="toolsClientLinks" hidden></div>
      </div>`;

    // Internal links should also close the panel
    panel.querySelectorAll('[data-internal]').forEach(a => {
      a.addEventListener('click', () => close());
    });

    const search   = panel.querySelector('#toolsClientPicker');
    const results  = panel.querySelector('#toolsClientResults');
    const linksBox = panel.querySelector('#toolsClientLinks');

    function renderResults(filter) {
      const f = (filter || '').trim().toLowerCase();
      const matches = (CLIENTS || [])
        .filter(c => !f || c.name.toLowerCase().includes(f))
        .slice(0, 12);
      results.innerHTML = matches.length === 0
        ? '<div class="tools-empty">No clients match</div>'
        : matches.map(c => `<button class="tools-client-row" data-id="${c.id}">${escHTML(c.name)}</button>`).join('');
      results.querySelectorAll('.tools-client-row').forEach(btn => {
        btn.addEventListener('click', () => {
          const cid = parseInt(btn.dataset.id);
          showClientLinks(cid);
        });
      });
    }

    function showClientLinks(clientId) {
      const cl = getClient(clientId);
      if (!cl) return;
      const { analytics, links } = buildClientLinks(cl);
      const all = (analytics ? [analytics] : []).concat(links);
      results.hidden = true;
      linksBox.hidden = false;
      linksBox.innerHTML = `
        <div class="tools-client-header">
          <button class="tools-back" type="button">← clients</button>
          <span class="tools-client-name">${escHTML(cl.name)}</span>
          <a class="tools-link tools-link-pin" href="#/client/${cl.id}" data-internal>open page →</a>
        </div>
        ${all.length === 0
          ? '<div class="tools-empty">No links configured for this client</div>'
          : all.map(l => `<a class="tools-link" href="${l.url}" target="_blank" rel="noopener">${l.label} ↗</a>`).join('')}`;
      linksBox.querySelector('.tools-back').addEventListener('click', () => {
        linksBox.hidden = true;
        results.hidden = false;
        search.focus();
      });
      linksBox.querySelectorAll('[data-internal]').forEach(a => {
        a.addEventListener('click', () => close());
      });
    }

    search.addEventListener('input', () => { results.hidden = false; linksBox.hidden = true; renderResults(search.value); });
    renderResults('');
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = !panel.hidden;
    if (wasOpen) { close(); return; }
    renderPanel();
    panel.hidden = false;
    trigger.classList.add('open');
    setTimeout(() => document.addEventListener('click', onDocClick), 0);
    const search = panel.querySelector('#toolsClientPicker');
    if (search) search.focus();
  });
}

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
    ? `<span class="prev-week-indicator" title="Last week">${prevProg.done === prevProg.total ? 'Done' : prevProg.done + '/' + prevProg.total}</span>`
    : '';

  return `
    <div class="client-card" data-id="${c.id}">
      <div class="card-name">${c.name}</div>
      ${specialHTML}
      ${postedProgressHTML(c)}
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

  // Phase stepper (always visible, not collapsible)
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

  // ── Action links (collapsible) ──
  const sett = client.settings || {};
  const { analytics, links: clientLinks } = buildClientLinks(client);
  const allLinkCount = clientLinks.length + (analytics ? 1 : 0);
  const hasAnyLinks = allLinkCount > 0;

  const actionLinksBody = hasAnyLinks ? `
    <div class="action-links">
      ${analytics ? `<a class="action-link-btn" href="${analytics.url}" target="_blank" rel="noopener">${analytics.label} ↗</a>` : ''}
      ${clientLinks.map(l => `<a class="action-link-btn" href="${l.url.trim()}" target="_blank" rel="noopener">${l.label} ↗</a>`).join('')}
    </div>` : '<div class="empty-hint">No links configured</div>';
  const actionLinksSection = collapsibleSection('links', 'Quick Links', `${allLinkCount} link${allLinkCount !== 1 ? 's' : ''}`, actionLinksBody);

  // ── Team section (collapsible) ──
  const teamMembers = (client.team || []).map(id => getTeamMember(id)).filter(Boolean);
  const teamAvatarsPreview = teamMembers.slice(0,3).map(m => `<span class="avatar" style="width:18px;height:18px;font-size:8px">${m.initials}</span>`).join('');
  const teamSummary = teamMembers.length ? `${teamAvatarsPreview} ${teamMembers.length} member${teamMembers.length !== 1 ? 's' : ''}` : 'No members';
  const teamBody = `
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
    </div>`;
  const teamSection = collapsibleSection('team', 'Team', teamSummary, teamBody);

  // ── Onboarding checklist (collapsible, only if onboarding phase) ──
  const onboardingChecklistSection = client.onboardingChecks ? collapsibleSection(
    'onboarding', 'Onboarding Checklist',
    prog ? `<span class="checklist-count">${prog.done}/${prog.total}</span>` : '',
    `<div id="checklist-${client.id}">
      ${client.onboardingChecks.map((item, i) => `
        <div class="checklist-item onboarding-check ${item.done ? 'done' : ''}" data-client="${client.id}" data-idx="${i}">
          <div class="check-box ${item.done ? 'checked' : ''}">
            <span class="check-icon">✓</span>
          </div>
          <span class="checklist-label">${item.label}</span>
        </div>`).join("")}
    </div>`,
    { defaultOpen: true }
  ) : '';

  // ── Weekly production checklist (collapsible with nested sub-sections) ──
  const isProduction = client.phase === 'production' || client.phase === 'special';
  const wc = client.weeklyChecklist;
  const prevWc = client.prevWeekChecklist;

  const hasSf = sfEnabled(client);
  const hasWc = writtenEnabled(client);
  const activeSteps = getActiveSteps(client);
  const combinedProg = checklistProgress(wc, activeSteps);
  const lfProg = checklistProgress(wc, CHECKLIST_STEPS);
  const sfProg = checklistProgress(wc, SF_STEPS);
  const wcProg = checklistProgress(wc, WRITTEN_STEPS);
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

  // ── Posted counter pills (goal-based: X/Y posted this week) ──
  const vpw = (client.settings && client.settings.videos_per_week) || 0;
  const spw = (client.settings && client.settings.shorts_per_week) || 0;
  const wpw = (client.settings && client.settings.written_per_week) || 0;
  const lfPosted = wc ? (wc.lf_posted || 0) : 0;
  const sfPosted = wc ? (wc.sf_posted || 0) : 0;
  const wcPosted = wc ? (wc.wc_posted || 0) : 0;

  const allPosted = (vpw > 0 ? lfPosted >= vpw : true) && (spw > 0 ? sfPosted >= spw : true) && (wpw > 0 ? wcPosted >= wpw : true);
  let postedSummaryParts = [];
  if (vpw > 0) postedSummaryParts.push(`${lfPosted}/${vpw} LF`);
  if (spw > 0) postedSummaryParts.push(`${sfPosted}/${spw} SF`);
  if (wpw > 0) postedSummaryParts.push(`${wcPosted}/${wpw} WC`);
  const postedSummary = postedSummaryParts.length > 0
    ? postedSummaryParts.join(' · ') + (allPosted && postedSummaryParts.length > 0 ? ' <span class="week-complete-badge">Complete</span>' : '')
    : 'No targets set';

  const postedPills = (vpw > 0 || spw > 0 || wpw > 0) ? `
    <div class="posted-counters" data-client="${client.id}">
      ${vpw > 0 ? `<button class="posted-pill ${lfPosted >= vpw ? 'complete' : ''}" data-type="lf_posted" data-max="${vpw}" data-current="${lfPosted}">${lfPosted}/${vpw} LF posted</button>` : ''}
      ${spw > 0 ? `<button class="posted-pill ${sfPosted >= spw ? 'complete' : ''}" data-type="sf_posted" data-max="${spw}" data-current="${sfPosted}">${sfPosted}/${spw} SF posted</button>` : ''}
      ${wpw > 0 ? `<button class="posted-pill ${wcPosted >= wpw ? 'complete' : ''}" data-type="wc_posted" data-max="${wpw}" data-current="${wcPosted}">${wcPosted}/${wpw} written</button>` : ''}
    </div>` : '';

  const weeklyChecklistBody = `<div id="weeklyChecklist-${client.id}">${postedPills}</div>`;
  const weeklyChecklistSection = isProduction ? collapsibleSection('weekly', 'Weekly Checklist', postedSummary, weeklyChecklistBody, { defaultOpen: true }) : '';

  // ── Goals & KPIs section (collapsible) ──
  const clientGoals = client.goals || [];
  const activeGoals = clientGoals.filter(g => g.status === 'active');
  const completedGoals = clientGoals.filter(g => g.status === 'completed');

  const goalTypeColors = { kpi: '#3b82f6', milestone: '#d4a843', goal: '#22c55e', note: '#a1a1aa' };

  function renderGoalCard(g) {
    const color = goalTypeColors[g.goal_type] || '#a1a1aa';
    const hasProgress = g.target_value && g.current_value !== null && g.current_value !== undefined;
    const pct = hasProgress ? Math.min(100, Math.round((parseFloat(g.current_value) / parseFloat(g.target_value)) * 100)) : null;
    const dueStr = g.due_date ? new Date(g.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
    const isOverdue = g.due_date && new Date(g.due_date) < new Date() && g.status === 'active';

    return `
      <div class="goal-card" data-goal-id="${g.id}">
        <div class="goal-card-header">
          <span class="goal-type-badge" style="background:${color}20;color:${color}">${g.goal_type.toUpperCase()}</span>
          <div class="goal-actions">
            ${g.status === 'active' ? `<button class="goal-complete-btn" data-goal-id="${g.id}" title="Mark complete">✓</button>` : ''}
            <button class="goal-delete-btn" data-goal-id="${g.id}" title="Delete">×</button>
          </div>
        </div>
        <div class="goal-title">${escHTML(g.title)}</div>
        ${g.description ? `<div class="goal-desc">${escHTML(g.description)}</div>` : ''}
        ${hasProgress ? `
          <div class="goal-progress-wrap">
            <div class="goal-progress-bar">
              <div class="goal-progress-fill" style="width:${pct}%;background:${pct >= 100 ? 'var(--green,#22c55e)' : color}"></div>
            </div>
            <div class="goal-progress-label">
              <span>${g.current_value} / ${g.target_value}</span>
              <span>${pct}%</span>
            </div>
          </div>` : ''}
        <div class="goal-meta">
          ${dueStr ? `<span class="goal-due ${isOverdue ? 'overdue' : ''}">${isOverdue ? 'Overdue: ' : 'Due '}${dueStr}</span>` : ''}
          ${g.status === 'completed' ? '<span class="goal-status-done">✓ Completed</span>' : ''}
        </div>
        ${g.status === 'active' && hasProgress ? `
          <div class="goal-update-row">
            <input type="number" class="goal-value-input" data-goal-id="${g.id}" placeholder="Update value..." value="" step="any" />
            <button class="goal-update-btn" data-goal-id="${g.id}">Update</button>
          </div>` : ''}
      </div>`;
  }

  const goalsBody = `
    <div class="goals-container">
      <div class="goal-add-form" id="goalAddForm">
        <div class="goal-form-row">
          <select class="settings-input goal-type-select" id="goalType">
            <option value="kpi">KPI</option>
            <option value="milestone">Milestone</option>
            <option value="goal">Goal</option>
            <option value="note">Note</option>
          </select>
          <input class="settings-input goal-title-input" id="goalTitle" placeholder="Goal title..." />
        </div>
        <div class="goal-form-row">
          <input class="settings-input" id="goalDesc" placeholder="Description (optional)" />
        </div>
        <div class="goal-form-row">
          <input class="settings-input" id="goalTarget" type="number" placeholder="Target value" step="any" />
          <input class="settings-input" id="goalCurrent" type="number" placeholder="Current value" step="any" />
          <input class="settings-input" id="goalDue" type="date" />
          <button class="btn-primary goal-add-btn" id="goalAddBtn">Add Goal</button>
        </div>
      </div>
      ${activeGoals.length > 0 ? `
        <div class="goals-list">
          ${activeGoals.map(renderGoalCard).join('')}
        </div>` : '<div class="empty-hint" style="margin-top:8px">No active goals — add one above</div>'}
      ${completedGoals.length > 0 ? `
        <div class="goals-completed-label">Completed (${completedGoals.length})</div>
        <div class="goals-list goals-completed">
          ${completedGoals.map(renderGoalCard).join('')}
        </div>` : ''}
    </div>`;

  const goalsSummary = activeGoals.length > 0
    ? `${activeGoals.length} active${completedGoals.length > 0 ? `, ${completedGoals.length} done` : ''}`
    : 'No goals set';
  const goalsSection = collapsibleSection('goals', 'Goals & KPIs', goalsSummary, goalsBody);

  // ── Settings section (collapsible) ──
  const settingsConfigured = sett.metricool_id || sett.slack_channel || sett.ghl_location_id;
  const settingsBody = `
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
      <span class="settings-label">Written / week</span>
      <input class="settings-input" id="settWpw" type="number" min="0" placeholder="0" value="${sett.written_per_week || 0}" style="max-width:100px" />
    </div>
    <div class="settings-row">
      <span class="settings-label">Metricool ID</span>
      <input class="settings-input" id="settMetricool" type="text" placeholder="brand-id" value="${escHTML(sett.metricool_id || '')}" />
    </div>
    <div class="settings-row">
      <span class="settings-label">Metricool Blog ID</span>
      <input class="settings-input" id="settMetricoolBlogId" type="text" placeholder="e.g. 4794381 (from Metricool URL)" value="${escHTML(sett.metricool_blog_id || '')}" />
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
      <input class="settings-input" id="settGhlToken" type="password" placeholder="${sett.ghl_location_id ? '••••••• (saved)' : 'pit-xxxxx (Private Integration token)'}" value="" />
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
      <span class="settings-label">Google Drive</span>
      <input class="settings-input" id="settGdrive" type="url" placeholder="https://drive.google.com/..." value="${escHTML(sett.gdrive_url || '')}" />
    </div>
    <div class="settings-row">
      <span class="settings-label">SF Scripts</span>
      <input class="settings-input" id="settSfScripts" type="url" placeholder="https://docs.google.com/..." value="${escHTML(sett.sf_scripts_url || '')}" />
    </div>
    <div class="settings-row">
      <span class="settings-label">LF Scripts</span>
      <input class="settings-input" id="settLfScripts" type="url" placeholder="https://docs.google.com/..." value="${escHTML(sett.lf_scripts_url || '')}" />
    </div>
    <div class="settings-row">
      <span class="settings-label">Main Links</span>
      <input class="settings-input" id="settMainLinks" type="url" placeholder="https://..." value="${escHTML(sett.main_links_url || '')}" />
    </div>
    <div class="settings-row">
      <span class="settings-label">KPIs</span>
      <input class="settings-input" id="settKpis" type="url" placeholder="https://..." value="${escHTML(sett.kpis_url || '')}" />
    </div>
    <div class="settings-row">
      <span class="settings-label">Growth Ops</span>
      <input class="settings-input" id="settGrowthOps" type="url" placeholder="https://..." value="${escHTML(sett.growth_ops_url || '')}" />
    </div>
    <div class="settings-row">
      <span class="settings-label">Written Content</span>
      <input class="settings-input" id="settWrittenContent" type="url" placeholder="https://docs.google.com/..." value="${escHTML(sett.written_content_url || '')}" />
    </div>
    <div class="settings-row">
      <span class="settings-label">AI</span>
      <input class="settings-input" id="settAi" type="url" placeholder="https://..." value="${escHTML(sett.ai_url || '')}" />
    </div>
    <div class="settings-row">
      <span class="settings-label">Social Dashboard</span>
      <input class="settings-input" id="settSocialDashboard" type="url" placeholder="https://..." value="${escHTML(sett.social_dashboard_url || '')}" />
    </div>
    <div class="settings-row">
      <span class="settings-label">Client DNA</span>
      <input class="settings-input" id="settDnaDoc" type="url" placeholder="https://docs.google.com/..." value="${escHTML(sett.dna_doc_url || '')}" />
    </div>

    <button class="btn-save" id="saveSettingsBtn">Save Settings</button>`;
  const settingsSection = collapsibleSection('settings', 'Settings', settingsConfigured ? 'Configured' : 'Not configured', settingsBody);

  // ── Activity feed (collapsible) ──
  const clientActivity = ACTIVITY_LOG.filter(a => a.client_id === clientId).slice(0, 15);
  const activityBody = clientActivity.length === 0 ? '<div class="empty-hint">No activity yet</div>' : clientActivity.map(a => `
    <div class="activity-item">
      <span class="activity-detail">${escHTML(a.detail)}</span>
      <span class="activity-time">${timeAgo(a.created_at)}</span>
    </div>`).join("");
  const activitySection = collapsibleSection('activity', 'Recent Activity', `${clientActivity.length} event${clientActivity.length !== 1 ? 's' : ''}`, activityBody);

  // ── Funnel Status section (collapsible) ──
  const funnelActive = FUNNEL_STEPS.filter(f => wc && wc[f.key]).length;
  const funnelTotal = FUNNEL_STEPS.length;
  const funnelSummary = isProduction
    ? (funnelActive === funnelTotal ? 'All active' : `${funnelActive}/${funnelTotal} active`)
    : '';
  const funnelBody = `
    <div class="funnel-toggles" data-client="${client.id}">
      ${FUNNEL_STEPS.map(f => {
        const isOn = wc ? wc[f.key] : false;
        return `
        <div class="funnel-toggle-row">
          <button class="funnel-toggle ${isOn ? 'active' : ''}" data-step="${f.key}">
            <span class="funnel-toggle-indicator">${isOn ? '✓' : ''}</span>
          </button>
          <span class="funnel-toggle-label">${f.label}</span>
          <span class="funnel-toggle-status ${isOn ? 'on' : 'off'}">${isOn ? 'Active' : 'Inactive'}</span>
        </div>`;
      }).join('')}
    </div>`;
  const funnelSection = isProduction ? collapsibleSection('funnel', 'Funnel', funnelSummary, funnelBody) : '';

  // ── Calendar inline + Tasks sections (defined in calendar.js / tasks.js) ──
  const calendarInlineSection = (typeof window.calendarInlineSectionHTML === 'function')
    ? window.calendarInlineSectionHTML(client)
    : '';
  const tasksSection = (typeof window.tasksSectionHTML === 'function')
    ? window.tasksSectionHTML(client)
    : '';

  root.innerHTML = `
    <div class="detail-header">
      <div class="detail-name">${client.name}</div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="clone-client-btn" id="cloneClientBtn" title="Clone client">Clone</button>
        <button class="delete-client-btn" id="deleteClientBtn" title="Remove client">Remove</button>
      </div>
    </div>
    ${stepperHTML}
    ${actionLinksSection}
    ${teamSection}
    ${onboardingChecklistSection}
    ${weeklyChecklistSection}
    ${funnelSection}
    ${calendarInlineSection}
    ${tasksSection}
    ${goalsSection}
    ${settingsSection}
    ${activitySection}
  `;

  // Bind collapsible toggles
  bindCollapsibles(root);

  // Bind tasks + calendar inline sections (modules expose globals)
  const rerenderDetail = () => renderClientDetail(root, clientId);
  if (typeof window.bindTasksSection === 'function') {
    window.bindTasksSection(root, client, rerenderDetail);
  }
  if (typeof window.bindCalendarInline === 'function') {
    window.bindCalendarInline(root, client, rerenderDetail);
  }

  // ── BIND EVENTS ─────────────────────────────────────────────

  // Delete client — two-click arm, then typed-name code gate before actual delete.
  const deleteBtn = root.querySelector("#deleteClientBtn");
  if (deleteBtn) {
    const isProd = client.phase === 'production' || client.phase === 'special';
    const confirmLabel = isProd ? "Wipe all data?" : "Confirm?";
    deleteBtn.addEventListener("click", () => {
      deleteBtn.textContent = confirmLabel;
      deleteBtn.classList.add("confirm");
      deleteBtn.addEventListener("click", async () => {
        const typed = prompt(
          `Enter deletion code to confirm removing "${client.name}".\n\nThis cannot be undone.`
        );
        if (typed === null) {
          deleteBtn.textContent = "Remove";
          deleteBtn.classList.remove("confirm");
          return;
        }
        if (typed.trim() !== "0012") {
          alert("Incorrect code. Deletion cancelled.");
          deleteBtn.textContent = "Remove";
          deleteBtn.classList.remove("confirm");
          return;
        }
        deleteBtn.disabled = true;
        deleteBtn.textContent = "Removing…";
        try {
          await deleteClientDB(clientId);
        } catch (e) {
          deleteBtn.disabled = false;
          deleteBtn.textContent = "Remove";
          deleteBtn.classList.remove("confirm");
          return;
        }
        const idx = CLIENTS.findIndex(c => c.id === clientId);
        if (idx !== -1) CLIENTS.splice(idx, 1);
        navigate("/");
      }, { once: true });
      setTimeout(() => {
        if (deleteBtn && !deleteBtn.classList.contains("gone") && !deleteBtn.disabled) {
          deleteBtn.textContent = "Remove";
          deleteBtn.classList.remove("confirm");
        }
      }, 3000);
    }, { once: true });
  }

  // Clone client
  const cloneBtn = root.querySelector("#cloneClientBtn");
  if (cloneBtn) {
    cloneBtn.addEventListener("click", async () => {
      const newName = prompt("New client name:", `Copy of ${client.name}`);
      if (!newName || !newName.trim()) return;
      cloneBtn.disabled = true;
      cloneBtn.textContent = '⏳ Cloning…';
      await cloneClientDB(clientId, newName.trim());
    });
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
        logActivity(clientId, 'auto_advanced', `"${cl.name}" auto-moved to Production (onboarding complete)`);
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

  // ── POSTED COUNTER PILLS ─────────────────────────────────────
  root.querySelectorAll(".posted-pill").forEach(pill => {
    pill.addEventListener("click", async () => {
      const container = pill.closest(".posted-counters");
      const cid = parseInt(container.dataset.client);
      const cl = getClient(cid);
      if (!cl) return;

      const type = pill.dataset.type; // lf_posted, sf_posted, wc_posted
      const max = parseInt(pill.dataset.max);
      const current = parseInt(pill.dataset.current);
      const newVal = current >= max ? 0 : current + 1;

      const checklist = await ensureWeeklyChecklist(cid);
      if (!checklist) return;

      await sb.from('weekly_checklist').update({ [type]: newVal }).eq('id', checklist.id);
      checklist[type] = newVal;

      const labels = { lf_posted: 'Long Form', sf_posted: 'Short Form', wc_posted: 'Written' };
      logActivity(cid, 'posted_updated', `${labels[type]} posted: ${newVal}/${max} for "${cl.name}"`);

      renderClientDetail(root, cid);
    });
  });

  // ── FUNNEL TOGGLES ──────────────────────────────────────────
  root.querySelectorAll(".funnel-toggle").forEach(btn => {
    btn.addEventListener("click", async () => {
      const container = btn.closest(".funnel-toggles");
      const cid = parseInt(container.dataset.client);
      const cl = getClient(cid);
      if (!cl) return;

      const stepKey = btn.dataset.step;
      const checklist = await ensureWeeklyChecklist(cid);
      if (!checklist) return;

      const newVal = !checklist[stepKey];
      await sb.from('weekly_checklist').update({ [stepKey]: newVal }).eq('id', checklist.id);
      checklist[stepKey] = newVal;

      const stepLabel = FUNNEL_STEPS.find(f => f.key === stepKey)?.label || stepKey;
      logActivity(cid, 'funnel_toggled', `${stepLabel}: ${newVal ? 'Active' : 'Inactive'} for "${cl.name}"`);

      renderClientDetail(root, cid);
    });
  });

  // ── GOALS & KPIs ────────────────────────────────────────────
  const goalAddBtn = root.querySelector("#goalAddBtn");
  if (goalAddBtn) {
    goalAddBtn.addEventListener("click", async () => {
      const goalType = root.querySelector("#goalType").value;
      const title = root.querySelector("#goalTitle").value.trim();
      const description = root.querySelector("#goalDesc").value.trim() || null;
      const targetValue = root.querySelector("#goalTarget").value || null;
      const currentValue = root.querySelector("#goalCurrent").value || null;
      const dueDate = root.querySelector("#goalDue").value || null;

      if (!title) { root.querySelector("#goalTitle").focus(); return; }

      const { error } = await sb.from('client_goals').insert({
        client_id: clientId,
        goal_type: goalType,
        title,
        description,
        target_value: targetValue,
        current_value: currentValue,
        due_date: dueDate,
        status: 'active',
      });
      if (error) { console.error('Goal insert error:', error); return; }

      // Log activity
      await sb.from('activity_log').insert({
        client_id: clientId,
        action: 'goal_added',
        detail: `Goal added: ${title}`,
        actor: localStorage.getItem('cc_actor') || 'PM',
      });

      // Reload goals and re-render
      const { data: updatedGoals } = await sb.from('client_goals').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
      const cl = getClient(clientId);
      if (cl) cl.goals = updatedGoals || [];
      renderClientDetail(root, clientId);
    });
  }

  // Goal complete buttons
  root.querySelectorAll(".goal-complete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const goalId = btn.dataset.goalId;
      await sb.from('client_goals').update({ status: 'completed' }).eq('id', goalId);
      const { data: updatedGoals } = await sb.from('client_goals').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
      const cl = getClient(clientId);
      if (cl) cl.goals = updatedGoals || [];
      renderClientDetail(root, clientId);
    });
  });

  // Goal delete buttons
  root.querySelectorAll(".goal-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const goalId = btn.dataset.goalId;
      if (btn.textContent === '?') {
        await sb.from('client_goals').delete().eq('id', goalId);
        const { data: updatedGoals } = await sb.from('client_goals').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
        const cl = getClient(clientId);
        if (cl) cl.goals = updatedGoals || [];
        renderClientDetail(root, clientId);
      } else {
        btn.textContent = '?';
        btn.title = 'Click again to confirm';
        setTimeout(() => { btn.textContent = '×'; btn.title = 'Delete'; }, 2000);
      }
    });
  });

  // Goal value update buttons
  root.querySelectorAll(".goal-update-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const goalId = btn.dataset.goalId;
      const input = root.querySelector(`.goal-value-input[data-goal-id="${goalId}"]`);
      const newValue = input?.value;
      if (!newValue && newValue !== '0') return;
      await sb.from('client_goals').update({ current_value: parseFloat(newValue) }).eq('id', goalId);
      const { data: updatedGoals } = await sb.from('client_goals').select('*').eq('client_id', clientId).order('created_at', { ascending: false });
      const cl = getClient(clientId);
      if (cl) cl.goals = updatedGoals || [];
      renderClientDetail(root, clientId);
    });
  });

  // ── SETTINGS ────────────────────────────────────────────────
  const saveSettingsBtn = root.querySelector("#saveSettingsBtn");
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", async () => {
      const ghlLocationId = root.querySelector("#settGhlLocationId").value.trim();
      const ghlToken = root.querySelector("#settGhlToken").value.trim();

      // Save settings to Supabase (token is NOT stored in Supabase)
      const metricoolBlogId = root.querySelector("#settMetricoolBlogId").value.trim();
      await saveClientSettings(clientId, {
        videos_per_week:     parseInt(root.querySelector("#settVpw").value) || 0,
        shorts_per_week:     parseInt(root.querySelector("#settSpw").value) || 0,
        written_per_week:    parseInt(root.querySelector("#settWpw").value) || 0,
        metricool_id:        root.querySelector("#settMetricool").value.trim(),
        metricool_blog_id:   metricoolBlogId,
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
        dna_doc_url:         root.querySelector("#settDnaDoc").value.trim(),
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

      // Auto-sync Metricool Blog ID to client_metricool table
      if (metricoolBlogId) {
        try {
          await sb.from('client_metricool').upsert({
            client_id: clientId,
            blog_id: metricoolBlogId,
            platforms: ["youtube"],
          }, { onConflict: 'client_id' });
        } catch (err) {
          console.error("Metricool blog ID sync error:", err);
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

/* ── COMPANY LINKS VIEW ──────────────────────────────────────────── */
async function renderCompanyLinks(root) {
  // Password gate
  const authed = sessionStorage.getItem('cc_company_auth');
  if (!authed) {
    root.innerHTML = `
      <div class="company-gate">
        <div class="gate-card">
          <div class="gate-title">Company Links</div>
          <p class="gate-desc">Enter the team password to access company resources.</p>
          <input type="password" class="settings-input" id="gatePw" placeholder="Password..." autofocus />
          <button class="btn-primary" id="gateSubmit" style="margin-top:10px;width:100%">Unlock</button>
          <div class="gate-error" id="gateError" style="display:none">Incorrect password</div>
        </div>
      </div>`;
    const pwInput = root.querySelector('#gatePw');
    const submitBtn = root.querySelector('#gateSubmit');
    const errEl = root.querySelector('#gateError');
    const tryUnlock = () => {
      if (pwInput.value === COMPANY_PASSWORD) {
        sessionStorage.setItem('cc_company_auth', '1');
        renderCompanyLinks(root);
      } else {
        errEl.style.display = 'block';
        pwInput.value = '';
        pwInput.focus();
      }
    };
    submitBtn.addEventListener('click', tryUnlock);
    pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
    return;
  }

  // Load links from Supabase
  const { data: links } = await sb.from('company_links').select('*').order('category').order('sort_order');
  const allLinks = links || [];

  // Group by category
  const categories = {};
  for (const link of allLinks) {
    const cat = link.category || 'General';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(link);
  }

  const catNames = Object.keys(categories);

  root.innerHTML = `
    <div class="company-page">
      <div class="detail-header">
        <div class="detail-name">Company Links</div>
      </div>
      <div id="companyLinksBody">
        ${catNames.length === 0 ? '<div class="empty-hint">No links yet. Add one below.</div>' : catNames.map(cat => `
          <div class="company-category">
            <div class="company-cat-title">${escHTML(cat)}</div>
            ${categories[cat].map(link => `
              <div class="company-link-row" data-link-id="${link.id}">
                <a class="company-link-label" href="${escHTML(link.url)}" target="_blank" rel="noopener">${escHTML(link.label)} ↗</a>
                <span class="company-link-url">${escHTML(link.url)}</span>
                <button class="company-link-delete" data-link-id="${link.id}" title="Delete">×</button>
              </div>`).join('')}
          </div>`).join('')}
      </div>

      <div class="company-add-section">
        <div class="detail-section-title">Add Link</div>
        <div class="settings-row">
          <span class="settings-label">Category</span>
          <input class="settings-input" id="newLinkCat" type="text" placeholder="e.g. Internal Tools" list="catSuggestions" />
          <datalist id="catSuggestions">
            ${catNames.map(c => `<option value="${escHTML(c)}">`).join('')}
          </datalist>
        </div>
        <div class="settings-row">
          <span class="settings-label">Label</span>
          <input class="settings-input" id="newLinkLabel" type="text" placeholder="e.g. n8n Dashboard" />
        </div>
        <div class="settings-row">
          <span class="settings-label">URL</span>
          <input class="settings-input" id="newLinkUrl" type="url" placeholder="https://..." />
        </div>
        <button class="btn-primary" id="addLinkBtn" style="margin-top:8px">Add Link</button>
      </div>
    </div>`;

  // ── Bind add link ──
  root.querySelector('#addLinkBtn').addEventListener('click', async () => {
    const category = root.querySelector('#newLinkCat').value.trim() || 'General';
    const label = root.querySelector('#newLinkLabel').value.trim();
    const url = root.querySelector('#newLinkUrl').value.trim();
    if (!label || !url) return;

    await sb.from('company_links').insert({ category, label, url, sort_order: 0 });
    renderCompanyLinks(root);
  });

  // ── Bind delete links ──
  root.querySelectorAll('.company-link-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const linkId = parseInt(btn.dataset.linkId);
      btn.textContent = '?';
      btn.addEventListener('click', async () => {
        await sb.from('company_links').delete().eq('id', linkId);
        renderCompanyLinks(root);
      }, { once: true });
      setTimeout(() => { btn.textContent = '×'; }, 2000);
    }, { once: true });
  });
}

/* ── TEAM MANAGEMENT VIEW ──────────────────────────────────────────── */
function renderTeamManagement(root) {
  const roles = ['LF Creative', 'SF Creative', 'LF Editor', 'SF Editor', 'CSM', 'Growth', 'Copywriter', 'Admin'];

  root.innerHTML = `
    <div class="company-page">
      <div class="detail-header">
        <div class="detail-name">Team Members</div>
      </div>
      <div id="teamListBody">
        ${TEAM.length === 0 ? '<div class="empty-hint">No team members yet. Add one below.</div>' :
          TEAM.map(m => `
            <div class="company-link-row team-member-row" data-member-id="${m.id}">
              <span class="team-initials-badge">${escHTML(m.initials)}</span>
              <span class="team-member-name">${escHTML(m.name)}</span>
              <span class="team-member-role">${escHTML(m.role)}</span>
              <button class="company-link-delete team-delete-btn" data-member-id="${m.id}" title="Delete">×</button>
            </div>`).join('')}
      </div>

      <div class="company-add-section">
        <div class="detail-section-title">Add Team Member</div>
        <div class="settings-row">
          <span class="settings-label">Name</span>
          <input class="settings-input" id="newMemberName" type="text" placeholder="e.g. Jane Doe" />
        </div>
        <div class="settings-row">
          <span class="settings-label">Initials</span>
          <input class="settings-input" id="newMemberInitials" type="text" placeholder="e.g. JD" maxlength="3" style="max-width:100px" />
        </div>
        <div class="settings-row">
          <span class="settings-label">Role</span>
          <select class="settings-input" id="newMemberRole">
            ${roles.map(r => `<option value="${escHTML(r)}">${escHTML(r)}</option>`).join('')}
          </select>
        </div>
        <button class="btn-primary" id="addMemberBtn" style="margin-top:8px">Add Member</button>
      </div>
    </div>`;

  // ── Bind add member ──
  root.querySelector('#addMemberBtn').addEventListener('click', async () => {
    try {
      const nameInput = root.querySelector('#newMemberName');
      const initialsInput = root.querySelector('#newMemberInitials');
      const name = nameInput.value.trim();
      const initials = initialsInput.value.trim().toUpperCase();
      const role = root.querySelector('#newMemberRole').value;

      if (!name || !initials) {
        if (!name) nameInput.style.borderColor = 'var(--red)';
        if (!initials) initialsInput.style.borderColor = 'var(--red)';
        return;
      }

      const addBtn = root.querySelector('#addMemberBtn');
      addBtn.disabled = true;
      addBtn.textContent = 'Adding…';

      const res = await sb.from('team_members').insert({ name, initials, role }).select();
      console.log('Insert full response:', JSON.stringify(res));
      const { data, error } = res;
      if (error) {
        addBtn.disabled = false;
        addBtn.textContent = 'Add Member';
        alert('Failed to add member: ' + (error.message || JSON.stringify(error)));
        return;
      }
      if (!data || !data[0]) {
        addBtn.disabled = false;
        addBtn.textContent = 'Add Member';
        alert('Insert returned no data. Check RLS policies on team_members (INSERT for anon role).');
        return;
      }
      TEAM.push({ id: data[0].id, initials: data[0].initials, name: data[0].name, role: data[0].role });
      renderTeamManagement(root);
    } catch (err) {
      console.error('Add member exception:', err);
      alert('Error adding member: ' + err.message);
      const addBtn = root.querySelector('#addMemberBtn');
      if (addBtn) { addBtn.disabled = false; addBtn.textContent = 'Add Member'; }
    }
  });

  // ── Bind delete members ──
  root.querySelectorAll('.team-delete-btn').forEach(btn => {
    let confirmTimeout = null;
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const memberId = parseInt(btn.dataset.memberId);

      if (btn.dataset.confirm === '1') {
        // Second click — perform delete
        clearTimeout(confirmTimeout);
        btn.disabled = true;
        btn.textContent = '…';
        await sb.from('client_team').delete().eq('team_member_id', memberId);
        await sb.from('team_members').delete().eq('id', memberId);
        TEAM = TEAM.filter(m => m.id !== memberId);
        for (const c of CLIENTS) {
          if (c.team) c.team = c.team.filter(id => id !== memberId);
        }
        renderTeamManagement(root);
      } else {
        // First click — enter confirm state
        btn.dataset.confirm = '1';
        btn.textContent = '?';
        btn.title = 'Click again to confirm delete';
        confirmTimeout = setTimeout(() => {
          btn.textContent = '×';
          btn.title = 'Delete';
          delete btn.dataset.confirm;
        }, 2000);
      }
    });
  });

  // ── Bind edit members (click row to edit inline) ──
  root.querySelectorAll('.team-member-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.team-delete-btn')) return;  // ignore delete clicks
      if (root.querySelector('.team-member-row.editing')) return;  // one at a time

      const memberId = parseInt(row.dataset.memberId);
      const member = TEAM.find(m => m.id === memberId);
      if (!member) return;

      row.classList.add('editing');
      row.innerHTML = `
        <input class="settings-input team-edit-name" type="text" value="${escHTML(member.name)}" placeholder="Name" />
        <input class="settings-input team-edit-initials" type="text" value="${escHTML(member.initials)}" maxlength="3" placeholder="XX" style="max-width:70px" />
        <select class="settings-input team-edit-role">
          ${roles.map(r => `<option value="${escHTML(r)}"${r === member.role ? ' selected' : ''}>${escHTML(r)}</option>`).join('')}
        </select>
        <div class="team-edit-actions">
          <button class="btn-primary team-edit-save" style="padding:4px 12px;font-size:12px">Save</button>
          <button class="btn-secondary team-edit-cancel" style="padding:4px 12px;font-size:12px">Cancel</button>
        </div>`;

      row.querySelector('.team-edit-cancel').addEventListener('click', (ev) => {
        ev.stopPropagation();
        renderTeamManagement(root);
      });

      row.querySelector('.team-edit-save').addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const newName = row.querySelector('.team-edit-name').value.trim();
        const newInitials = row.querySelector('.team-edit-initials').value.trim().toUpperCase();
        const newRole = row.querySelector('.team-edit-role').value;
        if (!newName || !newInitials) return;

        const saveBtn = row.querySelector('.team-edit-save');
        saveBtn.disabled = true;
        saveBtn.textContent = '…';

        const { error } = await sb.from('team_members').update({ name: newName, initials: newInitials, role: newRole }).eq('id', memberId);
        if (!error) {
          member.name = newName;
          member.initials = newInitials;
          member.role = newRole;
        }
        renderTeamManagement(root);
      });

      // Auto-focus the name input
      const nameInput = row.querySelector('.team-edit-name');
      if (nameInput) nameInput.focus();
    });
  });
}

/* ── COLLAPSIBLE SECTION HELPERS ──────────────────────────────────── */
function collapsibleSection(sectionKey, title, summaryHTML, bodyHTML, opts) {
  opts = opts || {};
  const stored = localStorage.getItem('cc_collapse_' + sectionKey);
  const isOpen = stored !== null ? stored === '1' : (opts.defaultOpen || false);
  return `
    <div class="collapsible-section" data-section="${sectionKey}">
      <button class="collapsible-header${isOpen ? ' open' : ''}" aria-expanded="${isOpen}">
        <span class="collapsible-arrow">${isOpen ? '▾' : '▸'}</span>
        <span class="collapsible-title">${title}</span>
        <span class="collapsible-summary">${summaryHTML}</span>
      </button>
      <div class="collapsible-body" style="display:${isOpen ? 'block' : 'none'}">
        ${bodyHTML}
      </div>
    </div>`;
}

function collapsibleSub(subKey, title, countHTML, bodyHTML) {
  const stored = localStorage.getItem('cc_sub_' + subKey);
  const isOpen = stored !== null ? stored === '1' : true;
  return `
    <div class="collapsible-sub" data-sub="${subKey}">
      <button class="sub-header${isOpen ? ' open' : ''}">
        <span class="sub-arrow">${isOpen ? '▾' : '▸'}</span>
        <span class="sub-title">${title}</span>
        <span class="sub-count">${countHTML}</span>
      </button>
      <div class="sub-body" style="display:${isOpen ? 'block' : 'none'}">
        ${bodyHTML}
      </div>
    </div>`;
}

function bindCollapsibles(root) {
  root.querySelectorAll('.collapsible-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.collapsible-section');
      const body = section.querySelector('.collapsible-body');
      const arrow = btn.querySelector('.collapsible-arrow');
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      arrow.textContent = isOpen ? '▸' : '▾';
      btn.classList.toggle('open', !isOpen);
      btn.setAttribute('aria-expanded', !isOpen);
      localStorage.setItem('cc_collapse_' + section.dataset.section, isOpen ? '0' : '1');
    });
  });
  root.querySelectorAll('.sub-header').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const sub = btn.closest('.collapsible-sub');
      const body = sub.querySelector('.sub-body');
      const arrow = btn.querySelector('.sub-arrow');
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      arrow.textContent = isOpen ? '▸' : '▾';
      btn.classList.toggle('open', !isOpen);
      localStorage.setItem('cc_sub_' + sub.dataset.sub, isOpen ? '0' : '1');
    });
  });
}

/* ── UTILITY ─────────────────────────────────────────────────────── */
function escHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
