/* ─────────────────────────────────────────────────────────────────
   CC PM Dashboard v4  ·  app.js
   Supabase-powered: board, phase stepper, checklist, team, add/delete client
   ───────────────────────────────────────────────────────────────── */

/* ── SUPABASE CONNECTION ─────────────────────────────────────────── */
const SUPABASE_URL = "https://andcsslmnogpuntfuouh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFuZGNzc2xtbm9ncHVudGZ1b3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzMDQ2OTMsImV4cCI6MjA4Nzg4MDY5M30.3i0zOowv6SU4xWvGy506KMpzh8qp634iwfIH8FQVTgA";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let TEAM = [];
let CLIENTS = [];

/* ── LOAD DATA FROM SUPABASE ─────────────────────────────────────── */
async function loadData() {
  const [teamRes, clientRes, assignRes, checkRes] = await Promise.all([
    sb.from('team_members').select('*').order('id'),
    sb.from('clients').select('*').order('id'),
    sb.from('client_team').select('*'),
    sb.from('onboarding_checks').select('*').order('id'),
  ]);

  TEAM = (teamRes.data || []).map(t => ({
    id: t.id, initials: t.initials, name: t.name, role: t.role
  }));

  CLIENTS = (clientRes.data || []).map(c => {
    const client = {
      id: c.id,
      name: c.name,
      phase: c.phase,
      team: (assignRes.data || []).filter(a => a.client_id === c.id).map(a => a.team_member_id),
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

/* ── SAVE FUNCTIONS ──────────────────────────────────────────────── */
async function saveNewClient(name) {
  const { data } = await sb.from('clients').insert({ name, phase: 'pipeline' }).select().single();
  return data;
}

async function deleteClientDB(clientId) {
  await sb.from('clients').delete().eq('id', clientId);
}

async function updatePhase(clientId, newPhase) {
  await sb.from('clients').update({ phase: newPhase }).eq('id', clientId);
}

async function addTeamMemberDB(clientId, memberId) {
  await sb.from('client_team').insert({ client_id: clientId, team_member_id: memberId });
}

async function removeTeamMemberDB(clientId, memberId) {
  await sb.from('client_team').delete().eq('client_id', clientId).eq('team_member_id', memberId);
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
  if (pillClients) pillClients.textContent = `${CLIENTS.length} clients`;
  const prodCount = CLIENTS.filter(c => c.phase === "production" || c.phase === "special").length;
  if (pillProd) pillProd.textContent = `${prodCount} in production`;
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
          CLIENTS.push({ id: saved.id, name: saved.name, phase: saved.phase, team: [] });
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

  return `
    <div class="client-card" data-id="${c.id}">
      <div class="card-name">${c.name}</div>
      ${specialHTML}
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

  root.innerHTML = `
    <div class="detail-header">
      <div class="detail-name">${client.name}</div>
      <button class="delete-client-btn" id="deleteClientBtn" title="Remove client">Remove</button>
    </div>
    ${stepperHTML}
    ${teamSection}
    ${checklistSection}
  `;

  // Delete client → saves to Supabase
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

  // Phase stepper clicks → saves to Supabase
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

  // Remove member → saves to Supabase
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

  // Add member → saves to Supabase
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

  // Checklist toggle → saves to Supabase
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
    });
  });
}
