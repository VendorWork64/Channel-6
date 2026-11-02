import * as THREE from "three";

export type RGB = [number, number, number];

export function makeNoiseTexture(
  base: RGB,
  variance = 22,
  stains = 0,
  size = 256,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * variance;
    img.data[i * 4 + 0] = clampByte(base[0] + n);
    img.data[i * 4 + 1] = clampByte(base[1] + n);
    img.data[i * 4 + 2] = clampByte(base[2] + n);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  for (let s = 0; s < stains; s++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 4 + Math.random() * size * 0.28;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(10, 12, 10, 0.38)");
    g.addColorStop(1, "rgba(10, 12, 10, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 8;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const GLYPH_RAMP = " .,:;-=+*#%@";

export function makeGlyphAtlas(cell = 32): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = cell * GLYPH_RAMP.length;
  canvas.height = cell;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#fff";
  ctx.font = `${Math.floor(cell * 0.94)}px Menlo, "Courier New", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < GLYPH_RAMP.length; i++) {
    ctx.fillText(GLYPH_RAMP[i], i * cell + cell / 2, cell * 0.56);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function makeStaticCanvas(w = 64, h = 48): {
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  redraw: () => void;
} {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const redraw = () => {
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = Math.random() * 255;
      img.data[i * 4 + 0] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  };
  redraw();

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  return {
    canvas,
    texture,
    redraw: () => {
      redraw();
      texture.needsUpdate = true;
    },
  };
}

export function makeGlowTexture(size = 64): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.25, "rgba(255,255,255,0.55)");
  g.addColorStop(0.6, "rgba(255,255,255,0.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
