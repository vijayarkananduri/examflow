const STORAGE_KEY = 'examflow.workspace.v1';
const COLORS = [
  { bg: '#e6f6f8', fg: '#398b9a', bar: '#71c6d5' },
  { bg: '#f0edff', fg: '#796bc8', bar: '#a99ae9' },
  { bg: '#fff4dc', fg: '#b18a35', bar: '#f3cb6d' },
  { bg: '#fff0f3', fg: '#bf6f88', bar: '#ed91b0' },
  { bg: '#eaf7f0', fg: '#4e9b7c', bar: '#8ed2b6' },
  { bg: '#fcefe4', fg: '#bd8051', bar: '#efa96f' }
];
const VIEW_TITLES = { dashboard: 'Overview', syllabus: 'Syllabus', exams: 'Exams', plan: 'Study plan', metrics: 'Insights', settings: 'Settings' };
const blankState = () => ({ version: 1, semesterName: 'Your semester', subjects: [], exams: [], sessions: [], settings: { provider: 'gemini', apiKey: '', model: 'gemini-3.8-flash', dailyHours: 4, readGoal: 3, todayHours: null, skipToday: [] }, timer: null });
let state = loadState();
let view = 'dashboard';
let openSubjectId = null;
let syllabusFilter = '';
let searchQuery = '';
let tickHandle = null;
let pendingSyllabusImport = [];
let modalReturnFocus = null;
let menuReturnFocus = null;

