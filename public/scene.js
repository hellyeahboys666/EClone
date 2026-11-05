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
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const startAspect = window.innerWidth / window.innerHeight;
  camera.position.set(0, 1.42, 2.9 * Math.max(1, 1 / Math.sqrt(startAspect)));
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.18, 0);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 1;
  controls.maxDistance = 5;
  controls.minPolarAngle = 0.9;
  controls.maxPolarAngle = 1.75;
  controls.minAzimuthAngle = -1.2;
  controls.maxAzimuthAngle = 1.2;
  controls.update();

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
    controls.update();
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
    drag = { id, item, wall: CATALOG[item.type]?.place === 'wall' };
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
    const { id, item } = drag;
    drag = null;
    controls.enabled = true;
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

  return { setHouse, setPresent, setDecorating, select: highlight, loaded };
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
