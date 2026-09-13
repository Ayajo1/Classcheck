// kiosk.js — student self check-in. Students tap their name, then enter
// their personal code on an on-screen keypad. Three failed attempts lock
// the tile for 60s so one student cannot check in for their friends.

import * as db from './db.js';
import * as M from './models.js';
import { h, clear, toast } from './ui.js';

const LOCK_KEY = 'classcheck.locks';
const CLASS_KEY = 'classcheck.activeClass';
const MAX_FAILS = 3;
const LOCK_MS = 60_000;

function loadLocks() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || '{}'); }
  catch { return {}; }
}
function saveLocks(locks) {
  localStorage.setItem(LOCK_KEY, JSON.stringify(locks));
}
function getLock(studentId) {
  const l = loadLocks()[studentId];
  if (l && l.until > Date.now()) return l;
  return null;
}
function recordFail(studentId) {
  const locks = loadLocks();
  const prev = locks[studentId] || { count: 0, until: 0 };
  prev.count += 1;
  if (prev.count >= MAX_FAILS) {
    prev.until = Date.now() + LOCK_MS;
    prev.count = 0;
    toast(`${'That student is locked for 60s — see teacher'}`, 'err');
  }
  locks[studentId] = prev;
  saveLocks(locks);
}
function clearLock(studentId) {
  const locks = loadLocks();
  delete locks[studentId];
  saveLocks(locks);
}

let refreshTimer = null;

export function stopKiosk() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

export async function renderKiosk(root) {
  stopKiosk();
  const titleEl = root.querySelector('#kiosk-class-title');
  const bodyEl = root.querySelector('#kiosk-body');
  const classes = (await db.getClasses()).sort((a, b) => a.name.localeCompare(b.name));

  if (classes.length === 0) {
    titleEl.textContent = 'Kiosk check-in';
    clear(bodyEl);
    bodyEl.append(h('div', { class: 'empty-state' },
      h('h2', {}, 'No class set up yet'),
      h('p', {}, 'Ask your teacher to create a class and add students in the Teacher console.')));
    return;
  }

  const activeId = localStorage.getItem(CLASS_KEY);
  const active = classes.find((c) => c.id === activeId) || classes[0];
  localStorage.setItem(CLASS_KEY, active.id);

  if (classes.length > 1) {
    titleEl.textContent = 'Kiosk check-in';
    renderClassPicker(bodyEl, classes);
    return;
  }
  renderClassView(root, active);
}

function renderClassPicker(bodyEl, classes) {
  clear(bodyEl);
  const grid = h('div', { class: 'name-grid' });
  for (const c of classes) {
    grid.append(h('div', {
      class: 'name-tile',
      onclick: () => {
        localStorage.setItem(CLASS_KEY, c.id);
        renderKiosk(document.getElementById('view-kiosk'));
      },
    },
      h('div', { class: 'initials' }, c.name.slice(0, 2).toUpperCase()),
      h('div', { class: 'name' }, c.name),
      h('div', { class: 'meta' }, c.room ? `Room ${c.room}` : '')));
  }
  bodyEl.append(h('p', { class: 'view-sub' }, 'Tap your class to begin.'), grid);
}

async function renderClassView(root, klass) {
  const bodyEl = root.querySelector('#kiosk-body');
  const students = (await db.getStudentsByClass(klass.id)).sort((a, b) => {
    const sa = String(a.seat || '999'), sb = String(b.seat || '999');
    return sa === sb ? a.name.localeCompare(b.name) : (Number(sa) < Number(sb) ? -1 : 1);
  });
  const records = await db.getRecordsForSession(klass.id, M.dateKey());
  const byStudent = new Map(records.map((r) => [r.studentId, r]));

  root.querySelector('#kiosk-class-title').textContent = `${klass.name}${klass.room ? ` · Room ${klass.room}` : ''}`;
  clear(bodyEl);

  const done = students.filter((s) => byStudent.get(s.id));
  const lates = done.filter((s) => byStudent.get(s.id).status === 'late');
  bodyEl.append(h('div', { class: 'kiosk-summary' },
    h('span', { class: 'summary-chip' }, `Checked in: <b>${done.length}</b> / ${students.length}`),
    h('span', { class: 'summary-chip' }, `Late: <b>${lates.length}</b>`),
    h('span', { class: 'summary-chip' }, `Late after: <b>${klass.lateCutoff || '—'}</b>`),
    h('span', { class: 'summary-chip' }, M.fmtToday ? '' : todayLabel())));

  const grid = h('div', { class: 'name-grid' });
  for (const s of students) {
    const rec = byStudent.get(s.id);
    const lock = getLock(s.id);
    if (rec && (rec.status === 'present' || rec.status === 'late')) {
      grid.append(h('div', { class: 'name-tile state-present' },
        h('span', { class: 'tile-badge' }, '✓'),
        h('div', { class: 'initials' }, M.initials(s.name)),
        h('div', { class: 'name' }, s.name),
        h('div', { class: 'meta' }, `${rec.time}${rec.status === 'late' ? ' · late' : ''}`)));
    } else if (lock) {
      const sec = Math.max(0, Math.ceil((lock.until - Date.now()) / 1000));
      const tile = h('div', { class: 'name-tile' },
        h('div', { class: 'initials' }, M.initials(s.name)),
        h('div', { class: 'name' }, s.name),
        h('div', { class: 'meta' }, `Locked · ${sec}s`));
      tile.style.opacity = '0.5';
      grid.append(tile);
    } else {
      grid.append(h('div', { class: 'name-tile', onclick: () => openPinStage(root, klass, s) },
        h('div', { class: 'initials' }, M.initials(s.name)),
        h('div', { class: 'name' }, s.name),
        h('div', { class: 'meta' }, s.seat ? `Seat ${s.seat}` : 'Tap to check in')));
    }
  }
  bodyEl.append(grid);

  // keep lock countdowns fresh while someone is locked out
  if (students.some((s) => getLock(s.id))) {
    refreshTimer = setInterval(() => {
      if (!document.getElementById('view-kiosk').classList.contains('hidden')) {
        renderClassView(root, klass);
      }
    }, 1000);
  }
}

function todayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function openPinStage(root, klass, student) {
  stopKiosk();
  const bodyEl = root.querySelector('#kiosk-body');
  let entered = '';
  let busy = false;

  clear(bodyEl);
  const dots = h('div', { class: 'pin-dots' },
    ...Array.from({ length: 4 }, () => h('span', { class: 'pin-dot' })));
  const feedback = h('div', { class: 'pin-feedback' });
  const stage = h('div', { class: 'pin-stage' },
    h('p', { class: 'view-sub' }, 'Tap your name to start. Now enter your personal 4-digit code.'),
    h('div', { class: 'student-name' }, student.name),
    dots,
    feedback,
    keypad());

  function renderDots() {
    const all = dots.querySelectorAll('.pin-dot');
    all.forEach((d, i) => {
      d.classList.toggle('filled', i < entered.length);
      d.classList.toggle('error', false);
    });
  }

  function press(digit) {
    if (busy || entered.length >= 4) return;
    entered += digit;
    renderDots();
    if (entered.length === 4) submit();
  }

  function submit() {
    if (busy) return;
    if (!student.pin) {
      feedback.textContent = 'No code on file — please see your teacher.';
      feedback.className = 'pin-feedback err';
      flashError();
      return;
    }
    busy = true;
    if (M.verifyCode(entered, student.pin)) {
      feedback.textContent = `Welcome, ${student.name.split(' ')[0]}!`;
      feedback.className = 'pin-feedback ok';
      const status = M.statusForArrival(M.timeHHMM(), klass.lateCutoff);
      const rec = M.makeRecord({
        classId: klass.id,
        date: M.dateKey(),
        studentId: student.id,
        status,
        method: 'kiosk',
        time: M.timeHHMM(),
        codeVerified: true,
      });
      db.upsertRecord(rec)
        .then(() => { clearLock(student.id); toast(`${student.name} checked in (${status})`, 'ok'); })
        .catch(() => toast('Could not save check-in', 'err'))
        .finally(() => {
          setTimeout(() => renderClassView(root, klass), 900);
        });
    } else {
      busy = false;
      feedback.textContent = 'Wrong code. Try again.';
      feedback.className = 'pin-feedback err';
      recordFail(student.id);
      entered = '';
      setTimeout(() => {
        if (getLock(student.id)) { renderClassView(root, klass); return; }
        renderDots();
      }, 450);
    }
  }

  function flashError() {
    dots.querySelectorAll('.pin-dot').forEach((d) => d.classList.add('error'));
  }

  function back() { renderClassView(root, klass); }

  function keypad() {
    const pad = h('div', { class: 'keypad' });
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']) {
      pad.append(h('button', {
        class: d.length > 1 ? 'key-fn' : '',
        'data-key': d,
        onclick: () => {
          if (d === 'clear') { entered = ''; feedback.textContent = ''; feedback.className = 'pin-feedback'; renderDots(); }
          else if (d === 'back') back();
          else press(d);
        },
      }, d === 'clear' ? '⌫ Clear' : d === 'back' ? '← List' : d));
    }
    return pad;
  }

  // physical keyboard also works on the kiosk
  const onKey = (e) => {
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace' || e.key === 'Escape') { e.key === 'Escape' ? back() : (entered = entered.slice(0, -1), renderDots()); }
  };
  document.addEventListener('keydown', onKey);
  const origRender = renderClassView;
  const cleanup = () => document.removeEventListener('keydown', onKey);
  stage.addEventListener('click', () => {});
  // remove listener when the stage is torn down
  const ro = new MutationObserver(() => {
    if (!bodyEl.contains(stage)) { cleanup(); ro.disconnect(); }
  });
  ro.observe(bodyEl, { childList: true });
}