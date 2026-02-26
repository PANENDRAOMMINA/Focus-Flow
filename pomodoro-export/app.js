'use strict';

// ─── Default config ───────────────────────────────────────────────
const DEFAULT_CONFIG = {
    pomodoro: 25, shortBreak: 5, longBreak: 15, interval: 4,
    sounds: true, notify: true,
};

// ─── State ────────────────────────────────────────────────────────
let config = { ...DEFAULT_CONFIG };
let mode = 'pomodoro';
let timeLeft = config.pomodoro * 60;
let totalTime = config.pomodoro * 60;
let isRunning = false;
let isOvertime = false;
let timerId = null;
let sessions = 0;
let totalMins = 0;
let streak = 0;

// Routine state
let routines = JSON.parse(localStorage.getItem('pomoRoutines') || '[]');
let isRoutineMode = false;
let activeRoutineIdx = null;
let routineStepIdx = 0;
let editingIdx = -1;   // -1 = new
let builderSegs = [];   // segments being assembled

// ─── DOM refs ─────────────────────────────────────────────────────
const timeDisplay = document.getElementById('timeDisplay');
const modeLabel = document.getElementById('modeLabel');
const ringProgress = document.getElementById('ringProgress');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const skipBtn = document.getElementById('skipBtn');
const tabButtons = document.querySelectorAll('.tab');

const sessionCount = document.getElementById('sessionCount');
const totalMinutes = document.getElementById('totalMinutes');
const streakCount = document.getElementById('streakCount');

const addTaskBtn = document.getElementById('addTaskBtn');
const taskInputWrap = document.getElementById('taskInputWrap');
const taskInput = document.getElementById('taskInput');
const taskSaveBtn = document.getElementById('taskSaveBtn');
const currentTaskEl = document.getElementById('currentTask');

const settingsBtn = document.getElementById('settingsBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');
const saveSettings = document.getElementById('saveSettings');

const setPomo = document.getElementById('setPomo');
const setShort = document.getElementById('setShort');
const setLong = document.getElementById('setLong');
const setIntervalInput = document.getElementById('setInterval');
const setSounds = document.getElementById('setSounds');
const setNotify = document.getElementById('setNotify');

const routinesBtn = document.getElementById('routinesBtn');
const routinesPanel = document.getElementById('routinesPanel');
const routinesPanelBack = document.getElementById('routinesPanelBack');
const routinesListEl = document.getElementById('routinesList');
const newRoutineBtn = document.getElementById('newRoutineBtn');
const builderPanel = document.getElementById('builderPanel');
const builderBack = document.getElementById('builderBack');
const builderTitle = document.getElementById('builderTitle');
const routineNameInput = document.getElementById('routineNameInput');
const segmentsListEl = document.getElementById('segmentsList');
const addSegmentBtn = document.getElementById('addSegmentBtn');
const saveRoutineBtn = document.getElementById('saveRoutineBtn');
const routineBanner = document.getElementById('routineBanner');
const routineBannerText = document.getElementById('routineBannerText');
const stopRoutineBtn = document.getElementById('stopRoutineBtn');

const CIRCUMFERENCE = 2 * Math.PI * 108; // main ring (r=108)

// ─── Audio ────────────────────────────────────────────────────────
const audioCtx = window.AudioContext ? new AudioContext() : null;
function playTone(freq = 880, dur = 0.4, type = 'sine', gain = 0.35) {
    if (!audioCtx || !config.sounds) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const vol = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    vol.gain.setValueAtTime(gain, audioCtx.currentTime);
    vol.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(vol); vol.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + dur);
}
function playStart() { playTone(660, 0.12); setTimeout(() => playTone(880, 0.18), 130); }
function playComplete() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.35, 'sine', 0.3), i * 180)); }
function playTick(gainMultiplier = 1) { playTone(1200, 0.06, 'square', 0.08 * gainMultiplier); }

// ─── Helpers ──────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }
function fmt(s) { return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; }
function clamp(v, a, b) { return Math.min(Math.max(v, a), b); }
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ─── Main ring display ────────────────────────────────────────────
function updateRing() {
    if (isOvertime) { ringProgress.style.strokeDashoffset = 0; return; }
    const offset = CIRCUMFERENCE * (1 - timeLeft / totalTime);
    ringProgress.style.strokeDashoffset = offset;
}
function updateDisplay() {
    if (isOvertime) {
        const extra = Math.abs(timeLeft);
        timeDisplay.textContent = `+${fmt(extra)}`;
        document.title = `+${fmt(extra)} – Focus Flow (Overtime)`;
    } else {
        timeDisplay.textContent = fmt(timeLeft);
        document.title = `${fmt(timeLeft)} – Focus Flow`;
    }
    updateRing();
}
function updateStats() {
    sessionCount.textContent = sessions;
    totalMinutes.textContent = totalMins;
    streakCount.textContent = streak;
}

const MODE_LABELS = { pomodoro: 'Focus Time', shortBreak: 'Short Break', longBreak: 'Long Break' };

