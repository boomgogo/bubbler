// Glow around the brightest things on screen: lit cores, lanterns, the horizon.
// Only the high tier uses it, so it is loaded on demand and never on the critical path.
import { Vector2, WebGLRenderTarget, HalfFloatType } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createBloom(renderer, backScene, frontScene, camera) {
  const size = renderer.getDrawingBufferSize(new Vector2());
  // Half-float keeps values above 1, which is what tells a lantern from a white wall.
  const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const front = new RenderPass(frontScene, camera);
  front.clear = false; // drawn over the lake, as in the plain path
  composer.addPass(new RenderPass(backScene, camera));
  composer.addPass(front);
  composer.addPass(new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.2, 0.45, 1.25));
  composer.addPass(new OutputPass()); // tone mapping and sRGB, which the materials skip off-screen
  return {
    render: () => composer.render(),
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
    },
    dispose: () => composer.dispose(),
  };
}
