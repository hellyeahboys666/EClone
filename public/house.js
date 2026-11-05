// The house the twin lives in: a living room with a real window (daylight, sunset
// or night outside, and the sun casting light through it), an open doorway into a
// kitchen, and furniture. Built from simple shapes and textures drawn in code, so
// there are no image files to download. buildHouse() takes the settings from the
// House panel (see house-config.js) and returns everything as one group.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { phaseFor } from './house-config.js';

// Living room bounds in meters. The twin stands at the origin facing the viewer (+z).
const ROOM = { left: -3.6, right: 3.6, back: -2.6, front: 4.6, height: 2.7 };
const WALL = 0.15; // thickness of the back wall, which has the openings
const WINDOW = { x0: -2.3, x1: -0.6, y0: 0.85, y1: 2.3 };
const DOOR = { x0: 1.0, x1: 2.0, y1: 2.15 }; // doorway to the kitchen
const KITCHEN = { left: 0.4, right: 3.6, back: -5.4 };

// How each time of day looks: the sky, the sun (or moon), the soft light from the
// sky, the light toward the viewer's side, reflections, and overall exposure.
const PHASES = {
  morning: { sky: ['#8fbbe8', '#f8dcc0'], sun: [0xffe0b8, 3.4, [-7, 3.4, -8]], hemi: [0xdfe9ff, 0x7a6450, 0.6], fill: 0.35, env: 0.35, exposure: 0.88, dark: false },
  day: { sky: ['#5c9be0', '#d4e9fb'], sun: [0xfff4e4, 4.2, [-4, 7, -8]], hemi: [0xe4eeff, 0x7a6450, 0.7], fill: 0.4, env: 0.4, exposure: 0.85, dark: false },
  sunset: { sky: ['#46548f', '#f4955a'], sun: [0xff944f, 2.6, [-7.5, 1.9, -8]], hemi: [0xffc49c, 0x5a4636, 0.6], fill: 0.4, env: 0.3, exposure: 1.05, dark: true },
  night: { sky: ['#050a1a', '#18264a'], sun: [0x8ea6ff, 0.35, [-4, 6, -8]], hemi: [0x6a80bd, 0x221a14, 0.22], fill: 0.22, env: 0.1, exposure: 0.92, dark: true },
};

