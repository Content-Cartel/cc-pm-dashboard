# Content Cartel — n8n Workflows Build Guide
# 7 workflows for pm.contentcartel.net automations
# n8n instance: content-cartel-1.app.n8n.cloud

---

## PREREQUISITES — Set Up Credentials First

Before building any workflow, create these 3 credentials in n8n:
Settings > Credentials > Add Credential

### 1. Supabase
- **Type:** Supabase API
- **Host:** `https://andcsslmnogpuntfuouh.supabase.co`
- **Service Role Key:** (use your service_role key from Supabase > Settings > API)
  - NOT the anon key — service_role bypasses RLS for automation reads

### 2. Slack
- **Type:** Slack OAuth2
- **Scopes needed:** `chat:write`, `chat:write.public`
- Click "Connect" and authorize your CC Slack workspace
- The bot needs to be invited to `#production` and each client's internal channel

### 3. Google Drive
- **Type:** Google Drive OAuth2
- Click "Connect" and authorize with the CC Google account
- Needs full Drive access to create folders

---

## WORKFLOW 1: Deliverable Notifications
**Purpose:** Post to a client's Slack channel when deliverables are created or change status.

### Nodes

**Node 1 — Webhook (trigger)**
- Method: POST
- Path: `pm-deliverable`
- Response Mode: Respond Immediately
- This URL is already configured in the dashboard code

**Node 2 — Supabase (lookup client settings)**
- Operation: Get Many
- Table: `client_settings`
- Filter: `client_id` equals `{{ $json.client_id }}`
- Credential: your Supabase credential

**Node 3 — IF (has Slack channel?)**
- Condition: `{{ $json.slack_channel }}` is not empty

**Node 4 — Function (format message)**
```javascript
const event = $('Webhook').item.json;
const channel = $('Supabase').item.json.slack_channel;

let message = '';
if (event.event === 'deliverable_created') {
  const dir = event.director_led ? ' :film_frames: Director-led' : '';
  message = `:new: *New Deliverable* — "${event.deliverable_title}" for *${event.client_name}*${dir}\nStatus: :memo: Script`;
} else if (event.event === 'deliverable_status_changed') {
  const statusEmoji = {
    script: ':memo:', filming: ':movie_camera:', editing: ':scissors:',
    review: ':eyes:', done: ':white_check_mark:'
  };
  const oldE = statusEmoji[event.old_status] || '';
  const newE = statusEmoji[event.new_status] || '';
  message = `:arrows_counterclockwise: *${event.deliverable_title}* — *${event.client_name}*\n${oldE} ${event.old_status} → ${newE} ${event.new_status}`;

  if (event.new_status === 'done') {
    message = `:white_check_mark: *Done!* "${event.deliverable_title}" for *${event.client_name}* is complete! :tada:`;
  }
}

return { message, channel };
```

**Node 5 — Slack (send message)**
- Channel: `{{ $json.channel }}`
- Message: `{{ $json.message }}`
- Credential: your Slack credential

### Test
Create a deliverable in the dashboard or change a status. Check the client's internal Slack channel.

---

## WORKFLOW 2: Daily Standup Bot
**Purpose:** Post a production summary to #production every weekday at 8 AM.

### Nodes

**Node 1 — Schedule Trigger**
- Trigger at: 08:00
- Days: Monday through Friday
- Timezone: your timezone

**Node 2 — Supabase (get active deliverables)**
- Operation: Get Many
- Table: `deliverables`
- Filters: `status` not equal to `done`
- Return All: true

**Node 3 — Supabase (get all clients)**
- Operation: Get Many
- Table: `clients`
- Return All: true

