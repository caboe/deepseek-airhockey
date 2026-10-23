import { Arena } from './arena.js';
import { ArenaAudio } from './audio.js';
import { AirHockeyGame } from './game.js';
import { GameUI } from './ui.js';

const canvas = document.getElementById('scene');
const viewFlash = document.getElementById('viewFlash');

let arena = null;
let game = null;
let audio = null;
let ui = null;
let viewLock = false;
let animationId = 0;
let lastFrame = performance.now();
let lastRally = -1;
const pressedKeys = new Set();

function emitUiSound() {
  audio?.ui();
}

function beginMatch(difficultyId) {
  if (!game || !arena) return;
  if (game.isActive && !game.paused) return;
  audio?.unlock();
  game.resume();
  ui.startMatchUI(difficultyId);
  game.setDifficulty(difficultyId);
  game.startMatch(difficultyId);
  audio?.startAmbient();
  audio?.setAmbientLevel(0.2);
  lastRally = -1;
}

function togglePause() {
  if (!game) return;
  if (game.paused) {
    game.resume();
  } else {
    game.pause();
  }
}

function goHome() {
  if (!game) return;
  if (game.phase === 'menu') return;
  pressedKeys.clear();
  game.resetForMenu();
  audio?.setAmbientLevel(0.045);
}

function setView(nextView) {
  if (!arena || !ui) return;
  if (viewLock) return;
  if (arena.view === nextView) {
    ui.setView(nextView);
    return;
  }
  viewLock = true;
  viewFlash?.classList.add('is-active');
  window.setTimeout(() => {
    arena?.setView(nextView);
    ui?.setView(nextView);
  }, 120);
  window.setTimeout(() => {
    viewFlash?.classList.remove('is-active');
    viewLock = false;
  }, 320);
}

function toggleSound() {
  if (!audio || !ui) return;
  audio.unlock();
  const muted = audio.toggleMuted();
  ui.setSoundMuted(muted);
  if (!muted) audio.ui();
}

function setDifficulty(id) {
  if (!game) return;
  game.setDifficulty(id);
}

function updateKeyboardVector() {
  if (!game) return;
  let x = 0;
  let z = 0;
  if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) x -= 1;
  if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) x += 1;
  if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) z -= 1;
  if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) z += 1;
  const length = Math.hypot(x, z);
  if (length > 1) {
    x /= length;
    z /= length;
  }
  game.setKeyboardVector(x, z);
}

function handleGameEvent(type, data) {
  if (!arena) return;

  switch (type) {
    case 'matchStart':
      arena.handleGameEvent(type, data);
      lastRally = 0;
      ui.updateRally(0);
      break;
    case 'faceoff':
      arena.handleGameEvent(type, data);
      ui.updateRally(0);
      ui.setMatchStatus('READY');
      lastRally = 0;
      break;
    case 'countdown':
      ui.showCountdown(data);
      audio?.countdown(false);
      break;
    case 'go':
      ui.showGo(data);
      audio?.countdown(true);
      break;
    case 'serve':
      arena.handleGameEvent('serve', data);
      break;
    case 'hit':
      arena.handleGameEvent('hit', data);
      audio?.hit(data.intensity, data.pan, data.who);
      if (game.stats.rally !== lastRally) {
        lastRally = game.stats.rally;
        ui.updateRally(lastRally);
      }
      break;
    case 'wall':
      arena.handleGameEvent('wall', data);
      audio?.wall(data.intensity, data.pan);
      break;
    case 'goal':
      ui.setScores(data.scores.you, data.scores.ai, data.scorer);
      ui.showGoal(data);
      ui.updateRally(0);
      lastRally = 0;
      arena.handleGameEvent('goal', data);
      audio?.goal(data.scorer);
      audio?.setAmbientLevel(0.12);
      break;
    case 'matchEnd':
      arena.handleGameEvent('matchEnd', data);
      audio?.setAmbientLevel(0.04);
      if (data.winner === 'you') audio?.victory();
      else audio?.defeat();
      ui.showResult(data);
      break;
    case 'pause':
      ui.showPause(data.phase);
      audio?.setAmbientLevel(0.05);
      pressedKeys.clear();
      game.setKeyboardVector(0, 0);
      break;
    case 'resume':
      ui.hidePause(data.phase);
      if (data.phase === 'countdown' && game.countdownLabel) {
        ui.showCountdown({
          label: game.countdownLabel,
          sub: game.initialCountdown ? 'ERSTER BIS 7' : 'NÄCHSTER FACE-OFF',
          tone: game.countdownLabel === 'READY' ? 'cyan' : 'white',
        });
      }
      audio?.setAmbientLevel(0.2);
      break;
    case 'menu':
      ui.showMenu({ focus: true });
      pressedKeys.clear();
      lastRally = 0;
      break;
    default:
      break;
  }
}

