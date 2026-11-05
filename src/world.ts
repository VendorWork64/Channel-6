import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import {
  makeAtlasTexture,
  makeGlowTexture,
  makeStaticCanvas,
  makeWoodTexture,
} from "./textures";

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
}

export interface Door {
  group: THREE.Group;
  center: THREE.Vector3;
  normal: { x: number; z: number };
  hinge: { x: number; z: number };
  leafW: number;
  closedAngle: number;
  targetAngle: number;
  isOpen: boolean;
  closedBox: { minX: number; maxX: number; minZ: number; maxZ: number };
  collider: Collider;
}

export interface World {
  scene: THREE.Scene;
  colliders: Collider[];
  doors: Door[];
  toggleDoor: (door: Door, playerX: number, playerZ: number) => void;
  update: (time: number, dt: number) => void;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  groundHeightAt: (x: number, z: number, refY?: number) => number;
  propsReady: Promise<void>;
}

const H = 3.2;
const ARCHIVE_Y = -3;

export function buildWorld(): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030507);
  scene.fog = new THREE.Fog(0x05080b, 2.0, 9.8);

  const colliders: Collider[] = [];

  function wood(file: string, tile: number, tint: number) {
    const mat = new THREE.MeshLambertMaterial({
      map: makeWoodTexture(`/wood/${file}`),
      color: tint,
      emissive: 0x0b0a08,
    });
    mat.userData.tile = tile;
    return mat;
  }

  // wood_50_64_ is a 64 px tile: load it at its native size, otherwise the
  // atlas loader crops it into the top-left quarter of a 256 canvas and the
  // rest of every ceiling tile stays black
  const ceilTex = makeAtlasTexture("/wood/wood_50_64_.png", 0, 0, 64, 64);
  const ceilMat = new THREE.MeshLambertMaterial({
    map: ceilTex,
    color: 0xb5aea0,
    emissive: 0x1a1712,
  });
  ceilMat.userData.tile = 1.8;
  ceilMat.emissiveMap = ceilTex;
  ceilMat.emissive.setHex(0x3d3830);

  const floorControlMat = wood("wood_23_256_.png", 1.6, 0x928b81); // block parquet
  const floorServerMat = wood("wood_13_256_.png", 1.5, 0x9aa09c); // grey weathered boards
  const floorCorridorAMat = wood("wood_8_256_.png", 1.8, 0x9c9488); // worn pale boards
  const floorToiletMat = wood("wood_18_256_.png", 1.4, 0xa8a49a); // whitewashed boards
  const floorCorridorBMat = wood("wood_21_256_.png", 1.5, 0x9a8b7f); // warm parquet
  const floorStairMat = wood("wood_17_256_.png", 1.6, 0x8f8175); // dark worn boards
  const floorArchiveMat = wood("wood_57_256_.png", 1.8, 0xa39a8c); // dark herringbone
  const floorBasementMat = wood("wood_35_256_.png", 2.0, 0x8a7f72); // rough boards
  const floorEditMat = wood("wood_27_256_.png", 1.8, 0x9c9285); // oak boards
  const floorKitchenMat = wood("wood_13_256_.png", 1.9, 0x969c96); // scrubbed grey boards
  const floorBedroomMat = wood("wood_41_256_.png", 1.7, 0x9a9285); // buff herringbone

  // 2x2 wallpaper atlas: quadrants are inset a little to hide JPEG edge bleed.
  // userData.tile is the world size of one wallpaper repeat, in metres.
  const WALLPAPERS = "/walls/Wallpapers.jpeg";
  const TRIMS = "/walls/Trims.jpeg";
  function wallpaper(sx: number, sy: number, tile: number, tint: number) {
    const mat = new THREE.MeshLambertMaterial({
      map: makeAtlasTexture(WALLPAPERS, sx, sy, 122, 122),
      color: tint,
      emissive: 0x0c0f0d,
    });
    mat.userData.tile = tile;
    return mat;
  }
  const wallGreenMat = wallpaper(3, 3, 2.0, 0x9fa89c); // control room, editing room
  const wallYellowMat = wallpaper(131, 3, 1.7, 0xa89f8a); // corridor A, archive
  const wallRedMat = wallpaper(3, 131, 2.2, 0x86786d); // corridor B
  const wallPlasterMat = wallpaper(131, 131, 1.5, 0x90948d); // technical rooms
  const wallWoodMat = wood("wood_7_256_.png", 1.6, 0x8f8579); // editing-room panelling

  const frameMat = new THREE.MeshLambertMaterial({
    map: makeAtlasTexture(TRIMS, 2, 2, 60, 124),
    color: 0x8a8a84,
    emissive: 0x080807,
  });
  const doorMat = new THREE.MeshLambertMaterial({
    map: makeAtlasTexture(TRIMS, 66, 2, 60, 124),
    color: 0x6e6459,
    emissive: 0x080604,
  });

  // Walls and trims meet with exactly flush faces, which makes coplanar
  // surfaces fight for depth. Give every mesh a deterministic offset of a few
  // millimetres: far below what is visible, far above depth-buffer precision.
  let driftId = 0;
  const GOLDEN = 0.618033988749895;
  function drift(m: THREE.Mesh) {
    const i = ++driftId;
    m.position.x += (((i * GOLDEN) % 1) - 0.5) * 0.008;
    m.position.z += (((i * GOLDEN * GOLDEN) % 1) - 0.5) * 0.008;
    m.position.y += (((i * GOLDEN * GOLDEN * GOLDEN) % 1) - 0.5) * 0.005;
  }

  // BoxGeometry maps every face to UV 0..1, which would stretch one wallpaper
  // tile across a whole wall. Scale each face's UVs by its world dimensions so
  // the pattern keeps a constant physical size.
  function scaleWallUV(
    geo: THREE.BoxGeometry,
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
  ) {
    const tile = (mat.userData as { tile?: number }).tile;
    if (!tile) return;
    const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
    const faces: [number, number][] = [
      [d, h],
      [d, h],
      [w, d],
      [w, d],
      [w, h],
      [w, h],
    ];
    for (let f = 0; f < 6; f++) {
      const [fw, fh] = faces[f];
      for (let i = f * 4; i < f * 4 + 4; i++) {
        uv.setXY(i, uv.getX(i) * (fw / tile), uv.getY(i) * (fh / tile));
      }
    }
    uv.needsUpdate = true;
  }

  function addWall(
    cx: number,
    cz: number,
    w: number,
    d: number,
    y0 = 0,
    y1 = H,
    mat: THREE.Material = wallPlasterMat,
  ) {
    const geo = new THREE.BoxGeometry(w, y1 - y0, d);
    scaleWallUV(geo, w, y1 - y0, d, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, (y0 + y1) / 2, cz);
    drift(m);
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
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleWallUV(geo, w, h, d, mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, cy, cz);
    drift(m);
    scene.add(m);
    return m;
  }

  function scalePlaneUV(geo: THREE.PlaneGeometry, w: number, d: number, mat: THREE.Material) {
    const tile = (mat.userData as { tile?: number }).tile;
    if (!tile) return;
    const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * (w / tile), uv.getY(i) * (d / tile));
    }
    uv.needsUpdate = true;
  }

  function addFloor(cx: number, cz: number, w: number, d: number, y: number, mat: THREE.Material) {
    const geo = new THREE.PlaneGeometry(w, d);
    scalePlaneUV(geo, w, d, mat);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, y - 0.01, cz); // 1 cm below wall bases: avoids z-fighting
    scene.add(m);
  }

  function addCeiling(cx: number, cz: number, w: number, d: number, y: number) {
    const geo = new THREE.PlaneGeometry(w, d);
    scalePlaneUV(geo, w, d, ceilMat);
    const m = new THREE.Mesh(geo, ceilMat);
    m.rotation.x = Math.PI / 2;
    m.position.set(cx, y + 0.01, cz);
    scene.add(m);
  }

  function addCollider(minX: number, maxX: number, minZ: number, maxZ: number, y0?: number, y1?: number) {
    colliders.push({ minX, maxX, minZ, maxZ, minY: y0, maxY: y1 });
  }

  // ---------- DOORS ----------
  // Every leaf hangs on a group pivoted at a jamb, so it swings like a real
  // door. The lining (jambs, head, threshold) covers the reveal of the wall
  // opening on both faces, so no gap or void is visible around a closed leaf.
  const handleMat = new THREE.MeshLambertMaterial({ color: 0x676c63, emissive: 0x0a0c0b });
  const doors: Door[] = [];
  const DOOR_H = 2.3;
  const JAMB = 0.05;

  function makeDoor(ax: number, az: number, bx: number, bz: number) {
    const dx = Math.sign(bx - ax);
    const dz = Math.sign(bz - az);
    const alongX = dz === 0;
    const span = Math.abs(bx - ax) + Math.abs(bz - az);
    const midX = (ax + bx) / 2;
    const midZ = (az + bz) / 2;
    const jambDepth = 0.4; // proud of both wall faces

    for (const [ex, ez] of [
      [ax, az],
      [bx, bz],
    ]) {
      addBox(
        ex,
        DOOR_H / 2,
        ez,
        alongX ? JAMB : jambDepth,
        DOOR_H,
        alongX ? jambDepth : JAMB,
        frameMat,
      );
    }
    addBox(
      midX,
      DOOR_H - 0.035,
      midZ,
      alongX ? span - JAMB * 2 : jambDepth,
      0.07,
      alongX ? jambDepth : span - JAMB * 2,
      frameMat,
    );
    addBox(
      midX,
      0.01,
      midZ,
      alongX ? span - JAMB * 2 : jambDepth + 0.06,
      0.05,
      alongX ? jambDepth + 0.06 : span - JAMB * 2,
      frameMat,
    );

    const hingeX = ax + dx * 0.03;
    const hingeZ = az + dz * 0.03;
    const leafW = span - 0.06;
    const group = new THREE.Group();
    group.position.set(hingeX, 0, hingeZ);
    const closedAngle = Math.atan2(-dz, dx);
    group.rotation.y = closedAngle;

    const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, 2.2, 0.05), doorMat);
    leaf.position.set(leafW / 2, 1.14, 0);
    group.add(leaf);
    for (const side of [-1, 1]) {
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.03), handleMat);
      lever.position.set(leafW - 0.16, 1.02, side * 0.038);
      group.add(lever);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.14, 0.022), handleMat);
      plate.position.set(leafW - 0.1, 0.99, side * 0.037);
      group.add(plate);
    }
    scene.add(group);

    const closedBox = alongX
      ? {
          minX: Math.min(ax, bx),
          maxX: Math.max(ax, bx),
          minZ: az - 0.17,
          maxZ: az + 0.17,
        }
      : {
          minX: ax - 0.17,
          maxX: ax + 0.17,
          minZ: Math.min(az, bz),
          maxZ: Math.max(az, bz),
        };
    const collider: Collider = { ...closedBox, minY: 0, maxY: H };
    colliders.push(collider);

    doors.push({
      group,
      center: new THREE.Vector3(midX, 1.15, midZ),
      normal: alongX ? { x: 0, z: 1 } : { x: 1, z: 0 },
      hinge: { x: hingeX, z: hingeZ },
      leafW,
      closedAngle,
      targetAngle: closedAngle,
      isOpen: false,
      closedBox,
      collider,
    });
  }

  // Opens away from whoever operates it: the leaf swings to the far side.
  function toggleDoor(door: Door, playerX: number, playerZ: number) {
    door.isOpen = !door.isOpen;
    if (!door.isOpen) {
      door.targetAngle = door.closedAngle;
      Object.assign(door.collider, door.closedBox);
      return;
    }
    const side =
      Math.sign(
        (playerX - door.center.x) * door.normal.x + (playerZ - door.center.z) * door.normal.z,
      ) || 1;
    const wantX = -side * door.normal.x;
    const wantZ = -side * door.normal.z;
    const a = door.closedAngle + Math.PI / 2;
    const b = door.closedAngle - Math.PI / 2;
    door.targetAngle = Math.cos(a) * wantX - Math.sin(a) * wantZ > Math.cos(b) * wantX - Math.sin(b) * wantZ ? a : b;

    // The open leaf still blocks movement: swap the doorway strip for the leaf strip.
    const ex = door.hinge.x + wantX * door.leafW;
    const ez = door.hinge.z + wantZ * door.leafW;
    const pad = 0.08;
    door.collider.minX = Math.min(door.hinge.x, ex) - (wantX === 0 ? pad : 0);
    door.collider.maxX = Math.max(door.hinge.x, ex) + (wantX === 0 ? pad : 0);
    door.collider.minZ = Math.min(door.hinge.z, ez) - (wantZ === 0 ? pad : 0);
    door.collider.maxZ = Math.max(door.hinge.z, ez) + (wantZ === 0 ? pad : 0);
  }

  // ---------- CONTROL ROOM (аппаратная) ----------
  addFloor(0, 0, 16, 10, 0, floorControlMat);
  addCeiling(0, 0, 16, 10, H);
  addWall(0, 5.15, 16.6, 0.3, 0, H, wallGreenMat); // back
  addWall(-8.15, -4.65, 0.3, 1.3, 0, H, wallGreenMat); // left, north of server-room door
  addWall(-8.15, -0.25, 0.3, 4.5, 0, H, wallGreenMat); // left, between the two doorways
  addWall(-8.15, 4.15, 0.3, 2.3, 0, H, wallGreenMat); // left, south of the bedroom doorway
  addWall(8.15, 0, 0.3, 10.6, 0, H, wallGreenMat); // right
  // lintel over the server-room doorway: visual only, colliders ignore Y
  addBox(-8.15, (2.3 + H) / 2, -3.25, 0.34, H - 2.3, 1.5, wallGreenMat);
  addWall(-6.08, -5.15, 4.2, 0.3, 0, H, wallGreenMat); // front, left of door
  addWall(2.93, -5.15, 10.65, 0.3, 0, H, wallGreenMat); // front, right of door
  // lintel: visual only — colliders are 2D in XZ, a collider here would seal the doorway
  addBox(-3.19, (2.3 + H) / 2, -5.15, 1.58, H - 2.3, 0.34, wallGreenMat);

  makeDoor(-3.98, -5.15, -2.395, -5.15);

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
  sign.position.set(-3.2, 2.62, -4.95);
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

  // ---------- CONTROL ROOM: corner desk + props from /public/models ----------
  // Модели грузятся асинхронно, комната уже стоит. Материалы FBX ссылаются
  // на мёртвые windows-пути, поэтому текстуры перенаправляются по имени файла.
  const modelManager = new THREE.LoadingManager();
  const MODEL_TEXTURES: Record<string, string> = {
    "текстуры.png": "/models/pc/textures.png",
    "png.png": "/models/chair/texture.png",
    "internal_ground_ao_texture.jpeg": "/models/chair/ao.jpeg",
    "paper and notes.png": "/models/corkboard/paper_and_notes.png",
    "polaroid.png": "/models/corkboard/polaroid.png",
    "newspaper.png": "/models/corkboard/newspaper.png",
    "t_vhs.png": "/models/vhs/T_VHS.png",
    "nokia-3310.jpg": "/models/nokia/nokia-3310.jpg",
    "radio_1.png": "/models/radio/radio_1.png",
    "material_base_color.png": "/models/sofa/Material_Base_color.png",
  };
  modelManager.setURLModifier((url) => {
    const base = decodeURIComponent(url.split(/[\\/]/).pop() ?? "").toLowerCase();
    return MODEL_TEXTURES[base] ?? url;
  });

  function markSrgb(root: THREE.Object3D) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshPhongMaterial;
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
        if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        mat.side = THREE.FrontSide;
      }
    });
  }

  // Пак хранит меши в общих мировых координатах: чтобы вытащить один предмет,
  // запекаем его мировую матрицу в геометрию и обнуляем трансформ.
  function extractMesh(source: THREE.Mesh, target: THREE.Object3D) {
    source.updateWorldMatrix(true, false);
    const geo = source.geometry.clone();
    geo.applyMatrix4(source.matrixWorld);
    const mesh = new THREE.Mesh(geo, source.material);
    mesh.name = source.name;
    target.add(mesh);
    return mesh;
  }

  function settle(
    obj: THREE.Object3D,
    x: number,
    z: number,
    rotY: number,
    scale: number,
    baseY: number,
  ) {
    obj.scale.setScalar(scale);
    obj.rotation.y = rotY;
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    obj.position.x += x - center.x;
    obj.position.z += z - center.z;
    obj.position.y += baseY - box.min.y;
    obj.updateMatrixWorld(true);
  }

  const DESK_X = 7.0;
  const DESK_Z = -4.42;
  const DESK_TOP = 0.816;
  addCollider(6.0, 8.0, -4.98, -3.86, 0, 0.9);

  async function loadDesk() {
    const obj = await new OBJLoader(modelManager).loadAsync("/models/table/table.obj");
    const tex = new THREE.TextureLoader(modelManager).load("/models/table/table_color.jpg");
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshLambertMaterial({ map: tex, color: 0xb8b2a5 });
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = mat;
    });
    settle(obj, DESK_X, DESK_Z, -Math.PI / 2, 1, 0);
    scene.add(obj);
  }

  async function loadCorkboard() {
    const fbx = await new FBXLoader(modelManager).loadAsync("/models/corkboard/board.fbx");
    fbx.updateMatrixWorld(true);
    markSrgb(fbx);
    // Экспорт FBX потерял текстуру доски, но UV всех мешей лежат в атласе
    // paper_and_notes.png, поэтому назначаем атлас вручную.
    const atlas = new THREE.TextureLoader(modelManager).load("/models/corkboard/paper_and_notes.png");
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 4;
    const group = new THREE.Group();
    fbx.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name === "Wall002") return;
      extractMesh(mesh, group);
    });
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        const mat = m as THREE.MeshPhongMaterial;
        mat.map = atlas;
        mat.color.setHex(0xffffff);
        mat.emissiveMap = atlas;
        mat.emissive.setHex(0x1c1a15);
        mat.needsUpdate = true;
      }
    });
    group.scale.setScalar(0.0072); // доска ~0.99 x 0.62 м
    group.rotation.y = 0; // лицом в комнату (+z от передней стены)
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const c = box.getCenter(new THREE.Vector3());
    group.position.x += 6.4 - c.x;
    group.position.y += 1.5 - c.y;
    group.position.z += -4.94 - c.z;
    scene.add(group);
  }

  async function loadPc() {
    const fbx = await new FBXLoader(modelManager).loadAsync("/models/pc/pc.fbx");
    fbx.updateMatrixWorld(true);
    markSrgb(fbx);
    const group = new THREE.Group();
    fbx.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) extractMesh(mesh, group);
    });
    // Фронт комплекта (клавиатура, экран, панель блока) смотрит на +Z —
    // в комнату. Весь набор ~1.0 x 0.9 м, в правом углу стола.
    settle(group, 7.42, -4.52, 0, 0.0078, DESK_TOP);
    scene.add(group);
  }

  async function loadVhs() {
    const fbx = await new FBXLoader(modelManager).loadAsync("/models/vhs/vhs.fbx");
    fbx.updateMatrixWorld(true);
    markSrgb(fbx);
    let source: THREE.Mesh | null = null;
    fbx.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.name === "VHSPlayer") source = mesh;
    });
    if (!source) return;
    const group = new THREE.Group();
    extractMesh(source, group);
    settle(group, 6.62, -4.6, 0, 0.00525, DESK_TOP);
    scene.add(group);
  }

  async function loadNokia() {
    const fbx = await new FBXLoader(modelManager).loadAsync("/models/nokia/nokia.fbx");
    fbx.updateMatrixWorld(true);
    markSrgb(fbx);
    const group = new THREE.Group();
    fbx.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) extractMesh(mesh, group);
    });
    settle(group, 6.22, -4.06, -0.7, 0.00035, DESK_TOP);
    scene.add(group);
  }

  async function loadRadio() {
    const fbx = await new FBXLoader(modelManager).loadAsync("/models/radio/radio_1.fbx");
    fbx.updateMatrixWorld(true);
    markSrgb(fbx);
    const group = new THREE.Group();
    fbx.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) extractMesh(mesh, group);
    });
    settle(group, 6.15, -4.62, -Math.PI / 2, 0.018, DESK_TOP);
    scene.add(group);
  }

  // Офисный стул перед столом, сиденьем к столу.
  addCollider(6.76, 7.44, -3.68, -3.02, 0, 1.1);
  async function loadChair() {
    const fbx = await new FBXLoader(modelManager).loadAsync("/models/chair/chair.fbx");
    fbx.updateMatrixWorld(true);
    markSrgb(fbx);
    const group = new THREE.Group();
    fbx.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      if (Number.isNaN(mesh.geometry.boundingBox!.min.x)) return; // вырожденный служебный меш
      extractMesh(mesh, group);
    });
    settle(group, 7.1, -3.35, -Math.PI / 2, 0.002, 0);
    scene.add(group);
  }

  // Диван в правом дальнем углу аппаратной, спинкой к задней стене.
  addCollider(5.95, 8.0, 4.4, 5.1, 0, 1.1);
  async function loadSofa() {
    const fbx = await new FBXLoader(modelManager).loadAsync("/models/sofa/Sofa.fbx");
    fbx.updateMatrixWorld(true);
    markSrgb(fbx);
    const group = new THREE.Group();
    fbx.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.computeBoundingBox();
      if (Number.isNaN(mesh.geometry.boundingBox!.min.x)) return; // вырожденный служебный меш
      extractMesh(mesh, group);
    });
    // FBX не ссылается на файл текстуры — назначаем атлас вручную.
    const tex = new THREE.TextureLoader().load("/models/sofa/Material_Base_color.png");
    tex.colorSpace = THREE.SRGBColorSpace;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = new THREE.MeshPhongMaterial({ map: tex });
    });
    // Длина дивана вдоль оси Z модели (~805 единиц); поворот кладёт её вдоль X,
    // фронт (лицо +X у модели) после π/2 смотрит на -Z — в комнату.
    settle(group, 7.0, 4.55, Math.PI / 2, 0.0025, 0);
    scene.add(group);
  }

  const propsReady = Promise.all([
    loadDesk(),
    loadCorkboard(),
    loadPc(),
    loadVhs(),
    loadNokia(),
    loadRadio(),
    loadChair(),
    loadSofa(),
  ]).then(
    () => undefined,
    (err) => console.error("control-room props failed", err),
  );

  // ---------- SERVER ROOM (west of the control room) ----------
  addFloor(-10.65, -3.15, 5, 4, 0, floorServerMat);
  addCeiling(-10.65, -3.15, 5, 4, H);
  addWall(-13.15, -3.15, 0.3, 4.3, 0, H, wallPlasterMat); // west
  addWall(-10.65, -5.15, 5.3, 0.3, 0, H, wallPlasterMat); // north
  addWall(-10.725, -1.15, 5.15, 0.3, 0, H, wallPlasterMat); // south, end tucked into the control-room wall

  makeDoor(-8.15, -4.0, -8.15, -2.5);

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
  addFloor(-3, -9.15, 2.3, 8.0, 0, floorCorridorAMat);
  addCeiling(-3, -9.15, 2.3, 8.0, H);
  addWall(-4.15, -12.65, 0.3, 1.0, 0, H, wallYellowMat); // west, north piece
  addWall(-4.15, -7.43, 0.3, 4.85, 0, H, wallYellowMat); // west, south piece
  addWall(-1.85, -12.275, 0.3, 1.75, 0, H, wallYellowMat); // east, north of the kitchen doorway
  addWall(-1.85, -7.775, 0.3, 5.25, 0, H, wallYellowMat); // east, south of the kitchen doorway
  // dead-end cap, split by the toilet doorway
  addWall(-4.45, -13.15, 1.1, 0.3, 0, H, wallYellowMat);
  addWall(-1.7, -13.15, 1.4, 0.3, 0, H, wallYellowMat);
  addBox(-3.15, (2.3 + H) / 2, -13.15, 1.5, H - 2.3, 0.34, wallYellowMat); // lintel, visual only
  addBox(-3.9, 1.18, -13.15, 0.08, 2.36, 0.36, frameMat);
  addBox(-2.4, 1.18, -13.15, 0.08, 2.36, 0.36, frameMat);

  // kitchen doorway: lintel, lining and a hung leaf
  addBox(-1.85, (2.3 + H) / 2, -10.9, 0.34, H - 2.3, 1.0, wallYellowMat);
  makeDoor(-1.85, -11.4, -1.85, -10.4);

  // ---------- TOILET / SHOWER (north of corridor A) ----------
  addFloor(-3, -16.15, 4, 6, 0, floorToiletMat);
  addCeiling(-3, -16.15, 4, 6, H);
  addWall(-5, -16.15, 0.3, 6.3, 0, H, wallPlasterMat); // west
  addWall(-1, -16.15, 0.3, 6.3, 0, H, wallPlasterMat); // east
  addWall(-3, -19.15, 4.3, 0.3, 0, H, wallPlasterMat); // north

  const stallMat = wood("wood_7_256_.png", 1.4, 0x8a8074); // panelled stall doors
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

  // ---------- KITCHEN (east of corridor A) ----------
  addFloor(3.15, -9.15, 9.7, 7.7, 0, floorKitchenMat);
  addCeiling(3.15, -9.15, 9.7, 7.7, H);
  // starts where the toilet wall ends: two boxes never share a wall face
  addWall(3.65, -13.15, 9.0, 0.3, 0, H, wallPlasterMat);
  addWall(8.15, -9.225, 0.3, 7.85, 0, H, wallPlasterMat); // east

  const cabinetMat = new THREE.MeshLambertMaterial({ color: 0x64685e, emissive: 0x0b0e0c });
  const counterTopMat = new THREE.MeshLambertMaterial({ color: 0x42453c, emissive: 0x080907 });
  const seamMat = new THREE.MeshLambertMaterial({ color: 0x2b2d28 });
  const steelMat = new THREE.MeshLambertMaterial({ color: 0x8b9088, emissive: 0x0c0e0c });
  const stoveMat = new THREE.MeshLambertMaterial({ color: 0x21231f, emissive: 0x070806 });
  const fridgeMat = new THREE.MeshLambertMaterial({ color: 0x565b55, emissive: 0x0a0c0b });
  const tableMat = wood("wood_27_256_.png", 1.0, 0x8a8073);

  // counter run along the east wall
  addBox(7.62, 0.45, -9.25, 0.68, 0.9, 5.3, cabinetMat);
  addBox(7.6, 0.93, -9.25, 0.74, 0.06, 5.5, counterTopMat);
  for (const sz of [-10.575, -9.25, -7.925]) {
    addBox(7.28, 0.47, sz, 0.015, 0.8, 0.02, seamMat);
  }
  for (const hz of [-11.4, -10.2, -9.0, -7.8]) {
    addBox(7.27, 0.72, hz, 0.04, 0.04, 0.24, steelMat);
  }
  // sink
  addBox(7.6, 0.97, -10.9, 0.42, 0.008, 0.56, stoveMat);
  addBox(7.9, 1.12, -10.9, 0.05, 0.32, 0.05, steelMat);
  addBox(7.79, 1.28, -10.9, 0.24, 0.05, 0.05, steelMat);
  // hob
  addBox(7.6, 0.965, -8.2, 0.6, 0.014, 0.9, stoveMat);
  for (const bx of [7.43, 7.77]) {
    for (const bz of [-8.47, -7.93]) {
      addBox(bx, 0.975, bz, 0.18, 0.012, 0.18, new THREE.MeshLambertMaterial({ color: 0x393c34 }));
    }
  }
  // wall cupboards and extractor hood
  addBox(7.8, 1.95, -9.4, 0.36, 0.68, 4.4, cabinetMat);
  for (const sz of [-10.5, -9.4, -8.3]) {
    addBox(7.625, 1.95, sz, 0.015, 0.62, 0.02, seamMat);
  }
  for (const hz of [-11.5, -10.3, -8.5, -7.3]) {
    addBox(7.615, 1.68, hz, 0.03, 0.03, 0.18, steelMat);
  }
  addBox(7.78, 2.52, -8.2, 0.4, 0.12, 0.9, stoveMat); // hood
  addBox(7.93, 2.75, -8.2, 0.12, 0.4, 0.12, steelMat); // hood duct
  addBox(7.62, 1.05, -7.95, 0.2, 0.14, 0.18, steelMat); // kettle
  // fridge in the north-east corner
  addBox(7.5, 0.9, -12.45, 0.82, 1.8, 0.8, fridgeMat);
  addBox(7.08, 1.25, -12.45, 0.03, 0.4, 0.05, steelMat);
  addCollider(7.2, 8.0, -12.0, -6.5, 0, 1.0); // counter
  addCollider(7.05, 8.0, -12.9, -12.0, 0, 1.9); // fridge

  // small shelf with jars on the north wall
  addBox(4.5, 1.62, -12.9, 1.5, 0.05, 0.3, cabinetMat);
  const jarColors = [0x5d6357, 0x6b5f4d, 0x4c534b];
  for (let k = 0; k < 3; k++) {
    addBox(3.95 + k * 0.5, 1.76, -12.9, 0.16, 0.24, 0.16, new THREE.MeshLambertMaterial({ color: jarColors[k] }));
  }

  // table and two chairs
  addBox(3.6, 0.735, -9.2, 1.8, 0.07, 1.1, tableMat);
  for (const lx of [2.78, 4.42]) {
    for (const lz of [-9.68, -8.72]) {
      addBox(lx, 0.35, lz, 0.07, 0.7, 0.07, tableMat);
    }
  }
  const kitchenChairMat = new THREE.MeshLambertMaterial({ color: 0x4a4b43, emissive: 0x080908 });
  for (const [cx, cz, back] of [
    [3.2, -10.05, -10.27],
    [4.0, -8.35, -8.13],
  ]) {
    addBox(cx, 0.46, cz, 0.5, 0.08, 0.5, kitchenChairMat);
    addBox(cx, 0.76, back, 0.5, 0.56, 0.07, kitchenChairMat);
    for (const ox of [-0.2, 0.2]) {
      for (const oz of [-0.2, 0.2]) {
        addBox(cx + ox, 0.21, cz + oz, 0.05, 0.42, 0.05, kitchenChairMat);
      }
    }
  }
  addCollider(2.65, 4.55, -9.8, -8.6, 0, 0.8); // table
  addCollider(2.9, 3.5, -10.35, -9.75, 0, 1.1); // chair
  addCollider(3.7, 4.3, -8.65, -8.05, 0, 1.1); // chair

  // ---------- CORRIDOR B (west) ----------
  addFloor(-9.1, -11, 10.3, 2.3, 0.002, floorCorridorBMat);
  addCeiling(-9.1, -11, 10.3, 2.3, H - 0.002);
  addWall(-9.15, -12.15, 10.3, 0.3, 0, H, wallRedMat); // north
  addWall(-9.15, -9.85, 10.3, 0.3, 0, H, wallRedMat); // south
  addWall(-14.15, -12.05, 0.3, 0.25, 0, H, wallRedMat); // west posts
  addWall(-14.15, -9.95, 0.3, 0.25, 0, H, wallRedMat);

  // ---------- STAIRWELL ----------
  addCeiling(-17, -11, 6.3, 2.6, H - 0.03); // below corridor B's ceiling plane: no z-fighting
  addWall(-16.075, -12.15, 4.15, 0.3, ARCHIVE_Y, H, wallPlasterMat); // north, right of the technical-stair opening
  addWall(-16.175, -10.15, 4.35, 0.3, ARCHIVE_Y, H, wallPlasterMat); // south, right of basement door
  addBox(-19.175, (-0.05 + H) / 2, -9.85, 1.65, H + 0.05, 0.34, wallPlasterMat); // lintel above the archive door
  addWall(-20.15, -11, 0.3, 2.6, ARCHIVE_Y, H, wallPlasterMat); // west
  // face under the top landing on the corridor side (no collider: below the floor)
  // ends 2 cm behind the archive's north face; any deeper and the slab pokes
  // out of the wall as a bare plaster strip beside the archive doorway
  addBox(-14.05, ARCHIVE_Y / 2, -11.02, 0.3, -ARCHIVE_Y, 1.98, wallPlasterMat);
  addFloor(-14.33, -11, 0.75, 2.3, 0.02, floorStairMat); // top landing, above corridor B's floor plane
  addFloor(-19.35, -11, 1.7, 2.3, ARCHIVE_Y + 0.002, floorStairMat); // bottom landing

  // steps descend westward from the top landing toward the archive door
  const stepMat = wood("wood_17_256_.png", 1.4, 0x8f8175);
  for (let k = 1; k <= 4; k++) {
    const top = -0.6 * k;
    const h = top - ARCHIVE_Y;
    addBox(-14 - k, (ARCHIVE_Y + top) / 2, -11, 1.0, h, 2.0, stepMat);
  }

  // ---------- ARCHIVE (basement) ----------
  addFloor(-14.25, -5, 11.8, 10.3, ARCHIVE_Y, floorArchiveMat);
  // ceiling kept below ground level: the server room stands on the floor above
  addCeiling(-14.25, -5, 11.8, 10.3, -0.05);
  addWall(-12.2, -10.15, 3.6, 0.3, ARCHIVE_Y, -0.05, wallYellowMat); // north, right of basement door; starts at the stairwell wall
  // the stairwell's south wall also forms this stretch of the archive's north
  // wall; clad its archive face so the room stays papered instead of showing
  // the bare plaster of the stair shaft
  addBox(-16.175, (ARCHIVE_Y - 0.05) / 2, -9.98, 4.35, -0.05 - ARCHIVE_Y, 0.02, wallYellowMat);
  addWall(-8.775, -10.15, 0.85, 0.3, ARCHIVE_Y, -0.05, wallYellowMat); // north, east of the vent exit
  // header closing the top of the vent exit: the vent ceiling sits at -0.1, so
  // without it the 6 cm strip between that and the archive ceiling opens into
  // the plenum above and corridor B's red wallpaper shows as a bright sliver
  addBox(-9.8, -0.07, -10.075, 1.2, 0.06, 0.15, wallYellowMat);
  addWall(-14.25, 0.15, 11.8, 0.3, ARCHIVE_Y, -0.05, wallYellowMat); // south
  addWall(-20.15, -10.075, 0.3, 0.15, ARCHIVE_Y, -0.05, wallYellowMat); // west jamb above the editing door
  addWall(-20.15, -4.175, 0.3, 8.65, ARCHIVE_Y, -0.05, wallYellowMat); // west, south of editing door
  addWall(-8.35, -5, 0.3, 10.3, ARCHIVE_Y, -0.05, wallYellowMat); // east

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
  addWall(-20.15, -13.675, 0.3, 3.05, -4.5, 0.3, wallPlasterMat); // west
  addWall(-18.15, -13.675, 0.3, 3.05, -4.5, 0.3, wallPlasterMat); // east
  addCeiling(-19.15, -13.675, 2.0, 3.05, 0.3);
  // visual lintels so the low service shaft never opens onto black void
  addBox(-19.15, (0.3 + H) / 2, -12.15, 2.0, H - 0.3, 0.34, wallPlasterMat);
  addBox(-19.15, (-1.35 + 0.3) / 2, -15.2, 2.0, 1.65, 0.34, wallPlasterMat);
  for (let k = 1; k <= 5; k++) {
    const top = -3 - 0.25 * k;
    const zc = -12.15 - (k - 0.5) * (3.05 / 6);
    addBox(-19.15, (-4.5 + top) / 2, zc, 1.7, top + 4.5, 3.05 / 6, stepMat);
  }
  addFloor(-19.15, -14.947, 1.7, 0.508, -4.5, floorBasementMat);

  // ---------- TECHNICAL BASEMENT (-4.5 m) ----------
  addFloor(-16.2, -20.2, 8, 10, -4.5, floorBasementMat);
  addCeiling(-16.2, -20.2, 8, 10, -1.35);
  addWall(-20.2, -20.2, 0.3, 10.3, -4.5, -1.35, wallPlasterMat); // west
  addWall(-12.2, -20.8, 0.3, 8.8, -4.5, -1.35, wallPlasterMat); // east, south of the vent opening
  addWall(-16.2, -25.2, 8.3, 0.3, -4.5, -1.35, wallPlasterMat); // north
  addWall(-15.175, -15.2, 5.95, 0.3, -4.5, -1.35, wallPlasterMat); // south, right of the stair opening

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
  addBox(-12.2, (-1.35 - 0.1) / 2, -15.8, 0.34, 1.25, 1.2, wallPlasterMat); // lintel over the basement opening
  addWall(-10.7, -16.4, 3.0, 0.3, -4.5, -0.1, wallPlasterMat); // north
  addWall(-11.3, -15.2, 1.8, 0.3, -4.5, -0.1, wallPlasterMat); // south, west of the turn
  addWall(-10.4, -12.675, 0.3, 5.05, -4.5, -0.1, wallPlasterMat); // west
  addWall(-9.2, -13.275, 0.3, 6.25, -4.5, -0.1, wallPlasterMat); // east
  addCeiling(-10.7, -15.8, 3.0, 1.2, -0.1);
  addCeiling(-9.8, -12.675, 1.2, 5.05, -0.1);
  addFloor(-10.7, -15.8, 3.0, 1.2, -4.5, floorBasementMat);
  addFloor(-9.8, -14.3, 1.2, 1.8, -4.5, floorBasementMat);
  for (let k = 1; k <= 6; k++) {
    const top = -4.5 + 0.25 * k;
    const zc = -13.4 + (k - 0.5) * (3.25 / 6);
    addBox(-9.8, (-4.5 + top) / 2, zc, 1.2, top + 4.5, 3.25 / 6, stepMat);
  }

  // ---------- EDITING ROOM (west of the archive) ----------
  addFloor(-23.225, -7.65, 6.15, 5, ARCHIVE_Y, floorEditMat);
  addCeiling(-23.225, -7.65, 6.15, 5, -0.05);
  addWall(-26.3, -7.65, 0.3, 5.3, ARCHIVE_Y, -0.05, wallWoodMat); // west
  addWall(-23.225, -10.15, 6.45, 0.3, ARCHIVE_Y, -0.05, wallWoodMat); // north
  addWall(-23.225, -5.15, 6.45, 0.3, ARCHIVE_Y, -0.05, wallWoodMat); // south

  // doorway in the archive west wall
  addBox(-20.15, -0.475, -9.25, 0.34, 0.85, 1.5, wallYellowMat); // lintel, visual only
  addBox(-20.15, -1.95, -10.0, 0.36, 2.1, 0.08, frameMat);
  addBox(-20.15, -1.95, -8.5, 0.36, 2.1, 0.08, frameMat);

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

  // ---------- BEDROOM (south of the archive, west of the control room) ----------
  addFloor(-13.25, 2.65, 9.9, 4.7, 0, floorBedroomMat);
  addCeiling(-13.25, 2.65, 9.9, 4.7, H);
  addWall(-13.3, 0.15, 10.0, 0.3, 0, H, wallGreenMat); // north, butts the archive wall below
  addWall(-18.35, 2.65, 0.3, 5.3, 0, H, wallGreenMat); // west
  addWall(-13.3, 5.15, 10.0, 0.3, 0, H, wallGreenMat); // south, meets the control-room back wall

  // doorway in the control room's west wall
  addBox(-8.15, (2.3 + H) / 2, 2.5, 0.34, H - 2.3, 1.0, wallGreenMat); // lintel, visual only
  makeDoor(-8.15, 2.0, -8.15, 3.0);

  const bedFrameMat = wood("wood_27_256_.png", 1.0, 0x8a8073);
  const mattressMat = new THREE.MeshLambertMaterial({ color: 0x8d897c, emissive: 0x0c0d0b });
  const blanketMat = new THREE.MeshLambertMaterial({ color: 0x3f4640, emissive: 0x080a09 });
  const pillowMat = new THREE.MeshLambertMaterial({ color: 0xa5a294, emissive: 0x0e0f0c });

  // double bed, headboard against the west wall
  addBox(-18.14, 0.62, 2.65, 0.08, 1.24, 1.62, bedFrameMat);
  addBox(-17.12, 0.22, 2.65, 1.94, 0.44, 1.56, bedFrameMat);
  addBox(-17.1, 0.5, 2.65, 1.86, 0.18, 1.46, mattressMat);
  addBox(-17.72, 0.64, 2.65, 0.42, 0.12, 1.2, pillowMat);
  addBox(-16.68, 0.615, 2.65, 1.22, 0.09, 1.5, blanketMat);
  addCollider(-18.2, -16.12, 1.84, 3.46, 0, 0.9);

  // bedside table and lamp
  const nightTableMat = wood("wood_27_256_.png", 1.0, 0x827868);
  addBox(-18.0, 0.3, 1.55, 0.4, 0.6, 0.45, nightTableMat);
  addBox(-18.0, 0.66, 1.55, 0.16, 0.12, 0.16, new THREE.MeshLambertMaterial({ color: 0x2a2c28 }));
  addBox(-18.0, 0.8, 1.55, 0.03, 0.18, 0.03, new THREE.MeshLambertMaterial({ color: 0x2a2c28 }));
  addBox(-18.0, 0.92, 1.55, 0.26, 0.14, 0.26, new THREE.MeshBasicMaterial({ color: 0xc9a978 }));
  addCollider(-18.2, -17.8, 1.32, 1.78, 0, 0.7);

  // chest at the foot of the bed
  addBox(-15.85, 0.28, 2.65, 0.55, 0.56, 1.1, bedFrameMat);
  addCollider(-16.13, -15.57, 2.1, 3.2, 0, 0.6);

  // wardrobe against the south wall
  const wardrobeMat = wood("wood_7_256_.png", 1.2, 0x7b7267);
  addBox(-11.0, 1.05, 4.69, 1.8, 2.1, 0.6, wardrobeMat);
  addBox(-11.15, 1.15, 4.37, 0.04, 0.2, 0.03, steelMat);
  addBox(-10.85, 1.15, 4.37, 0.04, 0.2, 0.03, steelMat);
  addCollider(-11.9, -10.1, 4.39, 5.0, 0, 2.1);

  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 2.2),
    new THREE.MeshLambertMaterial({ color: 0x3b3830, emissive: 0x070605 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-14.6, 0.006, 2.9);
  scene.add(rug);

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
  fluorescent(3.2, 2.85, -9.2, false, 4.8); // kitchen
  fluorescent(-13.2, 2.85, 2.6, false, 3.2); // bedroom

  // bedside lamp glow
  const bedsideLight = new THREE.PointLight(0xffca86, 1.6, 5, 1.8);
  bedsideLight.position.set(-17.85, 0.92, 1.55);
  scene.add(bedsideLight);
  addGlow(-18.0, 0.92, 1.55, 0xffd09a, 0.6);

  // desk lamp with a green shade in the control room
  addBox(-2.2, 1.0, 4.2, 0.16, 0.06, 0.16, new THREE.MeshLambertMaterial({ color: 0x2a2c28 }));
  addBox(-2.2, 1.18, 4.2, 0.04, 0.36, 0.04, new THREE.MeshLambertMaterial({ color: 0x2a2c28 }));
  addBox(-2.2, 1.38, 4.18, 0.34, 0.16, 0.34, new THREE.MeshBasicMaterial({ color: 0x9fd8a8 }));
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
    if (x >= -1.85 && x <= 8.15 && z >= -13.15 && z <= -5.15) offer(0); // kitchen
    if (x >= -18.35 && x <= -8.15 && z >= 0.15 && z <= 5.15) offer(0); // bedroom
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

    for (const d of doors) {
      d.group.rotation.y += (d.targetAngle - d.group.rotation.y) * Math.min(1, dt * 7.5);
    }

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
    doors,
    toggleDoor,
    update,
    bounds: { minX: -26.2, maxX: 7.9, minZ: -25.5, maxZ: 4.9 },
    groundHeightAt,
    propsReady,
  };
}