**Node 4 — Function (build standup message)**
```javascript
const deliverables = $('Supabase').all().map(i => i.json);
const clients = $('Supabase1').all().map(i => i.json);
const now = new Date();
const dayName = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

// Group deliverables by client
const byClient = {};
for (const d of deliverables) {
  if (!byClient[d.client_id]) byClient[d.client_id] = [];
  byClient[d.client_id].push(d);
}

const statusEmoji = {
  script: ':memo:', filming: ':movie_camera:', editing: ':scissors:', review: ':eyes:'
};

let lines = [];
let totalActive = deliverables.length;
let clientCount = Object.keys(byClient).length;

lines.push(`:sunrise: *Daily Standup — ${dayName}*`);
lines.push(`${totalActive} active deliverables across ${clientCount} clients\n`);

for (const [clientId, delivs] of Object.entries(byClient)) {
  const client = clients.find(c => c.id == clientId);
  const name = client ? client.name : `Client #${clientId}`;

  // Count by status
  const counts = {};
  const stuck = [];
  for (const d of delivs) {
    counts[d.status] = (counts[d.status] || 0) + 1;
    // Check if stuck (no update in 24h)
    const updatedAt = new Date(d.updated_at || d.created_at);
    const hoursAgo = (now - updatedAt) / (1000 * 60 * 60);
    if (hoursAgo > 24) {
      stuck.push({ title: d.title, status: d.status, hours: Math.round(hoursAgo) });
    }
  }

  const statusLine = Object.entries(counts)
    .map(([s, n]) => `${statusEmoji[s] || ''} ${s}: ${n}`)
    .join(' | ');

  lines.push(`*${name}* (${delivs.length} active)`);
  lines.push(statusLine);

  for (const s of stuck) {
    lines.push(`:warning: Stuck: "${s.title}" in ${s.status} for ${s.hours}h`);
  }
  lines.push('');
}

return { message: lines.join('\n') };
```

**Node 5 — Slack (send message)**
- Channel: `#production`
- Message: `{{ $json.message }}`

### Test
Use "Test Workflow" button (it fires immediately ignoring the schedule).

---

## WORKFLOW 3: Overdue / Stuck Alerts
**Purpose:** Every 4 hours, alert client channels about deliverables stuck 24h+ in one status.

### Nodes

**Node 1 — Schedule Trigger**
- Trigger every: 4 hours

**Node 2 — Supabase (get active deliverables)**
- Operation: Get Many
- Table: `deliverables`
- Filters: `status` not equal to `done`
- Return All: true

**Node 3 — Function (find stuck items)**
```javascript
const deliverables = $input.all().map(i => i.json);
const now = new Date();
const stuckItems = [];

for (const d of deliverables) {
  const updatedAt = new Date(d.updated_at || d.created_at);
  const hoursAgo = (now - updatedAt) / (1000 * 60 * 60);
  if (hoursAgo >= 24) {
    stuckItems.push({
      ...d,
      hours_stuck: Math.round(hoursAgo)
    });
  }
}

if (stuckItems.length === 0) return []; // stops the workflow

// Group by client_id
const byClient = {};
for (const d of stuckItems) {
  if (!byClient[d.client_id]) byClient[d.client_id] = [];
  byClient[d.client_id].push(d);
}

return Object.entries(byClient).map(([clientId, items]) => ({
  json: { client_id: parseInt(clientId), stuck_items: items }
}));
```

**Node 4 — Supabase (get client settings — in loop)**
- Operation: Get Many
- Table: `client_settings`
- Filter: `client_id` equals `{{ $json.client_id }}`

**Node 5 — Supabase (get client name)**
- Operation: Get Many
- Table: `clients`
- Filter: `id` equals `{{ $json.client_id }}`

**Node 6 — IF (has Slack channel?)**
- Condition: `{{ $('Supabase').item.json.slack_channel }}` is not empty

**Node 7 — Function (format alert)**
```javascript
const settings = $('Supabase').item.json;
const client = $('Supabase1').item.json;
const items = $('Function').item.json.stuck_items;
const channel = settings.slack_channel;

const statusEmoji = {
  script: ':memo:', filming: ':movie_camera:', editing: ':scissors:', review: ':eyes:'
};

let lines = [`:rotating_light: *Stuck Alert — ${client.name}*`];
lines.push(`${items.length} deliverable${items.length > 1 ? 's' : ''} with no movement in 24+ hours:\n`);

for (const d of items) {
  const dir = d.director_led ? ' (Dir)' : '';
  lines.push(`:small_red_triangle: "${d.title}"${dir} — stuck in ${d.status} for ${d.hours_stuck}h`);
}

return { message: lines.join('\n'), channel };
```

