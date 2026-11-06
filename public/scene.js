// The 3D side: the house (house.js), the VRM avatar, and its idle motion,
// blinking, gaze, body language, mood expressions, and audio-driven mouth.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { buildHouse, placeItem, ROOM } from './house.js';
import { CATALOG } from './house-config.js';
import { phaseFor } from './house-config.js';

// Returns right away with setHouse() (rebuild the house with new settings) and
// `loaded`, which resolves once the avatar is in.
export function createStage(canvas, { avatarUrl, house: houseSettings, getMouthLevel, getMood, getActivity, onProgress }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101318);
  // Soft reflections, so wood, glass and metal pick up the room around them.
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;

  // Start farther back on narrow (portrait) screens so the room still fits.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  const startAspect = window.innerWidth / window.innerHeight;
  camera.position.set(0, 1.42, 2.9 * Math.max(1, 1 / Math.sqrt(startAspect)));
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.18, 0);
  controls.enableDamping = true;
  controls.update();

  // Two ways to look. "twin": facing the twin, and you can only turn around it
  // (drag); the camera stops short of the walls and ceiling. "room": looking down
  // on the whole room from above, where you can turn and zoom. Switching glides
  // between them, and the view out the window is hidden from above, where it
  // would be a picture floating in the dark.
  const TWIN = { target: controls.target.clone(), distance: camera.position.distanceTo(controls.target), polar: 0, azimuth: 0 };
  {
    const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(TWIN.target));
    TWIN.polar = s.phi;
    TWIN.azimuth = s.theta;
  }
  const ROOM_VIEW = { target: new THREE.Vector3(0, 0, (ROOM.back + ROOM.front) / 2 - 0.35), distance: 16 * Math.max(1, 1 / Math.sqrt(startAspect)), polar: 0.12, azimuth: 0 };
  const LIMITS = {
    twin: { rotate: true, zoom: false, pan: false, minPolar: 1.0, maxPolar: 1.72, minDistance: 0.3, maxDistance: TWIN.distance },
    room: { rotate: true, zoom: true, pan: false, minPolar: 0, maxPolar: 0.6, minDistance: 7, maxDistance: ROOM_VIEW.distance * 1.15 },
  };
  let mode = 'twin';
  function applyLimits(name) {
    const l = LIMITS[name];
    controls.enableRotate = l.rotate;
    controls.enableZoom = l.zoom;
    controls.enablePan = l.pan;
    controls.minPolarAngle = l.minPolar;
    controls.maxPolarAngle = l.maxPolar;
    controls.minDistance = l.minDistance;
    controls.maxDistance = l.maxDistance;
  }
  applyLimits('twin');

  // Keeps the camera inside the room: on the line from what it's looking at, it
  // stops short of a wall, the ceiling or the floor, without losing its direction,
  // so turning back the other way moves it out to its full distance again.
  const INSIDE = { left: ROOM.left + 0.15, right: ROOM.right - 0.15, back: ROOM.back + 0.15, front: ROOM.front - 0.15, floor: 0.2, ceiling: ROOM.height - 0.12 };
  function keepInside(target, direction, distance) {
    let t = distance;
    const room = [['x', INSIDE.left, INSIDE.right], ['y', INSIDE.floor, INSIDE.ceiling], ['z', INSIDE.back, INSIDE.front]];
    for (const [axis, lo, hi] of room) {
      const d = direction[axis];
      if (d > 1e-6) t = Math.min(t, (hi - target[axis]) / d);
      else if (d < -1e-6) t = Math.min(t, (lo - target[axis]) / d);
    }
    return Math.max(0.3, t);
  }

  // The glide between the two: eased in and out over about a second and a half,
  // along a curve rather than a straight line.
  const FLIGHT_SECONDS = 1.6;
  let flight = null;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  function view(name) {
    if (!LIMITS[name] || (name === mode && !flight)) return;
    const to = name === 'room' ? ROOM_VIEW : TWIN;
    // Finish any leftover drift from a drag first, so it can't nudge the landing.
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    let turn = to.azimuth - from.theta;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn)); // the short way round
    flight = { name, t: 0, fromTarget: controls.target.clone(), toTarget: to.target, from, to, turn };
    mode = name;
    controls.enabled = false;
    canvas.dispatchEvent(new CustomEvent('viewchange', { detail: { mode } }));
  }

  const offset = new THREE.Vector3();
  const spherical = new THREE.Spherical();
  function moveCamera(dt) {
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / FLIGHT_SECONDS);
      const { from, to, t } = flight;
      // Going up, it rises before pulling back; coming down, it closes in before
      // dropping, so it never swings out through a wall.
      const early = ease(Math.min(1, t * 1.6));
      const k = ease(t);
      const [rise, reach] = flight.name === 'room' ? [early, k] : [k, early];
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, k);
      spherical.set(from.radius + (to.distance - from.radius) * reach, from.phi + (to.polar - from.phi) * rise, from.theta + flight.turn * k);
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical));
      // Inside the walls while below the ceiling; above it, the limit fades out
      // smoothly instead of letting go all at once.
      const extra = Math.max(0, camera.position.y - ROOM.height) * 6;
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      camera.position.x = clamp(camera.position.x, INSIDE.left - extra, INSIDE.right + extra);
      camera.position.z = clamp(camera.position.z, INSIDE.back - extra, INSIDE.front + extra);
      camera.position.y = Math.max(INSIDE.floor, camera.position.y);
      camera.lookAt(controls.target);
      if (flight.t >= 1) {
        flight = null;
        applyLimits(mode);
        controls.enabled = true;
        controls.update();
      }
    } else {
      controls.update();
      if (mode === 'twin') {
        controls.target.copy(TWIN.target);
        const direction = camera.position.clone().sub(TWIN.target).normalize();
        camera.position.copy(TWIN.target).addScaledVector(direction, keepInside(TWIN.target, direction, TWIN.distance));
      }
    }
    // The sky and view outside are only seen through the window, from inside.
    const inside = camera.position.y < ROOM.height;
    for (const mesh of house?.outside ?? []) mesh.visible = inside;
  }

  // Decorate state (see the bottom of this function).
  let decorating = false;
  let selected = null;
  let box = null;
  let drag = null;
  let callbacks = {};
  let house = null;
  let settings = houseSettings;
  function setHouse(next) {
    settings = next;
    if (house) {
      scene.remove(house.group);
      house.dispose();
    }
    house = buildHouse(settings);
    scene.add(house.group);
    highlight(selected); // keep the selection across rebuilds
    renderer.toneMappingExposure = house.exposure;
    scene.environmentIntensity = house.environmentIntensity;
  }
  setHouse(settings);
  // "Follow this Mac's clock": morning turns to day, day to sunset, and so on.
  setInterval(() => {
    if (settings.timeOfDay === 'auto' && phaseFor('auto') !== house.phase) setHouse(settings);
  }, 60_000);

  function resize() {
    const { innerWidth: w, innerHeight: h } = window;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const clock = new THREE.Clock();
  const motion = createMotion();
  // What the eyes look at: near the viewer, but it wanders the way real eyes do.
  const gaze = new THREE.Object3D();
  scene.add(gaze);
  let vrm = null;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (vrm) {
      const { x, y } = motion.update(vrm, clock.elapsedTime, dt, getMouthLevel(), getMood?.(), getActivity?.() ?? 'idle');
      gaze.position.copy(camera.position)
        .addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), x)
        .addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), y);
      vrm.update(dt);
    }
    moveCamera(dt);
    renderer.render(scene, camera);
  });

  // Whether the twin is home: when its schedule has it out, the room is empty.
  let present = true;
  function setPresent(here) {
    present = here;
    if (vrm) vrm.scene.visible = here;
  }

  const loaded = loadAvatar(avatarUrl, onProgress).then((avatar) => {
    vrm = avatar;
    vrm.scene.visible = present;
    scene.add(vrm.scene);
    if (vrm.lookAt) vrm.lookAt.target = gaze;
    return vrm;
  });
  // ---- Decorate: pick things up and move them ----------------------------------
  // In decorate mode, clicking a placed thing selects it; dragging moves it across
  // the floor, or along whichever wall you point at. The camera only orbits when
  // you're not holding something.
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function aim(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  function highlight(id) {
    if (box) {
      scene.remove(box);
      box.dispose();
      box = null;
    }
    selected = id && house?.items.get(id) ? id : null;
    if (selected && decorating) {
      box = new THREE.BoxHelper(house.items.get(selected), 0xffd27a);
      scene.add(box);
    }
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!decorating || event.button !== 0) return;
    aim(event);
    const hit = raycaster.intersectObjects([...house.items.values()], true)[0];
    let id = null;
    for (let o = hit?.object; o; o = o.parent) {
      if (o.userData.itemId) {
        id = o.userData.itemId;
        break;
      }
    }
    highlight(id);
    callbacks.onSelect?.(id);
    if (!id) return; // empty space: the camera orbits as usual
    controls.enabled = false;
    const item = { ...settings.items.find((i) => i.id === id) };
    drag = { id, item, wall: CATALOG[item.type]?.place === 'wall', from: `${item.x},${item.z},${item.y},${item.wall}` };
    canvas.setPointerCapture(event.pointerId);
  }, { capture: true });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    aim(event);
    const { item } = drag;
    if (drag.wall) {
      const walls = Object.entries(house.surfaces).filter(([name]) => name !== 'floor');
      const hits = walls.map(([name, mesh]) => [name, raycaster.intersectObject(mesh, false)[0]]).filter(([, h]) => h).sort((a, b) => a[1].distance - b[1].distance);
      if (!hits.length) return;
      const [wall, h] = hits[0];
      item.wall = wall;
      item.y = Math.min(ROOM.height - 0.3, Math.max(0.3, h.point.y));
      if (wall === 'back') item.x = h.point.x;
      else item.z = h.point.z;
    } else {
      const point = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
      if (!point) return;
      item.x = Math.min(ROOM.right - 0.25, Math.max(ROOM.left + 0.25, point.x));
      item.z = Math.min(ROOM.front - 0.25, Math.max(ROOM.back + 0.25, point.z));
    }
    placeItem(house.items.get(drag.id), item);
    box?.update();
  });

  const drop = () => {
    if (!drag) return;
    const { id, item, from } = drag;
    drag = null;
    controls.enabled = !flight;
    if (`${item.x},${item.z},${item.y},${item.wall}` === from) return; // just a click: nothing moved
    const round = (v) => Math.round(v * 100) / 100;
    callbacks.onMove?.(id, { x: round(item.x), z: round(item.z), y: round(item.y), wall: item.wall });
  };
  canvas.addEventListener('pointerup', drop);
  canvas.addEventListener('pointercancel', drop);

  function setDecorating(on, handlers = callbacks) {
    decorating = on;
    callbacks = handlers;
    canvas.style.cursor = on ? 'grab' : '';
    highlight(on ? selected : null);
  }

  return { setHouse, setPresent, setDecorating, select: highlight, view, get mode() { return mode; }, loaded };
}

