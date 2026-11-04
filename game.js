import * as THREE from './vendor/three.module.js';

// ------------------------------------------------------------------ constants
const EYE = 1.7;
const RADIUS = 0.45;
const GRAVITY = 9.8;
const WALK_SPEED = 5;
const SPRINT_SPEED = 7.5;
const DEBRIS_GRAVITY = 9.8;
const FOOT_LIFE_MS = 9000;
const FOOT_SPACING_MS = 220;
const ENTITY_SPEED = 3.4;
const ENTITY_KILL_DIST_SQ = 4; // 2.0 m
const DOOR_POS = new THREE.Vector3(39.9, 1.7, 0);
const DOOR_INTERACT_DIST = 3.5;
const MAX_FALL_Y = -40;
const TRAIL_MAX = 8;
const ECHO_COLOR = 0x35f2c0;

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04060a);
scene.fog = new THREE.FogExp2(0x0a0e14, 0.035);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 400);
scene.add(camera);

const hemi = new THREE.HemisphereLight(0x33415e, 0x04060a, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xaecfff, 2.2);
sun.position.set(14, 26, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -25;
sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25;
sun.shadow.camera.bottom = -25;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0004;
scene.add(sun);
const moon = new THREE.PointLight(0x2a3a6a, 25, 60);
moon.position.set(-8, 12, -6);
scene.add(moon);
const rim = new THREE.PointLight(0x7a2a4a, 10, 50);
rim.position.set(20, 8, -12);
scene.add(rim);

// ------------------------------------------------------------------ DOM
const overlay = document.getElementById('overlay');
const overlayAccept = document.getElementById('overlay-accept');
const overlayDead = document.getElementById('overlay-dead');
const overlayWin = document.getElementById('overlay-win');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const acceptLine1 = document.getElementById('accept-line-1');
const acceptLine2 = document.getElementById('accept-line-2');
const acceptLine3 = document.getElementById('accept-line-3');
const deadLine = document.getElementById('dead-line');
const deadSub = document.getElementById('dead-sub');
const winLine = document.getElementById('win-line');
const winSub = document.getElementById('win-sub');
const hud = document.getElementById('hud');
const fpCountEl = document.getElementById('fp-count');
const blinkHint = document.getElementById('blink-hint');
const interactHint = document.getElementById('interact-hint');
const crosshair = document.getElementById('crosshair');

function show(el) { el.style.display = 'flex'; }
function hide(el) { el.style.display = 'none'; }

// ------------------------------------------------------------------ state
let stateName = 'menu';
function setState(s) { stateName = s; }

// ------------------------------------------------------------------ player
const player = {
  feet: new THREE.Vector3(-28, 0, 0),
  vel: new THREE.Vector3(),
  G: new THREE.Vector3(0, -1, 0),
  up: new THREE.Vector3(0, 1, 0),
  yaw: -Math.PI / 2,
  pitch: 0,
  grounded: true,
};
player.up.copy(player.G).negate();

const playerMesh = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.33, 0.8, 4, 12),
  new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.9, metalness: 0.2 })
);
playerMesh.position.set(0, 0.72, 0);
scene.add(playerMesh);

// ------------------------------------------------------------------ colliders
const colliders = [];
function addCollider(min, max) {
  colliders.push({ min: new THREE.Vector3(min[0], min[1], min[2]), max: new THREE.Vector3(max[0], max[1], max[2]) });
}
function makeBoxCollider(min, max, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
    new THREE.MeshStandardMaterial({ color: color || 0x14161c, roughness: 0.95, metalness: 0.05 })
  );
  mesh.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);
  colliders.push({ min: new THREE.Vector3(min[0], min[1], min[2]), max: new THREE.Vector3(max[0], max[1], max[2]) });
  colliderMeshes.push(mesh);
}
const colliderMeshes = [];
makeBoxCollider([-40, -1, -13], [-12, 0, 13], 0x14161c);
makeBoxCollider([-9, -1, -13], [40, 0, 13], 0x14161c);
makeBoxCollider([40, 0, -5], [52, 5, 5], 0x181b22);

