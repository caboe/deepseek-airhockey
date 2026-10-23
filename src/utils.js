export const TAU = Math.PI * 2;

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function length2(x, z) {
  return Math.hypot(x, z);
}

export function normalize2(x, z) {
  const len = Math.hypot(x, z);
  if (len < 1e-8) return { x: 0, z: 0, len: 0 };
  return { x: x / len, z: z / len, len };
}

export function clampLength(x, z, max) {
  const len = Math.hypot(x, z);
  if (len <= max || len < 1e-8) return { x, z };
  return { x: (x / len) * max, z: (z / len) * max };
}

export function distance2(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

export function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

export function randomSign() {
  return Math.random() < 0.5 ? -1 : 1;
}

/**
 * Mirror a future x position through the side rails. Used by the AI keeper.
 */
export function predictWallX(x, vx, time, wallX) {
  if (time <= 0) return x;
  const predicted = x + vx * time;
  const span = wallX * 4;
  if (span <= 0) return clamp(predicted, -wallX, wallX);
  const rel = (((predicted + wallX) % span) + span) % span;
  if (rel <= wallX * 2) return rel - wallX;
  return wallX * 3 - rel;
}

export function timeToZ(z, vz, targetZ) {
  if (Math.abs(vz) < 1e-4) return Infinity;
  const t = (targetZ - z) / vz;
  return t > 0 ? t : Infinity;
}

export function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatSpeed(speed) {
  return Math.round(speed * 9.2);
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeOutCubic(x) {
  return 1 - Math.pow(1 - x, 3);
}
