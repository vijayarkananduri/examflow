/* =========================================================================
   ExamFlow — app.js
   Adds: rail (search/timer/settings), floating dock, universal search,
   new Home, Library (notes+questions+quiz), backup reminder, undo, SW.
   All existing ExamFlow behavior and data shape is preserved.
   ========================================================================= */

const STORAGE_KEY = 'examflow.workspace.v1';
const COLORS = [
  { bg: '#e6f6f8', fg: '#398b9a', bar: '#71c6d5' },
  { bg: '#f0edff', fg: '#796bc8', bar: '#a99ae9' },
  { bg: '#fff4dc', fg: '#b18a35', bar: '#f3cb6d' },
  { bg: '#fff0f3', fg: '#bf6f88', bar: '#ed91b0' },
  { bg: '#eaf7f0', fg: '#4e9b7c', bar: '#8ed2b6' },
  { bg: '#fcefe4', fg: '#bd8051', bar: '#efa96f' }
];
const PROVIDERS = {
  gemini:    { label:'Google Gemini', model:'gemini-3.8-flash',  models:['gemini-3.8-flash'],                              hint:'Starts with “AIza”',    test:/^AIza[\w-]{20,}$/ },
  openai:    { label:'OpenAI',        model:'gpt-6-luna',        models:['gpt-6-luna','gpt-4o-mini','gpt-4o'],             hint:'Starts with “sk-”',     test:/^sk-[\w-]{20,}$/ },
  anthropic: { label:'Anthropic',     model:'claude-sonnet-5-5', models:['claude-sonnet-5-5','claude-haiku-4-5-20251001'],  hint:'Starts with “sk-ant-”', test:/^sk-ant-[\w-]{20,}$/ }
};
const VIEW_TITLES = { dashboard:'Overview', syllabus:'Syllabus', exams:'Exams', plan:'Study plan', library:'Library', metrics:'Insights', settings:'Settings', help:'Help' };

