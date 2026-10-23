import { DIFFICULTY_COPY, UI_DIFFICULTY } from './ui-copy.js';
import { formatSpeed, formatTime } from './utils.js';

const SCREEN_KEYS = ['menu', 'pause', 'result'];

export class GameUI {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.selectedDifficulty = 'pro';
    this.view = '3d';
    this.muted = false;
    this.announceTimer = 0;
    this.scorePopTimer = 0;
    this.goalFlashTimer = 0;
    this.controlHintTimer = 0;
    this.screen = 'menu';

    this.el = {
      menu: document.getElementById('menuScreen'),
      pause: document.getElementById('pauseScreen'),
      result: document.getElementById('resultScreen'),
      announce: document.getElementById('announce'),
      announceEyebrow: document.getElementById('announceEyebrow'),
      announceMain: document.getElementById('announceMain'),
      announceSub: document.getElementById('announceSub'),
      scoreYou: document.getElementById('scoreYou'),
      scoreAi: document.getElementById('scoreAi'),
      scoreboard: document.getElementById('scoreboard'),
      matchStatus: document.getElementById('matchStatus'),
      rally: document.getElementById('rallyReadout'),
      difficultyReadout: document.getElementById('difficultyReadout'),
      difficultyDesc: document.getElementById('difficultyDesc'),
      difficultyOptions: document.getElementById('difficultyOptions'),
      view: document.getElementById('viewReadout'),
      viewButtons: Array.from(document.querySelectorAll('[data-view]')),
      start: document.getElementById('startBtn'),
      resume: document.getElementById('resumeBtn'),
      restart: document.getElementById('restartBtn'),
      quit: document.getElementById('quitBtn'),
      rematch: document.getElementById('rematchBtn'),
      change: document.getElementById('changeBtn'),
      sound: document.getElementById('soundBtn'),
      pauseButton: document.getElementById('pauseBtn'),
      brand: document.getElementById('brandHome'),
      controlHint: document.getElementById('controlHint'),
      goalFlash: document.getElementById('goalFlash'),
      loading: document.getElementById('loadingScreen'),
      webglError: document.getElementById('webglError'),
      resultTitle: document.getElementById('resultTitle'),
      resultSub: document.getElementById('resultSub'),
      resultProtocol: document.getElementById('resultProtocol'),
      finalYou: document.getElementById('finalScoreYou'),
      finalAi: document.getElementById('finalScoreAi'),
      statTime: document.getElementById('statTime'),
      statSpeed: document.getElementById('statSpeed'),
      statRally: document.getElementById('statRally'),
      statHits: document.getElementById('statHits'),
    };

