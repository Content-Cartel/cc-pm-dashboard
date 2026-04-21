/* ─────────────────────────────────────────────────────────────────
   CC PM Dashboard · tasks.js
   Per-client freeform task list. Loaded after app.js and depends on
   globals: sb, getClient, getTeamMember, escHTML, collapsibleSection,
   logActivity, timeAgo.
   ───────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const STATUSES = [
    { key: 'todo',         label: 'To do',       cls: 'task-status-todo' },
    { key: 'in-progress',  label: 'In progress', cls: 'task-status-progress' },
    { key: 'done',         label: 'Done',        cls: 'task-status-done' },
  ];
  const STATUS_KEYS = STATUSES.map(s => s.key);
  const NEXT_STATUS = { 'todo': 'in-progress', 'in-progress': 'done', 'done': 'todo' };
  const STATUS_LABEL = Object.fromEntries(STATUSES.map(s => [s.key, s.label]));
  const STATUS_CLS   = Object.fromEntries(STATUSES.map(s => [s.key, s.cls]));

  function todayISO() { return new Date().toISOString().split('T')[0]; }

  function isOverdue(t) {
    return t.due_date && t.status !== 'done' && t.due_date < todayISO();
  }

  function sortTasks(tasks) {
    // group by status order; within group, due_date asc nulls last, then created_at desc
    return tasks.slice().sort((a, b) => {
      const sa = STATUS_KEYS.indexOf(a.status);
      const sb_ = STATUS_KEYS.indexOf(b.status);
      if (sa !== sb_) return sa - sb_;
      const ad = a.due_date || '9999-12-31';
      const bd = b.due_date || '9999-12-31';
      if (ad !== bd) return ad.localeCompare(bd);
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
  }

  function renderTaskRow(t, client) {
    const member = t.assignee_id ? getTeamMember(t.assignee_id) : null;
    const assigneeHTML = member
      ? `<span class="task-avatar" title="${escHTML(member.name)}">${escHTML(member.initials)}</span>`
      : `<span class="task-avatar task-avatar-empty" title="Unassigned">·</span>`;
    const dueHTML = t.due_date
      ? `<span class="task-due ${isOverdue(t) ? 'overdue' : ''}">${formatDue(t.due_date)}</span>`
      : '<span class="task-due task-due-empty">—</span>';
    return `
      <div class="task-row ${t.status === 'done' ? 'task-row-done' : ''}" data-task-id="${t.id}">
        <button class="task-status-pill ${STATUS_CLS[t.status]}" data-task-id="${t.id}" title="Click to advance status">${STATUS_LABEL[t.status]}</button>
        <div class="task-title-wrap">
          <span class="task-title" data-task-id="${t.id}" title="Click to edit">${escHTML(t.title)}</span>
          ${t.description ? `<div class="task-desc">${escHTML(t.description)}</div>` : ''}
        </div>
        ${assigneeHTML}
        ${dueHTML}
        <button class="task-delete" data-task-id="${t.id}" title="Delete">×</button>
      </div>`;
  }

  function formatDue(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    const diffDays = Math.round((d - today) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function summary(tasks) {
    const todo = tasks.filter(t => t.status === 'todo').length;
    const prog = tasks.filter(t => t.status === 'in-progress').length;
    const overdue = tasks.filter(isOverdue).length;
    if (tasks.length === 0) return 'No tasks';
    const parts = [];
    if (todo) parts.push(`${todo} to do`);
    if (prog) parts.push(`${prog} in progress`);
    if (overdue) parts.push(`<span class="task-summary-overdue">${overdue} overdue</span>`);
    return parts.length ? parts.join(' · ') : `${tasks.length} done`;
  }

  function tasksSectionHTML(client) {
    const tasks = client.tasks || [];
    const teamMembers = (client.team || []).map(id => getTeamMember(id)).filter(Boolean);
    const sorted = sortTasks(tasks);

    const addRow = `
      <div class="task-add-row" id="taskAddRow-${client.id}">
        <input type="text" class="settings-input task-add-title" id="taskAddTitle-${client.id}" placeholder="New task..." />
        <select class="settings-input task-add-assignee" id="taskAddAssignee-${client.id}">
          <option value="">Unassigned</option>
          ${teamMembers.map(m => `<option value="${m.id}">${escHTML(m.name)}</option>`).join('')}
        </select>
        <input type="date" class="settings-input task-add-due" id="taskAddDue-${client.id}" />
        <button class="btn-primary task-add-btn" id="taskAddBtn-${client.id}">+ Add</button>
      </div>`;

    const listHTML = sorted.length
      ? `<div class="task-list">${sorted.map(t => renderTaskRow(t, client)).join('')}</div>`
      : '<div class="empty-hint" style="margin-top:8px">No tasks yet — add one above</div>';

    const body = `<div class="tasks-container" data-client-id="${client.id}">${addRow}${listHTML}</div>`;
    return collapsibleSection('tasks', 'Tasks', summary(tasks), body);
  }

  async function refreshTasks(client) {
    const { data } = await sb.from('client_tasks')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false });
    client.tasks = data || [];
  }

  function bindTasksSection(root, client, rerender) {
    const container = root.querySelector(`.tasks-container[data-client-id="${client.id}"]`);
    if (!container) return;

    // Add task
    const addBtn   = container.querySelector(`#taskAddBtn-${client.id}`);
    const addTitle = container.querySelector(`#taskAddTitle-${client.id}`);
    const addAss   = container.querySelector(`#taskAddAssignee-${client.id}`);
    const addDue   = container.querySelector(`#taskAddDue-${client.id}`);

    const submitAdd = async () => {
      const title = (addTitle.value || '').trim();
      if (!title) { addTitle.focus(); return; }
      const assignee_id = addAss.value ? parseInt(addAss.value) : null;
      const due_date = addDue.value || null;
      addBtn.disabled = true;
      const { error } = await sb.from('client_tasks').insert({
        client_id: client.id,
        title,
        assignee_id, // TODO(slack): notify assignee on insert/reassignment via fireWebhookTo + n8n pm-task-assigned
        due_date,
        status: 'todo',
      });
      if (error) { console.error('Task insert error:', error); addBtn.disabled = false; return; }
      logActivity(client.id, 'task_added', `Task added: ${title}`);
      await refreshTasks(client);
      rerender();
    };
    addBtn.addEventListener('click', submitAdd);
    addTitle.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdd(); });

    // Status pill cycle
    container.querySelectorAll('.task-status-pill').forEach(pill => {
      pill.addEventListener('click', async () => {
        const id = parseInt(pill.dataset.taskId);
        const t = (client.tasks || []).find(x => x.id === id);
        if (!t) return;
        const next = NEXT_STATUS[t.status] || 'todo';
        pill.disabled = true;
        const { error } = await sb.from('client_tasks').update({ status: next }).eq('id', id);
        if (error) { console.error(error); pill.disabled = false; return; }
        t.status = next;
        if (next === 'done') logActivity(client.id, 'task_done', `Task done: ${t.title}`);
        rerender();
      });
    });

    // Inline edit title (click)
    container.querySelectorAll('.task-title').forEach(span => {
      span.addEventListener('click', () => {
        const id = parseInt(span.dataset.taskId);
        const t = (client.tasks || []).find(x => x.id === id);
        if (!t) return;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'settings-input task-title-edit';
        input.value = t.title;
        span.replaceWith(input);
        input.focus();
        input.select();
        const commit = async (save) => {
          const newTitle = input.value.trim();
          if (save && newTitle && newTitle !== t.title) {
            await sb.from('client_tasks').update({ title: newTitle }).eq('id', id);
            t.title = newTitle;
          }
          rerender();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') commit(true);
          else if (e.key === 'Escape') commit(false);
        });
        input.addEventListener('blur', () => commit(true));
      });
    });

    // Delete (two-click confirm)
    container.querySelectorAll('.task-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.taskId);
        if (btn.dataset.confirm === '1') {
          const t = (client.tasks || []).find(x => x.id === id);
          await sb.from('client_tasks').delete().eq('id', id);
          if (t) logActivity(client.id, 'task_deleted', `Task removed: ${t.title}`);
          await refreshTasks(client);
          rerender();
        } else {
          btn.dataset.confirm = '1';
          btn.textContent = '?';
          btn.title = 'Click again to confirm';
          setTimeout(() => {
            if (btn.isConnected) {
              btn.dataset.confirm = '0';
              btn.textContent = '×';
              btn.title = 'Delete';
            }
          }, 2000);
        }
      });
    });
  }

  window.tasksSectionHTML = tasksSectionHTML;
  window.bindTasksSection = bindTasksSection;
})();