// ------------------------------------------------------------------ debris + sonic echoes
const debris = [];
function makeDebris(x, y, z, sx, sy, sz, color) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.85 })
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  const vel = new THREE.Vector3();
  const trail = [];
  const line = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({
      color: ECHO_COLOR,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  line.frustumCulled = false;
  scene.add(line);
  line.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
  const attr = line.geometry.getAttribute('position');
  return { mesh, vel, trail, line, attr, material: line.material };
}
function debrisReset() {
  for (const d of debris) {
    scene.remove(d.mesh);
    d.mesh.geometry.dispose();
    d.mesh.material.dispose();
    d.line.geometry.dispose();
    d.line.material.dispose();
  }
  debris.length = 0;
  debris.push(
    makeDebris(-20, 0.45, 1, 2.0, 0.85, 4.2, 0x22252c),
    makeDebris(-20, 0.85, -0.8, 1.6, 0.75, 2.2, 0x1c1f26),
    makeDebris(-26, 0.5, 6, 1.0, 1.0, 1.0, 0x2e3138),
    makeDebris(-24, 0.9, 6, 0.9, 0.9, 0.9, 0x26292f)
  );
  debris[1].vel.set(0.8, 3.0, -0.6);
  debris[0].vel.set(-0.6, 1.5, 0.3);
  for (const d of debris) { d.trail.length = 0; d.material.opacity = 0; d.line.geometry.setDrawRange(0, 0); }
}
debrisReset();

// ------------------------------------------------------------------ trees
const treeMat = new THREE.MeshStandardMaterial({ color: 0x14211a, roughness: 1, metalness: 0 });
function addTree(x, z, r, h) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.35, r * 0.45, h * 0.35, 6), treeMat);
  trunk.position.y = -h * 0.17;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.85, 7), treeMat);
  crown.position.y = -h * 0.55;
  crown.castShadow = true;
  g.add(trunk, crown);
  g.position.set(x, 0, z);
  scene.add(g);
}
for (let i = 0; i < 22; i++) {
  const x = -30 + Math.random() * 60;
  const z = (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 2.5);
  addTree(x, z, 0.9 + Math.random() * 0.5, 4 + Math.random() * 2.5);
}

