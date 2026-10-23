import { AIController } from './ai.js';
import { DIFFICULTIES, LIMITS, RINK, SCORE_TO_WIN } from './constants.js';
import {
  clamp,
  clampLength,
  formatSpeed,
  predictWallX,
  randomRange,
  randomSign,
} from './utils.js';

const FIXED_STEP = 1 / 240;
const WALL_SOUND_THRESHOLD = 2.2;
const HIT_EVENT_THRESHOLD = 1.15;

export class AirHockeyGame {
  constructor({ onEvent } = {}) {
    this.onEvent = onEvent || (() => {});
    this.phase = 'menu';
    this.paused = false;
    this.difficulty = DIFFICULTIES.pro;

    this.scores = { you: 0, ai: 0 };
    this.stats = this.createStats();
    this.matchTime = 0;
    this.goalTimer = 0;
    this.pendingWinner = null;
    this.lastGoal = null;

    this.puck = { x: 0, z: 0, vx: 0, vz: 0, spin: 0, spinVelocity: 0 };
    this.player = {
      x: 0,
      z: RINK.halfL - 2.1,
      vx: 0,
      vz: 0,
      targetX: 0,
      targetZ: RINK.halfL - 2.1,
    };
    this.ai = new AIController();

    this.accumulator = 0;
    this.elapsed = 0;
    this.keyboardVector = { x: 0, z: 0 };
    this.contactCooldown = { player: 0, ai: 0 };
    this.wallCooldown = 0;
    this.countdownTotal = 0;
    this.countdownRemaining = 0;
    this.countdownLabel = '';
    this.initialCountdown = true;
    this.trailClock = 0;

    this.resetPositions();
  }

  createStats() {
    return {
      matchTime: 0,
      topSpeed: 0,
      hits: 0,
      rally: 0,
      maxRally: 0,
      goals: 0,
      shots: 0,
    };
  }

  emit(type, payload = {}) {
    this.onEvent(type, payload);
  }

  get playerLimitX() {
    return RINK.halfW - RINK.malletR - 0.03;
  }

  get playerLimitZMin() {
    return RINK.malletR + 0.03;
  }

  get playerLimitZMax() {
    return RINK.halfL - RINK.malletR - 0.03;
  }

  clampPlayerTarget(x, z) {
    return {
      x: clamp(x, -this.playerLimitX, this.playerLimitX),
      z: clamp(z, this.playerLimitZMin, this.playerLimitZMax),
    };
  }

  setDifficulty(id) {
    if (this.phase !== 'menu' && this.phase !== 'over') return;
    const next = DIFFICULTIES[id];
    if (!next) return;
    this.difficulty = next;
    this.emit('difficulty', { difficulty: next });
  }

  setPointerTarget(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const target = this.clampPlayerTarget(x, z);
    this.player.targetX = target.x;
    this.player.targetZ = target.z;
  }

  setKeyboardVector(x, z) {
    this.keyboardVector.x = clamp(x, -1, 1);
    this.keyboardVector.z = clamp(z, -1, 1);
  }

  resetPositions() {
    this.puck.x = 0;
    this.puck.z = 0;
    this.puck.vx = 0;
    this.puck.vz = 0;
    this.puck.spin = 0;
    this.puck.spinVelocity = 0;

    this.player.x = 0;
    this.player.z = RINK.halfL - 2.1;
    this.player.vx = 0;
    this.player.vz = 0;
    const targets = this.clampPlayerTarget(this.player.x, this.player.z);
    this.player.targetX = targets.x;
    this.player.targetZ = targets.z;

    this.ai.reset(0, -RINK.halfL + 2.6);
    this.contactCooldown.player = 0;
    this.contactCooldown.ai = 0;
    this.wallCooldown = 0;
  }

  resetForMenu() {
    this.phase = 'menu';
    this.paused = false;
    this.scores = { you: 0, ai: 0 };
    this.stats = this.createStats();
    this.matchTime = 0;
    this.accumulator = 0;
    this.resetPositions();
    this.emit('menu');
  }

  startMatch(difficultyId = this.difficulty.id) {
    const next = DIFFICULTIES[difficultyId];
    if (next) this.difficulty = next;
    this.phase = 'countdown';
    this.paused = false;
    this.scores = { you: 0, ai: 0 };
    this.stats = this.createStats();
    this.matchTime = 0;
    this.pendingWinner = null;
    this.lastGoal = null;
    this.accumulator = 0;
    this.emit('matchStart', {
      difficulty: this.difficulty,
      scores: { ...this.scores },
      scoreToWin: SCORE_TO_WIN,
    });
    this.beginFaceoff(true);
  }

