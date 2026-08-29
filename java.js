/* =========================================================
   AURACOOK ASSISTANT
   - Menus are stored in localStorage (key: "auracook_menus")
   - Each menu: { id, name, description, ingredients, steps: [{ instruction, duration }] }
     duration is in seconds, or null when the step has no timer.
   - There is only ONE active timer interval at a time (timerInterval).
   ========================================================= */

const STORAGE_KEY = "auracook_menus";

/* ---------------- Storage layer (swap for a backend later) ---------------- */
const MenuStore = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt data */ }
    return null;
  },
  save(menus) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(menus));
    } catch (e) { /* storage full / unavailable */ }
  }
};

function uid() {
  return "m_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

function defaultMenus() {
  return [
    {
      id: "default_salmon",
      name: "Pan-Seared Salmon",
      description: "A quick weeknight salmon dish.",
      ingredients: "Salmon fillet\nSalt\nPepper\nLemon\nOlive oil",
      steps: [
        { instruction: "Wash and slice the ingredients into small cubes.", duration: 120 },
        { instruction: "Sear the salmon in hot pan for 3 minutes per side.", duration: 180 },
        { instruction: "Plate nicely and serve hot with lemon slices.", duration: null }
      ]
    }
  ];
}

/* ---------------- App state ---------------- */
let menus = [];
let currentMenuId = null;
let currentStepIndex = 0;

let remainingSeconds = 0;
let hasTimer = false;
let isRunning = false;
let isFinished = false;

let timerInterval = null;
let alarmInterval = null;
let lastTriggerTime = 0;

/* ---------------- DOM refs ---------------- */
const timerDisplayEl = document.getElementById('timerDisplay');
const gestureStatusEl = document.getElementById('gestureStatus');
const pulseOverlay = document.getElementById('pulseOverlay');
const videoWrapper = document.getElementById('videoWrapper');

const stepNumEl = document.getElementById('stepNum');
const stepContentEl = document.getElementById('stepContent');

const btnPrev = document.getElementById('btnPrev');
const btnPause = document.getElementById('btnPause');
const btnNext = document.getElementById('btnNext');

const menuListEl = document.getElementById('menuList');
const menuListPanel = document.getElementById('menuListPanel');
const btnAddMenu = document.getElementById('btnAddMenu');
const btnShowMenus = document.getElementById('btnShowMenus');
const btnEditCurrent = document.getElementById('btnEditCurrent');

const menuModalOverlay = document.getElementById('menuModalOverlay');
const modalTitle = document.getElementById('modalTitle');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnCancelModal = document.getElementById('btnCancelModal');
const btnSaveMenu = document.getElementById('btnSaveMenu');
const inputMenuName = document.getElementById('inputMenuName');
const inputMenuDesc = document.getElementById('inputMenuDesc');
const inputMenuIngredients = document.getElementById('inputMenuIngredients');
const stepsEditor = document.getElementById('stepsEditor');
const btnAddStep = document.getElementById('btnAddStep');

const confirmModalOverlay = document.getElementById('confirmModalOverlay');
const confirmMessage = document.getElementById('confirmMessage');
const btnConfirmCancel = document.getElementById('btnConfirmCancel');
const btnConfirmOk = document.getElementById('btnConfirmOk');

let editingMenuId = null; // null => creating a new menu
let confirmCallback = null;

/* ================= Helpers ================= */
function getMenu(id) {
  return menus.find(m => m.id === id) || null;
}
function getCurrentMenu() {
  return getMenu(currentMenuId);
}
function getCurrentStep() {
  const menu = getCurrentMenu();
  if (!menu) return null;
  return menu.steps[currentStepIndex] || null;
}
function formatTime(totalSecs) {
  const minutes = Math.floor(totalSecs / 60);
  const seconds = totalSecs % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/* ================= Timer engine (single interval) ================= */
function stopTicking() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTicking() {
  stopTicking();
  timerInterval = setInterval(() => {
    if (!isRunning) return;
    remainingSeconds--;
    if (remainingSeconds <= 0) {
      remainingSeconds = 0;
      finishTimer();
    }
    updateTimerUI();
  }, 1000);
}

function finishTimer() {
  isRunning = false;
  isFinished = true;
  stopTicking();
  videoWrapper.classList.add('camera-alert');
  triggerAlarmEffect();
  if (alarmInterval) clearInterval(alarmInterval);
  alarmInterval = setInterval(triggerAlarmEffect, 1200);
}

function stopAlarm() {
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  if ("vibrate" in navigator) {
    navigator.vibrate(0);
  }
}

function triggerAlarmEffect() {
  if ("vibrate" in navigator) {
    navigator.vibrate([400, 200, 400, 200, 400]);
  }
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, timeOffset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.value = 0.2;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + timeOffset);
      osc.stop(audioCtx.currentTime + timeOffset + 0.15);
    };
    playTone(880, 0);
    playTone(880, 0.2);
  } catch (e) { /* audio unavailable */ }

  // Note: the red alert lives only on the camera frame (.video-wrapper.camera-alert).
  // The page-wide pulse border has been intentionally removed here.
}