/* ---------- SVG icon factory (all same-style line icons, no emojis) ------- */
const S = (paths, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const I = {
  home:     S('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z"/>'),
  syllabus: S('<path d="M4 5h16M4 12h16M4 19h10"/>'),
  plan:     S('<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3M8.5 14h2M13.5 14h2M8.5 17h2"/>'),
  library:  S('<path d="M4 4.5h6a3 3 0 0 1 3 3V21M20 4.5h-6a3 3 0 0 0-3 3V21M4 4.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4.5"/>'),
  more:     S('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
  search:   S('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  timer:    S('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 3h6"/>'),
  settings: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  plus:     S('<path d="M12 5v14M5 12h14"/>'),
  close:    S('<path d="M6 6l12 12M18 6 6 18"/>'),
  check:    S('<path d="m5 12 5 5 9-11"/>'),
  chev:     S('<path d="m6 9 6 6 6-6"/>'),
  play:     S('<path d="M7 4.5v15l13-7.5-13-7.5Z"/>'),
  pause:    S('<path d="M7 4v16M17 4v16"/>'),
  stop:     S('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
  note:     S('<path d="M4 4.5h11l5 5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z"/><path d="M14 4.5V10h5.5"/>'),
  question: S('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1.9-1.1 1.6v.5M12 17h.01"/>'),
  tag:      S('<path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9-9-9Z"/><circle cx="7.5" cy="7.5" r="1.4"/>'),
  trash:    S('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13.5A1.5 1.5 0 0 0 9 22h6a1.5 1.5 0 0 0 1.5-1.5L17.5 7"/>'),
  backup:   S('<path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/><path d="M8 8l4-4 4 4M12 4v11"/>'),
  exam:     S('<rect x="4" y="4.5" width="16" height="17" rx="2"/><path d="M8 2.5v4M16 2.5v4M4 10h16"/>'),
  sync:     S('<path d="M4.5 12a7.5 7.5 0 0 1 12.9-5.2L20 9.5M19.5 12a7.5 7.5 0 0 1-12.9 5.2L4 14.5M20 5v4.5h-4.5M4 19v-4.5h4.5"/>'),
  help:     S('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1.9-1.1 1.6v.5M12 17h.01"/>'),
  spark:    S('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>'),
};

/* ---------- Blank state (notes + questions added) ------------------------- */
const blankState = () => ({
  version: 1,
  semesterName: 'Your semester',
  subjects: [], exams: [], sessions: [],
  notes: [], questions: [],
  settings: {
    provider: 'gemini', apiKey: '', model: 'gemini-3.8-flash',
    dailyHours: 4, readGoal: 3, todayHours: null, skipToday: [],
    railSide: 'right', reduceMotion: false, targetMinutes: null,
    lastBackup: null,
  },
  timer: null,
  tourDone: false,
});

let state = loadState();
let view = 'dashboard';
let openSubjectId = null;
let syllabusFilter = '';
let searchQuery = '';
let libraryTab = 'notes';
let libraryFilter = { subjectId: '', tag: '', q: '' };
let quizState = null;
let railState = { open: null };
let railHidden = false;
let dockHidden = false;
let searchOverlay = null;
let pendingUndo = null;
let forgotCheckTimer = null;
let tickHandle = null;
let pendingSyllabusImport = [];
let modalReturnFocus = null;
let menuReturnFocus = null;
let ttSeq = 0;
let tourI = -1;
let aiAbort = null;

/* ---------- Persistence --------------------------------------------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return blankState();
    const parsed = JSON.parse(raw);
    return {
      ...blankState(), ...parsed,
      settings: { ...blankState().settings, ...(parsed.settings || {}) },
      notes: parsed.notes || [],
      questions: parsed.questions || [],
    };
  } catch (e) { console.warn('Load failed', e); return blankState(); }
}
function persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} updateSidebar(); }

/* ---------- Utils -------------------------------------------------------- */
const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
const esc = (s = '') => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const localDate = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; };
const parseDate = s => new Date(`${s}T12:00:00`);
const daysBetween = (a, b) => Math.ceil((parseDate(localDate(b)) - parseDate(localDate(a))) / 86400000);
const fmtDate = (s, o = { month:'short', day:'numeric' }) => !s ? 'No date' : parseDate(s).toLocaleDateString(undefined, o);
const fmtDay = d => new Date(d).toLocaleDateString(undefined, { weekday: 'short' });
const fmtDuration = m => { m = Math.round(m || 0); const h = Math.floor(m / 60); const r = m % 60; return h ? `${h}h${r ? ` ${r}m` : ''}` : `${r}m`; };
const fmtTime = s => { s = Math.max(0, Math.round(s)); return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
const normalizeKey = v => String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');

/* ---------- Data accessors ------------------------------------------------ */
function allTopics() { return state.subjects.flatMap(s => s.units.flatMap(u => u.topics.map(t => ({ ...t, subjectId: s.id, subject: s.name, unitId: u.id, unit: u.name, color: s.color || 0 })))); }
function findTopic(id) { for (const s of state.subjects) for (const u of s.units) { const t = u.topics.find(x => x.id === id); if (t) return { subject: s, unit: u, topic: t }; } return null; }
function findSubject(id) { return state.subjects.find(s => s.id === id); }
function allTopicCount() { return allTopics().length; }
function statusCount(sid) {
  const ts = sid ? allTopics().filter(t => t.subjectId === sid) : allTopics();
  return { total: ts.length, unknown: ts.filter(t => t.status === 'unknown').length, review: ts.filter(t => t.status === 'review').length, ready: ts.filter(t => t.status === 'ready').length, reads: ts.reduce((n, t) => n + (t.reads || 0), 0) };
}
function subjectPct(s) { const c = statusCount(s.id); return c.total ? Math.round((c.ready + c.review * .45) / c.total * 100) : 0; }
function futureExams() { return state.exams.filter(e => e.date && daysBetween(new Date(), parseDate(e.date)) >= 0).sort((a, b) => a.date.localeCompare(b.date)); }
function dueTopics() { const t = localDate(); return allTopics().filter(x => x.status === 'ready' && x.nextReviewAt && x.nextReviewAt <= t); }
function dueInDays(days = 7) { const today = localDate(); const later = localDate(new Date(Date.now() + days * 86400000)); return allTopics().filter(t => t.nextReviewAt && t.nextReviewAt >= today && t.nextReviewAt <= later); }
function weeklyMinutes() { const since = new Date(); since.setDate(since.getDate() - 6); return state.sessions.filter(s => new Date(s.startAt) >= since).reduce((a, s) => a + s.minutes, 0); }
function todayMinutes() { const t = localDate(); return state.sessions.filter(s => localDate(new Date(s.startAt)) === t).reduce((a, s) => a + s.minutes, 0); }
function getStreak() {
  const dates = new Set(state.sessions.map(s => localDate(new Date(s.startAt))));
  let c = new Date(); if (!dates.has(localDate(c))) c.setDate(c.getDate() - 1);
  let n = 0; while (dates.has(localDate(c))) { n++; c.setDate(c.getDate() - 1); }
  return n;
}

/* ---------- Notes & questions helpers ------------------------------------ */
function notesFor(attach) { return state.notes.filter(n => n.attach.type === attach.type && n.attach.id === attach.id); }
function notesForTopic(topicId) {
  const f = findTopic(topicId); if (!f) return [];
  return [
    ...notesFor({ type: 'topic', id: f.topic.id }),
    ...notesFor({ type: 'unit', id: f.unit.id }),
    ...notesFor({ type: 'subject', id: f.subject.id }),
  ];
}
function noteCountFor(s) {
  return state.notes.filter(n =>
    (n.attach.type === 'subject' && n.attach.id === s.id) ||
    (n.attach.type === 'unit' && s.units.some(u => u.id === n.attach.id)) ||
    (n.attach.type === 'topic' && s.units.some(u => u.topics.some(t => t.id === n.attach.id)))
  ).length;
}
function allTags() { return [...new Set([...state.notes, ...state.questions].flatMap(n => n.tags || []))].sort(); }
function describeAttach(a) {
  if (!a) return '';
  if (a.type === 'subject') return findSubject(a.id)?.name || 'Subject';
  if (a.type === 'unit') { for (const s of state.subjects) { const u = s.units.find(x => x.id === a.id); if (u) return `${s.name} · ${u.name}`; } return 'Unit'; }
  if (a.type === 'topic') { const f = findTopic(a.id); return f ? `${f.subject.name} · ${f.topic.name}` : 'Topic'; }
  return '';
}

/* ---------- Plan engine (unchanged logic) -------------------------------- */
function makePlan(hours, skip) {
  const today = localDate();
  if (state.settings.todayPlanDate !== today) {
    state.settings.todayPlanDate = today;
    state.settings.todayHours = Number(state.settings.dailyHours) || 4;
    state.settings.skipToday = [];
    persist();
  }
  hours = hours ?? (state.settings.todayPlanDate === today ? state.settings.todayHours : state.settings.dailyHours);
  skip = skip ?? (state.settings.todayPlanDate === today ? state.settings.skipToday || [] : []);
  const now = new Date();
  const topics = allTopics().filter(t => !skip.includes(t.subjectId)).filter(t => t.status !== 'ready' || (t.nextReviewAt && t.nextReviewAt <= today));
  const candidates = topics.map(t => {
    const ex = futureExams().find(e => (e.topicIds || []).includes(t.id));
    const d = ex ? Math.max(0, daysBetween(now, parseDate(ex.date))) : 28;
    const last = t.lastReadAt ? Math.max(0, Math.floor((Date.now() - new Date(t.lastReadAt).getTime()) / 86400000)) : 20;
    const isDue = t.nextReviewAt && t.nextReviewAt <= today;
    const w = t.status === 'unknown' ? 1.5 : t.status === 'review' ? 1.12 : .86;
    const urgency = 1 + Math.max(0, 18 - d) / 12;
    const untouched = 1 + Math.min(last, 30) / 45;
    const score = (isDue ? 4 : 0) + w * urgency * untouched * (t.priority || 1);
    return { ...t, exam: ex, days: d, isDue, score, minutes: Math.max(15, Math.min(150, Math.round((t.estimateMin || 45) * (isDue ? .72 : 1)))) };
  }).sort((a, b) => b.score - a.score);
  const budget = Math.max(30, Number(hours || 0) * 60);
  const tasks = []; let used = 0;
  for (const t of candidates) {
    if (used >= budget) break;
    const m = Math.min(t.minutes, budget - used);
    if (m < 10) continue;
    tasks.push({ ...t, minutes: m, startMinute: used });
    used += m + 8;
  }
  const assigned = allTopics().filter(t => futureExams().some(e => (e.topicIds || []).includes(t.id)));
  const remaining = assigned.filter(t => t.status !== 'ready').reduce((a, t) => a + (t.estimateMin || 45), 0) + dueTopics().reduce((a, t) => a + (t.estimateMin || 45) * .7, 0);
  const next = futureExams()[0];
  const daysLeft = next ? Math.max(1, daysBetween(now, parseDate(next.date)) + 1) : null;
  const dailyNeed = daysLeft ? remaining / daysLeft : 0;
  const risk = Boolean(next && dailyNeed > (Number(state.settings.dailyHours) * 60));
  return { tasks, used, budget, remaining, next, daysLeft, dailyNeed, risk, totalCandidates: candidates.length };
}

/* ---------- Session logging (unchanged) ---------------------------------- */
function logSession(topicId, minutes, startAt = new Date(Date.now() - minutes * 60000).toISOString()) {
  const f = findTopic(topicId); if (!f) return;
  const dur = Math.max(1, Math.round(minutes));
  const ended = new Date().toISOString();
  f.topic.reads = (f.topic.reads || 0) + 1;
  f.topic.lastReadAt = ended;
  f.topic.readHistory = [...(f.topic.readHistory || []), ended];
  if (f.topic.status === 'unknown') f.topic.status = 'review';
  state.sessions.push({ id: uid('session'), topicId, subjectId: f.subject.id, topicName: f.topic.name, subjectName: f.subject.name, unitName: f.unit.name, startAt, endedAt: ended, minutes: dur });
  persist();
  return { subject: f.subject, unit: f.unit, topic: f.topic, duration: dur };
}

/* ---------- Timer module -------------------------------------------------- */
function timerElapsed() {
  if (!state.timer) return 0;
  const t = state.timer;
  const now = t.pausedAt ? new Date(t.pausedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((now - new Date(t.startedAt).getTime() - (t.pausedMs || 0)) / 1000));
}
function startTimer(topicId) {
  if (state.timer) { if (!confirm('A session is already running. Stop it and start this topic?')) return; finishTimer(false); }
  const f = findTopic(topicId); if (!f) return toast('Topic not found.', 'error');
  state.timer = { topicId, startedAt: new Date().toISOString(), pausedMs: 0, pausedAt: null, targetMinutes: state.settings.targetMinutes || null, _alerted: false };
  persist(); renderRail(); render();
  toast(`Started: ${f.topic.name}`, 'success');
  scheduleForgotCheck();
}
function pauseTimer() { if (!state.timer || state.timer.pausedAt) return; state.timer.pausedAt = new Date().toISOString(); persist(); renderRail(); render(); }
function resumeTimer() {
  if (!state.timer || !state.timer.pausedAt) return;
  const ms = Date.now() - new Date(state.timer.pausedAt).getTime();
  state.timer.pausedMs = (state.timer.pausedMs || 0) + ms;
  state.timer.pausedAt = null;
  persist(); renderRail(); render();
}
function finishTimer(notify = true) {
  if (!state.timer) return;
  const minutes = Math.max(1, Math.round(timerElapsed() / 60));
  const topicId = state.timer.topicId;
  state.timer = null;
  const res = logSession(topicId, minutes);
  persist(); renderRail(); render();
  if (notify && res) toast(`${fmtDuration(minutes)} logged · ${res.topic.name}`, 'success');
  clearTimeout(forgotCheckTimer);
}
function scheduleForgotCheck() {
  clearTimeout(forgotCheckTimer);
  forgotCheckTimer = setTimeout(() => {
    if (!state.timer) return;
    if (timerElapsed() / 3600 >= 3) {
      if (confirm('This session has been running over 3 hours. Did you forget to stop it?')) finishTimer();
    }
  }, 3 * 3600 * 1000);
}

/* ---------- Sidebar + title (kept mostly as-is) -------------------------- */
function updateSidebar() {
  const total = allTopicCount();
  const count = document.getElementById('topicCount'); if (count) count.textContent = total;
  const sem = document.getElementById('semesterLabel'); if (sem) sem.textContent = state.semesterName || 'Your semester';
  const mins = weeklyMinutes();
  const wh = document.getElementById('weekHours'); if (wh) wh.innerHTML = `${(mins / 60).toFixed(mins % 60 ? 1 : 0)}h <i>/ 28h</i>`;
  const wp = document.getElementById('weekProgress'); if (wp) wp.style.width = `${Math.min(100, mins / (28 * 60) * 100)}%`;
  const hint = document.getElementById('weekHint'); if (hint) hint.textContent = mins ? `${Math.round(mins / 60)}h studied in the last 7 days` : 'Start a session to build momentum';
}
function setPageHeader() {
  const t = document.getElementById('pageTitle'); if (t) t.textContent = VIEW_TITLES[view] || 'Overview';
  const d = document.getElementById('todayLabel'); if (d) d.textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  document.querySelectorAll('.nav-link[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.title = state.timer ? `${fmtTime(timerElapsed())} · ${VIEW_TITLES[view] || 'ExamFlow'}` : `${VIEW_TITLES[view] || 'ExamFlow'} — ExamFlow`;
}

/* ---------- Right rail ---------------------------------------------------- */
function renderRail() {
  const rail = document.getElementById('rail');
  if (!rail) return;
  rail.dataset.side = state.settings.railSide || 'right';
  const open = railState.open;
  const running = !!state.timer;
  const label = running ? fmtTime(timerElapsed()) : 'Timer';
  rail.classList.toggle('hidden', railHidden);
  rail.innerHTML = `
    <button class="rail-btn ${open === 'search' ? 'expanded' : open ? 'dim' : ''}" data-rail="search" aria-label="Search">${I.search}<span class="label">Search</span></button>
    <button class="rail-btn ${open === 'timer' ? 'expanded' : open ? 'dim' : ''}${running ? ' pulse' : ''}" data-rail="timer" aria-label="Timer">${I.timer}<span class="label timer-readout" id="railTimerLabel">${esc(label)}</span></button>
    <button class="rail-btn ${open === 'settings' ? 'expanded' : open ? 'dim' : ''}" data-rail="settings" aria-label="Settings">${I.settings}<span class="label">Settings</span></button>
  `;
  if (open) renderRailPanel(open);
}
function renderRailPanel(which) {
  const rail = document.getElementById('rail');
  rail.querySelector('.rail-panel')?.remove();
  const panel = document.createElement('div');
  panel.className = 'rail-panel';
  if (which === 'timer') {
    const f = state.timer ? findTopic(state.timer.topicId) : null;
    panel.innerHTML = f ? `
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:4px;letter-spacing:1px">NOW STUDYING</div>
      <div style="font-weight:600;font-size:14px;margin-bottom:10px">${esc(f.topic.name)}</div>
      <div class="timer-readout" style="font-size:24px;margin-bottom:12px">${fmtTime(timerElapsed())}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${state.timer.pausedAt
          ? `<button class="btn btn-soft btn-small" data-action="resume-timer">Resume</button>`
          : `<button class="btn btn-soft btn-small" data-action="pause-timer">Pause</button>`}
        <button class="btn btn-primary btn-small" data-action="finish-timer">Finish</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12.5px;color:var(--muted)">
        <input type="number" min="0" max="240" value="${state.settings.targetMinutes || ''}" placeholder="Target min" data-action="timer-target" style="width:90px;min-height:36px;padding:4px 10px;border:1px solid var(--line);border-radius:9px">
        target
      </label>
    ` : `
      <div style="font-size:12.5px;color:var(--muted);margin-bottom:10px">Pick a topic to begin.</div>
      <select data-action="timer-pick" style="width:100%;min-height:40px;border:1px solid var(--line);border-radius:10px;padding:0 10px;font-size:13px;background:var(--white)">
        <option value="">Choose a topic…</option>
        ${allTopics().map(t => `<option value="${t.id}">${esc(t.subject)} · ${esc(t.name)}</option>`).join('')}
      </select>
      <div style="margin-top:10px"><button class="btn btn-primary btn-small" data-action="timer-start-picked">Start</button></div>
    `;
  } else if (which === 'settings') {
    panel.innerHTML = `
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;letter-spacing:1px">QUICK SETTINGS</div>
      <div style="margin-bottom:10px">
        <div style="font-size:12.5px;margin-bottom:6px;font-weight:600">Rail side</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-small ${state.settings.railSide === 'left' ? 'btn-primary' : 'btn-outline'}" data-action="rail-side" data-side="left">Left</button>
          <button class="btn btn-small ${state.settings.railSide === 'right' ? 'btn-primary' : 'btn-outline'}" data-action="rail-side" data-side="right">Right</button>
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:10px">
        <input type="checkbox" data-action="toggle-motion" ${state.settings.reduceMotion ? 'checked' : ''}>
        <span>Reduce motion</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px">
        <input type="number" min="0" max="240" value="${state.settings.targetMinutes || ''}" placeholder="Target" data-action="default-target" style="width:80px;min-height:36px;padding:4px 10px;border:1px solid var(--line);border-radius:9px">
        <span>default target (min)</span>
      </label>
      <button class="btn btn-outline btn-small" style="width:100%" data-action="open-settings">Full settings</button>
    `;
  }
  rail.appendChild(panel);
}
function closeRail() {
  railState.open = null;
  document.querySelector('#rail .rail-panel')?.remove();
  renderRail();
}

/* ---------- Dock -------------------------------------------------------- */
const DOCK = [
  { id: 'dashboard', label: 'Home',     icon: I.home },
  { id: 'syllabus',  label: 'Syllabus', icon: I.syllabus },
  { id: 'plan',      label: 'Plan',     icon: I.plan },
  { id: 'library',   label: 'Library',  icon: I.library },
  { id: 'more',      label: 'More',     icon: I.more },
];
function renderDock() {
  const dock = document.getElementById('dock');
  if (!dock) return;
  dock.classList.toggle('hidden', dockHidden);
  const current = ['dashboard', 'syllabus', 'plan', 'library'].includes(view) ? view : (['exams','metrics','help','settings'].includes(view) ? 'more' : '');
  // slime positioning
  dock.innerHTML = `<span class="dock-slime" id="dockSlime" aria-hidden="true"></span>` +
    DOCK.map(d => {
      const active = current === d.id;
      return `<button class="dock-btn ${active ? 'active' : ''}" data-dock="${d.id}" aria-label="${d.label}">${d.icon}<span class="label">${d.label}</span></button>`;
    }).join('');
  // position slime
  requestAnimationFrame(() => {
    const idx = DOCK.findIndex(d => d.id === current);
    const slime = document.getElementById('dockSlime');
    if (!slime || idx < 0) { if (slime) slime.style.opacity = '0'; return; }
    slime.style.opacity = '1';
    const btns = dock.querySelectorAll('.dock-btn');
    const target = btns[idx];
    if (!target) return;
    slime.style.transform = `translateX(${target.offsetLeft - 8}px)`;
    slime.style.width = `${target.offsetWidth}px`;
  });
}

/* ---------- Universal search --------------------------------------------- */
function openSearchSheet(prefill = '') {
  closeRail();
  const host = document.getElementById('sheetHost');
  const scrim = document.getElementById('scrim');
  host.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Search">
      <div class="sheet-head"><h2>Search</h2><button class="modal-close" data-action="close-sheet" aria-label="Close">×</button></div>
      <div class="sheet-body">
        <div class="search-wrap">
          ${I.search.replace('<svg ', '<svg class="ic" ')}
          <input class="search-input" id="searchInput" type="search" autocomplete="off" placeholder="Search subjects, topics, notes, questions…" value="${esc(prefill)}">
        </div>
        <div id="searchResults" class="search-results"></div>
      </div>
    </div>
  `;
  host.classList.add('open');
  scrim.hidden = false;
  requestAnimationFrame(() => {
    const inp = document.getElementById('searchInput');
    inp?.focus(); inp?.setSelectionRange(inp.value.length, inp.value.length);
    runSearch(inp.value);
  });
  searchOverlay = host;
}
function closeSearchSheet() {
  document.getElementById('sheetHost').classList.remove('open');
  document.getElementById('sheetHost').innerHTML = '';
  document.getElementById('scrim').hidden = true;
  searchOverlay = null;
}
function runSearch(q) {
  const root = document.getElementById('searchResults'); if (!root) return;
  q = (q || '').trim();
  if (!q) { root.innerHTML = `<div class="search-empty">Type to search. Try <b>#tag</b> or “start integration”.</div>`; return; }
  if (q.startsWith('#')) {
    const tag = q.slice(1).toLowerCase();
    const notes = state.notes.filter(n => (n.tags || []).some(t => t.toLowerCase().includes(tag)));
    const questions = state.questions.filter(n => (n.tags || []).some(t => t.toLowerCase().includes(tag)));
    root.innerHTML = renderSearchGroup('Tagged notes', notes.map(n => ({ id: n.id, label: (n.body || '').slice(0, 60), hint: describeAttach(n.attach), action: 'open-note' }))) +
      renderSearchGroup('Tagged questions', questions.map(n => ({ id: n.id, label: n.question.slice(0, 60), hint: 'Question', action: 'goto-library-questions' })));
    return;
  }
  const lower = q.toLowerCase();
  const subjects = state.subjects.filter(s => s.name.toLowerCase().includes(lower)).slice(0, 5);
  const topics = allTopics().filter(t => t.name.toLowerCase().includes(lower)).slice(0, 8);
  const notes = state.notes.filter(n => (n.body || '').toLowerCase().includes(lower)).slice(0, 6);
  const questions = state.questions.filter(n => (n.question || '').toLowerCase().includes(lower)).slice(0, 6);
  const exams = state.exams.filter(e => (e.name || '').toLowerCase().includes(lower)).slice(0, 5);
  const quick = lower.match(/^start\s+(.+)$/i);
  let html = '';
  if (quick) {
    const t = allTopics().find(x => x.name.toLowerCase().includes(quick[1].toLowerCase()));
    if (t) html += renderSearchGroup('Quick action', [{ id: t.id, label: `Start ${t.name}`, hint: t.subject, action: 'start-topic' }]);
  }
  html += renderSearchGroup('Subjects', subjects.map(s => ({ id: s.id, label: s.name, hint: 'Subject', action: 'open-subject-detail' })));
  html += renderSearchGroup('Topics', topics.map(t => ({ id: t.id, label: t.name, hint: t.subject + ' · ' + t.unit, action: 'start-topic' })));
  html += renderSearchGroup('Notes', notes.map(n => ({ id: n.id, label: (n.body || '').slice(0, 70), hint: describeAttach(n.attach), action: 'open-note' })));
  html += renderSearchGroup('Questions', questions.map(n => ({ id: n.id, label: n.question.slice(0, 70), hint: 'Question', action: 'goto-library-questions' })));
  html += renderSearchGroup('Exams', exams.map(e => ({ id: e.id, label: e.name, hint: fmtDate(e.date), action: 'open-exams' })));
  root.innerHTML = html || `<div class="search-empty">No matches for “${esc(q)}”.</div>`;
}
function renderSearchGroup(title, items) {
  if (!items.length) return '';
  return `<div class="search-group"><h3>${title}</h3>${items.map(it => `
    <button class="search-item" data-action="${it.action}" data-id="${it.id}">
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.label)}</span>
      <span class="hint">${esc(it.hint || '')}</span>
    </button>`).join('')}</div>`;
}

/* ---------- Home (4 blocks only) ---------------------------------------- */
function viewDashboard() {
  const plan = makePlan();
  const today = todayMinutes();
  const budget = Math.max(30, (Number(state.settings.todayHours ?? state.settings.dailyHours) || 4) * 60);
  const pct = Math.min(100, Math.round(today / budget * 100));
  const ex = futureExams()[0];
  const streak = getStreak();
  const next = plan.tasks[0];
  const running = state.timer ? findTopic(state.timer.topicId) : null;

  // Block 1: Today
  const block1 = `
    <section class="card panel" style="background:linear-gradient(135deg,#fffefa 0%,#f4f7df 58%,#eef2d3 100%);border-color:#e0e7c8;position:relative;overflow:hidden">
      <div style="display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:center">
        <div style="--p:${pct};width:118px;height:118px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--brand,#d84f32) calc(var(--p)*1%),#e8ebdc 0);flex:none">
          <div style="width:90px;height:90px;border-radius:50%;background:#fffefa;display:grid;place-content:center;text-align:center">
            <strong style="font:700 24px 'Space Grotesk',sans-serif">${pct}%</strong>
            <small style="font-size:10.5px;color:#737a6d;margin-top:2px">of today</small>
          </div>
        </div>
        <div>
          <div style="font-size:10.5px;font-weight:700;letter-spacing:1.4px;color:#d84f32;text-transform:uppercase;margin-bottom:4px">TODAY</div>
          <h2 style="font:700 22px 'Space Grotesk',sans-serif;margin:0 0 6px">${fmtDuration(today)} done · ${fmtDuration(Math.max(0, budget - today))} left</h2>
          <p style="margin:0;color:#737a6d;font-size:13px">${ex ? `${esc(ex.name)} in ${Math.max(0, daysBetween(new Date(), parseDate(ex.date)))} days` : 'Add an exam to shape your plan'}</p>
          <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:12px">
            <span style="padding:5px 11px;border-radius:999px;background:#fbe4dc;color:#b83b24;font-size:11.5px;font-weight:600">${fmtDuration(budget)} budget</span>
            ${streak ? `<span style="padding:5px 11px;border-radius:999px;background:#e2f2e6;color:#2f7d4f;font-size:11.5px;font-weight:600">${streak}d streak</span>` : ''}
          </div>
        </div>
      </div>
    </section>`;

  // Block 2: Next move
  const block2 = running ? `
    <section class="card panel" style="background:linear-gradient(135deg,#3a1f14 0%,#a8391d 55%,#e8832e 100%);color:#fff;border:0;position:relative;overflow:hidden">
      <div style="font-size:10.5px;font-weight:700;letter-spacing:1.4px;color:#ffe8d0;text-transform:uppercase;margin-bottom:6px">NOW STUDYING</div>
      <h2 style="font:700 22px 'Space Grotesk',sans-serif;margin:0 0 8px;color:#fff">${esc(running.topic.name)}</h2>
      <p style="color:#ffe8d0;font-size:13.5px;margin:0 0 16px">${esc(running.subject.name)} · ${fmtTime(timerElapsed())} elapsed${state.timer.pausedAt ? ' (paused)' : ''}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${state.timer.pausedAt
          ? `<button class="btn btn-outline" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.4)" data-action="resume-timer">Resume</button>`
          : `<button class="btn btn-outline" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.4)" data-action="pause-timer">Pause</button>`}
        <button class="btn btn-primary" data-action="finish-timer">Finish session</button>
      </div>
    </section>` : (next ? `
    <section class="card panel" style="background:linear-gradient(135deg,#1c1b4b 0%,#33308f 55%,#0f6f8a 100%);color:#fff;border:0;position:relative;overflow:hidden">
      <div style="font-size:10.5px;font-weight:700;letter-spacing:1.4px;color:#b8d934;text-transform:uppercase;margin-bottom:6px">NEXT MOVE</div>
      <h2 style="font:700 22px 'Space Grotesk',sans-serif;margin:0 0 8px;color:#fff">${esc(next.subject)} → ${esc(next.name)}</h2>
      <p style="color:#dfe3ff;font-size:13.5px;margin:0 0 16px">${esc(next.unit)} · ${fmtDuration(next.minutes)} suggested${next.exam ? ` · ${next.days}d to ${esc(next.exam.name)}` : ''}</p>
      <button class="btn btn-primary" data-action="start-topic" data-id="${next.id}">Start now</button>
    </section>` : `
    <section class="card panel" style="background:linear-gradient(135deg,#1c1b4b 0%,#33308f 55%,#0f6f8a 100%);color:#fff;border:0">
      <div style="font-size:10.5px;font-weight:700;letter-spacing:1.4px;color:#b8d934;text-transform:uppercase;margin-bottom:6px">GET STARTED</div>
      <h2 style="font:700 22px 'Space Grotesk',sans-serif;margin:0 0 8px;color:#fff">Add your first subject to begin.</h2>
      <p style="color:#dfe3ff;font-size:13.5px;margin:0 0 16px">Bring in a syllabus, add exams, and the plan will find your next best move.</p>
      <button class="btn btn-primary" data-action="open-subject">Add subject</button>
    </section>`);

  // Block 3: Subjects progress (3-5 rows)
  const subjectRows = state.subjects.slice(0, 5).map(s => {
    const c = statusCount(s.id); const p = subjectPct(s); const co = COLORS[(s.color || 0) % COLORS.length];
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid #eef0e7">
      <div style="width:36px;height:36px;border-radius:11px;background:${co.bg};color:${co.fg};display:grid;place-items:center;font:700 12px 'Space Grotesk',sans-serif;flex:none">${esc(s.name.slice(0,2).toUpperCase())}</div>
      <div style="flex:1;min-width:0">
        <strong style="display:block;font-size:13.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.name)}</strong>
        <small style="font-size:11.5px;color:#737a6d">${c.ready} ready · ${c.review} review · ${c.unknown} to learn</small>
        <div style="height:6px;border-radius:6px;background:#eef0e7;overflow:hidden;margin-top:5px"><span style="display:block;height:100%;width:${p}%;background:${co.bar};border-radius:6px"></span></div>
      </div>
      <div style="font:600 13px 'DM Mono',monospace;color:#737a6d">${p}%</div>
    </div>`;
  }).join('');
  const block3 = state.subjects.length ? `
    <section class="card panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div><div style="font:600 15px 'Space Grotesk',sans-serif">Subjects progress</div><div style="font-size:11.5px;color:#737a6d;margin-top:3px">A quick pulse across the semester</div></div>
        <button class="text-link" data-view="syllabus" style="background:none;border:0;color:#d84f32;font-size:12.5px;font-weight:600;cursor:pointer">All →</button>
      </div>
      <div>${subjectRows}</div>
    </section>` : '';

  // Block 4: One warning slot (only if needed)
  const block4 = (() => {
    const planned = plan.tasks.reduce((a, t) => a + t.minutes, 0);
    if (planned > budget - today + 30)
      return `<div style="display:flex;gap:12px;padding:14px 16px;border-radius:18px;background:#fff1c9;color:#9a6b0b;font-size:13px;line-height:1.55;border:1px solid #f0d68a">
        <div><strong style="display:block;color:#9a6b0b">Overbooked by ~${fmtDuration(planned - (budget - today))}.</strong>Do the first two tasks, let the rest roll to tomorrow.</div>
      </div>`;
    const due = dueTopics().length;
    if (due > 0)
      return `<div style="display:flex;gap:12px;padding:14px 16px;border-radius:18px;background:#fff1c9;color:#9a6b0b;font-size:13px;line-height:1.55;border:1px solid #f0d68a">
        <div><strong style="display:block;color:#9a6b0b">${due} review${due === 1 ? '' : 's'} due.</strong>A quick pass keeps them ready.</div>
      </div>`;
    return '';
  })();

  return `${block1}${block2}${block3}${block4}`;
}

