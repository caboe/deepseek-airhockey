import * as THREE from 'three';
import { RINK } from './constants.js';
import { clamp, easeOutCubic, randomRange } from './utils.js';

const vertexShader = /* glsl */ `
  uniform float uPixelScale;
  uniform float uOrtho;
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float perspectiveScale = uPixelScale / max(0.35, -mvPosition.z);
    float pointScale = mix(perspectiveScale, uPixelScale, uOrtho);
    gl_PointSize = clamp(aSize * pointScale, 0.0, 72.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float dist = length(centered) * 2.0;
    float edge = smoothstep(1.0, 0.12, dist);
    float core = smoothstep(0.42, 0.0, dist);
    float alpha = vAlpha * edge;
    if (alpha < 0.003) discard;
    vec3 color = vColor * (0.75 + core * 0.85);
    gl_FragColor = vec4(color, alpha);
  }
`;

export class GlowParticles {
  constructor(scene, capacity = 720) {
    this.capacity = capacity;
    this.particles = new Array(capacity);
    for (let i = 0; i < capacity; i += 1) {
      this.particles[i] = {
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 0.1,
        alpha: 1,
        gravity: 0,
        drag: 0,
        color: new THREE.Color(),
        floor: RINK.tableY,
      };
    }
    this.cursor = 0;

    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelScale: { value: 1000 },
        uOrtho: { value: 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    scene.add(this.mesh);
    this.geometry = geometry;
  }

  getColor(input) {
    if (input instanceof THREE.Color) return input;
    return new THREE.Color(input);
  }

  acquire() {
    for (let i = 0; i < this.capacity; i += 1) {
      const index = (this.cursor + i) % this.capacity;
      if (!this.particles[index].active) {
        this.cursor = (index + 1) % this.capacity;
        return this.particles[index];
      }
    }
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    return this.particles[index];
  }

  emit(options) {
    const {
      x = 0,
      y = RINK.tableY + 0.05,
      z = 0,
      vx = 0,
      vy = 0,
      vz = 0,
      color = 0xffffff,
      size = 0.12,
      life = 0.5,
      alpha = 1,
      gravity = 0,
      drag = 0,
      floor = RINK.tableY + 0.02,
    } = options;
    const p = this.acquire();
    p.active = true;
    p.x = x;
    p.y = Math.max(y, floor);
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.alpha = alpha;
    p.gravity = gravity;
    p.drag = drag;
    p.floor = floor;
    p.color.copy(this.getColor(color));
  }

  burst(x, z, color, options = {}) {
    const {
      count = 18,
      speed = 4,
      up = 2.2,
      spread = 0.12,
      life = 0.55,
      size = 0.15,
      gravity = 9,
      y = RINK.tableY + 0.08,
    } = options;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radial = speed * (0.25 + Math.random() * 0.95);
      this.emit({
        x: x + (Math.random() - 0.5) * spread,
        y: y + Math.random() * 0.04,
        z: z + (Math.random() - 0.5) * spread,
        vx: Math.cos(angle) * radial,
        vy: randomRange(up * 0.35, up),
        vz: Math.sin(angle) * radial,
        color,
        size: size * randomRange(0.55, 1.35),
        life: life * randomRange(0.55, 1.2),
        gravity,
        drag: 0.8,
        alpha: randomRange(0.55, 1),
      });
    }
  }

  trail(x, y, z, color, { size = 0.08, life = 0.28, alpha = 0.45 } = {}) {
    this.emit({
      x: x + (Math.random() - 0.5) * 0.09,
      y: y + (Math.random() - 0.5) * 0.04,
      z: z + (Math.random() - 0.5) * 0.09,
      vx: (Math.random() - 0.5) * 0.25,
      vy: randomRange(0.02, 0.16),
      vz: (Math.random() - 0.5) * 0.25,
      color,
      size,
      life,
      alpha,
      gravity: -0.08,
      drag: 0.4,
    });
  }

  goalBurst(x, z, color, color2) {
    this.burst(x, z, color, {
      count: 68,
      speed: 8.5,
      up: 7.2,
      life: 1.05,
      size: 0.18,
      gravity: 8,
    });
    this.burst(x, z, color2, {
      count: 34,
      speed: 4.2,
      up: 5,
      life: 0.85,
      size: 0.12,
      gravity: 6,
    });
    for (let i = 0; i < 18; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radial = randomRange(9, 16);
      this.emit({
        x,
        y: RINK.tableY + 0.2,
        z,
        vx: Math.cos(angle) * radial,
        vy: randomRange(1, 3.5),
        vz: Math.sin(angle) * radial,
        color: Math.random() < 0.55 ? color2 : color,
        size: randomRange(0.24, 0.42),
        life: randomRange(0.35, 0.55),
        gravity: 1,
        drag: 2.4,
        alpha: 0.8,
      });
    }
  }

