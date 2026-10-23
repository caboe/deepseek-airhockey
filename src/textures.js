import * as THREE from 'three';
import { RINK } from './constants.js';

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function textureFromCanvas(canvas, { srgb = true, anisotropy = 8 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

export function createGlowTexture(size = 128) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.12, 'rgba(255,255,255,0.92)');
  gradient.addColorStop(0.32, 'rgba(255,255,255,0.34)');
  gradient.addColorStop(0.64, 'rgba(255,255,255,0.07)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = textureFromCanvas(canvas, { srgb: true, anisotropy: 2 });
  return texture;
}

export function createSoftCircleTexture(size = 128) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(0,0,0,0.7)');
  gradient.addColorStop(0.4, 'rgba(0,0,0,0.38)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return textureFromCanvas(canvas, { srgb: false, anisotropy: 2 });
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function createRinkTexture(rendererAnisotropy = 8) {
  const { halfW, halfL, goalHalf } = RINK;
  const W = 1024;
  const H = Math.round(W * ((halfL * 2) / (halfW * 2)));
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const sx = (x) => ((x + halfW) / (halfW * 2)) * W;
  const sy = (z) => ((z + halfL) / (halfL * 2)) * H;
  const scale = W / (halfW * 2);
  const cyan = 'rgba(115, 241, 255,';
  const magenta = 'rgba(255, 101, 157,';

  // Base surface — cooled glass with a faint vertical sheen.
  const base = ctx.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, '#07131b');
  base.addColorStop(0.35, '#081a23');
  base.addColorStop(0.58, '#06141d');
  base.addColorStop(1, '#040d14');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  const sheen = ctx.createRadialGradient(W * 0.48, H * 0.44, 10, W * 0.5, H * 0.5, W * 0.75);
  sheen.addColorStop(0, 'rgba(88, 226, 255, 0.07)');
  sheen.addColorStop(0.45, 'rgba(35, 103, 123, 0.035)');
  sheen.addColorStop(1, 'rgba(0, 8, 13, 0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  // Micro-grid.
  ctx.lineWidth = 1;
  for (let x = -halfW; x <= halfW + 0.001; x += 0.55) {
    const px = sx(x);
    ctx.strokeStyle = `${cyan}${x === 0 ? 0.08 : 0.035})`;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, H);
    ctx.stroke();
  }
  for (let z = -halfL; z <= halfL + 0.001; z += 0.55) {
    const py = sy(z);
    ctx.strokeStyle = `${cyan}${z === 0 ? 0.08 : 0.035})`;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(W, py);
    ctx.stroke();
  }

  // Side lane marks.
  ctx.save();
  ctx.setLineDash([5, 15]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = `${cyan}0.13)`;
  for (const x of [-halfW + 0.62, halfW - 0.62]) {
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(-halfL + 0.8));
    ctx.lineTo(sx(x), sy(halfL - 0.8));
    ctx.stroke();
  }
  ctx.restore();

  // Goal creases.
  function drawCrease(goalZ, color) {
    const centerY = sy(goalZ);
    const radius = 2.2 * scale;
    const towardTable = goalZ < 0 ? 1 : -1;
    const start = goalZ < 0 ? 0 : Math.PI;
    const end = goalZ < 0 ? Math.PI : Math.PI * 2;
    const fill = ctx.createRadialGradient(sx(0), centerY, 0, sx(0), centerY, radius);
    fill.addColorStop(0, `${color}0.12)`);
    fill.addColorStop(0.7, `${color}0.045)`);
    fill.addColorStop(1, `${color}0)`);
    ctx.beginPath();
    ctx.arc(sx(0), centerY, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx(0), centerY, radius, start, end);
    ctx.strokeStyle = `${color}0.3)`;
    ctx.lineWidth = 2;
    ctx.shadowColor = `${color}0.7)`;
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Small dashes on the crease edge.
    ctx.save();
    ctx.setLineDash([2, 10]);
    ctx.beginPath();
    ctx.arc(sx(0), centerY, radius - 13, start, end);
    ctx.strokeStyle = `${color}0.16)`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Goal line.
    ctx.beginPath();
    ctx.moveTo(sx(-goalHalf), centerY);
    ctx.lineTo(sx(goalHalf), centerY);
    ctx.lineWidth = 4;
    ctx.strokeStyle = `${color}0.55)`;
    ctx.shadowColor = `${color}0.8)`;
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Marker near the crease.
    ctx.beginPath();
    ctx.arc(sx(0), centerY + towardTable * radius * 0.9, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `${color}0.35)`;
    ctx.fill();
  }

  drawCrease(-halfL, magenta);
  drawCrease(halfL, cyan);

  // Face-off dots and short arcs.
  ctx.fillStyle = `${cyan}0.28)`;
  for (const x of [-2.25, 2.25]) {
    for (const z of [-3.15, 3.15]) {
      ctx.beginPath();
      ctx.arc(sx(x), sy(z), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = `${cyan}0.12)`;
  ctx.lineWidth = 1;
  for (const x of [-2.25, 2.25]) {
    for (const z of [-3.15, 3.15]) {
      ctx.beginPath();
      ctx.arc(sx(x), sy(z), 13, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Center line.
  const middle = sy(0);
  const centerLine = ctx.createLinearGradient(0, 0, W, 0);
  centerLine.addColorStop(0, `${cyan}0.03)`);
  centerLine.addColorStop(0.18, `${cyan}0.36)`);
  centerLine.addColorStop(0.5, `${cyan}0.62)`);
  centerLine.addColorStop(0.82, `${cyan}0.36)`);
  centerLine.addColorStop(1, `${cyan}0.03)`);
  ctx.strokeStyle = centerLine;
  ctx.lineWidth = 3;
  ctx.shadowColor = `${cyan}0.8)`;
  ctx.shadowBlur = 22;
  ctx.beginPath();
  ctx.moveTo(sx(-halfW + 0.24), middle);
  ctx.lineTo(sx(halfW - 0.24), middle);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Center circle.
  const circleRadius = 1.7 * scale;
  ctx.strokeStyle = `${cyan}0.44)`;
  ctx.lineWidth = 2.2;
  ctx.shadowColor = `${cyan}0.8)`;
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(W / 2, middle, circleRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = `${cyan}0.22)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(W / 2, middle, circleRadius * 0.72, 0, Math.PI * 2);
  ctx.stroke();

  // Face-off crosshatch in the center.
  ctx.strokeStyle = `${cyan}0.19)`;
  for (let i = 0; i < 4; i += 1) {
    const angle = (Math.PI / 2) * i;
    const r1 = circleRadius * 0.18;
    const r2 = circleRadius * 0.3;
    ctx.beginPath();
    ctx.moveTo(W / 2 + Math.cos(angle) * r1, middle + Math.sin(angle) * r1);
    ctx.lineTo(W / 2 + Math.cos(angle) * r2, middle + Math.sin(angle) * r2);
    ctx.stroke();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `${cyan}0.4)`;
  ctx.font = '600 22px "Chakra Petch", sans-serif';
  ctx.letterSpacing = '7px';
  ctx.fillText('NEON PUCK', W / 2, middle + 1);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = `${cyan}0.22)`;
  ctx.font = '500 10px "Inter", sans-serif';
  ctx.letterSpacing = '5px';
  ctx.fillText('ARENA 09', W / 2, middle + circleRadius * 0.5);
  ctx.letterSpacing = '0px';

  // Boundary and corner details.
  ctx.strokeStyle = `${cyan}0.2)`;
  ctx.lineWidth = 2;
  ctx.shadowColor = `${cyan}0.5)`;
  ctx.shadowBlur = 10;
  roundedRect(ctx, 10, 10, W - 20, H - 20, 24);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = `${cyan}0.1)`;
  ctx.lineWidth = 5;
  for (const [x, y, dirX, dirY] of [
    [34, 34, 1, 1],
    [W - 34, 34, -1, 1],
    [34, H - 34, 1, -1],
    [W - 34, H - 34, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y + dirY * 65);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dirX * 65, y);
    ctx.stroke();
  }

  // Sparse wear highlights keep the surface from feeling too flat.
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 38; i += 1) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    const w = 20 + Math.random() * 190;
    ctx.fillStyle = `${i % 3 === 0 ? cyan : magenta}${0.006 + Math.random() * 0.012})`;
    ctx.fillRect(x, y, w, 1);
  }
  ctx.globalCompositeOperation = 'source-over';

  return textureFromCanvas(canvas, { anisotropy: rendererAnisotropy });
}

export function createFloorTexture(rendererAnisotropy = 8) {
  const size = 512;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#040a10';
  ctx.fillRect(0, 0, size, size);

  // Large panels.
  ctx.fillStyle = 'rgba(17, 42, 55, 0.15)';
  for (let x = 0; x < 4; x += 1) {
    for (let y = 0; y < 4; y += 1) {
      if ((x + y) % 3 === 0) {
        ctx.fillRect((x * size) / 4 + 2, (y * size) / 4 + 2, size / 4 - 4, size / 4 - 4);
      }
    }
  }

  // Fine grid.
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i += 1) {
    const p = (i / 8) * size;
    ctx.strokeStyle = 'rgba(65, 180, 208, 0.065)';
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  // Heavy grid.
  ctx.strokeStyle = 'rgba(88, 215, 240, 0.13)';
  ctx.lineWidth = 1.5;
  for (const p of [0, size / 2]) {
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(123, 238, 255, 0.17)';
  ctx.fillRect(size / 2 - 2, size / 2 - 2, 4, 4);

  const texture = textureFromCanvas(canvas, { anisotropy: rendererAnisotropy });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 12);
  return texture;
}

export function createSignTexture(title, subtitle, color) {
  const W = 768;
  const H = 220;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  ctx.font = '700 84px "Chakra Petch", sans-serif';
  ctx.letterSpacing = '12px';
  ctx.fillText(title, W / 2, 96);
  ctx.letterSpacing = '0px';
  ctx.shadowBlur = 0;

  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 230, 150);
  ctx.lineTo(W / 2 - 32, 150);
  ctx.moveTo(W / 2 + 32, 150);
  ctx.lineTo(W / 2 + 230, 150);
  ctx.stroke();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = color;
  ctx.fillRect(W / 2 - 4, 147, 8, 6);

  ctx.globalAlpha = 0.52;
  ctx.fillStyle = '#dffbff';
  ctx.font = '500 18px "Inter", sans-serif';
  ctx.letterSpacing = '9px';
  ctx.fillText(subtitle, W / 2, 180);
  ctx.letterSpacing = '0px';
  ctx.globalAlpha = 1;

  const texture = textureFromCanvas(canvas, { anisotropy: 4 });
  return texture;
}

export function createPuckSurfaceTexture() {
  const size = 256;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);

  ctx.fillStyle = '#071117';
  ctx.beginPath();
  ctx.arc(c, c, c - 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(172, 249, 255, 0.85)';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#79f2ff';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(c, c, c - 16, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(112, 232, 255, 0.4)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * 28, c + Math.sin(a) * 28);
    ctx.lineTo(c + Math.cos(a) * 51, c + Math.sin(a) * 51);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(195, 252, 255, 0.9)';
  ctx.beginPath();
  ctx.arc(c, c, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#071117';
  ctx.beginPath();
  ctx.arc(c, c, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  return textureFromCanvas(canvas, { anisotropy: 4 });
}

export function createEnvironmentTexture() {
  const canvas = makeCanvas(1024, 512);
  const ctx = canvas.getContext('2d');

  const base = ctx.createLinearGradient(0, 0, 0, 512);
  base.addColorStop(0, '#06131d');
  base.addColorStop(0.42, '#030b12');
  base.addColorStop(0.7, '#02070c');
  base.addColorStop(1, '#010409');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 512);

  const glow = (x, y, radius, color) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.34, color.replace(/[\d.]+\)$/u, '0.3)'));
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 512);
  };

  glow(230, 196, 330, 'rgba(80, 235, 255, 0.62)');
  glow(760, 230, 290, 'rgba(255, 64, 137, 0.5)');
  glow(520, 70, 330, 'rgba(206, 252, 255, 0.32)');
  glow(60, 300, 250, 'rgba(44, 122, 190, 0.28)');

  ctx.strokeStyle = 'rgba(142, 243, 255, 0.12)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i += 1) {
    const y = 300 + i * 18;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y + 8);
    ctx.stroke();
  }

  const texture = textureFromCanvas(canvas, { srgb: true, anisotropy: 4 });
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

/**
 * A dedicated, unlit tactical surface used by the 2D top-down camera.
 * It is intentionally bolder and flatter than the 3D glass texture.
 */
export function createTopViewTexture(rendererAnisotropy = 8) {
  const { halfW, halfL, goalHalf } = RINK;
  const W = 1024;
  const H = Math.round(W * ((halfL * 2) / (halfW * 2)));
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const sx = (x) => ((x + halfW) / (halfW * 2)) * W;
  const sy = (z) => ((z + halfL) / (halfL * 2)) * H;
  const scale = W / (halfW * 2);
  const cyan = 'rgba(103, 241, 255,';
  const magenta = 'rgba(255, 94, 151,';

  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#0a0812');
  base.addColorStop(0.28, '#050e16');
  base.addColorStop(0.5, '#041018');
  base.addColorStop(0.72, '#04121a');
  base.addColorStop(1, '#041017');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Broad team-side washes.
  const topWash = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, H * 0.5);
  topWash.addColorStop(0, 'rgba(255, 63, 133, 0.13)');
  topWash.addColorStop(0.55, 'rgba(180, 32, 92, 0.03)');
  topWash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topWash;
  ctx.fillRect(0, 0, W, H);
  const bottomWash = ctx.createRadialGradient(W / 2, H, 0, W / 2, H, H * 0.5);
  bottomWash.addColorStop(0, 'rgba(48, 222, 255, 0.1)');
  bottomWash.addColorStop(0.55, 'rgba(14, 118, 148, 0.025)');
  bottomWash.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bottomWash;
  ctx.fillRect(0, 0, W, H);

  // Tactical grid.
  ctx.lineWidth = 1;
  for (let x = -halfW; x <= halfW + 0.001; x += 0.55) {
    ctx.strokeStyle = `${cyan}${x === 0 ? 0.16 : 0.055})`;
    ctx.beginPath();
    ctx.moveTo(sx(x), 0);
    ctx.lineTo(sx(x), H);
    ctx.stroke();
  }
  for (let z = -halfL; z <= halfL + 0.001; z += 0.55) {
    ctx.strokeStyle = `${cyan}${z === 0 ? 0.16 : 0.055})`;
    ctx.beginPath();
    ctx.moveTo(0, sy(z));
    ctx.lineTo(W, sy(z));
    ctx.stroke();
  }

  // Rink boundary.
  ctx.strokeStyle = `${cyan}0.66)`;
  ctx.lineWidth = 4;
  ctx.shadowColor = `${cyan}0.9)`;
  ctx.shadowBlur = 18;
  roundedRect(ctx, 18, 18, W - 36, H - 36, 22);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = `${cyan}0.14)`;
  ctx.lineWidth = 10;
  roundedRect(ctx, 39, 39, W - 78, H - 78, 12);
  ctx.stroke();

  // Center circle and line.
  const mid = H / 2;
  const radius = 1.72 * scale;
  ctx.shadowColor = `${cyan}0.85)`;
  ctx.shadowBlur = 20;
  ctx.strokeStyle = `${cyan}0.72)`;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.arc(W / 2, mid, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = `${cyan}0.28)`;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(W / 2, mid, radius * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, mid, radius * 1.14, 0, Math.PI * 2);
  ctx.setLineDash([3, 16]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = `${cyan}0.72)`;
  ctx.lineWidth = 3;
  ctx.shadowColor = `${cyan}0.8)`;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.moveTo(sx(-halfW + 0.22), mid);
  ctx.lineTo(sx(halfW - 0.22), mid);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = `${cyan}0.55)`;
  ctx.font = '600 20px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '6px';
  ctx.fillText('TACTICAL', W / 2, mid - 25);
  ctx.fillText('TOP VIEW', W / 2, mid + 25);
  ctx.letterSpacing = '0px';

  // Face-off markers.
  for (const x of [-2.35, 2.35]) {
    for (const z of [-3.2, 3.2]) {
      ctx.strokeStyle = `${cyan}0.26)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(sx(x), sy(z), 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `${cyan}0.44)`;
      ctx.beginPath();
      ctx.arc(sx(x), sy(z), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Goals and creases.
  function drawEnd(goalZ, color, label, labelYOffset) {
    const y = sy(goalZ);
    const r = 2.35 * scale;
    const start = goalZ < 0 ? 0 : Math.PI;
    const end = goalZ < 0 ? Math.PI : Math.PI * 2;
    const fill = ctx.createRadialGradient(sx(0), y, 0, sx(0), y, r);
    fill.addColorStop(0, `${color}0.18)`);
    fill.addColorStop(0.72, `${color}0.045)`);
    fill.addColorStop(1, `${color}0)`);
    ctx.beginPath();
    ctx.arc(sx(0), y, r, start, end);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(sx(0), y, r, start, end);
    ctx.strokeStyle = `${color}0.58)`;
    ctx.lineWidth = 3;
    ctx.shadowColor = `${color}0.9)`;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.moveTo(sx(-goalHalf), y);
    ctx.lineTo(sx(goalHalf), y);
    ctx.strokeStyle = `${color}0.9)`;
    ctx.lineWidth = 7;
    ctx.shadowColor = `${color}0.9)`;
    ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = `${color}0.5)`;
    ctx.font = '700 27px "Chakra Petch", sans-serif';
    ctx.letterSpacing = '10px';
    ctx.fillText(label, W / 2, y + labelYOffset);
    ctx.letterSpacing = '0px';

    ctx.strokeStyle = `${color}0.22)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx(-halfW + 0.7), y + labelYOffset);
    ctx.lineTo(sx(-goalHalf - 0.6), y + labelYOffset);
    ctx.moveTo(sx(goalHalf + 0.6), y + labelYOffset);
    ctx.lineTo(sx(halfW - 0.7), y + labelYOffset);
    ctx.stroke();
  }
  drawEnd(-halfL, magenta, 'NOVA', 58);
  drawEnd(halfL, cyan, 'DU', -58);

  // Side lane tick marks.
  ctx.strokeStyle = `${cyan}0.22)`;
  ctx.lineWidth = 1.5;
  for (let z = -halfL + 1; z < halfL; z += 1.2) {
    const y = sy(z);
    ctx.beginPath();
    ctx.moveTo(sx(-halfW + 0.22), y);
    ctx.lineTo(sx(-halfW + 0.48), y);
    ctx.moveTo(sx(halfW - 0.22), y);
    ctx.lineTo(sx(halfW - 0.48), y);
    ctx.stroke();
  }

  // Corner brackets.
  ctx.strokeStyle = `${cyan}0.45)`;
  ctx.lineWidth = 3;
  for (const [x, y, dx, dy] of [
    [42, 42, 1, 1],
    [W - 42, 42, -1, 1],
    [42, H - 42, 1, -1],
    [W - 42, H - 42, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * 54);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * 54, y);
    ctx.stroke();
  }

  return textureFromCanvas(canvas, { anisotropy: rendererAnisotropy });
}