/* ---------- Syllabus (kept, with note badge) ---------------------------- */
function viewSyllabus() {
  if (openSubjectId) { const s = findSubject(openSubjectId); if (s) return viewSubjectDetail(s); openSubjectId = null; }
  const tiles = state.subjects.filter(s => !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase())).map(s => {
    const c = statusCount(s.id); const p = subjectPct(s); const co = COLORS[(s.color || 0) % COLORS.length];
    const n = noteCountFor(s);
    return `<button class="tile" data-action="open-subject-detail" data-id="${s.id}" style="position:relative;text-align:left;width:100%;padding:16px;border-radius:20px;background:#fffefa;border:1px solid #e5e7dd;box-shadow:0 9px 24px rgba(35,42,31,.075);cursor:pointer;display:flex;gap:14px;align-items:center">
      <span style="--p:${p};--c:${co.bar};position:relative;width:60px;height:60px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(${co.bar} calc(${p}*1%),#eef0e7 0);flex:none">
        <span style="position:absolute;inset:6px;border-radius:50%;background:#fffefa"></span>
        <b style="position:relative;font:700 13px 'Space Grotesk',sans-serif">${p}%</b>
      </span>
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
        <strong style="font:700 16px 'Space Grotesk',sans-serif;overflow-wrap:anywhere">${esc(s.name)}</strong>
        <small style="font-size:11.5px;color:#737a6d">${s.units.length} units · ${c.total} topics</small>
        <span style="display:block;height:6px;border-radius:6px;background:#eef0e7;overflow:hidden;margin-top:4px"><i style="display:block;height:100%;width:${p}%;background:${co.bar};border-radius:6px"></i></span>
        <span style="display:flex;flex-wrap:wrap;gap:5px;margin-top:4px">
          <em style="font-style:normal;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;background:#fbe4dc;color:#b83b24">${c.unknown} to learn</em>
          <em style="font-style:normal;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;background:#fff1c9;color:#9a6b0b">${c.review} review</em>
          <em style="font-style:normal;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;background:#e2f2e6;color:#2f7d4f">${c.ready} ready</em>
        </span>
      </span>
      ${n ? `<span style="position:absolute;top:10px;right:10px;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:999px;background:#eef5c9;color:#63761a;font-size:11px;font-weight:700">${I.note.replace('width="22"','width="12" height="12"')} ${n}</span>` : ''}
    </button>`;
  }).join('');
  return `
    <div class="page-heading">
      <div>
        <div class="eyebrow">THE WHOLE SEMESTER</div>
        <h1 tabindex="-1">Your syllabus, organized.</h1>
        <p>Every topic keeps its read history across mids, finals, and the rest of the semester.</p>
      </div>
      <div class="heading-actions">
        <button class="btn btn-outline" data-action="open-import-syllabus">Import full syllabus</button>
        <button class="btn btn-primary" data-action="open-subject">+ Add subject</button>
      </div>
    </div>
    <div class="toolbar" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <label class="searchbox" style="position:relative;flex:1;min-width:200px">
        <span style="position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#9aa094">⌕</span>
        <input id="syllabusSearch" aria-label="Search" placeholder="Find a subject or topic…" value="${esc(searchQuery)}" style="width:100%;min-height:44px;padding:10px 12px 10px 34px;border:1px solid #e5e7dd;border-radius:12px;background:#fffefa;font-size:14px">
      </label>
      <select class="select" id="syllabusFilter" aria-label="Filter by status" style="min-height:44px;padding:10px 12px;border:1px solid #e5e7dd;border-radius:12px;background:#fffefa">
        <option value="">All topics</option>
        <option value="unknown" ${syllabusFilter === 'unknown' ? 'selected' : ''}>Need to learn</option>
        <option value="review" ${syllabusFilter === 'review' ? 'selected' : ''}>In review</option>
        <option value="ready" ${syllabusFilter === 'ready' ? 'selected' : ''}>Ready</option>
      </select>
    </div>
    ${state.subjects.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">${tiles}</div>`
      : `<div class="card panel"><div class="empty-state"><div class="empty-icon">▤</div><h3>Start with what you need to study</h3><p>Add units and topics by hand, paste syllabus text, upload a PDF, or use your AI key to split a syllabus into units.</p><button class="btn btn-primary btn-small" data-action="open-subject">+ Add subject</button></div></div>`}
  `;
}
function viewSubjectDetail(s) {
  const c = statusCount(s.id);
  const co = COLORS[(s.color || 0) % COLORS.length];
  const p = subjectPct(s);
  const nCount = noteCountFor(s);
  const units = s.units.map(u => {
    const n = u.topics.length, rdy = u.topics.filter(t => t.status === 'ready').length;
    const up = n ? Math.round(rdy / n * 100) : 0;
    return `<details class="unit-acc">
      <summary>
        <span class="ua-main">
          <strong>${esc(u.name)}</strong>
          <small>${n} topics · ${rdy} ready · ${u.topics.reduce((a,t)=>a+(t.reads||0),0)} reads</small>
          <span style="display:block;height:6px;border-radius:6px;background:#eef0e7;overflow:hidden;margin-top:5px"><i style="display:block;height:100%;width:${up}%;background:${co.bar};border-radius:6px"></i></span>
        </span>
        <span class="ua-pct">${up}%</span>
        <span class="ua-chev">${I.chev}</span>
      </summary>
      <div class="ua-body">
        ${u.topics.map(t => {
          const rel = notesForTopic(t.id).slice(0, 3);
          return `<div class="topic-row" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid #eef0e7">
            <span style="flex:1;min-width:180px;font-weight:600;font-size:13.5px">${esc(t.name)}</span>
            <span style="font-size:11.5px;color:#737a6d">${t.reads || 0} reads</span>
            <select data-action="topic-status" data-id="${t.id}" style="min-height:34px;padding:5px 8px;border:1px solid #e5e7dd;border-radius:9px;background:#fffefa;font-size:11.5px">
              <option value="unknown" ${t.status === 'unknown' ? 'selected' : ''}>To learn</option>
              <option value="review" ${t.status === 'review' ? 'selected' : ''}>Review</option>
              <option value="ready" ${t.status === 'ready' ? 'selected' : ''}>Ready</option>
            </select>
            <button class="mini-btn" data-action="start-topic" data-id="${t.id}" aria-label="Start" style="width:34px;height:34px;border-radius:10px;border:1px solid #e5e7dd;background:#fffefa;display:grid;place-items:center;color:#d84f32;cursor:pointer">${I.play.replace('width="22"','width="15" height="15"')}</button>
            <button class="mini-btn" data-action="add-note" data-type="topic" data-id="${t.id}" aria-label="Add note" style="width:34px;height:34px;border-radius:10px;border:1px solid #e5e7dd;background:#fffefa;display:grid;place-items:center;color:#d84f32;cursor:pointer">${I.note.replace('width="22"','width="15" height="15"')}</button>
            <button class="mini-btn" data-action="practice-topic" data-id="${t.id}" aria-label="Practice" style="width:34px;height:34px;border-radius:10px;border:1px solid #e5e7dd;background:#fffefa;display:grid;place-items:center;color:#d84f32;cursor:pointer">${I.question.replace('width="22"','width="15" height="15"')}</button>
            ${rel.length ? `<span style="flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:11.5px;color:#737a6d">Related: ${rel.map(n => `<span style="padding:3px 8px;border-radius:999px;background:#eef5c9;color:#63761a;font-weight:600;cursor:pointer" data-action="open-note" data-id="${n.id}">${esc((n.body || '').slice(0, 30))}…</span>`).join('')}</span>` : ''}
          </div>`;
        }).join('')}
        <button class="mini-btn" style="width:auto;padding:0 14px;margin-top:8px" data-action="add-topic" data-id="${s.id}" data-unit="${u.id}">${I.plus.replace('width="22"','width="14" height="14"')} Add topic</button>
      </div>
    </details>`;
  }).join('');
  return `
    <button class="back-link" data-action="close-subject-detail">${I.chev.replace('m6 9 6 6 6-6','m15 18-6-6 6-6')} All subjects</button>
    <section class="subject-hero" style="border-left-color:${co.bar}">
      <div style="--p:${p};--c:${co.bar};position:relative;width:80px;height:80px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(${co.bar} calc(${p}*1%),#eef0e7 0);flex:none">
        <span style="position:absolute;inset:8px;border-radius:50%;background:#fffefa"></span>
        <b style="position:relative;font:700 16px 'Space Grotesk',sans-serif">${p}%</b>
      </div>
      <div style="flex:1;min-width:220px">
        <h1>${esc(s.name)}</h1>
        <p>${s.units.length} units · ${c.total} topics · ${c.reads} reads${nCount ? ` · ${nCount} note${nCount === 1 ? '' : 's'}` : ''}</p>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px">
          <em style="font-style:normal;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;background:#fbe4dc;color:#b83b24">${c.unknown} to learn</em>
          <em style="font-style:normal;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;background:#fff1c9;color:#9a6b0b">${c.review} review</em>
          <em style="font-style:normal;font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;background:#e2f2e6;color:#2f7d4f">${c.ready} ready</em>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline btn-small" data-action="add-note" data-type="subject" data-id="${s.id}">+ Note</button>
        <button class="btn btn-outline btn-small" data-action="add-topic" data-id="${s.id}">+ Topic</button>
        <button class="btn btn-outline btn-small" data-action="rename-subject" data-id="${s.id}">Edit</button>
        <button class="btn btn-danger btn-small" data-action="delete-subject" data-id="${s.id}" aria-label="Delete">×</button>
      </div>
    </section>
    <div>${units || '<div class="card panel"><div class="empty-state"><p>No units yet.</p></div></div>'}</div>
  `;
}

/* ---------- Library (new) ----------------------------------------------- */
function viewLibrary() {
  const tab = libraryTab;
  const tabsHtml = `
    <div class="tabs" role="tablist">
      <button class="tab ${tab === 'notes' ? 'active' : ''}" data-tab="notes" role="tab">Notes</button>
      <button class="tab ${tab === 'questions' ? 'active' : ''}" data-tab="questions" role="tab">Questions</button>
    </div>`;
  const tags = allTags();
  const toolbar = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <label style="position:relative;flex:1;min-width:200px">
        <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#9aa094">⌕</span>
        <input type="search" data-lib-search value="${esc(libraryFilter.q)}" placeholder="Search ${tab}…" style="width:100%;min-height:44px;padding:0 12px 0 36px;border:1px solid #e5e7dd;border-radius:12px;background:#fffefa;font-size:14px">
      </label>
      <select data-lib-tag style="min-height:44px;padding:0 12px;border:1px solid #e5e7dd;border-radius:12px;background:#fffefa;font-size:13px">
        <option value="">All tags</option>
        ${tags.map(t => `<option value="${esc(t)}" ${libraryFilter.tag === t ? 'selected' : ''}>#${esc(t)}</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-small" data-action="add-${tab === 'notes' ? 'note' : 'question'}">${I.plus.replace('width="22"','width="14" height="14"')} New</button>
    </div>`;

  if (tab === 'notes') {
    const notes = state.notes
      .filter(n => !libraryFilter.q || (n.body || '').toLowerCase().includes(libraryFilter.q.toLowerCase()))
      .filter(n => !libraryFilter.tag || (n.tags || []).includes(libraryFilter.tag))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return `
      <div class="page-heading">
        <div><div class="eyebrow">LIBRARY</div><h1 tabindex="-1">Notes & questions.</h1><p>Short notes attached to subjects, units or topics. Tags help you cross-cut.</p></div>
      </div>
      ${tabsHtml}${toolbar}
      ${notes.length ? notes.map(n => `
        <article class="note-card" data-action="open-note" data-id="${n.id}">
          <div class="body">${esc(n.body)}</div>
          <div class="meta">
            <span>${esc(describeAttach(n.attach))}</span>
            ${(n.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}
          </div>
        </article>`).join('')
        : `<div class="card panel"><div class="empty-state"><div class="empty-icon">${I.note.replace('width="22"','width="24" height="24"')}</div><h3>No notes yet</h3><p>Add a short note to any subject, unit or topic — it will show up here.</p><button class="btn btn-primary btn-small" data-action="add-note">+ New note</button></div></div>`}
    `;
  }
  // questions
  const qs = state.questions
    .filter(q => !libraryFilter.q || (q.question || '').toLowerCase().includes(libraryFilter.q.toLowerCase()))
    .filter(q => !libraryFilter.tag || (q.tags || []).includes(libraryFilter.tag))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const dueCount = qs.filter(q => !q.srs?.due || q.srs.due <= localDate()).length;
  const quizBody = quizState ? renderQuizBody() : `
    <div class="card panel" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap">
        <div><div style="font:600 15px 'Space Grotesk',sans-serif">Quiz me</div><div style="font-size:11.5px;color:#737a6d;margin-top:3px">${dueCount} of ${qs.length} ready to review</div></div>
        <button class="btn btn-primary btn-small" data-action="quiz-start" ${qs.length ? '' : 'disabled'}>${I.play.replace('width="22"','width="14" height="14"')} Start quiz</button>
      </div>
      <p style="font-size:12.5px;color:#737a6d;margin:0">One question at a time. Mark Got it or Again — wrong ones come back sooner.</p>
    </div>`;
  return `
    <div class="page-heading">
      <div><div class="eyebrow">LIBRARY</div><h1 tabindex="-1">Notes & questions.</h1><p>Practice with your own question bank — or save AI-generated practice questions.</p></div>
    </div>
    ${tabsHtml}${toolbar}
    <div class="quiz-wrap">${quizBody}</div>
    ${qs.length ? `<div style="margin-top:16px">${qs.map(q => `
      <article class="q-card">
        <div class="q">${esc(q.question)}</div>
        <div class="a">${esc(q.answer || '')}</div>
        <div class="meta">
          ${q.source === 'ai' ? '<span style="padding:2px 8px;border-radius:999px;background:#fbe4dc;color:#b83b24;font-weight:600">AI</span>' : ''}
          ${q.srs?.due ? `<span style="padding:2px 8px;border-radius:999px;background:#eef0e7;color:#737a6d">Due ${fmtDate(q.srs.due)}</span>` : ''}
          ${(q.tags || []).map(t => `<span style="padding:2px 8px;border-radius:999px;background:#eef5c9;color:#63761a;font-weight:600">#${esc(t)}</span>`).join('')}
          <button style="margin-left:auto;background:none;border:0;color:#d84f32;font-size:12.5px;font-weight:600;cursor:pointer" data-action="delete-question" data-id="${q.id}">Delete</button>
        </div>
      </article>`).join('')}</div>` : (qs.length === 0 && !quizState ? `<div class="card panel" style="margin-top:14px"><div class="empty-state"><div class="empty-icon">${I.question.replace('width="22"','width="24" height="24"')}</div><h3>No questions yet</h3><p>Write your own with an answer, or generate practice questions for a topic.</p><button class="btn btn-primary btn-small" data-action="add-question">+ New question</button></div></div>` : '')}
  `;
}
function renderQuizBody() {
  if (!quizState) return '';
  const { queue, index, revealed, correct, total } = quizState;
  if (index >= queue.length) {
    return `<div class="card panel"><div class="empty-state"><div class="empty-icon">${I.check}</div><h3>Done · ${correct} of ${total}</h3><p>${correct === total ? 'Perfect run.' : 'The ones you missed will come back sooner.'}</p><button class="btn btn-primary btn-small" data-action="quiz-close">Finish</button></div></div>`;
  }
  const q = queue[index];
  const pct = Math.round(index / total * 100);
  return `
    <article class="quiz-card">
      <div class="quiz-meta"><span>Question ${index + 1} of ${total}</span><span>${correct} correct</span></div>
      <div class="quiz-progress"><span style="width:${pct}%"></span></div>
      <div class="q">${esc(q.question)}</div>
      ${revealed ? `<div class="a">${esc(q.answer || '')}</div>` : ''}
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        ${!revealed
          ? `<button class="btn btn-primary" data-action="quiz-show">Show answer</button>`
          : `<button class="btn btn-outline" data-action="quiz-again">Again</button>
             <button class="btn btn-primary" data-action="quiz-got">Got it</button>`}
      </div>
    </article>`;
}
function startQuiz() {
  const pool = state.questions.slice();
  if (!pool.length) return toast('Add questions first.', 'error');
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  quizState = { queue: pool, index: 0, revealed: false, correct: 0, total: pool.length };
  render();
}
function answerQuiz(ok) {
  if (!quizState) return;
  const q = quizState.queue[quizState.index];
  const ref = state.questions.find(x => x.id === q.id);
  if (ref) {
    ref.srs = ref.srs || { step: 0, due: localDate() };
    if (ok) { ref.srs.step = Math.min((ref.srs.step || 0) + 1, 6); ref.srs.due = localDate(new Date(Date.now() + [1,2,4,8,16,32,64][ref.srs.step] * 86400000)); quizState.correct++; }
    else { ref.srs.step = 0; ref.srs.due = localDate(new Date(Date.now() + 86400000)); }
    persist();
  }
  quizState.index++; quizState.revealed = false; render();
}

/* ---------- Exams / Insights / Settings / Help (kept) ------------------- */
function viewExams() {
  const ex = [...state.exams].sort((a, b) => a.date.localeCompare(b.date));
  return `
    <div class="page-heading">
      <div><div class="eyebrow">CHECKPOINTS</div><h1 tabindex="-1">Exams & deadlines.</h1><p>Link topics to each exam. Past checkpoints keep their history.</p></div>
      <div class="heading-actions"><button class="btn btn-primary" data-action="open-exam">+ Add exam</button></div>
    </div>
    ${ex.length ? ex.map(e => {
      const d = parseDate(e.date);
      const topics = (e.topicIds || []).map(findTopic).filter(Boolean);
      const ready = topics.filter(x => x.topic.status === 'ready').length;
      const pct = topics.length ? Math.round(ready / topics.length * 100) : 0;
      const days = Math.max(0, daysBetween(new Date(), d));
      const past = daysBetween(new Date(), d) < 0;
      return `<article class="card" style="padding:16px;margin-bottom:10px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">
        <div style="width:56px;height:60px;border-radius:14px;background:#fbe4dc;color:#b83b24;display:flex;flex-direction:column;align-items:center;justify-content:center;flex:none">
          <strong style="font:700 20px 'Space Grotesk',sans-serif">${d.getDate()}</strong>
          <span style="font-size:10px;letter-spacing:.8px">${d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</span>
        </div>
        <div style="flex:1;min-width:200px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <strong style="font:600 15px 'Space Grotesk',sans-serif">${esc(e.name)}</strong>
            <span style="padding:3px 9px;border-radius:999px;background:${past ? '#eef0e7' : '#fbe4dc'};color:${past ? '#737a6d' : '#b83b24'};font-size:11.5px;font-weight:600">${past ? 'passed' : `${days}d left`}</span>
          </div>
          <div style="color:#737a6d;font-size:12px;margin-top:4px">${fmtDate(e.date, { weekday: 'short', month: 'long', day: 'numeric' })} · ${topics.length} topics · ${pct}% ready</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-outline btn-small" data-action="edit-exam" data-id="${e.id}">Edit</button>
          <button class="btn btn-danger btn-small" data-action="delete-exam" data-id="${e.id}">Remove</button>
        </div>
      </article>`;
    }).join('') : `<div class="card panel"><div class="empty-state"><div class="empty-icon">${I.exam.replace('width="22"','width="24" height="24"')}</div><h3>No exams yet</h3><p>Add a checkpoint date and select the units it covers.</p><button class="btn btn-primary btn-small" data-action="open-exam">+ Add exam</button></div></div>`}
  `;
}
function viewMetrics() {
  const total = statusCount(); const mins = weeklyMinutes(); const streak = getStreak(); const reads = total.reads;
  const days = Array.from({ length: 84 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 83 + i); const ds = localDate(d); const m = state.sessions.filter(s => localDate(new Date(s.startAt)) === ds).reduce((a, s) => a + s.minutes, 0); return { d, m }; });
  const max = Math.max(60, ...days.map(x => x.m));
  const heat = days.map(x => `<div style="aspect-ratio:1;border-radius:4px;background:${x.m ? `hsl(14, ${Math.min(80, 30 + x.m)}%, ${Math.max(40, 70 - x.m / max * 30)}%)` : '#eef0e7'}" title="${fmtDate(localDate(x.d))}: ${x.m ? fmtDuration(x.m) : 'no study'}"></div>`).join('');
  return `
    <div class="page-heading"><div><div class="eyebrow">INSIGHTS</div><h1 tabindex="-1">Effort, made visible.</h1><p>Numbers come from your local sessions.</p></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
      <div class="card panel"><div style="font-size:11.5px;color:#737a6d">Topic reads</div><div style="font:700 28px 'Space Grotesk',sans-serif">${reads}</div><div style="color:#737a6d;font-size:12px">across all subjects</div></div>
      <div class="card panel"><div style="font-size:11.5px;color:#737a6d">Streak</div><div style="font:700 28px 'Space Grotesk',sans-serif">${streak}d</div><div style="color:#737a6d;font-size:12px">consecutive days</div></div>
      <div class="card panel"><div style="font-size:11.5px;color:#737a6d">Focus time · 7 days</div><div style="font:700 28px 'Space Grotesk',sans-serif">${(mins/60).toFixed(1)}h</div><div style="color:#737a6d;font-size:12px">${state.sessions.length} sessions</div></div>
      <div class="card panel"><div style="font-size:11.5px;color:#737a6d">Reviews due</div><div style="font:700 28px 'Space Grotesk',sans-serif">${dueTopics().length}</div><div style="color:#737a6d;font-size:12px">ready topics to revisit</div></div>
    </div>
    <div class="card panel" style="margin-top:14px">
      <div style="font:600 15px 'Space Grotesk',sans-serif;margin-bottom:10px">Study rhythm · 12 weeks</div>
      <div style="display:grid;grid-template-columns:repeat(14,1fr);gap:4px">${heat}</div>
    </div>
  `;
}
function viewHelp() {
  return `
    <div class="page-heading"><div><div class="eyebrow">HELP</div><h1 tabindex="-1">How ExamFlow works.</h1><p>A simple loop: syllabus → exams → daily plan → timer.</p></div></div>
    <div class="card panel">
      <div style="font:600 15px 'Space Grotesk',sans-serif;margin-bottom:10px">The loop</div>
      <ol style="padding-left:18px;line-height:1.85;font-size:13.5px;margin:0">
        <li><strong>Add your subjects and topics.</strong> One per line, or paste a unit heading.</li>
        <li><strong>Add exam dates.</strong> Select the units each exam covers.</li>
        <li><strong>Follow the plan.</strong> One next move, ordered by urgency and pace.</li>
        <li><strong>Use the timer.</strong> Finishing a session logs one read on the topic.</li>
      </ol>
    </div>
    <div class="card panel" style="margin-top:14px">
      <div style="font:600 15px 'Space Grotesk',sans-serif;margin-bottom:8px">Notes & questions</div>
      <p style="font-size:13px;line-height:1.7;color:#737a6d;margin:0">Notes attach to a subject, unit or topic. Question bank supports manual questions and AI-generated practice. Quiz uses simple spaced repetition.</p>
    </div>
  `;
}
function viewSettings() {
  const last = state.settings.lastBackup;
  const days = last ? daysBetween(parseDate(last), new Date()) : null;
  const backupHint = !last ? 'No backup yet' : days === 0 ? 'Backed up today' : `Last backup ${days} day${days === 1 ? '' : 's'} ago`;
  const needsBackup = !last || days >= 7;
  return `
    <div class="page-heading"><div><div class="eyebrow">SETTINGS</div><h1 tabindex="-1">Your study, your rules.</h1><p>Everything is stored on this device.</p></div></div>

    ${needsBackup ? `<div style="display:flex;gap:12px;padding:14px 16px;border-radius:18px;background:#fff1c9;color:#9a6b0b;font-size:13px;line-height:1.55;border:1px solid #f0d68a;margin-bottom:14px">
      <div><strong style="display:block;color:#9a6b0b">${backupHint}.</strong>Export a backup to keep your semester safe.</div>
    </div>` : ''}

    <div class="card panel" style="margin-bottom:14px">
      <div style="font:600 15px 'Space Grotesk',sans-serif;margin-bottom:12px">Study goals</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        <label for="dailyHours" style="font-size:12.5px;font-weight:600">Daily target (hours)</label>
        <input id="dailyHours" type="number" min="0.5" max="16" step="0.5" value="${Number(state.settings.dailyHours)}" style="min-height:44px;padding:10px 12px;border:1px solid #e5e7dd;border-radius:12px;background:#fffefa;font-size:15px">
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        <label for="targetMinutes" style="font-size:12.5px;font-weight:600">Default timer target (minutes, optional)</label>
        <input id="targetMinutes" type="number" min="0" max="240" step="5" value="${state.settings.targetMinutes || ''}" placeholder="No target" style="min-height:44px;padding:10px 12px;border:1px solid #e5e7dd;border-radius:12px;background:#fffefa;font-size:15px">
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
        <label for="readGoal" style="font-size:12.5px;font-weight:600">Reads per topic goal</label>
        <input id="readGoal" type="number" min="1" max="20" step="1" value="${Number(state.settings.readGoal)}" style="min-height:44px;padding:10px 12px;border:1px solid #e5e7dd;border-radius:12px;background:#fffefa;font-size:15px">
      </div>
      <button class="btn btn-primary btn-small" data-action="save-settings">Save goals</button>
    </div>

    <div class="card panel" style="margin-bottom:14px">
      <div style="font:600 15px 'Space Grotesk',sans-serif;margin-bottom:12px">Backup</div>
      <p style="font-size:12.5px;color:#737a6d;margin:0 0 12px">${backupHint}. Notes and questions are included.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-small" data-action="export-data">Export all data</button>
        <button class="btn btn-outline btn-small" data-action="import-data">Import backup</button>
        <input id="backupFile" type="file" accept=".json,application/json" hidden>
      </div>
    </div>

    <div class="card panel" style="margin-bottom:14px">
      <div style="font:600 15px 'Space Grotesk',sans-serif;margin-bottom:12px">Motion</div>
      <label style="display:flex;align-items:center;gap:10px;font-size:13px;margin-bottom:12px">
        <input type="checkbox" data-action="toggle-motion" ${state.settings.reduceMotion ? 'checked' : ''}>
        <span>Reduce motion (no slime, just fades)</span>
      </label>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        <div style="font-size:12.5px;font-weight:600">Rail side</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-small ${state.settings.railSide === 'left' ? 'btn-primary' : 'btn-outline'}" data-action="rail-side" data-side="left">Left</button>
          <button class="btn btn-small ${state.settings.railSide === 'right' ? 'btn-primary' : 'btn-outline'}" data-action="rail-side" data-side="right">Right</button>
        </div>
      </div>
    </div>

    <div class="card panel">
      <div style="font:600 15px 'Space Grotesk',sans-serif;margin-bottom:12px">Semester</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        <label for="semesterName" style="font-size:12.5px;font-weight:600">Semester label</label>
        <input id="semesterName" value="${esc(state.semesterName)}" maxlength="48" style="min-height:44px;padding:10px 12px;border:1px solid #e5e7dd;border-radius:12px;background:#fffefa;font-size:15px">
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-outline btn-small" data-action="rename-semester">Save label</button>
        <button class="btn btn-danger btn-small" data-action="end-semester">End semester</button>
      </div>
    </div>
  `;
}

/* ---------- Views mapping ---------------------------------------------- */
function render() {
  setPageHeader();
  renderRail();
  renderDock();
  const root = document.getElementById('app');
  const body = ({
    dashboard: viewDashboard, syllabus: viewSyllabus, plan: viewPlan, library: viewLibrary,
    exams: viewExams, metrics: viewMetrics, settings: viewSettings, help: viewHelp,
  }[view] || viewDashboard)();
  root.innerHTML = body;
}

/* ---------- Plan view (kept) ------------------------------------------- */
function viewPlan() {
  const plan = makePlan();
  const dates = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return localDate(d); });
  const running = state.timer ? findTopic(state.timer.topicId) : null;
  const tasks = plan.tasks.map((t, i) => `<div class="task-row" style="display:flex;align-items:center;gap:12px;padding:13px 0;border-top:1px solid #eef0e7;flex-wrap:wrap">
    <span style="font:600 12px 'DM Mono',monospace;color:#737a6d;min-width:50px">${String(9 + Math.floor(t.startMinute / 60)).padStart(2, '0')}:${String(t.startMinute % 60).padStart(2, '0')}</span>
    <span style="width:8px;height:8px;border-radius:50%;background:${COLORS[t.color % COLORS.length].bar};flex:none"></span>
    <div style="flex:1;min-width:0">
      <strong style="display:block;font-size:13.5px;overflow:hidden;text-overflow:ellipsis">${esc(t.subject)} → ${esc(t.name)}</strong>
      <small style="color:#737a6d;font-size:11.5px">${esc(t.unit)} · ${t.isDue ? 'Review due' : t.exam ? `${t.days}d until ${esc(t.exam.name)}` : 'Foundations'}</small>
    </div>
    <span style="font:600 12px 'DM Mono',monospace;color:#b83b24;white-space:nowrap">${fmtDuration(t.minutes)}</span>
    <button class="btn btn-soft btn-small" data-action="start-topic" data-id="${t.id}">Start</button>
  </div>`).join('');
  return `
    <div class="page-heading">
      <div><div class="eyebrow">A PLAN THAT ADAPTS</div><h1 tabindex="-1">A clear next step, each day.</h1><p>Your plan follows exam dates, topic confidence, revision due dates, and the time you have today.</p></div>
      <div class="heading-actions">
        <button class="btn btn-outline" data-action="add-session">+ Log session</button>
      </div>
    </div>
    ${plan.risk ? `<div style="display:flex;gap:12px;padding:14px 16px;border-radius:18px;background:#fff1c9;color:#9a6b0b;font-size:13px;line-height:1.55;border:1px solid #f0d68a;margin-bottom:14px"><div><strong style="display:block;color:#9a6b0b">Potential pace warning for ${esc(plan.next.name)}.</strong>About ${fmtDuration(plan.remaining)} remains for ${plan.daysLeft} days.</div></div>` : ''}
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 16px;border-radius:18px;background:#20231f;color:#fff;margin-bottom:14px">
      <label for="todayHours" style="font-size:13px;font-weight:600;color:#e5ecdc">Today I have</label>
      <input id="todayHours" type="number" min="0.5" max="16" step="0.5" value="${Number(state.settings.todayHours ?? state.settings.dailyHours)}" style="width:74px;min-height:40px;padding:0 12px;border:0;border-radius:10px;background:#fff;font-size:13px">
      <span style="font-size:12px">hours</span>
      <label for="skipSubject" style="font-size:13px;font-weight:600;color:#e5ecdc">Skip</label>
      <select id="skipSubject" style="min-height:40px;padding:0 12px;border:0;border-radius:10px;background:#fff;font-size:13px">
        <option value="">No subject</option>
        ${state.subjects.map(s => `<option value="${s.id}" ${state.settings.skipToday?.includes(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
      <button class="btn btn-soft btn-small" data-action="replan" style="margin-left:auto">Rebalance</button>
    </div>
    <div class="card panel">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:12px;flex-wrap:wrap">
        <div><div style="font:600 15px 'Space Grotesk',sans-serif">Today's focus</div><div style="font-size:11.5px;color:#737a6d;margin-top:3px">${fmtDate(localDate(), { weekday: 'long', month: 'long', day: 'numeric' })} · ${fmtDuration(plan.used)} planned</div></div>
      </div>
      ${tasks || `<div class="empty-state"><h3>No study topics in today's plan</h3><p>Add topics or increase today's hours.</p></div>`}
    </div>
  `;
}

/* ---------- Modal helpers ---------------------------------------------- */
function openModal(title, subtitle, body, actions) {
  actions = actions || '<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="modal-save">Save</button>';
  if (!document.querySelector('#modalRoot [role="dialog"]')) modalReturnFocus = document.activeElement;
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" tabindex="-1"><div class="modal-head"><div><h2 id="modalTitle">${title}</h2><p>${subtitle}</p></div><button class="modal-close" data-action="close-modal" aria-label="Close">×</button></div><div class="modal-body">${body}</div><div class="modal-actions">${actions}</div></section></div>`;
  requestAnimationFrame(() => document.querySelector('#modalRoot [role="dialog"] button, #modalRoot [role="dialog"] input')?.focus());
}
function closeModal() { aiAbort?.abort?.(); document.getElementById('modalRoot').innerHTML = ''; if (modalReturnFocus?.isConnected) modalReturnFocus.focus(); modalReturnFocus = null; }

/* ---------- Toast ------------------------------------------------------ */
function toast(msg, type = '', undoFn = null, undoLabel = 'Undo') {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (undoFn) {
    const btn = document.createElement('button');
    btn.className = 'undo'; btn.textContent = undoLabel;
    btn.onclick = () => { undoFn(); el.remove(); };
    el.appendChild(btn);
  }
  root.appendChild(el);
  setTimeout(() => el.remove(), undoFn ? 6500 : 3400);
}

/* ---------- Notes & questions modals ----------------------------------- */
function showNoteModal(noteId = null, attach = null) {
  const n = noteId ? state.notes.find(x => x.id === noteId) : null;
  const initialAttach = n?.attach || attach || { type: 'subject', id: state.subjects[0]?.id || '' };
  const attachOptions = `
    <option value="">Choose…</option>
    ${state.subjects.map(s => `<optgroup label="${esc(s.name)}">
      <option value="subject:${s.id}" ${initialAttach.type === 'subject' && initialAttach.id === s.id ? 'selected' : ''}>Subject: ${esc(s.name)}</option>
      ${s.units.map(u => `<option value="unit:${u.id}" ${initialAttach.type === 'unit' && initialAttach.id === u.id ? 'selected' : ''}>Unit: ${esc(u.name)}</option>
        ${u.topics.map(t => `<option value="topic:${t.id}" ${initialAttach.type === 'topic' && initialAttach.id === t.id ? 'selected' : ''}>Topic: ${esc(t.name)}</option>`).join('')}`).join('')}
    </optgroup>`).join('')}`;
  openModal(n ? 'Edit note' : 'New note', 'Notes are short. Attach to a subject, unit or topic.', `
    <div class="field"><label for="noteAttach">Attach to</label>
      <select id="noteAttach">${attachOptions}</select>
    </div>
    <div class="field"><label for="noteBody">Note</label>
      <textarea id="noteBody" placeholder="A short idea, formula, or reminder…">${esc(n?.body || '')}</textarea>
    </div>
    <div class="field"><label for="noteTags">Tags <span class="muted" style="font-weight:400">· comma separated</span></label>
      <input id="noteTags" value="${esc((n?.tags || []).join(', '))}" placeholder="formula, weak-area">
    </div>
  `, `<button class="btn btn-outline" data-action="close-modal">Cancel</button>${n ? `<button class="btn btn-danger" data-action="delete-note" data-id="${n.id}">Delete</button>` : ''}<button class="btn btn-primary" data-action="save-note" data-id="${n?.id || ''}">Save note</button>`);
}
function showQuestionModal(qId = null) {
  const q = qId ? state.questions.find(x => x.id === qId) : null;
  openModal(q ? 'Edit question' : 'New question', 'Write the question and the answer. Optional tags.', `
    <div class="field"><label for="qText">Question</label>
      <textarea id="qText" placeholder="e.g. What is the time complexity of binary search?">${esc(q?.question || '')}</textarea>
    </div>
    <div class="field"><label for="qAnswer">Answer</label>
      <textarea id="qAnswer" placeholder="The answer you want to remember…">${esc(q?.answer || '')}</textarea>
    </div>
    <div class="field"><label for="qTags">Tags <span class="muted" style="font-weight:400">· comma separated</span></label>
      <input id="qTags" value="${esc((q?.tags || []).join(', '))}" placeholder="complexity, formula">
    </div>
  `, `<button class="btn btn-outline" data-action="close-modal">Cancel</button>${q ? `<button class="btn btn-danger" data-action="delete-question" data-id="${q.id}">Delete</button>` : ''}<button class="btn btn-primary" data-action="save-question" data-id="${q?.id || ''}">Save question</button>`);
}

/* ---------- Custom modals (subject, exam, topic, import) --------------- */
function showSubjectModal() {
  openModal('Add a subject', 'Add units and topics; you can edit them whenever you like.', `<form id="subjectForm">
    <div class="field"><label for="subjectName">Subject name</label><input id="subjectName" required maxlength="80" placeholder="e.g. Data Structures & Algorithms"></div>
    <div class="field"><label for="syllabusText">Syllabus input</label><textarea id="syllabusText" placeholder="One topic per line. Optional unit headings work too:&#10;Unit 1: Foundations&#10;Arrays&#10;Linked lists"></textarea>
      <span class="help">Lines like “Unit 1: Title” become units; other lines become topics.</span></div>
  </form>`, `<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-subject">Add subject</button>`);
}
function showExamModal(existing = null) {
  const e = existing || {};
  const chosen = e.topicIds || [];
  openModal(existing ? 'Edit exam' : 'Add exam', 'Pick the date and exact units covered.', `<form id="examForm">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label for="examName">Exam name</label><input id="examName" required maxlength="80" value="${esc(e.name || '')}" placeholder="Mid-1, Finals…"></div>
      <div class="field"><label for="examDate">Date</label><input id="examDate" type="date" required value="${esc(e.date || localDate(new Date(Date.now() + 7 * 86400000)))}"></div>
    </div>
    <fieldset class="field"><legend>Units covered</legend>
      <div style="max-height:220px;overflow:auto;border:1px solid #e5e7dd;border-radius:12px;padding:10px">
        ${state.subjects.map(s => `<div style="font-size:12px;font-weight:700;color:#63761a;padding:6px 2px 3px">${esc(s.name)}</div>${s.units.map(u => `<div style="padding:6px 4px"><label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" class="unit-check" data-subject="${s.id}" data-unit="${u.id}" ${u.topics.length && u.topics.every(t => chosen.includes(t.id)) ? 'checked' : ''}><strong>${esc(u.name)}</strong></label>${u.topics.map(t => `<label style="display:flex;align-items:center;gap:8px;padding:4px 0 4px 22px;font-size:12.5px"><input type="checkbox" name="topicIds" value="${t.id}" ${chosen.includes(t.id) ? 'checked' : ''}><span>${esc(t.name)}</span></label>`).join('')}</div>`).join('')}`).join('')}
      </div>
    </fieldset>
  </form>`, `<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-exam" data-id="${e.id || ''}">${existing ? 'Save' : 'Add exam'}</button>`);
}
function showTopicModal(subjectId, unitId = '') {
  const s = findSubject(subjectId); if (!s) return;
  openModal('Add a topic', `Add one topic to ${esc(s.name)}.`, `<form id="topicForm">
    <div class="field"><label for="topicUnit">Unit</label><select id="topicUnit">${s.units.map(u => `<option value="${u.id}" ${u.id === unitId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}<option value="__new__">+ Create a new unit…</option></select></div>
    <div class="field"><label for="newUnit">New unit name (optional)</label><input id="newUnit" placeholder="e.g. Unit 6 · Applications"></div>
    <div class="field"><label for="topicName">Topic name</label><input id="topicName" required maxlength="120" placeholder="e.g. Binary search trees"></div>
  </form>`, `<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-topic" data-id="${subjectId}">Add topic</button>`);
}
function showImportSyllabus() {
  openModal('Import syllabus', 'Paste the whole syllabus or use a single subject.', `<div class="field">
    <label for="bulkText">Syllabus text</label>
    <textarea id="bulkText" placeholder="Paste all pages here. Include course/subject names and unit headings."></textarea>
  </div>
  <div class="field"><label for="manualBulkName">Subject name</label><input id="manualBulkName" placeholder="e.g. Data Structures & Algorithms"></div>
  `, '<button class="btn btn-outline" data-action="close-modal">Close</button><button class="btn btn-primary" data-action="manual-bulk-syllabus">Import</button>');
}
function showSessionModal() {
  openModal('Log a session by hand', 'Add a study session manually.', `<form id="sessionForm">
    <div class="field"><label for="sessionTopic">Topic</label><select id="sessionTopic"><option value="">Choose…</option>${allTopics().map(t => `<option value="${t.id}">${esc(t.subject)} · ${esc(t.name)}</option>`).join('')}</select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="field"><label for="sessionMinutes">Minutes</label><input id="sessionMinutes" type="number" min="1" max="480" value="30"></div>
      <div class="field"><label for="sessionDate">Date</label><input id="sessionDate" type="date" value="${localDate()}"></div>
    </div>
  </form>`, `<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-session">Log session</button>`);
}
function showRareMenu() {
  const existing = document.querySelector('.rare-menu-panel');
  if (existing) { existing.remove(); document.querySelector('.rare-menu')?.setAttribute('aria-expanded', 'false'); return; }
  const panel = document.createElement('div');
  panel.className = 'rare-menu-panel';
  panel.innerHTML = `
    <button data-action="open-help">How it works</button>
    <button data-action="export-data">Export backup</button>
    <button data-action="import-data">Import backup</button>
    <button data-action="rename-semester">Rename semester</button>
    <button data-action="end-semester">End semester</button>
  `;
  document.body.appendChild(panel);
  document.querySelector('.rare-menu')?.setAttribute('aria-expanded', 'true');
  setTimeout(() => document.addEventListener('click', function onDoc(e) {
    if (!panel.contains(e.target) && !e.target.closest('.rare-menu')) {
      panel.remove(); document.removeEventListener('click', onDoc);
    }
  }), 0);
}

/* ---------- Actions dispatch ------------------------------------------- */
document.addEventListener('click', async event => {
  // nav
  const nav = event.target.closest('[data-view]');
  if (nav) { event.preventDefault(); view = nav.dataset.view; openSubjectId = null; render(); window.scrollTo(0, 0); return; }

  // dock
  const dockBtn = event.target.closest('[data-dock]');
  if (dockBtn) {
    const id = dockBtn.dataset.dock;
    if (id === 'more') { showMoreMenu(); return; }
    view = id; openSubjectId = null; render();
    return;
  }

  // rail
  const railBtn = event.target.closest('[data-rail]');
  if (railBtn) {
    const which = railBtn.dataset.rail;
    if (railState.open === which) { closeRail(); return; }
    railState.open = which;
    renderRail();
    return;
  }

  const el = event.target.closest('[data-action]'); if (!el) return;
  const action = el.dataset.action, id = el.dataset.id, type = el.dataset.type;

  // rail panel actions
  if (action === 'pause-timer') return pauseTimer();
  if (action === 'resume-timer') return resumeTimer();
  if (action === 'finish-timer') { closeRail(); return finishTimer(); }
  if (action === 'timer-start-picked') { const tid = document.querySelector('[data-action="timer-pick"]')?.value; if (!tid) return toast('Choose a topic', 'error'); closeRail(); return startTimer(tid); }
  if (action === 'rail-side') { state.settings.railSide = el.dataset.side; persist(); renderRail(); return; }
  if (action === 'toggle-motion') { state.settings.reduceMotion = !state.settings.reduceMotion; document.body.classList.toggle('reduce-motion', state.settings.reduceMotion); persist(); renderRail(); render(); return; }
  if (action === 'open-settings') { closeRail(); view = 'settings'; render(); return; }

  // main views
  if (action === 'close-modal') return closeModal();
  if (action === 'backdrop' && event.target === el) return closeModal();
  if (action === 'menu') { const s = document.getElementById('sidebar'); s?.classList.toggle('open'); return; }
  if (action === 'rare-menu') return showRareMenu();
  if (action === 'open-help') { view = 'help'; render(); return; }
  if (action === 'open-subject') return showSubjectModal();
  if (action === 'open-import-syllabus') return showImportSyllabus();
  if (action === 'open-subject-detail') { openSubjectId = id; view = 'syllabus'; render(); window.scrollTo(0, 0); return; }
  if (action === 'close-subject-detail') { openSubjectId = null; render(); return; }
  if (action === 'add-exam' || action === 'open-exam') return showExamModal();
  if (action === 'edit-exam') return showExamModal(state.exams.find(x => x.id === id));
  if (action === 'delete-exam') {
    const removed = state.exams.find(x => x.id === id);
    if (!removed) return;
    state.exams = state.exams.filter(x => x.id !== id); persist(); render();
    toast('Exam removed', '', () => { state.exams.push(removed); persist(); render(); });
    return;
  }
  if (action === 'delete-subject') {
    const removed = state.subjects.find(x => x.id === id); if (!removed) return;
    if (!confirm(`Delete ${removed.name}? Its topics and notes will be removed too.`)) return;
    const removedNotes = state.notes.filter(n => n.attach.type === 'subject' && n.attach.id === id || n.attach.type === 'unit' && removed.units.some(u => u.id === n.attach.id) || n.attach.type === 'topic' && removed.units.some(u => u.topics.some(t => t.id === n.attach.id)));
    state.subjects = state.subjects.filter(x => x.id !== id);
    state.notes = state.notes.filter(n => !removedNotes.includes(n));
    const tids = new Set(removed.units.flatMap(u => u.topics.map(t => t.id)));
    state.exams.forEach(e => e.topicIds = (e.topicIds || []).filter(t => !tids.has(t)));
    persist(); render();
    toast('Subject removed', '', () => { state.subjects.push(removed); state.notes.push(...removedNotes); persist(); render(); });
    return;
  }
  if (action === 'start-topic') return startTimer(id);
  if (action === 'add-topic') return showTopicModal(id, el.dataset.unit || '');
  if (action === 'add-note') return showNoteModal(null, { type, id });
  if (action === 'open-note') return showNoteModal(id);
  if (action === 'add-question') return showQuestionModal();
  if (action === 'delete-question') {
    const removed = state.questions.find(x => x.id === id); if (!removed) return;
    state.questions = state.questions.filter(x => x.id !== id); persist(); render();
    toast('Question deleted', '', () => { state.questions.push(removed); persist(); render(); });
    return;
  }
  if (action === 'practice-topic') {
    const f = findTopic(id); if (!f) return;
    openModal('Practice this topic', `${esc(f.subject.name)} · ${esc(f.topic.name)}`, `<p style="font-size:13.5px;line-height:1.7;color:#737a6d">Write your own question and answer. This goes into your Library question bank.</p>`, `<button class="btn btn-outline" data-action="close-modal">Close</button><button class="btn btn-primary" data-action="new-question-for-topic" data-id="${id}">+ New question</button>`);
    return;
  }
  if (action === 'new-question-for-topic') { closeModal(); return showQuestionModal(); }
  if (action === 'save-note') {
    const attachStr = document.getElementById('noteAttach').value;
    const body = document.getElementById('noteBody').value.trim();
    const tags = document.getElementById('noteTags').value.split(',').map(x => x.trim()).filter(Boolean);
    if (!body) return toast('Note body is empty.', 'error');
    const [t, aid] = attachStr.split(':');
    if (!t || !aid) return toast('Choose what to attach to.', 'error');
    if (id) { const ref = state.notes.find(x => x.id === id); Object.assign(ref, { attach: { type: t, id: aid }, body, tags, updatedAt: new Date().toISOString() }); }
    else state.notes.push({ id: uid('note'), attach: { type: t, id: aid }, body, tags, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    persist(); closeModal(); render();
    toast('Note saved.', 'success');
    return;
  }
  if (action === 'delete-note') {
    const removed = state.notes.find(x => x.id === id); if (!removed) return;
    state.notes = state.notes.filter(x => x.id !== id); persist(); closeModal(); render();
    toast('Note deleted', '', () => { state.notes.push(removed); persist(); render(); });
    return;
  }
  if (action === 'save-question') {
    const question = document.getElementById('qText').value.trim();
    const answer = document.getElementById('qAnswer').value.trim();
    const tags = document.getElementById('qTags').value.split(',').map(x => x.trim()).filter(Boolean);
    if (!question) return toast('Question is empty.', 'error');
    if (id) { const ref = state.questions.find(x => x.id === id); Object.assign(ref, { question, answer, tags, updatedAt: new Date().toISOString() }); }
    else state.questions.push({ id: uid('q'), question, answer, tags, source: 'manual', createdAt: new Date().toISOString(), srs: { step: 0, due: localDate() } });
    persist(); closeModal(); render();
    toast('Question saved.', 'success');
    return;
  }
  if (action === 'quiz-start') return startQuiz();
  if (action === 'quiz-show') { quizState.revealed = true; render(); return; }
  if (action === 'quiz-got') return answerQuiz(true);
  if (action === 'quiz-again') return answerQuiz(false);
  if (action === 'quiz-close') { quizState = null; render(); return; }
  if (action === 'goto-library-questions') { view = 'library'; libraryTab = 'questions'; closeSearchSheet(); render(); return; }
  if (action === 'open-exams') { view = 'exams'; closeSearchSheet(); render(); return; }
  if (action === 'export-data') {
    const data = { ...state, settings: { ...state.settings, apiKey: '' }, timer: null, exportedAt: new Date().toISOString(), app: 'ExamFlow' };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `examflow-backup-${localDate()}.json`; a.click(); URL.revokeObjectURL(a.href);
    state.settings.lastBackup = localDate(); persist(); render();
    toast('Backup downloaded.', 'success');
    return;
  }
  if (action === 'import-data') { document.getElementById('backupFile')?.click(); return; }
  if (action === 'end-semester') {
    if (!confirm('End this semester and clear all data? This cannot be undone.')) return;
    state = blankState(); persist(); view = 'dashboard'; render();
    toast('New semester started.', 'success');
    return;
  }
  if (action === 'add-session') return showSessionModal();
  if (action === 'save-session') {
    const tid = document.getElementById('sessionTopic').value;
    const min = Number(document.getElementById('sessionMinutes').value);
    const date = document.getElementById('sessionDate').value;
    if (!tid) return toast('Choose a topic.', 'error');
    if (!(min > 0)) return toast('Minutes must be positive.', 'error');
    const startAt = new Date(`${date}T09:00:00`).toISOString();
    logSession(tid, min, startAt);
    closeModal(); render();
    toast('Session logged.', 'success');
    return;
  }
  if (action === 'save-settings') {
    const dh = Number(document.getElementById('dailyHours')?.value);
    const tm = Number(document.getElementById('targetMinutes')?.value) || null;
    const rg = Number(document.getElementById('readGoal')?.value);
    if (dh > 0) state.settings.dailyHours = Math.min(16, dh);
    state.settings.targetMinutes = tm;
    if (rg > 0) state.settings.readGoal = Math.min(20, rg);
    persist(); render();
    toast('Settings saved.', 'success');
    return;
  }
  if (action === 'rename-semester') {
    const input = document.getElementById('semesterName');
    if (input) { const s = input.value.trim(); if (s) { state.semesterName = s; persist(); render(); toast('Semester label saved.'); } return; }
    const s = prompt('Semester label', state.semesterName);
    if (s?.trim()) { state.semesterName = s.trim(); persist(); render(); }
    return;
  }
  if (action === 'replan') {
    const val = Number(document.getElementById('todayHours')?.value);
    if (val > 0) state.settings.todayHours = Math.min(16, val);
    const sid = document.getElementById('skipSubject')?.value;
    state.settings.skipToday = sid ? [sid] : [];
    state.settings.todayPlanDate = localDate();
    persist(); render();
    toast('Today\u2019s plan rebalanced.', 'success');
    return;
  }
  if (action === 'manual-bulk-syllabus') {
    const name = document.getElementById('manualBulkName').value.trim();
    const text = document.getElementById('bulkText').value.trim();
    if (!name || !text) return toast('Name and text are required.', 'error');
    const units = parseSyllabus(text);
    if (!units.length) return toast('No topics found.', 'error');
    const s = { id: uid('sub'), name, color: state.subjects.length % COLORS.length, units: units.map(u => ({ id: uid('unit'), name: u.name, topics: u.topics.map(n => ({ id: uid('topic'), name: n, status: 'unknown', reads: 0, readHistory: [], lastReadAt: null, nextReviewAt: null, reviewStep: 0, estimateMin: 45, priority: 1 })) })) };
    state.subjects.push(s); persist(); closeModal(); view = 'syllabus'; render();
    toast(`Added ${name}.`, 'success');
    return;
  }
  if (action === 'save-subject') {
    const name = document.getElementById('subjectName').value.trim();
    const text = document.getElementById('syllabusText').value;
    if (!name) return toast('Name is required.', 'error');
    const units = parseSyllabus(text);
    if (!units.length) units.push({ name: 'Unit 1', topics: [] });
    const s = { id: uid('sub'), name, color: state.subjects.length % COLORS.length, units: units.map(u => ({ id: uid('unit'), name: u.name, topics: u.topics.map(n => ({ id: uid('topic'), name: n, status: 'unknown', reads: 0, readHistory: [], lastReadAt: null, nextReviewAt: null, reviewStep: 0, estimateMin: 45, priority: 1 })) })) };
    state.subjects.push(s); persist(); closeModal(); view = 'syllabus'; render();
    toast(`${name} added.`, 'success');
    return;
  }
  if (action === 'save-topic') {
    const s = findSubject(id); if (!s) return;
    const unitId = document.getElementById('topicUnit').value;
    const newUnit = document.getElementById('newUnit').value.trim();
    const topicName = document.getElementById('topicName').value.trim();
    if (!topicName) return toast('Topic name is required.', 'error');
    let unit = s.units.find(u => u.id === unitId);
    if (unitId === '__new__' || newUnit) {
      const nm = newUnit || `Unit ${s.units.length + 1}`;
      unit = s.units.find(u => normalizeKey(u.name) === normalizeKey(nm));
      if (!unit) { unit = { id: uid('unit'), name: nm, topics: [] }; s.units.push(unit); }
    }
    if (!unit) return toast('Choose a unit.', 'error');
    unit.topics.push({ id: uid('topic'), name: topicName, status: 'unknown', reads: 0, readHistory: [], lastReadAt: null, nextReviewAt: null, reviewStep: 0, estimateMin: 45, priority: 1 });
    persist(); closeModal(); render();
    toast('Topic added.', 'success');
    return;
  }
  if (action === 'save-exam') {
    const name = document.getElementById('examName').value.trim();
    const date = document.getElementById('examDate').value;
    const topicIds = [...document.querySelectorAll('input[name="topicIds"]:checked')].map(x => x.value);
    if (!name || !date) return toast('Name and date required.', 'error');
    if (id) { const ref = state.exams.find(x => x.id === id); Object.assign(ref, { name, date, topicIds }); }
    else state.exams.push({ id: uid('exam'), name, date, topicIds, createdAt: new Date().toISOString() });
    persist(); closeModal(); render();
    toast('Exam saved.', 'success');
    return;
  }
  if (action === 'topic-status') { markStatus(el.dataset.id, el.value); render(); return; }
  if (action === 'close-sheet') return closeSearchSheet();
});

/* ---------- Change/input handlers -------------------------------------- */
document.addEventListener('change', event => {
  const el = event.target;
  if (el.matches('[data-action="topic-status"]')) { markStatus(el.dataset.id, el.value); render(); return; }
  if (el.matches('[data-action="toggle-motion"]')) { state.settings.reduceMotion = el.checked; document.body.classList.toggle('reduce-motion', el.checked); persist(); return; }
  if (el.matches('[data-action="timer-target"]')) { if (state.timer) { state.timer.targetMinutes = Number(el.value) || null; state.settings.targetMinutes = Number(el.value) || null; persist(); } return; }
  if (el.matches('[data-action="default-target"]')) { state.settings.targetMinutes = Number(el.value) || null; persist(); return; }
  if (el.id === 'syllabusFilter') { syllabusFilter = el.value; render(); return; }
  if (el.id === 'backupFile' && el.files?.[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.subjects)) throw new Error('Not an ExamFlow backup.');
        if (!confirm('Import this backup and replace the current workspace?')) return;
        state = { ...blankState(), ...data, timer: null, settings: { ...blankState().settings, ...(data.settings || {}), apiKey: state.settings.apiKey || '' } };
        persist(); render();
        toast('Backup imported.', 'success');
      } catch (e) { toast('Import failed: ' + e.message, 'error'); }
    };
    reader.readAsText(el.files[0]);
    return;
  }
  if (el.matches('.unit-check')) {
    const s = findSubject(el.dataset.subject); const u = s?.units.find(x => x.id === el.dataset.unit);
    if (u) u.topics.forEach(t => { const cb = document.querySelector(`input[name="topicIds"][value="${t.id}"]`); if (cb) cb.checked = el.checked; });
    return;
  }
  if (el.matches('[data-lib-tag]')) { libraryFilter.tag = el.value; render(); return; }
  if (el.matches('[data-tab]')) { libraryTab = el.dataset.tab; quizState = null; render(); return; }
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.id === 'syllabusSearch') { const p = el.selectionStart; searchQuery = el.value; render(); const inp = document.getElementById('syllabusSearch'); inp?.focus(); inp?.setSelectionRange(p, p); return; }
  if (el.matches('[data-lib-search]')) { libraryFilter.q = el.value; const p = el.selectionStart; render(); const inp = document.querySelector('[data-lib-search]'); inp?.focus(); inp?.setSelectionRange(p, p); return; }
  if (el.id === 'searchInput') { runSearch(el.value); return; }
});

