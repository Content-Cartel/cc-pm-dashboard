/* ─────────────────────────────────────────────────────────────────
   CC PM Dashboard · calendar.js
   Per-client content calendar. Two surfaces:
     1. Inline collapsible section on the client detail page (this week
        summary + targets badge + quick add).
     2. Full month grid at hash route #/client/<id>/calendar.
   Loaded after app.js. Depends on globals: sb, getClient, getTeamMember,
   escHTML, collapsibleSection, openModal, getCurrentWeekStart,
   logActivity, navigate.
   ───────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  const TYPES = [
    { key: 'lf',      label: 'LF',  full: 'Long form' },
    { key: 'sf',      label: 'SF',  full: 'Short form' },
    { key: 'written', label: 'WC',  full: 'Written' },
  ];
  const TYPE_LABEL = Object.fromEntries(TYPES.map(t => [t.key, t.label]));
  const TYPE_FULL  = Object.fromEntries(TYPES.map(t => [t.key, t.full]));

  const STATUSES = [
    { key: 'idea',       label: 'Idea',       cls: 'cal-status-idea' },
    { key: 'scripting',  label: 'Scripting',  cls: 'cal-status-scripting' },
    { key: 'editing',    label: 'Editing',    cls: 'cal-status-editing' },
    { key: 'ready',      label: 'Ready',      cls: 'cal-status-ready' },
    { key: 'published',  label: 'Published',  cls: 'cal-status-published' },
  ];
  const STATUS_KEYS = STATUSES.map(s => s.key);
  const STATUS_LABEL = Object.fromEntries(STATUSES.map(s => [s.key, s.label]));
  const STATUS_CLS   = Object.fromEntries(STATUSES.map(s => [s.key, s.cls]));

  /* ── DATE HELPERS ──────────────────────────────────────────────── */
  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function fromISO(s) { return new Date(s + 'T00:00:00'); }

  function thisWeekRange() {
    const start = fromISO(getCurrentWeekStart());
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return { start: isoDate(start), end: isoDate(end) };
  }

  function monthGridDates(year, month) {
    // Returns 42 dates (6 weeks) starting on the Monday of/before the 1st.
    const first = new Date(year, month, 1);
    const dow = first.getDay(); // 0=Sun
    const offset = dow === 0 ? 6 : dow - 1;
    const start = new Date(first); start.setDate(first.getDate() - offset);
    const dates = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      dates.push(d);
    }
    return dates;
  }

  /* ── REFRESH FROM DB ───────────────────────────────────────────── */
  async function refreshEntries(client) {
    const { data } = await sb.from('client_calendar_entries')
      .select('*')
      .eq('client_id', client.id)
      .order('publish_date', { ascending: true, nullsFirst: false });
    client.calendarEntries = data || [];
  }

  /* ── ENTRY MODAL ───────────────────────────────────────────────── */
  function openEntryModal(client, entry, defaultDate, onDone) {
    const isEdit = !!entry;
    const e = entry || {
      type: 'lf',
      title: '',
      publish_date: defaultDate || isoDate(new Date()),
      status: 'idea',
      assignee_id: null,
      drive_url: '',
      notes: '',
      is_client_visible: false,
    };
    const teamMembers = (client.team || []).map(id => getTeamMember(id)).filter(Boolean);

    const bodyHTML = `
      <div class="cal-form">
        <div class="cal-form-row">
          <label class="cal-form-label">Title</label>
          <input type="text" class="settings-input" id="calTitle" value="${escHTML(e.title)}" placeholder="What is this content?" />
        </div>
        <div class="cal-form-row cal-form-row-2col">
          <div>
            <label class="cal-form-label">Type</label>
            <select class="settings-input" id="calType">
              ${TYPES.map(t => `<option value="${t.key}" ${e.type === t.key ? 'selected' : ''}>${t.full}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="cal-form-label">Status</label>
            <select class="settings-input" id="calStatus">
              ${STATUSES.map(s => `<option value="${s.key}" ${e.status === s.key ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="cal-form-row cal-form-row-2col">
          <div>
            <label class="cal-form-label">Publish date</label>
            <input type="date" class="settings-input" id="calDate" value="${e.publish_date || ''}" />
          </div>
          <div>
            <label class="cal-form-label">Assignee</label>
            <select class="settings-input" id="calAssignee">
              <option value="">Unassigned</option>
              ${teamMembers.map(m => `<option value="${m.id}" ${e.assignee_id === m.id ? 'selected' : ''}>${escHTML(m.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="cal-form-row">
          <label class="cal-form-label">Drive / source URL</label>
          <input type="url" class="settings-input" id="calDrive" value="${escHTML(e.drive_url || '')}" placeholder="https://drive.google.com/..." />
        </div>
        <div class="cal-form-row">
          <label class="cal-form-label">Notes</label>
          <textarea class="settings-input cal-notes" id="calNotes" rows="3" placeholder="Optional notes...">${escHTML(e.notes || '')}</textarea>
        </div>
        <div class="cal-form-row cal-form-row-checkbox">
          <label class="cal-form-checkbox">
            <input type="checkbox" id="calClientVisible" ${e.is_client_visible ? 'checked' : ''} />
            <span>Visible to client (when client view ships)</span>
          </label>
        </div>
        ${isEdit ? '<button type="button" class="cal-delete-btn" id="calDeleteBtn">Delete entry</button>' : ''}
      </div>`;

    const modal = openModal({
      title: isEdit ? 'Edit content entry' : 'New content entry',
      bodyHTML,
      saveLabel: isEdit ? 'Save changes' : 'Create entry',
      onSave: async (body) => {
        const title = body.querySelector('#calTitle').value.trim();
        if (!title) { body.querySelector('#calTitle').focus(); return false; }
        const row = {
          client_id: client.id,
          type: body.querySelector('#calType').value,
          title,
          publish_date: body.querySelector('#calDate').value || null,
          status: body.querySelector('#calStatus').value,
          assignee_id: body.querySelector('#calAssignee').value ? parseInt(body.querySelector('#calAssignee').value) : null,
          drive_url: body.querySelector('#calDrive').value.trim() || null,
          notes: body.querySelector('#calNotes').value.trim() || null,
          is_client_visible: body.querySelector('#calClientVisible').checked,
        };
        if (isEdit) {
          await sb.from('client_calendar_entries').update(row).eq('id', e.id);
          logActivity(client.id, 'cal_updated', `Calendar: updated "${title}"`);
        } else {
          await sb.from('client_calendar_entries').insert(row);
          logActivity(client.id, 'cal_added', `Calendar: added "${title}" (${TYPE_FULL[row.type]})`);
        }
        await refreshEntries(client);
        if (typeof onDone === 'function') onDone();
      },
    });

    if (isEdit) {
      const delBtn = modal.overlay.querySelector('#calDeleteBtn');
      if (delBtn) {
        delBtn.addEventListener('click', async () => {
          if (delBtn.dataset.confirm === '1') {
            await sb.from('client_calendar_entries').delete().eq('id', e.id);
            logActivity(client.id, 'cal_deleted', `Calendar: removed "${e.title}"`);
            await refreshEntries(client);
            modal.close();
            if (typeof onDone === 'function') onDone();
          } else {
            delBtn.dataset.confirm = '1';
            delBtn.textContent = 'Click again to confirm';
            setTimeout(() => {
              if (delBtn.isConnected) {
                delBtn.dataset.confirm = '0';
                delBtn.textContent = 'Delete entry';
              }
            }, 2500);
          }
        });
      }
    }
  }

  /* ── INLINE SECTION (client detail page) ───────────────────────── */
  function targetsBadgeHTML(client) {
    const sett = client.settings || {};
    const targets = { lf: sett.videos_per_week || 0, sf: sett.shorts_per_week || 0, written: sett.written_per_week || 0 };
    const week = thisWeekRange();
    const inWeek = (client.calendarEntries || []).filter(e => e.publish_date && e.publish_date >= week.start && e.publish_date <= week.end);

    const pills = [];
    for (const t of TYPES) {
      const target = targets[t.key];
      if (!target) continue;
      const ofType = inWeek.filter(e => e.type === t.key);
      const planned = ofType.filter(e => e.status !== 'idea').length;
      const published = ofType.filter(e => e.status === 'published').length;
      const cls = planned >= target ? 'cal-target-pill done' : 'cal-target-pill';
      pills.push(`<span class="${cls}">${planned}/${target} ${t.label} planned · ${published} published</span>`);
    }
    return pills.length
      ? `<div class="cal-targets-row">${pills.join('')}</div>`
      : '';
  }

  function inlineWeekListHTML(client) {
    const week = thisWeekRange();
    const inWeek = (client.calendarEntries || []).filter(e => e.publish_date && e.publish_date >= week.start && e.publish_date <= week.end);
    if (inWeek.length === 0) return '<div class="empty-hint" style="margin-top:8px">No entries scheduled this week</div>';

    // Group by date
    const byDate = {};
    for (const e of inWeek) {
      (byDate[e.publish_date] = byDate[e.publish_date] || []).push(e);
    }
    const dates = Object.keys(byDate).sort();
    return dates.map(d => {
      const dObj = fromISO(d);
      const heading = dObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return `
        <div class="cal-day-group">
          <div class="cal-day-heading">${heading}</div>
          <div class="cal-day-entries">
            ${byDate[d].map(e => entryChipHTML(e, true)).join('')}
          </div>
        </div>`;
    }).join('');
  }

  function entryChipHTML(e, withMeta) {
    const member = e.assignee_id ? getTeamMember(e.assignee_id) : null;
    return `
      <button class="cal-entry-chip ${STATUS_CLS[e.status]}" data-entry-id="${e.id}" title="${escHTML(STATUS_LABEL[e.status])}">
        <span class="cal-entry-type">${TYPE_LABEL[e.type]}</span>
        <span class="cal-entry-title">${escHTML(e.title)}</span>
        ${withMeta && member ? `<span class="cal-entry-avatar" title="${escHTML(member.name)}">${escHTML(member.initials)}</span>` : ''}
      </button>`;
  }

  function calendarInlineSectionHTML(client) {
    const entries = client.calendarEntries || [];
    const week = thisWeekRange();
    const inWeek = entries.filter(e => e.publish_date && e.publish_date >= week.start && e.publish_date <= week.end);
    const summary = `${inWeek.length} this week · ${entries.length} total`;

    const body = `
      <div class="cal-inline" data-client-id="${client.id}">
        <div class="cal-inline-toolbar">
          ${targetsBadgeHTML(client)}
          <div class="cal-inline-actions">
            <button class="btn-cancel cal-inline-add" type="button" data-client-id="${client.id}">+ New entry</button>
            <a class="cal-inline-open" href="#/client/${client.id}/calendar">Open full calendar →</a>
          </div>
        </div>
        ${inlineWeekListHTML(client)}
      </div>`;

    return collapsibleSection('calendar-inline', 'Content Calendar', summary, body);
  }

  function bindCalendarInline(root, client, rerender) {
    const container = root.querySelector(`.cal-inline[data-client-id="${client.id}"]`);
    if (!container) return;

    container.querySelectorAll('.cal-inline-add').forEach(btn => {
      btn.addEventListener('click', () => {
        openEntryModal(client, null, isoDate(new Date()), rerender);
      });
    });

    container.querySelectorAll('.cal-entry-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const id = parseInt(chip.dataset.entryId);
        const e = (client.calendarEntries || []).find(x => x.id === id);
        if (e) openEntryModal(client, e, null, rerender);
      });
    });
  }

  /* ── FULL MONTH GRID (route view) ─────────────────────────────── */
  // State for the month view (kept on window so re-renders preserve nav state)
  const VIEW = { year: null, month: null, typeFilter: 'all', statusFilter: 'all' };

  function renderClientCalendar(root, clientId) {
    const client = getClient(clientId);
    if (!client) {
      root.innerHTML = `<div class="empty-state">Client not found. <a href="#/">← Back</a></div>`;
      return;
    }
    if (VIEW.year === null) {
      const now = new Date();
      VIEW.year = now.getFullYear();
      VIEW.month = now.getMonth();
    }

    const filtered = (client.calendarEntries || []).filter(e => {
      if (VIEW.typeFilter !== 'all' && e.type !== VIEW.typeFilter) return false;
      if (VIEW.statusFilter !== 'all' && e.status !== VIEW.statusFilter) return false;
      return true;
    });

    const dates = monthGridDates(VIEW.year, VIEW.month);
    const monthLabel = new Date(VIEW.year, VIEW.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const todayISO = isoDate(new Date());

    const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    const cellsHTML = dates.map(d => {
      const di = isoDate(d);
      const inMonth = d.getMonth() === VIEW.month;
      const isToday = di === todayISO;
      const dayEntries = filtered.filter(e => e.publish_date === di);
      return `
        <div class="cal-cell ${inMonth ? '' : 'cal-cell-other-month'} ${isToday ? 'cal-cell-today' : ''}" data-date="${di}">
          <div class="cal-cell-date">${d.getDate()}</div>
          <div class="cal-cell-entries">
            ${dayEntries.map(e => entryChipHTML(e, false)).join('')}
          </div>
        </div>`;
    }).join('');

    const typeChips = [
      { key: 'all', label: 'All types' },
      ...TYPES.map(t => ({ key: t.key, label: t.full })),
    ].map(c => `<button class="cal-filter-chip ${VIEW.typeFilter === c.key ? 'active' : ''}" data-filter="type" data-value="${c.key}">${c.label}</button>`).join('');

    const statusChips = [
      { key: 'all', label: 'All statuses' },
      ...STATUSES.map(s => ({ key: s.key, label: s.label })),
    ].map(c => `<button class="cal-filter-chip ${VIEW.statusFilter === c.key ? 'active' : ''}" data-filter="status" data-value="${c.key}">${c.label}</button>`).join('');

    root.innerHTML = `
      <div class="cal-page">
        <div class="cal-page-header">
          <div class="cal-page-title">
            <span class="cal-page-client">${escHTML(client.name)}</span>
            <span class="cal-page-sub">Content Calendar</span>
          </div>
          <button class="btn-primary cal-page-add">+ New entry</button>
        </div>
        ${targetsBadgeHTML(client)}
        <div class="cal-toolbar">
          <div class="cal-month-nav">
            <button class="cal-nav-btn" data-nav="prev" aria-label="Previous month">◂</button>
            <span class="cal-month-label">${monthLabel}</span>
            <button class="cal-nav-btn" data-nav="next" aria-label="Next month">▸</button>
            <button class="cal-nav-btn cal-nav-today" data-nav="today">Today</button>
          </div>
          <div class="cal-filters">
            <div class="cal-filter-group">${typeChips}</div>
            <div class="cal-filter-group">${statusChips}</div>
          </div>
        </div>
        <div class="cal-grid">
          <div class="cal-grid-headers">
            ${dayLabels.map(l => `<div class="cal-grid-header">${l}</div>`).join('')}
          </div>
          <div class="cal-grid-cells">
            ${cellsHTML}
          </div>
        </div>
      </div>`;

    // Bindings
    root.querySelector('.cal-page-add').addEventListener('click', () => {
      openEntryModal(client, null, todayISO, () => renderClientCalendar(root, clientId));
    });

    root.querySelectorAll('.cal-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const dir = btn.dataset.nav;
        if (dir === 'prev') {
          if (VIEW.month === 0) { VIEW.month = 11; VIEW.year--; } else { VIEW.month--; }
        } else if (dir === 'next') {
          if (VIEW.month === 11) { VIEW.month = 0; VIEW.year++; } else { VIEW.month++; }
        } else if (dir === 'today') {
          const now = new Date();
          VIEW.year = now.getFullYear();
          VIEW.month = now.getMonth();
        }
        renderClientCalendar(root, clientId);
      });
    });

    root.querySelectorAll('.cal-filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const which = chip.dataset.filter;
        const val = chip.dataset.value;
        if (which === 'type') VIEW.typeFilter = val;
        else if (which === 'status') VIEW.statusFilter = val;
        renderClientCalendar(root, clientId);
      });
    });

    root.querySelectorAll('.cal-cell').forEach(cell => {
      cell.addEventListener('click', (e) => {
        // If a chip inside was clicked, defer to chip handler
        if (e.target.closest('.cal-entry-chip')) return;
        const date = cell.dataset.date;
        openEntryModal(client, null, date, () => renderClientCalendar(root, clientId));
      });
    });

    root.querySelectorAll('.cal-entry-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(chip.dataset.entryId);
        const entry = (client.calendarEntries || []).find(x => x.id === id);
        if (entry) openEntryModal(client, entry, null, () => renderClientCalendar(root, clientId));
      });
    });
  }

  window.calendarInlineSectionHTML = calendarInlineSectionHTML;
  window.bindCalendarInline = bindCalendarInline;
  window.renderClientCalendar = renderClientCalendar;
})();