/* ================= Step / UI rendering ================= */
function loadStep(index) {
  const menu = getCurrentMenu();
  if (!menu || !menu.steps.length) return;

  stopAlarm();
  stopTicking();
  videoWrapper.classList.remove('camera-alert');

  currentStepIndex = Math.max(0, Math.min(index, menu.steps.length - 1));
  const step = menu.steps[currentStepIndex];

  hasTimer = typeof step.duration === 'number' && step.duration > 0;
  remainingSeconds = hasTimer ? step.duration : 0;
  isRunning = false;
  isFinished = false;

  updateStepUI();
  updateTimerUI();
}

function updateStepUI() {
  const menu = getCurrentMenu();
  if (!menu) return;
  stepNumEl.innerText = `Step ${currentStepIndex + 1} of ${menu.steps.length}`;
  stepContentEl.innerText = getCurrentStep().instruction;
}

function updateTimerUI() {
  if (!hasTimer) {
    timerDisplayEl.innerText = 'No Timer';
    timerDisplayEl.className = 'timer-box no-timer';
    setPauseButton('⏵', 'NO TIMER', true);
    return;
  }

  if (isFinished) {
    timerDisplayEl.innerText = "TIME'S UP!";
    timerDisplayEl.className = 'timer-box alarm';
    setPauseButton('↻', 'REPLAY', false);
    return;
  }

  if (isRunning) {
    timerDisplayEl.innerText = `Timer: ${formatTime(remainingSeconds)}`;
    timerDisplayEl.className = 'timer-box';
    setPauseButton('⏸', 'PAUSE', false);
  } else {
    timerDisplayEl.innerText = `PAUSED: ${formatTime(remainingSeconds)}`;
    timerDisplayEl.className = 'timer-box paused';
    setPauseButton('▶', 'PLAY', false);
  }
}

function setPauseButton(icon, label, disabled) {
  btnPause.innerHTML = `${icon}<br>${label}`;
  btnPause.classList.toggle('disabled', disabled);
}

/* ================= Controls: PLAY/PAUSE/REPLAY, NEXT, PREV ================= */
function playPauseAction() {
  if (!hasTimer) return; // no timer on this step, nothing to play/pause

  if (isFinished) {
    replayAction();
    return;
  }

  isRunning = !isRunning;
  updateTimerUI();
  if (isRunning) startTicking();
  else stopTicking();
}

function replayAction() {
  const step = getCurrentStep();
  if (!step || !hasTimer) return;

  stopAlarm();
  videoWrapper.classList.remove('camera-alert');

  isFinished = false;
  remainingSeconds = step.duration;
  isRunning = true;
  updateTimerUI();
  startTicking();
}

function nextAction() {
  const menu = getCurrentMenu();
  if (!menu) return;
  if (currentStepIndex < menu.steps.length - 1) {
    loadStep(currentStepIndex + 1);
  }
}

function prevAction() {
  if (currentStepIndex > 0) {
    loadStep(currentStepIndex - 1);
  }
}

/* ================= Menu list rendering & selection ================= */
function persistMenus() {
  MenuStore.save(menus);
}

function renderMenuList() {
  menuListEl.innerHTML = '';
  menus.forEach(menu => {
    const item = document.createElement('div');
    item.className = 'menu-list-item' + (menu.id === currentMenuId ? ' active' : '');

    const name = document.createElement('div');
    name.className = 'menu-list-item-name';
    name.innerText = menu.name;
    name.addEventListener('click', () => selectMenu(menu.id));

    const actions = document.createElement('div');
    actions.className = 'menu-list-item-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-icon';
    editBtn.innerText = '✎';
    editBtn.title = 'Edit menu';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openMenuModal(menu.id); });

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-icon';
    delBtn.innerText = '🗑';
    delBtn.title = 'Delete menu';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); requestDeleteMenu(menu.id); });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    item.appendChild(name);
    item.appendChild(actions);
    item.addEventListener('click', () => selectMenu(menu.id));

    menuListEl.appendChild(item);
  });
}

function selectMenu(id) {
  if (!getMenu(id)) return;
  currentMenuId = id;
  loadStep(0);
  renderMenuList();
  menuListPanel.classList.remove('open'); // close the Menus panel after picking one
}

function toggleMenuListPanel() {
  menuListPanel.classList.toggle('open');
}

