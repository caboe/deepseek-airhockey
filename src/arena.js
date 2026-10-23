import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { COLORS, RINK } from './constants.js';
import { GlowParticles, ShockwavePool, createAmbientDust } from './particles.js';
import {
  createEnvironmentTexture,
  createFloorTexture,
  createGlowTexture,
  createPuckSurfaceTexture,
  createRinkTexture,
  createSignTexture,
  createTopViewTexture,
} from './textures.js';
import { clamp, damp } from './utils.js';

const TABLE_Y = RINK.tableY;
const OUTER_W = 2 * (RINK.halfW + RINK.railW);
const OUTER_L = 2 * (RINK.halfL + RINK.railW);

const goalVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const goalFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uFlash;
  uniform vec3 uColor;
  varying vec2 vUv;

  void main() {
    float scan = pow(0.5 + 0.5 * sin(vUv.y * 28.0 - uTime * 2.6), 16.0);
    float wideScan = pow(0.5 + 0.5 * sin(vUv.y * 9.0 + uTime * 1.25), 5.0);
    float sideMask = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);
    float yMask = smoothstep(0.0, 0.055, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
    float energy = 0.012 + scan * 0.085 + wideScan * 0.03 + uFlash * 0.2;
    float alpha = energy * sideMask * yMask;
    vec3 color = uColor * (0.45 + scan * 1.2 + uFlash * 2.4);
    gl_FragColor = vec4(color, alpha);
  }
