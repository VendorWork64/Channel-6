import * as THREE from "three";
import { buildWorld, type Collider } from "./world";
import { Post } from "./post";
import { startHum } from "./audio";

const app = document.getElementById("app")!;
const overlay = document.getElementById("overlay")!;
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

const player = {
  yaw: Math.PI,
  pitch: -0.02,
  radius: 0.36,
  speed: 3.1,
  sprint: 5.0,
};

if (debugView || rawView) {
  const q = new URLSearchParams(location.search);
  const px = parseFloat(q.get("px") ?? "0");
  const pz = parseFloat(q.get("pz") ?? "-2.6");
  const yawDeg = parseFloat(q.get("yaw") ?? "180");
  const pitchDeg = parseFloat(q.get("pitch") ?? "-1.1");
  camera.position.set(px, world.groundHeightAt(px, pz) + 1.65, pz);
  player.yaw = (yawDeg * Math.PI) / 180;
  player.pitch = (pitchDeg * Math.PI) / 180;
  camera.rotation.set(player.pitch, player.yaw, 0);
  if (debugView) (window as unknown as { __scene: THREE.Scene }).__scene = world.scene;
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

window.addEventListener("keydown", (e) => {
  keys.add(e.code);
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
});

window.addEventListener("blur", () => keys.clear());

function resolveCollisions(pos: THREE.Vector3, colliders: Collider[], radius: number) {
  const feet = pos.y - 1.65;
  for (const c of colliders) {
    if (c.maxY !== undefined && !(c.maxY > feet + 0.2 && (c.minY ?? -Infinity) < feet + 1.6)) continue;
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

  if (locked) {
    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);

    if (forward !== 0 || strafe !== 0) {
      const len = Math.hypot(forward, strafe);
      const speed = keys.has("ShiftLeft") ? player.sprint : player.speed;
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);

      const dx = ((-sin * forward + cos * strafe) / len) * speed * dt;
      const dz = ((-cos * forward - sin * strafe) / len) * speed * dt;

      camera.position.x += dx;
      camera.position.z += dz;

      resolveCollisions(camera.position, world.colliders, player.radius);
      camera.position.x = THREE.MathUtils.clamp(camera.position.x, world.bounds.minX, world.bounds.maxX);
      camera.position.z = THREE.MathUtils.clamp(camera.position.z, world.bounds.minZ, world.bounds.maxZ);

      bobPhase += dt * speed * 2.6;
    } else {
      bobPhase += dt * 1.2;
    }

    const groundY = world.groundHeightAt(
      camera.position.x,
      camera.position.z,
      camera.position.y - 1.65,
    );
    camera.position.y = groundY + 1.65 + Math.sin(bobPhase) * 0.028;
    camera.rotation.set(player.pitch, player.yaw, Math.sin(bobPhase * 0.5) * 0.002);
  }

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