**Node 8 — Slack (send message)**
- Channel: `{{ $json.channel }}`
- Message: `{{ $json.message }}`

### Test
To test: manually backdate a deliverable's `updated_at` in Supabase to 25+ hours ago, then trigger the workflow.

---

## WORKFLOW 4: Weekly Volume Report
**Purpose:** Friday at 5 PM, post a done-vs-target report to #production.

### Nodes

**Node 1 — Schedule Trigger**
- Trigger at: 17:00
- Day: Friday
- Timezone: your timezone

**Node 2 — Supabase (get deliverables done this week)**
- Operation: Get Many
- Table: `deliverables`
- Filters: `status` equals `done`
- You'll filter by date in the Function node (Supabase n8n node doesn't support date math easily)
- Return All: true

**Node 3 — Supabase (get all clients)**
- Operation: Get Many
- Table: `clients`
- Return All: true

**Node 4 — Supabase (get all client_settings)**
- Operation: Get Many
- Table: `client_settings`
- Return All: true

**Node 5 — Function (build report)**
```javascript
const allDone = $('Supabase').all().map(i => i.json);
const clients = $('Supabase1').all().map(i => i.json);
const settings = $('Supabase2').all().map(i => i.json);

const now = new Date();
const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Filter to this week only
const thisWeek = allDone.filter(d => d.done_at && new Date(d.done_at) >= weekAgo);

// Group by client
const byClient = {};
for (const d of thisWeek) {
  byClient[d.client_id] = (byClient[d.client_id] || 0) + 1;
}

// Only production clients
const prodClients = clients.filter(c => c.phase === 'production' || c.phase === 'special');

let totalDone = 0;
let totalTarget = 0;
let onTrack = 0;
let behind = 0;
const clientLines = [];

for (const c of prodClients) {
  const sett = settings.find(s => s.client_id === c.id);
  const target = sett ? (sett.videos_per_week || 0) : 0;
  const done = byClient[c.id] || 0;
  totalDone += done;
  totalTarget += target;

  if (target === 0) {
    clientLines.push(`:white_circle: ${c.name}: ${done} done (no target set)`);
  } else if (done >= target) {
    onTrack++;
    clientLines.push(`:large_green_circle: ${c.name}: ${done}/${target} — On track`);
  } else {
    behind++;
    clientLines.push(`:red_circle: ${c.name}: ${done}/${target} — Behind`);
  }
}

let lines = [];
lines.push(`:bar_chart: *Weekly Volume Report — ${dateStr}*`);
lines.push(`${totalDone} videos completed / ${totalTarget} target across ${prodClients.length} clients`);
lines.push(`:large_green_circle: ${onTrack} on track | :red_circle: ${behind} behind\n`);
lines.push(...clientLines);

return { message: lines.join('\n') };
```

**Node 6 — Slack (send message)**
- Channel: `#production`
- Message: `{{ $json.message }}`

### Test
Use "Test Workflow" button.

---

## WORKFLOW 5: Google Drive Folder Auto-Creation
**Purpose:** When a client moves to Production phase, auto-create their Drive folder structure.

### Nodes

**Node 1 — Webhook (trigger)**
- Method: POST
- Path: `pm-phase-change`
- Response Mode: Respond Immediately

**Node 2 — IF (moving to production?)**
- Condition: `{{ $json.new_phase }}` equals `production`

**Node 3 — Supabase (check if Drive already set)**
- Operation: Get Many
- Table: `client_settings`
- Filter: `client_id` equals `{{ $('Webhook').item.json.client_id }}`

**Node 4 — IF (Drive URL empty?)**
- Condition: `{{ $json.gdrive_url }}` is empty (to prevent creating duplicates)

**Node 5 — Google Drive (create root folder)**
- Operation: Create Folder
- Folder Name: `{{ $('Webhook').item.json.client_name }}`
- Parent Folder: your CC shared drive or parent folder ID
- Save the folder ID in this node's output

