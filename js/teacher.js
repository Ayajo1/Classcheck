// teacher.js — teacher console: session marking, roster management, reports.
import * as db from './db.js';
import * as M from './models.js';
import {
  h, clear, toast, showModal, confirmModal, download, readFileText,
  fmtPct, fmtDateLong,
} from './ui.js';
import { renderReports } from './reports.js';

const CLASS_KEY = 'classcheck.activeClass';
const state = { classId: null, tab: 'session', focusIdx: 0, undoStack: [] };
let teacherRoot = null;

export async function initTeacher(root) {
  teacherRoot = root;
  const select = root.querySelector('#teacher-class-select');
  const addClassBtn = root.querySelector('#btn-add-class');
  const tabs = root.querySelectorAll('.tab-btn');
  await refreshClassSelect();
  select.addEventListener('change', () => {
    state.classId = select.value;
    state.undoStack = [];
    state.focusIdx = 0;
    localStorage.setItem(CLASS_KEY, select.value);
    renderCurrent(root);
  });
  addClassBtn.addEventListener('click', () => openAddClassModal(root));
  tabs.forEach((t) => t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    tabs.forEach((x) => x.classList.toggle('active', x === t));
    renderCurrent(root);
  }));
  renderCurrent(root);
}

async function refreshClassSelect() {
  const select = document.getElementById('teacher-class-select');
  const classes = (await db.getClasses()).sort((a, b) => a.name.localeCompare(b.name));
  const saved = localStorage.getItem(CLASS_KEY);
  const active = classes.find((c) => c.id === saved) || classes[0] || null;
  state.classId = active ? active.id : null;
  select.replaceChildren(...classes.map((c) =>
    h('option', { value: c.id }, c.name)));
  select.value = active ? active.id : '';
  updateSessionInfo();
}

function updateSessionInfo() {
  const el = document.getElementById('teacher-session-info');
  if (!el || !state.classId) { el.textContent = 'No class selected.'; return; }
  const klass = { id: state.classId };
  (async () => {
    const classes = await db.getClasses();
    const c = classes.find((x) => x.id === klass.id);
    const students = await db.getStudentsByClass(klass.id);
    el.textContent = c
      ? `${c.name}${c.room ? ` · Room ${c.room}` : ''} — ${students.length} students · late after ${c.lateCutoff || '—'}`
      : '';
  })();
}

async function openAddClassModal(root) {
  const name = h('input', { type: 'text', placeholder: 'e.g. 10A', 'data-f': 'name' });
  const room = h('input', { type: 'text', placeholder: 'e.g. 12', 'data-f': 'room' });
  const cutoff = h('input', { type: 'time', value: '08:30', 'data-f': 'cutoff' });
  const val = await showModal({
    title: 'New class',
    body: [
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Class name *'), name),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Room'), room),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Late cutoff'), cutoff),
    ],
    buttons: [
      { label: 'Cancel', value: null, cls: 'btn-ghost' },
      { label: 'Create', value: true, cls: 'btn-primary' },
    ],
  });
  if (val !== true) return;
  if (!name.value.trim()) { toast('Class name is required', 'err'); return; }
  const klass = M.makeClass({ name: name.value, room: room.value.trim(), lateCutoff: cutoff.value || '08:30' });
  await db.saveClass(klass);
  toast('Class created', 'ok');
  localStorage.setItem(CLASS_KEY, klass.id);
  await refreshClassSelect();
  state.classId = klass.id;
  document.getElementById('teacher-class-select').value = klass.id;
  updateSessionInfo();
  renderCurrent(root);
}

async function renderCurrent(root) {
  for (const id of ['teacher-session', 'teacher-roster', 'teacher-reports']) {
    document.getElementById(id).classList.add('hidden');
  }
  const panel = document.getElementById(`teacher-${state.tab}`);
  panel.classList.remove('hidden');
  clear(panel);
  if (!state.classId) {
    panel.append(h('div', { class: 'empty-state' },
      h('h2', {}, 'No class yet'),
      h('p', {}, 'Create a class with the “+ Class” button, then add students on the Roster tab.')));
    return;
  }
  if (state.tab === 'session') await renderSession(root, panel);
  else if (state.tab === 'roster') renderRoster(root, panel);
  else renderReports(panel, state.classId);
}

/* ============================ session tab ============================ */

const KEY_TO_STATUS = { '1': 'present', '2': 'late', '3': 'absent', '4': 'excused' };