function applyMode(newMode) {
    if (isRoutineMode) return;
    mode = newMode;
    document.body.classList.remove('short-break', 'long-break');
    if (mode === 'shortBreak') document.body.classList.add('short-break');
    if (mode === 'longBreak') document.body.classList.add('long-break');
    tabButtons.forEach(t => {
        t.classList.remove('active', 'break-active', 'long-active');
        if (t.dataset.mode === mode) {
            t.classList.add('active');
            if (mode === 'shortBreak') t.classList.add('break-active');
            if (mode === 'longBreak') t.classList.add('long-active');
        }
    });
    modeLabel.textContent = MODE_LABELS[mode];
    totalTime = config[mode] * 60;
    timeLeft = totalTime;
    stopTimer();
    updateDisplay();
}

// ─── Timer core ───────────────────────────────────────────────────
function startTimer() {
    if (isRunning) return;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    isRunning = true;
    playStart();
    startBtn.classList.add('running');
    startBtn.querySelector('.icon-play').classList.add('hidden');
    startBtn.querySelector('.icon-pause').classList.remove('hidden');
    timerId = window.setInterval(() => {
        timeLeft--;
        if (!isOvertime) {
            // Louder single tick at the last minute mark
            if (timeLeft === 60) {
                playTick(2.5); // 2.5x volume exactly at 1 minute mark
                notify('⏳ Final Minute!', 'Concentrate! Only 60 seconds left.');
            }

            // Intense pulsing in the final 10 seconds
            if (timeLeft > 0 && timeLeft <= 10) {
                timeDisplay.classList.add('final-pulse');
            }

            if (timeLeft <= 0) {
                // Enter overtime – alert but keep counting
                isOvertime = true;
                timeDisplay.classList.remove('final-pulse');
                playComplete();
                timeDisplay.classList.add('flash');
                setTimeout(() => timeDisplay.classList.remove('flash'), 1400);
                if (isRoutineMode) {
                    const routine = routines[activeRoutineIdx];
                    const seg = routine.segments[routineStepIdx];
                    notify(seg.type === 'focus' ? '🍅 Time\'s up!' : '☕ Break ended!', 'Click ⏭ to proceed, or keep going!');
                } else if (mode === 'pomodoro') {
                    notify('🍅 Pomodoro Complete!', 'Click ⏭ to proceed, or keep going!');
                } else {
                    notify('✅ Break Over!', 'Click ⏭ to start focusing!');
                }
            }
        }
        updateDisplay();
    }, 1000);
}
function pauseTimer() {
    if (!isRunning) return;
    isRunning = false;
    window.clearInterval(timerId);
    startBtn.classList.remove('running');
    startBtn.querySelector('.icon-play').classList.remove('hidden');
    startBtn.querySelector('.icon-pause').classList.add('hidden');
}
function stopTimer() {
    pauseTimer();
    isOvertime = false;
    timeLeft = totalTime;
    updateDisplay();
}

function onSessionComplete() {
    pauseTimer();
    // If we haven't entered overtime yet, still flash
    if (!isOvertime) {
        playComplete();
        timeDisplay.classList.add('flash');
        setTimeout(() => timeDisplay.classList.remove('flash'), 1400);
    }

    // Elapsed = full duration + any overtime (timeLeft is negative in overtime)
    const elapsed = Math.ceil((totalTime - timeLeft) / 60);
    const wasOvertime = isOvertime;
    isOvertime = false;

    if (isRoutineMode) { advanceRoutineStep(elapsed); return; }

    if (mode === 'pomodoro') {
        sessions++; totalMins += elapsed; streak++;
        updateStats();
        notify('🍅 Focus Session Complete!', `Great work! You focused for ${elapsed} minute${elapsed !== 1 ? 's' : ''}. Time for a break.`);
        if (sessions % config.interval === 0) setTimeout(() => applyMode('longBreak'), 1200);
        else setTimeout(() => applyMode('shortBreak'), 1200);
    } else {
        notify('☕ Break Finished!', 'Ready to jump back in? Your next focus session is starting.');
        setTimeout(() => applyMode('pomodoro'), 1200);
    }
}
function playNotifChime() {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    // Pleasant rising chime: C5 → E5 → G5 → C6
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const vol = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + i * 0.2);
        vol.gain.setValueAtTime(0.25, audioCtx.currentTime + i * 0.2);
        vol.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.2 + 0.5);
        osc.connect(vol); vol.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + i * 0.2);
        osc.stop(audioCtx.currentTime + i * 0.2 + 0.5);
    });
}