  beginFaceoff(initial = false) {
    this.resetPositions();
    this.phase = 'countdown';
    this.initialCountdown = initial;
    this.countdownTotal = initial ? 2.7 : 1.35;
    this.countdownRemaining = this.countdownTotal;
    this.countdownLabel = '';
    this.goalTimer = 0;
    this.keyboardVector.x = 0;
    this.keyboardVector.z = 0;
    this.emit('faceoff', { initial, countdown: this.countdownTotal });
    if (initial) {
      this.setCountdownLabel('3', 'ERSTER BIS 7', 'cyan');
    } else {
      this.setCountdownLabel('READY', 'NÄCHSTER FACE-OFF', 'cyan');
    }
  }

  setCountdownLabel(label, sub = '', tone = 'white') {
    if (this.countdownLabel === label) return;
    this.countdownLabel = label;
    this.emit('countdown', { label, sub, tone, phase: 'countdown' });
  }

  updateCountdown(dt) {
    this.updatePlayer(dt);
    this.ai.hold(dt, 0, -RINK.halfL + 2.6);
    this.countdownRemaining -= dt;

    if (this.countdownRemaining <= 0) {
      this.launchPuck();
      this.phase = 'playing';
      this.emit('go', {
        label: 'GO',
        sub: this.initialCountdown ? 'ERSTER BIS 7' : 'SPIEL LÄUFT',
        tone: 'go',
      });
      return;
    }

    if (this.initialCountdown) {
      const remaining = this.countdownRemaining;
      let label = '1';
      if (remaining > this.countdownTotal * 0.66) label = '3';
      else if (remaining > this.countdownTotal * 0.33) label = '2';
      if (label !== this.countdownLabel) {
        this.setCountdownLabel(label, 'ERSTER BIS 7', 'white');
      }
    }
  }

  launchPuck() {
    const side = randomSign();
    this.puck.vx = randomRange(-1.35, 1.35);
    this.puck.vz = side * randomRange(3.2, 4.9);
    this.puck.spinVelocity = randomRange(-3, 3);
    this.contactCooldown.player = 0.12;
    this.contactCooldown.ai = 0.12;
    this.emit('serve', {
      x: this.puck.x,
      z: this.puck.z,
      vx: this.puck.vx,
      vz: this.puck.vz,
    });
  }

  updatePlayer(dt) {
    const speed = LIMITS.playerSpeed;
    if (Math.abs(this.keyboardVector.x) > 0.01 || Math.abs(this.keyboardVector.z) > 0.01) {
      const keySpeed = 20.5;
      this.player.targetX += this.keyboardVector.x * keySpeed * dt;
      this.player.targetZ += this.keyboardVector.z * keySpeed * dt;
      const target = this.clampPlayerTarget(this.player.targetX, this.player.targetZ);
      this.player.targetX = target.x;
      this.player.targetZ = target.z;
    }

    const dx = this.player.targetX - this.player.x;
    const dz = this.player.targetZ - this.player.z;
    const dist = Math.hypot(dx, dz);
    const prevX = this.player.x;
    const prevZ = this.player.z;
    if (dist > 1e-5) {
      const step = Math.min(dist, speed * dt);
      this.player.x += (dx / dist) * step;
      this.player.z += (dz / dist) * step;
    }
    const safeDt = Math.max(dt, 1e-5);
    this.player.vx = (this.player.x - prevX) / safeDt;
    this.player.vz = (this.player.z - prevZ) / safeDt;
  }

  updatePuck(dt) {
    const p = this.puck;
    const damping = Math.exp(-LIMITS.puckFriction * dt);
    p.vx *= damping;
    p.vz *= damping;

    const velocity = clampLength(p.vx, p.vz, LIMITS.puckSpeed);
    p.vx = velocity.x;
    p.vz = velocity.z;

    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.spin += p.spinVelocity * dt;
    p.spinVelocity *= Math.exp(-1.4 * dt);

    this.contactCooldown.player = Math.max(0, this.contactCooldown.player - dt);
    this.contactCooldown.ai = Math.max(0, this.contactCooldown.ai - dt);
    this.wallCooldown = Math.max(0, this.wallCooldown - dt);

    this.resolveMalletCollision(this.player, 'player', dt);
    this.resolveMalletCollision(this.ai, 'ai', dt);
    this.resolveGoalPosts();
    this.resolveBoundaries();

    const speed = Math.hypot(p.vx, p.vz);
    if (speed > this.stats.topSpeed) this.stats.topSpeed = speed;
  }