/* ---------- Keyboard shortcuts ----------------------------------------- */
document.addEventListener('keydown', event => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const cmdK = (isMac ? event.metaKey : event.ctrlKey) && event.key.toLowerCase() === 'k';
  const slash = event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (cmdK || slash) { event.preventDefault(); openSearchSheet(); return; }
  if (event.key === 'Escape') {
    if (document.querySelector('#modalRoot [role="dialog"]')) { closeModal(); return; }
    if (document.querySelector('.sheet-host.open')) { closeSearchSheet(); return; }
    if (railState.open) { closeRail(); return; }
    if (document.getElementById('sidebar')?.classList.contains('open')) { document.getElementById('sidebar').classList.remove('open'); return; }
  }
});

/* ---------- Scroll: hide rail & dock on scroll down, show on up -------- */
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  const dy = y - (window._lastY || 0);
  window._lastY = y;
  if (Math.abs(dy) < 8) return;
  const down = dy > 0;
  // don't hide when near top or bottom
  const nearTop = y < 60;
  const nearBottom = (window.innerHeight + y) > (document.body.scrollHeight - 60);
  const shouldHide = down && !nearTop && !nearBottom;
  railHidden = shouldHide;
  dockHidden = shouldHide;
  const rail = document.getElementById('rail');
  const dock = document.getElementById('dock');
  rail?.classList.toggle('hidden', railHidden);
  dock?.classList.toggle('hidden', dockHidden);
  if (shouldHide && railState.open) closeRail();
}, { passive: true });

