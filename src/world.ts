import * as THREE from "three";
import { makeGlowTexture, makeNoiseTexture, makeStaticCanvas } from "./textures";

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
}

export interface World {
  scene: THREE.Scene;
  colliders: Collider[];
  update: (time: number, dt: number) => void;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  groundHeightAt: (x: number, z: number, refY?: number) => number;
}

const H = 3.2;
const ARCHIVE_Y = -3;

export function buildWorld(): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030507);
  scene.fog = new THREE.Fog(0x05080b, 3.0, 22);

  const colliders: Collider[] = [];

  const wallTex = makeNoiseTexture([132, 138, 136], 18, 14);
  wallTex.repeat.set(4, 1.4);
  const floorTex = makeNoiseTexture([118, 120, 114], 26, 26);
  floorTex.repeat.set(8, 5);
  const ceilTex = makeNoiseTexture([96, 100, 100], 14, 6);
  const darkFloorTex = makeNoiseTexture([66, 68, 64], 22, 22);
  darkFloorTex.repeat.set(10, 8);

  const wallMat = new THREE.MeshLambertMaterial({
    map: wallTex,
    emissive: 0x1e2523,
  });
  const floorMat = new THREE.MeshLambertMaterial({ map: floorTex, emissive: 0x12140f });
  const ceilMat = new THREE.MeshLambertMaterial({ map: ceilTex, emissive: 0x14181a });
  const darkFloorMat = new THREE.MeshLambertMaterial({
    map: darkFloorTex,
    emissive: 0x0e100e,
  });

  function addWall(
    cx: number,
    cz: number,
    w: number,
    d: number,
    y0 = 0,
    y1 = H,
    mat: THREE.Material = wallMat,
  ) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, y1 - y0, d), mat);
    m.position.set(cx, (y0 + y1) / 2, cz);
    scene.add(m);
    colliders.push({
      minX: cx - w / 2,
      maxX: cx + w / 2,
      minZ: cz - d / 2,
      maxZ: cz + d / 2,
      minY: y0,
      maxY: y1,
    });
  }

  function addBox(
    cx: number,
    cy: number,
    cz: number,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
  ) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, cy, cz);
    scene.add(m);
    return m;
  }

  function addFloor(cx: number, cz: number, w: number, d: number, y: number, mat: THREE.Material) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, y - 0.01, cz); // 1 cm below wall bases: avoids z-fighting
    scene.add(m);
  }

  function addCeiling(cx: number, cz: number, w: number, d: number, y: number) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
    m.rotation.x = Math.PI / 2;
    m.position.set(cx, y + 0.01, cz);
    scene.add(m);
  }

  function addCollider(minX: number, maxX: number, minZ: number, maxZ: number, y0?: number, y1?: number) {
    colliders.push({ minX, maxX, minZ, maxZ, minY: y0, maxY: y1 });
  }

  // ---------- CONTROL ROOM (аппаратная) ----------
  addFloor(0, 0, 16, 10, 0, floorMat);
  addCeiling(0, 0, 16, 10, H);
  addWall(0, 5.15, 16.6, 0.3); // back
  addWall(-8.15, -4.65, 0.3, 1.3); // left, north of server-room door
  addWall(-8.15, 1.4, 0.3, 7.8); // left, south of server-room door
  addWall(8.15, 0, 0.3, 10.6); // right
  // lintel over the server-room doorway: visual only, colliders ignore Y
  addBox(-8.15, (2.3 + H) / 2, -3.25, 0.3, H - 2.3, 1.5, wallMat);
  addWall(-6.08, -5.15, 4.2, 0.3); // front, left of door
  addWall(2.93, -5.15, 10.65, 0.3); // front, right of door
  // lintel: visual only — colliders are 2D in XZ, a collider here would seal the doorway
  addBox(-3.19, (2.3 + H) / 2, -5.15, 1.58, H - 2.3, 0.3, wallMat);

  const doorMat = new THREE.MeshLambertMaterial({ color: 0x2c2e2a, emissive: 0x141614 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.16, 2.28, 0.07), doorMat);
  door.position.set(-3.78, 1.14, -5.84);
  door.rotation.y = 1.3; // приоткрыта к стене коридора
  scene.add(door);

  const frameMat = new THREE.MeshLambertMaterial({ color: 0x555b54 });
  addBox(-3.96, 1.18, -5.15, 0.08, 2.36, 0.14, frameMat);
  addBox(-2.43, 1.18, -5.15, 0.08, 2.36, 0.14, frameMat);

  const signCanvas = document.createElement("canvas");
  signCanvas.width = 128;
  signCanvas.height = 32;
  const sctx = signCanvas.getContext("2d")!;
  sctx.fillStyle = "#14170f";
  sctx.fillRect(0, 0, 128, 32);
  sctx.fillStyle = "#b9c9a4";
  sctx.font = "13px Menlo, monospace";
  sctx.textAlign = "center";
  sctx.textBaseline = "middle";
  sctx.fillText("КОРИДОР Б · АРХИВ", 64, 17);
  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.magFilter = THREE.NearestFilter;
  signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.27),
    new THREE.MeshBasicMaterial({ map: signTex }),
  );
  sign.position.set(-3.2, 2.62, -5.0);
  sign.rotation.y = Math.PI;
  scene.add(sign);

  // desk + monitors
  const deskMat = new THREE.MeshLambertMaterial({ color: 0x4a463c });
  addBox(0, 0.45, 4.2, 6, 0.9, 1.3, deskMat);
  addCollider(-3, 3, 3.55, 4.85, 0, 1.6);

  const staticSignal = makeStaticCanvas(64, 48);
  const plasticMat = new THREE.MeshLambertMaterial({ color: 0x2b2d29 });
  const screenMat = new THREE.MeshBasicMaterial({ map: staticSignal.texture, color: 0xa8bdb2 });
  const screenGeo = new THREE.PlaneGeometry(0.62, 0.46);
  const bodyGeo = new THREE.BoxGeometry(0.78, 0.62, 0.6);
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 1.9;
    addBox(x, 1.22, 4.35, 0.78, 0.62, 0.6, plasticMat);
    const screen = new THREE.Mesh(screenGeo, screenMat);
    screen.position.set(x, 1.24, 4.03);
    screen.rotation.y = Math.PI;
    scene.add(screen);
    addBox(x + 0.3, 0.95, 4.02, 0.03, 0.03, 0.03, new THREE.MeshBasicMaterial({ color: 0xff3b2f }));
  }

  addBox(2.2, 0.97, 4.25, 0.9, 0.14, 0.5, new THREE.MeshLambertMaterial({ color: 0x33352f }));

  const chairMat = new THREE.MeshLambertMaterial({ color: 0x24262b });
  addBox(0, 0.5, 2.5, 0.56, 0.1, 0.56, chairMat);
  addBox(0, 0.9, 2.8, 0.56, 0.7, 0.1, chairMat);
  addBox(0, 0.25, 2.5, 0.08, 0.5, 0.08, chairMat);
  addCollider(-0.4, 0.4, 2.15, 2.9, 0, 1.3);

  // shelf with tapes, left wall
  const shelfMat = new THREE.MeshLambertMaterial({ color: 0x3a382f });
  const tapeColors = [0x1b1d18, 0x232019, 0x2a2418, 0x171a16];
  for (let row = 0; row < 3; row++) {
    addBox(-7.4, 0.6 + row * 0.62, -1.1, 1.0, 0.06, 0.42, shelfMat);
    for (let k = 0; k < 6; k++) {
      addBox(
        -7.78 + k * 0.14,
        0.76 + row * 0.62,
        -1.1,
        0.12,
        0.24,
        0.36,
        new THREE.MeshLambertMaterial({ color: tapeColors[(row + k) % tapeColors.length] }),
      );
    }
  }
  addCollider(-7.95, -6.85, -1.5, -0.7, 0, 2.6);

  // ---------- SERVER ROOM (west of the control room) ----------
  addFloor(-10.65, -3.15, 5, 4, 0, floorMat);
  addCeiling(-10.65, -3.15, 5, 4, H);
  addWall(-13.15, -3.15, 0.3, 4.3); // west
  addWall(-10.65, -5.15, 5.3, 0.3); // north
  addWall(-10.65, -1.15, 5.3, 0.3); // south

  addBox(-8.15, 1.18, -4.0, 0.3, 2.36, 0.08, frameMat);
  addBox(-8.15, 1.18, -2.5, 0.3, 2.36, 0.08, frameMat);
  const serverDoor = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.28, 1.12), doorMat);
  serverDoor.position.set(-8.55, 1.14, -3.95);
  serverDoor.rotation.y = 0.55;
  scene.add(serverDoor);

  const rackMat = new THREE.MeshLambertMaterial({ color: 0x252b2b, emissive: 0x0d1414 });
  const rackLed = new THREE.MeshBasicMaterial({ color: 0x6fd88a });
  for (const x of [-11.6, -10.6, -9.6]) {
    addBox(x, 0.7, -4.45, 0.8, 1.4, 0.6, rackMat);
    addBox(x, 1.42, -4.45, 0.82, 0.04, 0.62, rackMat);
    addBox(x + 0.24, 0.95, -4.13, 0.05, 0.05, 0.02, rackLed);
    addCollider(x - 0.4, x + 0.4, -4.75, -4.15, 0, 1.5);
  }
  for (const x of [-11.9, -10.7, -9.5]) {
    addBox(x, 0.7, -1.85, 0.8, 1.4, 0.6, rackMat);
    addBox(x, 1.42, -1.85, 0.82, 0.04, 0.62, rackMat);
    addBox(x + 0.24, 0.95, -1.53, 0.05, 0.05, 0.02, rackLed);
    addCollider(x - 0.4, x + 0.4, -2.15, -1.55, 0, 1.5);
  }

  // transmitter in the far corner
  const txMat = new THREE.MeshLambertMaterial({ color: 0x3a403d });
  addBox(-12.6, 0.55, -4.5, 0.7, 1.1, 0.5, txMat);
  addBox(-12.6, 1.9, -4.5, 0.06, 1.6, 0.06, txMat);
  addBox(-12.6, 2.72, -4.5, 0.16, 0.16, 0.16, new THREE.MeshBasicMaterial({ color: 0xff4a3a }));
  addCollider(-12.95, -12.25, -4.75, -4.25, 0, 1.2);

  // ---------- CORRIDOR A (north) ----------
  addFloor(-3, -9.15, 2.3, 8.0, 0, floorMat);
  addCeiling(-3, -9.15, 2.3, 8.0, H);
  addWall(-4.15, -12.65, 0.3, 1.0); // west, north piece
  addWall(-4.15, -7.43, 0.3, 4.85); // west, south piece
  addWall(-1.85, -9.15, 0.3, 8.3); // east
  // dead-end cap, split by the toilet doorway
  addWall(-4.45, -13.15, 1.1, 0.3);
  addWall(-1.7, -13.15, 1.4, 0.3);
  addBox(-3.15, (2.3 + H) / 2, -13.15, 1.5, H - 2.3, 0.3, wallMat); // lintel, visual only
  addBox(-3.9, 1.18, -13.15, 0.08, 2.36, 0.3, frameMat);
  addBox(-2.4, 1.18, -13.15, 0.08, 2.36, 0.3, frameMat);

  // ---------- TOILET / SHOWER (north of corridor A) ----------
  addFloor(-3, -16.15, 4, 6, 0, floorMat);
  addCeiling(-3, -16.15, 4, 6, H);
  addWall(-5, -16.15, 0.3, 6.3); // west
  addWall(-1, -16.15, 0.3, 6.3); // east
  addWall(-3, -19.15, 4.3, 0.3); // north

  const stallMat = new THREE.MeshLambertMaterial({ color: 0x4d514b });
  for (const px of [-3.5, -2.5]) {
    addBox(px, 1.1, -18.5, 0.07, 2.0, 1.3, stallMat);
    addCollider(px - 0.04, px + 0.04, -19.15, -17.85, 0, 2.1);
  }
  const bowlMat = new THREE.MeshLambertMaterial({ color: 0x9a9c92 });
  for (const px of [-4.25, -3.0, -1.75]) {
    addBox(px, 0.22, -18.85, 0.42, 0.44, 0.5, bowlMat);
  }

  const counterMat = new THREE.MeshLambertMaterial({ color: 0x565a52 });
  addBox(-4.65, 0.82, -15.2, 0.5, 0.12, 1.4, counterMat);
  addCollider(-4.95, -4.35, -15.9, -14.5, 0, 1.0);
  const basinMat = new THREE.MeshLambertMaterial({ color: 0xa8aaa0 });
  addBox(-4.6, 0.92, -15.62, 0.34, 0.08, 0.3, basinMat);
  addBox(-4.6, 0.92, -14.78, 0.34, 0.08, 0.3, basinMat);

  // shower cubicle in the south-east corner
  addBox(-1.75, 0.02, -14.1, 1.3, 0.04, 1.5, new THREE.MeshLambertMaterial({ color: 0x3a403d }));
  addBox(-2.45, 1.1, -14.35, 0.06, 2.0, 1.6, stallMat);
  addCollider(-2.48, -2.42, -15.15, -13.55, 0, 2.1);
  addBox(-1.18, 2.05, -14.3, 0.08, 0.08, 0.34, new THREE.MeshLambertMaterial({ color: 0x707870 }));
  // pipes along ceiling
  const pipeMat = new THREE.MeshLambertMaterial({ color: 0x3d423e });
  addBox(-3.7, 2.95, -9.1, 0.07, 0.07, 7.9, pipeMat);
  addBox(-2.3, 2.9, -9.1, 0.05, 0.05, 7.9, pipeMat);

  // ---------- CORRIDOR B (west) ----------
  addFloor(-9.1, -11, 10.3, 2.3, 0, floorMat);
  addCeiling(-9.1, -11, 10.3, 2.3, H);
  addWall(-9.15, -12.15, 10.3, 0.3); // north
  addWall(-9.15, -9.85, 10.3, 0.3); // south
  addWall(-14.15, -12.05, 0.3, 0.25); // west posts
  addWall(-14.15, -9.95, 0.3, 0.25);

  // ---------- STAIRWELL ----------
  addCeiling(-17, -11, 6.3, 2.6, H);
  addWall(-16.075, -12.15, 4.15, 0.3, ARCHIVE_Y, H); // north, right of the technical-stair opening
  addWall(-16.175, -9.85, 4.35, 0.3, ARCHIVE_Y, H); // south, right of basement door
  addBox(-19.175, (-0.05 + H) / 2, -9.85, 1.65, H + 0.05, 0.3, wallMat); // lintel above the archive door
  addWall(-20.15, -11, 0.3, 2.6, ARCHIVE_Y, H); // west
  // face under the top landing on the corridor side (no collider: below the floor)
  addBox(-14.05, ARCHIVE_Y / 2, -11, 0.3, -ARCHIVE_Y, 2.3, wallMat);
  addFloor(-14.33, -11, 0.75, 2.3, 0, floorMat); // top landing
  addFloor(-19.35, -11, 1.7, 2.3, ARCHIVE_Y, darkFloorMat); // bottom landing

  // steps descend westward from the top landing toward the archive door
  const stepMat = new THREE.MeshLambertMaterial({ color: 0x585c56, emissive: 0x141614 });
  for (let k = 1; k <= 4; k++) {
    const top = -0.6 * k;
    const h = top - ARCHIVE_Y;
    addBox(-14 - k, (ARCHIVE_Y + top) / 2, -11, 1.0, h, 2.0, stepMat);
  }

  // ---------- ARCHIVE (basement) ----------
  addFloor(-14.25, -5, 11.8, 10.3, ARCHIVE_Y, darkFloorMat);
  // ceiling kept below ground level: the server room stands on the floor above
  addCeiling(-14.25, -5, 11.8, 10.3, -0.05);
  addWall(-14.375, -10.15, 7.95, 0.3, ARCHIVE_Y, -0.05); // north, right of basement door
  addWall(-8.775, -10.15, 0.85, 0.3, ARCHIVE_Y, -0.05); // north, east of the vent exit
  addWall(-14.25, 0.15, 11.8, 0.3, ARCHIVE_Y, -0.05); // south
  addWall(-20.15, -10.075, 0.3, 0.15, ARCHIVE_Y, -0.05); // west jamb above the editing door
  addWall(-20.15, -4.175, 0.3, 8.65, ARCHIVE_Y, -0.05); // west, south of editing door
  addWall(-8.35, -5, 0.3, 10.3, ARCHIVE_Y, -0.05); // east

  // archive shelves along west wall
  for (let row = 0; row < 2; row++) {
    for (let seg = 0; seg < 2; seg++) {
      const z = -6.3 + seg * 4.2;
      addBox(-19.5, ARCHIVE_Y + 0.9 + row * 1.15, z, 0.7, 0.07, 3.6, shelfMat);
      for (let k = 0; k < 10; k++) {
        addBox(
          -19.5,
          ARCHIVE_Y + 1.06 + row * 1.15,
          z - 1.6 + k * 0.35,
          0.5,
          0.3,
          0.28,
          new THREE.MeshLambertMaterial({ color: tapeColors[(row + seg + k) % tapeColors.length] }),
        );
      }
    }
  }
  addCollider(-19.95, -19.1, -8.2, -0.2, ARCHIVE_Y, ARCHIVE_Y + 2.2);

  // old TV on a crate in the archive
  addBox(-10, ARCHIVE_Y + 0.35, -3, 0.9, 0.7, 0.9, new THREE.MeshLambertMaterial({ color: 0x33352c }));
  const tvBody = addBox(-10, ARCHIVE_Y + 1.0, -3, 0.9, 0.7, 0.8, plasticMat);
  tvBody.rotation.y = 0.6;
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.5), screenMat);
  tvScreen.position.set(-9.85, ARCHIVE_Y + 1.0, -2.8);
  tvScreen.rotation.y = 0.6 + Math.PI;
  scene.add(tvScreen);
  addCollider(-10.6, -9.4, -3.6, -2.4, ARCHIVE_Y, ARCHIVE_Y + 1.6);

  // scattered tapes on the archive floor
  for (let i = 0; i < 14; i++) {
    const x = -18 + Math.random() * 8;
    const z = -8.5 + Math.random() * 7.5;
    const t = addBox(
      x,
      ARCHIVE_Y + 0.035,
      z,
      0.24,
      0.07,
      0.16,
      new THREE.MeshLambertMaterial({ color: tapeColors[i % tapeColors.length] }),
    );
    t.rotation.y = Math.random() * Math.PI;
  }

  // ---------- TECHNICAL STAIR (from the lower landing, northward) ----------
  addWall(-20.15, -13.675, 0.3, 3.05, -4.5, 0.3); // west
  addWall(-18.15, -13.675, 0.3, 3.05, -4.5, 0.3); // east
  addCeiling(-19.15, -13.675, 2.0, 3.05, 0.3);
  // visual lintels so the low service shaft never opens onto black void
  addBox(-19.15, (0.3 + H) / 2, -12.15, 2.0, H - 0.3, 0.3, wallMat);
  addBox(-19.15, (-1.35 + 0.3) / 2, -15.2, 2.0, 1.65, 0.3, wallMat);
  for (let k = 1; k <= 5; k++) {
    const top = -3 - 0.25 * k;
    const zc = -12.15 - (k - 0.5) * (3.05 / 6);
    addBox(-19.15, (-4.5 + top) / 2, zc, 1.7, top + 4.5, 3.05 / 6, stepMat);
  }
  addFloor(-19.15, -14.947, 1.7, 0.508, -4.5, darkFloorMat);

  // ---------- TECHNICAL BASEMENT (-4.5 m) ----------
  addFloor(-16.2, -20.2, 8, 10, -4.5, darkFloorMat);
  addCeiling(-16.2, -20.2, 8, 10, -1.35);
  addWall(-20.2, -20.2, 0.3, 10.3, -4.5, -1.35); // west
  addWall(-12.2, -20.8, 0.3, 8.8, -4.5, -1.35); // east, south of the vent opening
  addWall(-16.2, -25.2, 8.3, 0.3, -4.5, -1.35); // north
  addWall(-15.175, -15.2, 5.95, 0.3, -4.5, -1.35); // south, right of the stair opening

  const junkMat = new THREE.MeshLambertMaterial({ color: 0x3d423c });
  const junkMat2 = new THREE.MeshLambertMaterial({ color: 0x4a4438 });
  const junk: [number, number, number, number, number][] = [
    [-18.7, -18.6, 1.5, 1.2, 1.2],
    [-15.4, -17.3, 1.0, 0.8, 1.0],
    [-13.4, -19.9, 1.4, 1.1, 1.2],
    [-18.4, -22.8, 1.8, 1.3, 1.4],
    [-13.8, -23.6, 1.2, 0.8, 1.0],
    [-17.0, -24.3, 0.9, 0.6, 0.7],
  ];
  for (const [x, z, w, h, d] of junk) {
    addBox(x, -4.5 + h / 2, z, w, h, d, (x + z) % 2 ? junkMat : junkMat2);
    addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, -4.5, -4.5 + h);
  }
  // broken studio spotlights and a mop bucket
  addBox(-16.4, -4.5 + 0.15, -20.4, 0.7, 0.3, 0.7, junkMat);
  const deadSpot = addBox(-16.3, -4.5 + 0.6, -20.5, 0.55, 0.9, 0.55, junkMat2);
  deadSpot.rotation.z = 0.5;
  addBox(-16.05, -4.5 + 0.95, -20.6, 0.24, 0.24, 0.24, new THREE.MeshBasicMaterial({ color: 0x7a8072 }));
  addCollider(-16.8, -15.9, -20.8, -20.1, -4.5, -3.5);

  addBox(-12.7, -4.5 + 0.22, -17.5, 0.36, 0.44, 0.36, new THREE.MeshLambertMaterial({ color: 0x5a5f56 }));
  const mop = addBox(-12.7, -4.5 + 0.8, -17.5, 0.05, 1.2, 0.05, new THREE.MeshLambertMaterial({ color: 0x6b5a44 }));
  mop.rotation.z = 0.18;

  // ---------- VENT CHAMBER (basement -> archive) ----------
  addBox(-12.2, (-1.35 - 0.1) / 2, -15.8, 0.3, 1.25, 1.2, wallMat); // lintel over the basement opening
  addWall(-10.7, -16.4, 3.0, 0.3, -4.5, -0.1); // north
  addWall(-11.3, -15.2, 1.8, 0.3, -4.5, -0.1); // south, west of the turn
  addWall(-10.4, -12.675, 0.3, 5.05, -4.5, -0.1); // west
  addWall(-9.2, -13.275, 0.3, 6.25, -4.5, -0.1); // east
  addCeiling(-10.7, -15.8, 3.0, 1.2, -0.1);
  addCeiling(-9.8, -12.675, 1.2, 5.05, -0.1);
  addFloor(-10.7, -15.8, 3.0, 1.2, -4.5, darkFloorMat);
  addFloor(-9.8, -14.3, 1.2, 1.8, -4.5, darkFloorMat);
  for (let k = 1; k <= 6; k++) {
    const top = -4.5 + 0.25 * k;
    const zc = -13.4 + (k - 0.5) * (3.25 / 6);
    addBox(-9.8, (-4.5 + top) / 2, zc, 1.2, top + 4.5, 3.25 / 6, stepMat);
  }

  // ---------- EDITING ROOM (west of the archive) ----------
  addFloor(-23.225, -7.65, 6.15, 5, ARCHIVE_Y, darkFloorMat);
  addCeiling(-23.225, -7.65, 6.15, 5, -0.05);
  addWall(-26.3, -7.65, 0.3, 5.3, ARCHIVE_Y, -0.05); // west
  addWall(-23.225, -10.15, 6.45, 0.3, ARCHIVE_Y, -0.05); // north
  addWall(-23.225, -5.15, 6.45, 0.3, ARCHIVE_Y, -0.05); // south

  // doorway in the archive west wall
  addBox(-20.15, -0.475, -9.25, 0.3, 0.85, 1.5, wallMat); // lintel, visual only
  addBox(-20.15, -1.95, -10.0, 0.3, 2.1, 0.08, frameMat);
  addBox(-20.15, -1.95, -8.5, 0.3, 2.1, 0.08, frameMat);

  const editTable = new THREE.MeshLambertMaterial({ color: 0x4a463c });
  addBox(-23.2, ARCHIVE_Y + 0.45, -7.65, 3.0, 0.9, 1.4, editTable);
  addCollider(-24.7, -21.7, -8.35, -6.95, ARCHIVE_Y, ARCHIVE_Y + 1.0);
  const editScreen = new THREE.MeshBasicMaterial({ color: 0x8fb0a4 });
  for (const mx of [-24.1, -23.2, -22.3]) {
    addBox(mx, ARCHIVE_Y + 1.1, -7.9, 0.5, 0.4, 0.35, plasticMat);
    addBox(mx, ARCHIVE_Y + 1.1, -7.71, 0.4, 0.3, 0.02, editScreen);
  }

  // tape shelves along the north and south walls
  for (const sz of [-9.6, -5.7]) {
    addBox(-23.4, ARCHIVE_Y + 1.0, sz, 4.4, 2.0, 0.34, shelfMat);
    addCollider(-25.6, -21.2, sz - 0.2, sz + 0.2, ARCHIVE_Y, ARCHIVE_Y + 2.0);
    for (let k = 0; k < 9; k++) {
      addBox(
        -25.3 + k * 0.45,
        ARCHIVE_Y + 1.3,
        sz + (sz < -8 ? 0.2 : -0.2),
        0.3,
        0.28,
        0.06,
        new THREE.MeshLambertMaterial({ color: tapeColors[k % tapeColors.length] }),
      );
    }
  }

  // ---------- LIGHTS ----------
  const glowTex = makeGlowTexture();
  function addGlow(x: number, y: number, z: number, color: number, scale: number) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.position.set(x, y, z);
    sprite.scale.setScalar(scale);
    scene.add(sprite);
    return sprite;
  }

  function fixture(x: number, y: number, z: number, w = 1.4) {
    return addBox(x, y, z, w, 0.09, 0.32, new THREE.MeshBasicMaterial({ color: 0xd8e6d2 }));
  }
  const flickering: {
    light: THREE.PointLight;
    mesh: THREE.Mesh;
    seed: number;
    hard: boolean;
    base: number;
  }[] = [];

  function fluorescent(x: number, y: number, z: number, hard = false, base = 4.5) {
    const mesh = fixture(x, y + 0.22, z);
    const light = new THREE.PointLight(0xdfe9cf, base, 12, 1.4);
    light.position.set(x, y, z);
    scene.add(light);
    addGlow(x, y + 0.15, z, 0xd8ecd0, 1.6);
    flickering.push({ light, mesh, seed: Math.random() * 100, hard, base });
    return light;
  }

  fluorescent(0, 2.85, -0.5); // control room
  fluorescent(-3, 2.85, -9); // corridor A
  fluorescent(-9, 2.85, -11, true); // corridor B, faulty
  fluorescent(-14, -0.55, -5, false, 7.5); // archive (greenish tint via color)
  const archiveLight = flickering[flickering.length - 1];
  archiveLight.light.color.set(0xc4dcc8);
  const serverLight = fluorescent(-10.65, 2.85, -3.15, false, 3.2); // server room
  serverLight.color.set(0xb6d2de);
  fluorescent(-23.2, -0.55, -7.65, false, 6.0); // editing room

  // desk lamp with a green shade in the control room
  addBox(-2.2, 1.0, 4.2, 0.16, 0.06, 0.16, new THREE.MeshLambertMaterial({ color: 0x2a2c28 }));
  addBox(-2.2, 1.18, 4.2, 0.04, 0.36, 0.04, new THREE.MeshLambertMaterial({ color: 0x2a2c28 }));
  addBox(-2.2, 1.38, 4.2, 0.34, 0.16, 0.34, new THREE.MeshBasicMaterial({ color: 0x9fd8a8 }));
  const deskLamp = new THREE.PointLight(0xbfe8c0, 1.6, 5, 1.8);
  deskLamp.position.set(-2.2, 1.3, 4.0);
  scene.add(deskLamp);
  addGlow(-2.2, 1.38, 4.2, 0xa8dcb0, 0.7);

  // stairwell bare bulbs
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe6b8 });
  addBox(-15.2, 2.7, -11, 0.09, 0.09, 0.09, bulbMat);
  const bulbTop = new THREE.PointLight(0xffd9a0, 2.2, 7, 1.6);
  bulbTop.position.set(-15.2, 2.6, -11);
  scene.add(bulbTop);
  addGlow(-15.2, 2.68, -11, 0xffe0b0, 0.8);
  addBox(-19.4, -0.75, -11, 0.09, 0.09, 0.09, bulbMat);
  const bulbBottom = new THREE.PointLight(0xffd9a0, 2.6, 7, 1.4);
  bulbBottom.position.set(-19.4, -0.85, -11);
  scene.add(bulbBottom);
  addGlow(-19.35, -0.78, -11, 0xffe0b0, 0.6);

  // caged bulb inside the archive entrance so the doorway isn't a black hole
  addBox(-19.0, -0.35, -8.6, 0.09, 0.09, 0.09, bulbMat);
  const archiveDoorLight = new THREE.PointLight(0xffe2b0, 1.5, 7, 1.7);
  archiveDoorLight.position.set(-19.0, -0.45, -8.6);
  scene.add(archiveDoorLight);
  addGlow(-19.0, -0.38, -8.6, 0xffe4b8, 0.7);

  // small bulb at the dead end so the turn reads clearly
  addBox(-3, 2.75, -12.55, 0.08, 0.08, 0.08, bulbMat);
  const deadEndLight = new THREE.PointLight(0xffe2b0, 1.6, 6, 1.6);
  deadEndLight.position.set(-3, 2.65, -12.5);
  scene.add(deadEndLight);
  addGlow(-3, 2.72, -12.35, 0xffe4b8, 0.55);

  // red emergency light beside the basement door
  const emergencyMat = new THREE.MeshBasicMaterial({ color: 0xff2a1e });
  const emergency = addBox(-18.4, -0.9, -10.05, 0.14, 0.2, 0.14, emergencyMat);
  const emergencyLight = new THREE.PointLight(0xff2a1e, 1.2, 7, 1.8);
  emergencyLight.position.set(-18.4, -0.95, -9.95);
  scene.add(emergencyLight);
  const emergencyGlow = addGlow(-18.4, -0.88, -10.5, 0xff3020, 0.6);

  // toilet: one dim bulb
  addBox(-3, 2.78, -16.4, 0.08, 0.08, 0.08, bulbMat);
  const toiletLight = new THREE.PointLight(0xffd9a0, 1.15, 6, 1.8);
  toiletLight.position.set(-3, 2.68, -16.4);
  scene.add(toiletLight);
  addGlow(-3, 2.72, -16.4, 0xffe0b0, 0.55);

  // technical basement bulbs
  addBox(-16.6, -1.5, -19.2, 0.09, 0.09, 0.09, bulbMat);
  const cellarLightA = new THREE.PointLight(0xffd9a0, 2.2, 9, 1.5);
  cellarLightA.position.set(-16.6, -1.6, -19.2);
  scene.add(cellarLightA);
  addGlow(-16.6, -1.55, -19.2, 0xffe0b0, 0.7);

  addBox(-18.9, -1.5, -23.6, 0.09, 0.09, 0.09, bulbMat);
  const cellarLightB = new THREE.PointLight(0xdfe9cf, 1.5, 8, 1.6);
  cellarLightB.position.set(-18.9, -1.6, -23.6);
  scene.add(cellarLightB);
  addGlow(-18.9, -1.55, -23.6, 0xdfe9cf, 0.6);

  // vent chamber bulb
  addBox(-10.9, -1.9, -15.7, 0.07, 0.07, 0.07, bulbMat);
  const ventLight = new THREE.PointLight(0xffd9a0, 1.2, 6, 1.7);
  ventLight.position.set(-10.9, -2.0, -15.7);
  scene.add(ventLight);
  addGlow(-10.9, -1.95, -15.7, 0xffe0b0, 0.5);

  const screenGlow = new THREE.PointLight(0x9fc0b2, 1.4, 9, 1.8);
  screenGlow.position.set(0, 1.4, 3.3);
  scene.add(screenGlow);

  scene.add(new THREE.HemisphereLight(0x8ba3b5, 0x565a4e, 2.0));
  scene.add(new THREE.AmbientLight(0x6a7c88, 2.15));

  // ---------- DUST ----------
  const dustCount = 420;
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(dustCount * 3);
  const dustSeed = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3 + 0] = -20 + Math.random() * 28;
    dustPos[i * 3 + 1] = ARCHIVE_Y + 0.3 + Math.random() * (H + 2.6);
    dustPos[i * 3 + 2] = -13 + Math.random() * 18;
    dustSeed[i] = Math.random() * Math.PI * 2;
  }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({
      color: 0xbfd6c8,
      size: 0.014,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    }),
  );
  scene.add(dust);

  // ---------- GROUND HEIGHT ----------
  // Several levels stack in plan (server room above the archive, vent below
  // corridor B), so collect every floor candidate here and return the one
  // nearest the caller's current height.
  function groundHeightAt(x: number, z: number, refY = 0): number {
    const cands: number[] = [];
    const offer = (h: number) => {
      for (const c of cands) if (Math.abs(c - h) < 0.4) return;
      cands.push(h);
    };

    // main stairwell ramp along -x
    if (x >= -20 && x <= -14 && z >= -12.15 && z <= -9.85) {
      offer(x >= -14.5 ? 0 : ARCHIVE_Y * Math.min(1, Math.max(0, (-14.5 - x) / 5)));
    }
    // technical stair from the lower landing down to -4.5
    if (x >= -20.15 && x <= -18.15 && z >= -15.2 && z <= -12.15) {
      offer(-3 - 1.5 * Math.min(1, Math.max(0, (-12.15 - z) / 3.05)));
    }
    // technical basement
    if (x >= -20.2 && x <= -12.2 && z >= -25.2 && z <= -15.2) offer(-4.5);
    // vent chamber: flat run, then a ramp up into the archive
    if (x >= -12.2 && x <= -9.2 && z >= -16.4 && z <= -15.2) offer(-4.5);
    if (x >= -10.4 && x <= -9.2 && z >= -15.2 && z <= -10.15) {
      offer(-4.5 + 1.5 * Math.min(1, Math.max(0, (z + 13.4) / 3.25)));
      if (z >= -12.15) offer(0); // corridor B runs directly above this stretch
    }
    // server room stands on the ground floor over the archive
    if (x >= -13.15 && x <= -8.15 && z >= -5.15 && z <= -1.15) offer(0);
    if (x >= -20.15 && x <= -8.35 && z >= -10.15 && z <= 0.15) offer(ARCHIVE_Y);
    if (x >= -26.3 && x <= -20.15 && z >= -10.15 && z <= -5.15) offer(ARCHIVE_Y);

    if (cands.length === 0) return 0;
    let best = cands[0];
    for (const c of cands) if (Math.abs(c - refY) < Math.abs(best - refY)) best = c;
    return best;
  }

  let staticTimer = 0;

  const update = (time: number, dt: number) => {
    staticTimer += dt;
    if (staticTimer > 0.07) {
      staticTimer = 0;
      staticSignal.redraw();
      screenGlow.intensity = 1.2 + Math.random() * 0.4;
    }

    for (const f of flickering) {
      const base = 0.9 + Math.sin(time * 8.3 + f.seed) * 0.05 + Math.sin(time * 31.7 + f.seed) * 0.04;
      const dip =
        f.hard && Math.sin(time * 1.7 + f.seed) > 0.93
          ? 0.05 + Math.abs(Math.sin(time * 40)) * 0.2
          : 1.0;
      f.light.intensity = f.base * base * dip;
      (f.mesh.material as THREE.MeshBasicMaterial).color.setScalar(0.4 + 0.6 * base * dip);
    }

    // red pulse near basement door
    const pulse = 0.6 + 0.4 * Math.sin(time * 2.1);
    emergencyLight.intensity = 1.4 * pulse;
    emergencyMat.color.setRGB(0.4 + 0.6 * pulse, 0.08 * pulse, 0.06 * pulse);
    emergencyGlow.material.opacity = 0.35 + 0.65 * pulse;

    // stairwell bulbs sway slightly
    bulbTop.intensity = 2.0 + Math.sin(time * 3.1) * 0.25;
    bulbBottom.intensity = 2.5 + Math.sin(time * 2.3 + 2) * 0.25;

    const pos = dustGeo.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < dustCount; i++) {
      let y = pos.getY(i) + dt * 0.018 * (1 + Math.sin(dustSeed[i] + time * 0.4));
      if (y > H - 0.1) y = ARCHIVE_Y + 0.3;
      pos.setY(i, y);
      pos.setX(i, pos.getX(i) + Math.sin(time * 0.25 + dustSeed[i]) * dt * 0.01);
    }
    pos.needsUpdate = true;
  };

  return {
    scene,
    colliders,
    update,
    bounds: { minX: -26.2, maxX: 7.9, minZ: -25.5, maxZ: 4.9 },
    groundHeightAt,
  };
}