export function buildHouse(config) {
  const phase = phaseFor(config.timeOfDay);
  const look = PHASES[phase];
  const lit = config.lights === 'on' || (config.lights === 'auto' && look.dark);
  const group = new THREE.Group();
  const random = seeded(20261105); // same house every time it's rebuilt
  const textures = [];

  const texture = (width, height, draw, repeat = [1, 1]) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
    t.anisotropy = 8;
    textures.push(t);
    return t;
  };
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
  const add = (geometry, material, [x, y, z], { rot, cast = true, parent = group } = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (rot) mesh.rotation.set(...rot);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (w, h, d, material, pos, opts) => add(new THREE.BoxGeometry(w, h, d), material, pos, opts);
  const rounded = (w, h, d, r, material, pos, opts) => add(new RoundedBoxGeometry(w, h, d, 3, r), material, pos, opts);
  const cylinder = (rTop, rBottom, h, material, pos, opts) => add(new THREE.CylinderGeometry(rTop, rBottom, h, 24), material, pos, opts);

  const width = ROOM.right - ROOM.left;
  const depth = ROOM.front - ROOM.back;
  const wallMat = mat(config.wallColor, { roughness: 0.92, shadowSide: THREE.DoubleSide });
  const trim = mat('#f3f1ec', { roughness: 0.55 });
  const oak = mat('#b88a5e', { roughness: 0.5 });
  const walnut = mat('#5c4231', { roughness: 0.45 });
  const metal = mat('#2a2a2c', { roughness: 0.4, metalness: 0.6 });
  const steel = mat('#c8ccd1', { roughness: 0.28, metalness: 0.75 });
  const shade = mat('#efe5d3', { side: THREE.DoubleSide, emissive: '#ffcf8f', emissiveIntensity: lit ? 1.1 : 0 });

  // ---- Floor, walls, ceiling --------------------------------------------------
  const floor = floorMaterial(config.floor, texture, random, [width / 2, depth / 2]);
  add(new THREE.PlaneGeometry(width, depth), floor, [0, 0, (ROOM.back + ROOM.front) / 2], { rot: [-Math.PI / 2, 0, 0], cast: false });
  add(new THREE.PlaneGeometry(width, depth), mat('#f6f4f0', { roughness: 0.95, shadowSide: THREE.DoubleSide }), [0, ROOM.height, (ROOM.back + ROOM.front) / 2], { rot: [Math.PI / 2, 0, 0] });

  // Back wall, with the window and the doorway cut out, so light really comes through.
  const outline = new THREE.Shape();
  outline.moveTo(ROOM.left, 0);
  outline.lineTo(DOOR.x0, 0);
  outline.lineTo(DOOR.x0, DOOR.y1);
  outline.lineTo(DOOR.x1, DOOR.y1);
  outline.lineTo(DOOR.x1, 0);
  outline.lineTo(ROOM.right, 0);
  outline.lineTo(ROOM.right, ROOM.height);
  outline.lineTo(ROOM.left, ROOM.height);
  outline.closePath();
  const hole = new THREE.Path();
  hole.moveTo(WINDOW.x0, WINDOW.y0);
  hole.lineTo(WINDOW.x1, WINDOW.y0);
  hole.lineTo(WINDOW.x1, WINDOW.y1);
  hole.lineTo(WINDOW.x0, WINDOW.y1);
  hole.closePath();
  outline.holes.push(hole);
  add(new THREE.ExtrudeGeometry(outline, { depth: WALL, bevelEnabled: false }), wallMat, [0, 0, ROOM.back - WALL]);
  // Side and front walls (they disappear when the camera swings behind them).
  add(new THREE.PlaneGeometry(depth, ROOM.height), wallMat, [ROOM.left, ROOM.height / 2, (ROOM.back + ROOM.front) / 2], { rot: [0, Math.PI / 2, 0] });
  add(new THREE.PlaneGeometry(depth, ROOM.height), wallMat, [ROOM.right, ROOM.height / 2, (ROOM.back + ROOM.front) / 2], { rot: [0, -Math.PI / 2, 0] });
  add(new THREE.PlaneGeometry(width, ROOM.height), wallMat, [0, ROOM.height / 2, ROOM.front], { rot: [0, Math.PI, 0] });

  // Baseboards and crown molding.
  const runs = [
    [ROOM.left, DOOR.x0, 'back'], [DOOR.x1, ROOM.right, 'back'],
    [ROOM.back, ROOM.front, 'left'], [ROOM.back, ROOM.front, 'right'],
  ];
  for (const [a, b, side] of runs) {
    const len = b - a;
    const mid = (a + b) / 2;
    if (side === 'back') box(len, 0.11, 0.02, trim, [mid, 0.055, ROOM.back + 0.01]);
    else box(0.02, 0.11, len, trim, [side === 'left' ? ROOM.left + 0.01 : ROOM.right - 0.01, 0.055, mid]);
  }
  box(width, 0.07, 0.07, trim, [0, ROOM.height - 0.035, ROOM.back + 0.035]);
  box(0.07, 0.07, depth, trim, [ROOM.left + 0.035, ROOM.height - 0.035, (ROOM.back + ROOM.front) / 2]);
  box(0.07, 0.07, depth, trim, [ROOM.right - 0.035, ROOM.height - 0.035, (ROOM.back + ROOM.front) / 2]);

  // ---- Window ---------------------------------------------------------------
  const wx = (WINDOW.x0 + WINDOW.x1) / 2;
  const wy = (WINDOW.y0 + WINDOW.y1) / 2;
  const ww = WINDOW.x1 - WINDOW.x0;
  const wh = WINDOW.y1 - WINDOW.y0;
  const wz = ROOM.back - WALL / 2;
  box(ww, 0.06, 0.1, trim, [wx, WINDOW.y1 - 0.03, wz]);
  box(ww, 0.06, 0.1, trim, [wx, WINDOW.y0 + 0.03, wz]);
  box(0.06, wh, 0.1, trim, [WINDOW.x0 + 0.03, wy, wz]);
  box(0.06, wh, 0.1, trim, [WINDOW.x1 - 0.03, wy, wz]);
  box(0.045, wh, 0.07, trim, [wx, wy, wz]);
  box(ww, 0.045, 0.07, trim, [wx, WINDOW.y0 + wh * 0.62, wz]);
  add(new THREE.PlaneGeometry(ww, wh), new THREE.MeshStandardMaterial({ color: '#dfeef7', transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.1 }), [wx, wy, wz], { cast: false });
  box(ww + 0.16, 0.04, 0.26, trim, [wx, WINDOW.y0 - 0.02, ROOM.back + 0.06]); // sill
  // Casing around the window on the room side.
  box(ww + 0.16, 0.08, 0.02, trim, [wx, WINDOW.y1 + 0.04, ROOM.back + 0.01]);
  box(0.08, wh, 0.02, trim, [WINDOW.x0 - 0.04, wy, ROOM.back + 0.01]);
  box(0.08, wh, 0.02, trim, [WINDOW.x1 + 0.04, wy, ROOM.back + 0.01]);

  // What's outside.
  const sky = texture(2048, 1024, (ctx, w, h) => drawOutside(ctx, w, h, phase, look, config.view, seeded(99)));
  add(new THREE.PlaneGeometry(20, 10), new THREE.MeshBasicMaterial({ map: sky, toneMapped: false }), [-1, 2.2, -8], { cast: false });

  if (config.curtains) {
    cylinder(0.015, 0.015, ww + 1.3, metal, [wx, WINDOW.y1 + 0.2, ROOM.back + 0.14], { rot: [0, 0, Math.PI / 2] });
    const cloth = mat('#e4ddcf', { roughness: 1, side: THREE.DoubleSide });
    for (const x of [WINDOW.x0 - 0.3, WINDOW.x1 + 0.3]) {
      const geometry = new THREE.PlaneGeometry(0.62, WINDOW.y1 + 0.15, 30, 1);
      const p = geometry.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 38) * 0.035);
      geometry.computeVertexNormals();
      add(geometry, cloth, [x, (WINDOW.y1 + 0.15) / 2 + 0.02, ROOM.back + 0.12]);
    }
  }

  // ---- Doorway to the kitchen -----------------------------------------------
  const dx = (DOOR.x0 + DOOR.x1) / 2;
  const dw = DOOR.x1 - DOOR.x0;
  box(dw + 0.16, 0.08, 0.02, trim, [dx, DOOR.y1 + 0.04, ROOM.back + 0.01]);
  box(0.08, DOOR.y1, 0.02, trim, [DOOR.x0 - 0.04, DOOR.y1 / 2, ROOM.back + 0.01]);
  box(0.08, DOOR.y1, 0.02, trim, [DOOR.x1 + 0.04, DOOR.y1 / 2, ROOM.back + 0.01]);
  box(0.08, 0.12, 0.012, trim, [DOOR.x1 + 0.25, 1.2, ROOM.back + 0.006]); // light switch
  box(0.07, 0.11, 0.012, trim, [0.6, 0.3, ROOM.back + 0.006]); // outlet
  box(dw, 0.012, WALL, oak, [dx, 0.006, ROOM.back - WALL / 2], { cast: false }); // threshold
  if (config.kitchen) buildKitchen();
  else {
    // A closed door instead.
    box(dw - 0.02, DOOR.y1 - 0.01, 0.04, trim, [dx, DOOR.y1 / 2, ROOM.back - WALL / 2]);
    add(new THREE.SphereGeometry(0.03, 16, 12), steel, [DOOR.x1 - 0.12, 1.0, ROOM.back + 0.0]);
  }

  // A closed door on the right wall, toward the front: the rest of the house.
  box(0.04, 2.05, 0.9, trim, [ROOM.right - 0.02, 1.025, 3.1]);
  box(0.02, 2.13, 0.08, trim, [ROOM.right - 0.01, 1.065, 2.61]);
  box(0.02, 2.13, 0.08, trim, [ROOM.right - 0.01, 1.065, 3.59]);
  box(0.02, 0.08, 1.06, trim, [ROOM.right - 0.01, 2.09, 3.1]);
  add(new THREE.SphereGeometry(0.03, 16, 12), steel, [ROOM.right - 0.07, 1.0, 2.75]);

  // ---- Ceiling lights -------------------------------------------------------
  const downlight = mat('#ffffff', { emissive: '#fff1d6', emissiveIntensity: lit ? 2 : 0.05 });
  for (const [x, z] of [[-1.6, -0.8], [1.2, -0.8], [-1.6, 1.9], [1.2, 1.9]]) {
    add(new THREE.CircleGeometry(0.06, 24), downlight, [x, ROOM.height - 0.002, z], { rot: [Math.PI / 2, 0, 0], cast: false });
  }

  // ---- Furniture ------------------------------------------------------------
  // Rug in the middle of the room.
  const rug = texture(1024, 720, (ctx, w, h) => drawRug(ctx, w, h, config.rugColor, seeded(5)));
  add(new THREE.PlaneGeometry(3.0, 2.1), mat('#ffffff', { map: rug, roughness: 1 }), [0.6, 0.004, 0.5], { rot: [-Math.PI / 2, 0, 0], cast: false });

  // Sofa against the right wall, facing into the room.
  const fabric = mat(config.sofaColor, { roughness: 0.95 });
  const fabricDark = mat(shadeHex(config.sofaColor, -0.12), { roughness: 0.95 });
  const sz = 0.4;
  rounded(0.95, 0.36, 2.3, 0.05, fabricDark, [3.05, 0.26, sz]);
  rounded(0.24, 0.62, 2.3, 0.06, fabricDark, [3.46, 0.62, sz]);
  for (const z of [sz - 1.12, sz + 1.12]) rounded(0.95, 0.6, 0.2, 0.06, fabric, [3.05, 0.42, z]);
  for (const z of [sz - 0.5, sz + 0.5]) {
    rounded(0.72, 0.15, 0.98, 0.06, fabric, [2.98, 0.5, z]);
    rounded(0.2, 0.46, 0.98, 0.08, fabric, [3.3, 0.8, z], { rot: [0, 0, 0.18] });
  }
  const pillow = mat(shadeHex(config.rugColor, 0.08), { roughness: 0.95 });
  rounded(0.14, 0.36, 0.36, 0.07, pillow, [3.15, 0.74, sz - 0.88], { rot: [0.3, 0, 0.25] });
  rounded(0.14, 0.32, 0.32, 0.07, mat('#e8e2d4', { roughness: 0.95 }), [3.15, 0.72, sz + 0.86], { rot: [-0.25, 0, 0.25] });
  for (const [x, z] of [[2.65, sz - 1.1], [3.45, sz - 1.1], [2.65, sz + 1.1], [3.45, sz + 1.1]]) cylinder(0.025, 0.02, 0.08, walnut, [x, 0.04, z]);

  // Coffee table with a few things on it.
  rounded(0.62, 0.05, 1.15, 0.015, oak, [2.0, 0.42, sz]);
  for (const [x, z] of [[1.75, sz - 0.5], [2.25, sz - 0.5], [1.75, sz + 0.5], [2.25, sz + 0.5]]) cylinder(0.018, 0.014, 0.4, walnut, [x, 0.2, z]);
  box(0.2, 0.03, 0.28, mat('#3d5a73'), [2.02, 0.46, sz - 0.2], { rot: [0, 0.2, 0] });
  box(0.18, 0.025, 0.25, mat('#c9b48a'), [2.02, 0.487, sz - 0.18], { rot: [0, -0.1, 0] });
  cylinder(0.04, 0.035, 0.09, mat('#f2efe9', { roughness: 0.3 }), [1.95, 0.49, sz + 0.25]);

  // Side table with a lamp, next to the sofa.
  cylinder(0.26, 0.26, 0.03, oak, [3.05, 0.56, -1.2]);
  cylinder(0.03, 0.03, 0.55, metal, [3.05, 0.28, -1.2]);
  cylinder(0.18, 0.18, 0.02, metal, [3.05, 0.01, -1.2]);
  add(new THREE.SphereGeometry(0.09, 24, 16), mat('#c9b9a3', { roughness: 0.35 }), [3.05, 0.66, -1.2]);
  cylinder(0.12, 0.15, 0.2, shade, [3.05, 0.86, -1.2]);
  pointLight(0xffc27e, 4, [3.05, 0.84, -1.2]);

  // Floor lamp in the corner by the window.
  cylinder(0.16, 0.16, 0.03, metal, [-3.15, 0.015, -2.15]);
  cylinder(0.012, 0.012, 1.5, metal, [-3.15, 0.77, -2.15]);
  cylinder(0.2, 0.24, 0.3, shade, [-3.15, 1.6, -2.15]);
  pointLight(0xffbf78, 7, [-3.15, 1.55, -2.15]);

  if (config.tv) {
    rounded(0.42, 0.5, 1.8, 0.01, walnut, [-3.37, 0.27, 0.7]);
    box(0.005, 0.4, 0.004, metal, [-3.155, 0.27, 0.7]);
    box(0.04, 0.8, 1.4, metal, [-3.56, 1.32, 0.7]);
    add(new THREE.PlaneGeometry(1.36, 0.76), mat('#07080a', { roughness: 0.12, metalness: 0.3 }), [-3.538, 1.32, 0.7], { rot: [0, Math.PI / 2, 0], cast: false });
    box(0.08, 0.07, 0.7, metal, [-3.3, 0.555, 0.7]);
  }

  if (config.bookshelf) {
    const x = -3.42;
    const shelf = oak;
    for (const z of [-1.75, -0.65]) box(0.36, 2.0, 0.03, shelf, [x, 1.0, z]);
    box(0.02, 2.0, 1.1, shelf, [ROOM.left + 0.01, 1.0, -1.2]);
    const levels = [0.06, 0.48, 0.88, 1.28, 1.68, 1.985];
    for (const y of levels) box(0.36, 0.03, 1.07, shelf, [x, y, -1.2]);
    const spines = ['#8c3b2f', '#2f4d6e', '#c9a54a', '#4e7454', '#6d4c7d', '#d8d2c4', '#24324a', '#a86a3c', '#7d8c95'];
    for (const y of levels.slice(0, 4)) {
      let z = -1.72;
      const end = -0.68 - (random() < 0.5 ? 0.25 : 0);
      while (z < end) {
        const t = 0.025 + random() * 0.03;
        const h = 0.2 + random() * 0.1;
        box(0.22, h, t, mat(pick(spines, random), { roughness: 0.7 }), [x + 0.03, y + 0.015 + h / 2, z + t / 2]);
        z += t + 0.004;
      }
    }
    cylinder(0.05, 0.07, 0.22, mat('#d9cdb8', { roughness: 0.3 }), [x, 1.69 + 0.11, -0.9]);
    add(new THREE.SphereGeometry(0.07, 20, 14), mat('#2f5a4c', { roughness: 0.4 }), [x, 1.74, -1.5]);
  }

  if (config.plants) {
    plant(2.75, -2.2, 1.6, 22, '#d9d2c6');
    plant(-3.25, 1.95, 0.9, 12, '#b9714f');
    // A small one on the window sill.
    cylinder(0.06, 0.05, 0.09, mat('#c8a07c'), [WINDOW.x1 - 0.3, WINDOW.y0 + 0.045, ROOM.back + 0.08]);
    for (let i = 0; i < 6; i++) {
      add(new THREE.IcosahedronGeometry(0.035, 0), mat('#5f8f5a', { roughness: 0.7 }), [WINDOW.x1 - 0.3 + (random() - 0.5) * 0.07, WINDOW.y0 + 0.12 + random() * 0.04, ROOM.back + 0.08 + (random() - 0.5) * 0.07]);
    }
  }

  if (config.art) {
    picture(0.6, 0.78, [ROOM.right - 0.02, 1.62, sz - 0.42], -Math.PI / 2, 11);
    picture(0.6, 0.78, [ROOM.right - 0.02, 1.62, sz + 0.42], -Math.PI / 2, 12);
    picture(0.72, 0.52, [0.45, 1.6, ROOM.back + 0.02], 0, 13);
  }

  // ---- Light ----------------------------------------------------------------
  group.add(new THREE.HemisphereLight(...look.hemi));
  const [sunColor, sunIntensity, sunPos] = look.sun;
  const sun = new THREE.DirectionalLight(sunColor, sunIntensity);
  sun.position.set(...sunPos);
  sun.target.position.set(-0.8, 0, 0.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 0.5, far: 30 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  group.add(sun, sun.target);
  // Soft light from the viewer's side, so the twin's face is never in the dark.
  const fill = new THREE.DirectionalLight(lit ? 0xffdcb8 : 0xffffff, look.fill);
  fill.position.set(0.6, 2.2, 5);
  fill.target.position.set(0, 1.2, 0);
  group.add(fill, fill.target);
  if (lit) {
    pointLight(0xffe2bd, 3, [-1.2, 2.5, 0.4]);
    pointLight(0xffe2bd, 3, [1.2, 2.5, 0.4]);
  }

  return {
    group,
    phase,
    exposure: look.exposure,
    environmentIntensity: look.env,
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [o.material].flat()) m?.dispose();
      });
      for (const t of textures) t.dispose();
    },
  };

  // ---- Helpers that use this build's settings ---------------------------------
  function pointLight(color, intensity, [x, y, z]) {
    if (!lit) return;
    const light = new THREE.PointLight(color, intensity, 7, 1.6);
    light.position.set(x, y, z);
    group.add(light);
  }

  function plant(x, z, height, leafCount, potColor) {
    const potR = 0.12 + height * 0.06;
    cylinder(potR, potR * 0.8, 0.36, mat(potColor, { roughness: 0.6 }), [x, 0.18, z]);
    cylinder(potR * 0.92, potR * 0.92, 0.01, mat('#3b2b20'), [x, 0.355, z], { cast: false });
    cylinder(0.012, 0.016, height - 0.4, mat('#5a4430'), [x, 0.36 + (height - 0.4) / 2, z]);
    const leaf = new THREE.SphereGeometry(1, 14, 10);
    for (let i = 0; i < leafCount; i++) {
      const t = 0.25 + (i / leafCount) * 0.75;
      const angle = i * 2.4 + random();
      const reach = 0.08 + random() * 0.12;
      const mesh = add(
        leaf.clone(),
        mat(shadeHex('#3f7a46', (random() - 0.5) * 0.25), { roughness: 0.6 }),
        [x + Math.cos(angle) * reach, 0.36 + t * (height - 0.3), z + Math.sin(angle) * reach],
        { rot: [random() * 0.8 - 0.4, -angle, 0.5 + random() * 0.4] },
      );
      mesh.scale.set(0.12 + random() * 0.05, 0.015, 0.075 + random() * 0.03);
    }
  }

  function picture(w, h, [x, y, z], turn, seed) {
    const art = texture(512, Math.round(512 * (h / w)), (ctx, cw, ch) => drawArt(ctx, cw, ch, [config.rugColor, config.sofaColor], seeded(seed)));
    const frame = new THREE.Group();
    frame.position.set(x, y, z);
    frame.rotation.y = turn;
    group.add(frame);
    add(new THREE.BoxGeometry(w, h, 0.03), mat('#2b2622', { roughness: 0.5 }), [0, 0, 0.015], { parent: frame });
    add(new THREE.PlaneGeometry(w - 0.05, h - 0.05), mat('#f4f1ea', { roughness: 0.9 }), [0, 0, 0.031], { parent: frame, cast: false });
    add(new THREE.PlaneGeometry(w - 0.16, h - 0.16), mat('#ffffff', { map: art, roughness: 0.85 }), [0, 0, 0.032], { parent: frame, cast: false });
  }

  function buildKitchen() {
    const kw = KITCHEN.right - KITCHEN.left;
    const kd = ROOM.back - WALL - KITCHEN.back;
    const kx = (KITCHEN.left + KITCHEN.right) / 2;
    const kz = (ROOM.back - WALL + KITCHEN.back) / 2;
    const tile = floorMaterial('tile', texture, random, [kw / 2, kd / 2]);
    add(new THREE.PlaneGeometry(kw, kd), tile, [kx, 0.001, kz], { rot: [-Math.PI / 2, 0, 0], cast: false });
    add(new THREE.PlaneGeometry(kw, kd), mat('#f6f4f0', { shadowSide: THREE.DoubleSide }), [kx, ROOM.height, kz], { rot: [Math.PI / 2, 0, 0] });
    const kitchenWall = mat(shadeHex(config.wallColor, 0.04), { roughness: 0.9, shadowSide: THREE.DoubleSide });
    add(new THREE.PlaneGeometry(kw, ROOM.height), kitchenWall, [kx, ROOM.height / 2, KITCHEN.back]);
    add(new THREE.PlaneGeometry(kd, ROOM.height), kitchenWall, [KITCHEN.left, ROOM.height / 2, kz], { rot: [0, Math.PI / 2, 0] });
    add(new THREE.PlaneGeometry(kd, ROOM.height), kitchenWall, [KITCHEN.right, ROOM.height / 2, kz], { rot: [0, -Math.PI / 2, 0] });

    const cabinet = mat('#ece8e0', { roughness: 0.5 });
    const cz = KITCHEN.back + 0.3;
    box(kw, 0.84, 0.6, cabinet, [kx, 0.46, cz]);
    box(kw, 0.08, 0.54, mat('#3a3633'), [kx, 0.04, cz - 0.03]);
    box(kw + 0.02, 0.04, 0.64, mat('#d6d1c8', { roughness: 0.22 }), [kx, 0.9, cz + 0.02]);
    const backsplash = texture(512, 256, (ctx, w, h) => drawSubwayTile(ctx, w, h), [kw / 1.0, 1]);
    add(new THREE.PlaneGeometry(kw, 0.6), mat('#ffffff', { map: backsplash, roughness: 0.25 }), [kx, 1.22, KITCHEN.back + 0.003], { cast: false });
    box(kw - 0.9, 0.72, 0.34, cabinet, [kx - 0.45, 1.88, KITCHEN.back + 0.17]);
    for (let x = KITCHEN.left + 0.6; x < KITCHEN.right - 0.1; x += 0.6) {
      box(0.006, 0.76, 0.004, mat('#bdb6aa'), [x, 0.48, cz + 0.301]);
      box(0.12, 0.012, 0.02, steel, [x - 0.3, 0.8, cz + 0.31]);
    }
    for (let x = KITCHEN.left + 0.55; x < KITCHEN.right - 0.95; x += 0.55) box(0.006, 0.68, 0.004, mat('#bdb6aa'), [x, 1.88, KITCHEN.back + 0.341]);
    // Fridge in the corner.
    box(0.78, 1.86, 0.66, steel, [KITCHEN.right - 0.42, 0.93, KITCHEN.back + 0.34]);
    box(0.02, 0.5, 0.03, metal, [KITCHEN.right - 0.76, 1.35, KITCHEN.back + 0.69]);
    box(0.02, 0.35, 0.03, metal, [KITCHEN.right - 0.76, 0.55, KITCHEN.back + 0.69]);
    // A bowl of oranges and a kettle on the counter.
    add(new THREE.SphereGeometry(0.15, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat('#f2eee6', { side: THREE.DoubleSide }), [kx - 0.4, 1.07, cz], { rot: [Math.PI, 0, 0] });
    for (const [ox, oz] of [[-0.05, 0], [0.05, 0.03], [0, -0.05]]) add(new THREE.SphereGeometry(0.045, 16, 12), mat('#e8862e', { roughness: 0.6 }), [kx - 0.4 + ox, 1.0, cz + oz]);
    cylinder(0.07, 0.09, 0.18, steel, [kx + 0.45, 1.01, cz]);
    // Pendant lights over the counter.
    for (const x of [kx - 0.55, kx + 0.45]) {
      cylinder(0.004, 0.004, 0.55, metal, [x, ROOM.height - 0.275, cz + 0.35]);
      cylinder(0.05, 0.16, 0.16, mat('#2c2c2e', { roughness: 0.5, side: THREE.DoubleSide }), [x, ROOM.height - 0.62, cz + 0.35]);
      add(new THREE.SphereGeometry(0.035, 16, 12), mat('#ffffff', { emissive: '#ffd9a0', emissiveIntensity: lit ? 2.5 : 0.1 }), [x, ROOM.height - 0.68, cz + 0.35], { cast: false });
    }
    pointLight(0xffd6a0, 6, [kx, 2.1, kz]);
  }
}

