// Every bubble on screen is one instance of a single sphere: one draw call (two during close-ups).
// The shader fakes solid glass with a lit core. Per pixel it looks up the lake's cube map twice,
// once for the reflection and once for the view through the ball, and tests the reflection ray
// against the six neighbouring bubbles so they show up in each other.
import {
  Mesh, SphereGeometry, InstancedBufferGeometry, InstancedBufferAttribute, ShaderMaterial, Color, Vector3,
  DynamicDrawUsage,
} from 'three';
import { KIND } from '../config.js';

export const CAPACITY = 512; // a whole column is on screen during the fly-over
const HERO_CAPACITY = 24;
const HERO_RANGE = 4.5;
export const RADIUS = 0.485; // drawn slightly under half a cell so neighbours do not quite touch

// Cyan, amber, violet, coral, mint.
export const PALETTE = ['#16c8ff', '#ffab1a', '#a257ff', '#ff4468', '#35f09a'];
const COLORLESS = 5; // palette slot for a special shot, which has no colour of its own

// What a bubble shows of its neighbours: 0 nothing, 1-5 a colour, 6 Obsidian, 7 Mist, 8 Nova.
export function reflectCode(b) {
  if (b === null) return 0;
  if (b.m) return 7;
  if (b.k === KIND.OBSIDIAN) return 6;
  if (b.k === KIND.NOVA) return 8;
  return b.c + 1;
}

