import * as THREE from "three";
import { buildWorld, type Collider, type Door } from "./world";
import { Post } from "./post";
import { startHum } from "./audio";

const app = document.getElementById("app")!;
const overlay = document.getElementById("overlay")!;
const promptEl = document.getElementById("prompt")!;
const debugView = new URLSearchParams(location.search).has("debug");
const rawView = new URLSearchParams(location.search).has("raw");
const postEnabled = false; // временно выключен ASCII/VHS-эффект
if (debugView || rawView) overlay.classList.add("hidden");

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(
  68,
  window.innerWidth / window.innerHeight,
  0.15,
  40,
);
camera.rotation.order = "YXZ";
camera.position.set(0, 1.65, -2.6);

const world = buildWorld();
const post = new Post(renderer);

type Stance = "stand" | "crouch" | "prone";

const EYE = { stand: 1.65, crouch: 0.98, prone: 0.45 };
const STANCE_SPEED = { stand: 3.1, crouch: 1.5, prone: 0.72 };

const player = {
  yaw: Math.PI,
  pitch: -0.02,
  radius: 0.36,
  speed: 3.1,
  sprint: 5.0,
  stance: "stand" as Stance,
  eye: EYE.stand,
  feetY: 0,
  vy: 0,
  grounded: true,
};

const GRAVITY = 18;
const JUMP_SPEED = 4.6;
const DOUBLE_TAP_MS = 320;
let lastCtrlTap = -Infinity;

if (debugView || rawView) {
  const q = new URLSearchParams(location.search);
  const px = parseFloat(q.get("px") ?? "0");
  const pz = parseFloat(q.get("pz") ?? "-2.6");
  const yawDeg = parseFloat(q.get("yaw") ?? "180");
  const pitchDeg = parseFloat(q.get("pitch") ?? "-1.1");
  player.feetY = world.groundHeightAt(px, pz);
  camera.position.set(px, player.feetY + player.eye, pz);
  player.yaw = (yawDeg * Math.PI) / 180;
  player.pitch = (pitchDeg * Math.PI) / 180;
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (debugView) {
    (window as unknown as { __scene: THREE.Scene }).__scene = world.scene;
    (window as unknown as { __debug: unknown }).__debug = { camera, world, player, resolveCollisions };
  }
}

const keys = new Set<string>();
let locked = false;
let bobPhase = 0;

overlay.addEventListener("click", () => {
  renderer.domElement.requestPointerLock();
  startHum();
});

document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
  overlay.classList.toggle("hidden", locked);
  if (!locked) keys.clear();
});

document.addEventListener("mousemove", (e) => {
  if (!locked) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0022;
  player.pitch = THREE.MathUtils.clamp(player.pitch, -1.3, 1.3);
});

function crouchPress() {
  const now = performance.now();
  if (player.stance === "prone") {
    player.stance = "stand";
    lastCtrlTap = -Infinity;
    return;
  }
  if (now - lastCtrlTap < DOUBLE_TAP_MS) {
    player.stance = "prone";
    lastCtrlTap = -Infinity;
    return;
  }
  lastCtrlTap = now;
  player.stance = "crouch";
}

function crouchRelease() {
  if (player.stance === "crouch") player.stance = "stand";
}

window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat && (locked || debugView) && player.grounded && player.stance !== "prone") {
      player.vy = JUMP_SPEED;
      player.grounded = false;
    }
  }
  if ((e.code === "ControlLeft" || e.code === "ControlRight") && !e.repeat && (locked || debugView)) {
    crouchPress();
  }
  if (e.code === "KeyE" && !e.repeat && (locked || debugView)) {
    const door = findNearbyDoor();
    if (door) world.toggleDoor(door, camera.position.x, camera.position.z);
  }
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (e.code === "ControlLeft" || e.code === "ControlRight") crouchRelease();
});

window.addEventListener("blur", () => {
  keys.clear();
  crouchRelease();
});

const DOOR_REACH = 2.3;
const DOOR_VIEW_DOT = 0.35;

function findNearbyDoor(): Door | null {
  const vx = -Math.sin(player.yaw);
  const vz = -Math.cos(player.yaw);
  let best = DOOR_REACH;
  let found: Door | null = null;
  for (const d of world.doors) {
    const dx = d.center.x - camera.position.x;
    const dz = d.center.z - camera.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist >= best) continue;
    if (dist > 0.001 && (dx * vx + dz * vz) / dist < DOOR_VIEW_DOT) continue;
    best = dist;
    found = d;
  }
  return found;
}

