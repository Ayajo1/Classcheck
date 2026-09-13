// tests/models.test.mjs — unit tests for the pure domain logic in js/models.js.
// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/models.js';

/* ------------------------------ dates/time ------------------------------ */

test('dateKey formats local date as YYYY-MM-DD', () => {
  assert.equal(M.dateKey(new Date(2026, 2, 5, 23, 59)), '2026-03-05');
  assert.equal(M.dateKey(new Date(1999, 0, 9)), '1999-01-09');
});

test('timeHHMM formats local time zero-padded', () => {
  assert.equal(M.timeHHMM(new Date(2026, 2, 5, 7, 4)), '07:04');
  assert.equal(M.timeHHMM(new Date(2026, 2, 5, 23, 0)), '23:00');
});

test('isAfterOrAtHHMM is inclusive and lexicographic-safe', () => {
  assert.equal(M.isAfterOrAtHHMM('08:30', '08:30'), true);
  assert.equal(M.isAfterOrAtHHMM('08:31', '08:30'), true);
  assert.equal(M.isAfterOrAtHHMM('08:29', '08:30'), false);
  assert.equal(M.isAfterOrAtHHMM('07:59', '08:00'), false);
});

test('statusForArrival marks late at/after cutoff, present before', () => {
  assert.equal(M.statusForArrival('08:00', '08:30'), 'present');
  assert.equal(M.statusForArrival('08:30', '08:30'), 'late');
  assert.equal(M.statusForArrival('09:00', '08:30'), 'late');
  assert.equal(M.statusForArrival('10:00', ''), 'present');
});

/* -------------------------------- codes --------------------------------- */

test('genCode produces len digits and respects injected rng', () => {
  const code = M.genCode(4, () => 0.5);
  assert.equal(code, '5555');
  const code6 = M.genCode(6, () => 0);
  assert.equal(code6, '000000');
  const real = M.genCode(4);
  assert.match(real, /^\d{4}$/);
});

test('verifyCode compares digits ignoring whitespace, lengths must match', () => {
  assert.equal(M.verifyCode('1234', '1234'), true);
  assert.equal(M.verifyCode('1 2 3 4', '1234'), true);
  assert.equal(M.verifyCode('123', '1234'), false);
  assert.equal(M.verifyCode('1235', '1234'), false);
  assert.equal(M.verifyCode(null, '1234'), false);
  assert.equal(M.verifyCode('1234', undefined), false);
});

/* ------------------------------- helpers -------------------------------- */

test('initials handles single, multi and empty names', () => {
  assert.equal(M.initials('Ada Lovelace'), 'AL');
  assert.equal(M.initials('plato'), 'P');
  assert.equal(M.initials('  alice   bob  '), 'AB');
  assert.equal(M.initials(''), '?');
});

test('avatarHue is stable, in [0,360), and varies by name', () => {
  assert.equal(M.avatarHue('Ada'), M.avatarHue('Ada'));
  const h = M.avatarHue('Ada');
  assert.ok(h >= 0 && h < 360);
  assert.notEqual(M.avatarHue('Ada'), M.avatarHue('Bob'));
});

test('uid is unique per call and honors injected clock', () => {
  const fixed = () => 1000;
  const a = M.uid(fixed);
  const b = M.uid(fixed);
  assert.notEqual(a, b);
  assert.match(a, /^rs-[a-z0-9]+-[a-z0-9]+$/);
  const many = new Set();
  for (let i = 0; i < 200; i += 1) many.add(M.uid());
  assert.equal(many.size, 200);
});

/* ------------------------------- CSV I/O -------------------------------- */

