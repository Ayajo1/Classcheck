// reports.js — per-student attendance stats, recent-session dots, CSV export.
import * as db from './db.js';
import * as M from './models.js';
import { h, clear, fmtPct, download, toast, fmtDateLong } from './ui.js';

const STATUS_DOT = {
  present: 'var(--ok)',
  late: 'var(--late)',
  absent: 'var(--bad)',
  excused: 'var(--excused, #7aa7ff)',
  pending: 'var(--muted)',
};

export async function renderReports(panel, classId) {
  clear(panel);
  if (!classId) {
    panel.append(
      h('div', { class: 'empty-state' },
        h('h2', {}, 'No class selected'),
        h('p', {}, 'Pick a class above to see reports.'))
    );
    return;
  }

  const [students, allRecords] = await Promise.all([
    db.getStudentsByClass(classId),
    db.getRecords(),
  ]);
  const records = allRecords.filter((r) => r.classId === classId);
  const datesDesc = [...new Set(records.map((r) => r.date))].sort().reverse();
  const recentDates = datesDesc.slice(0, 10);
  const klass = (await db.getClasses()).find((c) => c.id === classId);
  const klassName = klass ? klass.name : 'Class';

  /* Class summary */
  const classStats = M.computeStats(records);
  const today = M.dateKey();
  const todayRecs = records.filter((r) => r.date === today);
  const todayStats = M.computeStats(todayRecs);

  const summary = h('div', { class: 'report-grid' },
    h('div', { class: 'report-card' },
      h('div', { class: 'report-label' }, 'Sessions held'),
      h('div', { class: 'report-value' }, String(datesDesc.length))),
    h('div', { class: 'report-card' },
      h('div', { class: 'report-label' }, 'Class attendance rate'),
      h('div', { class: 'report-value' }, classStats.total ? fmtPct(classStats.rate) : '—')),
    h('div', { class: 'report-card' },
      h('div', { class: 'report-label' }, `Today · ${fmtDateLong()}`),
      h('div', { class: 'report-value' },
        todayRecs.length
          ? `${todayStats.present + todayStats.late + todayStats.excused}/${students.length} in`
          : 'No records yet'))
  );
  panel.append(summary);

  if (students.length === 0) {
    panel.append(h('div', { class: 'empty-state' },
      h('h2', {}, 'No students in this class yet'),
      h('p', {}, 'Add students in the Roster tab, or import a CSV roster.')));
    return;
  }

  /* Per-student table */
  const rows = students.map((s) => {
    const recs = records.filter((r) => r.studentId === s.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const st = M.computeStats(recs);
    const streak = M.currentStreak(recs);
    const lates = M.lateCount(recs);
    const byDate = new Map(recs.map((r) => [r.date, r.status]));
    return { s, st, streak, lates, byDate };
  });
  rows.sort((a, b) => (a.st.st.rate === b.st.st.rate
    ? a.s.name.localeCompare(b.s.name)
    : (b.st.st.rate || 0) - (a.st.st.rate || 0)));

  const dots = (byDate) => h('div', { class: 'dot-row' },
    recentDates.map((d) => {
      const status = byDate.get(d) || 'pending';
      return h('span', {
        class: 'dot',
        style: `background:${STATUS_DOT[status] || STATUS_DOT.pending}`,
        title: `${d} — ${M.STATUS_LABELS[status] || status}`,
      });
    }));

  const thead = h('tr', {},
    h('th', {}, 'Student'),
    h('th', {}, 'Seat'),
    h('th', {}, 'Rate'),
    h('th', {}, 'Attended'),
    h('th', {}, 'Lates'),
    h('th', {}, 'Streak'),
    h('th', {}, `Last ${recentDates.length || 0} sessions`));

  const tbody = h('tbody', {}, rows.map(({ s, st, streak, lates, byDate }) =>
    h('tr', {},
      h('td', {},
        h('span', { class: 'avatar', style: `background:hsl(${M.avatarHue(s.id)}, 45%, 30%)` }, M.initials(s.name)),
        h('span', { class: 'student-name' }, s.name)),
      h('td', {}, s.seat ? String(s.seat) : '—'),
      h('td', {},
        h('div', { class: 'rate' },
          h('span', {}, st.total ? fmtPct(st.rate) : '—'),
          h('div', { class: 'rate-bar' },
            h('div', { style: `width:${st.total ? (st.rate * 100).toFixed(1) : 0}%` })))),
      h('td', {}, `${st.present + st.late + st.excused}/${st.total}`),
      h('td', {}, String(lates)),
      h('td', {}, streak > 0 ? `${streak} ${streak === 1 ? 'day' : 'days'}` : '—'),
      h('td', {}, dots(byDate)))));

  const table = h('table', { class: 'history-table' },
    h('thead', {}, thead), tbody);
  panel.append(table);

  /* CSV export */
  const nameById = new Map(students.map((s) => [s.id, s.name]));
  const seatById = new Map(students.map((s) => [s.id, s.seat || '']));
  const csvRows = [
    ['date', 'student', 'seat', 'status', 'method', 'time'],
    ...records
      .slice()
      .sort((a, b) => (a.date === b.date
        ? String(a.studentId).localeCompare(String(b.studentId))
        : (a.date < b.date ? -1 : 1)))
      .map((r) => [
        r.date,
        nameById.get(r.studentId) || r.studentId,
        seatById.get(r.studentId) || '',
        r.status,
        r.method || '',
        r.time || '',
      ]),
  ];
  const exportBtn = h('button', {
    class: 'btn btn-ghost',
    onclick: () => {
      if (records.length === 0) {
        toast('No records to export yet');
        return;
      }
      const fname = `${klassName.replace(/[^A-Za-z0-9_-]+/g, '_')}_${M.dateKey()}.csv`;
      download(fname, M.toCSV(csvRows));
      toast(`Exported ${records.length} record(s)`);
    },
  }, '⬇ Export all records (CSV)');
  const meta = h('div', { class: 'report-meta' },
    h('p', { class: 'view-sub' },
      `Updated ${fmtDateLong()}. Dots show the most recent ${recentDates.length || '—'} session${recentDates.length === 1 ? '' : 's'}.`),
    exportBtn);
  panel.append(meta);
}