const vertexShader = /* glsl */ `
attribute vec4 aPosScale; // world centre, radius scale
attribute vec4 aLook;     // colour index, kind, mist 0..1, per-bubble random
attribute vec3 aNbrA;     // neighbour codes: E, W, NE
attribute vec3 aNbrB;     // NW, SE, SW
attribute float aFlash;
uniform float uTopY;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vCenter;
varying vec4 vLook;
varying vec3 vNbrA;
varying vec3 vNbrB;
varying float vFlash;
void main() {
  vec3 center = aPosScale.xyz;
  // Rows scrolling in from above grow out of nothing at the top edge of the field. The row
  // just past the edge stays as a row of specks: a hint that the level goes on.
  float fade = 1.0 - smoothstep(uTopY - 0.2, uTopY + 0.55, center.y) * 0.88;
  fade *= 1.0 - smoothstep(uTopY + 0.6, uTopY + 1.3, center.y);
  vec3 world = center + position * (aPosScale.w * ${RADIUS} * fade);
  vN = position;
  vWorld = world;
  vCenter = center;
  vLook = aLook;
  vNbrA = aNbrA;
  vNbrB = aNbrB;
  vFlash = aFlash;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform samplerCube uEnv;
uniform vec3 uEnvPos;
uniform float uEnvRadius;
uniform vec3 uPalette[6];
uniform float uTime;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vCenter;
varying vec4 vLook;
varying vec3 vNbrA;
varying vec3 vNbrB;
varying float vFlash;

// The cube map was shot from one point. Bending the lookup by where this bubble sits makes
// neighbours reflect slightly different views, as they would in a real scene.
vec3 env(vec3 dir, vec3 from, float blur) {
  vec3 c = textureCube(uEnv, normalize(dir * uEnvRadius + (from - uEnvPos)), blur).rgb;
  #ifndef HDR_ENV
  // An 8-bit map clips the lanterns and the moon; push the brightest texels back up.
  c *= 1.0 + 3.0 * smoothstep(0.7, 1.0, max(c.r, max(c.g, c.b)));
  #endif
  return c;
}

// Each colour has its own shape at the core, so colour is never the only cue.
float glyph(vec2 p, int ci) {
  float r = length(p);
  if (ci == 0 || ci == 5) return 1.0 - smoothstep(0.34, 0.38, r);
  if (ci == 1) {
    float seg = 2.0943951;
    float a = mod(atan(p.y, p.x) + 1.5707963 + seg * 0.5, seg) - seg * 0.5;
    return 1.0 - smoothstep(0.21, 0.25, r * cos(a));
  }
  if (ci == 2) return 1.0 - smoothstep(0.40, 0.44, abs(p.x) + abs(p.y));
  if (ci == 3) return 1.0 - smoothstep(0.075, 0.115, abs(r - 0.31));
  vec2 q = abs(p);
  return (1.0 - smoothstep(0.09, 0.13, min(q.x, q.y))) * (1.0 - smoothstep(0.38, 0.42, max(q.x, q.y)));
}

vec3 neighbourColor(float code) {
  int i = int(code + 0.5);
  if (i <= 5) return uPalette[i - 1];
  if (i == 6) return vec3(0.01);
  if (i == 7) return vec3(0.42, 0.48, 0.55);
  return vec3(1.0);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float kind = vLook.y;
  float mist = vLook.z;
  float seed = vLook.w;
  int ci = int(vLook.x + 0.5);
  vec3 base = uPalette[ci];
  bool comet = kind > 0.5 && kind < 1.5;
  bool nova = kind > 1.5 && kind < 2.5;
  bool obsidian = kind > 2.5;

  float NdV = clamp(dot(N, V), 0.0, 1.0);
  vec3 R = reflect(-V, N);
  float f0 = obsidian ? 0.3 : 0.045;
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - NdV, 5.0);
  vec3 refl = env(R, vWorld, mist * 4.5);

  #ifdef NEIGHBORS
  {
    // Neighbours sit one diameter away in six known directions, so the reflection ray can be
    // tested against them exactly. The nearest hit replaces the sky in the reflection.
    vec3 o = N * 0.5;
    float tBest = 1e9;
    float code = 0.0;
    vec3 hit = vec3(0.0);
    #define TEST(dir, cd) if (cd > 0.5) { vec3 oc = o - dir; float b = dot(oc, R); float disc = b * b - dot(oc, oc) + 0.25; if (disc > 0.0 && b < 0.0) { float t = -b - sqrt(disc); if (t < tBest) { tBest = t; code = cd; hit = dir; } } }
    TEST(vec3(1.0, 0.0, 0.0), vNbrA.x)
    TEST(vec3(-1.0, 0.0, 0.0), vNbrA.y)
    TEST(vec3(0.5, 0.8660254, 0.0), vNbrA.z)
    TEST(vec3(-0.5, 0.8660254, 0.0), vNbrB.x)
    TEST(vec3(0.5, -0.8660254, 0.0), vNbrB.y)
    TEST(vec3(-0.5, -0.8660254, 0.0), vNbrB.z)
    if (code > 0.5) {
      vec3 hn = normalize(o + R * tBest - hit);
      float facing = max(dot(hn, -R), 0.0);
      vec3 second = env(reflect(R, hn), vWorld, 1.5);
      refl = mix(neighbourColor(code) * (0.1 + 0.9 * facing * facing), second, 0.05 + 0.95 * pow(1.0 - facing, 5.0));
    }
  }
  #endif

  // A thin oily sheen towards the rim.
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (NdV * 1.5 + seed + vec3(0.0, 0.33, 0.67)));
  refl *= mix(vec3(1.0), film * 1.6, 0.22 * (1.0 - NdV) * (1.0 - mist));

  // Disc coordinates as the viewer sees the ball, so the core stays centred off-axis.
  vec3 toEye = normalize(cameraPosition - vCenter);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toEye));
  vec2 p = vec2(dot(N, right), dot(N, cross(toEye, right)));
  float r = length(p);

  vec3 col;
  if (obsidian) {
    // Black volcanic glass: nothing shows through, it only mirrors the lake.
    col = vec3(0.004, 0.004, 0.01) + vec3(0.07, 0.03, 0.12) * pow(1.0 - NdV, 1.5);
    refl *= 1.7;
  } else {
    // Looking through solid glass: the ray bends in, crosses the ball and bends out,
    // which turns the far shore upside down.
    vec3 t1 = refract(-V, N, 1.0 / 1.45);
    vec3 exit = N + t1 * (2.0 * dot(-t1, N));
    vec3 t2 = refract(t1, -exit, 1.45);
    if (dot(t2, t2) < 0.5) t2 = reflect(t1, -exit);
    vec3 through = env(t2, vCenter, 0.5 + mist * 4.0);
    vec3 glass = nova ? vec3(0.8, 0.85, 1.0) : mix(vec3(1.0), base, 0.6);
    float halo = smoothstep(0.95, 0.15, r);
    vec3 core;
    if (nova) {
      float rings = 0.5 + 0.5 * sin(r * 22.0 - uTime * 7.0);
      float spokes = pow(abs(cos(atan(p.y, p.x) * 4.0 + uTime * 1.5)), 6.0);
      core = vec3(1.0, 0.95, 0.9) * (smoothstep(0.75, 0.0, r) * (0.5 + 0.9 * rings) + spokes * smoothstep(0.8, 0.2, r) * 0.8 + smoothstep(0.22, 0.0, r) * 3.0);
    } else {
      float g = glyph(p, ci);
      core = base * (halo * halo * 0.75 + g * 1.5) + vec3(g * smoothstep(0.34, 0.0, r) * 0.45);
      if (comet) {
        float orbit = smoothstep(0.09, 0.0, abs(r - 0.62)) * pow(0.5 + 0.5 * sin(atan(p.y, p.x) * 2.0 - uTime * 6.0), 3.0);
        core += (vec3(1.0) + base) * orbit * 2.2 + base * 0.35;
      }
    }
    col = through * glass * 0.9 * (1.0 - 0.8 * halo) + core;
  }

  // Mist frosts the glass and hides whatever is inside: a pale ball lit softly by the moon
  // from above and the afterglow from below, with vapour drifting across it.
  if (mist > 0.001) {
    float moon = 0.5 + 0.5 * dot(N, vec3(-0.42, 0.6, 0.68));
    float ember = max(-N.y, 0.0);
    float drift = sin(p.x * 4.0 + uTime * 0.5 + seed * 20.0 + sin(p.y * 3.0 - uTime * 0.35) * 1.8);
    vec3 frosted = mix(vec3(0.10, 0.13, 0.22), vec3(0.62, 0.72, 0.90), moon * moon)
      + vec3(0.55, 0.22, 0.08) * ember * ember * 0.55
      + vec3(0.10, 0.12, 0.16) * drift * (1.0 - r * r)
      + vec3(0.45, 0.55, 0.75) * pow(1.0 - NdV, 2.5) * 0.6;
    col = mix(col, frosted, mist);
  }

  col = mix(col, refl, fresnel) + refl * 0.03 + vec3(vFlash);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// One instanced draw of the bubble sphere: the per-instance arrays and the mesh that draws them.
class Batch {
  constructor(capacity, material) {
    this.capacity = capacity;
    this.count = 0;
    this.posScale = new Float32Array(capacity * 4);
    this.look = new Float32Array(capacity * 4);
    this.nbrA = new Float32Array(capacity * 3);
    this.nbrB = new Float32Array(capacity * 3);
    this.flash = new Float32Array(capacity);
    this.attributes = [
      ['aPosScale', this.posScale, 4],
      ['aLook', this.look, 4],
      ['aNbrA', this.nbrA, 3],
      ['aNbrB', this.nbrB, 3],
      ['aFlash', this.flash, 1],
    ].map(([name, array, size]) => {
      const attribute = new InstancedBufferAttribute(array, size);
      attribute.setUsage(DynamicDrawUsage);
      return [name, attribute];
    });
    this.mesh = new Mesh(undefined, material);
    this.mesh.frustumCulled = false;
  }

  setSphere(widthSegments, heightSegments) {
    const sphere = new SphereGeometry(1, widthSegments, heightSegments);
    const geometry = new InstancedBufferGeometry();
    geometry.index = sphere.index;
    geometry.setAttribute('position', sphere.attributes.position);
    for (const [name, attribute] of this.attributes) geometry.setAttribute(name, attribute);
    this.mesh.geometry?.dispose();
    this.mesh.geometry = geometry;
  }

  push(x, y, z, scale, look, nbr, flash) {
    const i = this.count++;
    this.posScale.set([x, y, z, scale], i * 4);
    this.look.set([look.c < 0 ? COLORLESS : look.c, look.k, look.m, look.seed], i * 4);
    if (nbr) {
      this.nbrA.set([nbr[0], nbr[1], nbr[2]], i * 3);
      this.nbrB.set([nbr[3], nbr[4], nbr[5]], i * 3);
    } else {
      this.nbrA.fill(0, i * 3, i * 3 + 3);
      this.nbrB.fill(0, i * 3, i * 3 + 3);
    }
    this.flash[i] = flash;
  }

  end() {
    this.mesh.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
    for (const [, attribute] of this.attributes) attribute.needsUpdate = true;
  }
}

export class Bubbles {
  constructor(tier, environment) {
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uEnv: { value: null },
        uEnvPos: { value: new Vector3(0, 0.5, 0) },
        uEnvRadius: { value: 30 },
        uPalette: { value: [...PALETTE, '#dfe9ff'].map((hex) => new Color(hex)) },
        uTime: { value: 0 },
        uTopY: { value: 0 },
      },
    });
    this.main = new Batch(CAPACITY, this.material);
    // Close to the camera, as in the fly-over's close-ups, a bubble is drawn with a finely
    // divided sphere so its outline stays round on every tier.
    this.hero = new Batch(HERO_CAPACITY, this.material);
    this.hero.setSphere(48, 32);
    this.meshes = [this.main.mesh, this.hero.mesh];
    this.heroEye = null; // the camera position while close-ups are possible, else null
    this.setTier(tier, environment);
  }

  setTier(tier, environment) {
    this.main.setSphere(tier.segs[0], tier.segs[1]);
    this.material.defines = {};
    if (tier.neighbors) this.material.defines.NEIGHBORS = '';
    if (environment.hdr) this.material.defines.HDR_ENV = '';
    this.material.uniforms.uEnv.value = environment.texture;
    this.material.uniforms.uEnvPos.value.copy(environment.cubeCamera.position);
    this.material.needsUpdate = true;
  }

  begin() {
    this.main.count = this.hero.count = 0;
  }

  // look: { c, k, m, seed }; nbr: six neighbour codes or null.
  push(x, y, z, scale, look, nbr = null, flash = 0) {
    const e = this.heroEye;
    const near = e && (x - e.x) ** 2 + (y - e.y) ** 2 + (z - e.z) ** 2 < HERO_RANGE ** 2;
    const batch = near && this.hero.count < this.hero.capacity ? this.hero : this.main;
    if (batch.count < batch.capacity) batch.push(x, y, z, scale, look, nbr, flash);
  }

  end() {
    this.main.end();
    this.hero.end();
  }
}
