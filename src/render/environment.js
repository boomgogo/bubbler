// The world behind the board, and the cube map of it that the bubbles reflect.
// The world itself is a place (see places/): this holds whichever one is showing, in a scene
// that never changes, and shoots the cube map from it. The cube map's texture is the same
// object whatever the place, so bubbles, brass and shards follow a change of place untouched.
// The world surrounds the board on all sides, because the front of a glass ball reflects what
// is behind the viewer.
import {
  Scene, CubeCamera, WebGLCubeRenderTarget, HalfFloatType, UnsignedByteType, LinearMipmapLinearFilter,
  LinearFilter,
} from 'three';

export class Environment {
  constructor(place) {
    this.scene = new Scene();
    // Uniforms every place shares: the clock, the lantern flare after a big clear, and the
    // size of a point in pixels.
    this.time = { value: 0 };
    this.glow = { value: 1 };
    this.pointScale = { value: 1 };
    this.face = 0;
    this.target = null;
    this.cubeCamera = null;
    this.place = null;
    this.group = null;
    this.setPlace(place);
  }

  // A place's scene, built but not yet showing.
  build(place) {
    return place.build({ time: this.time, glow: this.glow, pointScale: this.pointScale });
  }

  // Shows a place, freeing the last one. With a renderer the cube map is reshot at once.
  setPlace(place, group = this.build(place), renderer = null) {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    this.place = place;
    this.group = group;
    this.scene.add(group);
    if (renderer && this.target) this.capture(renderer);
  }

  // (Re)creates the cube map the bubbles reflect. HDR keeps lanterns and the moon bright in
  // reflections; where the GPU cannot render to half floats the bubble shader fakes it.
  setTier(renderer, tier) {
    const gl = renderer.getContext();
    const hdr = tier.hdr && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.target?.dispose();
    this.target = new WebGLCubeRenderTarget(tier.cube, {
      type: hdr ? HalfFloatType : UnsignedByteType,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
    });
    this.hdr = hdr;
    this.cubeCamera = new CubeCamera(1, 1500, this.target);
    this.cubeCamera.position.set(0, 0.5, 0);
    this.cubeCamera.coordinateSystem = renderer.coordinateSystem;
    this.cubeCamera.updateCoordinateSystem();
    this.cubeCamera.updateMatrixWorld();
    this.capture(renderer);
  }

  get texture() {
    return this.target.texture;
  }

  update(time) {
    this.time.value = time;
  }

  // Renders one face of the cube map; six calls make a full refresh.
  captureFace(renderer) {
    const face = this.face;
    this.face = (face + 1) % 6;
    const texture = this.target.texture;
    const previous = renderer.getRenderTarget();
    const pointScale = this.pointScale.value;
    this.pointScale.value = 1;
    texture.generateMipmaps = face === 5; // build the blurred levels once per round
    renderer.setRenderTarget(this.target, face);
    renderer.clear();
    renderer.render(this.scene, this.cubeCamera.children[face]);
    texture.generateMipmaps = true;
    this.pointScale.value = pointScale;
    renderer.setRenderTarget(previous);
  }

  capture(renderer) {
    this.face = 0;
    for (let i = 0; i < 6; i++) this.captureFace(renderer);
  }
}
