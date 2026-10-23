import { RINK } from './constants.js';
import { clamp, distance2, predictWallX, randomRange, timeToZ } from './utils.js';

/**
 * NOVA — a deliberately readable air-hockey opponent.
 *
 * The AI chooses a target position at a difficulty-dependent reaction rate,
 * then steers toward it with capped speed and acceleration. Difficulties
 * differ in reaction, movement, aim accuracy and tactical ambition.
 */
export class AIController {
  constructor() {
    this.x = 0;
    this.z = -3.2;
    this.vx = 0;
    this.vz = 0;
    this.targetX = 0;
    this.targetZ = -3.2;
    this.reactionTimer = 0;
    this.errorX = 0;
    this.errorZ = 0;
    this.aimX = 0;
    this.mode = 'guard';
    this.aggressionPhase = Math.random() * Math.PI * 2;
  }

  reset(x = 0, z = -4.8) {
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.targetX = x;
    this.targetZ = z;
    this.reactionTimer = 0;
    this.mode = 'guard';
  }

  clampToSide() {
    const limitX = RINK.halfW - RINK.malletR - 0.03;
    const minZ = -RINK.halfL + RINK.malletR + 0.03;
    const maxZ = -RINK.malletR - 0.03;
    this.x = clamp(this.x, -limitX, limitX);
    this.z = clamp(this.z, minZ, maxZ);
    this.targetX = clamp(this.targetX, -limitX, limitX);
    this.targetZ = clamp(this.targetZ, minZ, maxZ);
  }

  chooseAim(player, difficulty) {
    // Aim away from the player's current position, with a little personality.
    const side = player.x > 0.25 ? -1 : player.x < -0.25 ? 1 : Math.random() < 0.5 ? -1 : 1;
    const corner = RINK.goalHalf - 0.42;
    const aim = side * corner * randomRange(0.52, 1);
    return clamp(aim + randomRange(-difficulty.aimError, difficulty.aimError), -corner, corner);
  }

  chooseTarget(puck, player, difficulty) {
    const rSum = RINK.malletR + RINK.puckR;
    const puckSpeed = Math.hypot(puck.vx, puck.vz);
    const targetTime = difficulty.prediction * (0.7 + puckSpeed * 0.035);
    const futurePuck = {
      x: predictWallX(puck.x, puck.vx, targetTime, RINK.halfW - RINK.puckR),
      z: puck.z + puck.vz * targetTime,
    };
    const ownGoalLine = -RINK.halfL + 1.0;
    const goalTime = timeToZ(puck.z, puck.vz, ownGoalLine);
    const predictedSaveX = predictWallX(puck.x, puck.vx, Math.min(goalTime, 3), RINK.halfW - RINK.puckR);
    const incomingThreat =
      puck.vz < -0.5 &&
      goalTime < 1.35 &&
      puck.z > -RINK.halfL + 0.3 &&
      Math.abs(puck.x) < RINK.halfW + 0.2;

    // The last line of defense. NOVA commits to the predicted crossing point
    // and covers the goal mouth rather than chasing shots that will miss wide.
    if (incomingThreat) {
      const saveBias = difficulty.saveBias;
      this.mode = 'save';
      const keeperX = predictedSaveX * saveBias + puck.x * (1 - saveBias);
      return {
        x: clamp(keeperX, -RINK.goalHalf - 0.18, RINK.goalHalf + 0.18),
        z: ownGoalLine,
        aimX: this.aimX,
      };
    }

    // Puck is on NOVA's side. Build an approach path behind it, then strike
    // through it toward the player's goal.
    if (puck.z < 0.35) {
      this.mode = 'attack';
      this.aimX = this.chooseAim(player, difficulty);
      const aimZ = RINK.halfL + 0.7;
      const aimDx = this.aimX - futurePuck.x;
      const aimDz = aimZ - futurePuck.z;
      const aimLen = Math.hypot(aimDx, aimDz) || 1;
      const dirX = aimDx / aimLen;
      const dirZ = aimDz / aimLen;
      const behindX = futurePuck.x - dirX * (rSum + 0.34);
      const behindZ = futurePuck.z - dirZ * (rSum + 0.34);
      const distToPuck = distance2(this.x, this.z, puck.x, puck.z);
      const isBehind = this.z < puck.z - 0.18;
      const closeEnough = distance2(this.x, this.z, behindX, behindZ) < 0.95;

      let tacticalX = behindX;
      let tacticalZ = behindZ;

      if (!isBehind && puck.z < -0.4) {
        // Circle around the puck instead of bumping it toward our own net.
        const side = this.x >= puck.x ? 1 : -1;
        const routeSpace = rSum + 0.62;
        tacticalX = puck.x + side * routeSpace;
        tacticalZ = Math.min(this.z - 0.2, puck.z - routeSpace * 0.7);
      }

      if (isBehind && (closeEnough || distToPuck < rSum + 0.95)) {
        // Lunge through the puck to transfer momentum toward the target corner.
        tacticalX = futurePuck.x + dirX * 0.55;
        tacticalZ = futurePuck.z + dirZ * 0.55;
      } else if (!isBehind && Math.abs(this.x - puck.x) < rSum * 0.85) {
        // Small sideways bias while retreating to avoid tapping it goalward.
        const side = this.x >= puck.x ? 1 : -1;
        tacticalX += side * 0.55;
      }

      // Rookies mostly chase; higher difficulties use the full tactical path.
      const tactics = difficulty.tactics;
      const chaseX = futurePuck.x;
      const chaseZ = futurePuck.z;
      let targetX = chaseX * (1 - tactics) + tacticalX * tactics;
      let targetZ = chaseZ * (1 - tactics) + tacticalZ * tactics;

      // Keep the mallet body fully inside NOVA's half of the rink.
      targetZ = Math.min(targetZ, -RINK.malletR);

      // The player's mallet is a useful obstacle to aim around.
      const playerAimSway = clamp((player.x - futurePuck.x) * -0.04, -0.2, 0.2);
      targetX += playerAimSway;

      return { x: targetX, z: targetZ, aimX: this.aimX };
    }

    // Player possession: shadow the puck, stay between puck and goal, and
    // invite a shot into a covered corner.
    this.mode = 'guard';
    this.aggressionPhase += 0.012;
    const guardZ = difficulty.guardZ + Math.sin(this.aggressionPhase) * 0.3;
    const anticipation = puck.vx * difficulty.prediction * 0.8;
    const tracking = 0.56 + difficulty.tactics * 0.24;
    const shadowX = clamp(
      puck.x * tracking + player.x * 0.08 + anticipation,
      -RINK.halfW + RINK.malletR,
      RINK.halfW - RINK.malletR,
    );
    return {
      x: shadowX,
      z: guardZ,
      aimX: this.aimX,
    };
  }