/* ================= Add / Edit Menu modal ================= */
function openMenuModal(menuId) {
  editingMenuId = menuId || null;
  stepsEditor.innerHTML = '';

  if (editingMenuId) {
    const menu = getMenu(editingMenuId);
    modalTitle.innerText = 'Edit Menu';
    inputMenuName.value = menu.name || '';
    inputMenuDesc.value = menu.description || '';
    inputMenuIngredients.value = menu.ingredients || '';
    menu.steps.forEach(step => addStepRow(step.instruction, step.duration));
  } else {
    modalTitle.innerText = 'Add Menu';
    inputMenuName.value = '';
    inputMenuDesc.value = '';
    inputMenuIngredients.value = '';
    addStepRow('', null);
  }

  menuModalOverlay.classList.add('open');
}

function closeMenuModal() {
  menuModalOverlay.classList.remove('open');
  editingMenuId = null;
}

function addStepRow(instruction, duration) {
  const row = document.createElement('div');
  row.className = 'step-row';

  const hasDur = typeof duration === 'number' && duration > 0;
  const mins = hasDur ? Math.floor(duration / 60) : '';
  const secs = hasDur ? duration % 60 : '';

  row.innerHTML = `
    <div class="step-row-header">
      <span class="step-row-label">Step</span>
      <button type="button" class="step-remove-btn">Remove ✕</button>
    </div>
    <textarea class="step-instruction-input" rows="2" placeholder="Cooking instruction for this step"></textarea>
    <div class="step-timer-row">
      <label><input type="checkbox" class="step-timer-toggle" ${hasDur ? 'checked' : ''}> Add timer</label>
      <div class="step-timer-inputs" style="${hasDur ? '' : 'display:none;'}">
        <input type="number" class="step-timer-min" min="0" max="180" placeholder="0" value="${mins}">
        <span>min</span>
        <input type="number" class="step-timer-sec" min="0" max="59" placeholder="0" value="${secs}">
        <span>sec</span>
      </div>
    </div>
  `;

  row.querySelector('.step-instruction-input').value = instruction || '';

  row.querySelector('.step-remove-btn').addEventListener('click', () => {
    if (stepsEditor.children.length > 1) {
      row.remove();
      renumberStepRows();
    }
  });

  const toggle = row.querySelector('.step-timer-toggle');
  const timerInputs = row.querySelector('.step-timer-inputs');
  toggle.addEventListener('change', () => {
    timerInputs.style.display = toggle.checked ? '' : 'none';
  });

  stepsEditor.appendChild(row);
  renumberStepRows();
}

function renumberStepRows() {
  Array.from(stepsEditor.children).forEach((row, i) => {
    row.querySelector('.step-row-label').innerText = `Step ${i + 1}`;
  });
}

btnAddStep.addEventListener('click', () => addStepRow('', null));

function collectStepsFromEditor() {
  const steps = [];
  Array.from(stepsEditor.children).forEach(row => {
    const instruction = row.querySelector('.step-instruction-input').value.trim();
    if (!instruction) return; // skip empty steps
    const toggle = row.querySelector('.step-timer-toggle');
    let duration = null;
    if (toggle.checked) {
      const min = parseInt(row.querySelector('.step-timer-min').value, 10) || 0;
      const sec = parseInt(row.querySelector('.step-timer-sec').value, 10) || 0;
      const total = min * 60 + sec;
      duration = total > 0 ? total : null;
    }
    steps.push({ instruction, duration });
  });
  return steps;
}

function saveMenuFromModal() {
  const name = inputMenuName.value.trim();
  if (!name) {
    inputMenuName.focus();
    return;
  }
  const steps = collectStepsFromEditor();
  if (steps.length === 0) {
    alert('Please add at least one cooking step.');
    return;
  }

  const menuData = {
    name,
    description: inputMenuDesc.value.trim(),
    ingredients: inputMenuIngredients.value.trim(),
    steps
  };

  if (editingMenuId) {
    const menu = getMenu(editingMenuId);
    Object.assign(menu, menuData);
    persistMenus();
    renderMenuList();
    if (currentMenuId === editingMenuId) {
      // Reload current step (paused, not auto-playing) since content may have changed
      loadStep(0);
    }
  } else {
    const newMenu = { id: uid(), ...menuData };
    menus.push(newMenu);
    persistMenus();
    currentMenuId = newMenu.id;
    loadStep(0); // new menu always starts paused, never auto-plays
    renderMenuList();
  }

  closeMenuModal();
}

