// models.js — pure domain logic for ClassCheck. No DOM, no IndexedDB.
// Everything here is unit-testable in Node.

export const STATUSES = ['present', 'late', 'absent', 'excused'];

export const STATUS_LABELS = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
  pending: 'Pending',
};

export const METHODS = ['kiosk', 'teacher'];

/** Local date key: YYYY-MM-DD (never uses UTC, so it matches the classroom clock). */
export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** HH:MM local time string. */
export function timeHHMM(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** HH:MM >= HH:MM comparison using lexicographic order (safe for zero-padded). */
export function isAfterOrAtHHMM(a, b) {
  return a >= b;
}

/**
 * Determine status at a check-in moment given the late cutoff.
 * Returns 'present' or 'late'.
 */
export function statusForArrival(arrivalHHMM, cutoffHHMM) {
  if (!cutoffHHMM) return 'present';
  return isAfterOrAtHHMM(arrivalHHMM, cutoffHHMM) ? 'late' : 'present';
}

/**
 * Generate a numeric code of `len` digits using an injectable RNG.
 * rng: () => number in [0,1). Defaults to Math.random.
 */
export function genCode(len = 4, rng = Math.random) {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += String(Math.floor(rng() * 10));
  }
  return out;
}

/**
 * Verify a user-entered code against a stored code.
 * Accepts digits/whitespace only; case-insensitive; constant-time-ish compare.
 */