**Node 6a — Google Drive (create LF folder)**
- Operation: Create Folder
- Folder Name: `LF`
- Parent Folder: `{{ $('Google Drive').item.json.id }}`

**Node 6b — Google Drive (create SF folder)**
- Operation: Create Folder
- Folder Name: `SF`
- Parent Folder: `{{ $('Google Drive').item.json.id }}`

**Node 6c — Google Drive (create B-roll folder)**
- Operation: Create Folder
- Folder Name: `B-roll`
- Parent Folder: `{{ $('Google Drive').item.json.id }}`

**Nodes 7a-7f — Google Drive (create Raw + Edited in each)**
For each of LF, SF, B-roll → create `Raw` and `Edited` subfolders:
- `Raw` inside LF, `Edited` inside LF
- `Raw` inside SF, `Edited` inside SF
- `Raw` inside B-roll, `Edited` inside B-roll

**Node 8 — Supabase (save Drive URL)**
- Operation: Upsert
- Table: `client_settings`
- Conflict Column: `client_id`
- Data:
  - `client_id`: `{{ $('Webhook').item.json.client_id }}`
  - `gdrive_url`: `https://drive.google.com/drive/folders/{{ $('Google Drive').item.json.id }}`

Final structure created:
```
{Client Name}/
  LF/
    Raw/
    Edited/
  SF/
    Raw/
    Edited/
  B-roll/
    Raw/
    Edited/
```

### Test
Move a test client from Onboarding → Production in the PM dashboard. Check Google Drive for new folders and the client's settings for the saved URL.

---

## WORKFLOW 6: Friday Weekly Wins (CSM Draft)
**Purpose:** Friday 9 AM — draft a wins summary for each client and post to their internal channel for CSM to review and send to the client.

### Nodes

**Node 1 — Schedule Trigger**
- Trigger at: 09:00
- Day: Friday
- Timezone: your timezone

**Node 2 — Supabase (get done deliverables)**
- Operation: Get Many
- Table: `deliverables`
- Filter: `status` equals `done`
- Return All: true

**Node 3 — Supabase (get all clients)**
- Operation: Get Many
- Table: `clients`
- Return All: true

**Node 4 — Supabase (get all client_settings)**
- Operation: Get Many
- Table: `client_settings`
- Return All: true

**Node 5 — Function (build per-client wins drafts)**
```javascript
const allDone = $('Supabase').all().map(i => i.json);
const clients = $('Supabase1').all().map(i => i.json);
const settings = $('Supabase2').all().map(i => i.json);

const now = new Date();
const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

// Filter to this week only
const thisWeek = allDone.filter(d => d.done_at && new Date(d.done_at) >= weekAgo);

// Group by client
const byClient = {};
for (const d of thisWeek) {
  if (!byClient[d.client_id]) byClient[d.client_id] = [];
  byClient[d.client_id].push(d);
}

const results = [];

for (const [clientId, delivs] of Object.entries(byClient)) {
  const client = clients.find(c => c.id == clientId);
  const sett = settings.find(s => s.client_id == clientId);
  if (!client || !sett || !sett.slack_channel) continue;

  // Only production clients
  if (client.phase !== 'production' && client.phase !== 'special') continue;

  let lines = [`:trophy: *Weekly Wins Draft — ${client.name}*\n`];
  lines.push(`Hey team, here's what we accomplished this week:\n`);

  for (const d of delivs) {
    const dir = d.director_led ? ' (Director-led)' : '';
    lines.push(`:white_check_mark: "${d.title}"${dir} — completed`);
  }

  lines.push(`\n${delivs.length} video${delivs.length > 1 ? 's' : ''} delivered this week :fire:\n`);
  lines.push(`_@CSM — review and send to client in their external channel_`);

  results.push({ message: lines.join('\n'), channel: sett.slack_channel });
}