function showInPageNotif(title, body) {
    // Fallback: show a toast-style banner inside the app
    let toast = document.getElementById('notifToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'notifToast';
        toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;' +
            'background:linear-gradient(135deg,var(--accent-start),var(--accent-end));color:#fff;padding:14px 22px;' +
            'border-radius:14px;font-family:inherit;font-size:14px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.35);' +
            'text-align:center;transition:opacity 0.4s,transform 0.4s;opacity:0;pointer-events:none;';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<strong>${title}</strong><br><span style="opacity:0.9;font-size:13px">${body}</span>`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(-50%) translateY(-20px)'; }, 6000);
}

function notify(title, body) {
    // Always play the chime sound on timer events
    if (config.sounds) playNotifChime();
    // Always show the in-page toast (works on file://, mobile, everywhere)
    showInPageNotif(title, body);

    // Capacitor Native Notifications (Android)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
        try {
            window.Capacitor.Plugins.LocalNotifications.schedule({
                notifications: [{
                    title,
                    body,
                    id: Math.floor(Math.random() * 2147483647),
                    smallIcon: 'ic_stat_icon_config_sample',
                    iconColor: '#ff6347'
                }]
            });
        } catch (_) { }
    }

    // Web Desktop notification if enabled AND permission granted
    if (config.notify && 'Notification' in window && Notification.permission === 'granted') {
        try {
            const n = new Notification(title, {
                body,
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">🍅</text></svg>',
                tag: 'focusflow-timer',
                requireInteraction: true,
            });
            setTimeout(() => n.close(), 8000);
        } catch (_) {
            // Desktop notification unavailable — in-page toast already shown
        }
    }
}

// ─── Events – main timer ──────────────────────────────────────────
startBtn.addEventListener('click', () => isRunning ? pauseTimer() : startTimer());
resetBtn.addEventListener('click', () => {
    if (isRoutineMode) { stopRoutine(); return; }
    stopTimer();
});
skipBtn.addEventListener('click', () => onSessionComplete());

tabButtons.forEach(t => t.addEventListener('click', () => {
    if (!isRoutineMode && t.dataset.mode !== mode) applyMode(t.dataset.mode);
}));

addTaskBtn.addEventListener('click', () => {
    taskInputWrap.classList.toggle('hidden');
    if (!taskInputWrap.classList.contains('hidden')) taskInput.focus();
});
taskSaveBtn.addEventListener('click', saveTask);
taskInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveTask(); });
function saveTask() {
    currentTaskEl.textContent = taskInput.value.trim() || 'No task set — stay focused!';
    taskInput.value = '';
    taskInputWrap.classList.add('hidden');
}

document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); isRunning ? pauseTimer() : startTimer(); }
    if (e.code === 'KeyR') stopTimer();
    if (e.code === 'KeyS') onSessionComplete();
});

// ─── Settings modal ───────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
    setPomo.value = config.pomodoro; setShort.value = config.shortBreak;
    setLong.value = config.longBreak; setIntervalInput.value = config.interval;
    setSounds.checked = config.sounds; setNotify.checked = config.notify;
    modalOverlay.classList.remove('hidden');
});
modalClose.addEventListener('click', () => modalOverlay.classList.add('hidden'));
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) modalOverlay.classList.add('hidden'); });
saveSettings.addEventListener('click', () => {
    config.pomodoro = clamp(parseInt(setPomo.value) || 25, 1, 60);
    config.shortBreak = clamp(parseInt(setShort.value) || 5, 1, 30);
    config.longBreak = clamp(parseInt(setLong.value) || 15, 1, 60);
    config.interval = clamp(parseInt(setIntervalInput.value) || 4, 2, 10);
    config.sounds = setSounds.checked;
    config.notify = setNotify.checked;
    modalOverlay.classList.add('hidden');
    if (!isRoutineMode) applyMode(mode);
});

// ─── ROUTINES ────────────────────────────────────────────────────

// Panel navigation
routinesBtn.addEventListener('click', () => { renderRoutinesList(); routinesPanel.classList.add('open'); });
routinesPanelBack.addEventListener('click', () => routinesPanel.classList.remove('open'));
newRoutineBtn.addEventListener('click', () => openBuilder(-1));
builderBack.addEventListener('click', () => builderPanel.classList.remove('open'));
saveRoutineBtn.addEventListener('click', saveCurrentRoutine);
addSegmentBtn.addEventListener('click', () => {
    builderSegs.push({ type: 'focus', minutes: 25, direction: 'down' });
    renderSegments();
});
stopRoutineBtn.addEventListener('click', stopRoutine);

function openBuilder(idx) {
    editingIdx = idx;
    if (idx === -1) {
        builderTitle.textContent = 'New Routine';
        routineNameInput.value = '';
        builderSegs = [{ type: 'focus', minutes: 25, direction: 'down' }];
    } else {
        builderTitle.textContent = 'Edit Routine';
        routineNameInput.value = routines[idx].name;
        builderSegs = routines[idx].segments.map(s => ({ ...s }));
    }
    renderSegments();
    builderPanel.classList.add('open');
}

function saveCurrentRoutine() {
    if (builderSegs.length === 0) { alert('Add at least one segment!'); return; }
    const r = { name: routineNameInput.value.trim() || 'My Routine', segments: builderSegs.map(s => ({ ...s })) };
    if (editingIdx === -1) routines.push(r); else routines[editingIdx] = r;
    localStorage.setItem('pomoRoutines', JSON.stringify(routines));
    builderPanel.classList.remove('open');
    renderRoutinesList();
}

function deleteRoutine(idx) {
    if (!confirm('Delete this routine?')) return;
    routines.splice(idx, 1);
    localStorage.setItem('pomoRoutines', JSON.stringify(routines));
    renderRoutinesList();
}

function totalRoutineTime(r) { return r.segments.reduce((s, x) => s + x.minutes, 0); }

function renderRoutinesList() {
    if (!routines.length) {
        routinesListEl.innerHTML = `<div class="empty-routines"><div class="empty-icon">🗂️</div><p>No routines yet</p><span>Create your first custom routine to get started!</span></div>`;
        return;
    }
    routinesListEl.innerHTML = routines.map((r, i) => `
    <div class="routine-card">
      <div class="routine-info">
        <div class="routine-name">${esc(r.name)}</div>
        <div class="routine-meta">${r.segments.length} segment${r.segments.length !== 1 ? 's' : ''} · ${totalRoutineTime(r)} min total</div>
      </div>
      <div class="routine-actions">
        <button class="r-btn r-play" onclick="runRoutine(${i})" title="Run">▶</button>
        <button class="r-btn r-edit" onclick="openBuilder(${i})" title="Edit">✏️</button>
        <button class="r-btn r-del" onclick="deleteRoutine(${i})" title="Delete">🗑️</button>
      </div>
    </div>`).join('');
}

// ─── Builder – Circular Picker ────────────────────────────────────
const SEG_R = 58; // SVG circle radius
const SEG_CX = 80; // SVG viewBox center
const SEG_CY = 80;
const SEG_CIRC = 2 * Math.PI * SEG_R;

function segGrad(type) {
    return type === 'focus' ? ['#ff6b6b', '#ffa500'] : ['#43e97b', '#38f9d7'];
}
function handleXY(mins) {
    const angle = (mins / 60) * 2 * Math.PI - Math.PI / 2;
    return { x: SEG_CX + SEG_R * Math.cos(angle), y: SEG_CY + SEG_R * Math.sin(angle) };
}

function renderSegments() {
    segmentsListEl.innerHTML = '';
    // Clean up old drag listeners by replacing the element (done implicitly by innerHTML)
    builderSegs.forEach((seg, i) => {
        const [c1, c2] = segGrad(seg.type);
        const dashOff = SEG_CIRC * (1 - seg.minutes / 60);
        const hp = handleXY(seg.minutes);
        const gradId = `sg${i}`;

        const card = document.createElement('div');
        card.className = 'segment-builder-card';
        card.innerHTML = `
      <div class="seg-card-top">
        <span class="seg-number-badge">${i + 1}</span>
        <button class="seg-delete-btn" id="segDel${i}">✕</button>
      </div>
      <div class="seg-ring-wrap">
        <svg class="seg-ring-svg" viewBox="0 0 160 160" id="segSvg${i}">
          <defs>
            <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${c1}"/>
              <stop offset="100%" stop-color="${c2}"/>
            </linearGradient>
          </defs>
          <circle class="seg-ring-bg-circle" cx="${SEG_CX}" cy="${SEG_CY}" r="${SEG_R}"/>
          <circle class="seg-ring-fill" cx="${SEG_CX}" cy="${SEG_CY}" r="${SEG_R}"
            stroke="url(#${gradId})"
            stroke-dasharray="${SEG_CIRC.toFixed(2)}"
            stroke-dashoffset="${dashOff.toFixed(2)}"
            transform="rotate(-90 ${SEG_CX} ${SEG_CY})"
            id="segFill${i}"/>
          <text class="seg-ring-num" x="${SEG_CX}" y="${SEG_CY - 4}" id="segNum${i}">${pad(seg.minutes)}</text>
          <text class="seg-ring-unit" x="${SEG_CX}" y="${SEG_CY + 20}">min</text>
          <circle class="seg-handle-dot" cx="${hp.x.toFixed(2)}" cy="${hp.y.toFixed(2)}" r="10"
            fill="#4a9eff" id="segHandle${i}"/>
        </svg>
      </div>
      <div class="seg-toggles">
        <div class="seg-toggle-group">
          <button class="seg-type-btn ${seg.type === 'focus' ? 'active-focus' : ''}" id="segFocusBtn${i}">Focus</button>
          <button class="seg-type-btn ${seg.type === 'rest' ? 'active-rest' : ''}"  id="segRestBtn${i}">Rest</button>
        </div>
        <div class="seg-toggle-group">
          <button class="seg-dir-btn ${seg.direction === 'down' ? 'active-dir' : ''}" id="segDownBtn${i}">Count down</button>
          <button class="seg-dir-btn ${seg.direction === 'up' ? 'active-dir' : ''}"  id="segUpBtn${i}">Count up</button>
        </div>
      </div>`;

        segmentsListEl.appendChild(card);

        // Add connector arrow (except after last card)
        if (i < builderSegs.length - 1) {
            const conn = document.createElement('div');
            conn.className = 'seg-connector';
            conn.textContent = '↓';
            segmentsListEl.appendChild(conn);
        }

        // Wire buttons
        document.getElementById(`segDel${i}`).onclick = () => { builderSegs.splice(i, 1); renderSegments(); };
        document.getElementById(`segFocusBtn${i}`).onclick = () => { builderSegs[i].type = 'focus'; renderSegments(); };
        document.getElementById(`segRestBtn${i}`).onclick = () => { builderSegs[i].type = 'rest'; renderSegments(); };
        document.getElementById(`segDownBtn${i}`).onclick = () => { builderSegs[i].direction = 'down'; renderSegments(); };
        document.getElementById(`segUpBtn${i}`).onclick = () => { builderSegs[i].direction = 'up'; renderSegments(); };

        // Wire drag on SVG
        attachDrag(i);
    });
}

function attachDrag(i) {
    const svg = document.getElementById(`segSvg${i}`);
    if (!svg) return;
    let dragging = false;

    function minsFromEvent(e) {
        const rect = svg.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const ex = e.touches ? e.touches[0].clientX : e.clientX;
        const ey = e.touches ? e.touches[0].clientY : e.clientY;
        let angle = Math.atan2(ey - cy, ex - cx) + Math.PI / 2;
        if (angle < 0) angle += 2 * Math.PI;
        const m = Math.round((angle / (2 * Math.PI)) * 60);
        return clamp(m === 0 ? 60 : m, 1, 60);
    }

    function nearHandle(e) {
        const rect = svg.getBoundingClientRect();
        const scale = rect.width / 160;
        const hp = handleXY(builderSegs[i].minutes);
        const hx = rect.left + hp.x * scale;
        const hy = rect.top + hp.y * scale;
        const ex = e.touches ? e.touches[0].clientX : e.clientX;
        const ey = e.touches ? e.touches[0].clientY : e.clientY;
        return Math.hypot(ex - hx, ey - hy) < 28;
    }

    function onStart(e) {
        if (!nearHandle(e)) return;
        dragging = true;
        e.preventDefault();
    }
    function onMove(e) {
        if (!dragging) return;
        e.preventDefault();
        builderSegs[i].minutes = minsFromEvent(e);
        updateSegVisual(i);
    }
    function onEnd() { dragging = false; }

    svg.addEventListener('mousedown', onStart);
    svg.addEventListener('touchstart', onStart, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);
}

function updateSegVisual(i) {
    const seg = builderSegs[i];
    const fill = document.getElementById(`segFill${i}`);
    const handle = document.getElementById(`segHandle${i}`);
    const num = document.getElementById(`segNum${i}`);
    const dashOff = SEG_CIRC * (1 - seg.minutes / 60);
    const hp = handleXY(seg.minutes);
    if (fill) fill.setAttribute('stroke-dashoffset', dashOff.toFixed(2));
    if (handle) { handle.setAttribute('cx', hp.x.toFixed(2)); handle.setAttribute('cy', hp.y.toFixed(2)); }
    if (num) num.textContent = pad(seg.minutes);
}

// ─── Routine Playback ─────────────────────────────────────────────
function runRoutine(idx) {
    routinesPanel.classList.remove('open');
    activeRoutineIdx = idx;
    routineStepIdx = 0;
    isRoutineMode = true;
    tabButtons.forEach(t => t.classList.remove('active', 'break-active', 'long-active'));
    routineBanner.classList.remove('hidden');
    loadRoutineStep();
}

function loadRoutineStep() {
    const routine = routines[activeRoutineIdx];
    const seg = routine.segments[routineStepIdx];

    // Colours
    document.body.classList.remove('short-break', 'long-break');
    if (seg.type === 'rest') document.body.classList.add('short-break');

    // Labels
    modeLabel.textContent = `${esc(routine.name)} · Step ${routineStepIdx + 1}/${routine.segments.length}`;
    routineBannerText.textContent = `📋 ${esc(routine.name)} — ${seg.type === 'focus' ? '🔴 Focus' : '🟢 Rest'} · ${seg.minutes} min`;

    // Timer
    totalTime = seg.minutes * 60;
    timeLeft = seg.direction === 'up' ? 0 : totalTime;
    stopTimer();
    updateDisplay();
}

function advanceRoutineStep(elapsed) {
    const routine = routines[activeRoutineIdx];
    routineStepIdx++;

    // Track stats if it was a focus segment — elapsed already includes overtime
    const prevSeg = routine.segments[routineStepIdx - 1];
    if (prevSeg.type === 'focus') {
        sessions++;
        totalMins += elapsed;
        streak++;
        updateStats();
    }

    if (routineStepIdx >= routine.segments.length) {
        // Routine complete
        notify('✅ Routine Complete!', `${routine.name} is done! Great work!`);
        playComplete();
        setTimeout(stopRoutine, 800);
    } else {
        notify('⏭️ Next Segment', `Step ${routineStepIdx + 1} of ${routine.segments.length}`);
        setTimeout(loadRoutineStep, 1200);
    }
}

function stopRoutine() {
    isRoutineMode = false;
    activeRoutineIdx = null;
    routineStepIdx = 0;
    routineBanner.classList.add('hidden');
    document.body.classList.remove('short-break', 'long-break');
    // Restore normal mode
    mode = 'pomodoro';
    tabButtons.forEach(t => {
        t.classList.remove('active', 'break-active', 'long-active');
        if (t.dataset.mode === 'pomodoro') t.classList.add('active');
    });
    totalTime = config.pomodoro * 60;
    timeLeft = totalTime;
    modeLabel.textContent = MODE_LABELS['pomodoro'];
    stopTimer();
    updateDisplay();
}

// ─── THEMES ──────────────────────────────────────────────────────

const THEMES = [
    { id: 'default', name: 'Tomato', bg: '#0f0e17', focusStart: '#ff6b6b', focusEnd: '#ffa500', breakStart: '#43e97b', breakEnd: '#38f9d7' },
    { id: 'ocean', name: 'Ocean Breeze', bg: '#0b1628', focusStart: '#00b4d8', focusEnd: '#0077b6', breakStart: '#48cae4', breakEnd: '#90e0ef' },
    { id: 'lavender', name: 'Lavender Night', bg: '#1a1333', focusStart: '#b388ff', focusEnd: '#7c4dff', breakStart: '#ea80fc', breakEnd: '#e040fb' },
    { id: 'neon', name: 'Cyber Neon', bg: '#0a0a0a', focusStart: '#39ff14', focusEnd: '#00e5ff', breakStart: '#ff2ef1', breakEnd: '#ff6ec7' },
    { id: 'forest', name: 'Forest', bg: '#0d1f0e', focusStart: '#66bb6a', focusEnd: '#2e7d32', breakStart: '#a5d6a7', breakEnd: '#81c784' },
    { id: 'sunset', name: 'Sunset', bg: '#1a0f0a', focusStart: '#ff7043', focusEnd: '#f4511e', breakStart: '#ffab91', breakEnd: '#ff8a65' },
    { id: 'mono', name: 'Monochrome', bg: '#111111', focusStart: '#e0e0e0', focusEnd: '#9e9e9e', breakStart: '#bdbdbd', breakEnd: '#757575' },
    { id: 'sakura', name: 'Sakura', bg: '#1c0f1a', focusStart: '#f48fb1', focusEnd: '#f06292', breakStart: '#f8bbd0', breakEnd: '#f48fb1' },
];

const themesBtn = document.getElementById('themesBtn');
const themesPanel = document.getElementById('themesPanel');
const themesPanelBack = document.getElementById('themesPanelBack');
const themeGrid = document.getElementById('themeGrid');
const applyCustomBtn = document.getElementById('applyCustomTheme');
const resetThemeBtn = document.getElementById('resetThemeBtn');
const customFocusStart = document.getElementById('customFocusStart');
const customFocusEnd = document.getElementById('customFocusEnd');
const customBreakStart = document.getElementById('customBreakStart');
const customBreakEnd = document.getElementById('customBreakEnd');
const customBg = document.getElementById('customBg');

let activeThemeId = 'default';

function applyThemeColors(t) {
    const r = document.documentElement.style;
    r.setProperty('--bg', t.bg);
    r.setProperty('--accent-start', t.focusStart);
    r.setProperty('--accent-end', t.focusEnd);
    r.setProperty('--accent-break-start', t.breakStart);
    r.setProperty('--accent-break-end', t.breakEnd);
    document.body.style.background = t.bg;

    // Update background orbs to match theme
    const orbs = document.querySelectorAll('.orb');
    if (orbs[0]) orbs[0].style.background = `radial-gradient(circle, ${t.focusStart}, transparent)`;
    if (orbs[1]) orbs[1].style.background = `radial-gradient(circle, ${t.breakStart}, transparent)`;
    if (orbs[2]) orbs[2].style.background = `radial-gradient(circle, ${t.focusEnd}, transparent)`;

    // Update custom picker values to match
    customFocusStart.value = t.focusStart;
    customFocusEnd.value = t.focusEnd;
    customBreakStart.value = t.breakStart;
    customBreakEnd.value = t.breakEnd;
    customBg.value = t.bg;
}

function selectTheme(id) {
    activeThemeId = id;
    const theme = THEMES.find(t => t.id === id);
    if (theme) applyThemeColors(theme);
    localStorage.setItem('pomoTheme', JSON.stringify({ id, ...theme }));
    renderThemeGrid();
}

function renderThemeGrid() {
    themeGrid.innerHTML = THEMES.map(t => `
    <div class="theme-card ${t.id === activeThemeId ? 'active-theme' : ''}" onclick="selectTheme('${t.id}')">
      <div class="theme-preview">
        <div class="theme-preview-bg" style="background:${t.bg};border:1px solid rgba(255,255,255,0.1)"></div>
        <div class="theme-dot" style="background:${t.focusStart}"></div>
        <div class="theme-dot" style="background:${t.focusEnd}"></div>
        <div class="theme-dot" style="background:${t.breakStart}"></div>
      </div>
      <div class="theme-card-name">${t.name}</div>
    </div>`).join('');
}

themesBtn.addEventListener('click', () => { renderThemeGrid(); themesPanel.classList.add('open'); });
themesPanelBack.addEventListener('click', () => themesPanel.classList.remove('open'));

applyCustomBtn.addEventListener('click', () => {
    const custom = {
        id: 'custom', name: 'Custom',
        bg: customBg.value,
        focusStart: customFocusStart.value,
        focusEnd: customFocusEnd.value,
        breakStart: customBreakStart.value,
        breakEnd: customBreakEnd.value,
    };
    activeThemeId = 'custom';
    applyThemeColors(custom);
    localStorage.setItem('pomoTheme', JSON.stringify(custom));
    renderThemeGrid();
});

resetThemeBtn.addEventListener('click', () => selectTheme('default'));

// ─── Init ─────────────────────────────────────────────────────────
// Load saved theme
const savedTheme = JSON.parse(localStorage.getItem('pomoTheme') || 'null');
if (savedTheme) {
    activeThemeId = savedTheme.id;
    applyThemeColors(savedTheme);
}

applyMode('pomodoro');
updateStats();

// ─── INTERACTIVE GUIDE ───────────────────────────────────────────

const GUIDE_STEPS = [
    {
        target: null, emoji: '👋', title: 'Welcome to Focus Flow!',
        desc: 'Let me give you a quick tour of the app so you can get the most out of your focus sessions. It only takes a moment!'
    },
    {
        target: '#startBtn', emoji: '▶️', title: 'Start, Pause & Controls',
        desc: 'Click this button to <b>start</b> or <b>pause</b> the timer. Use the left button to <b>reset</b>, and the right button to <b>skip</b> to the next session. When the timer hits zero, it enters <b>overtime</b> — it keeps counting until you manually skip!'
    },
    {
        target: '#modeTabs', emoji: '🔄', title: 'Timer Modes',
        desc: 'Switch between <b>Pomodoro</b> (focus), <b>Short Break</b>, and <b>Long Break</b>. After each focus session, the app auto-suggests the right break for you.'
    },
    {
        target: '#routinesBtn', emoji: '📋', title: 'Custom Routines',
        desc: 'Create your own timer sequences! Open this panel, tap <b>+ New</b>, then chain multiple <b>Focus</b> and <b>Rest</b> segments. Drag the circular dial to set each duration. Hit <b>Save</b>, then <b>▶</b> to run it.'
    },
    {
        target: '#themesBtn', emoji: '🎨', title: 'Change Theme & Colors',
        desc: 'Pick from <b>8 beautiful presets</b> (Ocean, Neon, Sakura…). Or scroll down to <b>Custom Colors</b> to create your own palette with color pickers. Your theme is saved automatically!'
    },
    {
        target: '#settingsBtn', emoji: '⚙️', title: 'Settings',
        desc: 'Customize timer durations, set how often a <b>long break</b> occurs, and enable <b>sound alerts</b> and <b>browser notifications</b>.'
    },
    {
        target: '.task-section', emoji: '📝', title: 'Track Your Task',
        desc: 'Hit <b>+ Add Task</b> to type what you\'re working on. It keeps you focused and accountable during each session.'
    },
    {
        target: '.stats-row', emoji: '📊', title: 'Your Stats',
        desc: '<b>Sessions</b> completed, total <b>minutes</b> focused, and your current <b>streak</b> — all tracked in real time.'
    },
    {
        target: null, emoji: '⌨️', title: 'Keyboard Shortcuts',
        desc: '<b>Space</b> → Start / Pause<br><b>R</b> → Reset timer<br><b>S</b> → Skip to next session<br><br>You\'re all set — press <b>Finish</b> to start focusing! 🚀'
    },
];

const guideOverlay = document.getElementById('guideOverlay');
const guideSpotlight = document.getElementById('guideSpotlight');
const guideTooltip = document.getElementById('guideTooltip');
const guideStepBadge = document.getElementById('guideStepBadge');
const guideEmoji = document.getElementById('guideEmoji');
const guideTitle = document.getElementById('guideTitle');
const guideDesc = document.getElementById('guideDesc');
const guidePrev = document.getElementById('guidePrev');
const guideNext = document.getElementById('guideNext');
const guideClose = document.getElementById('guideClose');
const guideBtn = document.getElementById('guideBtn');
let guideStep = 0;

function startGuide() {
    guideStep = 0;
    guideOverlay.classList.remove('hidden');
    guideBtn.classList.remove('pulse');
    showGuideStep();
}

function endGuide() {
    guideOverlay.classList.add('hidden');
    document.querySelectorAll('.guide-highlight').forEach(el => el.classList.remove('guide-highlight'));
    localStorage.setItem('pomoGuideSeen', 'true');
}

function showGuideStep() {
    const step = GUIDE_STEPS[guideStep];
    const total = GUIDE_STEPS.length;
    guideStepBadge.textContent = `${guideStep + 1} / ${total}`;
    guideEmoji.textContent = step.emoji;
    guideTitle.textContent = step.title;
    guideDesc.innerHTML = step.desc;
    guidePrev.classList.toggle('hidden', guideStep === 0);
    guideNext.textContent = guideStep === total - 1 ? 'Finish ✓' : 'Next →';
    document.querySelectorAll('.guide-highlight').forEach(el => el.classList.remove('guide-highlight'));

    if (step.target) {
        const el = document.querySelector(step.target);
        if (el) {
            el.classList.add('guide-highlight');
            const rect = el.getBoundingClientRect();
            const pad = 10;
            guideSpotlight.style.display = 'block';
            guideSpotlight.style.left = (rect.left - pad) + 'px';
            guideSpotlight.style.top = (rect.top - pad) + 'px';
            guideSpotlight.style.width = (rect.width + pad * 2) + 'px';
            guideSpotlight.style.height = (rect.height + pad * 2) + 'px';

            // Reset position so we can measure the tooltip
            guideTooltip.style.left = '0px';
            guideTooltip.style.top = '0px';
            guideTooltip.style.transform = 'none';
            const ttRect = guideTooltip.getBoundingClientRect();
            const ttH = ttRect.height;
            const ttW = ttRect.width;

            // Horizontal: center on target, clamp to viewport
            let tLeft = rect.left + rect.width / 2 - ttW / 2;
            tLeft = Math.max(16, Math.min(tLeft, window.innerWidth - ttW - 16));

            // Vertical: prefer below target, fall back to above, then clamp
            const gapBelowTarget = window.innerHeight - rect.bottom - pad;
            const gapAboveTarget = rect.top - pad;
            let tTop;
            if (gapBelowTarget >= ttH + 16) {
                tTop = rect.bottom + pad + 12;
            } else if (gapAboveTarget >= ttH + 16) {
                tTop = rect.top - pad - ttH - 12;
            } else {
                tTop = Math.max(16, Math.min(window.innerHeight - ttH - 16, rect.bottom + pad + 12));
            }

            guideTooltip.style.left = tLeft + 'px';
            guideTooltip.style.top = tTop + 'px';
        }
    } else {
        guideSpotlight.style.display = 'none';
        guideTooltip.style.left = '50%';
        guideTooltip.style.top = '50%';
        guideTooltip.style.transform = 'translate(-50%, -50%)';
    }
}

guideNext.addEventListener('click', () => {
    if (guideStep >= GUIDE_STEPS.length - 1) { endGuide(); return; }
    guideStep++; showGuideStep();
});
guidePrev.addEventListener('click', () => { if (guideStep > 0) { guideStep--; showGuideStep(); } });
guideClose.addEventListener('click', endGuide);
guideBtn.addEventListener('click', startGuide);
window.addEventListener('resize', () => { if (!guideOverlay.classList.contains('hidden')) showGuideStep(); });

// Auto-show guide on first visit
if (!localStorage.getItem('pomoGuideSeen')) {
    guideBtn.classList.add('pulse');
    setTimeout(startGuide, 800);
}

// ─── Android hardware back button ────────────────────────────────
// Uses Capacitor's App plugin if available (runs inside WebView)
function handleAndroidBack() {
    // Priority: guide > modal > builder panel > themes panel > routines panel > minimize
    if (!guideOverlay.classList.contains('hidden')) {
        endGuide();
        return;
    }
    if (!modalOverlay.classList.contains('hidden')) {
        modalOverlay.classList.add('hidden');
        return;
    }
    if (builderPanel.classList.contains('open')) {
        builderPanel.classList.remove('open');
        return;
    }
    if (themesPanel.classList.contains('open')) {
        themesPanel.classList.remove('open');
        return;
    }
    if (routinesPanel.classList.contains('open')) {
        routinesPanel.classList.remove('open');
        return;
    }
    // Nothing open — minimize app (Android behaviour)
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        window.Capacitor.Plugins.App.minimizeApp();
    }
}

// Wire up Capacitor back button
if (window.Capacitor) {
    document.addEventListener('ionBackButton', ev => {
        ev.detail.register(10, handleAndroidBack);
    });
    // Also try the Capacitor 3+ App plugin listener
    try {
        window.Capacitor.Plugins.App.addListener('backButton', handleAndroidBack);
    } catch (_) { }
}

// ─── Dynamic manifest + native notification permission on page load ──────
(function init() {
    // Load manifest.json
    if (window.location.protocol !== 'file:') {
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = 'manifest.json';
        document.head.appendChild(link);
    }
    // Web Notification permission
    if ('Notification' in window && config.notify && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    // Capacitor Native Notification permission
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
        try {
            window.Capacitor.Plugins.LocalNotifications.requestPermissions();
        } catch (_) { }
    }
})();