test('parseCSV handles plain rows', () => {
  assert.deepEqual(M.parseCSV('a,b\n1,2'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('parseCSV handles quotes, embedded commas and escaped quotes', () => {
  assert.deepEqual(M.parseCSV('"a,b",c\n"d""e",f'), [
    ['a,b', 'c'],
    ['d"e', 'f'],
  ]);
});

test('parseCSV strips BOM and CRLF, drops blank lines, keeps final row', () => {
  assert.deepEqual(M.parseCSV('\uFEFFname,age\r\nAlice,30\r\n\r\nBob,25'), [
    ['name', 'age'],
    ['Alice', '30'],
    ['Bob', '25'],
  ]);
  assert.deepEqual(M.parseCSV('only'), [['only']]);
  assert.deepEqual(M.parseCSV('a,b\n'), [['a', 'b']]);
});

test('csvEscape quotes fields containing comma, quote or newline', () => {
  assert.equal(M.csvEscape('plain'), 'plain');
  assert.equal(M.csvEscape('a,b'), '"a,b"');
  assert.equal(M.csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(M.csvEscape('line1\nline2'), '"line1\nline2"');
  assert.equal(M.csvEscape(null), '');
});

test('toCSV round-trips through parseCSV', () => {
  const rows = [
    ['name', 'student_id', 'seat', 'pin'],
    ['Ada, Jr.', 'S-001', 'A1', '1234'],
    ['Bob "The Builder"', 'S-002', 'A2', ''],
  ];
  const text = M.toCSV(rows);
  assert.deepEqual(M.parseCSV(text), rows);
});

/* --------------------------- CSV student import ------------------------- */

test('studentsFromCSVRows parses a header CSV and validates pins', () => {
  const { students, errors } = M.studentsFromCSVRows(M.parseCSV(
    'name,student_id,seat,pin\nAda,S-1,A1,1234\nBob,S-2,A2,1234567\n'));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /PIN must be 1–6 digits/);
  assert.equal(students.length, 2);
  assert.equal(students[0].name, 'Ada');
  assert.equal(students[0].studentId, 'S-1');
  assert.equal(students[0].seat, 'A1');
  assert.equal(students[0].pin, '1234');
  assert.equal(students[1].pin, ''); // bad PIN rejected, student kept
});

test('studentsFromCSVRows supports headerless positional rows', () => {
  const { students, errors } = M.studentsFromCSVRows(M.parseCSV('Carol,S-3,B1\nDave,S-4,B2'));
  assert.equal(errors.length, 0);
  assert.equal(students.length, 2);
  assert.equal(students[0].name, 'Carol');
  assert.equal(students[0].studentId, 'S-3');
  assert.equal(students[0].seat, 'B1');
});

test('studentsFromCSVRows reports missing names and duplicates', () => {
  const { students, errors } = M.studentsFromCSVRows(M.parseCSV(
    'name,student_id,seat,pin\nAda,S-1,,\n\n  ,S-2,,\nada,S-3,,\n'));
  assert.equal(students.length, 1);
  assert.equal(students[0].name, 'Ada');
  assert.equal(errors.length, 2);
  assert.match(errors[0], /missing name/);
  assert.match(errors[1], /duplicate name "ada"/);
});

test('studentsFromCSVRows errors on empty input', () => {
  const { students, errors } = M.studentsFromCSVRows([]);
  assert.equal(students.length, 0);
  assert.deepEqual(errors, ['CSV is empty']);
});

test('studentsToCSV writes header plus one row per student', () => {
  const csv = M.studentsToCSV([
    { name: 'Ada', studentId: 'S-1', seat: 'A1', pin: '1234' },
    { name: 'Bob, Jr.', studentId: 'S-2', seat: 'A2', pin: '' },
  ]);
  assert.deepEqual(M.parseCSV(csv), [
    ['name', 'student_id', 'seat', 'pin'],
    ['Ada', 'S-1', 'A1', '1234'],
    ['Bob, Jr.', 'S-2', 'A2', ''],
  ]);
});

/* --------------------------------- stats -------------------------------- */

test('computeStats counts statuses and computes attendance rate', () => {
  const s = M.computeStats([
    { status: 'present' },
    { status: 'present' },
    { status: 'late' },
    { status: 'absent' },
    { status: 'excused' },
    { status: 'weird' },
    { status: 'pending' },
  ]);
  assert.equal(s.total, 7);
  assert.equal(s.present, 2);
  assert.equal(s.late, 1);
  assert.equal(s.absent, 1);
  assert.equal(s.excused, 1);
  assert.equal(s.pending, 2);
  // attended (present+late+excused=4) / decided (7-2=5)
  assert.ok(Math.abs(s.rate - 4 / 5) < 1e-9);
});

test('computeStats returns null rate when nothing decided', () => {
  const s = M.computeStats([{ status: 'pending' }, { status: 'unknown' }]);
  assert.equal(s.total, 2);
  assert.equal(s.rate, null);
  const empty = M.computeStats([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.rate, null);
});

test('currentStreak counts consecutive attended days backwards', () => {
  const rec = (date, status) => ({ date, status });
  // today present, yesterday late, day before absent -> 2
  assert.equal(M.currentStreak([
    rec('2026-03-10', 'present'),
    rec('2026-03-09', 'late'),
    rec('2026-03-08', 'absent'),
  ]), 2);
  // latest day absent -> 0 even if older days attended
  assert.equal(M.currentStreak([
    rec('2026-03-10', 'absent'),
    rec('2026-03-09', 'present'),
  ]), 0);
  // excused counts as attended
  assert.equal(M.currentStreak([rec('2026-03-10', 'excused')]), 1);
  // multiple records same day: attended record wins
  assert.equal(M.currentStreak([
    rec('2026-03-10', 'absent'),
    rec('2026-03-10', 'present'),
    rec('2026-03-09', 'present'),
  ]), 2);
  assert.equal(M.currentStreak([]), 0);
  assert.equal(M.currentStreak(null), 0);
});

test('lateCount counts only late records', () => {
  assert.equal(M.lateCount([
    { status: 'late' },
    { status: 'present' },
    { status: 'late' },
    null,
    { status: 'late' },
  ]), 3);
  assert.equal(M.lateCount([]), 0);
});

test('sessionKey joins classId and date', () => {
  assert.equal(M.sessionKey('cls-1', '2026-03-10'), 'cls-1|2026-03-10');
});

/* -------------------------------- factories ------------------------------ */

test('makeRecord fills defaults and passes through overrides', () => {
  const r = M.makeRecord({ classId: 'c', date: '2026-03-10', studentId: 's', status: 'present' });
  assert.equal(r.classId, 'c');
  assert.equal(r.date, '2026-03-10');
  assert.equal(r.studentId, 's');
  assert.equal(r.status, 'present');
  assert.equal(r.method, 'teacher');
  assert.equal(r.codeVerified, false);
  assert.match(r.time, /^\d{2}:\d{2}$/);
  assert.ok(r.id);

  const k = M.makeRecord({
    classId: 'c', date: 'd', studentId: 's', status: 'late',
    method: 'kiosk', time: '09:05', codeVerified: true,
  });
  assert.equal(k.method, 'kiosk');
  assert.equal(k.time, '09:05');
  assert.equal(k.codeVerified, true);
});

test('makeStudent trims and requires a name', () => {
  const s = M.makeStudent({ name: '  Ada Lovelace  ', studentId: 'S-1' });
  assert.equal(s.name, 'Ada Lovelace');
  assert.equal(s.studentId, 'S-1');
  assert.equal(s.seat, '');
  assert.equal(s.pin, '');
  assert.ok(s.id);
  assert.throws(() => M.makeStudent({ name: '   ' }), /name is required/);
  assert.throws(() => M.makeStudent({}), /name is required/);
});

test('makeClass trims, requires a name, and defaults the late cutoff', () => {
  const c = M.makeClass({ name: '  Math 101 ' });
  assert.equal(c.name, 'Math 101');
  assert.equal(c.room, '');
  assert.equal(c.lateCutoff, '08:30');
  assert.throws(() => M.makeClass({ name: '' }), /Class name is required/);
  const c2 = M.makeClass({ name: 'B', room: '12', lateCutoff: '09:00' });
  assert.equal(c2.room, '12');
  assert.equal(c2.lateCutoff, '09:00');
});