async function loadAvatar(url, onProgress) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('That file is not a VRM avatar.');
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm); // VRM 0.x models face the other way
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
    if (obj.isMesh) obj.castShadow = true;
  });
  return vrm;
}

// Which of the avatar's built-in expressions each feeling shows as, and how much.
// Quieter feelings (curious, skeptical) only touch the face.
// A feeling can blend expressions: scared is wide eyes plus worry.
const FACES = {
  happy: { happy: 1 }, amused: { happy: 0.8 }, excited: { happy: 1, surprised: 0.25 }, proud: { happy: 0.7 }, grateful: { happy: 0.7 },
  delighted: { happy: 1, surprised: 0.3 }, relieved: { relaxed: 0.7, happy: 0.3 },
  curious: { surprised: 0.4 }, surprised: { surprised: 1 }, startled: { surprised: 1, sad: 0.2 }, confused: { surprised: 0.5 },
  scared: { surprised: 0.7, sad: 0.6 },
  skeptical: { angry: 0.45 }, annoyed: { angry: 0.8 }, angry: { angry: 1 }, disgusted: { angry: 0.6, sad: 0.3 },
  bored: { relaxed: 0.7 }, tired: { relaxed: 0.9 },
  nervous: { sad: 0.5, surprised: 0.2 }, worried: { sad: 0.6 }, sympathetic: { sad: 0.4 }, embarrassed: { sad: 0.5, happy: 0.15 },
  hurt: { sad: 0.9 }, sad: { sad: 1 },
};
// Feelings the body shows too: fear and shock lean back (and fear trembles).
const RECOIL = { scared: 1, startled: 0.8, surprised: 0.35, nervous: 0.3, disgusted: 0.4 };
const EXPRESSIONS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];

