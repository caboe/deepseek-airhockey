const STORAGE_KEY = 'neonpuck.muted';

/**
 * Tiny procedural synth. All effects are generated in the browser,
 * so the game needs no external audio files.
 */
export class ArenaAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambientBus = null;
    this.ambientNodes = [];
    this.noiseBuffer = null;
    this.muted = this.readMuted();
    this.started = false;
  }

  readMuted() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  persistMuted() {
    try {
      window.localStorage.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    } catch {
      /* storage is optional */
    }
  }

  unlock() {
    this.ensure();
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    try {
      const ctx = new AudioContextClass();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.62;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 20;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.22;
      master.connect(compressor);
      compressor.connect(ctx.destination);
      this.master = master;

      const length = Math.floor(ctx.sampleRate * 2);
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = 0.865 * last + 0.135 * white;
        data[i] = white * 0.65 + last * 0.35;
      }
      this.noiseBuffer = buffer;
      return true;
    } catch {
      this.ctx = null;
      this.master = null;
      return false;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this.persistMuted();
    if (this.master && this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.62, t, 0.035);
    }
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  now() {
    return this.ctx?.currentTime ?? 0;
  }

  makeNoise(duration, gain, { type = 'bandpass', frequency = 900, q = 1, pan = 0 } = {}) {
    if (!this.ctx || !this.noiseBuffer || !this.master || this.muted) return;
    const ctx = this.ctx;
    const t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, t);
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan;
      src.connect(filter);
      filter.connect(env);
      env.connect(panner);
      panner.connect(this.master);
    } else {
      src.connect(filter);
      filter.connect(env);
      env.connect(this.master);
    }
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  makeTone(
    frequency,
    duration,
    {
      type = 'sine',
      gain = 0.1,
      attack = 0.006,
      endFrequency = null,
      delay = 0,
      pan = 0,
    } = {},
  ) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const t = this.now() + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, frequency), t);
    if (endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), t + duration);
    }
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      osc.connect(env);
      env.connect(panner);
      panner.connect(this.master);
    } else {
      osc.connect(env);
      env.connect(this.master);
    }
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  ui() {
    if (!this.ensure()) return;
    this.makeTone(980, 0.055, { type: 'sine', gain: 0.035, endFrequency: 1450 });
  }

  countdown(isGo = false) {
    if (!this.ensure()) return;
    if (isGo) {
      this.makeTone(740, 0.18, { type: 'triangle', gain: 0.11, endFrequency: 1480 });
      this.makeTone(1480, 0.25, { type: 'sine', gain: 0.045 });
    } else {
      this.makeTone(620, 0.09, { type: 'sine', gain: 0.07, endFrequency: 610 });
    }
  }

  hit(strength = 1, pan = 0, who = 'player') {
    if (!this.ensure()) return;
    const power = Math.min(1.4, Math.max(0.22, strength));
    const base = who === 'player' ? 165 : 145;
    this.makeTone(base + power * 24, 0.13, {
      type: 'sine',
      gain: 0.13 * power,
      endFrequency: 58,
      pan,
    });
    this.makeTone(840 + Math.random() * 220, 0.045, {
      type: 'triangle',
      gain: 0.026 * power,
      endFrequency: 330,
      pan,
    });
    this.makeNoise(0.055, 0.05 * power, { type: 'highpass', frequency: 2400, pan });
  }

  wall(strength = 1, pan = 0) {
    if (!this.ensure()) return;
    const power = Math.min(1, Math.max(0.15, strength));
    this.makeTone(92, 0.1, {
      type: 'sine',
      gain: 0.075 * power,
      endFrequency: 55,
      pan,
    });
    this.makeNoise(0.07, 0.036 * power, { type: 'bandpass', frequency: 780, q: 1.8, pan });
  }

  goal(scorer = 'player') {
    if (!this.ensure()) return;
    const notes = scorer === 'player' ? [392, 523.25, 659.25, 783.99] : [196, 174.61, 146.83];
    notes.forEach((note, index) => {
      this.makeTone(note, 0.4, {
        type: 'triangle',
        gain: scorer === 'player' ? 0.1 : 0.085,
        delay: index * 0.085,
      });
      this.makeTone(note * 2, 0.25, {
        type: 'sine',
        gain: 0.022,
        delay: index * 0.085 + 0.01,
      });
    });
    if (scorer === 'player') {
      this.makeTone(98, 0.35, { type: 'sine', gain: 0.1, endFrequency: 49 });
      this.makeNoise(0.75, 0.055, { type: 'lowpass', frequency: 2200, q: 0.4 });
    } else {
      this.makeTone(73.4, 0.6, { type: 'sine', gain: 0.12, endFrequency: 46 });
      this.makeNoise(0.5, 0.045, { type: 'bandpass', frequency: 480, q: 0.7 });
    }
  }

  victory() {
    if (!this.ensure()) return;
    const notes = [261.63, 329.63, 392, 523.25, 659.25, 783.99];
    notes.forEach((note, index) => {
      this.makeTone(note, 0.62, {
        type: 'triangle',
        gain: 0.085,
        delay: 0.06 + index * 0.11,
      });
    });
    this.makeTone(65.4, 1.2, { type: 'sine', gain: 0.1, endFrequency: 65.4 });
    this.makeNoise(1.4, 0.038, { type: 'lowpass', frequency: 1800, q: 0.4 });
  }

  defeat() {
    if (!this.ensure()) return;
    const notes = [261.63, 233.08, 196, 155.56, 130.81];
    notes.forEach((note, index) => {
      this.makeTone(note, 0.5, {
        type: 'triangle',
        gain: 0.065,
        delay: index * 0.14,
      });
    });
    this.makeTone(55, 1.1, { type: 'sine', gain: 0.08, endFrequency: 36.7 });
  }

  startAmbient() {
    if (!this.ensure() || this.started) return;
    this.started = true;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.ambientBus = ctx.createGain();
    this.ambientBus.gain.value = 0.0001;
    this.ambientBus.connect(this.master);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280;
    filter.Q.value = 1.8;
    filter.connect(this.ambientBus);

    const droneA = ctx.createOscillator();
    droneA.type = 'triangle';
    droneA.frequency.value = 55;
    const droneB = ctx.createOscillator();
    droneB.type = 'sine';
    droneB.frequency.value = 82.4;
    droneB.detune.value = -7;

    const droneGainA = ctx.createGain();
    droneGainA.gain.value = 0.045;
    const droneGainB = ctx.createGain();
    droneGainB.gain.value = 0.028;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.075;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.035;
    lfo.connect(lfoGain);
    lfoGain.connect(this.ambientBus.gain);

    droneA.connect(droneGainA);
    droneB.connect(droneGainB);
    droneGainA.connect(filter);
    droneGainB.connect(filter);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 880;
    noiseFilter.Q.value = 0.55;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.007;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.ambientBus);

    const t = this.now();
    droneA.start(t);
    droneB.start(t);
    lfo.start(t);
    noise.start(t);
    this.ambientNodes = [droneA, droneB, lfo, noise, filter, droneGainA, droneGainB, noiseFilter, noiseGain, lfo, lfoGain];
    this.ambientBus.gain.setTargetAtTime(0.2, t, 1.8);
  }

  setAmbientLevel(level) {
    if (!this.ctx || !this.ambientBus) return;
    const t = this.now();
    this.ambientBus.gain.cancelScheduledValues(t);
    this.ambientBus.gain.setTargetAtTime(Math.max(0.0001, level), t, 0.25);
  }

  suspendToBackground() {
    if (this.ctx?.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  resumeFromBackground() {
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }
}