if (results.length === 0) return [];
return results.map(r => ({ json: r }));
```

**Node 6 — Slack (send message — loops automatically)**
- Channel: `{{ $json.channel }}`
- Message: `{{ $json.message }}`

### Test
Make sure at least one client has a deliverable with `done_at` in the last 7 days and a `slack_channel` set, then trigger manually.

---

## WORKFLOW 7: Monday Scripts & Content Reminder
**Purpose:** Monday 8 AM — remind CSM to send scripts and content to each client.

### Nodes

**Node 1 — Schedule Trigger**
- Trigger at: 08:00
- Day: Monday
- Timezone: your timezone

**Node 2 — Supabase (get all production clients)**
- Operation: Get Many
- Table: `clients`
- Filters: `phase` equals `production`
- Return All: true

**Node 3 — Supabase (get all client_settings)**
- Operation: Get Many
- Table: `client_settings`
- Return All: true

**Node 4 — Function (build per-client reminder)**
```javascript
const clients = $('Supabase').all().map(i => i.json);
const settings = $('Supabase1').all().map(i => i.json);

const results = [];

for (const c of clients) {
  const sett = settings.find(s => s.client_id === c.id);
  if (!sett || !sett.slack_channel) continue;

  let lines = [`:memo: *Monday Content Send — ${c.name}*\n`];
  lines.push(`Time to send this week's scripts and content to the client:\n`);

  if (sett.sf_scripts_url) lines.push(`:page_facing_up: SF Scripts: ${sett.sf_scripts_url}`);
  if (sett.lf_scripts_url) lines.push(`:page_facing_up: LF Scripts: ${sett.lf_scripts_url}`);
  if (sett.written_content_url) lines.push(`:pencil: Written Content: ${sett.written_content_url}`);

  // Only send if there are any links to share
  const hasLinks = sett.sf_scripts_url || sett.lf_scripts_url || sett.written_content_url;
  if (!hasLinks) continue;

  lines.push(`\n_@CSM — review scripts, then share in client's external Slack + email_`);

  results.push({ message: lines.join('\n'), channel: sett.slack_channel });
}

if (results.length === 0) return [];
return results.map(r => ({ json: r }));
```

**Node 5 — Slack (send message — loops automatically)**
- Channel: `{{ $json.channel }}`
- Message: `{{ $json.message }}`

### Test
Ensure at least one production client has `slack_channel` + script URLs set, then trigger manually.

---

## BUILD ORDER (recommended)

1. **WF1** — Deliverable Notifications (test immediately, webhook already fires)
2. **WF3** — Stuck Alerts (same Slack-lookup pattern as WF1)
3. **WF2** — Daily Standup (test with manual trigger)
4. **WF4** — Weekly Volume Report (test with manual trigger)
5. **WF6** — Friday Weekly Wins (test with manual trigger)
6. **WF7** — Monday Scripts Reminder (test with manual trigger)
7. **WF5** — Google Drive Auto-Creation (test by moving a test client to production)

---

## QUICK REFERENCE: Webhook URLs

| Webhook | URL Path | Fires When |
|---------|----------|------------|
| Deliverable events | `/pm-deliverable` | Deliverable created or status changed |
| Phase change | `/pm-phase-change` | Client moves between pipeline/onboarding/production |

---

## AFTER ALL WORKFLOWS ARE BUILT

1. Activate all 7 workflows in n8n (toggle ON)
2. Invite the Slack bot to `#production` channel
3. Invite the Slack bot to each client's internal channel
4. Have the team fill in Slack channels + all client links in the PM dashboard settings page for every client

---

## PRIORITY 1 FIX: YouTube Upload / Auto Scheduler — Drive URL Fix

**Problem:** The YouTube Upload workflow sends Google Drive share links to Metricool. Metricool API needs direct-download URLs, not share/view links.

**Current (broken):** `https://drive.google.com/file/d/{FILE_ID}/view?usp=sharing`
**Required:** `https://drive.google.com/uc?export=download&id={FILE_ID}`

### Fix

Add a **Function node** immediately before the Metricool/YouTube API call node:

```javascript
// Transform Google Drive share link → direct download URL
const shareUrl = $json.video_url || $json.url || '';
const match = shareUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
if (match) {
  const fileId = match[1];
  return {
    ...$json,
    video_url: `https://drive.google.com/uc?export=download&id=${fileId}`,
    original_url: shareUrl,
    file_id: fileId
  };
}
// Fallback — return as-is if it's already a direct URL
return $json;
```

### Test
1. Take any Google Drive video share link
2. Run the Function node → verify output URL format
3. Test the full workflow end-to-end with a real video upload

---

## WORKFLOW 8: Auto-Check — Footage Received (Drive Trigger)

**Purpose:** When raw footage is uploaded to `{Client}/LF/Raw/` in Google Drive, auto-check `footage_received` in the PM dashboard.

### Nodes

**Node 1 — Google Drive Trigger**
- Event: File Created
- Folder: The shared CC Drive root folder (or use "Watch All" and filter in next node)
- Credential: Google Drive OAuth2

**Node 2 — Function (extract client name from path)**
```javascript
const filePath = $json.name || $json.parents?.[0]?.name || '';
// The folder structure is: {Client Name}/LF/Raw/
// We need to walk up the parent chain to find the client name
const parents = $json.parents || [];

// This depends on your exact trigger — you may need to use
// Google Drive API to get parent folder names
// For now, assume the trigger includes path info

// If using "File Created in specific folder" per client,
// you can hardcode the client mapping or use folder ID → client lookup

return {
  file_name: $json.name,
  folder_path: filePath,
  step_to_check: 'footage_received'
};
```

**Node 3 — Supabase (lookup client by Drive folder)**
- Operation: Get Many
- Table: `client_settings`
- You'll need to match the Drive folder to the client
- Alternative: Store `gdrive_lf_raw_folder_id` in client_settings

**Node 4 — Function (get current week Monday)**
```javascript
const now = new Date();
const day = now.getDay();
const diff = day === 0 ? 6 : day - 1;
const monday = new Date(now);
monday.setDate(now.getDate() - diff);
monday.setHours(0, 0, 0, 0);
const weekStart = monday.toISOString().split('T')[0];

return {
  client_id: $('Supabase').item.json.client_id,
  week_start: weekStart,
  step: 'footage_received'
};
```

**Node 5 — Supabase (upsert weekly_checklist)**
- Operation: Upsert
- Table: `weekly_checklist`
- Conflict Columns: `client_id`, `week_start`
- Data: `footage_received = true`, `footage_received_at = NOW()`, `footage_received_by = 'auto:drive'`

### Scaling Note
You can create one workflow per client (simple but many workflows), or one workflow that watches the root folder and uses a lookup table. The per-client approach is easier to debug.

---

## WORKFLOW 9: Auto-Check — Edit Delivered (Drive Trigger)

**Purpose:** When an edited video is uploaded to `{Client}/LF/Edited/`, auto-check `edit_delivered`.

Identical structure to WF8, but:
- Watch folder: `{Client}/LF/Edited/`
- Step to check: `edit_delivered`
- Also fires the edit-delivered Slack notification webhook:

**Extra Node — HTTP Request (fire dashboard webhook)**
```
POST https://content-cartel-1.app.n8n.cloud/webhook/pm-edit-delivered
Body: {
  "event": "edit_delivered",
  "client_name": "{{ client_name }}",
  "client_id": {{ client_id }},
  "step": "edit_delivered",
  "step_label": "Edit delivered",
  "actor": "auto:drive",
  "slack_channel": "{{ slack_channel }}",
  "week_start": "{{ week_start }}"
}
```

---

## WORKFLOW 10: Auto-Check — Published (Piggyback on YouTube Upload)

**Purpose:** After a successful YouTube upload via the Auto Scheduler, auto-check `published`.

### How to Add
In the existing YouTube Upload / Auto Scheduler workflow, add nodes **after** the successful upload node:

**Node A — Function (get week start)**
Same week calculation as WF8 Node 4.

**Node B — Supabase (update weekly_checklist)**
- Table: `weekly_checklist`
- Filter: `client_id` equals the client from the upload context
- Update: `published = true`, `published_at = NOW()`, `published_by = 'auto:youtube'`

---

## WORKFLOW 11: Auto-Check — Scripts Sent (Slack Trigger)

**Purpose:** When someone posts in a client's Slack channel with a message containing "scripts", auto-check `scripts_sent`.

### Nodes

**Node 1 — Slack Trigger (Event: message)**
- Event: `message`
- Channel: Watch all channels (or specific client channels)

**Node 2 — IF (message contains "scripts")**
- Condition: `{{ $json.text.toLowerCase().includes('scripts') }}`

**Node 3 — Supabase (lookup client by Slack channel)**
- Table: `client_settings`
- Filter: `slack_channel` equals `{{ $json.channel }}`

**Node 4 — Function + Supabase (check scripts_sent)**
Same pattern as WF8 Nodes 4-5, with `step = 'scripts_sent'`.

### Alternative Approach
Instead of watching for the word "scripts", create a Slack Workflow (Slack's built-in automation) with a button that team members click. The Slack Workflow calls an n8n webhook with the channel name.

---

## WORKFLOW 12: Auto Cleaner — Debug Guide

**Problem:** The Auto Cleaner workflow at `http://132.145.129.39` shows 0 executions in n8n.