function onPointerMove(event) {
  if (!game || !arena) return;
  if (document.body.dataset.screen !== 'playing') return;
  if (game.paused) return;
  if (game.phase !== 'playing' && game.phase !== 'countdown') return;
  const point = arena.screenToTable(event.clientX, event.clientY);
  if (point) game.setPointerTarget(point.x, point.z);
}

function bindInput() {
  canvas.addEventListener('pointermove', onPointerMove, { passive: true });

  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (!game) return;
      if (event.pointerType === 'touch' && canvas.setPointerCapture) {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          /* pointer capture is optional */
        }
      }
      onPointerMove(event);
    },
    { passive: true },
  );

  canvas.addEventListener(
    'contextmenu',
    (event) => event.preventDefault(),
    false,
  );

  window.addEventListener('pointerdown', () => audio?.unlock(), { capture: true });
  window.addEventListener('keydown', () => audio?.unlock(), { capture: true });

  window.addEventListener('keydown', (event) => {
    const activeElement = document.activeElement;
    const inButton = activeElement && activeElement.closest?.('button, a, input, textarea, select');

    if (event.code === 'Escape') {
      if (!game) return;
      if (game.phase === 'menu') return;
      if (game.phase === 'over') {
        goHome();
        return;
      }
      togglePause();
      event.preventDefault();
      return;
    }

    if (event.code === 'KeyV') {
      event.preventDefault();
      setView(arena?.view === '3d' ? '2d' : '3d');
      return;
    }

    if (event.code === 'KeyM') {
      event.preventDefault();
      toggleSound();
      return;
    }

    if (event.code === 'KeyP') {
      if (game?.phase === 'menu' || game?.phase === 'over') return;
      event.preventDefault();
      togglePause();
      return;
    }

    if (event.code === 'Enter' && game?.phase === 'menu' && !inButton) {
      event.preventDefault();
      beginMatch(ui?.selectedDifficulty || 'pro');
      return;
    }

    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code) &&
      document.body.dataset.screen === 'playing'
    ) {
      event.preventDefault();
    }

    if (
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)
    ) {
      pressedKeys.add(event.code);
      updateKeyboardVector();
    }
  });

  window.addEventListener('keyup', (event) => {
    pressedKeys.delete(event.code);
    updateKeyboardVector();
  });

  window.addEventListener('blur', () => {
    pressedKeys.clear();
    updateKeyboardVector();
  });

  document.addEventListener('visibilitychange', () => {
    if (!game) return;
    if (document.hidden) {
      pressedKeys.clear();
      game.setKeyboardVector(0, 0);
      if (game.isActive && !game.paused) game.pause();
      audio?.suspendToBackground();
    } else {
      audio?.resumeFromBackground();
    }
  });
}

function animate(now) {
  animationId = requestAnimationFrame(animate);
  const dt = Math.min(0.06, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;

  if (document.hidden) return;

  game.update(dt);
  arena.update(dt, game);
  arena.render(dt);
}

async function initialize() {
  audio = new ArenaAudio();

  const uiCallbacks = {
    onUiSound: emitUiSound,
    onStart: (difficulty) => beginMatch(difficulty),
    onDifficultyChange: setDifficulty,
    onViewChange: setView,
    onSoundToggle: toggleSound,
    onPauseToggle: togglePause,
    onResume: () => game?.resume(),
    onRestart: () => beginMatch(game?.difficulty.id || 'pro'),
    onQuit: goHome,
    onHome: goHome,
    onRematch: () => beginMatch(game?.difficulty.id || 'pro'),
    onChangeProtocol: goHome,
  };

  ui = new GameUI(uiCallbacks);
  ui.setSoundMuted(audio.muted);

  try {
    if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
    arena = new Arena(canvas);
  } catch (error) {
    console.error('NEON PUCK: WebGL initialization failed', error);
    ui.showWebGLError();
    return;
  }

  game = new AirHockeyGame({ onEvent: handleGameEvent });
  game.setDifficulty(ui.selectedDifficulty || 'pro');
  ui.setView(arena.view);
  ui.showMenu();
  bindInput();

  ui.setLoadingHidden();
  lastFrame = performance.now();
  animationId = requestAnimationFrame(animate);

  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(animationId);
    arena?.dispose();
  });

  // A small debug handle is handy for automated smoke tests and for tweaking
  // the arena without exposing any UI.
  window.__NEON_PUCK__ = { game, arena, audio, ui, beginMatch, setView, togglePause };
}

initialize();