/* ================= Delete menu (with confirmation) ================= */
function requestDeleteMenu(menuId) {
  const menu = getMenu(menuId);
  if (!menu) return;
  confirmMessage.innerText = `Are you sure you want to delete "${menu.name}"?`;
  confirmCallback = () => {
    const wasCurrent = currentMenuId === menuId;
    menus = menus.filter(m => m.id !== menuId);
    persistMenus();

    if (wasCurrent) {
      if (menus.length > 0) {
        currentMenuId = menus[0].id;
        loadStep(0);
      } else {
        currentMenuId = null;
        stopAlarm();
        stopTicking();
        videoWrapper.classList.remove('camera-alert');
        stepNumEl.innerText = 'No menu selected';
        stepContentEl.innerText = 'Add a menu to get started.';
        timerDisplayEl.innerText = '';
        timerDisplayEl.className = 'timer-box';
      }
    }
    renderMenuList();
    closeConfirmModal();
  };
  confirmModalOverlay.classList.add('open');
}

function closeConfirmModal() {
  confirmModalOverlay.classList.remove('open');
  confirmCallback = null;
}

btnConfirmOk.addEventListener('click', () => { if (confirmCallback) confirmCallback(); });
btnConfirmCancel.addEventListener('click', closeConfirmModal);
confirmModalOverlay.addEventListener('click', (e) => { if (e.target === confirmModalOverlay) closeConfirmModal(); });

/* ================= Modal wiring ================= */
btnAddMenu.addEventListener('click', () => openMenuModal(null));
btnShowMenus.addEventListener('click', toggleMenuListPanel);
btnEditCurrent.addEventListener('click', () => { if (currentMenuId) openMenuModal(currentMenuId); });
btnCloseModal.addEventListener('click', closeMenuModal);
btnCancelModal.addEventListener('click', closeMenuModal);
btnSaveMenu.addEventListener('click', saveMenuFromModal);
menuModalOverlay.addEventListener('click', (e) => { if (e.target === menuModalOverlay) closeMenuModal(); });

/* ================= Click controls on the air buttons ================= */
btnPrev.addEventListener('click', () => { prevAction(); triggerHapticFeedback('PREVIOUS'); });
btnNext.addEventListener('click', () => { nextAction(); triggerHapticFeedback('NEXT'); });
btnPause.addEventListener('click', () => {
  if (btnPause.classList.contains('disabled')) return;
  const wasFinished = isFinished;
  playPauseAction();
  triggerHapticFeedback(wasFinished ? 'REPLAY' : (isRunning ? 'RESUME TIMER' : 'PAUSE TIMER'));
});

function triggerHapticFeedback(actionName) {
  gestureStatusEl.innerText = "Air Button Activated: " + actionName;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 650;
    gain.gain.value = 0.15;
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  } catch (e) { /* audio unavailable */ }
}

/* ================= Init ================= */
function initApp() {
  const stored = MenuStore.load();
  menus = (stored && stored.length) ? stored : defaultMenus();
  if (!stored) persistMenus();

  currentMenuId = menus[0].id;
  renderMenuList();
  loadStep(0); // always starts paused, never auto-plays
}

initApp();

/* ================= MEDIAPIPE AIR BUTTON SENSORS ================= */
const videoElement = document.getElementById('webcam');
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

hands.onResults((results) => {
  const now = Date.now();

  btnPrev.classList.remove('active');
  btnPause.classList.remove('active');
  btnNext.classList.remove('active');

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];
    const indexX = landmarks[8].x;
    const indexY = landmarks[8].y;

    if (indexY > 0.25 && indexY < 0.75) {

      // PREV BUTTON
      if (indexX > 0.75) {
        btnPrev.classList.add('active');
        if (now - lastTriggerTime > 1000) {
          prevAction();
          triggerHapticFeedback("PREVIOUS");
          lastTriggerTime = now;
        }
      }

      // PLAY / PAUSE / REPLAY BUTTON
      else if (indexX > 0.38 && indexX < 0.62) {
        btnPause.classList.add('active');
        if (now - lastTriggerTime > 1200) {
          if (!btnPause.classList.contains('disabled')) {
            const wasFinished = isFinished;
            playPauseAction();
            triggerHapticFeedback(wasFinished ? 'REPLAY' : (isRunning ? "RESUME TIMER" : "PAUSE TIMER"));
          }
          lastTriggerTime = now;
        }
      }

      // NEXT BUTTON
      else if (indexX < 0.25) {
        btnNext.classList.add('active');
        if (now - lastTriggerTime > 1000) {
          nextAction();
          triggerHapticFeedback("NEXT");
          lastTriggerTime = now;
        }
      }
    }

    if (now - lastTriggerTime > 800) {
      gestureStatusEl.innerText = "Finger Tracked - Touch any Air Button";
    }
  } else {
    gestureStatusEl.innerText = "Point your index finger at the camera";
  }
});

const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 640,
  height: 480
});
camera.start();