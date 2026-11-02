import * as THREE from "three";
import { GLYPH_RAMP, makeGlyphAtlas } from "./textures";

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tGlyphs;
uniform vec2 uRes;
uniform vec2 uCell;
uniform float uTime;
uniform float uGlyphs;

float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}

float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

void main() {
  vec2 pix = gl_FragCoord.xy;
  vec2 cellId = floor(pix / uCell);
  vec2 inCell = fract(pix / uCell);

  vec2 sampleUv = (cellId + 0.5) * uCell / uRes;

  // VHS wobble + occasional tracking band drift
  float wob = sin(sampleUv.y * 140.0 + uTime * 2.3) * 0.0011;
  float band = smoothstep(0.92, 1.0, sin(uTime * 0.6 + sampleUv.y * 5.0) * 0.5 + 0.5);
  float bandShift = band * (fract(sin(uTime * 11.0) * 4375.0) - 0.5) * 0.02;
  sampleUv.x += wob + bandShift;

  vec3 scene = texture2D(tScene, clamp(sampleUv, vec2(0.001), vec2(0.999))).rgb;

  // chromatic bleed
  vec3 shifted;
  shifted.r = texture2D(tScene, clamp(sampleUv + vec2(0.0022, 0.0), vec2(0.001), vec2(0.999))).r;
  shifted.g = scene.g;
  shifted.b = texture2D(tScene, clamp(sampleUv - vec2(0.0022, 0.0), vec2(0.001), vec2(0.999))).b;
  scene = mix(scene, shifted, 0.5);
  scene = pow(scene, vec3(0.4545)); // render target holds linear values

  float lum = dot(scene, vec3(0.299, 0.587, 0.114));
  float level = clamp((lum - 0.1) * 2.1, 0.0, 1.0);
  level = pow(level, 1.1);

  float dith = (bayer4(cellId) - 0.47) * 0.1;
  level = clamp(level + dith, 0.0, 1.0);
  float idx = floor(level * (uGlyphs - 1.0) + 0.5);

  vec2 gUv = vec2(
    (idx + clamp(inCell.x, 0.04, 0.96)) / uGlyphs,
    clamp(1.0 - inCell.y, 0.04, 0.96)
  );
  float glyph = texture2D(tGlyphs, gUv).r;

  vec3 tint = vec3(0.86, 1.04, 0.96);
  vec3 col = scene * glyph * 2.2;
  col = mix(col, vec3(level) * tint, 0.72);
  col += vec3(0.02, 0.03, 0.024) * glyph;

  float scan = 0.8 + 0.2 * abs(sin(pix.y * 3.14159 / max(2.0, uCell.y * 0.5)));
  col *= scan;

  float noise = fract(sin(dot(pix + vec2(uTime * 57.0, uTime * 31.0), vec2(12.9898, 78.233))) * 43758.5453);
  col += (noise - 0.5) * 0.028 * (1.0 - level * 0.6);

  vec2 q = pix / uRes;
  float vig = 1.0 - 0.9 * pow(length((q - 0.5) * vec2(1.0, 0.92)) * 1.3, 2.0);
  col *= clamp(vig, 0.0, 1.0);

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Post {
  private target: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private cellW = 10;
  private cellH = 16;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private lowResW = 384,
    private lowResH = 216,
  ) {
    this.target = new THREE.WebGLRenderTarget(lowResW, lowResH, {
      magFilter: THREE.NearestFilter,
      minFilter: THREE.NearestFilter,
      depthBuffer: true,
    });

    const glyphs = makeGlyphAtlas(32);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        tGlyphs: { value: glyphs },
        uRes: { value: new THREE.Vector2(1, 1) },
        uCell: { value: new THREE.Vector2(this.cellW, this.cellH) },
        uTime: { value: 0 },
        uGlyphs: { value: GLYPH_RAMP.length },
      },
    });

    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  }

  resize(width: number, height: number, dpr: number) {
    // keep roughly 120-170 character columns regardless of window size
    const cols = Math.min(200, Math.max(96, Math.round(width / 11)));
    this.cellW = (width * dpr) / cols;
    this.cellH = this.cellW * 1.55;

    this.material.uniforms.uRes.value.set(width * dpr, height * dpr);
    this.material.uniforms.uCell.value.set(this.cellW, this.cellH);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number) {
    this.material.uniforms.uTime.value = time;

    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