  update(dt, puck, player, difficulty) {
    this.reactionTimer -= dt;
    if (this.reactionTimer <= 0) {
      this.reactionTimer = difficulty.reaction * randomRange(0.78, 1.24);
      const target = this.chooseTarget(puck, player, difficulty);
      this.targetX = target.x;
      this.targetZ = target.z;
      const errorScale = difficulty.error * (this.mode === 'save' ? 0.55 : 1);
      this.errorX = randomRange(-errorScale, errorScale);
      this.errorZ = randomRange(-errorScale * 0.42, errorScale * 0.42);
    }

    const limitX = RINK.halfW - RINK.malletR - 0.03;
    const targetX = clamp(this.targetX + this.errorX, -limitX, limitX);
    const targetZ = clamp(this.targetZ + this.errorZ, -RINK.halfL + RINK.malletR + 0.03, -RINK.malletR - 0.03);
    const dx = targetX - this.x;
    const dz = targetZ - this.z;
    const dist = Math.hypot(dx, dz);

    let desiredVx = 0;
    let desiredVz = 0;
    if (dist > 0.035) {
      const desiredSpeed = Math.min(difficulty.speed, dist * 9.5);
      desiredVx = (dx / dist) * desiredSpeed;
      desiredVz = (dz / dist) * desiredSpeed;
    }

    const steer = 1 - Math.exp(-difficulty.agility * dt);
    this.vx += (desiredVx - this.vx) * steer;
    this.vz += (desiredVz - this.vz) * steer;

    const prevX = this.x;
    const prevZ = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.clampToSide();

    const actualDt = Math.max(dt, 1e-5);
    this.vx = (this.x - prevX) / actualDt;
    this.vz = (this.z - prevZ) / actualDt;
  }

  hold(dt, x, z) {
    const prevX = this.x;
    const prevZ = this.z;
    const ease = 1 - Math.exp(-7 * dt);
    this.x += (x - this.x) * ease;
    this.z += (z - this.z) * ease;
    const actualDt = Math.max(dt, 1e-5);
    this.vx = (this.x - prevX) / actualDt;
    this.vz = (this.z - prevZ) / actualDt;
  }
}