    this.bindEvents();
    this.selectDifficulty('pro', { silent: true });
    this.setScores(0, 0);
    this.el.loading.removeAttribute('aria-hidden');
  }

  bindEvents() {
    this.el.start?.addEventListener('click', () => {
      this.callbacks.onUiSound?.();
      this.callbacks.onStart?.(this.selectedDifficulty);
    });

    this.el.difficultyOptions?.addEventListener('click', (event) => {
      const card = event.target.closest('[data-difficulty]');
      if (!card) return;
      this.callbacks.onUiSound?.();
      this.selectDifficulty(card.dataset.difficulty);
    });

    this.el.viewButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const view = button.dataset.view;
        if (!view || view === this.view) return;
        this.callbacks.onUiSound?.();
        this.callbacks.onViewChange?.(view);
      });
    });

    this.el.sound?.addEventListener('click', () => {
      this.callbacks.onSoundToggle?.();
    });

    this.el.pauseButton?.addEventListener('click', () => {
      this.callbacks.onUiSound?.();
      this.callbacks.onPauseToggle?.();
    });

    this.el.resume?.addEventListener('click', () => {
      this.callbacks.onUiSound?.();
      this.callbacks.onResume?.();
    });

    this.el.restart?.addEventListener('click', () => {
      this.callbacks.onUiSound?.();
      this.callbacks.onRestart?.();
    });

    this.el.quit?.addEventListener('click', () => {
      this.callbacks.onUiSound?.();
      this.callbacks.onQuit?.();
    });

    this.el.rematch?.addEventListener('click', () => {
      this.callbacks.onUiSound?.();
      this.callbacks.onRematch?.();
    });

    this.el.change?.addEventListener('click', () => {
      this.callbacks.onUiSound?.();
      this.callbacks.onChangeProtocol?.();
    });

    this.el.brand?.addEventListener('click', (event) => {
      event.preventDefault();
      this.callbacks.onHome?.();
    });

    window.addEventListener('pointermove', (event) => {
      if (this.screen !== 'playing') return;
      if (event.pointerType === 'mouse' || event.pointerType === 'pen' || event.pointerType === 'touch') {
        this.dismissControlHint();
      }
    }, { passive: true });
  }

  setSoundMuted(muted) {
    this.muted = Boolean(muted);
    document.body.classList.toggle('is-muted', this.muted);
    if (this.el.sound) {
      this.el.sound.setAttribute('aria-pressed', String(this.muted));
      this.el.sound.setAttribute('aria-label', this.muted ? 'Ton einschalten' : 'Ton ausschalten');
    }
  }

  selectDifficulty(id, { silent = false } = {}) {
    const copy = DIFFICULTY_COPY[id];
    if (!copy) return;
    this.selectedDifficulty = id;
    document.querySelectorAll('[data-difficulty]').forEach((card) => {
      const selected = card.dataset.difficulty === id;
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-checked', String(selected));
    });
    if (this.el.difficultyDesc) this.el.difficultyDesc.textContent = copy.description;
    if (this.el.difficultyReadout) this.el.difficultyReadout.textContent = UI_DIFFICULTY[id];
    if (!silent) this.callbacks.onDifficultyChange?.(id);
  }

  updateRally(value) {
    if (!this.el.rally) return;
    this.el.rally.textContent = String(Math.max(0, value)).padStart(2, '0');
  }

  setMatchStatus(label) {
    if (this.el.matchStatus) this.el.matchStatus.textContent = label;
  }

  setScores(you, ai, scorer = null) {
    if (!this.el.scoreYou || !this.el.scoreAi) return;
    this.el.scoreYou.textContent = String(you);
    this.el.scoreAi.textContent = String(ai);
    if (this.el.scoreboard) {
      this.el.scoreboard.setAttribute('aria-label', `Punktestand: Du ${you}, NOVA ${ai}. Erster bis 7.`);
    }
    window.clearTimeout(this.scorePopTimer);
    this.el.scoreYou.classList.remove('score-pop');
    this.el.scoreAi.classList.remove('score-pop');
    if (scorer) {
      const target = scorer === 'you' ? this.el.scoreYou : this.el.scoreAi;
      void target.offsetWidth;
      target.classList.add('score-pop');
      this.scorePopTimer = window.setTimeout(() => target.classList.remove('score-pop'), 420);
    }
  }

  setView(view) {
    this.view = view;
    const is2D = view === '2d';
    this.el.viewButtons.forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (this.el.view) this.el.view.textContent = is2D ? 'TACTICAL TOP' : 'PERSPECTIVE';
  }

  showAnnouncement({ eyebrow = '', main = '', sub = '', tone = 'white', duration = 0 } = {}) {
    window.clearTimeout(this.announceTimer);
    this.el.announce.classList.remove('tone-white', 'tone-cyan', 'tone-magenta', 'tone-go');
    if (tone && tone !== 'white') this.el.announce.classList.add(`tone-${tone}`);
    this.el.announceEyebrow.textContent = eyebrow;
    this.el.announceMain.textContent = main;
    this.el.announceSub.textContent = sub;
    this.el.announce.classList.add('is-visible');
    this.el.announce.classList.remove('main-pop');
    void this.el.announce.offsetWidth;
    this.el.announce.classList.add('main-pop');
    if (duration > 0) {
      this.announceTimer = window.setTimeout(() => this.hideAnnouncement(), duration);
    }
  }

  hideAnnouncement() {
    window.clearTimeout(this.announceTimer);
    this.el.announce?.classList.remove('is-visible');
  }

  showCountdown({ label, sub, tone = 'white' }) {
    const isReady = label === 'READY';
    this.setMatchStatus('READY');
    this.showAnnouncement({
      eyebrow: isReady ? 'NEXT FACE-OFF' : 'OPENING FACE-OFF',
      main: label,
      sub,
      tone,
    });
  }

  showGo({ label = 'GO', sub = 'PLAY', tone = 'go' } = {}) {
    this.setMatchStatus('LIVE');
    this.showAnnouncement({
      eyebrow: 'MATCH LIVE',
      main: label,
      sub,
      tone,
      duration: 780,
    });
  }

  showGoal({ scorer, scores, winning = false }) {
    this.setMatchStatus('GOAL');
    const isYou = scorer === 'you';
    this.showAnnouncement({
      eyebrow: isYou ? 'TOR FÜR DICH' : 'NOVA TRIFFT',
      main: isYou ? 'GOAL' : 'NOVA',
      sub: `DU ${scores.you} : ${scores.ai} NOVA${winning ? '  ·  MATCH BEENDET' : ''}`,
      tone: isYou ? 'cyan' : 'magenta',
      duration: winning ? 2300 : 1650,
    });
    if (this.el.goalFlash) {
      window.clearTimeout(this.goalFlashTimer);
      this.el.goalFlash.classList.remove('flash--you', 'flash--ai');
      void this.el.goalFlash.offsetWidth;
      this.el.goalFlash.classList.add(isYou ? 'flash--you' : 'flash--ai');
      this.goalFlashTimer = window.setTimeout(() => {
        this.el.goalFlash.classList.remove('flash--you', 'flash--ai');
      }, 920);
    }
  }

  flashScreen(kind = 'you') {
    if (!this.el.goalFlash) return;
    window.clearTimeout(this.goalFlashTimer);
    this.el.goalFlash.classList.remove('flash--you', 'flash--ai');
    void this.el.goalFlash.offsetWidth;
    this.el.goalFlash.classList.add(kind === 'you' ? 'flash--you' : 'flash--ai');
    this.goalFlashTimer = window.setTimeout(() => {
      this.el.goalFlash.classList.remove('flash--you', 'flash--ai');
    }, 920);
  }

  openScreen(name) {
    const key = SCREEN_KEYS.includes(name) ? name : null;
    if (!key) return;
    const target = this.el[key];
    target.classList.add('is-open');
    target.setAttribute('aria-hidden', 'false');
  }

  closeScreen(name) {
    const key = SCREEN_KEYS.includes(name) ? name : null;
    if (!key) return;
    const target = this.el[key];
    target.classList.remove('is-open');
    target.setAttribute('aria-hidden', 'true');
  }

  closeAllScreens() {
    SCREEN_KEYS.forEach((name) => this.closeScreen(name));
  }

  setBodyScreen(name) {
    this.screen = name;
    document.body.dataset.screen = name;
  }

  blurFocus() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  showMenu({ focus = false } = {}) {
    this.closeAllScreens();
    this.openScreen('menu');
    this.setBodyScreen('menu');
    this.hideAnnouncement();
    this.setMatchStatus('READY');
    this.dismissControlHint(true);
    this.setScores(0, 0);
    this.updateRally(0);
    window.clearTimeout(this.controlHintTimer);
    if (focus) window.setTimeout(() => this.el.start?.focus({ preventScroll: true }), 80);
  }

  startMatchUI(difficulty) {
    this.selectDifficulty(difficulty, { silent: true });
    this.closeAllScreens();
    this.setBodyScreen('playing');
    this.hideAnnouncement();
    this.setMatchStatus('READY');
    this.setScores(0, 0);
    this.updateRally(0);
    this.setView(this.view);
    this.dismissControlHint(true);
    this.el.controlHint?.classList.remove('is-dim');
    window.clearTimeout(this.controlHintTimer);
    this.controlHintTimer = window.setTimeout(() => this.dismissControlHint(), 9000);
    this.blurFocus();
  }

  dismissControlHint(instant = false) {
    if (!this.el.controlHint) return;
    if (instant) {
      this.el.controlHint.classList.remove('is-dim');
      return;
    }
    this.el.controlHint.classList.add('is-dim');
  }

  showPause(phase) {
    this.closeAllScreens();
    this.openScreen('pause');
    this.setBodyScreen('paused');
    this.setMatchStatus('PAUSED');
    this.hideAnnouncement();
    if (phase === 'countdown') this.setMatchStatus('PAUSED');
    window.setTimeout(() => this.el.resume?.focus({ preventScroll: true }), 60);
  }

  hidePause(phase = 'playing') {
    this.closeScreen('pause');
    this.setBodyScreen('playing');
    if (phase === 'countdown') this.setMatchStatus('READY');
    else if (phase === 'goal') this.setMatchStatus('GOAL');
    else this.setMatchStatus('LIVE');
  }

  showResult(data) {
    const won = data.winner === 'you';
    this.closeAllScreens();
    this.openScreen('result');
    this.setBodyScreen('result');
    this.hideAnnouncement();
    this.setMatchStatus('FINAL');
    this.setScores(data.scores.you, data.scores.ai);
    this.el.resultScreen?.classList.toggle('is-win', won);
    this.el.result?.querySelector('.dialog')?.classList.toggle('is-loss', !won);

    this.el.resultTitle.classList.toggle('is-loss', !won);
    this.el.resultTitle.innerHTML = `${won ? 'VICTORY' : 'DEFEAT'}<span class="accent-dot">.</span>`;
    this.el.resultSub.textContent = won
      ? 'Die Maschine ist besiegt. Die Arena gehört dir.'
      : 'NOVA hat das Rink gelesen. Ein neuer Winkel, ein neuer Versuch.';
    this.el.resultProtocol.textContent = data.difficulty?.loudLabel?.replace('PROTOKOLL //', 'PROTOCOL') || 'PROTOCOL PRO';
    this.el.finalYou.textContent = String(data.scores.you);
    this.el.finalAi.textContent = String(data.scores.ai);
    this.el.statTime.textContent = formatTime(data.matchTime);
    this.el.statSpeed.innerHTML = `${formatSpeed(data.stats?.topSpeed || 0)} <small>KM/H</small>`;
    this.el.statRally.innerHTML = `${data.stats?.maxRally || 0} <small>HITS</small>`;
    this.el.statHits.textContent = String(data.stats?.hits || 0);
    this.el.resultScreen?.scrollTo?.({ top: 0 });
    window.setTimeout(() => this.el.rematch?.focus({ preventScroll: true }), 160);
  }

  setLoadingHidden() {
    window.setTimeout(() => {
      this.el.loading?.classList.add('is-hidden');
      this.el.loading?.setAttribute('aria-hidden', 'true');
      this.el.loading?.classList.remove('is-visible');
    }, 260);
    window.setTimeout(() => {
      if (!this.el.loading) return;
      this.el.loading.style.display = 'none';
      this.el.loading.remove();
      this.el.loading = null;
    }, 1500);
  }

  showWebGLError() {
    if (this.el.webglError) this.el.webglError.hidden = false;
    this.el.loading?.classList.add('is-hidden');
    this.hideAnnouncement();
  }
}