// ---- Materials and drawings -------------------------------------------------

function floorMaterial(kind, texture, random, repeat) {
  if (kind === 'tile') {
    const map = texture(1024, 1024, (ctx, w, h) => drawTiles(ctx, w, h, seeded(3)), repeat.map((r) => r / 0.6));
    return new THREE.MeshStandardMaterial({ map, roughness: 0.35 });
  }
  if (kind === 'carpet') {
    const map = texture(512, 512, (ctx, w, h) => drawCarpet(ctx, w, h, seeded(4)), repeat.map((r) => r * 2));
    return new THREE.MeshStandardMaterial({ map, roughness: 1 });
  }
  const base = kind === 'walnut' ? '#6a4a33' : '#c49a6b';
  const map = texture(1024, 1024, (ctx, w, h) => drawPlanks(ctx, w, h, base, seeded(2)), repeat);
  return new THREE.MeshStandardMaterial({ map, roughness: 0.42 });
}

// Wood planks: one canvas is 2 m square, 11 planks wide, boards of random length.
function drawPlanks(ctx, w, h, base, random) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const plank = w / 11;
  for (let i = 0; i < 11; i++) {
    const x = i * plank;
    let y = -random() * h;
    while (y < h) {
      const len = h * (0.45 + random() * 0.5);
      for (const offset of [0, h]) {
        const top = y - offset;
        if (top + len < 0) continue;
        ctx.fillStyle = shadeHex(base, (random() - 0.5) * 0.22);
        ctx.fillRect(x, top, plank, len);
        ctx.strokeStyle = 'rgba(50,30,15,0.10)';
        ctx.lineWidth = 1;
        for (let g = 0; g < 7; g++) {
          const gx = x + 4 + random() * (plank - 8);
          ctx.beginPath();
          ctx.moveTo(gx, top);
          ctx.quadraticCurveTo(gx + (random() - 0.5) * 10, top + len / 2, gx + (random() - 0.5) * 6, top + len);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(25,15,8,0.55)';
        ctx.fillRect(x, top, plank, 2);
      }
      y += len;
    }
    ctx.fillStyle = 'rgba(25,15,8,0.6)';
    ctx.fillRect(x, 0, 2, h);
  }
}