export function verifyCode(input, stored) {
  if (typeof input !== 'string' || typeof stored !== 'string') return false;
  const a = input.replace(/\D/g, '');
  const b = stored.replace(/\D/g, '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Initials from a name: "Ada Lovelace" -> "AL", "plato" -> "P". */
export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/** Stable pseudo-random color pick from a name (for avatar tiles). */
export function avatarHue(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

let uidCounter = 0;
/** Unique-enough id (timestamp + counter + random). Injectable clock for tests. */
export function uid(clock = Date.now) {
  uidCounter = (uidCounter + 1) % 10000;
  return `${clock().toString(36)}-${uidCounter.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/* ------------------------------- CSV I/O ------------------------------- */

/**
 * Parse CSV text into rows of strings. Handles quotes, embedded commas,
 * escaped quotes ("") and CRLF. Returns array of arrays.
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (c === '\r') {
      // skip; handled with \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

/** Escape one CSV field. */
export function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize rows (arrays) to CSV text with CRLF line endings. */
export function toCSV(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

const STUDENT_CSV_HEADER = ['name', 'student_id', 'seat', 'pin'];

/**
 * Convert parsed CSV rows into student objects.
 * Header row is detected and consumed. Requires `name`.
 * Returns { students, errors } where errors is an array of strings.
 */
export function studentsFromCSVRows(rows) {
  const students = [];
  const errors = [];
  if (!rows || rows.length === 0) return { students, errors: ['CSV is empty'] };

  let start = 0;
  const first = rows[0].map((v) => String(v).trim().toLowerCase());
  if (first.includes('name')) {
    start = 1;
  }
  const idx = {
    name: first.indexOf('name'),
    student_id: first.indexOf('student_id'),
    seat: first.indexOf('seat'),
    pin: first.indexOf('pin'),
  };
  const hasHeader = first.includes('name');
  if (!hasHeader) {
    // Positional: name, student_id, seat, pin
    idx.name = 0; idx.student_id = 1; idx.seat = 2; idx.pin = 3;
  }

  const seenNames = new Set();
  for (let r = start; r < rows.length; r += 1) {
    const lineNo = r + 1;
    const vals = rows[r].map((v) => String(v).trim());
    const name = vals[idx.name] || '';
    if (!name) {
      errors.push(`Line ${lineNo}: missing name`);
      continue;
    }
    const key = name.toLowerCase();
    if (seenNames.has(key)) {
      errors.push(`Line ${lineNo}: duplicate name "${name}"`);
      continue;
    }
    seenNames.add(key);
    const student = {
      id: uid(),
      name,
      studentId: idx.student_id >= 0 ? vals[idx.student_id] || '' : '',
      seat: idx.seat >= 0 ? vals[idx.seat] || '' : '',
      pin: '',
    };
    const rawPin = idx.pin >= 0 ? vals[idx.pin] || '' : '';
    if (rawPin) {
      const digits = rawPin.replace(/\D/g, '');
      if (digits.length === 0 || digits.length > 6) {
        errors.push(`Line ${lineNo}: PIN must be 1–6 digits`);
      } else {
        student.pin = digits;
      }
    }
    students.push(student);
  }
  return { students, errors };
}

/** Serialize students to CSV text (with header). */
export function studentsToCSV(students) {
  const rows = [STUDENT_CSV_HEADER.slice()];
  for (const s of students) {
    rows.push([s.name || '', s.studentId || '', s.seat || '', s.pin || '']);
  }
  return toCSV(rows);
}

/* ----------------------------- stats ----------------------------- */

/**
 * Compute attendance stats from records for one student.
 * records: [{ status, ... }] any length; order does not matter for rates.
 * Returns { total, present, late, absent, excused, pending, rate }
 * rate = (present + late + excused) / (total - pending) when denominator > 0, else null.
 * "present" count includes only exact 'present'; late tracked separately.
 * Attendance rate counts present + late + excused as attended.
 */
export function computeStats(records) {
  const counts = { present: 0, late: 0, absent: 0, excused: 0, pending: 0 };
  let total = 0;
  for (const rec of records || []) {
    total += 1;
    const s = rec && rec.status;
    if (s in counts) counts[s] += 1;
    else counts.pending += 1;
  }
  const attended = counts.present + counts.late + counts.excused;
  const denominator = total - counts.pending;
  const rate = denominator > 0 ? attended / denominator : null;
  return { total, ...counts, attended, rate };
}

/**
 * Current streak of attended days, scanning records sorted by date desc.
 * A day counts as attended if status is present/late/excused.
 * Records: [{ date: 'YYYY-MM-DD', status }] — will be sorted internally.
 */
export function currentStreak(records) {
  if (!records || records.length === 0) return 0;
  const attended = (s) => s === 'present' || s === 'late' || s === 'excused';
  const byDate = new Map();
  for (const rec of records) {
    if (!rec || !rec.date) continue;
    const existing = byDate.get(rec.date);
    if (!existing || (attended(rec.status) && !attended(existing.status))) {
      byDate.set(rec.date, rec);
    }
  }
  const dates = Array.from(byDate.keys()).sort().reverse();
  let streak = 0;
  for (const d of dates) {
    if (attended(byDate.get(d).status)) streak += 1;
    else break;
  }
  return streak;
}

/**
 * Lates count over the last N records by date desc.
 */
export function lateCount(records) {
  let n = 0;
  for (const rec of records || []) {
    if (rec && rec.status === 'late') n += 1;
  }
  return n;
}

/**
 * Session lookup key: classId + date.
 */
export function sessionKey(classId, date) {
  return `${classId}|${date}`;
}

/**
 * Attendance record shape factory.
 */
export function makeRecord({ classId, date, studentId, status, method = 'teacher', time, codeVerified = false }) {
  return {
    id: uid(),
    classId,
    date,
    studentId,
    status,
    method,
    time: time || timeHHMM(),
    codeVerified,
    createdAt: Date.now(),
  };
}

/**
 * Student factory with defaults.
 */
export function makeStudent({ name, studentId = '', seat = '', pin = '' } = {}) {
  if (!name || !String(name).trim()) throw new Error('Student name is required');
  return {
    id: uid(),
    name: String(name).trim(),
    studentId,
    seat,
    pin,
    createdAt: Date.now(),
  };
}

/**
 * Class factory with defaults.
 */
export function makeClass({ name, room = '', lateCutoff = '08:30' } = {}) {
  if (!name || !String(name).trim()) throw new Error('Class name is required');
  return {
    id: uid(),
    name: String(name).trim(),
    room,
    lateCutoff,
    createdAt: Date.now(),
  };
}