  resolveMalletCollision(mallet, who, dt) {
    const p = this.puck;
    const minDistance = RINK.malletR + RINK.puckR;
    let dx = p.x - mallet.x;
    let dz = p.z - mallet.z;
    let distSq = dx * dx + dz * dz;
    if (distSq >= minDistance * minDistance) return;

    let dist = Math.sqrt(distSq);
    if (dist < 1e-5) {
      dx = 0;
      dz = who === 'player' ? -1 : 1;
      dist = 1;
      distSq = 1;
    }
    const nx = dx / dist;
    const nz = dz / dist;

    // Push the puck completely out of the mallet.
    p.x = mallet.x + nx * (minDistance + 0.003);
    p.z = mallet.z + nz * (minDistance + 0.003);

    const relativeNormal =
      (p.vx - mallet.vx) * nx + (p.vz - mallet.vz) * nz;

    if (relativeNormal < 0) {
      const restitution = LIMITS.puckMalletRestitution;
      p.vx -= (1 + restitution) * relativeNormal * nx;
      p.vz -= (1 + restitution) * relativeNormal * nz;

      // A tiny forward nudge keeps slow pushes alive and makes contact crisp.
      const impulse = -relativeNormal;
      if (impulse > HIT_EVENT_THRESHOLD && this.contactCooldown[who] <= 0) {
        this.contactCooldown[who] = 0.075;
        this.stats.hits += 1;
        this.stats.shots += 1;
        this.stats.rally += 1;
        this.stats.maxRally = Math.max(this.stats.maxRally, this.stats.rally);
        const intensity = clamp(impulse / 19 + Math.hypot(mallet.vx, mallet.vz) / 45, 0.16, 1.4);
        this.emit('hit', {
          who,
          x: p.x,
          z: p.z,
          intensity,
          speed: Math.hypot(p.vx, p.vz),
          pan: clamp(p.x / RINK.halfW, -1, 1),
        });
      }
    }

    const capped = clampLength(p.vx, p.vz, LIMITS.puckSpeed);
    p.vx = capped.x;
    p.vz = capped.z;
  }

  resolveGoalPosts() {
    const p = this.puck;
    const postRadius = 0.075;
    const minDistance = postRadius + RINK.puckR;
    for (const end of [-1, 1]) {
      for (const side of [-1, 1]) {
        const postX = side * RINK.goalHalf;
        const postZ = end * RINK.halfL;
        let dx = p.x - postX;
        let dz = p.z - postZ;
        const distSq = dx * dx + dz * dz;
        if (distSq >= minDistance * minDistance) continue;
        let dist = Math.sqrt(distSq);
        if (dist < 1e-5) {
          dx = p.x >= postX ? 1 : -1;
          dz = end;
          dist = 1;
        }
        const nx = dx / dist;
        const nz = dz / dist;
        const relativeNormal = p.vx * nx + p.vz * nz;
        p.x = postX + nx * (minDistance + 0.002);
        p.z = postZ + nz * (minDistance + 0.002);
        if (relativeNormal < 0) {
          const restitution = 0.82;
          p.vx -= (1 + restitution) * relativeNormal * nx;
          p.vz -= (1 + restitution) * relativeNormal * nz;
          if (-relativeNormal > 2.2 && this.wallCooldown <= 0) {
            this.wallCooldown = 0.07;
            this.emit('wall', {
              x: p.x,
              z: p.z,
              intensity: clamp(-relativeNormal / 17, 0.2, 1),
              pan: clamp(p.x / RINK.halfW, -1, 1),
            });
          }
        }
      }
    }
  }

  resolveBoundaries() {
    const p = this.puck;
    const wallX = RINK.halfW - RINK.puckR;
    const wallZ = RINK.halfL - RINK.puckR;

    if (p.x > wallX) {
      p.x = wallX;
      if (p.vx > 0) this.bounceX();
    } else if (p.x < -wallX) {
      p.x = -wallX;
      if (p.vx < 0) this.bounceX();
    }

    const passable = Math.abs(p.x) < RINK.goalHalf - RINK.puckR * 0.08;

    if (p.z > wallZ) {
      if (passable) {
        if (p.z > RINK.halfL + 0.02) {
          this.scoreGoal('ai');
          return;
        }
      } else {
        p.z = wallZ;
        if (p.vz > 0) this.bounceZ();
      }
    } else if (p.z < -wallZ) {
      if (passable) {
        if (p.z < -RINK.halfL - 0.02) {
          this.scoreGoal('you');
          return;
        }
      } else {
        p.z = -wallZ;
        if (p.vz < 0) this.bounceZ();
      }
    }

    // Keep the puck from escaping the table through a corner where two
    // collision responses can race each other.
    p.x = clamp(p.x, -wallX - 0.01, wallX + 0.01);
    if (!passable) p.z = clamp(p.z, -wallZ - 0.01, wallZ + 0.01);
  }