// ------------------------------------------------------------------ footprints
const footprints = [];
function spawnFootprint(pos) {
  spawnCount++;
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.44, 8),
    new THREE.MeshBasicMaterial({
      color: ECHO_COLOR,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(pos.x, 0.015, pos.z);
  scene.add(mesh);
  footprints.push({ pos: pos.clone(), time: performance.now(), consumed: false, mesh });
  if (footprints.length > 40) {
    const old = footprints.shift();
    old.consumed = true;
    scene.remove(old.mesh);
  }
}
function clearFootprints() {
  for (const fp of footprints) scene.remove(fp.mesh);
  footprints.length = 0;
}
function updateFootprints(dt) {
  const now = performance.now();
  for (let i = footprints.length - 1; i >= 0; i--) {
    const fp = footprints[i];
    const age = (now - fp.time) / 1000;
    if (fp.consumed || age > FOOT_LIFE_MS / 1000) {
      fp.consumed = true;
      scene.remove(fp.mesh);
      footprints.splice(i, 1);
      continue;
    }
    fp.mesh.position.set(fp.pos.x, 0.015, fp.pos.z);
    fp.mesh.material.opacity = Math.max(0, 0.8 * (1 - age / (FOOT_LIFE_MS / 1000)));
  }
}

// ------------------------------------------------------------------ entity
const entity = { pos: new THREE.Vector3(-6, 0, 6) };
function updateEntity(dt) {
  let best = null;
  let bestD = Infinity;
  for (const fp of footprints) {
    if (fp.consumed) continue;
    const d = entity.pos.distanceToSquared(fp.pos);
    if (d < bestD) { bestD = d; best = fp; }
  }
  if (best) {
    const dir = best.pos.clone().sub(entity.pos);
    if (dir.lengthSq() > 1e-8) { dir.normalize(); entity.pos.addScaledVector(dir, ENTITY_SPEED * dt); }
    if (entity.pos.distanceToSquared(best.pos) < 1.0) best.consumed = true;
  }
  return entity.pos.distanceToSquared(player.feet) < ENTITY_KILL_DIST_SQ;
}

// ------------------------------------------------------------------ blink
function blink() {
  const theta = THREE.MathUtils.degToRad(30 + Math.random() * 50);
  const phi = Math.random() * Math.PI * 2;
  player.G.set(Math.sin(theta) * Math.cos(phi), -Math.cos(theta), Math.sin(theta) * Math.sin(phi));
  player.G.normalize();
  player.up.copy(player.G).negate();
  player.vel.copy(player.G).multiplyScalar(1.5);
  for (const d of debris) { if (d.vel.length() < 0.6) d.vel.copy(player.G).multiplyScalar(0.8); }
}

// ------------------------------------------------------------------ input
const keys = new Set();
let sprint = false;
function tryInteract() {
  if (stateName !== 'playing') return;
  if (player.feet.distanceTo(DOOR_POS) < DOOR_INTERACT_DIST) startAccept();
}
function onKeyDown(e) {
  if (stateName !== 'playing') return;
  keys.add(e.code);
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') blink();
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') sprint = true;
  if (e.code === 'KeyE') tryInteract();
}
function onKeyUp(e) {
  keys.delete(e.code);
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') sprint = false;
}
function onMouseMove(e) {
  if (stateName !== 'playing') return;
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0022;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
}
function onCtxMenu(e) { e.preventDefault(); }

// ------------------------------------------------------------------ physics helpers
function collideSphereBox(pos, radius, box) {
  const d = new THREE.Vector3();
  d.copy(pos);
  d.x = Math.max(box.min.x, Math.min(pos.x, box.max.x));
  d.y = Math.max(box.min.y, Math.min(pos.y, box.max.y));
  d.z = Math.max(box.min.z, Math.min(pos.z, box.max.z));
  const diff = pos.clone().sub(d);
  const dist2 = diff.lengthSq();
  if (dist2 > radius * radius) return false;
  if (dist2 > 1e-8) {
    const dist = Math.sqrt(dist2);
    pos.addScaledVector(diff, (radius - dist) / dist);
    return true;
  }
  const overlap = radius - 0.01;
  if (pos.x - box.min.x < overlap) { pos.x = box.min.x - overlap; return true; }
  if (box.max.x - pos.x < overlap) { pos.x = box.max.x + overlap; return true; }
  if (pos.y - box.min.y < overlap) { pos.y = box.min.y - overlap; return true; }
  if (box.max.y - pos.y < overlap) { pos.y = box.max.y + overlap; return true; }
  if (pos.z - box.min.z < overlap) { pos.z = box.min.z - overlap; return true; }
  pos.z = box.max.z + overlap;
  return true;
}
const raycaster = new THREE.Raycaster();
function raycast(origin, dir) {
  raycaster.set(origin, dir);
  const hits = raycaster.intersectObjects(colliderMeshes, true);
  return hits.length ? hits[0] : null;
}

// ------------------------------------------------------------------ states
let acceptTimer = null;
function startAccept() {
  if (stateName !== 'playing') return;
  setState('accepting');
  show(overlayAccept);
  hide(overlay);
  hide(overlayDead);
  hide(overlayWin);
  hide(interactHint);
  acceptLine1.textContent = 'You were not a passenger.';
  acceptLine2.textContent = 'You were the crash.';
  acceptLine3.textContent = 'The thing that hunts you is the moment you stopped being alive.';
  if (acceptTimer) clearTimeout(acceptTimer);
  acceptTimer = setTimeout(() => { setState('won'); show(overlayWin); hide(overlayAccept); }, 5200);
}
function die() {
  setState('dead');
  hide(overlay);
  hide(overlayAccept);
  hide(overlayWin);
  show(overlayDead);
}
function beginRun() {
  resetWorld();
  setState('playing');
  hide(overlay);
  hide(overlayDead);
  hide(overlayWin);
  hide(overlayAccept);
  hide(interactHint);
  hide(blinkHint);
  if (acceptTimer) { clearTimeout(acceptTimer); acceptTimer = null; }
  keys.clear();
  sprint = false;
  try { canvas.requestPointerLock(); } catch (e) { /* ignore */ }
}
function resetWorld() {
  player.feet.set(-28, 0, 0);
  player.vel.set(0, 0, 0);
  player.G.set(0, -1, 0);
  player.up.copy(player.G).negate();
  player.yaw = -Math.PI / 2;
  player.pitch = 0;
  player.grounded = true;
  camera.position.set(-28, EYE, 0);
  debrisReset();
  clearFootprints();
  entity.pos.set(-6, 0, 6);
}

startBtn.addEventListener('click', beginRun);
restartBtn.addEventListener('click', beginRun);
document.getElementById('restart-win-btn').addEventListener('click', beginRun);
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  document.body.classList.toggle('locked', locked);
  if (!locked && stateName === 'playing') {
    setState('menu');
    show(overlay);
    hide(overlayDead);
    hide(overlayWin);
    hide(overlayAccept);
    hide(interactHint);
  }
});