async function renderSession(root, panel) {
  const classes = await db.getClasses();
  const klass = classes.find((c) => c.id === state.classId);
  const students = (await db.getStudentsByClass(state.classId)).sort(bySeat);
  const recs = await db.getRecordsForSession(state.classId, M.dateKey());
  const byStudent = new Map(recs.map((r) => [r.studentId, r]));
  const done = students.filter((s) => byStudent.has(s.id)).length;

  panel.append(h('div', { class: 'session-banner' },
    h('span', { class: 'live-dot' }),
    h('span', {}, `${fmtDateLong(new Date())} — ${done} of ${students.length} marked · late after ${klass.lateCutoff || '—'}`),
  ));

  const undoBtn = h('button', { class: 'btn btn-ghost btn-sm', disabled: state.undoStack.length === 0, onclick: () => undo() }, 'Undo');
  panel.append(h('div', { class: 'toolbar' },
    h('button', { class: 'btn btn-primary btn-sm', onclick: () => markAll('present') }, 'Mark all present'),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => markAll('absent') }, 'Mark all absent'),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => clearToday(klass) }, 'Clear today'),
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => exportSessionCSV(klass, students, byStudent) }, 'Export session CSV'),
    undoBtn,
  ));

  const table = h('table', { class: 'roster-table' });
  table.append(h('thead', {}, h('tr', {},
    h('th', {}, '#'), h('th', {}, 'Student'), h('th', {}, 'Status'),
    h('th', {}, 'Time'), h('th', {}, 'Source'), h('th', {}, 'Mark'))));
  const tbody = h('tbody');
  if (students.length === 0) {
    tbody.append(h('tr', {}, h('td', { colspan: '6' }, 'No students yet — add them on the Roster tab.')));
  }
  students.forEach((s, i) => {
    const rec = byStudent.get(s.id);
    const status = rec ? rec.status : 'pending';
    const tr = h('tr', { class: i === state.focusIdx ? 'row-focus' : '', 'data-idx': i, onclick: () => setFocus(i) },
      h('td', {}, String(s.seat || i + 1)),
      h('td', {}, s.name),
      h('td', {}, h('span', { class: `status-pill ${status}` }, M.STATUS_LABELS[status] || 'Pending')),
      h('td', {}, rec ? rec.time : '—'),
      h('td', {}, rec ? rec.method : '—'),
      h('td', {}, h('div', { class: 'session-row-btns' },
        ...['present', 'late', 'absent', 'excused'].map((st) =>
          h('button', {
            class: `btn btn-sm${rec && rec.status === st ? ` pill-${st} pill-active` : ' btn-ghost'}`,
            onclick: (e) => { e.stopPropagation(); setStatus(s.id, st); },
            title: M.STATUS_LABELS[st],
          }, st[0].toUpperCase()))),
    );
    tbody.append(tr);
  });
  table.append(tbody);
  panel.append(table,
    h('p', { class: 'kbd-hint' },
      'Shortcuts: ↑/↓ or j/k to move · 1 present · 2 late · 3 absent · 4 excused · M all present · U undo'));

  bindSessionKeys(students);
}

function setFocus(i, students) {
  state.focusIdx = i;
  document.querySelectorAll('#teacher-session tr[data-idx]').forEach((tr) => {
    const idx = Number(tr.getAttribute('data-idx'));
    tr.classList.toggle('row-focus', idx === i);
    if (idx === i) tr.scrollIntoView({ block: 'nearest' });
  });
}