  bounceX() {
    const p = this.puck;
    const impact = Math.abs(p.vx);
    if (impact > WALL_SOUND_THRESHOLD && this.wallCooldown <= 0) {
      this.wallCooldown = 0.06;
      this.emit('wall', {
        x: p.x,
        z: p.z,
        intensity: clamp(impact / 19, 0.14, 1),
        pan: clamp(p.x / RINK.halfW, -1, 1),
      });
    }
    p.vx *= -LIMITS.puckWallRestitution;
    p.spinVelocity += p.vz * 0.18;
  }

  bounceZ() {
    const p = this.puck;
    const impact = Math.abs(p.vz);
    if (impact > WALL_SOUND_THRESHOLD && this.wallCooldown <= 0) {
      this.wallCooldown = 0.06;
      this.emit('wall', {
        x: p.x,
        z: p.z,
        intensity: clamp(impact / 19, 0.14, 1),
        pan: clamp(p.x / RINK.halfW, -1, 1),
      });
    }
    p.vz *= -LIMITS.puckWallRestitution;
    p.spinVelocity -= p.vx * 0.18;
  }

  scoreGoal(scorer) {
    if (this.phase !== 'playing') return;
    this.scores[scorer] += 1;
    this.stats.goals += 1;
    this.stats.maxRally = Math.max(this.stats.maxRally, this.stats.rally);
    this.phase = 'goal';
    this.goalTimer = this.scores.you >= SCORE_TO_WIN || this.scores.ai >= SCORE_TO_WIN ? 2.55 : 1.95;
    this.pendingWinner =
      this.scores.you >= SCORE_TO_WIN ? 'you' : this.scores.ai >= SCORE_TO_WIN ? 'ai' : null;
    this.puck.vx *= 0.2;
    this.puck.vz *= 0.2;
    const goalX = clamp(this.puck.x, -RINK.goalHalf + 0.2, RINK.goalHalf - 0.2);
    const goalZ = scorer === 'you' ? -RINK.halfL + 0.15 : RINK.halfL - 0.15;
    this.lastGoal = {
      scorer,
      x: goalX,
      z: goalZ,
      speed: this.stats.topSpeed,
      scores: { ...this.scores },
      winning: Boolean(this.pendingWinner),
    };
    this.emit('goal', { ...this.lastGoal, matchTime: this.matchTime });
    this.emit('score', { ...this.scores, scorer });
    this.stats.rally = 0;
  }

  finishMatch() {
    const winner = this.scores.you > this.scores.ai ? 'you' : 'ai';
    this.phase = 'over';
    this.paused = false;
    this.goalTimer = 0;
    this.emit('matchEnd', {
      winner,
      scores: { ...this.scores },
      difficulty: this.difficulty,
      matchTime: this.matchTime,
      stats: {
        ...this.stats,
        topSpeedKmh: formatSpeed(this.stats.topSpeed),
      },
    });
  }

  updateGoalPhase(dt) {
    this.goalTimer -= dt;
    if (this.goalTimer > 0) return;
    if (this.pendingWinner) {
      this.finishMatch();
    } else {
      this.beginFaceoff(false);
    }
  }

  simulate(dt) {
    this.elapsed += dt;
    if (this.paused) return;

    if (this.phase === 'countdown') {
      this.updateCountdown(dt);
      return;
    }

    if (this.phase === 'playing') {
      this.matchTime += dt;
      this.stats.matchTime = this.matchTime;
      this.updatePlayer(dt);
      this.ai.update(dt, this.puck, this.player, this.difficulty);
      this.updatePuck(dt);
      return;
    }

    if (this.phase === 'goal') {
      this.updateGoalPhase(dt);
    }
  }

  update(dt) {
    if (this.paused) {
      this.accumulator = 0;
      return;
    }
    this.accumulator += Math.min(dt, 0.06);
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < 20) {
      this.simulate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
      steps += 1;
      if (this.paused) break;
    }
    if (steps >= 20) this.accumulator = 0;
  }

  pause() {
    if (this.paused) return false;
    if (!['countdown', 'playing', 'goal'].includes(this.phase)) return false;
    this.paused = true;
    this.accumulator = 0;
    this.emit('pause', { phase: this.phase });
    return true;
  }

  resume() {
    if (!this.paused) return false;
    this.paused = false;
    this.accumulator = 0;
    this.emit('resume', { phase: this.phase });
    return true;
  }

  restart() {
    this.startMatch(this.difficulty.id);
  }

  get isActive() {
    return ['countdown', 'playing', 'goal'].includes(this.phase);
  }

  get puckSpeed() {
    return Math.hypot(this.puck.vx, this.puck.vz);
  }

  /**
   * Used by the visuals to draw a subtle telegraph line / trail.
   */
  getPuckFuture(step = 0.18) {
    const wallX = RINK.halfW - RINK.puckR;
    const x = predictWallX(this.puck.x, this.puck.vx, step, wallX);
    return { x, z: this.puck.z + this.puck.vz * step };
  }
}
