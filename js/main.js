// main.js — entry point: clock, mode switching (kiosk/teacher), bootstrapping.
import { renderKiosk, stopKiosk } from './kiosk.js';
import { initTeacher } from './teacher.js';

const MODE_KEY = 'classcheck.mode';

const kioskView = document.getElementById('view-kiosk');
const teacherView = document.getElementById('view-teacher');
const btnKiosk = document.getElementById('btn-kiosk');
const btnTeacher = document.getElementById('btn-teacher');
const clockEl = document.getElementById('clock');

function tickClock() {
  if (!clockEl) return;
  const now = new Date();
  const date = now.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const time = now.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });
  clockEl.textContent = `${date} · ${time}`;
}

async function showMode(mode) {
  const kiosk = mode === 'kiosk';
  kioskView.classList.toggle('hidden', !kiosk);
  teacherView.classList.toggle('hidden', kiosk);
  btnKiosk.classList.toggle('active', kiosk);
  btnTeacher.classList.toggle('active', !kiosk);
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch { /* storage unavailable — ignore */ }
  if (kiosk) {
    stopKiosk();
    await renderKiosk(kioskView);
  } else {
    await initTeacher(teacherView);
  }
}

btnKiosk.addEventListener('click', () => showMode('kiosk'));
btnTeacher.addEventListener('click', () => showMode('teacher'));

tickClock();
setInterval(tickClock, 1000);

let storedMode = 'kiosk';
try {
  const m = localStorage.getItem(MODE_KEY);
  if (m === 'kiosk' || m === 'teacher') storedMode = m;
} catch { /* storage unavailable — keep default */ }

showMode(storedMode);