// Stone tiles: one canvas is 1.2 m square, four 60 cm tiles.
function drawTiles(ctx, w, h, random) {
  ctx.fillStyle = '#8e8982';
  ctx.fillRect(0, 0, w, h);
  const size = w / 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const base = shadeHex('#c7c1b6', (random() - 0.5) * 0.08);
      ctx.fillStyle = base;
      ctx.fillRect(i * size + 3, j * size + 3, size - 6, size - 6);
      for (let k = 0; k < 900; k++) {
        ctx.fillStyle = `rgba(${random() < 0.5 ? '255,255,255' : '90,80,70'},${0.05 + random() * 0.07})`;
        ctx.fillRect(i * size + 3 + random() * (size - 8), j * size + 3 + random() * (size - 8), 1 + random() * 3, 1 + random() * 3);
      }
    }
  }
}

function drawCarpet(ctx, w, h, random) {
  ctx.fillStyle = '#8b847a';
  ctx.fillRect(0, 0, w, h);
  for (let k = 0; k < 26000; k++) {
    ctx.fillStyle = shadeHex('#8b847a', (random() - 0.5) * 0.35);
    ctx.fillRect(random() * w, random() * h, 1.5, 1.5);
  }
}

function drawRug(ctx, w, h, color, random) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  const light = shadeHex(color, 0.35);
  const dark = shadeHex(color, -0.3);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 36;
  ctx.strokeRect(40, 40, w - 80, h - 80);
  ctx.strokeStyle = light;
  ctx.lineWidth = 6;
  ctx.strokeRect(78, 78, w - 156, h - 156);
  // A lattice of diamonds in the middle.
  ctx.strokeStyle = shadeHex(color, 0.2);
  ctx.lineWidth = 4;
  const step = 90;
  ctx.save();
  ctx.beginPath();
  ctx.rect(96, 96, w - 192, h - 192);
  ctx.clip();
  for (let x = -h; x < w + h; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + h, h);
    ctx.moveTo(x, h);
    ctx.lineTo(x + h, 0);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, 70, 46, 0, 0, Math.PI * 2);
  ctx.fill();
  // Wear and fibre.
  for (let k = 0; k < 20000; k++) {
    ctx.fillStyle = `rgba(${random() < 0.5 ? '255,255,255' : '0,0,0'},0.06)`;
    ctx.fillRect(random() * w, random() * h, 2, 2);
  }
}

