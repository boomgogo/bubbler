// Draws the game. The view owns no rules: it is told what the board looks like and what
// just happened, and turns that into bubbles, motion and effects.
import { Scene, PerspectiveCamera, Vector3 } from 'three';
import { COLS, ROW_H, KIND } from '../config.js';
import { cellX, cellY, neighbor, inGrid } from '../core/grid.js';
import { createRenderer, Quality } from './renderer.js';
import { Environment } from './environment.js';
import { lake } from './places/index.js';
import { Bubbles, reflectCode } from './bubbles.js';
import { Fx, colorOf } from './fx.js';
import { Stage } from './stage.js';
import { Flight, pickCloseUps, planFlight, poseCamera } from './flyover.js';
import { computeFrame, TOP_Y, WATER_Y, EYE_Y, CAM_DIST, LAUNCH_WORLD_Y } from './layout.js';

const GRAVITY = 34;
const ACTIVE = { x: 0, y: LAUNCH_WORLD_Y, s: 1 };
const NEXT = { x: -1.95, y: LAUNCH_WORLD_Y - 0.3, s: 0.6 };

// How a bubble is drawn: colour, kind, mist and a stable random number for small variations.
export const lookOf = (b) => ({ c: b.c, k: b.k, m: b.m ?? 0, seed: ((b.id ?? 1) * 0.61803398875) % 1 });
const popColor = (look) => (look.m || look.k === KIND.NOVA ? -1 : look.c);

export class View {
  constructor(canvas, { tier, locked, reducedMotion, topPx, onLayout }) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.topPx = topPx;
    this.onLayout = onLayout;
    this.renderer = createRenderer(canvas, tier);
    this.quality = new Quality(tier, {
      locked,
      onTier: (t) => this.#applyTier(t),
      onScale: () => this.resize(),
    });
    this.env = new Environment(lake);
    this.env.setTier(this.renderer, this.quality.tier);
    this.bubbles = new Bubbles(this.quality.tier, this.env);
    this.fx = new Fx(this.quality.tier, this.env);
    this.stage = new Stage(this.env);
    this.scene = new Scene();
    this.scene.add(this.stage.group, ...this.bubbles.meshes, ...this.fx.objects);
    this.camera = new PerspectiveCamera();
    this.camera.matrixAutoUpdate = true;
    // The playing camera, worked out afresh every frame; a fly-over starts and ends on it.
    this.live = { eye: new Vector3(), center: new Vector3(), frustum: {} };
    this.rest = { eye: this.live.eye, target: this.live.center, w: 1 };
    this.flight = null;