function loadState() {
  try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) return { ...blankState(), ...JSON.parse(raw), settings: { ...blankState().settings, ...(JSON.parse(raw).settings || {}) } }; }
  catch (e) { console.warn('Workspace data could not be loaded:', e); }
  return blankState();
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); updateSidebar(); }
function uid(prefix = 'id') { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
function esc(s = '') { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function localDate(d = new Date()) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
function parseDate(s) { return new Date(`${s}T12:00:00`); }
function daysBetween(a, b) { return Math.ceil((parseDate(localDate(b)) - parseDate(localDate(a))) / 86400000); }
function fmtDate(s, opts = { month: 'short', day: 'numeric' }) { if (!s) return 'No date'; const d = parseDate(s); return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, opts); }
function fmtDay(d) { return new Date(d).toLocaleDateString(undefined, { weekday: 'short' }); }
function fmtDuration(min) { const h = Math.floor(min / 60); const m = Math.round(min % 60); return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`; }
function allTopics() { return state.subjects.flatMap(s => s.units.flatMap(u => u.topics.map(t => ({ ...t, subjectId: s.id, subject: s.name, unitId: u.id, unit: u.name, color: s.color || 0 })))); }
function normalizeKey(value) { return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' '); }
function topicRecord(name) { return { id: uid('topic'), name: String(name).trim(), status: 'unknown', reads: 0, readHistory: [], lastReadAt: null, nextReviewAt: null, reviewStep: 0, estimateMin: 45, priority: 1 }; }
function findTopic(id) { for (const s of state.subjects) for (const u of s.units) { const t = u.topics.find(x => x.id === id); if (t) return { subject: s, unit: u, topic: t }; } return null; }
function allTopicCount() { return allTopics().length; }
function statusCount(sid) { const ts = sid ? allTopics().filter(t => t.subjectId === sid) : allTopics(); return { total: ts.length, unknown: ts.filter(t => t.status === 'unknown').length, review: ts.filter(t => t.status === 'review').length, ready: ts.filter(t => t.status === 'ready').length, reads: ts.reduce((n, t) => n + (t.reads || 0), 0) }; }
function futureExams() { return state.exams.filter(e => e.date && daysBetween(new Date(), parseDate(e.date)) >= 0).sort((a, b) => a.date.localeCompare(b.date)); }
function nearestExamFor(t) { const matches = futureExams().filter(e => (e.topicIds || []).includes(t.id)); return matches[0] || null; }
function topicAverage(t) { const sessions = state.sessions.filter(x => x.topicId === t.id && x.minutes > 0); if (!sessions.length) return Number(t.estimateMin) || 45; return sessions.reduce((a, x) => a + x.minutes, 0) / sessions.length; }
function dueTopics() { const today = localDate(); return allTopics().filter(t => t.status === 'ready' && t.nextReviewAt && t.nextReviewAt <= today); }
function dueInDays(days = 7) { const today = localDate(); const later = localDate(new Date(Date.now() + days * 86400000)); return allTopics().filter(t => t.nextReviewAt && t.nextReviewAt >= today && t.nextReviewAt <= later); }
function makePlan(hours, skip) {
  const now = new Date();
  const today = localDate();
  if (state.settings.todayPlanDate && state.settings.todayPlanDate !== today) {
    state.settings.todayPlanDate = today;
    state.settings.todayHours = Number(state.settings.dailyHours) || 4;
    state.settings.skipToday = [];
    persist();
  }
  hours = hours ?? (state.settings.todayPlanDate === today ? state.settings.todayHours : state.settings.dailyHours);
  skip = skip ?? (state.settings.todayPlanDate === today ? state.settings.skipToday || [] : []);
  const future = futureExams();
  const topics = allTopics().filter(t => !skip.includes(t.subjectId)).filter(t => t.status !== 'ready' || (t.nextReviewAt && t.nextReviewAt <= today));
  const candidates = topics.map(t => {
    const exam = nearestExamFor(t);
    const days = exam ? Math.max(0, daysBetween(now, parseDate(exam.date))) : 28;
    const last = t.lastReadAt ? Math.max(0, Math.floor((Date.now() - new Date(t.lastReadAt).getTime()) / 86400000)) : 20;
    const isDue = t.nextReviewAt && t.nextReviewAt <= today;
    const stateWeight = t.status === 'unknown' ? 1.5 : t.status === 'review' ? 1.12 : 0.86;
    const urgency = 1 + Math.max(0, 18 - days) / 12;
    const untouched = 1 + Math.min(last, 30) / 45;
    const score = (isDue ? 4 : 0) + stateWeight * urgency * untouched * (Number(t.priority) || 1);
    return { ...t, exam, days, last, isDue, score, minutes: Math.max(15, Math.min(150, Math.round(topicAverage(t) * (isDue ? .72 : 1)))) };
  }).sort((a, b) => b.score - a.score);
  const budget = Math.max(30, Number(hours || 0) * 60);
  const tasks = [];
  let used = 0;
  for (const t of candidates) {
    if (used >= budget) break;
    const minutes = Math.min(t.minutes, budget - used);
    if (minutes < 10) continue;
    tasks.push({ ...t, minutes, startMinute: used });
    used += minutes + 8;
  }
  const assigned = allTopics().filter(t => nearestExamFor(t));
  const remaining = assigned.filter(t => t.status !== 'ready').reduce((a, t) => a + topicAverage(t), 0) + dueTopics().reduce((a, t) => a + topicAverage(t) * .7, 0);
  const next = future[0];
  const daysLeft = next ? Math.max(1, daysBetween(now, parseDate(next.date)) + 1) : null;
  const dailyNeed = daysLeft ? remaining / daysLeft : 0;
  const risk = Boolean(next && dailyNeed > (Number(state.settings.dailyHours) * 60));
  return { tasks, used, budget, remaining, next, daysLeft, dailyNeed, risk, totalCandidates: candidates.length };
}
function topicRead(topicId, minutes = 25, startAt = new Date(Date.now() - minutes * 60000).toISOString()) {
  const result = findTopic(topicId); if (!result) return;
  const { subject, unit, topic } = result;
  const duration = Math.max(1, Math.round(minutes));
  const ended = new Date().toISOString();
  topic.reads = (topic.reads || 0) + 1;
  topic.lastReadAt = ended;
  topic.readHistory = [...(topic.readHistory || []), ended];
  if (topic.status === 'unknown') topic.status = 'review';
  state.sessions.push({ id: uid('session'), topicId, subjectId: subject.id, topicName: topic.name, subjectName: subject.name, unitName: unit.name, startAt, endedAt: ended, minutes: duration });
  persist();
  return { subject, unit, topic, duration };
}
function markStatus(topicId, status) {
  const found = findTopic(topicId); if (!found) return;
  const t = found.topic; t.status = status;
  if (status === 'ready' && !t.nextReviewAt) { t.nextReviewAt = localDate(new Date(Date.now() + 2 * 86400000)); t.reviewStep = 1; }
  if (status !== 'ready') t.nextReviewAt = null;
  if (status === 'ready' && t.nextReviewAt && t.nextReviewAt < localDate()) t.nextReviewAt = localDate(new Date(Date.now() + 2 * 86400000));
  persist(); render();
}
function rescheduleReview(topic, success) {
  const intervals = [2, 4, 6, 12, 24, 48, 96];
  if (!success) { topic.status = 'review'; topic.nextReviewAt = localDate(new Date(Date.now() + 1 * 86400000)); topic.reviewStep = 0; return; }
  topic.status = 'ready'; const step = Math.min(topic.reviewStep || 0, intervals.length - 1);
  const days = intervals[step]; topic.reviewStep = Math.min(step + 1, intervals.length - 1); topic.nextReviewAt = localDate(new Date(Date.now() + days * 86400000));
}
function nextStudyTopic() { return makePlan(4).tasks[0] || null; }
function getStreak() {
  const dates = new Set(state.sessions.map(s => localDate(new Date(s.startAt))));
  let check = new Date(); if (!dates.has(localDate(check))) check.setDate(check.getDate() - 1);
  let streak = 0; while (dates.has(localDate(check))) { streak++; check.setDate(check.getDate() - 1); }
  return streak;
}
function weeklyMinutes() { const since = new Date(); since.setDate(since.getDate() - 6); return state.sessions.filter(s => new Date(s.startAt) >= since).reduce((a, s) => a + s.minutes, 0); }
function updateSidebar() {
  const total = allTopicCount(); const count = document.getElementById('topicCount'); if (count) count.textContent = total;
  const sem = document.getElementById('semesterLabel'); if (sem) sem.textContent = state.semesterName || 'Your semester';
  const mins = weeklyMinutes(); const wh = document.getElementById('weekHours'); if (wh) wh.innerHTML = `${(mins / 60).toFixed(mins % 60 ? 1 : 0)}h <i>/ 28h</i>`;
  const wp = document.getElementById('weekProgress'); if (wp) wp.style.width = `${Math.min(100, mins / (28 * 60) * 100)}%`;
  const hint = document.getElementById('weekHint'); if (hint) hint.textContent = mins ? `${Math.round(mins / 60)}h studied in the last 7 days` : 'Start a session to build momentum';
}
function setPageHeader() {
  const t = document.getElementById('pageTitle'); if (t) t.textContent = VIEW_TITLES[view] || 'Overview';
  const d = document.getElementById('todayLabel'); if (d) d.textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  document.querySelectorAll('.nav-link[data-view],.mobile-tab[data-view]').forEach(b => { const active = b.dataset.view === view; b.classList.toggle('active', active); if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
}
function render() {
  setPageHeader(); updateSidebar();
  const root = document.getElementById('app');
  root.innerHTML = ({ dashboard: renderDashboard, syllabus: renderSyllabus, exams: renderExams, plan: renderPlan, metrics: renderMetrics, settings: renderSettings }[view] || renderDashboard)();
  updateTimerText(); addHelpButtons();
}
function pageHeading(kicker, title, text, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1 tabindex="-1">${title}</h1><p>${text}</p></div><div class="heading-actions">${actions}</div></div>`; }
function metricCard(t, v, f, icon, c) { return `<article class="metric-card card ${c}"><div class="metric-top"><span>${t}</span><span class="metric-icon">${icon}</span></div><div class="metric-value">${v}</div><div class="metric-foot">${f}</div></article>`; }
function subjectProgressMarkup(subject) {
  const c = statusCount(subject.id); const pct = c.total ? Math.round((c.ready + c.review * .45) / c.total * 100) : 0; const ci = (subject.color || 0) % COLORS.length; const co = COLORS[ci];
  return `<div class="subject-row"><div class="subject-mark" style="background:${co.bg};color:${co.fg}">${esc(subject.name.slice(0, 2).toUpperCase())}</div><div class="subject-info"><strong>${esc(subject.name)}</strong><small>${c.ready} ready · ${c.review} review · ${c.unknown} to learn</small><div class="progress-track"><span style="width:${pct}%;background:${co.bar}"></span></div></div><div class="subject-percent">${pct}%</div></div>`;
}
function dayPanel(plan) {
  const today = localDate(); const budget = Math.max(30, Math.round(Number(state.settings.todayHours ?? state.settings.dailyHours) * 60));
  const done = Math.round(state.sessions.filter(x => localDate(x.startAt) === today).reduce((a, x) => a + (x.minutes || 0), 0));
  const tasks = plan.tasks || []; const planned = Math.round(tasks.reduce((a, t) => a + t.minutes, 0)); const pct = Math.min(100, Math.round(done / budget * 100));
  const ex = futureExams()[0]; let ready = null, cov = 0, reads = 0, need = null, left = null, ts = [];
  if (ex) { const ids = ex.topicIds || []; ts = allTopics().filter(t => ids.includes(t.id)); const g = Math.max(1, Number(state.settings.readGoal) || 3);
    cov = ts.length ? Math.round(ts.filter(t => t.status !== 'unknown').length / ts.length * 100) : 0; reads = ts.length ? Math.round(ts.reduce((a, t) => a + Math.min(t.reads || 0, g), 0) / (ts.length * g) * 100) : 0;
    left = Math.max(1, daysBetween(new Date(), parseDate(ex.date))); need = (ts.filter(t => t.status === 'unknown').length / left).toFixed(1); ready = Math.round(cov * .55 + reads * .45); }
  const over = planned - (budget - done); const verdict = pct >= 100 ? ['good', 'Day goal reached. Anything more is a bonus.'] : over > 20 ? ['warn', `Overbooked by ${fmtDuration(over)}. Do the first ${Math.max(1, tasks.findIndex((_, i) => tasks.slice(0, i + 1).reduce((a, t) => a + t.minutes, 0) > budget - done))} tasks and let the rest roll to tomorrow.`] : ['good', 'Plan fits your time. Start with the first block.'];
  let acc = 0; const phases = ['Morning', 'Afternoon', 'Evening']; const groups = [[], [], []]; tasks.slice(0, 6).forEach(t => { groups[Math.min(2, Math.floor(acc / Math.max(1, planned / 3)))].push(t); acc += t.minutes; });
  const blocks = groups.map((g, i) => g.length ? `<div class="day-block"><b>${phases[i]}</b>${g.map(t => `<button class="day-task" data-action="start-topic" data-id="${t.id}"><span>${esc(t.subject)} · ${esc(t.name)}</span><small>${fmtDuration(t.minutes)}</small></button>`).join('')}</div>` : '').join('');
  const stat = (v, l, c = '') => `<div class="day-stat ${c}"><strong>${v}</strong><small>${l}</small></div>`;
  return `<section class="day-panel card"><div class="day-ring" style="--p:${pct}"><div><strong>${pct}%</strong><small>of today</small></div></div><div class="day-main"><div class="eyebrow">YOUR DAY</div><h2>${fmtDuration(done)} done · ${fmtDuration(Math.max(0, budget - done))} left</h2><p class="day-verdict ${verdict[0]}">${verdict[1]}</p><div class="day-stats">${stat(ready === null ? '—' : ready + '%', ex ? `Readiness · ${esc(ex.name)}` : 'Add an exam for readiness', ready !== null && ready < 40 ? 'warn' : '')}${stat(need === null ? '—' : need, 'New topics / day needed')}${stat(left === null ? '—' : left + 'd', 'To next exam')}${stat(fmtDuration(planned), 'Planned today')}</div></div>${blocks ? `<div class="day-blocks">${blocks}</div>` : ''}</section>`;
}

function subjectPct(c) { return c.total ? Math.round((c.ready + c.review * .45) / c.total * 100) : 0; }
function subjectTile(s) {
  const c = statusCount(s.id), co = COLORS[(s.color || 0) % COLORS.length], pct = subjectPct(c);
  return `<div class="tile-wrap"><button class="subject-tile" data-action="open-subject-detail" data-id="${s.id}" aria-label="Open ${esc(s.name)}: ${s.units.length} units, ${c.total} topics, ${pct}% progress"><span class="tile-ring" style="--p:${pct};--c:${co.bar}"><b>${pct}%</b></span><span class="tile-body"><strong>${esc(s.name)}</strong><small>${s.units.length} unit${s.units.length === 1 ? '' : 's'} · ${c.total} topics</small><span class="tile-bar"><i style="width:${pct}%;background:${co.bar}"></i></span><span class="tile-mix"><em class="m-u">${c.unknown} to learn</em><em class="m-r">${c.review} review</em><em class="m-g">${c.ready} ready</em></span></span><span class="tile-go" aria-hidden="true">›</span></button><button class="help-i" type="button" data-action="hint" data-hint="subject-tile" aria-label="What is this card?">?</button></div>`;
}
function renderSubjectDetail(s) {
  const c = statusCount(s.id), co = COLORS[(s.color || 0) % COLORS.length], pct = subjectPct(c);
  const units = s.units.map(u => { const n = u.topics.length, rdy = u.topics.filter(t => t.status === 'ready').length, up = n ? Math.round(rdy / n * 100) : 0;
    return `<details class="unit-acc"><summary><span class="ua-main"><strong>${esc(u.name)}</strong><small>${n} topics · ${rdy} ready · ${u.topics.reduce((a, t) => a + (t.reads || 0), 0)} reads</small><span class="tile-bar"><i style="width:${up}%;background:${co.bar}"></i></span></span><span class="ua-pct">${up}%</span><span class="ua-chev" aria-hidden="true">⌄</span></summary><div class="ua-body">${u.topics.map(t => `<div class="topic-row"><span>${esc(t.name)}</span><span class="read-count">${t.reads || 0} ${t.reads === 1 ? 'read' : 'reads'}${t.lastReadAt ? ` · ${fmtDate(localDate(new Date(t.lastReadAt)))}` : ''}</span><select aria-label="Status for ${esc(t.name)}" data-action="topic-status" data-id="${t.id}">${statusOptions(t.status)}</select>${t.status === 'ready' && t.nextReviewAt ? `<span class="revision-badge">${t.nextReviewAt <= localDate() ? 'Due now' : `Review ${fmtDate(t.nextReviewAt)}`}</span>` : ''}<button title="Start a session" aria-label="Start a study session for ${esc(t.name)}" data-action="start-topic" data-id="${t.id}">▶</button><button title="Practice questions" aria-label="Practice questions for ${esc(t.name)}" data-action="practice-topic" data-id="${t.id}">✦</button></div>`).join('') || '<p class="field-help">No topics yet.</p>'}<button class="topic-add" data-action="add-topic" data-id="${s.id}" data-unit="${u.id}">+ Add topic to this unit</button></div></details>`; }).join('');
  return `<button class="back-link" data-action="close-subject-detail">‹ All subjects</button><section class="card subject-hero" style="--c:${co.bar}"><span class="tile-ring big" style="--p:${pct};--c:${co.bar}"><b>${pct}%</b></span><div><h1 tabindex="-1">${esc(s.name)}</h1><p>${s.units.length} units · ${c.total} topics · ${c.reads} reads <button class="help-i" type="button" data-action="hint" data-hint="subject-detail" aria-label="How to use this page">?</button></p><div class="tile-mix"><em class="m-u">${c.unknown} to learn</em><em class="m-r">${c.review} review</em><em class="m-g">${c.ready} ready</em></div></div><div class="subject-card-actions"><button class="btn btn-outline btn-small" data-action="add-topic" data-id="${s.id}">+ Topic</button><button class="btn btn-outline btn-small" data-action="rename-subject" data-id="${s.id}">Edit</button><button class="btn btn-danger btn-small" data-action="delete-subject" data-id="${s.id}" aria-label="Delete subject">Delete</button></div></section><p class="field-help" style="margin:4px 4px 12px">Tap a unit to open its topics.</p><div class="unit-list">${units || '<div class="card panel"><p class="field-help">No units yet. Add a topic to create one.</p></div>'}</div>`;
}

const HELP = {
  'subject-tile': ['Subject card', 'Tap a card to open the subject and see its units. The ring shows progress: Ready topics count fully, Review topics count partly. The three numbers split topics into to learn, review and ready.'],
  'subject-detail': ['Subject page', 'Each unit is a row. Tap it to open the topics inside. Change a topic\'s status, tap ▶ to start a timed study session, or ✦ to practise. Finished sessions add one read.'],
  'view-syllabus': ['Syllabus', 'All your subjects at a glance. Import a whole syllabus with the button above, or add subjects by hand. Tap any subject for details.'],
  'view-exams': ['Exams', 'Use Build timetable to enter every exam in one go: pick the subject, date, time and which units it covers. Exams drive the priority of your daily plan.'],
  'view-plan': ['Study plan', 'Today\'s focus plus a six-day roadmap. It favours topics you don\'t know yet, exams that are close, and revisions that are due. Change today\'s available hours when your day changes.'],
  'view-metrics': ['Insights', 'Your study history: minutes, reads and consistency across the whole semester.'],
  'view-settings': ['Settings', 'Add your AI key, set daily goals, and export or import a backup to move devices.'],
  'view-dashboard': ['Overview', 'Your day at a glance: time done today, readiness for the next exam, and the single best next topic to study.'],
  'day': ['Your day', 'The ring shows today\'s minutes against your daily budget. Readiness mixes how many exam topics you have started with how many reads you have completed. "New topics / day" is the pace needed to cover everything unknown before the exam.'],
  'Your next best move': ['Next best move', 'The top suggestion from your plan. Tap Study now to start a timer.'],
  'Subject pulse': ['Subject pulse', 'Progress per subject. Open the Syllabus tab for details.'],
  'A gentle nudge': ['Revisions due', 'Topics marked Ready come back for a quick revisit on a spaced schedule. A successful revisit pushes the next one further out.'],
  'TOPICS IN MOTION': ['Topics in motion', 'Topics you have started (Review or Ready) out of all topics.'],
  'STUDY TIME · 7 DAYS': ['Study time', 'Minutes from finished timer sessions over the last 7 days.'],
  'SEMESTER STREAK': ['Streak', 'Consecutive days with at least one logged session.'],
  'REVIEWS DUE': ['Reviews due', 'Ready topics whose revisit date is today or earlier.'],
  'AI study assistant': ['AI assistant', 'Optional. Paste your own API key to split a long syllabus into subjects, units and topics, read exam circulars, or create practice questions.'],
  'Study goals': ['Study goals', 'Daily target feeds the plan. Reads per topic is your goal before an exam; it is a target, not a limit.'],
  'Back up & move devices': ['Backup', 'Export a JSON file to move to another device. Backups never include your API key.'],
  'How planning works': ['How planning works', 'The plan is a transparent local algorithm: unknown topics, exam proximity, review dates and your real pace.'],
  'exam': ['Exam card', 'Shows days left and how many of its topics are Ready. Edit it to change the date or covered topics.']
};
function addHelpButtons() {
  const root = document.getElementById('app'); if (!root) return;
  const add = (el, key) => { if (!el || el.querySelector(':scope > .help-i') || !HELP[key]) return; const b = document.createElement('button'); b.type = 'button'; b.className = 'help-i'; b.dataset.action = 'hint'; b.dataset.hint = key; b.setAttribute('aria-label', `What is ${HELP[key][0]}?`); b.textContent = '?'; el.appendChild(b); };
  add(root.querySelector('.page-heading h1'), `view-${view}`);
  root.querySelectorAll('.panel-title,.setting-card>h3').forEach(el => add(el, el.textContent.replace('?', '').trim()));
  root.querySelectorAll('.metric-top>span:first-child').forEach(el => add(el, el.textContent.replace('?', '').trim()));
  root.querySelectorAll('.day-panel .eyebrow').forEach(el => add(el, 'day'));
  root.querySelectorAll('.exam-card h3').forEach(el => add(el, 'exam'));
}
function showHint(key) { const h = HELP[key]; if (h) openModal(h[0], 'Quick guide', `<div class="help-box"><p style="font-size:15px;line-height:1.7;margin:0">${esc(h[1])}</p></div>`, '<button class="btn btn-outline" data-action="close-modal">Close</button><button class="btn btn-primary" data-action="start-tour">Replay the full tour</button>'); }

/* ---------- Manual exam timetable builder ---------- */
let ttSeq = 0;
function ttUnits(sj, chosen = []) { return (sj?.units || []).map(u => `<label class="chip"><input type="checkbox" value="${u.id}" ${chosen.includes(u.id) ? 'checked' : ''}><span>${esc(u.name)}</span></label>`).join('') || '<small class="field-help">This subject has no units yet.</small>'; }
function ttRow(r = {}) {
  const sj = state.subjects.find(x => x.id === r.subjectId) || state.subjects[0]; const id = ++ttSeq;
  return `<div class="tt-row" data-tt-row="${id}"><div class="tt-grid"><label>Subject<select data-tt="subject">${state.subjects.map(x => `<option value="${x.id}" ${x.id === sj?.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label><label>Date<input data-tt="date" type="date" value="${esc(r.date || '')}"></label><label>Time <small>(optional)</small><input data-tt="time" type="time" value="${esc(r.time || '')}"></label></div><div class="tt-units-label">Units covered <small>— leave empty for the whole subject</small></div><div class="tt-units" data-tt="units">${ttUnits(sj, r.unitIds)}</div><button type="button" class="btn btn-danger btn-small" data-action="tt-remove">Remove this exam</button></div>`;
}
function showTimetableBuilder() {
  if (!state.subjects.length) { toast('Add your subjects first, then build the timetable.', 'error'); view = 'syllabus'; render(); return; }
  ttSeq = 0;
  openModal('Build exam timetable', 'Add one row per exam. Everything is saved together.', `<div class="field"><label for="ttName">Checkpoint name</label><input id="ttName" value="Mid-1" maxlength="40" placeholder="Mid-1, Mid-2, Final…"></div><div class="row wrap" style="margin-bottom:10px"><button type="button" class="btn btn-soft btn-small" data-action="tt-fill">⚡ One row per subject</button><button type="button" class="btn btn-outline btn-small" data-action="tt-add">+ Add exam row</button></div><div id="ttRows">${ttRow()}</div><div id="ttStatus" class="field-help" role="status"></div>`, '<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="tt-save">Save timetable</button>');
}
function saveTimetable() {
  const cp = document.getElementById('ttName')?.value.trim() || 'Exam'; const rows = [...document.querySelectorAll('#ttRows .tt-row')]; let added = 0, merged = 0, skipped = 0;
  for (const r of rows) {
    const sj = state.subjects.find(x => x.id === r.querySelector('[data-tt="subject"]').value); const date = r.querySelector('[data-tt="date"]').value; const time = r.querySelector('[data-tt="time"]').value;
    if (!sj || !date) { skipped++; continue; }
    const picked = [...r.querySelectorAll('[data-tt="units"] input:checked')].map(i => i.value); const units = sj.units.filter(u => !picked.length || picked.includes(u.id));
    const topicIds = units.flatMap(u => u.topics.map(t => t.id)); const name = `${cp} · ${sj.name}`; const dup = state.exams.find(e => e.date === date && normalizeKey(e.name) === normalizeKey(name));
    if (dup) { dup.topicIds = [...new Set([...(dup.topicIds || []), ...topicIds])]; dup.time = time || dup.time; merged++; } else { state.exams.push({ id: uid('exam'), name, date, time, subjectId: sj.id, mode: /final/i.test(cp) ? 'final' : 'mid', topicIds, createdAt: new Date().toISOString() }); added++; }
  }
  const st = document.getElementById('ttStatus');
  if (!added && !merged) { if (st) st.textContent = 'Pick a date for at least one row.'; return toast('Pick a date for at least one row.', 'error'); }
  persist(); closeModal(); view = 'exams'; render(); toast(`${added} exam${added === 1 ? '' : 's'} added${merged ? `, ${merged} merged` : ''}${skipped ? `, ${skipped} row${skipped === 1 ? '' : 's'} skipped (no date)` : ''}.`, 'success');
}

/* ---------- First-time guided tour ---------- */
const TOUR = [
  { icon: '👋', title: 'Welcome to ExamFlow', text: 'This 2-minute tour shows you exactly where to tap. ExamFlow turns your syllabus and exam dates into a daily plan, and remembers every topic you read. You can skip any time and replay it from any ? button.' },
  { icon: '📥', title: '1 · Bring in your syllabus', view: 'syllabus', target: '[data-action="open-import-syllabus"]', text: 'Tap Import full syllabus. Upload PDFs or paste the text. With an AI key it splits everything into subjects, units and topics. Without a key it finds "Subject:" headings itself. You review before anything is saved.' },
  { icon: '🗂️', title: '2 · Tap through your subjects', view: 'syllabus', target: '.subject-tile,.empty-state', text: 'Each subject is one card with a progress ring. Tap a card to open its units, then tap a unit to see its topics. That is where you set status and start timers.' },
  { icon: '🗓️', title: '3 · Build your exam timetable', view: 'exams', target: '[data-action="open-timetable"]', text: 'Tap Build timetable. Add a row per exam with subject, date, time and the units it covers. "One row per subject" fills the list for you.' },
  { icon: '🎯', title: '4 · Follow the plan', view: 'plan', target: '[data-view="plan"]', text: 'The Study plan picks what to study today and the next six days, weighing exam dates, topics you don\'t know yet and revisions due. Short on time today? Change the hours there.' },
  { icon: '⏱️', title: '5 · Study with the timer', view: 'dashboard', target: '.day-panel,.intro-card', text: 'Overview shows your day: time done, readiness for the next exam and the pace you need. Tap any task to start the timer. Finishing a session logs one read and your real minutes.' },
  { icon: '🔑', title: '6 · Optional: AI key', view: 'settings', target: '#provider', text: 'Pick a provider, choose a model and paste your own key. It stays on this device. Use Test connection to check it. Everything else works without a key.' },
  { icon: '❓', title: 'Look for the ? buttons', text: 'Every card and screen has a small ? button. Tap it for a plain-language explanation. You can replay this tour from there too.', last: true }
];
let tourI = -1;
function clearTourHl() { document.querySelectorAll('.tour-hl').forEach(e => e.classList.remove('tour-hl')); }
function startTour() { closeModal(); tourI = 0; paintTour(); }
function endTour(done = true) { tourI = -1; clearTourHl(); document.getElementById('tourRoot')?.remove(); if (done) { state.tourDone = true; persist(); } }
function paintTour() {
  const st = TOUR[tourI]; if (!st) return endTour();
  if (st.view && view !== st.view) { view = st.view; openSubjectId = null; setMenuOpen(false); render(); }
  clearTourHl();
  if (st.target) requestAnimationFrame(() => { const els = [...document.querySelectorAll(st.target)].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.left < innerWidth; }); els.forEach(e => e.classList.add('tour-hl')); els[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  let root = document.getElementById('tourRoot'); if (!root) { root = document.createElement('div'); root.id = 'tourRoot'; document.body.appendChild(root); }
  root.innerHTML = `<section class="tour-card" role="dialog" aria-live="polite" aria-label="Guided tour"><div class="tour-top"><span class="tour-ic" aria-hidden="true">${st.icon}</span><span class="tour-count">Step ${tourI + 1} of ${TOUR.length}</span><button class="tour-x" data-action="tour-skip" aria-label="Skip tour">Skip</button></div><h3>${st.title}</h3><p>${st.text}</p><div class="tour-dots" aria-hidden="true">${TOUR.map((_, i) => `<i class="${i === tourI ? 'on' : ''}"></i>`).join('')}</div><div class="tour-actions">${tourI ? '<button class="btn btn-outline btn-small" data-action="tour-back">Back</button>' : ''}${st.last ? '<button class="btn btn-soft btn-small" data-action="tour-sample">Try sample data</button>' : ''}<button class="btn btn-primary btn-small" data-action="tour-next">${st.last ? 'Start using ExamFlow' : 'Next'}</button></div></section>`;
}
document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]'); if (!el) return; const a = el.dataset.action, id = el.dataset.id;
  if (a === 'open-subject-detail') { openSubjectId = id; view = 'syllabus'; render(); scrollTo(0, 0); }
  else if (a === 'close-subject-detail') { openSubjectId = null; render(); }
  else if (a === 'hint') { event.stopPropagation(); showHint(el.dataset.hint); }
  else if (a === 'open-timetable') showTimetableBuilder();
  else if (a === 'tt-add') document.getElementById('ttRows')?.insertAdjacentHTML('beforeend', ttRow());
  else if (a === 'tt-fill') document.getElementById('ttRows').innerHTML = state.subjects.map(x => ttRow({ subjectId: x.id })).join('');
  else if (a === 'tt-remove') { const rows = document.querySelectorAll('#ttRows .tt-row'); if (rows.length > 1) el.closest('.tt-row').remove(); else toast('Keep at least one row.'); }
  else if (a === 'tt-save') saveTimetable();
  else if (a === 'start-tour') startTour();
  else if (a === 'tour-next') { tourI++; tourI >= TOUR.length ? endTour() : paintTour(); }
  else if (a === 'tour-back') { tourI = Math.max(0, tourI - 1); paintTour(); }
  else if (a === 'tour-skip') endTour();
  else if (a === 'tour-sample') { endTour(); sampleWorkspace(); }
}, true);
document.addEventListener('change', event => { if (event.target?.dataset?.tt === 'subject') { const row = event.target.closest('.tt-row'); row.querySelector('[data-tt="units"]').innerHTML = ttUnits(state.subjects.find(x => x.id === event.target.value)); } });

function renderDashboard() {
  const total = statusCount(); const streak = getStreak(); const mins = weeklyMinutes(); const next = futureExams()[0]; const plan = makePlan(); const pick = plan.tasks[0];
  const intro = !state.subjects.length ? `<section class="intro-card" aria-labelledby="introTitle"><div class="eyebrow">YOUR SEMESTER, WITHOUT THE SPREADSHEETS</div><h2 id="introTitle" tabindex="-1">Know what to study next—and keep every read.</h2><p>ExamFlow turns your complete syllabus and mid/final timetable into a daily plan. Your topic history keeps counting across exams, so finals build on the work you have already done.</p><div class="intro-steps"><div class="intro-step"><span class="intro-step-number">1</span><span><strong>Bring in your syllabus</strong><small>Upload full PDFs or paste the whole outline. Review all subjects, units, and topics before adding them.</small></span></div><div class="intro-step"><span class="intro-step-number">2</span><span><strong>Add mid and final dates</strong><small>Choose the units in each exam; checkpoints never reset your semester history.</small></span></div><div class="intro-step"><span class="intro-step-number">3</span><span><strong>Study the next best topic</strong><small>Use the timer, mark confidence, and let the plan adapt to your real pace.</small></span></div></div><div class="intro-actions"><button class="btn btn-primary" data-action="open-import-syllabus">⇧ Import full syllabus</button><button class="btn btn-outline" data-action="open-subject">Add one subject manually</button><button class="btn btn-soft" data-action="show-help">How it works</button></div></section>` : '';
  const days = next ? Math.max(0, daysBetween(new Date(), parseDate(next.date))) : null;
  if (!state.subjects.length) return `${intro}`;
  const studyHero = pick ? `<div class="hero-card"><div class="hero-orb"></div><div class="hero-content"><div class="hero-kicker"><i></i> YOUR NEXT BEST MOVE</div><h2>Make today count,<br>one topic at a time.</h2><p>Your plan is tuned to your next exam, your progress, and the time you actually have.</p><button class="btn btn-primary" data-action="start-topic" data-id="${pick.id}">Start ${esc(pick.subject)} · ${esc(pick.name)} <span>→</span></button><div class="hero-detail">${pick.isDue ? 'Revision due' : `${pick.days} days to ${esc(pick.exam?.name || 'exam')}`} · ${fmtDuration(pick.minutes)} suggested</div></div></div>` : `<div class="hero-card"><div class="hero-orb"></div><div class="hero-content"><div class="hero-kicker"><i></i> YOUR SEMESTER, IN RHYTHM</div><h2>Build a plan that<br>fits your real life.</h2><p>Add the subjects and exam checkpoints you care about. ExamFlow will turn them into a clear next step.</p><button class="btn btn-primary" data-action="open-subject">Set up your syllabus <span>→</span></button><div class="hero-detail">Private by design · saved on this device</div></div></div>`;
  const nextPanel = next ? `<div class="hero-side"><div><div class="side-label">NEXT CHECKPOINT</div><div class="exam-countdown"><strong>${days}</strong><span>${days === 1 ? 'day' : 'days'} left</span></div><div class="side-exam-name">${esc(next.name)}</div><div class="side-exam-date">${fmtDate(next.date, { weekday: 'short', month: 'long', day: 'numeric' })}</div></div><div class="side-footer"><b>${(next.topicIds || []).length}</b> topics · ${total.ready} topics ready so far</div></div>` : `<div class="hero-side"><div><div class="side-label">YOUR NEXT CHECKPOINT</div><div class="exam-countdown"><strong>—</strong><span>when you're ready</span></div><div class="side-exam-name">Add an exam date</div><div class="side-exam-date">Quick exam or full mid timetable</div></div><button class="btn btn-outline btn-small" data-action="open-exam">+ Add an exam</button></div>`;
  const due = dueTopics(); const risk = plan.risk ? `<div class="risk-banner"><span>◈</span><div><strong>You're carrying a little extra load.</strong> At your current daily target, the remaining work may outpace ${esc(plan.next?.name || 'your next exam')}. Adjust today's time or add more study hours in Settings.</div></div>` : '';
  const recommendation = pick ? `<div class="recommend-card"><div class="rec-icon">✦</div><div class="rec-info"><small>${pick.isDue ? 'REVISION DUE' : `EXAM IN ${pick.days} DAYS`}</small><strong>${esc(pick.subject)} → ${esc(pick.name)}</strong><span>${esc(pick.unit)} · ${fmtDuration(pick.minutes)} suggested · ${pick.reads} reads so far</span></div><button class="btn btn-primary btn-small rec-start" data-action="start-topic" data-id="${pick.id}">Study now</button></div>` : `<div class="empty-state"><div class="empty-icon">✦</div><h3>Your first smart plan starts here</h3><p>Add a subject and a few topics. We'll tell you what to study first and keep a semester-long record of every read.</p><button class="btn btn-soft btn-small" data-action="open-subject">Add your first subject</button></div>`;
  const planLines = plan.tasks.slice(0, 3).map((t, i) => `<div class="plan-line"><span class="plan-time">${['09:00', '10:00', '11:00'][i] || '12:00'}</span><span class="plan-dot"></span><strong>${esc(t.subject)} · ${esc(t.name)}</strong><span>${fmtDuration(t.minutes)}</span></div>`).join('');
  return `${intro}${pageHeading(`${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}`, `A steady start, ${state.sessions.length ? 'a stronger semester.' : 'a smarter semester.'}`, 'A little progress today makes the next checkpoint feel lighter.', `<button class="btn btn-outline" data-view="plan">✳ View my plan</button><button class="btn btn-primary" data-action="open-exam">+ Add exam</button>`)}${dayPanel(plan)}<section class="dashboard-hero">${studyHero}${nextPanel}</section><section class="grid metrics-row">${metricCard('TOPICS IN MOTION', `${total.ready + total.review}<small style="font:500 10px var(--font);color:#999">/${total.total}</small>`, `${total.unknown} still to learn`, '◉', 'blue')}${metricCard('STUDY TIME · 7 DAYS', `${(mins / 60).toFixed(1)}<small style="font:500 10px var(--font);color:#999">h</small>`, `${state.sessions.length} sessions logged`, '◷', 'lav')}${metricCard('SEMESTER STREAK', `${streak}<small style="font:500 10px var(--font);color:#999">d</small>`, streak ? 'Keep showing up' : 'One session starts it', '✳', 'gold')}${metricCard('REVIEWS DUE', `${due.length}`, due.length ? 'Ready topics to revisit today' : 'No revision debt today', '↻', 'pink')}</section>${risk}<section class="grid lower-grid"><article class="card panel"><div class="panel-head"><div><div class="panel-title">Your next best move</div><div class="panel-subtitle">Priority shifts as exams and progress change</div></div><button class="text-link" data-view="plan">Full plan →</button></div>${recommendation}${planLines ? `<div class="plan-lines">${planLines}</div>` : ''}</article><article class="card panel"><div class="panel-head"><div><div class="panel-title">Subject pulse</div><div class="panel-subtitle">Confidence grows with every read</div></div><button class="text-link" data-view="syllabus">All subjects →</button></div>${state.subjects.length ? `<div class="subject-list">${state.subjects.slice(0, 5).map(subjectProgressMarkup).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">▤</div><h3>No subjects yet</h3><p>Start with your syllabus. Add topics manually, paste a list, upload a PDF, or ask your AI provider to split it into topics.</p></div>`}</article></section>${due.length ? `<section class="card panel section-gap"><div class="panel-head"><div><div class="panel-title">A gentle nudge</div><div class="panel-subtitle">These ready topics are due for a quick pass</div></div><span class="revision-badge">${due.length} due</span></div><div class="subject-list">${due.slice(0, 4).map(t => `<div class="subject-row"><div class="subject-mark" style="background:${COLORS[t.color % COLORS.length].bg};color:${COLORS[t.color % COLORS.length].fg}">↻</div><div class="subject-info"><strong>${esc(t.subject)} · ${esc(t.name)}</strong><small>${esc(t.unit)} · ${t.reads} reads</small></div><button class="btn btn-soft btn-small" data-action="start-topic" data-id="${t.id}">Revise</button></div>`).join('')}</div></section>` : ''}`;
}
function statusOptions(selected) { return ['unknown', 'review', 'ready'].map(x => `<option value="${x}" ${x === selected ? 'selected' : ''}>${x[0].toUpperCase() + x.slice(1)}</option>`).join(''); }
function renderSyllabus() {
  if (openSubjectId) { const sj = state.subjects.find(x => x.id === openSubjectId); if (sj) return renderSubjectDetail(sj); openSubjectId = null; }
  const acts = `<button class="btn btn-outline" data-action="open-import-syllabus">⇧ Import full syllabus</button><button class="btn btn-primary" data-action="open-subject">+ Add subject manually</button>`;
  const subjects = state.subjects.filter(s => !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.units.some(u => u.topics.some(t => t.name.toLowerCase().includes(searchQuery.toLowerCase())))).filter(s => !syllabusFilter || statusCount(s.id)[syllabusFilter] > 0);
  return `${pageHeading('THE WHOLE SEMESTER', 'Your syllabus, organized.', 'Every topic keeps its read history across mids, finals, and the rest of the semester.', acts)}<div class="toolbar"><label class="searchbox"><span>⌕</span><input id="syllabusSearch" aria-label="Search subjects and topics" placeholder="Find a subject or topic…" value="${esc(searchQuery)}"></label><select class="select" id="syllabusFilter" aria-label="Filter topics by study status"><option value="">All topics</option><option value="unknown" ${syllabusFilter === 'unknown' ? 'selected' : ''}>Need to learn</option><option value="review" ${syllabusFilter === 'review' ? 'selected' : ''}>In review</option><option value="ready" ${syllabusFilter === 'ready' ? 'selected' : ''}>Ready</option></select><span class="muted" style="font-size:8px">${allTopicCount()} topics · ${statusCount().reads} reads this semester</span></div>${subjects.length ? `<div class="subject-grid">${subjects.map(subjectTile).join('')}</div>` : state.subjects.length ? `<div class="empty-state"><h3>Nothing matches this filter</h3><p>Try a different search or status.</p><button class="btn btn-soft btn-small" data-action="clear-filter">Clear filters</button></div>` : `<div class="card panel"><div class="empty-state"><div class="empty-icon">▤</div><h3>Start with what you need to study</h3><p>Add units and topics by hand, paste syllabus text, upload a PDF, or use your AI key to split a syllabus into units. You can edit everything before you start.</p><div class="row" style="justify-content:center;flex-wrap:wrap"><button class="btn btn-primary btn-small" data-action="open-subject">+ Add a subject</button><button class="btn btn-outline btn-small" data-action="open-import-syllabus">Import syllabus</button><button class="btn btn-soft btn-small" data-action="sample-data">See a sample workspace</button></div></div></div>`}`;
}
function subjectCardMarkup(s) {
  const c = statusCount(s.id), co = COLORS[(s.color || 0) % COLORS.length]; const pct = c.total ? Math.round((c.ready + c.review * .45) / c.total * 100) : 0;
  return `<article class="card subject-card"><div class="subject-card-head"><div class="subject-icon" style="background:${co.bg};color:${co.fg}">${esc(s.name.slice(0, 2).toUpperCase())}</div><div class="subject-heading"><h3>${esc(s.name)}</h3><p>${s.units.length} units · ${c.total} topics · ${c.reads} reads · ${pct}% momentum</p></div><div class="subject-card-actions"><button class="btn btn-outline btn-small" data-action="add-topic" data-id="${s.id}">+ Topic</button><button class="btn btn-outline btn-small" data-action="rename-subject" data-id="${s.id}">Edit</button><button class="btn btn-danger btn-small" data-action="delete-subject" data-id="${s.id}" aria-label="Delete subject ${esc(s.name)}">×</button></div></div>${s.units.map(u => `<div class="unit-block"><div class="unit-head"><span class="unit-chip">${esc(u.name)}</span><strong>${u.topics.length} topics</strong><small>${u.topics.reduce((a, t) => a + (t.reads || 0), 0)} reads logged</small><button class="topic-add" data-action="add-topic" data-id="${s.id}" data-unit="${u.id}">+ Add topic</button></div>${u.topics.map(t => `<div class="topic-row"><span>${esc(t.name)}</span><span class="read-count">${t.reads || 0} ${t.reads === 1 ? 'read' : 'reads'}${t.lastReadAt ? ` · ${fmtDate(localDate(new Date(t.lastReadAt)))}` : ''}</span><select aria-label="Status for ${esc(t.name)}" data-action="topic-status" data-id="${t.id}">${statusOptions(t.status)}</select>${t.status === 'ready' ? `<span class="revision-badge">${t.nextReviewAt && t.nextReviewAt <= localDate() ? 'Due now' : t.nextReviewAt ? `Review ${fmtDate(t.nextReviewAt)}` : 'Ready'}</span>` : ''}<button title="Start a session" aria-label="Start a study session for ${esc(t.name)}" data-action="start-topic" data-id="${t.id}">▶</button><button title="Practice questions" aria-label="Practice questions for ${esc(t.name)}" data-action="practice-topic" data-id="${t.id}">✦</button></div>`).join('')}</div>`).join('')}</article>`;
}
function renderExams() {
  const acts = `<button class="btn btn-outline" data-action="import-timetable">▧ Read a circular photo</button><button class="btn btn-outline" data-action="open-exam">+ Single exam</button><button class="btn btn-primary" data-action="open-timetable">🗓 Build timetable</button>`;
  const exams = [...state.exams].sort((a, b) => a.date.localeCompare(b.date));
  return `${pageHeading('CHECKPOINTS, NOT RESETS', 'Exams that fit your semester.', 'Mid-1, Mid-2, finals — every checkpoint uses selected units; topic histories keep counting.', acts)}<div class="help-box" style="margin-bottom:15px">✦ &nbsp;Quick exam mode: add one date and select units. Mid timetable: add multiple subject checkpoints, or parse a circular image with your configured AI provider. Nothing is archived automatically; semester reads continue until you end the semester.</div>${exams.length ? exams.map(examCardMarkup).join('') : `<div class="card panel"><div class="empty-state"><div class="empty-icon">◷</div><h3>Checkpoints give your plan a deadline</h3><p>Add a quick exam or a set of mid/final dates. Choose the exact subject units each exam covers; topics stay in your semester history after the date passes.</p><div class="row" style="justify-content:center"><button class="btn btn-primary btn-small" data-action="open-exam">+ Add an exam</button><button class="btn btn-outline btn-small" data-action="import-timetable">Read a circular photo</button></div></div></div>`}`;
}
function examCardMarkup(e) {
  const d = parseDate(e.date), past = daysBetween(new Date(), d) < 0; const topicList = (e.topicIds || []).map(findTopic).filter(Boolean); const bySub = [...new Set(topicList.map(x => x.subject.name))]; const ready = topicList.filter(x => x.topic.status === 'ready').length; const pct = topicList.length ? Math.round(ready / topicList.length * 100) : 0;
  return `<article class="card exam-card"><div class="exam-date-box"><strong>${d.getDate()}</strong><span>${d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</span></div><div><div class="row"><h3>${esc(e.name)}</h3><span class="status-pill ${past ? 'status-review' : 'status-unknown'}">${past ? 'Checkpoint passed · history kept' : `${Math.max(0, daysBetween(new Date(), d))} days to go`}</span></div><p>${fmtDate(e.date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}${e.time ? ` · ${esc(e.time)}` : ''} · ${topicList.length} selected topics · ${pct}% ready</p><div class="exam-tags">${bySub.length ? bySub.map(x => `<span class="exam-tag">${esc(x)}</span>`).join('') : '<span class="exam-tag">No topics linked yet</span>'}</div></div><div class="exam-card-actions"><button class="btn btn-outline btn-small" data-action="edit-exam" data-id="${e.id}">Edit</button><button class="btn btn-danger btn-small" data-action="delete-exam" data-id="${e.id}">Remove</button></div></article>`;
}
function renderUpcomingRoadmap(todayPlan, dates) {
  const days = dates.slice(1); const dailyBudget = Math.max(30, (Number(state.settings.dailyHours) || 4) * 60); const todayIds = new Set(todayPlan.tasks.map(t => t.id));
  const candidates = makePlan((dailyBudget - 10) / 60 * days.length, []).tasks.filter(t => !todayIds.has(t.id));
  const buckets = days.map(() => []); let dayIndex = 0, used = 0;
  for (const task of candidates) {
    const plannedTask = { ...task, minutes: Math.min(task.minutes, dailyBudget) };
    const load = plannedTask.minutes + (buckets[dayIndex]?.length ? 8 : 0);
    if (used + load > dailyBudget) { dayIndex++; used = 0; }
    if (dayIndex >= buckets.length) break;
    buckets[dayIndex].push(plannedTask); used += plannedTask.minutes + (buckets[dayIndex].length > 1 ? 8 : 0);
  }
  return `<details class="card panel roadmap-panel"><summary class="roadmap-summary"><div><div class="panel-title">The next six days</div><div class="panel-subtitle">A practical preview, hidden until you need it.</div></div><span class="eyebrow">SHOW WEEK <span aria-hidden="true">+</span></span></summary><div class="roadmap-list">${days.map((date,i)=>{const tasks=buckets[i];return `<section class="roadmap-day" aria-label="${esc(fmtDate(date,{weekday:'long',month:'long',day:'numeric'}))}"><div class="roadmap-date"><strong>${i===0?'Tomorrow':fmtDay(parseDate(date))}</strong><small>${fmtDate(date,{month:'short',day:'numeric'})}</small></div><div class="roadmap-tasks">${tasks.length?tasks.map(t=>`<div class="roadmap-task"><span class="roadmap-dot" style="background:${COLORS[t.color%COLORS.length].bar}" aria-hidden="true"></span><span class="roadmap-task-copy"><strong>${esc(t.subject)} · ${esc(t.name)}</strong><small>${esc(t.unit)} · ${fmtDuration(t.minutes)}${t.isDue?' · revision':''}</small></span><button class="btn btn-soft btn-small" data-action="start-topic" data-id="${t.id}" aria-label="Study ${esc(t.name)} on ${esc(fmtDate(date,{weekday:'long'}))}">Start</button></div>`).join(''):'<p class="roadmap-rest">Open time — no topic is scheduled yet.</p>'}</div></section>`}).join('')}</div></details>`;
}
function renderPlan() {
  const plan = makePlan(); const dates = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return localDate(d); });
  const tasks = plan.tasks.map((t, i) => `<div class="task-row"><span class="task-time">${String(9 + Math.floor(t.startMinute / 60)).padStart(2, '0')}:${String(t.startMinute % 60).padStart(2, '0')}</span><span class="task-dot" style="background:${COLORS[t.color % COLORS.length].bar}"></span><div class="task-name">${esc(t.subject)} → ${esc(t.name)}<small>${esc(t.unit)} · ${t.isDue ? 'Spaced review due' : t.exam ? `${t.days}d until ${esc(t.exam.name)}` : 'Build semester foundations'} · ${t.reads} previous reads</small></div><span class="task-duration">${fmtDuration(t.minutes)}</span><button class="btn btn-soft btn-small" data-action="start-topic" data-id="${t.id}">Start</button></div>`).join('');
  const upcoming = state.exams.filter(e => daysBetween(new Date(), parseDate(e.date)) > 0).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  return `${pageHeading('A PLAN THAT ADAPTS', 'A clear next step, each day.', 'Your plan follows exam dates, topic confidence, revision due dates, and the time you have today.', `<button class="btn btn-outline" data-action="show-timer">◷ Open timer</button>`)}${plan.risk ? `<div class="risk-banner"><span>◈</span><div><strong>Potential pace warning for ${esc(plan.next.name)}.</strong> About ${fmtDuration(plan.remaining)} remains for ${plan.daysLeft} days. Your current target is ${Number(state.settings.dailyHours).toFixed(1)}h/day; consider a one-day time budget below or an adjusted daily target.</div></div>` : ''}<div class="plan-controls"><span>◷</span><label for="todayHours">I have today</label><input id="todayHours" type="number" min="0.5" max="16" step="0.5" value="${Number(state.settings.todayHours ?? state.settings.dailyHours)}"><span style="font-size:9px;color:#888">hours</span><label for="skipSubject">Skip</label><select id="skipSubject" class="select"><option value="">No subject</option>${state.subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><button class="btn btn-soft btn-small" data-action="replan">↻ Rebalance</button></div><div class="grid lower-grid"><div><article class="card plan-day"><div class="plan-day-head"><div><h3>Today's focus</h3><span style="font-size:8px;color:#999">${fmtDate(localDate(), { weekday: 'long', month: 'long', day: 'numeric' })}</span></div><span>${fmtDuration(plan.used)} planned · ${Number(state.settings.todayHours ?? state.settings.dailyHours)}h budget</span></div>${tasks ? tasks : `<div class="empty-state"><h3>No study topics in today's plan</h3><p>Add topics to your syllabus or reduce today's skipped subjects.</p><button class="btn btn-soft btn-small" data-view="syllabus">Open syllabus</button></div>`}</article>${renderUpcomingRoadmap(plan, dates)}</div><div><article class="card panel"><div class="panel-head"><div><div class="panel-title">Coming up</div><div class="panel-subtitle">Checkpoint dates shape the priority</div></div><button class="text-link" data-view="exams">All exams →</button></div>${upcoming.length ? `<div class="subject-list">${upcoming.map(e => `<div class="subject-row"><div class="subject-mark" style="background:#fff3df;color:#ad8338">${parseDate(e.date).getDate()}</div><div class="subject-info"><strong>${esc(e.name)}</strong><small>${fmtDate(e.date)} · ${(e.topicIds || []).length} topics</small></div></div>`).join('')}</div>` : `<div class="empty-state"><p>Add exam dates to help prioritize your topics.</p><button class="btn btn-soft btn-small" data-action="open-exam">+ Add exam</button></div>`}</article><article class="card panel section-gap"><div class="panel-head"><div><div class="panel-title">Revision loop</div><div class="panel-subtitle">Spaced reviews keep ready topics warm</div></div></div><div class="goal-display">${dueTopics().length}<small> due now</small></div><p style="font-size:8px;color:#999">Next 7 days: ${dueInDays().length} scheduled reviews. A successful pass gently lengthens the interval; a missed one resets it.</p><button class="btn btn-outline btn-small" data-view="syllabus">Review syllabus statuses</button></article></div></div>`;
}
function renderMetrics() {
  const total = statusCount(), streak = getStreak(), mins = weeklyMinutes(), reads = total.reads;
  const dayList = Array.from({ length: 84 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 83 + i); const ds = localDate(d); const m = state.sessions.filter(s => localDate(new Date(s.startAt)) === ds).reduce((a, s) => a + s.minutes, 0); return { d, m }; });
  const max = Math.max(60, ...dayList.map(x => x.m));
  const heat = dayList.map(x => `<div class="heat-cell ${x.m ? `level-${Math.min(4, Math.ceil(x.m / max * 4))}` : ''}" title="${fmtDate(localDate(x.d), { month: 'short', day: 'numeric' })}: ${x.m ? fmtDuration(x.m) : 'no study'}"></div>`).join('');
  const weekly = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); const ds = localDate(d); return { d, m: state.sessions.filter(s => localDate(new Date(s.startAt)) === ds).reduce((a, s) => a + s.minutes, 0) }; });
  const wmax = Math.max(60, ...weekly.map(x => x.m));
  const bars = weekly.map(x => `<div class="bar-column"><div class="bar-fill" style="height:${Math.max(x.m ? 4 : 1, x.m / wmax * 100)}%" title="${fmtDuration(x.m)}"></div><small>${fmtDay(x.d)}</small></div>`).join('');
  const assigned = allTopics().filter(t => nearestExamFor(t)); const ready = assigned.filter(t => t.status === 'ready').length; const confidence = assigned.length ? Math.round((ready + assigned.filter(t => t.status === 'review').length * .45) / assigned.length * 100) : 0; const next = futureExams()[0];
  const forecast = next ? Math.min(100, Math.round(confidence + Math.max(0, 30 - daysBetween(new Date(), parseDate(next.date))) * (Number(state.settings.dailyHours) / 10))) : confidence;
  const onTime = allTopics().filter(t => t.status === 'ready' && t.nextReviewAt).length; const reviewed = allTopics().filter(t => (t.readHistory || []).length > 1).length; const health = onTime + reviewed ? Math.min(100, Math.round((reviewed / Math.max(1, onTime + reviewed)) * 100)) : 0;
  return `${pageHeading('YOUR EFFORT, MADE VISIBLE', 'Small steps add up.', 'Metrics are calculated from your local study sessions and the syllabus you track.', `<button class="btn btn-outline" data-action="export-data">⇩ Export my data</button>`)}<section class="grid metrics-row">${metricCard('TOTAL TOPIC READS', reads, 'Semester-long count · never auto-resets', '↻', 'blue')}${metricCard('CURRENT STREAK', `${streak}<small style="font:500 10px var(--font);color:#999"> days</small>`, 'Consecutive days with study logged', '✳', 'lav')}${metricCard('FOCUS TIME · 7 DAYS', `${(mins / 60).toFixed(1)}<small style="font:500 10px var(--font);color:#999">h</small>`, `${state.sessions.length} total sessions logged`, '◷', 'gold')}${metricCard('REVISION HEALTH', `${health}<small style="font:500 10px var(--font);color:#999">%</small>`, `${dueTopics().length} reviews due right now`, '♡', 'pink')}</section><section class="grid insight-grid"><article class="card metric-large"><div class="panel-head"><div><div class="panel-title">Your study rhythm</div><div class="panel-subtitle">A 12-week heatmap of logged study time</div></div><div class="eyebrow">LESS <span style="color:#9f91de">■ ■ ■ ■</span> MORE</div></div><div class="heatmap">${heat}</div><div class="heatmap-labels">${dayList.filter((_, i) => i % 7 === 0).map(x => `<span>${x.d.toLocaleDateString(undefined, { month: 'short' })}</span>`).join('')}</div></article><article class="card metric-large"><div class="panel-head"><div><div class="panel-title">Time, day by day</div><div class="panel-subtitle">Actual minutes from your timer</div></div><span class="eyebrow">LAST 7 DAYS</span></div><div class="bar-chart">${bars}</div><div style="font-size:8px;color:#aaa;margin-top:9px">${(mins / 60).toFixed(1)} hours total this week</div></article><article class="card metric-large"><div class="panel-head"><div><div class="panel-title">Checkpoint confidence</div><div class="panel-subtitle">Ready and review statuses in linked topics</div></div></div><div class="goal-display">${confidence}%<small> ready today</small></div><div class="progress-track" style="height:8px;margin:10px 0 7px"><span style="width:${confidence}%"></span></div><p style="font-size:8px;color:#999;line-height:1.7">${next ? `Next checkpoint: ${esc(next.name)} on ${fmtDate(next.date)}. At your configured study target, the simple forecast is about ${forecast}% ready.` : 'Add an exam and link topics to see a confidence forecast.'}</p></article><article class="card metric-large"><div class="panel-head"><div><div class="panel-title">Reads by subject</div><div class="panel-subtitle">Every completed timer session counts as a read</div></div></div>${state.subjects.length ? `<div class="subject-list">${state.subjects.map(s => { const c = statusCount(s.id); return `<div class="subject-row"><div class="subject-mark" style="background:${COLORS[s.color % COLORS.length].bg};color:${COLORS[s.color % COLORS.length].fg}">${s.name.slice(0, 2).toUpperCase()}</div><div class="subject-info"><strong>${esc(s.name)}</strong><small>${c.reads} reads · ${c.total} topics</small><div class="progress-track"><span style="width:${Math.min(100, c.total ? (c.ready + c.review * .45) / c.total * 100 : 0)}%"></span></div></div><div class="subject-percent">${c.total ? Math.round((c.ready + c.review * .45) / c.total * 100) : 0}%</div></div>`; }).join('')}</div>` : `<div class="empty-state"><p>Add subjects to see semester-wide reading progress.</p><button class="btn btn-soft btn-small" data-view="syllabus">Add syllabus</button></div>`}</article></section>`;
}
function renderSettings() {
  return `${pageHeading('YOUR STUDY, YOUR RULES', 'Settings & backups.', 'Set your AI provider, study goals, and keep a portable backup of your semester.', '')}<section class="grid settings-grid"><article class="card setting-card"><h3>AI study assistant</h3><p>Use your own API key for syllabus organization, exam circular reading, or practice questions. AI is optional; the planner works without it.</p><div class="field"><label for="provider">Provider</label><select id="provider">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${state.settings.provider === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div><div class="field"><label for="model">Model</label><select id="modelPreset" aria-label="Model preset">${(PROVIDERS[state.settings.provider]?.models || []).map(m => `<option value="${m}" ${m === state.settings.model ? 'selected' : ''}>${m}</option>`).join('')}<option value="__custom" ${(PROVIDERS[state.settings.provider]?.models || []).includes(state.settings.model) ? '' : 'selected'}>Custom model name…</option></select><input id="model" value="${esc(state.settings.model)}" placeholder="${esc(PROVIDERS[state.settings.provider]?.model || '')}" autocomplete="off" spellcheck="false" style="margin-top:8px" /><span class="field-help">Suggested for ${PROVIDERS[state.settings.provider]?.label}: ${(PROVIDERS[state.settings.provider]?.models || []).join(' · ')}. Use a vision-capable model to read timetable images.</span></div><div class="field"><label for="apiKey">API key</label><div class="key-row"><input id="apiKey" type="password" value="${esc(state.settings.apiKey)}" placeholder="${esc(PROVIDERS[state.settings.provider]?.hint || 'Paste your provider key')}" autocomplete="off" spellcheck="false" autocapitalize="off"/><button type="button" class="btn btn-outline btn-small" data-action="toggle-key" aria-pressed="false">Show</button></div><span class="key-status ${state.settings.apiKey ? (keyLooksValid(state.settings.provider, state.settings.apiKey) ? 'ok' : 'warn') : ''}" id="keyStatus" role="status">${state.settings.apiKey ? (keyLooksValid(state.settings.provider, state.settings.apiKey) ? '● Key saved on this device' : '● Saved, but the format looks unusual for this provider') : '○ No key — manual import and the local planner still work'}</span><span class="field-help">Stored only in this browser. Requests go straight from your browser to the provider. Backups never include your key. Use a restricted key with a spending limit, and never save it on a shared device.</span></div><div class="settings-actions"><button class="btn btn-primary" data-action="save-settings">Save AI settings</button><button class="btn btn-outline" data-action="test-ai">Test connection</button><button class="btn btn-outline" data-action="forget-key">Forget key</button></div><div class="privacy-box">◉ &nbsp;No app backend or account. Your syllabus, study history, settings, and API key are stored locally on this device. The configured AI provider receives only the content you explicitly ask it to process.</div></article><article class="card setting-card"><h3>Study goals</h3><p>Set a realistic daily target. Change a one-day budget from the Study plan screen whenever life gets busy.</p><div class="field"><label for="dailyHours">Daily study target</label><input id="dailyHours" type="number" min="0.5" max="16" step="0.5" value="${Number(state.settings.dailyHours)}"/></div><div class="field"><label for="readGoal">Reads you want per topic before an exam</label><input id="readGoal" type="number" min="1" max="20" step="1" value="${Number(state.settings.readGoal)}"/><span class="field-help">This is a tracking goal, not a forced reset. Topic reads continue across all mids and finals.</span></div><div class="settings-actions"><button class="btn btn-primary" data-action="save-settings">Save goals</button></div><hr class="divider"><h3>Semester</h3><p>End semester is the only action that clears the current semester. Export a backup first if you want to keep its full reading history.</p><div class="field"><label for="semesterName">Semester label</label><input id="semesterName" value="${esc(state.semesterName)}" maxlength="48" /></div><div class="settings-actions"><button class="btn btn-outline" data-action="rename-semester">Save label</button><button class="btn btn-danger" data-action="end-semester">End semester</button></div></article><article class="card setting-card"><h3>Back up & move devices</h3><p>Export a JSON file to move your data to another browser. Import replaces the current workspace, so it is wise to export first.</p><div class="settings-actions"><button class="btn btn-primary" data-action="export-data">⇩ Export all data</button><button class="btn btn-outline" data-action="import-data">⇧ Import backup</button><input id="backupFile" type="file" accept=".json,application/json" hidden /></div><div class="privacy-box">Your data is not synced between devices. Export a backup on one device and import it on the other. Keep the backup private because it may contain your syllabus and provider key.</div></article><article class="card setting-card"><h3>How planning works</h3><p>The plan is an explainable local algorithm—not a black box.</p><div class="toggle-row"><span>Unknown topics + time estimate</span><strong>Prioritized</strong></div><div class="toggle-row"><span>Exam proximity + linked units</span><strong>Rebalanced</strong></div><div class="toggle-row"><span>Ready topics + review date</span><strong>Spaced</strong></div><div class="toggle-row"><span>Completed sessions</span><strong>Learned pace</strong></div><div class="toggle-row"><span>Passed mid checkpoints</span><strong>History kept</strong></div><div class="help-box">Finishing a timer session adds one topic read and logs actual minutes. Marking a topic Ready schedules a revisit. A successful revisit stretches the interval; a missed one moves it closer.</div></article></section>`;
}
function openModal(title, subtitle, body, actions = '<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="modal-save">Save</button>') {
  if (!document.querySelector('#modalRoot [role="dialog"]')) modalReturnFocus = document.activeElement;
  document.getElementById('modalRoot').innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle" aria-describedby="modalDescription" tabindex="-1"><div class="modal-head"><div><h2 id="modalTitle">${title}</h2><p id="modalDescription">${subtitle}</p></div><button class="modal-close" data-action="close-modal" aria-label="Close dialog">×</button></div><div class="modal-body">${body}</div><div class="modal-actions">${actions}</div></section></div>`;
  requestAnimationFrame(() => document.querySelector('#modalRoot [role="dialog"] button,#modalRoot [role="dialog"] input:not([type="hidden"]),#modalRoot [role="dialog"] textarea,#modalRoot [role="dialog"] select')?.focus());
}
function closeModal() { aiAbort?.abort(); document.getElementById('modalRoot').innerHTML = ''; if (modalReturnFocus?.isConnected) modalReturnFocus.focus(); modalReturnFocus = null; }
function setMenuOpen(open) { const sidebar = document.getElementById('sidebar'); const trigger = document.querySelector('[data-action="menu"]'); const scrim = document.getElementById('sidebarScrim'); const wasOpen = sidebar?.classList.contains('open'); sidebar?.classList.toggle('open', open); scrim?.classList.toggle('open', open); trigger?.setAttribute('aria-expanded', String(open)); document.body.classList.toggle('menu-open', open); if (open && !wasOpen) { menuReturnFocus = document.activeElement; requestAnimationFrame(() => sidebar?.querySelector('.nav-link')?.focus()); } else if (!open && wasOpen) { (menuReturnFocus?.isConnected ? menuReturnFocus : trigger)?.focus(); menuReturnFocus = null; } }
function showHelp() {
  openModal('How ExamFlow helps', 'A simple loop turns a big semester into small, trackable actions.', `<div class="help-box"><strong>1. Import once.</strong><p>Upload your complete text-based syllabus PDF or paste the whole outline. With an AI key, ExamFlow identifies multiple subjects, units, and topics. Review the parse before it is saved. Re-importing merges matches rather than resetting progress.</p><strong>2. Add checkpoint dates.</strong><p>Create each midterm and final and select the included topics. The same topic may be linked to several exams.</p><strong>3. Follow one next step.</strong><p>Your local plan prioritizes unknown topics, approaching exams, your actual session pace, and reviews due today. Change today's available hours whenever your day changes.</p><strong>4. Keep your history.</strong><p>Finish a timer session to log one read and actual minutes. Mark confidence as Unknown, Review, or Ready. A past checkpoint never clears topic reads.</p><strong>Your privacy.</strong><p>Study data stays in this browser. AI parsing is optional; if used, only the content you request and your own key go directly to the selected AI provider.</p></div>`, '<button class="btn btn-outline" data-action="close-modal">Got it</button><button class="btn btn-soft" data-action="start-tour">Replay tour</button><button class="btn btn-primary" data-action="open-import-syllabus">Import my syllabus</button>');
}
function toast(message, type = '') { const root = document.getElementById('toastRoot'); const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = message; root.appendChild(el); setTimeout(() => el.remove(), 3400); }
function showSubjectModal() {
  openModal('Add a subject', 'Add units and topics; you can edit them whenever you like.', `<form id="subjectForm"><div class="field"><label for="subjectName">Subject name</label><input id="subjectName" name="name" required maxlength="80" placeholder="e.g. Data Structures & Algorithms" /></div><div class="field"><label for="syllabusText">Syllabus input</label><textarea id="syllabusText" name="syllabus" placeholder="One topic per line. Optional unit headings work too:\nUnit 1: Foundations\nArrays\nLinked lists\nUnit 2: Trees\nBinary search trees"></textarea><span class="field-help">Paste plain text, or use the PDF button below. Lines like “Unit 1: Title” become units; other lines become topics.</span></div><div class="row"><button type="button" class="btn btn-outline btn-small" data-action="choose-subject-pdf">▤ Upload PDF</button><input id="pdfFile" type="file" accept="application/pdf" hidden><button type="button" class="btn btn-soft btn-small" data-action="ai-split">✦ Organize with AI</button></div><div id="parseStatus" class="field-help" style="margin-top:9px"></div></form>`, `<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-subject">Add subject</button>`);
}
function showImportSyllabus() {
  openModal('Import your full syllabus', 'Upload one or more text-based PDFs or paste the complete syllabus. ExamFlow will find every subject, unit, and topic, then show you an editable review before adding anything.', `<div class="import-drop"><div><div class="import-drop-icon" aria-hidden="true">▤</div><strong>Choose syllabus PDFs</strong><p class="field-help">Text-based PDF · up to 50 MB each. Files are read in this browser; nothing is added until you confirm.</p><button type="button" class="btn btn-outline btn-small" data-action="choose-bulk-pdf">Choose PDF files</button><input id="bulkPdfFiles" type="file" accept="application/pdf" multiple hidden></div></div><div id="bulkImportStatus" class="field-help" role="status" aria-live="polite" style="margin:12px 0"></div><div class="field"><label for="bulkSyllabusText">Or paste the full syllabus text</label><textarea id="bulkSyllabusText" placeholder="Paste all pages here. Include course/subject names and unit headings if available."></textarea><span class="field-help">With an API key (Settings), the text is split into sections and sent to your selected provider; usage may be billed. Without a key, ExamFlow scans for “Subject:” / course-code headings locally. You review everything before saving.</span></div><div class="field"><label for="manualBulkName">Manual import subject name (no AI)</label><input id="manualBulkName" placeholder="e.g. Data Structures & Algorithms" autocomplete="off"></div><div class="row wrap"><button class="btn btn-primary" data-action="parse-bulk-syllabus">✦ Find all subjects & topics</button><button class="btn btn-soft" data-action="manual-bulk-syllabus">Preview as one subject</button></div>`, '<button class="btn btn-outline" data-action="close-modal">Close</button>');
}
function parseSyllabus(text) {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean); const units = []; let current = null;
  const unitPattern = /^(?:unit|module|chapter|section)\s*([\w.-]+)?\s*[:\-–.)]?\s*(.*)$/i;
  for (let line of lines) {
    line = line.replace(/^[-*•\d.)\s]+/, '').trim(); if (!line) continue;
    const m = line.match(unitPattern);
    if (m) { current = { name: `Unit ${m[1] || units.length + 1}${m[2] ? ` · ${m[2]}` : ''}`, topics: [] }; units.push(current); continue; }
    if (!current) { current = { name: `Unit ${units.length + 1}`, topics: [] }; units.push(current); }
    current.topics.push(line.replace(/[:;]$/, ''));
  }
  return units.filter(u => u.topics.length);
}
function mergeParsedBatches(batches) {
  const merged = [];
  for (const batch of batches) for (const raw of batch.subjects || []) {
    const name = String(raw.name || raw.subject || '').trim(); if (!name) continue;
    let subject = merged.find(s => normalizeKey(s.name) === normalizeKey(name));
    if (!subject) { subject = { name, units: [] }; merged.push(subject); }
    for (const rawUnit of raw.units || []) {
      const unitName = String(rawUnit.name || rawUnit.unit || '').trim() || `Unit ${subject.units.length + 1}`;
      const ordinal = unitName.match(/^(?:unit|module|chapter|section)\s*([\p{L}\p{N}.-]+)/iu)?.[1];
      const unitKey = ordinal ? `unit ${normalizeKey(ordinal)}` : normalizeKey(unitName);
      let unit = subject.units.find(u => u._key === unitKey);
      if (!unit) { unit = { name: unitName, topics: [], _key: unitKey }; subject.units.push(unit); }
      for (const value of rawUnit.topics || []) {
        const topicName = String(typeof value === 'string' ? value : value?.name || value?.topic || '').trim();
        if (topicName && !unit.topics.some(t => normalizeKey(t) === normalizeKey(topicName))) unit.topics.push(topicName);
      }
    }
  }
  return merged.map(s => ({ name: s.name, units: s.units.filter(u => u.topics.length).map(u => ({ name: u.name, topics: u.topics })) })).filter(s => s.units.length);
}
function parseImportedSubjectsJSON(text) {
  let data; try { data = JSON.parse(text); } catch (error) { throw new Error(`Please fix the JSON syntax in the preview. ${error.message}`); }
  const subjects = mergeParsedBatches(Array.isArray(data) ? [{ subjects: data }] : [data]);
  if (!subjects.length) throw new Error('No subjects and topics were found. Check the parsed content or import a text-based PDF.');
  return subjects;
}
function mergeImportedSubjects(incoming) {
  const report = { subjectsAdded: 0, subjectsMatched: 0, unitsAdded: 0, topicsAdded: 0, duplicatesSkipped: 0 };
  for (const source of incoming) {
    const name = String(source.name || '').trim(); if (!name) continue;
    let target = state.subjects.find(s => normalizeKey(s.name) === normalizeKey(name));
    if (!target) { target = { id: uid('sub'), name, color: state.subjects.length % COLORS.length, units: [] }; state.subjects.push(target); report.subjectsAdded++; }
    else report.subjectsMatched++;
    if (!Array.isArray(target.units)) target.units = [];
    for (const incomingUnit of source.units || []) {
      const unitName = String(incomingUnit.name || '').trim() || `Unit ${target.units.length + 1}`;
      const ordinal = unitName.match(/^(?:unit|module|chapter|section)\s*([\p{L}\p{N}.-]+)/iu)?.[1];
      const key = ordinal ? `unit ${normalizeKey(ordinal)}` : normalizeKey(unitName);
      let unit = target.units.find(u => (u._mergeKey || (() => { const m = String(u.name).match(/^(?:unit|module|chapter|section)\s*([\p{L}\p{N}.-]+)/iu); return m ? `unit ${normalizeKey(m[1])}` : normalizeKey(u.name); })()) === key);
      if (!unit) { unit = { id: uid('unit'), name: unitName, topics: [] }; target.units.push(unit); report.unitsAdded++; }
      if (!Array.isArray(unit.topics)) unit.topics = [];
      for (const rawTopic of incomingUnit.topics || []) {
        const topicName = String(typeof rawTopic === 'string' ? rawTopic : rawTopic?.name || rawTopic?.topic || '').trim();
        if (!topicName) continue;
        if (unit.topics.some(t => normalizeKey(t.name) === normalizeKey(topicName))) { report.duplicatesSkipped++; continue; }
        unit.topics.push(topicRecord(topicName)); report.topicsAdded++;
      }
    }
  }
  return report;
}
function syllabusPreviewMarkup(subjects) {
  const counts = subjects.reduce((a, s) => ({ subjects: a.subjects + 1, units: a.units + s.units.length, topics: a.topics + s.units.reduce((n, u) => n + u.topics.length, 0) }), { subjects: 0, units: 0, topics: 0 });
  const matches = subjects.filter(s => state.subjects.some(old => normalizeKey(old.name) === normalizeKey(s.name))).length;
  const editor = subjects.map((subject, si) => `<details class="import-preview-subject" ${si === 0 ? 'open' : ''}><summary><span><strong>${esc(subject.name)}</strong><small>${subject.units.length} units · ${subject.units.reduce((n,u)=>n+u.topics.length,0)} topics</small></span><span class="preview-chevron" aria-hidden="true">⌄</span></summary><div class="import-subject-editor"><div class="field"><label for="previewSubject${si}">Subject name</label><input id="previewSubject${si}" data-preview-subject-name value="${esc(subject.name)}" maxlength="100"></div>${subject.units.map((unit,ui)=>`<details class="import-preview-unit" ${ui===0?'open':''}><summary><span><strong>${esc(unit.name)}</strong><small>${unit.topics.length} topics</small></span><span class="preview-chevron" aria-hidden="true">⌄</span></summary><div class="import-unit-editor"><div class="field"><label for="previewUnit${si}_${ui}">Unit name</label><input id="previewUnit${si}_${ui}" data-preview-unit-name="${si}" data-unit-index="${ui}" value="${esc(unit.name)}" maxlength="100"></div><div class="field"><label for="previewTopics${si}_${ui}">Topics <span class="muted">· one per line</span></label><textarea id="previewTopics${si}_${ui}" data-preview-topics="${si}" data-unit-index="${ui}" rows="${Math.min(8,Math.max(3,unit.topics.length))}">${esc(unit.topics.join('\n'))}</textarea></div></div></details>`).join('')}</div></details>`).join('');
  openModal('Review extracted syllabus', 'Nothing has been saved yet. Expand a subject or unit to edit its name and topics. Matching existing entries merge without resetting study history.', `<div class="import-summary"><div><strong>${counts.subjects}</strong><small>subjects found</small></div><div><strong>${counts.units}</strong><small>units found</small></div><div><strong>${counts.topics}</strong><small>topics found</small></div></div><p class="field-help" style="margin:12px 0">${matches ? `${matches} subject${matches === 1 ? '' : 's'} match your existing syllabus and will merge.` : 'Existing subjects, units, and topics will be checked to prevent duplicates.'} Review the extracted items below before importing.</p><div class="import-preview-list">${editor}</div><div id="bulkMergeStatus" class="field-help" role="status" aria-live="polite"></div>`, '<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-syllabus-import">Merge into my syllabus</button>');
}
function readSyllabusPreview() {
  return [...document.querySelectorAll('[data-preview-subject-name]')].map((input, si) => ({ name: input.value.trim(), units: [...document.querySelectorAll(`[data-preview-unit-name="${si}"]`)].map((unitInput, ui) => ({ name: unitInput.value.trim(), topics: (document.querySelector(`[data-preview-topics="${si}"][data-unit-index="${ui}"]`)?.value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean) })) }));
}
function splitIntoChunks(text, limit = 12000) {
  const paras = text.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean); const chunks = []; let current = '';
  for (const para of paras) {
    if (para.length > limit) {
      if (current) { chunks.push(current); current = ''; }
      let rest = para;
      while (rest.length > limit) { let cut = rest.lastIndexOf('\n', limit); if (cut < limit * .55) cut = rest.lastIndexOf(' ', limit); if (cut < limit * .55) cut = limit; chunks.push(rest.slice(0, cut)); rest = rest.slice(cut).trim(); }
      if (rest) current = rest;
    } else if (current.length + para.length + 2 > limit) { chunks.push(current); current = para; }
    else current += `${current ? '\n\n' : ''}${para}`;
  }
  if (current) chunks.push(current);
  return chunks;
}
async function extractPdfText(file, progress = () => {}) {
  if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} is over the 50 MB per-file limit.`);
  if (!window.pdfjsLibExamFlow) {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    window.pdfjsLibExamFlow = pdfjs;
  }
  const data = new Uint8Array(await file.arrayBuffer()); const pdf = await window.pdfjsLibExamFlow.getDocument({ data }).promise;
  if (pdf.numPages > 500) throw new Error(`${file.name} has ${pdf.numPages} pages. Please split it into files of 500 pages or fewer.`);
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i); const content = await page.getTextContent();
    const items = content.items.filter(x => x.str?.trim()).map(x => ({ text: x.str.trim(), y: x.transform?.[5] ?? 0, x: x.transform?.[4] ?? 0 })).sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = []; let currentY = null, line = '';
    for (const item of items) { if (currentY === null || Math.abs(item.y - currentY) > 3) { if (line) lines.push(line); line = item.text; currentY = item.y; } else line += `${line && !/[\s-]$/.test(line) ? ' ' : ''}${item.text}`; }
    if (line) lines.push(line);
    pages.push(`--- Page ${i} ---\n${lines.join('\n')}`); progress(i, pdf.numPages);
  }
  const text = pages.join('\n\n');
  if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 40) throw new Error(`${file.name} has almost no selectable text. It may be a scanned/image-only PDF; paste text or use OCR before importing.`);
  return { text, pages: pdf.numPages };
}
function localSplitSubjects(text) {
  const head = /^\s*(?:(?:subject|course|paper)(?:\s*(?:title|name|code))?\s*[:\-–—]\s*(.{3,90})|([A-Z]{2,5}\s?-?\d{2,4}[A-Z]?)\s*[:\-–—]\s*(.{3,90}))\s*$/i;
  const lines = text.split(/\r?\n/); const blocks = []; let cur = null;
  for (const raw of lines) { const line = raw.trim(); const m = line.match(head);
    if (m && !/^(?:unit|module|chapter)/i.test(line)) { cur = { name: (m[1] || `${m[2]} ${m[3]}`).replace(/\s+/g, ' ').trim(), body: [] }; blocks.push(cur); }
    else if (cur && line && !/^---\s*Page/i.test(line) && !/^Source file:/i.test(line)) cur.body.push(line); }
  return blocks.map(b => ({ name: b.name, units: parseSyllabus(b.body.join('\n')) })).filter(s => s.units.length);
}
async function parseWholeSyllabus(text, hooks = {}) {
  if (!String(state.settings.apiKey || '').trim()) {
    const local = localSplitSubjects(text); if (local.length) { hooks.onNote?.('No API key — used the built-in heading detector. Review carefully.'); return local; }
    throw new Error('No subject headings were detected automatically. Add an API key in Settings for AI parsing, or use “Preview as one subject”.');
  }
  const chunks = splitIntoChunks(text, 9000); const results = new Array(chunks.length).fill(null); const failed = [];
  const system = 'You extract academic syllabus structure from document excerpts. Return ONLY valid JSON: {"subjects":[{"name":"Exact subject/course name","units":[{"name":"Unit 1 · title","topics":["specific topic"]}]}]}. Preserve every subject, unit and meaningful topic actually present. Never invent content. Ignore page numbers, headers, footers, grading rules and boilerplate. Keep subject names identical across excerpts. If an excerpt has no subject name, use "Unassigned subject". Topics must be concise and faithful to the source.';
  aiAbort = new AbortController(); const signal = aiAbort.signal; let done = 0, next = 0;
  const worker = async () => {
    while (next < chunks.length && !signal.aborted) {
      const i = next++; let ok = false, lastErr;
      for (let attempt = 0; attempt < 3 && !ok && !signal.aborted; attempt++) {
        try {
          const r = await aiText(system, `Document section ${i + 1} of ${chunks.length}. Extract all subjects, units and topics in this section.\n\n${chunks[i]}`, null, { signal, meta: true, maxTokens: 8192 });
          results[i] = parseJsonReply(r.text, true); ok = true;
        } catch (e) { lastErr = e; if (/Cancelled/.test(e.message) || [401, 403, 404].includes(e.status)) throw e; await new Promise(res => setTimeout(res, 1200 * (attempt + 1))); }
      }
      if (!ok && !signal.aborted) failed.push(`${i + 1}${lastErr ? ` (${lastErr.message.slice(0, 70)})` : ''}`);
      hooks.onProgress?.(++done, chunks.length, failed.length);
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker)); } finally { aiAbort = null; }
  if (signal.aborted) throw new Error('Import cancelled. Nothing was saved.');
  const good = results.filter(Boolean); if (!good.length) throw new Error(`No sections could be parsed. ${failed[0] || ''}`.trim());
  if (failed.length) hooks.onNote?.(`${failed.length} of ${chunks.length} sections failed and were skipped (${failed.slice(0, 3).join('; ')}). Review the result, then re-import those pages if needed.`);
  return mergeParsedBatches(good);
}
async function handleBulkPdfFiles(files) {
  const status = document.getElementById('bulkImportStatus'); const box = document.getElementById('bulkSyllabusText');
  if (!files.length) return;
  if (files.length > 20) { toast('Choose 20 PDFs or fewer at one time.', 'error'); return; }
  let combined = '';
  try {
    for (let i = 0; i < files.length; i++) {
      if (status) status.textContent = `Reading ${files[i].name} · PDF ${i + 1} of ${files.length}…`;
      const result = await extractPdfText(files[i], (page, total) => { if (status && page % 5 === 0) status.textContent = `Reading ${files[i].name} · page ${page} of ${total}…`; });
      combined += `${combined ? '\n\n' : ''}Source file: ${files[i].name}\n${result.text}`;
      if (combined.length > 1_000_000) throw new Error('Extracted text is over 1 million characters. Split the PDFs into smaller parts and import them one at a time.');
    }
    if (box) box.value = combined;
    if (status) status.textContent = `Text extracted from ${files.length} PDF${files.length === 1 ? '' : 's'} (${combined.length.toLocaleString()} characters). Select “Find all subjects & topics” to review the structure before saving.`;
  } catch (e) { if (status) status.textContent = e.message; toast(e.message, 'error'); }
}
async function runBulkSyllabusParse() {
  const text = document.getElementById('bulkSyllabusText')?.value.trim(); if (!text) return toast('Upload a PDF or paste your full syllabus first.', 'error');
  if (text.length > 1_000_000) return toast('This import is over 1 million characters. Split the PDF into smaller parts and import them one at a time.', 'error');
  const buttons = [...document.querySelectorAll('#modalRoot [data-action="parse-bulk-syllabus"]')]; buttons.forEach(b => { b.disabled = true; b.textContent = 'Reading syllabus…'; });
  const status = () => document.getElementById('bulkImportStatus'); let note = '';
  try {
    const hasKey = !!String(state.settings.apiKey || '').trim(); const n = splitIntoChunks(text, 9000).length;
    if (status()) status().textContent = hasKey ? `Preparing ${n} section${n === 1 ? '' : 's'} (3 in parallel). Your provider may bill these requests. Close this window to cancel.` : 'No API key set — scanning for subject headings locally…';
    const subjects = await parseWholeSyllabus(text, { onProgress: (d, t, f) => { if (status()) status().textContent = `Organized ${d} of ${t} sections${f ? ` · ${f} failed` : ''}…`; }, onNote: m => { note = m; } });
    if (!subjects.length) throw new Error('No subjects and topics were detected. Add a course title or split the document by subject.');
    if (!status()) return; closeModal(); pendingSyllabusImport = subjects; syllabusPreviewMarkup(subjects); if (note) toast(note, 'error');
  } catch (e) { if (status()) status().textContent = e.message; toast(e.message, 'error'); }
  finally { buttons.forEach(b => { b.disabled = false; b.textContent = '✦ Find all subjects & topics'; }); }
}
function runManualBulkImport() {
  const name = document.getElementById('manualBulkName')?.value.trim(); const text = document.getElementById('bulkSyllabusText')?.value.trim();
  if (!name) return toast('Enter a subject name for manual import.', 'error'); if (!text) return toast('Paste text or extract text from a PDF first.', 'error');
  const units = parseSyllabus(text); if (!units.length) return toast('Could not find topics in that text. Add one topic per line.', 'error');
  pendingSyllabusImport = [{ name, units }]; closeModal(); syllabusPreviewMarkup(pendingSyllabusImport);
}
function topicRowsMarkup(subjects = state.subjects, selectedIds = []) {
  return `<div class="modal-checklist">${subjects.map(s => `<div style="font-size:8px;font-weight:700;color:#9185cd;padding:6px 2px 3px">${esc(s.name)}</div>${s.units.map(u => `<div class="check-row" style="background:#fafafe;border-radius:7px;margin:3px 0"><label style="display:flex;align-items:center;gap:7px;flex:1"><input type="checkbox" class="unit-check" data-subject="${s.id}" data-unit="${u.id}" ${u.topics.length && u.topics.every(t => selectedIds.includes(t.id)) ? 'checked' : ''}><strong>${esc(u.name)}</strong><span class="muted">${u.topics.length} topics</span></label></div>${u.topics.map(t => `<label class="check-row" style="padding-left:17px"><input type="checkbox" name="topicIds" value="${t.id}" ${selectedIds.includes(t.id) ? 'checked' : ''}><span>${esc(t.name)}</span><small class="muted">${t.reads || 0} reads</small></label>`).join('')}`).join('')}`).join('') || '<div class="muted" style="padding:10px;font-size:9px">Add subjects and topics first.</div>'}</div>`;
}
function showExamModal(existing = null) {
  const e = existing || {}; const chosen = e.topicIds || []; const mode = e.mode || 'quick';
  openModal(existing ? 'Edit checkpoint' : 'Add an exam checkpoint', 'Pick the date and exact units covered. Past checkpoints never erase reading history.', `<form id="examForm"><div class="grid" style="grid-template-columns:1fr 1fr;gap:10px"><div class="field"><label for="examName">Exam / checkpoint name</label><input id="examName" name="name" required maxlength="80" value="${esc(e.name || '')}" placeholder="Mid-1, Mid-2, Finals…"></div><div class="field"><label for="examDate">Date</label><input id="examDate" name="date" type="date" required value="${esc(e.date || localDate(new Date(Date.now() + 7 * 86400000)))}"></div></div><div class="field"><label for="examMode">Planning mode</label><select id="examMode" name="mode"><option value="quick" ${mode === 'quick' ? 'selected' : ''}>Quick exam · one checkpoint</option><option value="mid" ${mode === 'mid' ? 'selected' : ''}>Mid timetable · semester checkpoint</option><option value="final" ${mode === 'final' ? 'selected' : ''}>Final exam · whole-semester review</option></select></div><fieldset class="field"><legend>Choose the units / topics this exam covers</legend>${topicRowsMarkup(state.subjects, chosen)}</fieldset></form>`, `<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-exam" data-id="${e.id || ''}">${existing ? 'Save changes' : 'Add checkpoint'}</button>`);
}
function showTopicModal(subjectId, unitId = '') {
  const s = state.subjects.find(x => x.id === subjectId); if (!s) return;
  openModal('Add a topic', `Add one topic to ${esc(s.name)}.`, `<form id="topicForm"><div class="field"><label for="topicUnit">Unit</label><select id="topicUnit" name="unitId">${s.units.map(u => `<option value="${u.id}" ${u.id === unitId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}<option value="__new__">+ Create a new unit…</option></select></div><div class="field"><label for="newUnit">New unit name (optional)</label><input id="newUnit" name="newUnit" placeholder="e.g. Unit 6 · Applications"></div><div class="field"><label for="topicName">Topic name</label><input id="topicName" name="name" required maxlength="120" placeholder="e.g. Binary search trees"></div></form>`, `<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-topic" data-id="${subjectId}">Add topic</button>`);
}
function startTopic(topicId) {
  const found = findTopic(topicId); if (!found) return toast('Add this topic to a subject first.', 'error');
  if (state.timer) { if (!confirm('A session is already running. Stop it and start this topic?')) return; stopTimer(false); }
  state.timer = { topicId, startedAt: new Date().toISOString(), pausedMs: 0 }; persist(); view = 'plan'; render(); renderTimerModal(); toast(`Timer started: ${found.topic.name}`, 'success');
}
function stopTimer(showMessage = true) {
  if (!state.timer) return;
  const tm = state.timer; const minutes = Math.max(1, Math.round((Date.now() - new Date(tm.startedAt).getTime() - (tm.pausedMs || 0)) / 60000));
  const result = topicRead(tm.topicId, minutes, tm.startedAt); state.timer = null; persist(); render(); if (showMessage && result) toast(`${fmtDuration(minutes)} logged · ${result.topic.name} read ${result.topic.reads} ${result.topic.reads === 1 ? 'time' : 'times'}`, 'success');
}
function updateTimerText() {
  const readout = document.getElementById('timerReadout'); if (!readout || !state.timer) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(state.timer.startedAt).getTime() - (state.timer.pausedMs || 0)) / 1000));
  readout.innerHTML = `${String(Math.floor(elapsed / 3600)).padStart(2, '0')}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}<small>FOCUS TIME</small>`;
}
function renderTimerModal() {
  const topics = allTopics(); const active = state.timer ? findTopic(state.timer.topicId) : null;
  openModal('Focus timer', active ? `Studying ${active.subject.name} · ${active.topic.name}` : 'Choose a topic and get into a focused session.', `<div class="timer-panel"><div class="timer-context">${active ? `${esc(active.unit.name)} · ${esc(active.subject.name)}` : 'One focused session adds a read to your semester history'}</div><div class="timer-ring"><div class="timer-readout" id="timerReadout">00:00:00<small>FOCUS TIME</small></div></div>${active ? `<div class="timer-context">${esc(active.topic.name)} · ${active.topic.reads || 0} ${active.topic.reads === 1 ? 'read' : 'reads'} so far</div>` : `<div class="field" style="max-width:330px;margin:10px auto"><label for="timerTopic">Pick a topic</label><select id="timerTopic">${topics.map(t => `<option value="${t.id}">${esc(t.subject)} · ${esc(t.unit)} · ${esc(t.name)}</option>`).join('')}</select></div>`}<div class="timer-controls" style="margin-top:17px">${active ? `<button class="btn btn-primary" data-action="stop-timer">✓ Finish session</button>` : `<button class="btn btn-primary" data-action="start-selected">▶ Start focus</button>`}</div></div>`, `<button class="btn btn-outline" data-action="close-modal">Close</button>`);
  if (state.timer) updateTimerText();
}
function exportData() {
  const blob = new Blob([JSON.stringify({ ...state, settings: { ...state.settings, apiKey: '' }, timer: null, exportedAt: new Date().toISOString(), app: 'ExamFlow' }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `examflow-backup-${localDate()}.json`; a.click(); URL.revokeObjectURL(a.href); toast('Backup downloaded.', 'success');
}
function importDataFile(file) {
  const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(reader.result); if (!data || !Array.isArray(data.subjects) || !Array.isArray(data.exams) || !Array.isArray(data.sessions)) throw new Error('Not an ExamFlow backup.'); if (!confirm('Import this backup and replace the current browser workspace? Export your current data first if you want to keep it.')) return; const clean = { ...blankState(), ...data, timer: null, settings: { ...blankState().settings, ...(data.settings || {}), apiKey: state.settings.apiKey || '' } }; delete clean.exportedAt; delete clean.app; state = clean; persist(); closeModal(); render(); toast('Backup imported.', 'success'); } catch (e) { toast(`Could not import: ${e.message}`, 'error'); } }; reader.readAsText(file);
}
async function extractPdf(file) {
  const status = document.getElementById('parseStatus'); if (status) status.textContent = 'Loading the in-browser PDF reader…';
  try {
    const result = await extractPdfText(file, (page, total) => { if (status && page % 5 === 0) status.textContent = `Reading page ${page} of ${total}…`; });
    const box = document.getElementById('syllabusText'); if (box) box.value = result.text; if (status) status.textContent = `Extracted ${result.text.length.toLocaleString()} characters from ${result.pages} PDF page${result.pages === 1 ? '' : 's'}. Review it, then save or organize with AI.`;
  } catch (e) { if (status) status.textContent = 'Could not read this PDF. It may be scanned/image-only; paste the text or use AI vision with an exam circular.'; toast('PDF text extraction failed.', 'error'); }
}
const PROVIDERS = {
  gemini:   { label: 'Google Gemini', model: 'gemini-3.8-flash', models: ['gemini-3.8-flash'], hint: 'Starts with “AIza”', test: /^AIza[\w-]{20,}$/ },
  openai:   { label: 'OpenAI',        model: 'gpt-6-luna',       models: ['gpt-6-luna', 'gpt-4o-mini', 'gpt-4o'],       hint: 'Starts with “sk-”',   test: /^sk-[\w-]{20,}$/ },
  anthropic:{ label: 'Anthropic',     model: 'claude-sonnet-5-5', models: ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001'], hint: 'Starts with “sk-ant-”', test: /^sk-ant-[\w-]{20,}$/ }
};
let aiAbort = null;
function keyLooksValid(provider, key) { return !!PROVIDERS[provider]?.test.test(String(key || '').trim()); }
function friendlyAiError(status, provider, raw) {
  const name = PROVIDERS[provider]?.label || 'The provider';
  if (status === 401 || status === 403) return `${name} rejected the API key (HTTP ${status}). Re-paste it in Settings and check that billing/API access is enabled.`;
  if (status === 404) return `${name} could not find that model. Open Settings and pick a model your key can use.`;
  if (status === 429) return `${name} rate limit or quota reached (HTTP 429). Wait a minute, or check your plan's quota.`;
  if (status >= 500) return `${name} is temporarily unavailable (HTTP ${status}). Try again shortly.`;
  return raw || `${name} returned HTTP ${status}. Check the model and key.`;
}
async function aiText(system, user, image = null, opts = {}) {
  const { provider, apiKey, model } = state.settings; const key = String(apiKey || '').trim();
  if (!key) throw new Error('Add an API key in Settings first.');
  const preset = PROVIDERS[provider] || PROVIDERS.gemini; const m = (model || '').trim() || preset.model; const maxTokens = opts.maxTokens || 8192;
  const attempt = async (withTemp) => {
    let url, headers, body;
    if (provider === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`; headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
      const parts = [{ text: `${system}\n\n${user}` }]; if (image) parts.push({ inline_data: { mime_type: image.type || 'image/jpeg', data: image.base64 } });
      body = { contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json', ...(withTemp ? { temperature: .2 } : {}) } };
    } else if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages'; headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
      const content = [{ type: 'text', text: user }]; if (image) content.unshift({ type: 'image', source: { type: 'base64', media_type: image.type || 'image/jpeg', data: image.base64 } });
      body = { model: m, max_tokens: maxTokens, system, messages: [{ role: 'user', content }], ...(withTemp ? { temperature: .2 } : {}) };
    } else {
      url = 'https://api.openai.com/v1/chat/completions'; headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
      const content = image ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: `data:${image.type || 'image/jpeg'};base64,${image.base64}` } }] : user;
      body = { model: m, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content }], ...(withTemp ? { temperature: .2 } : {}) };
    }
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), opts.timeout || 90000);
    const outer = opts.signal; const onAbort = () => ctrl.abort(); outer?.addEventListener('abort', onAbort);
    try {
      let resp; try { resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal }); }
      catch (e) { if (outer?.aborted) throw new Error('Cancelled.'); if (e.name === 'AbortError') throw new Error('The AI request timed out. Try again or use a smaller section.'); throw new Error('Network error (fetch). Check your connection; some networks or extensions block direct API calls.'); }
      let data = {}; try { data = await resp.json(); } catch { /* non-JSON body */ }
      if (!resp.ok) { const raw = data.error?.message || data.message; const e = new Error(friendlyAiError(resp.status, provider, raw)); e.status = resp.status; e.raw = raw || ''; throw e; }
      if (provider === 'gemini') { const c = data.candidates?.[0]; const t = c?.content?.parts?.map(p => p.text || '').join('') || ''; if (!t && data.promptFeedback?.blockReason) throw new Error(`Gemini blocked this content (${data.promptFeedback.blockReason}).`); return { text: t, truncated: c?.finishReason === 'MAX_TOKENS' }; }
      if (provider === 'anthropic') return { text: data.content?.map(p => p.text || '').join('') || '', truncated: data.stop_reason === 'max_tokens' };
      const c = data.choices?.[0]; return { text: c?.message?.content || '', truncated: c?.finish_reason === 'length' };
    } finally { clearTimeout(timer); outer?.removeEventListener('abort', onAbort); }
  };
  let out;
  try { out = await attempt(true); }
  catch (e) { if ((e.status === 400 || e.status === 422) && /temperature/i.test(e.raw || '')) out = await attempt(false); else throw e; }
  if (opts.meta) return out; return out.text;
}
function repairJson(t) {
  let out = '', stack = [], inStr = false, esc = false;
  for (const ch of t) { out += ch; if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; } if (ch === '"') inStr = true; else if (ch === '{' || ch === '[') stack.push(ch); else if (ch === '}' || ch === ']') stack.pop(); }
  if (inStr) out += '"'; out = out.replace(/[,:\s]+$/, ''); if (/"[^"]*"\s*:\s*$/.test(out)) out += 'null';
  while (stack.length) out += stack.pop() === '{' ? '}' : ']'; return out;
}
function parseJsonReply(text, allowRepair = false) {
  const cleaned = String(text || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim(); if (!cleaned) throw new Error('The AI returned an empty reply.');
  const a = cleaned.search(/[{\[]/), b = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']')); const body = a >= 0 ? cleaned.slice(a, b >= a ? b + 1 : undefined) : cleaned;
  try { return JSON.parse(body); } catch (e) { if (!allowRepair) throw e; return JSON.parse(repairJson(a >= 0 ? cleaned.slice(a) : cleaned)); }
}
async function splitSyllabusAI() {
  const text = document.getElementById('syllabusText')?.value.trim(); if (!text) return toast('Paste syllabus text first.', 'error');
  const status = document.getElementById('parseStatus'); status.textContent = 'Asking your provider to organize the syllabus…';
  try { const out = await aiText('You organize academic syllabi. Return only valid JSON with shape {"units":[{"name":"Unit 1: title","topics":["topic"]}]}. Keep all important syllabus items, do not invent a syllabus, and consolidate obvious duplicate lines.', `Organize the following syllabus into units and specific study topics. If unit boundaries are absent, create sensible units.\n\n${text}`); const data = parseJsonReply(out, true); const formatted = (data.units || []).map(u => `${u.name}:\n${(u.topics || []).map(t => `- ${t}`).join('\n')}`).join('\n\n'); if (!formatted) throw new Error('The provider returned no units.'); document.getElementById('syllabusText').value = formatted; status.textContent = 'Organized into units. Review the text, edit if needed, then save the subject.'; }
  catch (e) { status.textContent = e.message; toast(e.message, 'error'); }
}
function fileToBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }
async function readCircular(file) {
  if (!state.settings.apiKey) { closeModal(); toast('Add your provider key in Settings to read circular images.', 'error'); view = 'settings'; render(); return; }
  closeModal(); openModal('Reading exam circular', 'Your selected provider is extracting dates and subjects from the image.', '<div class="empty-state"><div class="empty-icon">◷</div><h3>Reading the circular…</h3><p>Keep this page open. Nothing is saved until you confirm the parsed rows.</p></div>', '<button class="btn btn-outline" data-action="close-modal">Cancel</button>');
  try {
    const image = { type: file.type || 'image/jpeg', base64: await fileToBase64(file) };
    const out = await aiText('You extract examination timetable rows from an image. Return JSON only: {"exams":[{"name":"Mid-1","date":"YYYY-MM-DD","subject":"Subject","units":["Unit 1"]}]}. Use ISO dates. If the year is absent, infer the nearest plausible future date based on today and mark uncertainty in a note field. Do not hallucinate illegible dates; use an empty date string and a note. One subject/date row per entry.', `Today is ${localDate()}. Read every exam row from this circular. Extract name, date, subject, and any explicitly stated units/syllabus coverage.`, image);
    const data = parseJsonReply(out); showParsedExams(data.exams || []);
  } catch (e) { closeModal(); toast(`Could not read circular: ${e.message}`, 'error'); }
}
function showParsedExams(rows) {
  const normalized = rows.map(x => ({ name: x.name || 'Exam', date: x.date || '', subject: x.subject || '', units: Array.isArray(x.units) ? x.units.join(', ') : (x.units || ''), note: x.note || '' }));
  if (!normalized.length) return toast('No exam rows found in that image.', 'error');
  const table = normalized.map((r, i) => `<div class="import-row"><input data-imp="name" data-row="${i}" value="${esc(r.name)}" aria-label="Exam name"><input data-imp="date" data-row="${i}" type="date" value="${/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? esc(r.date) : ''}" aria-label="Exam date"><input data-imp="subject" data-row="${i}" value="${esc(r.subject)}" list="subjectNames" placeholder="Subject" aria-label="Subject"><button class="btn btn-danger btn-small" data-action="remove-import-row" data-row="${i}">×</button><div style="grid-column:1/-1"><input style="width:100%" data-imp="units" data-row="${i}" value="${esc(r.units)}" placeholder="Units, comma-separated"><small class="field-help">${esc(r.note)}</small></div></div>`).join('');
  openModal('Confirm circular dates', 'Review and correct every parsed row. Existing subject/unit names are matched to your syllabus; you can edit the exams after importing.', `<datalist id="subjectNames">${state.subjects.map(s => `<option value="${esc(s.name)}">`).join('')}</datalist><div class="import-rows" id="importRows">${table}</div><button class="btn btn-outline btn-small" style="margin-top:10px" data-action="add-import-row">+ Add another row</button>`, '<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-primary" data-action="save-imported-exams">Add these checkpoints</button>');
}
function addExamRowsToState(rows) {
  let count = 0; let duplicates = 0;
  for (const row of rows) {
    const subjectKey = normalizeKey(row.subject); const subject = subjectKey ? state.subjects.find(s => normalizeKey(s.name) === subjectKey) || state.subjects.find(s => normalizeKey(s.name).includes(subjectKey) || subjectKey.includes(normalizeKey(s.name))) : null;
    const unitTerms = row.units.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    const topicIds = subject ? subject.units.filter(u => !unitTerms.length || unitTerms.some(term => u.name.toLowerCase().includes(term) || term.includes(u.name.toLowerCase()))).flatMap(u => u.topics.map(t => t.id)) : [];
    if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const name = row.name.trim() || 'Exam'; const duplicate = state.exams.find(e => e.date === row.date && normalizeKey(e.name) === normalizeKey(name));
    if (duplicate) { duplicate.topicIds = [...new Set([...(duplicate.topicIds || []), ...topicIds])]; duplicates++; continue; }
    state.exams.push({ id: uid('exam'), name, date: row.date, mode: 'mid', topicIds, createdAt: new Date().toISOString() }); count++;
  }
  persist(); return { count, duplicates };
}
function getImportRows() { return [...document.querySelectorAll('[data-imp="name"]')].map(el => { const i = el.dataset.row; const val = key => document.querySelector(`[data-imp="${key}"][data-row="${i}"]`)?.value || ''; return { name: val('name'), date: val('date'), subject: val('subject'), units: val('units') }; }); }
function openPractice(topicId) {
  const f = findTopic(topicId); if (!f) return;
  openModal('Practice this topic', `${esc(f.subject.name)} · ${esc(f.unit.name)} · ${esc(f.topic.name)}`, `<div id="questionResult" class="help-box">Generate a short practice set with your configured AI provider. Add your answer notes below, then update your confidence status when you are done.</div><div class="field" style="margin-top:12px"><label for="answerNotes">Your answer notes</label><textarea id="answerNotes" placeholder="Write a quick answer, steps, or what felt difficult…"></textarea></div><div class="row"><button class="btn btn-soft btn-small" data-action="generate-questions" data-id="${topicId}">✦ Generate 5 questions</button><span class="field-help">Not saved by default; mark topic status to feed back into your plan.</span></div>`, `<button class="btn btn-outline" data-action="close-modal">Close</button><button class="btn btn-outline" data-action="practice-status" data-id="${topicId}" data-status="review">Mark review</button><button class="btn btn-primary" data-action="practice-status" data-id="${topicId}" data-status="ready">Mark ready</button>`);
}
async function generateQuestions(topicId) {
  const f = findTopic(topicId); if (!f) return;
  const root = document.getElementById('questionResult'); root.textContent = 'Generating a varied set of five questions…';
  try { const out = await aiText('You are a careful tutor. Return valid JSON only with shape {"questions":[{"question":"...","type":"Recall|Apply|Explain|Challenge"}]}. Make five concise questions based only on the given topic, varied in difficulty. No answers unless asked.', `Create 5 study questions for the topic “${f.topic.name}” in ${f.subject.name}, ${f.unit.name}.`); const data = parseJsonReply(out); root.innerHTML = `<strong>Practice set</strong><ol style="padding-left:18px;line-height:1.8">${(data.questions || []).map(q => `<li><span class="status-pill status-review">${esc(q.type || 'Practice')}</span> ${esc(q.question)}</li>`).join('')}</ol>`; }
  catch (e) { root.textContent = e.message; toast(e.message, 'error'); }
}
function sampleWorkspace() {
  if (state.subjects.length && !confirm('Add a sample set of subjects and exams to your current workspace?')) return;
  const specs = [
    ['Data Structures', [['Unit 1 · Foundations', ['Complexity analysis', 'Arrays and linked lists', 'Stacks and queues']], ['Unit 2 · Trees', ['Binary search trees', 'AVL rotations', 'Tree traversals']]]],
    ['Organic Chemistry', [['Unit 1 · Structure', ['Hybridization', 'Resonance and acidity', 'Stereochemistry']], ['Unit 2 · Reactions', ['Substitution mechanisms', 'Elimination reactions', 'Carbonyl chemistry']]]],
    ['Physics II', [['Unit 1 · Fields', ['Electric potential', 'Gauss law', 'Capacitance']], ['Unit 2 · Circuits', ['Kirchhoff laws', 'RC circuits', 'Magnetic induction']]]],
    ['Mathematics', [['Unit 1 · Calculus', ['Partial derivatives', 'Multiple integrals', 'Vector calculus']]]],
    ['Computer Networks', [['Unit 1 · Protocols', ['OSI layers', 'TCP and UDP', 'IP addressing']]]]
  ];
  const made = specs.map(([name, units], i) => ({ id: uid('sub'), name, color: i, units: units.map(([un, topics]) => ({ id: uid('unit'), name: un, topics: topics.map((n, j) => ({ id: uid('topic'), name: n, status: j === 0 && i === 0 ? 'review' : 'unknown', reads: j === 0 && i === 0 ? 1 : 0, readHistory: j === 0 && i === 0 ? [new Date(Date.now() - 86400000).toISOString()] : [], lastReadAt: j === 0 && i === 0 ? new Date(Date.now() - 86400000).toISOString() : null, nextReviewAt: null, reviewStep: 0, estimateMin: 45, priority: 1 })) })) }));
  state.subjects.push(...made); const dt = new Date(); dt.setDate(dt.getDate() + 9); state.exams.push({ id: uid('exam'), name: 'Mid-1', date: localDate(dt), mode: 'mid', topicIds: made.slice(0, 3).flatMap(s => s.units[0].topics.map(t => t.id)), createdAt: new Date().toISOString() }); persist(); view = 'dashboard'; render(); toast('Sample workspace added. Replace it with your real syllabus when ready.', 'success');
}

// One delegated listener keeps the static application easy to deploy and inspect.
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view]'); if (nav) { event.preventDefault(); setMenuOpen(false); view = nav.dataset.view; render(); requestAnimationFrame(() => document.querySelector('.page-heading h1,.intro-card h2')?.focus()); return; }
  const el = event.target.closest('[data-action]'); if (!el) return;
  const action = el.dataset.action, id = el.dataset.id;
  if (action === 'close-modal') return closeModal();
  if (action === 'backdrop' && event.target === el) return closeModal();
  if (action === 'menu') return setMenuOpen(!document.getElementById('sidebar').classList.contains('open'));
  if (action === 'close-menu') return setMenuOpen(false);
  if (action === 'show-help') return showHelp();
  if (action === 'open-subject') return showSubjectModal();
  if (action === 'open-import-syllabus') return showImportSyllabus();
  if (action === 'choose-bulk-pdf') { document.getElementById('bulkPdfFiles')?.click(); return; }
  if (action === 'choose-subject-pdf') { document.getElementById('pdfFile')?.click(); return; }
  if (action === 'parse-bulk-syllabus') return runBulkSyllabusParse();
  if (action === 'manual-bulk-syllabus') return runManualBulkImport();
  if (action === 'save-syllabus-import') {
    try { const draft = readSyllabusPreview(); if (draft.some(s => !s.name)) throw new Error('Give each subject a name before importing.'); const subjects = draft.filter(s => s.units.some(u => u.name && u.topics.length)); if (!subjects.length) throw new Error('Add at least one named unit with a topic before importing.'); const report = mergeImportedSubjects(subjects); if (!report.subjectsAdded && !report.subjectsMatched) throw new Error('No valid subjects were ready to merge.'); persist(); pendingSyllabusImport = []; closeModal(); view = 'syllabus'; render(); toast(`Added ${report.subjectsAdded} subject${report.subjectsAdded === 1 ? '' : 's'} and ${report.topicsAdded} new topic${report.topicsAdded === 1 ? '' : 's'}; ${report.duplicatesSkipped} duplicate topic${report.duplicatesSkipped === 1 ? '' : 's'} skipped. Existing history was kept.`, 'success'); } catch (e) { const status = document.getElementById('bulkMergeStatus'); if (status) status.textContent = e.message; toast(e.message, 'error'); } return;
  }
  if (action === 'open-exam') return showExamModal();
  if (action === 'show-timer') return renderTimerModal();
  if (action === 'start-topic') return startTopic(id);
  if (action === 'stop-timer') { closeModal(); return stopTimer(); }
  if (action === 'start-selected') { const topicId = document.getElementById('timerTopic')?.value; if (!topicId) return toast('Add a topic first.', 'error'); closeModal(); return startTopic(topicId); }
  if (action === 'open-exam' && id) return showExamModal(state.exams.find(x => x.id === id));
  if (action === 'edit-exam') return showExamModal(state.exams.find(x => x.id === id));
  if (action === 'delete-exam') { if (confirm('Remove this exam checkpoint? Topic reading history will stay untouched.')) { state.exams = state.exams.filter(x => x.id !== id); persist(); render(); toast('Checkpoint removed. Topic history is unchanged.'); } return; }
  if (action === 'add-topic') return showTopicModal(id, el.dataset.unit || '');
  if (action === 'rename-subject') { const s = state.subjects.find(x => x.id === id); const name = prompt('Subject name', s?.name || ''); if (name?.trim() && s) { s.name = name.trim(); persist(); render(); } return; }
  if (action === 'delete-subject') { const s = state.subjects.find(x => x.id === id); if (s && confirm(`Delete ${s.name} and its topics? Logged session history remains as a snapshot, but this subject and its exam links will be removed.`)) { const tids = new Set(s.units.flatMap(u => u.topics.map(t => t.id))); state.subjects = state.subjects.filter(x => x.id !== id); state.exams.forEach(e => e.topicIds = (e.topicIds || []).filter(t => !tids.has(t))); persist(); render(); toast('Subject removed.'); } return; }
  if (action === 'save-subject') {
    const f = document.getElementById('subjectForm'); if (!f.reportValidity()) return;
    const name = f.elements.name.value.trim(); const text = f.elements.syllabus.value; const units = parseSyllabus(text).map(u => ({ id: uid('unit'), name: u.name, topics: u.topics.map(n => ({ id: uid('topic'), name: n, status: 'unknown', reads: 0, readHistory: [], lastReadAt: null, nextReviewAt: null, reviewStep: 0, estimateMin: 45, priority: 1 })) }));
    if (!units.length) units.push({ name: 'Unit 1', topics: [] });
    const report = mergeImportedSubjects([{ name, units }]); persist(); closeModal(); view = 'syllabus'; render(); toast(report.subjectsAdded ? `${name} added.` : `${name} already existed; ${report.topicsAdded} new topic${report.topicsAdded === 1 ? '' : 's'} merged without changing study history.`, 'success'); return;
  }
  if (action === 'ai-split') return splitSyllabusAI();
  if (action === 'save-topic') { const f = document.getElementById('topicForm'); if (!f.reportValidity()) return; const s = state.subjects.find(x => x.id === id); let unit = s?.units.find(u => u.id === f.elements.unitId.value); if (f.elements.unitId.value === '__new__' || f.elements.newUnit.value.trim()) { const unitName = f.elements.newUnit.value.trim() || `Unit ${s.units.length + 1}`; unit = s.units.find(u => normalizeKey(u.name) === normalizeKey(unitName)); if (!unit) { unit = { id: uid('unit'), name: unitName, topics: [] }; s.units.push(unit); } } if (!unit) return toast('Select or create a unit.', 'error'); const topicName = f.elements.name.value.trim(); if (unit.topics.some(t => normalizeKey(t.name) === normalizeKey(topicName))) return toast('That topic already exists in this unit.', 'error'); unit.topics.push(topicRecord(topicName)); persist(); closeModal(); render(); toast('Topic added.', 'success'); return; }
  if (action === 'save-exam') { const f = document.getElementById('examForm'); if (!f.reportValidity()) return; const data = { name: f.elements.name.value.trim(), date: f.elements.date.value, mode: f.elements.mode.value, topicIds: [...f.querySelectorAll('input[name="topicIds"]:checked')].map(x => x.value) }; if (id) { const exam = state.exams.find(x => x.id === id); if (exam) Object.assign(exam, data); } else { const duplicate = state.exams.find(x => x.date === data.date && normalizeKey(x.name) === normalizeKey(data.name)); if (duplicate) duplicate.topicIds = [...new Set([...(duplicate.topicIds || []), ...data.topicIds])]; else state.exams.push({ id: uid('exam'), ...data, createdAt: new Date().toISOString() }); } persist(); closeModal(); view = 'exams'; render(); toast('Checkpoint saved. Topic histories continue across exams.', 'success'); return; }
  if (action === 'unit-check') return;
  if (action === 'export-data') return exportData();
  if (action === 'import-data') { document.getElementById('backupFile')?.click(); return; }
  if (action === 'end-semester') { if (!confirm('End this semester and clear all current subjects, exams, and study logs from this browser? This cannot be undone. Export a backup first if you want to keep the history.')) return; exportData(); state = blankState(); persist(); view = 'dashboard'; render(); toast('New semester started. Your old backup was downloaded.', 'success'); return; }
  if (action === 'save-settings') { const provider = document.getElementById('provider')?.value; const key = document.getElementById('apiKey')?.value; const model = document.getElementById('model')?.value; const dh = Number(document.getElementById('dailyHours')?.value); const rg = Number(document.getElementById('readGoal')?.value); if (provider) state.settings.provider = provider; if (key !== undefined) state.settings.apiKey = key.replace(/\s+/g, ''); if (model !== undefined) state.settings.model = model.trim(); if (dh > 0) state.settings.dailyHours = Math.min(16, dh); if (rg > 0) state.settings.readGoal = Math.min(20, rg); const sem = document.getElementById('semesterName')?.value; if (sem?.trim()) state.semesterName = sem.trim(); persist(); render(); toast('Settings saved on this device.', 'success'); return; }
  if (action === 'toggle-key') { const i = document.getElementById('apiKey'); if (i) { const show = i.type === 'password'; i.type = show ? 'text' : 'password'; el.textContent = show ? 'Hide' : 'Show'; el.setAttribute('aria-pressed', String(show)); } return; }
  if (action === 'forget-key') { state.settings.apiKey = ''; persist(); render(); toast('API key removed from this browser.'); return; }
  if (action === 'test-ai') { const key = document.getElementById('apiKey')?.value.trim(); if (key !== undefined) state.settings.apiKey = key; const p = document.getElementById('provider')?.value; if (p) state.settings.provider = p; const m = document.getElementById('model')?.value; if (m) state.settings.model = m; persist(); el.disabled = true; el.textContent = 'Testing…'; try { const out = await aiText('Reply with only a short JSON object.', 'Return {"ok":true,"message":"Connected"}.'); parseJsonReply(out); toast(`Connected to ${PROVIDERS[state.settings.provider]?.label}.`, 'success'); } catch (e) { toast(e.message, 'error'); } finally { el.disabled = false; el.textContent = 'Test connection'; } return; }
  if (action === 'import-timetable') { const body = `<div class="field"><label for="circularFile">Upload an exam circular or timetable image</label><input id="circularFile" type="file" accept="image/*" capture="environment"></div><div class="field"><label for="timetableText">Or paste timetable text</label><textarea id="timetableText" placeholder="Mid-1\nOct 20 — Physics — Units 1, 2\nOct 22 — Chemistry — Units 1, 2"></textarea></div><div class="field-help">Photo parsing uses the vision model from Settings; no OCR engine is bundled. Dates are editable before import. If AI is unavailable, add the dates manually.</div>`; openModal('Import an exam timetable', 'Choose a circular photo or paste the schedule text.', body, '<button class="btn btn-outline" data-action="close-modal">Cancel</button><button class="btn btn-soft" data-action="parse-timetable-text">✦ Parse pasted text</button><button class="btn btn-primary" data-action="choose-circular">Read image</button>'); return; }
  if (action === 'choose-circular') { const file = document.getElementById('circularFile')?.files?.[0]; if (!file) return toast('Choose an image first.', 'error'); return readCircular(file); }
  if (action === 'parse-timetable-text') { const text = document.getElementById('timetableText')?.value.trim(); if (!text) return toast('Paste timetable text first.', 'error'); if (!state.settings.apiKey) return toast('Add your AI key in Settings first.', 'error'); el.disabled = true; el.textContent = 'Parsing…'; try { const out = await aiText('Extract exam timetable rows. Return JSON only: {"exams":[{"name":"Mid-1","date":"YYYY-MM-DD","subject":"Physics","units":["Unit 1"]}]}. Do not invent dates; use empty if absent.', `Today is ${localDate()}. Parse this timetable: ${text}`); const data = parseJsonReply(out); showParsedExams(data.exams || []); } catch (e) { toast(e.message, 'error'); } return; }
  if (action === 'save-imported-exams') { const result = addExamRowsToState(getImportRows()); if (!result.count && !result.duplicates) return toast('Add at least one row with a valid date.', 'error'); closeModal(); view = 'exams'; render(); toast(`${result.count} new checkpoint${result.count === 1 ? '' : 's'} added; ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} merged.`, 'success'); return; }
  if (action === 'add-import-row') { const current = getImportRows(); current.push({ name: '', date: '', subject: '', units: '' }); showParsedExams(current); return; }
  if (action === 'remove-import-row') { const current = getImportRows(); current.splice(Number(el.dataset.row), 1); showParsedExams(current); return; }
  if (action === 'practice-topic') return openPractice(id);
  if (action === 'generate-questions') return generateQuestions(id);
  if (action === 'practice-status') { const ok = el.dataset.status === 'ready'; const f = findTopic(id); if (f) { if (ok) rescheduleReview(f.topic, true); else rescheduleReview(f.topic, false); persist(); closeModal(); render(); toast(ok ? 'Marked ready; a spaced review is scheduled.' : 'Added to review; the planner will bring it back soon.', 'success'); } return; }
  if (action === 'replan') { const val = Number(document.getElementById('todayHours')?.value); if (val > 0) state.settings.todayHours = Math.min(16, val); const sid = document.getElementById('skipSubject')?.value; state.settings.skipToday = sid ? [sid] : []; state.settings.todayPlanDate = localDate(); persist(); render(); toast('Today’s plan rebalanced.', 'success'); return; }
  if (action === 'clear-filter') { searchQuery = ''; syllabusFilter = ''; render(); return; }
  if (action === 'rename-semester') { const input = document.getElementById('semesterName'); if (input) { const s = input.value.trim(); if (s) { state.semesterName = s; persist(); render(); toast('Semester label saved.'); } } else { const s = prompt('Semester label', state.semesterName); if (s?.trim()) { state.semesterName = s.trim(); persist(); render(); } } return; }
  if (action === 'sample-data') return sampleWorkspace();
});

document.addEventListener('change', event => {
  if (event.target?.id === 'modelPreset') { const inp = document.getElementById('model'); if (event.target.value === '__custom') { inp.value = ''; inp.focus(); } else { inp.value = event.target.value; state.settings.model = event.target.value; persist(); } return; }
  if (event.target?.id === 'provider') { const k = document.getElementById('apiKey')?.value || ''; state.settings.provider = event.target.value; state.settings.model = PROVIDERS[event.target.value].model; state.settings.apiKey = k.trim(); persist(); render(); return; }
  const el = event.target;
  if (el.id === 'pdfFile' && el.files?.[0]) return extractPdf(el.files[0]);
  if (el.id === 'bulkPdfFiles' && el.files?.length) return handleBulkPdfFiles([...el.files]);
  if (el.id === 'backupFile' && el.files?.[0]) return importDataFile(el.files[0]);
  if (el.id === 'syllabusFilter') { syllabusFilter = el.value; render(); return; }
  if (el.matches('[data-action="topic-status"]')) { const status = el.value; markStatus(el.dataset.id, status); toast(status === 'ready' ? 'Ready for now; first spaced review scheduled.' : `Topic marked ${status}.`, 'success'); return; }
  if (el.matches('.unit-check')) { const unit = state.subjects.find(s => s.id === el.dataset.subject)?.units.find(u => u.id === el.dataset.unit); if (unit) unit.topics.forEach(t => { const box = document.querySelector(`input[name="topicIds"][value="${t.id}"]`); if (box) box.checked = el.checked; }); }
});
document.addEventListener('input', event => {
  if (event.target?.id === 'model') { const sel = document.getElementById('modelPreset'); if (sel) sel.value = [...sel.options].some(o => o.value === event.target.value.trim()) ? event.target.value.trim() : '__custom'; }
  if (event.target?.id === 'apiKey') { const st = document.getElementById('keyStatus'); const v = event.target.value.trim(); const pv = document.getElementById('provider')?.value || state.settings.provider; if (st) { st.className = `key-status ${v ? (keyLooksValid(pv, v) ? 'ok' : 'warn') : ''}`; st.textContent = v ? (keyLooksValid(pv, v) ? '● Format looks right — press Save, then Test' : `● Format looks unusual (${PROVIDERS[pv].hint})`) : '○ No key'; } }
  if (event.target.id === 'syllabusSearch') { const pos = event.target.selectionStart; searchQuery = event.target.value; const root = document.getElementById('app'); root.innerHTML = renderSyllabus(); const input = document.getElementById('syllabusSearch'); input?.focus(); input?.setSelectionRange(pos, pos); }
});
document.addEventListener('keydown', event => {
  const dialog = document.querySelector('#modalRoot [role="dialog"]');
  if (event.key === 'Escape') { if (dialog) { event.preventDefault(); closeModal(); } else if (document.getElementById('sidebar')?.classList.contains('open')) { event.preventDefault(); setMenuOpen(false); } return; }
  if (event.key !== 'Tab' || !dialog) return;
  const items = [...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(x => x.getClientRects().length);
  if (!items.length) { event.preventDefault(); dialog.focus(); return; }
  const first = items[0], last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

// Clicking a unit checkbox updates its topic checkboxes; avoid nested form submission.
document.addEventListener('submit', event => event.preventDefault());
tickHandle = setInterval(updateTimerText, 1000);
render();

if (!state.tourDone && !state.subjects.length) setTimeout(startTour, 800);