// ------------------------------------------------------------------ update
let lastFootSpawn = 0;
let spawnCount = 0;
function updatePlaying(dt) {
  const p = player;

  let ix = 0, iz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  const wish = new THREE.Vector3(ix, 0, -iz);
  const wishLen = wish.length();
  if (wishLen > 0) wish.normalize().multiplyScalar(wishLen * (sprint ? SPRINT_SPEED : WALK_SPEED));
  p.vel.add(wish);
  p.vel.addScaledVector(p.G, GRAVITY * dt);
  p.feet.addScaledVector(p.vel, dt);
  if (p.feet.y < MAX_FALL_Y) die();

  const currentSpeed = p.vel.length();
  for (const c of colliders) { if (collideSphereBox(p.feet, RADIUS, c)) { p.vel.set(0, 0, 0); break; } }
  const eye = p.feet.clone().addScaledVector(p.up, EYE);

  const hit = raycast(eye, p.G);
  if (hit && hit.distance > 0.8 && hit.distance < 4.0) {
    p.grounded = true;
    p.feet.copy(hit.point);
    p.vel.set(0, 0, 0);
  } else {
    p.grounded = false;
  }

  for (const d of debris) {
    d.mesh.position.addScaledVector(d.vel, dt);
    d.vel.addScaledVector(p.G, DEBRIS_GRAVITY * dt);
    let hitC = false;
    for (const c of colliders) { if (collideSphereBox(d.mesh.position, 0.4, c)) { hitC = true; break; } }
    if (hitC) d.vel.multiplyScalar(0.25);
    if (d.vel.length() > 0.3) {
      d.material.opacity = 0.9;
      d.trail.push(d.mesh.position.clone());
      if (d.trail.length > TRAIL_MAX) d.trail.shift();
      const arr = d.attr.array;
      const n = d.trail.length;
      for (let i = 0; i < n; i++) {
        arr[i * 3] = d.trail[i].x;
        arr[i * 3 + 1] = d.trail[i].y;
        arr[i * 3 + 2] = d.trail[i].z;
      }
      d.attr.needsUpdate = true;
      d.line.geometry.setDrawRange(0, Math.max(1, n));
    } else {
      d.material.opacity -= dt * 1.5;
      if (d.material.opacity <= 0) { d.trail.length = 0; d.line.geometry.setDrawRange(0, 0); }
    }
  }
  for (const d of debris) {
    const dist = p.feet.distanceTo(d.mesh.position);
    if (dist < RADIUS + 0.45) {
      const push = new THREE.Vector3().subVectors(d.mesh.position, p.feet);
      if (push.lengthSq() > 1e-8) {
        push.normalize();
        d.mesh.position.addScaledVector(push, 0.5);
        d.vel.addScaledVector(push, 5);
      }
    }
  }

  if (p.grounded) {
    const now = performance.now();
    if (currentSpeed > 0.4 && now - lastFootSpawn > FOOT_SPACING_MS) {
      lastFootSpawn = now;
      spawnFootprint(p.feet);
    }
  }

  if (updateEntity(dt)) die();
  if (eye.y < MAX_FALL_Y) die();

  const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.pitch, p.yaw, 0, 'YXZ'));
  const upCur = new THREE.Vector3(0, 1, 0).applyQuaternion(q0);
  const angle = Math.acos(THREE.MathUtils.clamp(upCur.dot(p.up), -1, 1));
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(q0);
  const qLocal = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  camera.quaternion.copy(q0).multiply(qLocal);
  camera.position.copy(eye);
  const tiltQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.up);
  playerMesh.quaternion.copy(tiltQuat);
}

