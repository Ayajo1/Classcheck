# ClassCheck

**Classroom attendance for classes where students don't have phones.**

A single-page web app with two modes on one screen: a **kiosk** students check
themselves in on (a shared laptop, desktop, or tablet at the classroom door),
and a **teacher console** for manual marking, rosters, and reports. No build
step, no backend, no accounts — all data lives in the browser via IndexedDB.

## Quick start

Serve the folder with any static file server and open `index.html`:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk also works; a server is only needed if
you want to reach the app from other machines on the LAN (e.g. a projector
showing the kiosk while you sit at the teacher's laptop).

Use the top bar to switch between **Kiosk check-in** and **Teacher console**.
The last-used mode is remembered. The kiosk remembers its active class
separately, so a door laptop stays pinned to the right class all term.

## The problem

Phones are banned or unavailable, so app-based attendance (QR codes, class
portals, geo-fencing) is out. Paper registers are slow, get lost, and produce
no analytics. Students checking in for friends is the classic failure mode of
any shared-terminal kiosk.

## How ClassCheck solves it

### 1. Kiosk self check-in (js/kiosk.js)

- Students tap their name tile (sorted by seat, with avatar initials).
- They confirm with a **personal 4-digit PIN** on an on-screen keypad — no
  keyboard needed, works on touch screens.
- The check-in is timestamped automatically and marked **late** if it happens
  after the class's cutoff (e.g. 09:05), **present** otherwise.
- A second tap by the same student shows "already checked in" instead of
  creating a duplicate.

### 2. Anti-buddy-checking

This is the part that makes a shared kiosk trustworthy without a phone:

- **Per-student PIN.** Only the student knows their code, so a friend cannot
  tap their tile and pass verification.
- **Lockout on guessing.** Three wrong PIN attempts locks that student's tile
  for 60 seconds, so one student can't brute-force or "help" the whole row.
- **Timestamps are captured by the machine**, not written by a student — a
  buddy can't fake an on-time arrival without the PIN.
- The teacher can always override in the console; overrides are recorded with
  `method: "teacher"` so the audit trail distinguishes self check-ins from
  manual marks.

### 3. Teacher console (js/teacher.js, js/reports.js)

**Today's session** — live view of who's in, with a progress banner
("12 of 27 marked · late after 09:05").

- One-tap status per student: present / late / absent / excused.
- Bulk actions: mark all present, mark all absent, clear, undo (multi-level).
- **Keyboard-first marking** for taking register by seat order:

  | Key | Action |
  | --- | --- |
  | `↓` / `k` | next student |
  | `↑` / `j` | previous student |
  | `1` | present |
  | `2` | late |
  | `3` | absent |
  | `4` | excused |
  | `m` | mark all present |
  | `u` | undo last change |

- Export the current session to CSV.

**Roster** — manage classes and students.

- Add/edit/delete students (name, student ID, seat, PIN). Blank PIN = auto-generated.
- **CSV import** of a roster (see format below); existing rows are matched by
  student ID and updated, new ones added.
- **PIN sheet** — print all students' PINs once at the start of term, cut them
  up, and hand one to each student.
- Create classes with a name, room, and late cutoff.

**Reports** — per-student attendance rate, present/late/absent/excused counts,
current on-time streak, and a 15-session dot sparkline per student. Class-level
cards show sessions held, overall attendance rate, and today's turnout.
Everything exports to CSV.

## Data & privacy

- All records live in **IndexedDB** in the browser profile of the machine
  running the kiosk. Nothing leaves the device; there is no server, no
  analytics, no third-party requests.
- Stores: `classes`, `students`, `records` (one record per student per day,
  upserted — re-checking the same day updates the timestamp instead of
  duplicating).
- Deleting a student or class cascades to their records.
- PINs are stored in plain text on purpose: they are a convenience anti-buddy
  measure, not a security boundary, and there is nothing on the kiosk worth
  attacking. If you need stronger verification, swap `verifyCode` in
  `js/models.js` for a salted hash and the rest of the app is unchanged.
- Use the browser's own profile protection (don't run the kiosk on a shared
  public machine) and clear site data at the end of the year if required.

## CSV formats

**Roster import** (header required, column order free):

```csv
name,student_id,seat,pin
Amina Yusuf,AY-101,1,4821
Bo Lund,AY-102,2,
```

`pin` blank → auto-generated. Rows are matched to existing students by
`student_id`.

**Attendance export** (session or full history):

```csv
date,student,seat,status,method,time
2026-05-12,Amina Yusuf,1,present,kiosk,08:58
2026-05-12,Bo Lund,2,late,kiosk,09:14
```

`method` is `kiosk` (self check-in) or `teacher` (manual mark).

## Project layout

```
index.html          app shell: top bar, mode switch, live clock
styles.css          all styling (kiosk tiles, keypad, console tables)
js/main.js          mode switching, clock, boot
js/db.js            IndexedDB wrapper + typed queries (classes/students/records)
js/models.js        pure domain logic — dates, late cutoff, PINs, CSV, stats
js/ui.js            tiny DOM helpers: h(), clear(), toast(), modals
js/kiosk.js         student self check-in (tiles, keypad, lockout)
js/teacher.js       teacher console (session marking, roster, imports)
js/reports.js       statistics, sparklines, CSV export
tests/models.test.mjs  unit tests for the pure logic
```

The design keeps `js/models.js` free of DOM and IndexedDB so the interesting
rules (late cutoffs, CSV parsing, streaks, stats) are unit-testable in plain
Node.

## Tests

```bash
node --test tests/models.test.mjs
```

27 tests cover date keys, late-cutoff logic, PIN generation and constant-time
comparison, CSV parsing/escaping, attendance stats, streaks, and record
shape/validation.

## Suggested deployment

1. **Door device:** a laptop/tablet/kiosk-mode monitor showing the Kiosk view.
   Set it to the class, keep it awake, tape a note with each student's PIN
   handout schedule.
2. **Teacher device:** the same app in a different browser profile, or the same
   machine behind the "Teacher console" switch. For a shared single device,
   run the kiosk full-screen (F11) and use the console before/after class.
3. Import the roster CSV from your school system, print the PIN sheet, and
   students self-check-in from day one.
4. Export CSV at the end of each term for the school's official system.

## Limitations

- Data is per-browser — a kiosk crash means a fresh IndexedDB. Export regularly
  (the Reports tab CSV export is the backup mechanism).
- PINs are shoulder-surfable on a shared keypad. Lockout limits the damage;
  teacher overrides fix honest mistakes.
- One record per student per day: suitable for once-per-session classes. For
  period-by-period marking, create one class per period.