// Procedural life: breathing, relaxed arms, head drift, nods while talking,
// random blinks, a face that shows the twin's mood, a mouth that follows the
// loudness of the voice, and body language: eyes that glance away now and then,
// a look up and aside while thinking, nods while listening, a droop when low.
function createMotion() {
  let mouth = 0;
  let talking = 0;
  let thinking = 0;
  let listening = 0;
  let nextBlink = 1.5;
  let blinkStart = -1;
  const shown = Object.fromEntries(EXPRESSIONS.map((e) => [e, 0]));
  // Glances: every few seconds the eyes flick somewhere nearby, then come back.
  let glance = { x: 0, y: 0 };
  let glanceUntil = 0;
  let nextGlance = 3;
  const eyes = { x: 0, y: 0 };

  return {
    update(vrm, t, dt, level, mood, activity) {
      const bone = (name) => vrm.humanoid.getNormalizedBoneNode(name);
      const breathe = Math.sin(t * 1.6);
      const ease = (value, target, speed) => value + (target - value) * Math.min(1, dt * speed);
      talking = ease(talking, level > 0.03 ? 1 : 0, 4);
      thinking = ease(thinking, activity === 'thinking' ? 1 : 0, 3);
      listening = ease(listening, activity === 'listening' ? 1 : 0, 3);
      const face_ = FACES[mood?.feeling] ?? {};
      const feel = Math.min(1, (mood?.level ?? 0) / 10); // how strongly it feels it
      const low = Math.min(1, (face_.sad ?? 0) + (face_.relaxed ?? 0)) * (face_.surprised ? 0.3 : 1) * feel;
      const recoil = (RECOIL[mood?.feeling] ?? 0) * feel;
      const tremble = mood?.feeling === 'scared' ? feel * Math.sin(t * 38) * 0.006 : 0;

      if (t > nextGlance) {
        glance = { x: (Math.random() - 0.5) * 0.5, y: (Math.random() - 0.4) * 0.25 };
        glanceUntil = t + 0.4 + Math.random() * 0.8;
        nextGlance = t + 2.5 + Math.random() * 4;
      }
      const away = t < glanceUntil && !talking ? glance : { x: 0, y: 0 };
      // Thinking: eyes go up and to the side, the way people look away to think.
      const target = { x: away.x * (1 - thinking) + 0.9 * thinking, y: away.y * (1 - thinking) + 0.55 * thinking };
      eyes.x = ease(eyes.x, target.x, 14);
      eyes.y = ease(eyes.y, target.y, 14);

      bone('spine')?.rotation.set(breathe * 0.012 + recoil * 0.07 + tremble, tremble * 0.5, 0);
      bone('chest')?.rotation.set(breathe * (0.015 + recoil * 0.02), 0, tremble);
      bone('leftUpperArm')?.rotation.set(0, 0, -1.22 + breathe * 0.015);
      bone('rightUpperArm')?.rotation.set(0, 0, 1.22 - breathe * 0.015);
      bone('leftLowerArm')?.rotation.set(0, -0.28, 0);
      bone('rightLowerArm')?.rotation.set(0, 0.28, 0);
      // Listening nods: a small dip every couple of seconds.
      const nod = listening * Math.max(0, Math.sin(t * 2.6)) ** 6 * 0.07;
      bone('head')?.rotation.set(
        Math.sin(t * 0.7) * 0.03 + talking * Math.sin(t * 5.3) * 0.035 - nod - low * 0.09 + thinking * 0.06 + recoil * 0.05 + tremble,
        Math.sin(t * 0.45) * 0.08 * (1 - listening * 0.6) + thinking * 0.12,
        Math.sin(t * 0.6) * 0.02 + listening * 0.06,
      );

      if (t > nextBlink && blinkStart < 0) blinkStart = t;
      let blink = 0;
      if (blinkStart >= 0) {
        const p = (t - blinkStart) / 0.16;
        blink = p < 1 ? Math.sin(p * Math.PI) : 0;
        if (p >= 1) {
          blinkStart = -1;
          nextBlink = t + 2 + Math.random() * 4;
        }
      }

      mouth += (level - mouth) * Math.min(1, dt * 20);
      const face = vrm.expressionManager;
      face?.setValue('blink', blink);
      face?.setValue('aa', Math.min(1, mouth * 1.1));
      face?.setValue('oh', Math.min(1, mouth * 0.45 * (0.5 + 0.5 * Math.sin(t * 9))));

      // Mood: ease toward the feeling's expression. It's softened while talking,
      // because some expressions hold the mouth still.
      const strength = feel * 0.75 * (1 - 0.4 * talking);
      for (const e of EXPRESSIONS) {
        // A startle snaps onto the face; other feelings ease in.
        shown[e] += ((face_[e] ?? 0) * strength - shown[e]) * Math.min(1, dt * (recoil > 0.5 ? 9 : 2.5));
        face?.setValue(e, shown[e]);
      }
      return eyes; // where the eyes should look, relative to the viewer
    },
  };
}