function drawSubwayTile(ctx, w, h) {
  ctx.fillStyle = '#cfcac2';
  ctx.fillRect(0, 0, w, h);
  const tw = w / 4;
  const th = h / 6;
  for (let r = 0; r < 6; r++) {
    for (let c = -1; c < 5; c++) {
      const x = c * tw + (r % 2 ? tw / 2 : 0);
      ctx.fillStyle = r % 3 ? '#f6f4f0' : '#f1eee8';
      ctx.fillRect(x + 2, r * th + 2, tw - 4, th - 4);
    }
  }
}

function drawArt(ctx, w, h, [a, b], random) {
  ctx.fillStyle = '#efe9dd';
  ctx.fillRect(0, 0, w, h);
  const palette = [a, b, '#d9a441', '#2f3b4a', '#c76b4a', '#8fa79a', '#e8d6b8'];
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = pick(palette, random);
    ctx.globalAlpha = 0.75 + random() * 0.25;
    const kind = random();
    const x = random() * w;
    const y = random() * h;
    const r = (0.12 + random() * 0.3) * Math.min(w, h);
    ctx.beginPath();
    if (kind < 0.45) ctx.arc(x, y, r, 0, Math.PI * 2);
    else if (kind < 0.75) ctx.rect(x - r, y - r / 3, r * 2, r / 1.5);
    else ctx.arc(x, y, r, Math.PI, 0);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// What you see through the window: sky for the time of day, then the view.
function drawOutside(ctx, w, h, phase, look, view, random) {
  const horizon = h * 0.62;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, look.sky[0]);
  sky.addColorStop(1, look.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon + 2);
  const night = phase === 'night';
  if (night) {
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + random() * 0.7})`;
      ctx.fillRect(random() * w, random() * horizon * 0.9, 1 + random() * 1.5, 1 + random() * 1.5);
    }
    ctx.fillStyle = '#f6f1de';
    ctx.beginPath();
    ctx.arc(w * 0.62, h * 0.18, 26, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // The sun low in the sky at sunrise and sunset, plus a few clouds.
    if (phase !== 'day') {
      const sunY = horizon - (phase === 'morning' ? 120 : 60);
      const glow = ctx.createRadialGradient(w * 0.6, sunY, 10, w * 0.6, sunY, 260);
      glow.addColorStop(0, 'rgba(255,236,190,0.95)');
      glow.addColorStop(1, 'rgba(255,200,140,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, horizon);
    }
    ctx.fillStyle = phase === 'sunset' ? 'rgba(255,190,160,0.55)' : 'rgba(255,255,255,0.75)';
    for (let c = 0; c < 7; c++) {
      const cx = random() * w;
      const cy = 60 + random() * horizon * 0.45;
      for (let p = 0; p < 6; p++) {
        ctx.beginPath();
        ctx.ellipse(cx + p * 34 - 90, cy + Math.sin(p) * 10, 60 + random() * 40, 22 + random() * 12, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  const dim = night ? -0.72 : phase === 'sunset' ? -0.35 : 0;
  const tone = (hex) => shadeHex(hex, dim);

  if (view === 'city') {
    for (let layer = 0; layer < 2; layer++) {
      let x = -20;
      while (x < w) {
        const bw = 70 + random() * 120;
        const bh = (layer ? 160 : 260) + random() * (layer ? 200 : 260);
        const top = horizon + 40 - bh + layer * 60;
        ctx.fillStyle = tone(layer ? '#5b6370' : '#7c8591');
        ctx.fillRect(x, top, bw, h - top);
        for (let wy = top + 16; wy < h - 20; wy += 26) {
          for (let wx = x + 10; wx < x + bw - 14; wx += 22) {
            const on = night ? random() < 0.45 : random() < 0.15;
            ctx.fillStyle = on && night ? '#ffd88a' : tone('#9fb3c8');
            ctx.fillRect(wx, wy, 10, 14);
          }
        }
        x += bw + 6 + random() * 20;
      }
    }
    ctx.fillStyle = tone('#4a4f57');
    ctx.fillRect(0, horizon + 140, w, h);
  } else if (view === 'lake') {
    ctx.fillStyle = tone('#6d7f8f');
    ctx.beginPath();
    ctx.moveTo(0, horizon);
    for (let x = 0; x <= w; x += 40) ctx.lineTo(x, horizon - 70 - Math.sin(x / 210) * 50 - random() * 20);
    ctx.lineTo(w, horizon);
    ctx.fill();
    const water = ctx.createLinearGradient(0, horizon, 0, h);
    water.addColorStop(0, tone(look.sky[1]));
    water.addColorStop(1, tone('#2f5873'));
    ctx.fillStyle = water;
    ctx.fillRect(0, horizon, w, h - horizon);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 70; i++) ctx.fillRect(random() * w, horizon + 10 + random() * (h - horizon), 30 + random() * 60, 2);
    ctx.fillStyle = tone('#4f6b3f');
    ctx.fillRect(0, h * 0.9, w, h * 0.1);
  } else {
    // Garden: lawn, a fence, trees and hedges.
    ctx.fillStyle = tone('#6f9a55');
    ctx.fillRect(0, horizon, w, h - horizon);
    // Trees in two rows: far ones smaller and paler, near ones bigger and darker.
    // Each crown is a cluster of overlapping blobs in a few greens.
    for (const far of [true, false]) {
      for (let i = 0; i < (far ? 14 : 6); i++) {
        const tx = random() * w;
        const ty = horizon + (far ? 10 : 50) + random() * 30;
        const r = far ? 22 + random() * 22 : 38 + random() * 34;
        const height = far ? 40 + random() * 30 : 80 + random() * 60;
        ctx.fillStyle = tone(far ? '#6f6253' : '#4e3b2b');
        ctx.fillRect(tx - (far ? 3 : 6), ty - height, far ? 6 : 12, height);
        for (let b = 0; b < 9; b++) {
          ctx.fillStyle = tone(shadeHex(far ? '#6f9563' : '#3f6b37', (random() - 0.5) * 0.35));
          ctx.beginPath();
          ctx.arc(tx + (random() - 0.5) * r * 1.6, ty - height - random() * r * 1.3, r * (0.5 + random() * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.fillStyle = tone('#3f6a35');
    for (let x = 0; x < w; x += 70) {
      ctx.beginPath();
      ctx.arc(x, horizon + 120, 60, Math.PI, 0);
      ctx.fill();
    }
    ctx.fillStyle = tone('#e8e2d6');
    for (let x = 0; x < w; x += 46) ctx.fillRect(x, horizon + 130, 12, 90);
    ctx.fillRect(0, horizon + 150, w, 10);
    ctx.fillRect(0, horizon + 190, w, 10);
  }
}

// ---- Small utilities -----------------------------------------------------------

// A repeatable random sequence, so the house looks the same on every rebuild.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

// Lightens (amount > 0) or darkens (amount < 0) a #rrggbb color.
function shadeHex(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c) => Math.round(Math.min(255, Math.max(0, amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))));
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(channel);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