/* ---------- Search overlay (opens) ------------------------------------- */
function showMoreMenu() {
  const host = document.getElementById('modalRoot');
  host.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><div><h2>More</h2><p>Exams, insights and help.</p></div><button class="modal-close" data-action="close-modal">×</button></div>
    <div style="display:flex;flex-direction:column;gap:6px">
      <button class="btn btn-outline" style="justify-content:flex-start" data-view="exams">Exams</button>
      <button class="btn btn-outline" style="justify-content:flex-start" data-view="metrics">Insights</button>
      <button class="btn btn-outline" style="justify-content:flex-start" data-view="help">Help</button>
      <button class="btn btn-outline" style="justify-content:flex-start" data-view="settings">Settings</button>
    </div>
    <div class="modal-actions"><button class="btn btn-outline" data-action="close-modal">Close</button></div>
  </section></div>`;
}

/* ---------- Tutor tour (simplified, kept for parity) ------------------- */
const TOUR = [
  { title: 'Welcome to ExamFlow', text: 'A quick tour. Everything works locally on this device.' },
  { view: 'syllabus', title: 'Your syllabus', text: 'Add subjects, units and topics here. Notes can be attached to any of them.' },
  { view: 'plan', title: 'Your plan', text: 'Today\u2019s tasks, ordered by urgency and pace.' },
  { view: 'library', title: 'Library', text: 'Notes and questions in one place. Use the quiz for spaced repetition.' },
];
function startTour() {
  closeModal(); tourI = 0; paintTour();
}
function paintTour() {
  const st = TOUR[tourI]; if (!st) return endTour();
  if (st.view && view !== st.view) { view = st.view; render(); }
  let root = document.getElementById('tourRoot');
  root.innerHTML = `<div class="tour-card">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <span style="flex:1;font-size:12px;color:#b8d934;font-weight:600">Step ${tourI + 1} of ${TOUR.length}</span>
    </div>
    <h3>${st.title}</h3>
    <p>${st.text}</p>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      ${tourI ? '<button class="btn btn-outline btn-small" data-action="tour-back" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.35)">Back</button>' : ''}
      <button class="btn btn-primary btn-small" data-action="tour-next">${tourI === TOUR.length - 1 ? 'Done' : 'Next'}</button>
    </div>
  </div>`;
  document.querySelectorAll('[data-action="tour-next"]').forEach(b => b.onclick = () => { tourI++; tourI >= TOUR.length ? endTour() : paintTour(); });
  document.querySelectorAll('[data-action="tour-back"]').forEach(b => b.onclick = () => { tourI = Math.max(0, tourI - 1); paintTour(); });
}
function endTour() { tourI = -1; document.getElementById('tourRoot').innerHTML = ''; state.tourDone = true; persist(); }

/* ---------- Syllabus parser ------------------------------------------- */
function parseSyllabus(text) {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const units = []; let cur = null;
  const unitRe = /^(?:unit|module|chapter|section)\s*([\w.-]+)?\s*[:\-–.)]?\s*(.*)$/i;
  for (let line of lines) {
    line = line.replace(/^[-*•\d.)\s]+/, '').trim(); if (!line) continue;
    const m = line.match(unitRe);
    if (m) { cur = { name: `Unit ${m[1] || units.length + 1}${m[2] ? ` · ${m[2]}` : ''}`, topics: [] }; units.push(cur); continue; }
    if (!cur) { cur = { name: `Unit ${units.length + 1}`, topics: [] }; units.push(cur); }
    cur.topics.push(line.replace(/[:;]$/, ''));
  }
  return units.filter(u => u.topics.length);
}

/* ---------- Tab title live update ------------------------------------- */
setInterval(() => {
  if (state.timer) {
    document.title = `${fmtTime(timerElapsed())} · ${VIEW_TITLES[view] || 'ExamFlow'}`;
    const el = document.getElementById('railTimerLabel');
    if (el) el.textContent = fmtTime(timerElapsed());
  }
}, 1000);

/* ---------- Reduce motion initial + service worker --------------------- */
document.body.classList.toggle('reduce-motion', !!state.settings.reduceMotion);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
}

/* ---------- Mobile sidebar toggle on outside-click --------------------- */
document.addEventListener('click', e => {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar?.classList.contains('open')) return;
  if (sidebar.contains(e.target)) return;
  if (e.target.closest('[data-action="menu"]')) return;
  sidebar.classList.remove('open');
});

/* ---------- Boot ------------------------------------------------------ */
render();
if (!state.tourDone && !state.subjects.length) setTimeout(startTour, 800);

/* ensure rail side attribute once */
document.getElementById('rail').dataset.side = state.settings.railSide || 'right';
