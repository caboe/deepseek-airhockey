export const RINK = Object.freeze({
  halfW: 4.4,
  halfL: 8.6,
  goalHalf: 1.78,
  goalDepth: 1.35,
  goalHeight: 2.12,
  tableY: 1.28,
  railW: 0.44,
  railH: 0.55,
  puckR: 0.36,
  malletR: 0.68,
});

export const SCORE_TO_WIN = 7;

export const LIMITS = Object.freeze({
  puckSpeed: 27,
  playerSpeed: 31,
  puckWallRestitution: 0.91,
  puckMalletRestitution: 0.95,
  puckFriction: 0.115,
});

export const COLORS = Object.freeze({
  player: 0x5ceeff,
  playerHot: 0xc8fbff,
  ai: 0xff4d8d,
  aiHot: 0xffb3cc,
  puck: 0xaef7ff,
  table: 0x06131c,
  tableLine: 0x51e6ff,
  floor: 0x02060b,
});

export const DIFFICULTIES = Object.freeze({
  rookie: {
    id: 'rookie',
    label: 'ROOKIE',
    loudLabel: 'PROTOKOLL // ROOKIE',
    tagline: 'NOVA reagiert langsam. Perfekt für den Einstieg.',
    speed: 6.7,
    agility: 6.9,
    reaction: 0.19,
    error: 0.88,
    aimError: 0.9,
    tactics: 0.32,
    prediction: 0.13,
    saveBias: 0.46,
    guardZ: -4.05,
    intro: 'Ein verzeihender Gegner. Bring deinen ersten Treffer ins Ziel.',
  },
  pro: {
    id: 'pro',
    label: 'PRO',
    loudLabel: 'PROTOKOLL // PRO',
    tagline: 'NOVA agiert schnell, liest deine Schüsse und spielt präzise Konter.',
    speed: 12.8,
    agility: 15.5,
    reaction: 0.06,
    error: 0.27,
    aimError: 0.27,
    tactics: 0.8,
    prediction: 0.29,
    saveBias: 0.9,
    guardZ: -5.55,
    intro: 'Schnelle Reflexe, klare Konter. Der faire Kampf um jede Scheibe.',
  },
  legend: {
    id: 'legend',
    label: 'LEGEND',
    loudLabel: 'PROTOKOLL // LEGEND',
    tagline: 'NOVA deckt Winkel ab, bevor du sie siehst. Nahezu fehlerfrei.',
    speed: 17.8,
    agility: 23,
    reaction: 0.025,
    error: 0.075,
    aimError: 0.085,
    tactics: 0.98,
    prediction: 0.4,
    saveBias: 1,
    guardZ: -6.15,
    intro: 'Maximale Antizipation. Nur ein perfekt gesetzter Winkel schlägt NOVA.',
  },
});

export const UI_DIFFICULTY = Object.freeze({
  rookie: 'PROTOCOL // ROOKIE',
  pro: 'PROTOCOL // PRO',
  legend: 'PROTOCOL // LEGEND',
});