function resolveCollisions(
  pos: THREE.Vector3,
  colliders: Collider[],
  radius: number,
  feetY = pos.y - 1.65,
  bodyH = 1.65,
) {
  for (const c of colliders) {
    if (c.maxY !== undefined && !(c.maxY > feetY + 0.2 && (c.minY ?? -Infinity) < feetY + bodyH)) continue;
    const minX = c.minX - radius;
    const maxX = c.maxX + radius;
    const minZ = c.minZ - radius;
    const maxZ = c.maxZ + radius;
    if (pos.x <= minX || pos.x >= maxX || pos.z <= minZ || pos.z >= maxZ) continue;

    const pushLeft = pos.x - minX;
    const pushRight = maxX - pos.x;
    const pushFront = pos.z - minZ;
    const pushBack = maxZ - pos.z;
    const m = Math.min(pushLeft, pushRight, pushFront, pushBack);

    if (m === pushLeft) pos.x = minX;
    else if (m === pushRight) pos.x = maxX;
    else if (m === pushFront) pos.z = minZ;
    else pos.z = maxZ;
  }
}

const clock = { last: performance.now(), elapsed: 0, stopped: false };

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = clock.stopped ? 0 : Math.min((now - clock.last) / 1000, 0.05);
  clock.last = now;
  if (!clock.stopped) clock.elapsed += dt;
  const time = clock.elapsed;

  if (locked || debugView) {
    if (locked) {
      const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
      const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);

      if (forward !== 0 || strafe !== 0) {
        const len = Math.hypot(forward, strafe);
        const speed =
          player.stance === "stand"
            ? keys.has("ShiftLeft")
              ? player.sprint
              : player.speed
            : STANCE_SPEED[player.stance];
        const sin = Math.sin(player.yaw);
        const cos = Math.cos(player.yaw);

        const dx = ((-sin * forward + cos * strafe) / len) * speed * dt;
        const dz = ((-cos * forward - sin * strafe) / len) * speed * dt;

        camera.position.x += dx;
        camera.position.z += dz;

        resolveCollisions(camera.position, world.colliders, player.radius, player.feetY, player.eye);
        camera.position.x = THREE.MathUtils.clamp(camera.position.x, world.bounds.minX, world.bounds.maxX);
        camera.position.z = THREE.MathUtils.clamp(camera.position.z, world.bounds.minZ, world.bounds.maxZ);

        bobPhase += dt * speed * (player.stance === "stand" ? 2.6 : 2.0);
      } else {
        bobPhase += dt * (player.stance === "prone" ? 0.6 : 1.2);
      }
    }

    const groundY = world.groundHeightAt(camera.position.x, camera.position.z, player.feetY);
    if (player.grounded) {
      if (groundY > player.feetY - 0.45) {
        player.feetY = groundY;
      } else {
        player.grounded = false;
        player.vy = 0;
      }
    }
    if (!player.grounded) {
      player.vy -= GRAVITY * dt;
      player.feetY += player.vy * dt;
      if (player.feetY <= groundY) {
        player.feetY = groundY;
        player.vy = 0;
        player.grounded = true;
      }
    }

    const targetEye = EYE[player.stance];
    player.eye += (targetEye - player.eye) * Math.min(1, dt * 9);
    const bobAmp = player.stance === "prone" ? 0.008 : player.stance === "crouch" ? 0.018 : 0.028;
    camera.position.y = player.feetY + player.eye + Math.sin(bobPhase) * bobAmp;
    camera.rotation.set(player.pitch, player.yaw, Math.sin(bobPhase * 0.5) * 0.002);
  }

  const doorNear = locked || debugView ? findNearbyDoor() : null;
  promptEl.classList.toggle("visible", !!doorNear);

  world.update(time, dt);
  if (!postEnabled || rawView) {
    renderer.render(world.scene, camera);
  } else {
    post.render(world.scene, camera, time);
  }
}

frame();

window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.resize(w, h, Math.min(window.devicePixelRatio, 2));
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) clock.stopped = true;
  else {
    clock.stopped = false;
    clock.last = performance.now();
  }
});