    this.time = 0;
    this.tick = 0;
    this.statics = []; // bubbles resting on the board
    this.dying = []; // removed by the rules, waiting for their turn to pop
    this.falling = []; // cut loose
    this.flying = null; // the shot in flight
    this.slots = [{ look: null, ...ACTIVE }, { look: null, ...NEXT }];
    this.unmist = new Map(); // bubble id -> time its Mist starts to lift
    this.wobble = new Map(); // bubble id -> { t0, dx, dy }
    this.scroll = { y: 0, target: 0 };
    this.shake = 0;
    this.pointerX = 0;
    this.post = null; // the bloom pass, on the high tier only
    this.resize();
    this.#bloom();
  }

  // Loads or drops the bloom pass to match the current tier.
  #bloom() {
    if (!this.quality.tier.bloom) {
      this.post?.dispose();
      this.post = null;
      return;
    }
    if (this.post || this.loadingPost) return;
    this.loadingPost = true;
    import('./bloom.js')
      .then(({ createBloom }) => {
        if (!this.quality.tier.bloom) return;
        this.post = createBloom(this.renderer, this.env.scene, this.scene, this.camera);
        this.resize();
      })
      .catch(console.error)
      .finally(() => (this.loadingPost = false));
  }

  // Compiles every shader up front so the first shot does not stutter.
  async warmUp() {
    await Promise.all([
      this.renderer.compileAsync(this.env.scene, this.camera),
      this.renderer.compileAsync(this.scene, this.camera),
    ]);
  }

  // Builds a place's scene and compiles its shaders off to the side. Resolves to the scene.
  preparePlace(place) {
    const group = this.env.build(place);
    return this.renderer.compileAsync(group, this.camera, this.env.scene).then(() => group);
  }

  // Swaps the place in. The cube map is reshot at once, so every reflection follows.
  setPlace(place, group) {
    this.env.setPlace(place, group, this.renderer);
  }

  #applyTier(tier) {
    this.env.setTier(this.renderer, tier);
    this.bubbles.setTier(tier, this.env);
    this.fx.setTier(tier, this.env);
    this.stage.setEnv(this.env.texture);
    this.resize();
    this.#bloom();
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    const ratio = this.quality.pixelRatio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, ratio);
    this.frameRect = computeFrame(w, h, this.topPx);
    this.env.pointScale.value = ratio * 1.15;
    this.onLayout?.(this.frameRect);
  }

  toScreen(wx, wy) {
    const f = this.frameRect;
    return { x: (wx - f.left) * f.unit, y: (f.top - wy) * f.unit };
  }

  fromScreen(px, py) {
    const f = this.frameRect;
    return { x: f.left + px / f.unit, y: f.top - py / f.unit };
  }

  // Board coordinates (x across, y down from the level's ceiling) to world coordinates.
  worldX(bx) {
    return bx - COLS / 2;
  }

  worldY(by) {
    return TOP_Y - by + this.scroll.y;
  }

  // Rebuilds the resting bubbles from the rules' board.
  sync(board, scrollRow) {
    this.statics.length = 0;
    for (let r = Math.max(0, scrollRow - 3); r < board.rows.length; r++) {
      const row = board.rows[r];
      for (let c = 0; c < row.length; c++) {
        const b = row[c];
        if (b === null) continue;
        const nbr = [0, 0, 0, 0, 0, 0];
        for (let i = 0; i < 6; i++) {
          const [nr, nc] = neighbor(r, c, i);
          if (inGrid(nr, nc)) nbr[i] = reflectCode(board.get(nr, nc));
        }
        this.statics.push({ id: b.id, x: cellX(r, c), y: cellY(r), look: lookOf(b), nbr });
      }
    }
  }

  setScroll(scrollRow, { intro = false } = {}) {
    this.scroll.target = scrollRow * ROW_H;
    if (intro) this.scroll.y = this.scroll.target - 9.5; // the new level slides down into view
  }

  liftMist(id, delaySeconds) {
    this.unmist.set(id, this.time + delaySeconds);
  }

  // Soft rings round a bubble, to point at it. Board coordinates; placed where the board is
  // heading, so a scroll in progress does not leave them behind.
  mark(bx, by) {
    this.#rings(this.worldX(bx), TOP_Y - by + this.scroll.target);
  }

  markLauncher() {
    this.#rings(ACTIVE.x, ACTIVE.y);
  }

  #rings(x, y) {
    for (const delay of [0, 0.45, 0.9]) this.fx.ring(x, y, 0.3, colorOf(-1), { from: 0.55, to: 0.95, life: 0.75, delay, gain: 0.8 });
  }

  // Bubbles around a landing spot give a little.
  nudge(bx, by) {
    for (const s of this.statics) {
      const dx = s.x - bx;
      const dy = s.y - by;
      const d = Math.hypot(dx, dy);
      if (d < 0.01 || d > 1.75) continue;
      const a = 0.09 * (1 - d / 1.75);
      this.wobble.set(s.id, { t0: this.time, dx: (dx / d) * a, dy: (-dy / d) * a });
    }
  }

  // item: { x, y, look } in board coordinates. It keeps hanging until `delay` seconds from now.
  addDying(item, delay, onPop) {
    this.dying.push({ ...item, at: this.time + delay, onPop });
  }

  addFalling(item, delay, onDone, caught = false) {
    this.falling.push({ ...item, at: this.time + delay, onDone, caught, started: false });
  }

  // Sends the shot along its path. pts: flat board coordinates.
  fly(pts, duration, look, piercing, onDone) {
    const world = [];
    for (let i = 0; i < pts.length; i += 2) world.push(this.worldX(pts[i]), this.worldY(pts[i + 1]));
    const lens = [];
    let total = 0;
    for (let i = 2; i < world.length; i += 2) {
      const len = Math.hypot(world[i] - world[i - 2], world[i + 1] - world[i - 1]);
      lens.push(len);
      total += len;
    }
    this.flying = { world, lens, total, t0: this.time, duration, look, piercing, onDone, last: null };
  }

  // mode: 'reload' after a shot, 'swap', or 'set' to place both at once.
  setHand(active, next, mode = 'set') {
    const [a, b] = this.slots;
    if (mode === 'reload') {
      Object.assign(a, { x: b.x, y: b.y, s: b.s });
      b.s = 0;
    } else if (mode === 'swap') {
      const keep = { x: a.x, y: a.y, s: a.s };
      Object.assign(a, { x: b.x, y: b.y, s: b.s });
      Object.assign(b, keep);
    } else if (mode === 'special') {
      a.s = 0;
    } else {
      Object.assign(a, ACTIVE);
      Object.assign(b, NEXT);
    }
    a.look = active;
    b.look = next;
    if (active) this.stage.setColor(colorOf(active.k === KIND.COLOR ? active.c : -1));
  }

  // preview: what Game.preview returned, or null to hide the aim line.
  setAim(preview, look, angle) {
    if (!preview) return this.stage.setAim(null);
    const pts = [];
    for (let i = 0; i < preview.pts.length; i += 2) pts.push(this.worldX(preview.pts[i]), this.worldY(preview.pts[i + 1]));
    const ghost = preview.cell ? [this.worldX(cellX(...preview.cell)), this.worldY(cellY(preview.cell[0]))] : null;
    this.stage.setAim(pts, colorOf(look.k === KIND.COLOR ? look.c : -1), ghost, angle);
  }

  // The level-start fly-over. Returns false when it does not play (reduced motion).
  // count: close-ups. prefer(look): kinds to show first. onHold(look): a close-up begins.
  flyover(board, { count, quick = false, prefer, onHold, onDone }) {
    if (this.reducedMotion) return false;
    this.sync(board, 0);
    const picks = pickCloseUps(this.statics, count, { neighbors: this.quality.tier.neighbors, prefer });
    // Planned where the board will be once any slide-in has finished.
    const at = (by) => TOP_Y - by + this.scroll.target;
    const top = at(cellY(0));
    const world = picks.map((p) => new Vector3(this.worldX(p.x), at(p.y), 0));
    const lingers = picks.map((p) => !!prefer?.(p.look));
    const flight = new Flight(planFlight(world, { top, side: Math.random() < 0.5 ? -1 : 1, quick, lingers }), this.time);
    Object.assign(flight, { top: Math.max(TOP_Y, top + 0.5), onHold: (i) => onHold?.(picks[i].look), onDone });
    this.flight = flight;
    this.quality.hold();
    return true;
  }

  // Cuts the fly-over short: straight back to the playing view.
  skipFlight() {
    const f = this.flight;
    if (!f || f.skipped) return;
    this.flight = Object.assign(f.cut(this.time, this.live), { top: f.top, onDone: f.onDone, skipped: true });
  }

  // Drops the fly-over without finishing it, for a restart.
  stopFlight() {
    this.flight = null;
    this.quality.release();
  }

  #flightStep(from, to) {
    const f = this.flight;
    // Hardware that cannot draw the close-ups at a watchable rate gets straight back to the game:
    // the clock advances at most 0.1 s a frame, so a crawl would also stretch the flight out.
    // A single hitch is not a crawl; half a second of slow frames is.
    if (this.quality.ema > 55) f.slowSince ??= to;
    else f.slowSince = null;
    if (!f.skipped && f.slowSince !== null && to - f.slowSince > 0.5) return this.skipFlight();
    for (const i of f.holdsBetween(from, to)) f.onHold?.(i);
    if (!f.done(to)) return;
    this.stopFlight();
    f.onDone?.();
  }

  kick(amount) {
    if (!this.reducedMotion) this.shake = Math.max(this.shake, amount);
  }

  get busy() {
    return this.dying.length > 0 || this.falling.length > 0 || this.flying !== null || this.flight !== null;
  }

  frame(dt) {
    const t = (this.time += dt);
    const { bubbles, fx, flight } = this;
    const pose = this.#camera(t);
    // In flight the whole column shows; landing, the rows above the field shrink back to specks.
    const topY = flight ? TOP_Y + (flight.top - TOP_Y) * (1 - pose.w) : TOP_Y;
    bubbles.heroEye = flight ? this.camera.position : null;
    const ease = 1 - Math.exp(-dt * 9);
    this.scroll.y += (this.scroll.target - this.scroll.y) * ease;
    this.shake *= Math.exp(-dt * 10);
    const sx = Math.sin(t * 71) * this.shake;
    const sy = Math.cos(t * 59) * this.shake;

    bubbles.begin();

    for (const s of this.statics) {
      let x = this.worldX(s.x) + sx;
      let y = this.worldY(s.y) + sy;
      if (y > Math.max(TOP_Y, topY) + 1.5) continue;
      const w = this.wobble.get(s.id);
      if (w) {
        const age = t - w.t0;
        if (age > 0.5) this.wobble.delete(s.id);
        else {
          const k = Math.exp(-age * 9) * Math.cos(age * 30);
          x += w.dx * k;
          y += w.dy * k;
        }
      }
      let look = s.look;
      const lift = this.unmist.get(s.id);
      if (lift !== undefined) {
        const m = 1 - Math.max(0, (t - lift) / 0.4);
        if (m <= 0) this.unmist.delete(s.id);
        else look = { ...look, m };
      }
      bubbles.push(x, y, 0, 1, look, s.nbr);
    }

    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      const x = this.worldX(d.x) + sx;
      const y = this.worldY(d.y) + sy;
      const left = d.at - t;
      if (left <= 0) {
        fx.pop(x, y, popColor(d.look), d.look.k === KIND.OBSIDIAN);
        d.onPop?.(x, y);
        this.dying.splice(i, 1);
      } else {
        // Swell and flare in the last moment before bursting.
        const swell = Math.max(0, 1 - left / 0.07);
        bubbles.push(x, y, 0, 1 + 0.16 * swell, d.look, null, swell * 0.22);
      }
    }

    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      if (!f.started) {
        f.wx = this.worldX(f.x) + sx;
        f.wy = this.worldY(f.y) + sy;
        if (t >= f.at) {
          f.started = true;
          f.vx = (Math.random() - 0.5) * 2.4;
          f.vy = Math.random() * 2.5;
          f.from = { x: f.wx, y: f.wy };
        }
        bubbles.push(f.wx, f.wy, 0, 1, f.look);
      } else if (f.caught) {
        // A special that fell is drawn back to the launcher along an arc.
        const k = Math.min(1, (t - f.at) / 0.6);
        const e = k * k * (3 - 2 * k);
        f.wx = f.from.x + (ACTIVE.x - f.from.x) * e;
        f.wy = f.from.y + (ACTIVE.y - f.from.y) * e + Math.sin(e * Math.PI) * 1.6;
        fx.spark(f.wx, f.wy, 0.3, 0, 0, 0, colorOf(-1), 0.35, 0.13);
        if (k >= 1) {
          f.onDone?.(f.wx, f.wy);
          this.falling.splice(i, 1);
        } else bubbles.push(f.wx, f.wy, 0.2, 1 - 0.2 * e, f.look);
      } else {
        f.vy -= GRAVITY * dt;
        f.wx += f.vx * dt;
        f.wy += f.vy * dt;
        if (f.wy < WATER_Y + 0.35) {
          fx.splash(f.wx, WATER_Y + 0.02, popColor(f.look));
          f.onDone?.(f.wx, WATER_Y);
          this.falling.splice(i, 1);
        } else bubbles.push(f.wx, f.wy, 0, 1, f.look);
      }
    }

    const fl = this.flying;
    if (fl) {
      const k = fl.duration > 0 ? Math.min(1, (t - fl.t0) / fl.duration) : 1;
      let walk = k * fl.total;
      let i = 0;
      while (i < fl.lens.length - 1 && walk > fl.lens[i]) walk -= fl.lens[i++];
      const u = fl.lens[i] > 0 ? Math.min(1, walk / fl.lens[i]) : 1;
      const x = fl.world[i * 2] + (fl.world[i * 2 + 2] - fl.world[i * 2]) * u;
      const y = fl.world[i * 2 + 1] + (fl.world[i * 2 + 3] - fl.world[i * 2 + 1]) * u;
      const color = colorOf(fl.look.k === KIND.COLOR ? fl.look.c : -1);
      fx.spark(x, y, 0.1, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 0, color, 0.28, 0.12, 0.9);
      if (fl.piercing && fl.last) fx.beam(fl.last.x, fl.last.y, x, y, color, { width: 0.5, life: 0.35, travel: 0 });
      fl.last = { x, y };
      // Still drawn on its last frame, so there is no gap before the board takes it over.
      bubbles.push(x, y, 0.05, 1, fl.look);
      if (k >= 1) {
        this.flying = null;
        fl.onDone?.(x, y);
      }
    }

    const settle = 1 - Math.exp(-dt * 16);
    this.slots.forEach((slot, i) => {
      const goal = i === 0 ? ACTIVE : NEXT;
      slot.x += (goal.x - slot.x) * settle;
      slot.y += (goal.y - slot.y) * settle;
      slot.s += (goal.s - slot.s) * settle;
      if (slot.look && slot.s > 0.02) bubbles.push(slot.x, slot.y + this.stage.launcher.position.y - LAUNCH_WORLD_Y, 0, slot.s, slot.look);
    });

    bubbles.end();
    bubbles.material.uniforms.uTime.value = t;
    bubbles.material.uniforms.uTopY.value = topY;
    this.env.update(t);
    fx.update(t, this.frameRect.unit * this.renderer.getPixelRatio());
    this.stage.setFade(flight ? pose.w * pose.w : 1);
    this.stage.update(t, this.frameRect.unit * this.renderer.getPixelRatio());
    this.#render();
    if (flight) this.#flightStep(t - dt, t);
  }

  // The playing camera: the screen is a window onto the plane the board lies in. Moving the eye
  // behind that window shifts the lake and the lanterns against the board, which stays put on
  // screen. The window is kept as its edges at unit distance from the eye. In flight the camera
  // follows the fly-over instead, which starts and ends on this one.
  #camera(t) {
    const f = this.frameRect;
    const sway = this.reducedMotion ? 0 : 1;
    const ex = (Math.sin(t * 0.23) * 0.5 + this.pointerX * 0.6) * sway;
    const ey = EYE_Y + Math.sin(t * 0.31) * 0.16 * sway;
    const live = this.live;
    const k = 1 / CAM_DIST;
    live.eye.set(ex, ey, CAM_DIST);
    live.center.set((f.left + f.right) / 2, (f.top + f.bottom) / 2, 0);
    Object.assign(live.frustum, { left: (f.left - ex) * k, right: (f.right - ex) * k, top: (f.top - ey) * k, bottom: (f.bottom - ey) * k });
    const pose = this.flight ? this.flight.sample(t, live) : this.rest;
    poseCamera(this.camera, pose, live);
    return pose;
  }

  #render() {
    const r = this.renderer;
    r.info.reset();
    const every = this.quality.tier.cubeEvery;
    if (every && this.tick++ % every === 0) this.env.captureFace(r);
    r.setRenderTarget(null);
    if (this.post) return this.post.render();
    r.clear();
    r.render(this.env.scene, this.camera);
    r.render(this.scene, this.camera);
  }

  get stats() {
    const q = this.quality;
    return { fps: q.fps, tier: q.tier.name, scale: q.scale, pixelRatio: this.renderer.getPixelRatio(), calls: this.renderer.info.render.calls };
  }
}