// ------------------------------------------------------------------ overlay state
function updateOverlayState() {
  const playing = stateName === 'playing';
  crosshair.style.display = playing && document.pointerLockElement === canvas ? 'block' : 'none';
  blinkHint.style.display = playing ? 'block' : 'none';
  interactHint.style.display = playing ? 'block' : 'none';
  hud.style.display = playing ? 'block' : 'none';
  overlay.style.display = stateName === 'menu' ? 'flex' : 'none';
  overlayAccept.style.display = stateName === 'accepting' ? 'flex' : 'none';
  overlayDead.style.display = stateName === 'dead' ? 'flex' : 'none';
  overlayWin.style.display = stateName === 'won' ? 'flex' : 'none';
  fpCountEl.textContent = String(footprints.length);
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (stateName === 'playing') updatePlaying(dt);
  renderer.render(scene, camera);
  updateOverlayState();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------ debug handle
window.__game = {
  get state() { return stateName; },
  get feet() { return player.feet; },
  get vel() { return player.vel; },
  get G() { return player.G; },
  get grounded() { return player.grounded; },
  get entity() { return entity.pos; },
  get footprintCount() { return footprints.length; },
  get spawnCount() { return spawnCount; },
};

// ------------------------------------------------------------------ boot into menu
resetWorld();
setState('menu');
hide(overlayAccept);
hide(overlayDead);
hide(overlayWin);
hide(overlay);
hide(blinkHint);
hide(interactHint);
hide(crosshair);
updateOverlayState();

// ------------------------------------------------------------------ touch controls (basic)
function onTouchStart(e) { touchState = { x: 0, y: 0, lx: 0, ly: 0, active: false }; }
let touchState = { x: 0, y: 0, lx: 0, ly: 0, active: false };
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); touchState = { x: e.touches[0].clientX, y: e.touches[0].clientY, lx: e.touches[0].clientX, ly: e.touches[0].clientY, active: true }; }, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  if (stateName !== 'playing') return;
  if (!touchState.active) return;
  const t = e.touches[0];
  const dx = t.clientX - touchState.x;
  const dy = t.clientY - touchState.y;
  if (Math.abs(dx) + Math.abs(dy) > 12) {
    player.yaw -= dx * 0.0022;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * 0.0022));
    touchState.x = t.clientX; touchState.y = t.clientY;
  }
}, { passive: true });
canvas.addEventListener('touchend', (e) => { e.preventDefault(); touchState = { x: 0, y: 0, lx: 0, ly: 0, active: false }; }, { passive: false });
canvas.addEventListener('touchcancel', () => { touchState = { x: 0, y: 0, lx: 0, ly: 0, active: false }; }, { passive: false });
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
window.addEventListener('mousemove', onMouseMove);
window.addEventListener('contextmenu', onCtxMenu);

