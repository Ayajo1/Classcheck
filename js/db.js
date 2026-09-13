// db.js — IndexedDB persistence layer for ClassCheck.
// Thin wrapper over the browser IndexedDB API. Domain objects are
// produced by js/models.js; this file only stores and retrieves them.

import { sessionKey } from './models.js';

const DB_NAME = 'classcheck';
const DB_VERSION = 1;

let dbPromise = null;

/** Open (and upgrade if needed) the database. Safe to call repeatedly. */
export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('classes')) {
          db.createObjectStore('classes', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('students')) {
          const store = db.createObjectStore('students', { keyPath: 'id' });
          store.createIndex('byClassId', 'classId', { unique: false });
        }
        if (!db.objectStoreNames.contains('records')) {
          const store = db.createObjectStore('records', { keyPath: 'id' });
          store.createIndex('byClassDate', 'classDate', { unique: false });
          store.createIndex('byStudent', 'studentId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error || new Error('Failed to open IndexedDB'));
      };
    });
  }
  return dbPromise;
}

function store(db, name, mode = 'readonly') {
  return db.transaction(name, mode).objectStore(name);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ------------------------- generic CRUD ------------------------- */

export async function getAll(name) {
  const db = await openDB();
  const rows = await reqToPromise(store(db, name).getAll());
  return rows || [];
}

export async function put(name, value) {
  const db = await openDB();
  await reqToPromise(store(db, name, 'readwrite').put(value));
  return value;
}

export async function bulkPut(name, values) {
  const db = await openDB();
  const os = store(db, name, 'readwrite');
  for (const v of values) os.put(v);
  return values.length;
}

export async function remove(name, key) {
  const db = await openDB();
  await reqToPromise(store(db, name, 'readwrite').delete(key));
}

export async function clearStore(name) {
  const db = await openDB();
  await reqToPromise(store(db, name, 'readwrite').clear());
}

/* ------------------------- domain helpers ------------------------- */

export const getClasses = () => getAll('classes');
export const saveClass = (klass) => put('classes', klass);
export const getStudents = () => getAll('students');
export const saveStudent = (student) => put('students', student);
export const getRecords = () => getAll('records');

export async function getStudentsByClass(classId) {
  const db = await openDB();
  const rows = await reqToPromise(
    store(db, 'students').index('byClassId').getAll(classId)
  );
  return rows || [];
}

export async function getRecordsForSession(classId, date) {
  const db = await openDB();
  const rows = await reqToPromise(
    store(db, 'records').index('byClassDate').getAll(sessionKey(classId, date))
  );
  return rows || [];
}

export async function getRecordsForStudent(studentId) {
  const db = await openDB();
  const rows = await reqToPromise(
    store(db, 'records').index('byStudent').getAll(studentId)
  );
  return rows || [];
}

/**
 * Upsert a per-session attendance record: at most one record per
 * (class, date, student). Existing record gets its status/method/time
 * overwritten; a new record is inserted otherwise. Returns the saved record.
 */
export async function upsertRecord(rec) {
  const db = await openDB();
  const os = store(db, 'records', 'readwrite');
  rec.classDate = sessionKey(rec.classId, rec.date);
  const existing = await reqToPromise(
    os.index('byClassDate').getAll(rec.classDate)
  );
  const match = (existing || []).find(
    (r) => r.studentId === rec.studentId
  );
  if (match) {
    const updated = { ...match, ...rec };
    await reqToPromise(os.put(updated));
    return updated;
  }
  await reqToPromise(os.put(rec));
  return rec;
}

/** Delete a student and every attendance record they have. */
export async function deleteStudentCascade(studentId) {
  const db = await openDB();
  const rows = await reqToPromise(
    store(db, 'records').index('byStudent').getAll(studentId)
  );
  const os = store(db, 'records', 'readwrite');
  for (const r of rows || []) os.delete(r.id);
  await reqToPromise(store(db, 'students', 'readwrite').delete(studentId));
}

/** Delete a class, its students and all their records. */
export async function deleteClassCascade(classId) {
  const students = await getStudentsByClass(classId);
  const db = await openDB();
  const rows = await reqToPromise(store(db, 'records').getAll());
  const os = store(db, 'records', 'readwrite');
  for (const r of rows || []) {
    if (r.classId === classId) os.delete(r.id);
  }
  const sOs = store(db, 'students', 'readwrite');
  for (const s of students) sOs.delete(s.id);
  await reqToPromise(store(db, 'classes', 'readwrite').delete(classId));
}

/** Wipe all application data (reset demo button). */
export async function wipeAll() {
  const db = await openDB();
  const t = db.transaction(['classes', 'students', 'records'], 'readwrite');
  for (const name of ['classes', 'students', 'records']) {
    t.objectStore(name).clear();
  }
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}