  confetti(x, z, colors) {
    for (let i = 0; i < 80; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radial = randomRange(0.5, 7.5);
      this.emit({
        x: x + (Math.random() - 0.5) * 1.6,
        y: RINK.tableY + 0.4,
        z: z + (Math.random() - 0.5) * 1.6,
        vx: Math.cos(angle) * radial,
        vy: randomRange(3.4, 7.5),
        vz: Math.sin(angle) * radial,
        color: colors[i % colors.length],
        size: randomRange(0.12, 0.27),
        life: randomRange(1.2, 2.1),
        gravity: randomRange(4, 7),
        drag: 0.35,
        alpha: 1,
      });
    }
  }

  update(dt) {
    const { positions, colors, sizes, alphas } = this;
    for (let i = 0; i < this.capacity; i += 1) {
      const p = this.particles[i];
      const i3 = i * 3;
      if (!p.active) {
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }

      if (p.drag > 0) {
        const damping = Math.exp(-p.drag * dt);
        p.vx *= damping;
        p.vz *= damping;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      if (p.y < p.floor) {
        p.y = p.floor;
        p.vy *= -0.26;
        p.vx *= 0.7;
        p.vz *= 0.7;
        if (Math.abs(p.vy) < 0.18) p.vy = 0;
      }

      const normalized = p.life / p.maxLife;
      const fade = clamp(normalized * 1.6, 0, 1);
      positions[i3] = p.x;
      positions[i3 + 1] = p.y;
      positions[i3 + 2] = p.z;
      colors[i3] = p.color.r;
      colors[i3 + 1] = p.color.g;
      colors[i3 + 2] = p.color.b;
      sizes[i] = p.size * (0.65 + normalized * 0.45);
      alphas[i] = p.alpha * fade;
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
  }

  setProjection({ height, fov, viewHeight, ortho, pixelRatio }) {
    if (ortho) {
      this.material.uniforms.uPixelScale.value = (height * pixelRatio) / Math.max(0.1, viewHeight);
      this.material.uniforms.uOrtho.value = 1;
    } else {
      const halfTan = Math.tan(THREE.MathUtils.degToRad(fov) * 0.5);
      this.material.uniforms.uPixelScale.value = (height * pixelRatio * 0.5) / Math.max(0.01, halfTan);
      this.material.uniforms.uOrtho.value = 0;
    }
  }
}

export class ShockwavePool {
  constructor(scene, count = 7) {
    this.items = [];
    this.cursor = 0;
    const geometry = new THREE.RingGeometry(0.94, 1, 96);
    geometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.items.push({
        mesh,
        material,
        active: false,
        elapsed: 0,
        duration: 0.8,
        startScale: 0.25,
        endScale: 4.5,
        alpha: 0.65,
        y: RINK.tableY + 0.01,
      });
    }
  }

  spawn(x, z, color, { startScale = 0.24, endScale = 4.4, duration = 0.7, alpha = 0.6, y = RINK.tableY + 0.012 } = {}) {
    const item = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    item.active = true;
    item.elapsed = 0;
    item.duration = duration;
    item.startScale = startScale;
    item.endScale = endScale;
    item.alpha = alpha;
    item.y = y;
    item.mesh.position.set(x, y, z);
    item.mesh.scale.setScalar(startScale);
    item.material.color.set(color);
    item.material.opacity = alpha;
    item.mesh.visible = true;
  }

  update(dt) {
    for (const item of this.items) {
      if (!item.active) continue;
      item.elapsed += dt;
      const t = clamp(item.elapsed / item.duration, 0, 1);
      item.mesh.scale.setScalar(item.startScale + (item.endScale - item.startScale) * easeOutCubic(t));
      item.material.opacity = item.alpha * Math.pow(1 - t, 1.45);
      if (t >= 1) {
        item.active = false;
        item.mesh.visible = false;
      }
    }
  }
}

export function createAmbientDust(scene, glowTexture, count = 140) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = randomRange(-19, 19);
    positions[i * 3 + 1] = randomRange(0.3, 13);
    positions[i * 3 + 2] = randomRange(-20, 18);
    phases[i] = Math.random() * Math.PI * 2;
    sizes[i] = randomRange(0.02, 0.09);
    color.setHSL(0.51 + Math.random() * 0.08, 0.7, 0.6 + Math.random() * 0.2);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.075,
    map: glowTexture,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  scene.add(points);

  return {
    points,
    update(dt, time) {
      const attr = geometry.attributes.position;
      for (let i = 0; i < count; i += 1) {
        const i3 = i * 3;
        attr.array[i3 + 1] += dt * (0.035 + (i % 7) * 0.007);
        attr.array[i3] += Math.sin(time * 0.25 + phases[i]) * dt * 0.014;
        if (attr.array[i3 + 1] > 13.2) {
          attr.array[i3 + 1] = 0.3;
        }
      }
      attr.needsUpdate = true;
    },
  };
}