### Debugging Steps

1. **Check workflow activation:**
   - Go to n8n dashboard → find the Auto Cleaner workflow
   - Is the toggle ON (active)?
   - If OFF, activate it

2. **Check the trigger node:**
   - What type? Webhook? Schedule? Google Drive trigger?
   - If webhook: copy the webhook URL and test with curl
   - If schedule: check the cron expression and timezone
   - If Drive trigger: verify the folder ID is correct

3. **Test the cleaning server:**
   ```bash
   curl http://132.145.129.39/health
   curl http://132.145.129.39/api/status
   # Try common health check endpoints
   ```
   - If the server is down, check the Oracle Cloud instance
   - SSH: `ssh ubuntu@132.145.129.39` (if you have access)

4. **Check n8n execution logs:**
   - Go to the workflow → Executions tab
   - Look for failed executions (they may have errored silently)
   - Check the "All Executions" view in n8n settings

5. **Common fixes:**
   - **Server IP changed:** Update the URL in the HTTP Request node
   - **Firewall blocking:** The Oracle Cloud instance may have security rules blocking n8n's IP
   - **Add error handling:** Add an Error Trigger node that sends a Slack message to `#production` on failure:
     ```
     :rotating_light: Auto Cleaner failed: {{ $json.error.message }}
     Server: http://132.145.129.39
     ```

6. **Expected flow:**
   ```
   Raw video in Drive → n8n detects new file →
   Sends to cleaning server (132.145.129.39) →
   Server processes video (noise reduction, color correction, etc.) →
   n8n downloads processed video →
   Uploads to {Client}/LF/Processed/ folder
   ```

### If Server Is Working but Workflow Isn't Triggering
- Create a simple test workflow: Schedule Trigger (every 5 min) → HTTP Request to `http://132.145.129.39/health` → IF (status OK) → Log success
- This confirms n8n can reach the server

---

## UPDATED WEBHOOK REFERENCE

| Webhook | URL Path | Fires When |
|---------|----------|------------|
| Deliverable events | `/pm-deliverable` | Deliverable created or status changed |
| Phase change | `/pm-phase-change` | Client moves between pipeline/onboarding/production |
| Checklist step | `/pm-checklist` | Any weekly checklist step toggled |
| Edit delivered | `/pm-edit-delivered` | LF edit or SF clips delivered |
| Week complete | `/pm-checklist` (event: week_complete) | All active steps checked for a client |

---

## UPDATED BUILD ORDER

1. **WF1-7** — Original workflows (see above)
2. **Priority 1 Fix** — Add URL transform Function node to Auto Scheduler
3. **WF8** — Auto-Check: Footage Received (Drive trigger)
4. **WF9** — Auto-Check: Edit Delivered (Drive trigger)
5. **WF10** — Auto-Check: Published (piggyback on YouTube Upload)
6. **WF11** — Auto-Check: Scripts Sent (Slack trigger)
7. **WF12** — Debug and fix Auto Cleaner