function bindSessionKeys(students) {
  const onKey = (e) => {
    const modalRoot = document.getElementById('modal-root');
    if (modalRoot && !modalRoot.classList.contains('hidden')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const key = e.key;
    if (key === 'ArrowDown' || key === 'k') {
      e.preventDefault();
      setFocus(Math.min(state.focusIdx + 1, students.length - 1));
    } else if (key === 'ArrowUp' || key === 'j') {
      e.preventDefault();
      setFocus(Math.max(state.focusIdx - 1, 0));
    } else if (KEY_TO_STATUS[key]) {
      const s = students[state.focusIdx];
      if (s) setStatus(s.id, KEY_TO_STATUS[key]);
    } else if (key === 'm' || key === 'M') {
      markAll('present');
    } else if (key === 'u' || key === 'U') {
      undo();
    }
  };
  document.removeEventListener('keydown', sessionKeyHandler);
  sessionKeyHandler = onKey;
  document.addEventListener('keydown', onKey);
}
let sessionKeyHandler = null;

/* ============================ helpers ============================ */

function bySeat(a, b) {
  const sa = a.seat ? parseInt(String(a.seat), 10) : Infinity;
  const sb = b.seat ? parseInt(String(b.seat), 10) : Infinity;
  if (sa !== sb) return sa - sb;
  return String(a.name).localeCompare(String(b.name));
}

async function setStatus(studentId, status) {
  if (!state.classId) return;
  const date = M.dateKey();
  const recs = await db.getRecordsForSession(state.classId, date);
  const before = recs.find((r) => r.studentId === studentId) || null;
  pushUndo(studentId, before);
  await db.upsertRecord(M.makeRecord({
    classId: state.classId, date, studentId, status, method: 'teacher', time: M.timeHHMM(),
  }));
  await renderCurrent(teacherRoot);
}

async function markAll(status) {
  if (!state.classId) return;
  const students = await db.getStudentsByClass(state.classId);
  const date = M.dateKey();
  const recs = await db.getRecordsForSession(state.classId, date);
  for (const s of students) {
    pushUndo(s.id, recs.find((r) => r.studentId === s.id) || null);
  }
  for (const s of students) {
    await db.upsertRecord(M.makeRecord({
      classId: state.classId, date, studentId: s.id, status, method: 'teacher',
    }));
  }
  toast(`Marked all ${M.STATUS_LABELS[status].toLowerCase()}`, 'ok');
  await renderCurrent(teacherRoot);
}

function pushUndo(studentId, before) {
  state.undoStack.push({ studentId, before: before ? { ...before } : null });
  if (state.undoStack.length > 50) state.undoStack.shift();
}

async function undo() {
  const entry = state.undoStack.pop();
  if (!entry) { toast('Nothing to undo'); return; }
  if (entry.before) {
    await db.upsertRecord({
      ...entry.before,
      classId: state.classId,
      date: M.dateKey(),
    });
  } else {
    const recs = await db.getRecordsForSession(state.classId, M.dateKey());
    const rec = recs.find((r) => r.studentId === entry.studentId);
    if (rec) await db.remove('records', rec.id);
  }
  toast('Undone');
  await renderCurrent(teacherRoot);
}

/* ============================ roster tab ============================ */

async function renderRoster(root, panel) {
  const students = (await db.getStudentsByClass(state.classId)).sort(bySeat);

  const toolbar = h('div', { class: 'toolbar' },
    h('button', { class: 'btn btn-primary btn-sm', id: 'roster-add' }, '+ Student'),
    h('button', { class: 'btn btn-ghost btn-sm', id: 'roster-import' }, 'Import CSV'),
    h('button', { class: 'btn btn-ghost btn-sm', id: 'roster-export' }, 'Export CSV'),
    h('button', { class: 'btn btn-ghost btn-sm', id: 'roster-pins' }, 'PIN sheet'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn btn-danger btn-sm', id: 'roster-del-class' }, 'Delete class'),
  );
  panel.append(toolbar);

  if (!students.length) {
    panel.append(h('div', { class: 'empty-state' },
      h('h2', {}, 'No students yet'),
      h('p', {}, 'Add students one by one, or import a CSV with columns: name, student_id, seat, pin.')));
  } else {
    const table = h('table', { class: 'roster-table' });
    const thead = h('thead', {}, h('tr', {},
      h('th', {}, 'Seat'), h('th', {}, 'Name'), h('th', {}, 'Student ID'), h('th', {}, 'PIN'), h('th', { class: 'actions' }, 'Actions')));
    const tbody = h('tbody', {});
    for (const s of students) {
      const pinCell = h('td', { class: 'actions' },
        h('span', { class: 'status-pill' }, '••••'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => s._pinShown = !s._pinShown }, 'Show'));
      const tr = h('tr', {},
        h('td', {}, s.seat || '—'),
        h('td', {}, h('span', { class: 'initials', style: `background:hsl(${M.avatarHue(s.id || s.name)} 55% 45%)` }, M.initials(s.name)),
          h('span', { class: 'student-name' }, s.name)),
        h('td', {}, s.studentId || '—'),
        pinCell,
        h('td', { class: 'actions' },
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => openStudentModal(s) }, 'Edit'),
          h('button', { class: 'btn btn-danger btn-sm', onclick: () => deleteStudent(s) }, 'Delete')));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    panel.append(table);
  }

  panel.querySelector('#roster-add').addEventListener('click', () => openStudentModal(null));
  panel.querySelector('#roster-export').addEventListener('click', async () => {
    const klass = (await db.getClasses()).find((c) => c.id === state.classId);
    const all = await db.getStudentsByClass(state.classId);
    download(`roster-${(klass && klass.name || 'class').replace(/[^a-z0-9]+/gi, '_')}.csv`, M.studentsToCSV(all));
  });
  panel.querySelector('#roster-import').addEventListener('click', async () => {
    const file = h('input', { type: 'file', accept: '.csv,text/csv' });
    const ok = await showModal({
      title: 'Import roster CSV',
      body: [
        h('p', {}, 'Expected columns: name, student_id, seat, pin. Rows with an empty name are skipped; student_id is used to match existing students.'),
        file,
      ],
      buttons: [
        { label: 'Cancel', value: null, cls: 'btn-ghost' },
        { label: 'Import', value: true, cls: 'btn-primary' },
      ],
    });
    if (ok !== true || !file.files || !file.files[0]) return;
    const text = await readFileText(file.files[0]);
    const rows = M.parseCSV(text);
    const { students, errors: importErrors } = M.studentsFromCSVRows(rows);
    let added = 0, updated = 0, skipped = 0;
    for (const s of students) {
      if (!s.name) { skipped++; continue; }
      const existing = s.studentId
        ? (await db.getStudents()).find((x) => x.studentId === s.studentId)
        : null;
      if (existing) {
        await db.saveStudent({ ...existing, ...s, id: existing.id });
        updated++;
      } else {
        await db.saveStudent(M.makeStudent(s));
        added++;
      }
    }
    if (importErrors.length > 0) toast(`${importErrors.length} import issue(s): ${importErrors[0]}`, 'err');
    toast(`Imported: ${added} added, ${updated} updated, ${skipped} skipped`, 'ok');
    await refreshClassSelect();
    renderCurrent(root);
  });
  panel.querySelector('#roster-pins').addEventListener('click', async () => {
    const all = (await db.getStudentsByClass(state.classId)).sort(bySeat);
    if (!all.length) { toast('No students to print', 'err'); return; }
    const rows = [['name', 'seat', 'pin'], ...all.map((s) => [s.name, s.seat || '', s.pin || ''])];
    showModal({
      title: 'PIN sheet — print or hand out',
      body: [h('pre', { class: 'pin-sheet', style: 'white-space:pre-wrap;font-size:13px' }, M.toCSV(rows))],
      buttons: [
        { label: 'Close', value: null, cls: 'btn-ghost' },
        { label: 'Download CSV', value: 'download', cls: 'btn-primary' },
      ],
    }).then(async (v) => {
      if (v === 'download') {
        const klass = (await db.getClasses()).find((c) => c.id === state.classId);
        download(`pins-${(klass && klass.name || 'class').replace(/[^a-z0-9]+/gi, '_')}.csv`, M.toCSV(rows));
      }
    });
  });
  panel.querySelector('#roster-del-class').addEventListener('click', async () => {
    const klass = (await db.getClasses()).find((c) => c.id === state.classId);
    const ok = await confirmModal(`Delete class “${klass ? klass.name : ''}” and all its students and attendance records?`, { okLabel: 'Delete', danger: true });
    if (!ok) return;
    await db.deleteClassCascade(state.classId);
    toast('Class deleted', 'ok');
    localStorage.removeItem(CLASS_KEY);
    await refreshClassSelect();
    if (state.classId) state.classId = null;
    state.undoStack = [];
    updateSessionInfo();
    renderCurrent(root);
  });
}

