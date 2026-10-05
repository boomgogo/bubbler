// The fixtures around the board: launcher ring, aim line, landing marker, walls and fail line.
import {
  Group, Mesh, Points, TorusGeometry, ConeGeometry, PlaneGeometry, RingGeometry, BufferGeometry,
  BufferAttribute, ShaderMaterial, AdditiveBlending, DoubleSide, DynamicDrawUsage, Color,
} from 'three';
import { FIELD_W, FIELD_H, TOP_Y, LAUNCH_WORLD_Y, FAIL_WORLD_Y, WATER_Y } from './layout.js';

const OUT = '#include <tonemapping_fragment>\n#include <colorspace_fragment>';
const MAX_DOTS = 90;
const DOT_GAP = 0.62;

// A flat additive strip: used for the fail line (dashed), the walls and the launcher's glow on the water.
function glowMaterial(shape) {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color(1, 1, 1) }, uGain: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uGain;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float a = ${shape};
        gl_FragColor = vec4(uColor * a * uGain, 1.0);
        ${OUT}
      }`,
  });
}

export class Stage {
  constructor(environment) {
    this.group = new Group();
    this.path = null; // world-space polyline of the aim line
    this.pathLen = 0;
    this.fade = 1; // the glowing strips skip the depth test, so they bow out while the camera roams

    // Launcher: two brass rings around the loaded bubble, the outer one turning slowly.
    this.brass = new ShaderMaterial({
      uniforms: { uEnv: { value: environment.texture } },
      vertexShader: /* glsl */ `
        varying vec3 vN;
        varying vec3 vWorld;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform samplerCube uEnv;
        varying vec3 vN;
        varying vec3 vWorld;
        void main() {
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 sky = textureCube(uEnv, reflect(-V, N), 1.0).rgb;
          float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
          gl_FragColor = vec4(sky * vec3(1.0, 0.78, 0.5) * 1.8 + vec3(0.16, 0.105, 0.045) + rim * vec3(0.5, 0.36, 0.2), 1.0);
          ${OUT}
        }`,
    });
    this.launcher = new Group();
    this.launcher.position.set(0, LAUNCH_WORLD_Y, 0);
    this.launcher.add(new Mesh(new TorusGeometry(0.98, 0.05, 8, 56), this.brass));
    this.gimbal = new Mesh(new TorusGeometry(1.2, 0.028, 6, 56), this.brass);
    this.gimbal.rotation.x = 1.2;
    this.launcher.add(this.gimbal);
    this.pointer = new Group();
    const tip = new Mesh(new ConeGeometry(0.11, 0.3, 4), this.brass);
    tip.position.y = 1.32;
    this.pointer.add(tip);
    this.launcher.add(this.pointer);
    this.group.add(this.launcher);

    // The loaded bubble lights the water beneath it.
    this.pool = new Mesh(new PlaneGeometry(7, 7), glowMaterial('exp(-dot(vUv - 0.5, vUv - 0.5) * 22.0)'));
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.set(0, WATER_Y + 0.02, 0);
    this.pool.material.uniforms.uGain.value = 0.22;
    this.group.add(this.pool);

    // Fail line and side walls.
    this.failLine = new Mesh(
      new PlaneGeometry(FIELD_W, 0.07),
      glowMaterial(`step(0.45, fract(vUv.x * ${(FIELD_W * 0.75).toFixed(2)} - uTime * 0.25)) * (1.0 - abs(vUv.y - 0.5) * 2.0)`),
    );
    this.failLine.position.set(0, FAIL_WORLD_Y, 0);
    this.failLine.material.uniforms.uColor.value.set('#ff5a3c');
    this.group.add(this.failLine);
    const wallMaterial = (this.wallMaterial = glowMaterial('smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.75, vUv.y) * (1.0 - abs(vUv.x - 0.5) * 2.0)'));
    wallMaterial.uniforms.uColor.value.set('#6fa8ff');
    wallMaterial.uniforms.uGain.value = 0.22;
    for (const side of [-1, 1]) {
      const wall = new Mesh(new PlaneGeometry(0.05, FIELD_H - 2), wallMaterial);
      wall.position.set((side * FIELD_W) / 2, TOP_Y - (FIELD_H - 2) / 2, 0);
      this.group.add(wall);
    }

    // Aim line: a row of dots marching along the shot's path.
    this.dotPositions = new Float32Array(MAX_DOTS * 3);
    this.dotAlpha = new Float32Array(MAX_DOTS);
    const dots = new BufferGeometry();
    dots.setAttribute('position', new BufferAttribute(this.dotPositions, 3).setUsage(DynamicDrawUsage));
    dots.setAttribute('aAlpha', new BufferAttribute(this.dotAlpha, 1).setUsage(DynamicDrawUsage));
    this.dotMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      uniforms: { uColor: { value: new Color(1, 1, 1) }, uUnit: { value: 40 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        uniform float uUnit;
        varying float vA;
        void main() {
          vA = aAlpha;
          gl_PointSize = uUnit * 0.2 * (0.6 + 0.4 * aAlpha);
          gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4((uColor + 0.25) * smoothstep(0.5, 0.2, d) * vA, 1.0);
          ${OUT}
        }`,
    });
    this.dots = new Points(dots, this.dotMaterial);
    this.dots.frustumCulled = false;
    this.group.add(this.dots);

    // Where the shot will settle.
    this.ghost = new Mesh(new RingGeometry(0.39, 0.47, 40), glowMaterial('1.0'));
    this.ghost.visible = false;
    this.group.add(this.ghost);
  }

  setEnv(texture) {
    this.brass.uniforms.uEnv.value = texture;
  }

  // points: flat [x, y, ...] in world space, or null to hide the line. ghost: [x, y] or null.
  setAim(points, color, ghost, angle) {
    this.path = points;
    this.ghost.visible = !!(points && ghost);
    if (!points) return;
    this.pathLen = 0;
    for (let i = 2; i < points.length; i += 2) {
      this.pathLen += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
    }
    this.dotMaterial.uniforms.uColor.value.copy(color);
    this.ghost.material.uniforms.uColor.value.copy(color);
    if (ghost) this.ghost.position.set(ghost[0], ghost[1], 0.02);
    this.pointer.rotation.z = angle - Math.PI / 2;
  }

  setColor(color) {
    this.pool.material.uniforms.uColor.value.copy(color);
  }

  // 0 when the board is far from the fail line, 1 when it is about to cross.
  setDanger(level) {
    this.danger = level;
  }

  // 1 in play, 0 hides the walls, the fail line and the launcher's light on the water.
  setFade(fade) {
    this.fade = fade;
  }

  update(time, unit) {
    this.gimbal.rotation.z = time * 0.4;
    this.gimbal.rotation.x = 1.2 + Math.sin(time * 0.7) * 0.12;
    this.launcher.position.y = LAUNCH_WORLD_Y + Math.sin(time * 1.3) * 0.035;
    const fail = this.failLine.material.uniforms;
    fail.uTime.value = time;
    fail.uGain.value = (0.1 + (this.danger ?? 0) * (0.8 + 0.4 * Math.sin(time * 6))) * this.fade;
    this.wallMaterial.uniforms.uGain.value = 0.22 * this.fade;
    this.pool.material.uniforms.uGain.value = 0.22 * this.fade;
    this.ghost.material.uniforms.uGain.value = 0.55 + 0.25 * Math.sin(time * 5);
    this.dotMaterial.uniforms.uUnit.value = unit;

    // Lay the dots along the path, sliding them forward a little every frame.
    let n = 0;
    const p = this.path;
    if (p) {
      let walked = 0;
      let next = 1.45 + ((time * 1.5) % DOT_GAP);
      const end = this.pathLen - (this.ghost.visible ? 0.55 : 0);
      for (let i = 2; i < p.length && n < MAX_DOTS; i += 2) {
        const dx = p[i] - p[i - 2];
        const dy = p[i + 1] - p[i - 1];
        const seg = Math.hypot(dx, dy);
        while (next <= walked + seg && next < end && n < MAX_DOTS) {
          const t = (next - walked) / seg;
          this.dotPositions.set([p[i - 2] + dx * t, p[i - 1] + dy * t, 0.02], n * 3);
          this.dotAlpha[n++] = Math.max(0.25, 1 - next / 34);
          next += DOT_GAP;
        }
        walked += seg;
      }
    }
    const geometry = this.dots.geometry;
    geometry.setDrawRange(0, n);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;
  }
}