`;

function setShadows(root, cast = true, receive = true) {
  root.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
}

function makeGoalField(color) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: goalVertexShader,
    fragmentShader: goalFragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  return material;
}

export class Arena {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.failed = false;
    this.isMobile = window.matchMedia('(max-width: 760px)').matches;
    this.maxPixelRatio = this.isMobile ? 1.7 : 2;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.view = '3d';
    this.time = 0;
    this.shake = 0;
    this.goalPulse = 0;
    this.goalPulseSide = 1;
    this.trailAccumulator = 0;
    this.menuCameraSettled = false;
    this.currentLook = new THREE.Vector3(0, TABLE_Y, 0);
    this.activeCamera = null;
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.inputPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_Y);
    this.intersection = new THREE.Vector3();

    this.createRenderer();
    this.createScene();
    this.createCameras();
    this.createLights();
    this.buildEnvironment();
    this.buildTable();
    this.buildGoals();
    this.buildTopView();
    this.buildMallets();
    this.buildPuck();
    this.buildEffects();
    this.buildComposer();
    this.bindResize();
    this.layout();
    this.setView('3d', { silent: true });
    this.updateCamera(0, { phase: 'menu' });
    this.render(0);
  }

  createRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        stencil: false,
      });
    } catch (error) {
      this.failed = true;
      throw error;
    }
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x02060b, 1);
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02060b);
    this.scene.fog = new THREE.Fog(0x02060b, 29, 76);
    this.scene.environment = createEnvironmentTexture();
    this.scene.environmentIntensity = 0.68;
    this.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.glowTexture = createGlowTexture(128);
    this.puckSurfaceTexture = createPuckSurfaceTexture();
  }

  createCameras() {
    this.camera3D = new THREE.PerspectiveCamera(42, this.width / this.height, 0.1, 160);
    this.camera2D = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    this.camera2D.up.set(0, 0, -1);
    this.fitCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 160);

    this.basePos3D = new THREE.Vector3(0, 10, 18);
    this.baseLook3D = new THREE.Vector3(0, TABLE_Y, 0);
    this.baseFov3D = 42;
    this.orthoViewHeight = 21.5;
    this.orthoCenterZ = -0.55;
    this.activeCamera = this.camera3D;
    this.cameraLook = this.baseLook3D.clone();
  }

  createLights() {
    const hemi = new THREE.HemisphereLight(0x8ad9ff, 0x060c13, 0.82);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xcdf7ff, 2.1);
    key.position.set(-8.5, 18, 9);
    key.target.position.set(0, TABLE_Y, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(this.isMobile ? 1024 : 2048, this.isMobile ? 1024 : 2048);
    key.shadow.camera.left = -13;
    key.shadow.camera.right = 13;
    key.shadow.camera.top = 15;
    key.shadow.camera.bottom = -15;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 42;
    key.shadow.bias = -0.00018;
    key.shadow.normalBias = 0.022;
    key.shadow.radius = 3;
    this.scene.add(key);
    this.scene.add(key.target);
    this.keyLight = key;

    const fill = new THREE.DirectionalLight(0xff6e9e, 0.65);
    fill.position.set(9, 9, -10);
    fill.target.position.set(0, TABLE_Y, -2);
    this.scene.add(fill);
    this.scene.add(fill.target);

    const topLight = new THREE.PointLight(0xd8fbff, 24, 26, 1.8);
    topLight.position.set(0, 13, 1);
    this.scene.add(topLight);

    this.playerLight = new THREE.PointLight(COLORS.player, 22, 15, 2);
    this.playerLight.position.set(0, 4.2, 7.5);
    this.scene.add(this.playerLight);

    this.aiLight = new THREE.PointLight(COLORS.ai, 18, 15, 2);
    this.aiLight.position.set(0, 4.2, -7.5);
    this.scene.add(this.aiLight);

    this.goalLightFar = new THREE.PointLight(COLORS.ai, 8, 6, 2);
    this.goalLightFar.position.set(0, TABLE_Y + 1.2, -RINK.halfL - 0.2);
    this.scene.add(this.goalLightFar);

    this.goalLightNear = new THREE.PointLight(COLORS.player, 5, 6, 2);
    this.goalLightNear.position.set(0, TABLE_Y + 1.1, RINK.halfL + 0.2);
    this.scene.add(this.goalLightNear);
  }

  buildEnvironment() {
    const floorTexture = createFloorTexture(this.anisotropy);
    const floorMaterial = new THREE.MeshStandardMaterial({
      map: floorTexture,
      color: 0x98b7c3,
      roughness: 0.68,
      metalness: 0.48,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(170, 170), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.035;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.floor = floor;

    const daisMaterial = new THREE.MeshStandardMaterial({
      color: 0x030a10,
      roughness: 0.48,
      metalness: 0.55,
    });
    const dais = new THREE.Mesh(new THREE.CylinderGeometry(11.4, 11.9, 0.14, 96), daisMaterial);
    dais.position.y = 0.035;
    dais.receiveShadow = true;
    this.scene.add(dais);
    this.dais = dais;

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x3ad6ed,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const [radius, width, opacity] of [
      [9.7, 0.015, 0.2],
      [10.1, 0.008, 0.12],
      [11.35, 0.01, 0.16],
    ]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + width, 128), ringMaterial.clone());
      ring.material.opacity = opacity;
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.112;
      this.scene.add(ring);
    }

    // Focused pools of light ground the floating table in the dark arena.
    const poolGeometry = new THREE.PlaneGeometry(15, 11);
    const nearPool = new THREE.Mesh(
      poolGeometry,
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color: COLORS.player,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    nearPool.rotation.x = -Math.PI / 2;
    nearPool.position.set(0, 0.122, 5.1);
    this.scene.add(nearPool);

    const farPool = new THREE.Mesh(
      poolGeometry,
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color: COLORS.ai,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    farPool.rotation.x = -Math.PI / 2;
    farPool.position.set(0, 0.123, -5.1);
    this.scene.add(farPool);

    // Sparse architecture in the distance.
    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0x041017,
      roughness: 0.5,
      metalness: 0.7,
    });
    const lightBarMaterial = new THREE.MeshBasicMaterial({
      color: 0x3fd4e6,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const magentaBarMaterial = lightBarMaterial.clone();
    magentaBarMaterial.color.set(COLORS.ai);
    magentaBarMaterial.opacity = 0.28;

    for (const [x, z, height, isMagenta] of [
      [-7.6, -13.4, 5.6, false],
      [7.6, -13.4, 5.6, true],
      [-10.5, -6.2, 3.8, true],
      [10.5, 2.8, 4.4, false],
      [-9.2, 8.3, 2.9, false],
      [9.2, 10.2, 3.2, true],
    ]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.34, height, 0.34), pillarMaterial);
      pillar.position.set(x, height / 2, z);
      this.scene.add(pillar);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.045, height * 0.86, 0.045), isMagenta ? magentaBarMaterial : lightBarMaterial);
      bar.position.set(x, height * 0.5, z + 0.19);
      this.scene.add(bar);
    }

    // A far horizon strip gives the empty arena an edge.
    const horizonMaterial = new THREE.MeshBasicMaterial({
      color: 0x2ab7cf,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const horizon = new THREE.Mesh(new THREE.PlaneGeometry(38, 0.04), horizonMaterial);
    horizon.position.set(0, 0.12, -22);
    horizon.rotation.x = 0;
    this.scene.add(horizon);

    this.dust = createAmbientDust(this.scene, this.glowTexture, this.isMobile ? 70 : 140);
  }

  buildTable() {
    this.tableGroup = new THREE.Group();
    this.scene.add(this.tableGroup);

    const railMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x06131b,
      metalness: 0.92,
      roughness: 0.22,
      clearcoat: 0.55,
      clearcoatRoughness: 0.25,
    });
    const baseMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x030a10,
      metalness: 0.72,
      roughness: 0.32,
      clearcoat: 0.25,
      clearcoatRoughness: 0.35,
    });
    this.railMaterial = railMaterial;

    const baseH = 0.7;
    const base = new THREE.Mesh(
      new RoundedBoxGeometry(OUTER_W + 0.22, baseH, OUTER_L + 0.22, 4, 0.12),
      baseMaterial,
    );
    base.position.set(0, TABLE_Y - 0.075 - baseH / 2, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    this.tableGroup.add(base);

    const lowerTrim = new THREE.Mesh(
      new RoundedBoxGeometry(OUTER_W - 0.18, 0.17, OUTER_L - 0.18, 3, 0.06),
      railMaterial,
    );
    lowerTrim.position.set(0, TABLE_Y - 0.76, 0);
    lowerTrim.castShadow = true;
    this.tableGroup.add(lowerTrim);

    // Rink surface.
    this.rinkTexture = createRinkTexture(this.anisotropy);
    const surfaceMaterial = new THREE.MeshPhysicalMaterial({
      map: this.rinkTexture,
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveMap: this.rinkTexture,
      emissiveIntensity: 0.74,
      roughness: 0.26,
      metalness: 0.64,
      clearcoat: 0.8,
      clearcoatRoughness: 0.16,
    });
    this.surfaceMaterial = surfaceMaterial;
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(RINK.halfW * 2, RINK.halfL * 2), surfaceMaterial);
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = TABLE_Y + 0.003;
    surface.receiveShadow = true;
    this.tableGroup.add(surface);

    // A thin illuminated edge around the rink floor.
    const lipMaterial = new THREE.MeshBasicMaterial({
      color: 0x5ceeff,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const lip = new THREE.Mesh(new THREE.PlaneGeometry(RINK.halfW * 2 + 0.08, RINK.halfL * 2 + 0.08), lipMaterial);
    lip.rotation.x = -Math.PI / 2;
    lip.position.y = TABLE_Y - 0.002;
    this.tableGroup.add(lip);

    // Crisp in-world markings. These read more clearly than the baked
    // texture and give the rink its broadcast-style tactical language.
    const lines = new THREE.Group();
    const lineMaterial = new THREE.MeshBasicMaterial({
      color: 0x58e8f7,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const lineMaterialSoft = lineMaterial.clone();
    lineMaterialSoft.opacity = 0.16;
    const centerStrip = new THREE.Mesh(
      new THREE.BoxGeometry(RINK.halfW * 2 - 0.42, 0.004, 0.022),
      lineMaterial,
    );
    centerStrip.position.set(0, TABLE_Y + 0.009, 0);
    lines.add(centerStrip);

    const centerRing = new THREE.Mesh(
      new THREE.RingGeometry(1.68, 1.7, 96),
      lineMaterialSoft,
    );
    centerRing.rotation.x = -Math.PI / 2;
    centerRing.position.set(0, TABLE_Y + 0.01, 0);
    lines.add(centerRing);

    const centerInnerRing = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.515, 64),
      lineMaterialSoft,
    );
    centerInnerRing.rotation.x = -Math.PI / 2;
    centerInnerRing.position.set(0, TABLE_Y + 0.01, 0);
    lines.add(centerInnerRing);

    const faceoffMarkMaterial = lineMaterialSoft.clone();
    faceoffMarkMaterial.opacity = 0.2;
    for (const x of [-2.35, 2.35]) {
      for (const z of [-3.2, 3.2]) {
        const mark = new THREE.Mesh(new THREE.RingGeometry(0.19, 0.205, 40), faceoffMarkMaterial);
        mark.rotation.x = -Math.PI / 2;
        mark.position.set(x, TABLE_Y + 0.01, z);
        lines.add(mark);
      }
    }

    // Inset boundary line.
    for (const side of [-1, 1]) {
      const v = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.003, RINK.halfL * 2 - 0.62),
        lineMaterialSoft,
      );
      v.position.set(side * (RINK.halfW - 0.25), TABLE_Y + 0.009, 0);
      lines.add(v);
      const h = new THREE.Mesh(
        new THREE.BoxGeometry(RINK.halfW * 2 - 0.62, 0.003, 0.012),
        lineMaterialSoft,
      );
      h.position.set(0, TABLE_Y + 0.009, side * (RINK.halfL - 0.25));
      lines.add(h);
    }
    this.tableLines = lines;
    this.tableGroup.add(lines);

    // Soft team-color pools on the glass, kept subtle enough not to fight
    // the puck for attention.
    const teamPoolGeometry = new THREE.PlaneGeometry(7.6, 7.6);
    const nearGlow = new THREE.Mesh(
      teamPoolGeometry,
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color: COLORS.player,
        transparent: true,
        opacity: 0.075,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    nearGlow.rotation.x = -Math.PI / 2;
    nearGlow.position.set(0, TABLE_Y + 0.006, 4.5);
    this.tableGroup.add(nearGlow);
    const farGlow = new THREE.Mesh(
      teamPoolGeometry,
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color: COLORS.ai,
        transparent: true,
        opacity: 0.065,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    farGlow.rotation.x = -Math.PI / 2;
    farGlow.position.set(0, TABLE_Y + 0.007, -4.5);
    this.tableGroup.add(farGlow);
    this.tableTeamGlows = [nearGlow, farGlow];

    // Side and end rails.
    const railLength = OUTER_L;
    const sideRailGeometry = new RoundedBoxGeometry(RINK.railW, RINK.railH, railLength, 3, 0.06);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(sideRailGeometry, railMaterial);
      rail.position.set(side * (RINK.halfW + RINK.railW / 2), TABLE_Y + RINK.railH / 2, 0);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.tableGroup.add(rail);
    }

    const endSegmentWidth = RINK.halfW + RINK.railW - RINK.goalHalf;
    const endCenterX = (RINK.goalHalf + RINK.halfW + RINK.railW) / 2;
    const endRailGeometry = new RoundedBoxGeometry(endSegmentWidth, RINK.railH, RINK.railW, 3, 0.06);
    for (const end of [-1, 1]) {
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(endRailGeometry, railMaterial);
        rail.position.set(
          side * endCenterX,
          TABLE_Y + RINK.railH / 2,
          end * (RINK.halfL + RINK.railW / 2),
        );
        rail.castShadow = true;
        rail.receiveShadow = true;
        this.tableGroup.add(rail);
      }
    }

    // Neon inlays on top of the rails.
    const cyanNeon = new THREE.MeshBasicMaterial({
      color: 0x5edfed,
      toneMapped: false,
    });
    const pinkNeon = new THREE.MeshBasicMaterial({
      color: 0xe34a80,
      toneMapped: false,
    });
    const topY = TABLE_Y + RINK.railH + 0.008;

    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.012, OUTER_L - 0.55), cyanNeon);
      strip.position.set(side * (RINK.halfW + RINK.railW * 0.76), topY, 0);
      this.tableGroup.add(strip);
      const innerNeon = cyanNeon.clone();
      innerNeon.transparent = true;
      innerNeon.opacity = 0.32;
      const innerStrip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.008, OUTER_L - 1.2), innerNeon);
      innerStrip.position.set(side * (RINK.halfW + 0.06), topY, 0);
      this.tableGroup.add(innerStrip);
    }

    for (const end of [-1, 1]) {
      for (const side of [-1, 1]) {
        const strip = new THREE.Mesh(
          new THREE.BoxGeometry(endSegmentWidth - 0.22, 0.012, 0.026),
          end < 0 ? pinkNeon : cyanNeon,
        );
        strip.position.set(side * endCenterX, topY, end * (RINK.halfL + RINK.railW * 0.74));
        this.tableGroup.add(strip);
      }
    }

    // Corner caps.
    const capGeometry = new THREE.CylinderGeometry(0.22, 0.24, 0.075, 24);
    const capMaterial = new THREE.MeshStandardMaterial({
      color: 0x07161e,
      metalness: 0.9,
      roughness: 0.3,
    });
    const capGlowMaterial = new THREE.MeshBasicMaterial({ color: 0x9ceef7, toneMapped: false });
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        const cap = new THREE.Mesh(capGeometry, capMaterial);
        cap.position.set(
          x * (RINK.halfW + RINK.railW / 2),
          TABLE_Y + RINK.railH + 0.04,
          z * (RINK.halfL + RINK.railW / 2),
        );
        cap.castShadow = true;
        this.tableGroup.add(cap);
        const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.012, 20), capGlowMaterial);
        dot.position.set(cap.position.x, cap.position.y + 0.044, cap.position.z);
        this.tableGroup.add(dot);
      }
    }

    // Underglow. Two colors meet at the center line.
    const underGlowCyan = new THREE.MeshBasicMaterial({
      color: 0x44dff4,
      transparent: true,
      opacity: 0.6,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    const underGlowPink = underGlowCyan.clone();
    underGlowPink.color.set(0xff4a8a);
    for (const x of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, RINK.halfL - 0.2), zSign < 0 ? underGlowPink : underGlowCyan);
        bar.position.set(
          x * (OUTER_W / 2 + 0.12),
          TABLE_Y - 0.69,
          zSign * (RINK.halfL / 2 + 0.15),
        );
        this.tableGroup.add(bar);
      }
    }
    for (const z of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(OUTER_W * 0.62, 0.045, 0.02), z < 0 ? underGlowPink : underGlowCyan);
      bar.position.set(0, TABLE_Y - 0.69, z * (OUTER_L / 2 + 0.1));
      this.tableGroup.add(bar);
    }

    // The central support helps the table feel anchored above the dais.
    const stemMaterial = new THREE.MeshStandardMaterial({
      color: 0x040d13,
      metalness: 0.8,
      roughness: 0.35,
    });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 2.05, 0.45, 48), stemMaterial);
    stem.position.y = TABLE_Y - 0.98;
    stem.castShadow = true;
    this.scene.add(stem);
    const stemRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.04, 8, 64),
      new THREE.MeshBasicMaterial({ color: 0x51e9ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    stemRing.rotation.x = Math.PI / 2;
    stemRing.position.y = TABLE_Y - 0.79;
    this.scene.add(stemRing);
  }

  buildGoals() {
    this.goalFields = [];
    this.goalLights = [];

    this.createGoal(-1, COLORS.ai, 'NOVA', 'AI DEFENSE');
    this.createGoal(1, COLORS.player, 'YOU', 'YOUR DEFENSE');
  }

  createGoal(end, color, title, subtitle) {
    const group = new THREE.Group();
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x050f15,
      metalness: 0.9,
      roughness: 0.27,
    });
    const neonMaterial = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const softNeon = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const zPost = end * (RINK.halfL + RINK.railW * 0.56);
    const tall = end === -1;
    const goalHeight = tall ? RINK.goalHeight : 0.82;

    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(
        new RoundedBoxGeometry(0.15, goalHeight, 0.2, 3, 0.045),
        darkMaterial,
      );
      pillar.position.set(side * RINK.goalHalf, TABLE_Y + goalHeight / 2, zPost);
      pillar.castShadow = true;
      group.add(pillar);

      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, goalHeight - 0.1, 10), neonMaterial);
      tube.position.set(
        side * (RINK.goalHalf - 0.085),
        TABLE_Y + goalHeight / 2,
        zPost + end * 0.105,
      );
      group.add(tube);
    }

    const beam = new THREE.Mesh(
      new RoundedBoxGeometry(RINK.goalHalf * 2 + 0.26, 0.12, 0.22, 3, 0.04),
      darkMaterial,
    );
    beam.position.set(0, TABLE_Y + goalHeight, zPost);
    beam.castShadow = true;
    group.add(beam);

    const beamTube = new THREE.Mesh(new THREE.BoxGeometry(RINK.goalHalf * 2, 0.025, 0.025), neonMaterial);
    beamTube.position.set(0, TABLE_Y + goalHeight - 0.072, zPost + end * 0.11);
    group.add(beamTube);

    // A small glowing foot indicator on each post.
    for (const side of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.018, 0.24), softNeon);
      foot.position.set(side * RINK.goalHalf, TABLE_Y + 0.015, zPost);
      group.add(foot);
    }

    // Dark backing makes the goal opening read as a portal instead of a
    // bright set of stripes against the arena floor.
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(RINK.goalHalf * 2 - 0.08, goalHeight - 0.06),
      new THREE.MeshBasicMaterial({
        color: 0x020609,
        side: THREE.DoubleSide,
        toneMapped: false,
        depthWrite: false,
      }),
    );
    backdrop.position.set(0, TABLE_Y + goalHeight / 2, zPost + end * 0.56);
    backdrop.renderOrder = 2;
    group.add(backdrop);

    const curtainMaterial = makeGoalField(color);
    const curtain = new THREE.Mesh(
      new THREE.PlaneGeometry(RINK.goalHalf * 2 - 0.2, goalHeight - 0.14),
      curtainMaterial,
    );
    curtain.position.set(0, TABLE_Y + goalHeight / 2 - 0.01, zPost + end * 0.29);
    curtain.renderOrder = 3;
    group.add(curtain);
    this.goalFields.push({ material: curtainMaterial, end, light: null });

    const backFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(RINK.goalHalf * 2 + 0.3, RINK.goalDepth),
      new THREE.MeshStandardMaterial({ color: 0x041016, roughness: 0.38, metalness: 0.6 }),
    );
    backFloor.rotation.x = -Math.PI / 2;
    backFloor.position.set(0, TABLE_Y + 0.001, end * (RINK.halfL + RINK.goalDepth / 2));
    backFloor.receiveShadow = true;
    group.add(backFloor);

    const backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(RINK.goalHalf * 2 + 0.3, 0.8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.08,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    backWall.position.set(0, TABLE_Y + 0.28, end * (RINK.halfL + RINK.goalDepth));
    backWall.rotation.y = end < 0 ? 0 : Math.PI;
    group.add(backWall);

    // The far gate carries the arena identity. The near gate stays low so
    // it never blocks the player's side of the rink.
    if (tall) {
      const signTexture = createSignTexture(title, subtitle, `#${new THREE.Color(color).getHexString()}`);
      const signMaterial = new THREE.MeshBasicMaterial({
        map: signTexture,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        opacity: 0.88,
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.35, 0.673), signMaterial);
      sign.position.set(0, TABLE_Y + goalHeight + 0.44, zPost + end * 0.08);
      sign.renderOrder = 4;
      group.add(sign);
    }

    const underBeam = new THREE.Mesh(
      new THREE.BoxGeometry(RINK.goalHalf * 2 + 0.14, 0.018, 0.11),
      softNeon,
    );
    underBeam.position.set(0, TABLE_Y + 0.01, zPost + end * 0.1);
    group.add(underBeam);

    this.scene.add(group);
    if (end === -1) this.aiGoal = group;
    else this.playerGoal = group;
  }


  buildTopView() {
    const texture = createTopViewTexture(this.anisotropy);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
      depthWrite: true,
      depthTest: true,
    });
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(RINK.halfW * 2 - 0.02, RINK.halfL * 2 - 0.02),
      material,
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = TABLE_Y + 0.012;
    plane.renderOrder = 1;
    plane.visible = false;
    this.scene.add(plane);
    this.topRink = plane;

    this.flatGroup = new THREE.Group();
    this.flatGroup.visible = false;
    this.scene.add(this.flatGroup);
    this.flatPlayer = this.createFlatMarker(COLORS.player, COLORS.playerHot, RINK.malletR, true);
    this.flatAi = this.createFlatMarker(COLORS.ai, COLORS.aiHot, RINK.malletR, false);
    this.flatPuck = this.createFlatMarker(COLORS.puck, 0xffffff, RINK.puckR, false, true);
    this.flatGroup.add(this.flatPlayer.group, this.flatAi.group, this.flatPuck.group);
  }

  createFlatMarker(color, hotColor, radius, isMallet, isPuck = false) {
    const group = new THREE.Group();
    group.position.y = TABLE_Y + 0.035;

    const fillMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: isPuck ? 0.2 : 0.12,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), fillMaterial);
    fill.rotation.x = -Math.PI / 2;
    group.add(fill);

    const outer = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.84, radius, 64),
      new THREE.MeshBasicMaterial({
        color: hotColor,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = 0.002;
    group.add(outer);

    if (isMallet) {
      const inner = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.38, radius * 0.48, 48),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        }),
      );
      inner.rotation.x = -Math.PI / 2;
      inner.position.y = 0.002;
      group.add(inner);

      const core = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.12, 24),
        new THREE.MeshBasicMaterial({ color: hotColor, toneMapped: false }),
      );
      core.rotation.x = -Math.PI / 2;
      core.position.y = 0.003;
      group.add(core);
    } else {
      const core = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 0.3, 24),
        new THREE.MeshBasicMaterial({ color: hotColor, toneMapped: false }),
      );
      core.rotation.x = -Math.PI / 2;
      core.position.y = 0.003;
      group.add(core);
    }

    const spinner = new THREE.Group();
    const tickGeometry = new THREE.BoxGeometry(0.035, 0.012, radius * 0.24);
    const tickMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      toneMapped: false,
    });
    for (let i = 0; i < 4; i += 1) {
      const tick = new THREE.Mesh(tickGeometry, tickMaterial);
      const angle = (i / 4) * Math.PI * 2;
      tick.position.set(Math.cos(angle) * radius * 1.2, 0.001, Math.sin(angle) * radius * 1.2);
      tick.rotation.y = -angle + Math.PI / 2;
      spinner.add(tick);
    }
    group.add(spinner);

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 4.6, radius * 4.6),
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color,
        transparent: true,
        opacity: 0.055,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.004;
    group.add(glow);

    return { group, spinner, fill, outer };
  }

  makeMallet(color, isPlayer) {
    const group = new THREE.Group();
    const dark = new THREE.MeshPhysicalMaterial({
      color: 0x0a1821,
      metalness: 0.66,
      roughness: 0.3,
      clearcoat: 0.4,
    });
    const teamMetal = new THREE.MeshStandardMaterial({
      color: 0x0b1e28,
      metalness: 0.7,
      roughness: 0.3,
      emissive: color,
      emissiveIntensity: 0.44,
    });
    const neon = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const hotNeon = new THREE.MeshBasicMaterial({
      color: isPlayer ? COLORS.playerHot : COLORS.aiHot,
      toneMapped: false,
    });

    const profile = [
      new THREE.Vector2(0.001, 0),
      new THREE.Vector2(0.64, 0),
      new THREE.Vector2(0.7, 0.025),
      new THREE.Vector2(0.7, 0.09),
      new THREE.Vector2(0.62, 0.16),
      new THREE.Vector2(0.38, 0.215),
      new THREE.Vector2(0.3, 0.26),
      new THREE.Vector2(0.29, 0.355),
      new THREE.Vector2(0.23, 0.4),
      new THREE.Vector2(0.12, 0.43),
      new THREE.Vector2(0.001, 0.43),
    ];
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), dark);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const undersideRing = new THREE.Mesh(new THREE.TorusGeometry(0.652, 0.026, 8, 72), neon);
    undersideRing.rotation.x = Math.PI / 2;
    undersideRing.position.y = 0.055;
    group.add(undersideRing);

    const gripRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 8, 56), neon);
    gripRing.rotation.x = Math.PI / 2;
    gripRing.position.y = 0.355;
    group.add(gripRing);

    const centerCap = new THREE.Mesh(new THREE.CylinderGeometry(0.195, 0.22, 0.055, 32), teamMetal);
    centerCap.position.y = 0.445;
    centerCap.castShadow = true;
    group.add(centerCap);

    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.072, 24, 16), hotNeon);
    orb.position.y = 0.505;
    group.add(orb);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.78, 0.012, 6, 80, Math.PI * 1.35),
      softTorusMaterial(color),
    );
    halo.rotation.x = Math.PI / 2;
    halo.rotation.z = isPlayer ? 0.3 : 2.1;
    halo.position.y = 0.17;
    group.add(halo);

    const ringDots = new THREE.Group();
    for (let i = 0; i < 3; i += 1) {
      const dot = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.012, 0.02), neon);
      const angle = (i / 3) * Math.PI * 2;
      dot.position.set(Math.cos(angle) * 0.73, 0.03, Math.sin(angle) * 0.73);
      dot.rotation.y = -angle;
      ringDots.add(dot);
    }
    group.add(ringDots);

    const edgeBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.696, 0.696, 0.052, 48, 1, true),
      teamMetal,
    );
    edgeBand.position.y = 0.075;
    edgeBand.castShadow = false;
    group.add(edgeBand);

    const underGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.85, 1.85),
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    underGlow.rotation.x = -Math.PI / 2;
    underGlow.position.y = 0.012;
    underGlow.renderOrder = 2;
    group.add(underGlow);

    const light = new THREE.PointLight(color, 1.7, 1.8, 2);
    light.position.y = 0.4;
    group.add(light);

    group.position.set(0, TABLE_Y + 0.018, isPlayer ? RINK.halfL - 2.1 : -RINK.halfL + 2.6);
    this.scene.add(group);
    return { group, halo, ringDots, orb, underGlow, light, isPlayer, color };
  }

  buildMallets() {
    this.playerMallet = this.makeMallet(COLORS.player, true);
    this.aiMallet = this.makeMallet(COLORS.ai, false);
  }

  buildPuck() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x11242b,
      metalness: 0.7,
      roughness: 0.25,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
    });
    const neon = new THREE.MeshBasicMaterial({ color: 0xa9f9ff, toneMapped: false });
    const hot = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(RINK.puckR, RINK.puckR * 0.94, 0.11, 48), bodyMat);
    body.position.y = 0.06;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(RINK.puckR * 0.92, 0.019, 6, 56), neon);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.085;
    group.add(rim);

    const baseRim = new THREE.Mesh(new THREE.TorusGeometry(RINK.puckR * 0.96, 0.008, 5, 56), neon);
    baseRim.rotation.x = Math.PI / 2;
    baseRim.position.y = 0.015;
    group.add(baseRim);

    const top = new THREE.Mesh(
      new THREE.CircleGeometry(RINK.puckR * 0.86, 48),
      new THREE.MeshBasicMaterial({
        map: this.puckSurfaceTexture,
        color: 0xffffff,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.116;
    group.add(top);

    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.038, 16, 12), hot);
    orb.position.y = 0.154;
    group.add(orb);

    const underGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.55, 1.55),
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color: COLORS.puck,
        transparent: true,
        opacity: 0.26,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    underGlow.rotation.x = -Math.PI / 2;
    underGlow.position.y = 0.005;
    underGlow.renderOrder = 2;
    group.add(underGlow);

    const light = new THREE.PointLight(COLORS.puck, 2.6, 2.1, 2);
    light.position.y = 0.6;
    group.add(light);

    group.position.set(0, TABLE_Y + 0.006, 0);
    this.scene.add(group);
    this.puck = { group, top, orb, underGlow, light, rim };
  }

  buildEffects() {
    this.particles = new GlowParticles(this.scene, this.isMobile ? 480 : 760);
    this.shockwaves = new ShockwavePool(this.scene, 8);
    this.tempColor = new THREE.Color();
  }

  buildComposer() {
    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: this.isMobile ? 0 : 2,
    });
    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.composer.setPixelRatio(this.pixelRatio);
    this.renderPass = new RenderPass(this.scene, this.camera3D);
    this.composer.addPass(this.renderPass);
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      this.isMobile ? 0.52 : 0.62,
      0.5,
      0.86,
    );
    this.composer.addPass(this.bloomPass);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
    this.composer.setSize(this.width, this.height);
  }

  bindResize() {
    this.handleResize = () => this.resize();
    window.addEventListener('resize', this.handleResize);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
    }
  }

  resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.layout();
    this.render(0);
  }

  layout() {
    const aspect = Math.max(0.3, this.width / this.height);
    this.camera3D.aspect = aspect;
    this.camera3D.fov = aspect < 0.72 ? 47 : aspect < 1.15 ? 43 : 40;
    this.camera3D.updateProjectionMatrix();
    this.layoutGameCamera(aspect);

    const neededHeight = RINK.halfL * 2 + 4.2;
    const neededWidth = RINK.halfW * 2 + 2.6;
    this.orthoViewHeight = Math.max(neededHeight, neededWidth / aspect);
    const viewWidth = this.orthoViewHeight * aspect;
    this.camera2D.left = -viewWidth / 2;
    this.camera2D.right = viewWidth / 2;
    this.camera2D.top = this.orthoViewHeight / 2;
    this.camera2D.bottom = -this.orthoViewHeight / 2;
    this.camera2D.position.set(0, 40, this.orthoCenterZ);
    this.camera2D.up.set(0, 0, -1);
    this.camera2D.lookAt(0, 0, this.orthoCenterZ);
    this.camera2D.updateProjectionMatrix();

    this.activeCamera = this.view === '2d' ? this.camera2D : this.camera3D;
    if (this.renderPass) this.renderPass.camera = this.activeCamera;
    this.updateProjectionUniforms();
  }

  layoutGameCamera(aspect) {
    const fov = this.camera3D.fov;
    let pitch;
    if (aspect < 0.7) pitch = 1.03;
    else if (aspect < 1.05) pitch = 0.95;
    else if (aspect < 1.6) pitch = 0.84;
    else pitch = 0.77;
    const target = new THREE.Vector3(0, TABLE_Y + 0.08, 0.08);
    const dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch)).normalize();

    const points = [];
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        points.push(new THREE.Vector3(x * (RINK.halfW + RINK.railW), TABLE_Y + RINK.railH, z * (RINK.halfL + RINK.railW)));
        points.push(new THREE.Vector3(x * RINK.halfW, TABLE_Y, z * RINK.halfL));
        points.push(new THREE.Vector3(x * RINK.goalHalf, TABLE_Y + (z < 0 ? RINK.goalHeight : 0.82), z * (RINK.halfL + RINK.railW * 0.56)));
      }
    }

    const testCam = this.fitCamera;
    testCam.fov = fov;
    testCam.aspect = aspect;
    testCam.updateProjectionMatrix();

    let low = 10;
    let high = 55;
    for (let i = 0; i < 24; i += 1) {
      const distance = (low + high) / 2;
      testCam.position.copy(target).addScaledVector(dir, distance);
      testCam.up.set(0, 1, 0);
      testCam.lookAt(target);
      testCam.updateMatrixWorld(true);
      let fits = true;
      for (const point of points) {
        const projected = point.clone().project(testCam);
        if (
          projected.x < -0.93 ||
          projected.x > 0.93 ||
          projected.y > 0.79 ||
          projected.y < -0.87
        ) {
          fits = false;
          break;
        }
      }
      if (fits) high = distance;
      else low = distance;
    }

    this.baseFov3D = fov;
    this.basePos3D = target.clone().addScaledVector(dir, high);
    this.baseLook3D = target.clone();
    this.camera3D.fov = fov;
    this.camera3D.updateProjectionMatrix();
  }

  updateProjectionUniforms() {
    if (!this.particles) return;
    if (this.view === '2d') {
      this.particles.setProjection({
        height: this.height,
        pixelRatio: this.pixelRatio,
        ortho: true,
        viewHeight: this.orthoViewHeight,
      });
    } else {
      this.particles.setProjection({
        height: this.height,
        pixelRatio: this.pixelRatio,
        ortho: false,
        fov: this.camera3D.fov,
      });
    }
  }

  setView(view, { silent = false } = {}) {
    if (view !== '3d' && view !== '2d') return;
    this.view = view;
    const is2D = view === '2d';
    this.activeCamera = is2D ? this.camera2D : this.camera3D;
    this.topRink.visible = is2D;
    this.flatGroup.visible = is2D;
    if (this.dust) this.dust.points.visible = !is2D;
    this.puck.group.visible = !is2D;
    this.playerMallet.group.visible = !is2D;
    this.aiMallet.group.visible = !is2D;
    if (is2D) {
      this.scene.fog.near = 58;
      this.scene.fog.far = 112;
      this.bloomPass.strength = this.isMobile ? 0.3 : 0.38;
      this.camera2D.position.set(0, 40, this.orthoCenterZ);
      this.camera2D.lookAt(0, 0, this.orthoCenterZ);
    } else {
      this.scene.fog.near = 29;
      this.scene.fog.far = 76;
      this.bloomPass.strength = this.isMobile ? 0.52 : 0.62;
      this.camera3D.position.copy(this.basePos3D);
      this.cameraLook.copy(this.baseLook3D);
      this.camera3D.lookAt(this.cameraLook);
    }
    this.renderPass.camera = this.activeCamera;
    this.updateProjectionUniforms();
    if (!silent) this.render(0);
  }

  updateCamera(dt, game) {
    if (this.view === '2d') {
      this.activeCamera = this.camera2D;
      this.renderPass.camera = this.camera2D;
      const shake = this.shake > 0.002 ? this.shake : 0;
      const menuOffset = game.phase === 'menu' ? -1.15 : 0;
      this.camera2D.position.x = menuOffset + (shake ? (Math.random() * 2 - 1) * shake * 0.6 : 0);
      this.camera2D.position.z = this.orthoCenterZ + (shake ? (Math.random() * 2 - 1) * shake * 0.6 : 0);
      this.camera2D.up.set(0, 0, -1);
      this.camera2D.lookAt(this.camera2D.position.x, 0, this.camera2D.position.z);
      return;
    }

    this.activeCamera = this.camera3D;
    this.renderPass.camera = this.camera3D;
    const menu = game.phase === 'menu';

    if (menu) {
      const t = this.time;
      const baseDir = this.basePos3D.clone().sub(this.baseLook3D).normalize();
      const menuDistance = this.basePos3D.distanceTo(this.baseLook3D) * 1.13;
      const desiredLook = new THREE.Vector3(
        -1.25 + Math.sin(t * 0.09) * 0.2,
        TABLE_Y + 0.22,
        -0.15,
      );
      const desiredPos = desiredLook.clone().addScaledVector(baseDir, menuDistance);
      desiredPos.x += Math.sin(t * 0.09) * 2.6;
      desiredPos.y += Math.cos(t * 0.17) * 0.18;
      const ease = 1 - Math.exp(-3.5 * Math.max(dt, 1 / 120));
      this.camera3D.position.lerp(desiredPos, ease);
      this.currentLook.lerp(desiredLook, ease);
    } else {
      const desiredPos = this.basePos3D.clone();
      const desiredLook = this.baseLook3D.clone();
      desiredPos.y += Math.sin(this.time * 0.45) * 0.04;
      const ease = 1 - Math.exp(-3.8 * Math.max(dt, 1 / 120));
      this.camera3D.position.lerp(desiredPos, ease);
      this.currentLook.lerp(desiredLook, ease);
    }

    const shake = this.shake > 0.001 ? this.shake : 0;
    if (shake) {
      this.camera3D.position.x += (Math.random() * 2 - 1) * shake * 0.55;
      this.camera3D.position.y += (Math.random() * 2 - 1) * shake * 0.34;
      this.camera3D.position.z += (Math.random() * 2 - 1) * shake * 0.22;
    }
    const look = this.currentLook.clone();
    if (shake) {
      look.x += (Math.random() * 2 - 1) * shake * 0.28;
      look.y += (Math.random() * 2 - 1) * shake * 0.2;
    }
    this.camera3D.lookAt(look);
  }

  syncGame(game, dt) {
    const puck = game.puck;
    const is3D = this.view === '3d';
    const showPuck = game.phase !== 'goal' && game.phase !== 'over';
    this.puck.group.visible = showPuck && is3D;
    this.playerMallet.group.visible = is3D;
    this.aiMallet.group.visible = is3D;
    this.flatGroup.visible = !is3D;
    this.flatPuck.group.visible = !is3D && showPuck;
    if (showPuck && is3D) {
      this.puck.group.position.set(puck.x, TABLE_Y + 0.012 + Math.sin(this.time * 8.5) * 0.005, puck.z);
      this.puck.group.rotation.y = puck.spin;
      this.puck.top.rotation.z = puck.spin * 0.14;
      this.puck.orb.position.y = 0.154 + Math.sin(this.time * 9.5) * 0.004;
      this.puck.light.position.set(0, 0.58, 0);
      this.puck.underGlow.material.opacity = 0.18 + Math.min(0.2, game.puckSpeed / 80);
    }

    const player = game.player;
    this.playerMallet.group.position.set(
      player.x,
      TABLE_Y + 0.018 + Math.sin(this.time * 4.2) * 0.006,
      player.z,
    );
    this.playerMallet.halo.rotation.z += dt * 0.55;
    this.playerMallet.ringDots.rotation.y -= dt * 0.8;

    const ai = game.ai;
    this.aiMallet.group.position.set(
      ai.x,
      TABLE_Y + 0.018 + Math.sin(this.time * 4.6 + 1) * 0.006,
      ai.z,
    );
    this.aiMallet.halo.rotation.z -= dt * 0.68;
    this.aiMallet.ringDots.rotation.y += dt * 0.9;

    this.playerMallet.light.position.set(0, 0.45, 0);
    this.aiMallet.light.position.set(0, 0.45, 0);

    if (!is3D) {
      this.flatPlayer.group.position.set(player.x, TABLE_Y + 0.035, player.z);
      this.flatAi.group.position.set(ai.x, TABLE_Y + 0.035, ai.z);
      this.flatPuck.group.position.set(puck.x, TABLE_Y + 0.035, puck.z);
      this.flatPlayer.spinner.rotation.y -= dt * 0.9;
      this.flatAi.spinner.rotation.y += dt * 1.15;
      this.flatPuck.spinner.rotation.y += dt * 2.4;
      const pulse = 0.62 + Math.sin(this.time * 5.5) * 0.16;
      this.flatPuck.outer.material.opacity = pulse;
      this.flatPlayer.outer.material.opacity = 0.85 + Math.sin(this.time * 3.2) * 0.08;
    }

    if (game.phase === 'playing' && showPuck && game.puckSpeed > 2.2) {
      const speed = game.puckSpeed;
      this.trailAccumulator += Math.min(0.06, dt) * (speed * 2.2 + 8);
      while (this.trailAccumulator > 1) {
        this.trailAccumulator -= 1;
        this.particles.trail(
          puck.x - puck.vx * 0.012,
          TABLE_Y + 0.14,
          puck.z - puck.vz * 0.012,
          Math.random() < 0.35 ? 0xffffff : COLORS.puck,
          { size: 0.055 + speed * 0.0025, life: 0.19 + speed * 0.004, alpha: 0.28 },
        );
      }
    } else {
      this.trailAccumulator = 0;
    }

    this.playerLight.position.z = 7.2 + player.x * 0.05;
    this.aiLight.position.z = -7.2 + ai.x * 0.03;
  }

  update(dt, game) {
    this.time += dt;
    if (game?.phase) this.syncGame(game, dt);
    this.shake = damp(this.shake, 0, 5.2, dt);
    this.goalPulse = damp(this.goalPulse, 0, 2.6, dt);

    for (const field of this.goalFields) {
      field.material.uniforms.uTime.value = this.time;
      field.material.uniforms.uFlash.value =
        field.end === this.goalPulseSide ? 0.25 + this.goalPulse * 1.8 : 0.25 + this.goalPulse * 0.08;
    }

    this.particles.update(dt);
    this.shockwaves.update(dt);
    if (this.dust) this.dust.update(dt, this.time);
    this.updateCamera(dt, game || { phase: 'menu' });
    this.energyPulse = 0.5 + Math.sin(this.time * 1.6) * 0.5;
    this.playerLight.intensity = 20 + this.energyPulse * 3;
    this.aiLight.intensity = 16 + (1 - this.energyPulse) * 3;
    this.goalLightFar.intensity = 6 + this.goalPulse * 22;
    this.goalLightNear.intensity = 4 + this.goalPulse * 15;
  }

  render(dt = 0) {
    if (this.failed) return;
    this.composer.render(dt);
  }

  addShake(amount) {
    this.shake = Math.min(0.55, this.shake + amount);
  }

  screenToTable(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const y = -(((clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    this.pointerNdc.set(x, y);
    this.raycaster.setFromCamera(this.pointerNdc, this.activeCamera);
    const hit = this.raycaster.ray.intersectPlane(this.inputPlane, this.intersection);
    if (!hit) return null;
    return { x: this.intersection.x, z: this.intersection.z };
  }

  sparkAt(x, z, color, intensity = 1) {
    this.tempColor.set(color);
    this.particles.burst(x, z, this.tempColor, {
      count: Math.round(7 + intensity * 14),
      speed: 1.8 + intensity * 4.6,
      up: 1.3 + intensity * 2.6,
      life: 0.25 + intensity * 0.22,
      size: 0.07 + intensity * 0.055,
      gravity: 7,
    });
    if (intensity > 0.55) {
      this.shockwaves.spawn(x, z, color, {
        startScale: 0.12,
        endScale: 0.9 + intensity * 1.5,
        duration: 0.32,
        alpha: 0.25 + intensity * 0.2,
        y: TABLE_Y + 0.015,
      });
    }
  }

  handleGameEvent(type, data = {}) {
    if (type === 'hit') {
      this.sparkAt(data.x, data.z, data.who === 'player' ? COLORS.player : COLORS.ai, data.intensity);
      this.addShake(0.012 + data.intensity * 0.016);
    } else if (type === 'wall') {
      this.sparkAt(data.x, data.z, 0xa7f6ff, data.intensity * 0.62);
      this.addShake(0.006 + data.intensity * 0.007);
    } else if (type === 'goal') {
      const color = data.scorer === 'you' ? COLORS.player : COLORS.ai;
      this.goalPulse = 1;
      this.goalPulseSide = data.scorer === 'you' ? -1 : 1;
      this.particles.goalBurst(data.x, data.z, color, 0xffffff);
      this.shockwaves.spawn(data.x, data.z, color, {
        startScale: 0.3,
        endScale: 5.6,
        duration: 0.9,
        alpha: 0.6,
      });
      this.shockwaves.spawn(data.x, data.z, 0xffffff, {
        startScale: 0.2,
        endScale: 3.1,
        duration: 0.62,
        alpha: 0.45,
      });
      this.addShake(0.25);
    } else if (type === 'serve') {
      this.shockwaves.spawn(0, 0, COLORS.player, {
        startScale: 0.1,
        endScale: 2.2,
        duration: 0.55,
        alpha: 0.24,
      });
    } else if (type === 'matchEnd') {
      const palette = [COLORS.player, COLORS.playerHot, 0xffffff, COLORS.ai];
      this.particles.confetti(0, 2.6, palette);
      if (data.winner === 'you') {
        this.particles.confetti(-2.2, -1.2, palette);
        this.particles.confetti(2.4, 0.7, palette);
      }
      this.addShake(0.16);
    }
  }

  dispose() {
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
  }
}

function softTorusMaterial(color) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}