function openStudentModal(existing) {
  const name = h('input', { type: 'text', placeholder: 'e.g. Ada Lovelace', value: existing ? existing.name : '' });
  const sid = h('input', { type: 'text', placeholder: 'e.g. 2024-001', value: existing ? existing.studentId : '' });
  const seat = h('input', { type: 'text', placeholder: 'e.g. 3', value: existing ? String(existing.seat || '') : '' });
  const pin = h('input', { type: 'text', placeholder: '4-digit PIN (blank = auto)', value: existing ? String(existing.pin || '') : '', maxlength: 8 });
  const val = showModal({
    title: existing ? 'Edit student' : 'Add student',
    body: [
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name *'), name),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Student ID'), sid),
      h('div', { class: 'form-row' },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Seat'), seat),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'PIN'), pin)),
    ],
    buttons: [
      { label: 'Cancel', value: null, cls: 'btn-ghost' },
      { label: existing ? 'Save' : 'Add', value: true, cls: 'btn-primary' },
    ],
  });
  val.then(async (v) => {
    if (v !== true) return;
    if (!name.value.trim()) { toast('Name is required', 'err'); return; }
    const pinValue = pin.value.trim() || String(1000 + Math.floor(Math.random() * 9000));
    if (existing) {
      await db.saveStudent({ ...existing, name: name.value.trim(), studentId: sid.value.trim(), seat: seat.value.trim(), pin: pinValue });
      toast('Student updated', 'ok');
    } else {
      await db.saveStudent(M.makeStudent({ name: name.value.trim(), studentId: sid.value.trim(), seat: seat.value.trim(), pin: pinValue }));
      toast(`Student added — PIN: ${pinValue} (hand it to them)`, 'ok');
    }
    renderCurrent(teacherRoot);
  });
}

async function deleteStudent(student) {
  const ok = await confirmModal(`Remove “${student.name}” and all their attendance records?`, { okLabel: 'Remove', danger: true });
  if (!ok) return;
  await db.deleteStudentCascade(student.id);
  toast('Student removed', 'ok');
  renderCurrent(teacherRoot);
}