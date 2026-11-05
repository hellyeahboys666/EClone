// The things you can place in the house (CATALOG in house-config.js), built from
// simple shapes. Each builder returns a group standing on the floor at the origin and
// facing +z (into the room), or, for wall things, centred on the wall and facing out.
// Your own pictures and 3D models load from house-assets/ in the background.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const textureCache = new Map();
const modelCache = new Map();
const gltfLoader = new GLTFLoader();

// A picture you uploaded, as a texture (shared, so each loads once).
export function pictureTexture(url, onLoad) {
  let entry = textureCache.get(url);
  if (!entry) {
    entry = { texture: null, callbacks: [] };
    entry.texture = new THREE.TextureLoader().load(url, (t) => {
      entry.loaded = true;
      for (const cb of entry.callbacks.splice(0)) cb(t);
    });
    entry.texture.colorSpace = THREE.SRGBColorSpace;
    entry.texture.anisotropy = 8;
    textureCache.set(url, entry);
  }
  if (onLoad) entry.loaded ? onLoad(entry.texture) : entry.callbacks.push(onLoad);
  return entry.texture;
}

// kit: { mat, lit, light(color, intensity, [x, y, z], parent), shadeHex, canvas(w, h, draw), random }
export function buildItem(item, kit) {
  const group = new THREE.Group();
  const add = (geometry, material, [x, y, z], { rot, cast = true, parent = group } = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (rot) mesh.rotation.set(...rot);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (w, h, d, m, pos, o) => add(new THREE.BoxGeometry(w, h, d), m, pos, o);
  const cyl = (rt, rb, h, m, pos, o) => add(new THREE.CylinderGeometry(rt, rb, h, 24), m, pos, o);
  const ball = (r, m, pos, o) => add(new THREE.SphereGeometry(r, 20, 14), m, pos, o);
  const { mat, shadeHex } = kit;
  const color = item.color ?? '#888888';
  const wood = mat('#9a7350', { roughness: 0.5 });
  const dark = mat('#2a2a2c', { roughness: 0.45, metalness: 0.4 });
  const fabric = mat(color, { roughness: 0.95 });

  const potted = (r, h, potColor = '#c98a63') => {
    cyl(r, r * 0.8, h, mat(potColor, { roughness: 0.6 }), [0, h / 2, 0]);
    cyl(r * 0.88, r * 0.88, 0.01, mat('#3b2b20', { roughness: 1 }), [0, h - 0.025, 0], { cast: false });
    return h - 0.02;
  };

  switch (item.type) {
    case 'armchair':
      box(0.8, 0.36, 0.78, fabric, [0, 0.28, 0]);
      box(0.8, 0.62, 0.18, fabric, [0, 0.68, -0.3]);
      for (const x of [-0.36, 0.36]) box(0.14, 0.56, 0.78, mat(shadeHex(color, -0.1), { roughness: 0.95 }), [x, 0.4, 0]);
      box(0.56, 0.12, 0.6, mat(shadeHex(color, 0.08), { roughness: 0.95 }), [0, 0.5, 0.05]);
      for (const [x, z] of [[-0.34, -0.32], [0.34, -0.32], [-0.34, 0.32], [0.34, 0.32]]) cyl(0.02, 0.018, 0.1, wood, [x, 0.05, z]);
      break;
    case 'beanbag': {
      const bag = ball(1, fabric, [0, 0.3, 0]);
      bag.scale.set(0.46, 0.32, 0.46);
      const dent = ball(1, mat(shadeHex(color, -0.08), { roughness: 0.95 }), [0, 0.5, -0.12]);
      dent.scale.set(0.34, 0.2, 0.26);
      break;
    }
    case 'side-table':
      cyl(0.26, 0.26, 0.03, wood, [0, 0.55, 0]);
      cyl(0.03, 0.03, 0.54, dark, [0, 0.27, 0]);
      cyl(0.17, 0.17, 0.02, dark, [0, 0.01, 0]);
      box(0.16, 0.03, 0.22, mat('#7d4b3a'), [0.03, 0.58, 0], { rot: [0, 0.4, 0] });
      break;
    case 'desk': {
      box(1.2, 0.04, 0.6, wood, [0, 0.74, 0]);
      for (const x of [-0.56, 0.56]) box(0.04, 0.72, 0.56, wood, [x, 0.36, 0]);
      box(0.34, 0.015, 0.24, mat('#b9bec6', { metalness: 0.6, roughness: 0.3 }), [0, 0.768, 0.05]);
      const screen = new THREE.Group();
      screen.position.set(0, 0.776, -0.07);
      screen.rotation.x = -0.25;
      group.add(screen);
      box(0.34, 0.22, 0.01, mat('#b9bec6', { metalness: 0.6, roughness: 0.3 }), [0, 0.11, 0], { parent: screen });
      add(new THREE.PlaneGeometry(0.31, 0.19), mat('#1b2b40', { emissive: '#4a7fc0', emissiveIntensity: 0.6 }), [0, 0.11, 0.006], { parent: screen, cast: false });
      cyl(0.04, 0.035, 0.1, mat('#f2efe9', { roughness: 0.3 }), [0.42, 0.81, 0.1]);
      break;
    }
    case 'desk-chair': {
      const seat = mat(color, { roughness: 0.8 });
      cyl(0.23, 0.23, 0.07, seat, [0, 0.48, 0]);
      box(0.4, 0.45, 0.05, seat, [0, 0.78, -0.2], { rot: [0.12, 0, 0] });
      cyl(0.025, 0.025, 0.4, dark, [0, 0.26, 0]);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        box(0.3, 0.025, 0.04, dark, [Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15], { rot: [0, -a, 0] });
        ball(0.025, dark, [Math.cos(a) * 0.29, 0.025, Math.sin(a) * 0.29]);
      }
      break;
    }
    case 'floor-lamp':
      cyl(0.15, 0.15, 0.03, dark, [0, 0.015, 0]);
      cyl(0.012, 0.012, 1.45, dark, [0, 0.74, 0]);
      cyl(0.18, 0.22, 0.28, mat(color, { side: THREE.DoubleSide, emissive: '#ffcf8f', emissiveIntensity: kit.lit ? 1.1 : 0 }), [0, 1.55, 0]);
      kit.light(0xffc27e, 5, [0, 1.5, 0], group);
      break;
    case 'plant-tall': {
      const top = potted(0.18, 0.34, '#d9d2c6');
      cyl(0.012, 0.016, 1.1, mat('#5a4430'), [0, top + 0.55, 0]);
      for (let i = 0; i < 18; i++) {
        const a = i * 2.4;
        const leaf = ball(1, mat(shadeHex('#3f7a46', (kit.random() - 0.5) * 0.25), { roughness: 0.6 }), [Math.cos(a) * 0.14, top + 0.25 + (i / 18) * 1.0, Math.sin(a) * 0.14], { rot: [0, -a, 0.6] });
        leaf.scale.set(0.15, 0.015, 0.08);
      }
      break;
    }
    case 'plant-small': {
      const top = potted(0.11, 0.18);
      for (let i = 0; i < 9; i++) add(new THREE.IcosahedronGeometry(0.06, 1), mat(shadeHex('#4f8a4a', (kit.random() - 0.5) * 0.3), { roughness: 0.7 }), [(kit.random() - 0.5) * 0.14, top + 0.05 + kit.random() * 0.12, (kit.random() - 0.5) * 0.14]);
      break;
    }
    case 'cactus': {
      const top = potted(0.1, 0.16, '#d47a4f');
      const green = mat('#4c7f45', { roughness: 0.7 });
      add(new THREE.CapsuleGeometry(0.06, 0.32, 6, 12), green, [0, top + 0.21, 0]);
      add(new THREE.CapsuleGeometry(0.035, 0.1, 6, 10), green, [0.08, top + 0.26, 0], { rot: [0, 0, -0.9] });
      add(new THREE.CapsuleGeometry(0.03, 0.08, 6, 10), green, [-0.07, top + 0.18, 0], { rot: [0, 0, 0.9] });
      break;
    }
    case 'flowers': {
      cyl(0.07, 0.09, 0.3, mat('#dfe7ea', { roughness: 0.15, transparent: true, opacity: 0.85 }), [0, 0.15, 0]);
      for (let i = 0; i < 7; i++) {
        const a = i * 2.2;
        const r = 0.04 + kit.random() * 0.05;
        const h = 0.45 + kit.random() * 0.15;
        cyl(0.004, 0.004, h - 0.25, mat('#4f7d3e'), [Math.cos(a) * r * 0.5, 0.25 + (h - 0.25) / 2, Math.sin(a) * r * 0.5], { rot: [Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2] });
        ball(0.035, mat(i % 3 ? color : shadeHex(color, 0.35), { roughness: 0.7 }), [Math.cos(a) * r, h, Math.sin(a) * r]);
      }
      break;
    }
    case 'bookcase': {
      for (const x of [-0.39, 0.39]) box(0.03, 1.1, 0.3, wood, [x, 0.55, 0]);
      box(0.8, 1.1, 0.02, wood, [0, 0.55, -0.14]);
      const shelves = [0.02, 0.38, 0.74, 1.09];
      for (const y of shelves) box(0.78, 0.025, 0.3, wood, [0, y, 0]);
      const spines = ['#8c3b2f', '#2f4d6e', '#c9a54a', '#4e7454', '#6d4c7d', '#d8d2c4', '#24324a', '#a86a3c'];
      for (const y of shelves.slice(0, 3)) {
        let x = -0.36;
        while (x < 0.3) {
          const t = 0.025 + kit.random() * 0.03;
          const h = 0.18 + kit.random() * 0.12;
          box(t, h, 0.2, mat(spines[Math.floor(kit.random() * spines.length)], { roughness: 0.7 }), [x + t / 2, y + 0.013 + h / 2, 0.02]);
          x += t + 0.004;
        }
      }
      break;
    }
    case 'guitar': {
      const body = mat(color, { roughness: 0.35 });
      const g = new THREE.Group();
      g.position.set(0, 0.12, 0);
      g.rotation.x = -0.25;
      group.add(g);
      for (const [y, r] of [[0.2, 0.19], [0.44, 0.15]]) {
        const part = ball(1, body, [0, y, 0], { parent: g });
        part.scale.set(r, r * 1.05, 0.06);
      }
      add(new THREE.CircleGeometry(0.05, 20), mat('#1a1410'), [0, 0.36, 0.061], { parent: g, cast: false });
      box(0.05, 0.5, 0.025, mat('#4a3020'), [0, 0.82, 0.02], { parent: g });
      box(0.07, 0.13, 0.025, mat('#4a3020'), [0, 1.12, 0.02], { parent: g });
      for (const x of [-0.1, 0.1]) cyl(0.008, 0.008, 0.25, dark, [x, 0.1, 0.08], { rot: [0.5, 0, 0] });
      cyl(0.008, 0.008, 0.6, dark, [0, 0.3, -0.12], { rot: [-0.3, 0, 0] });
      break;
    }
    case 'telescope': {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        cyl(0.012, 0.012, 1.1, dark, [Math.cos(a) * 0.2, 0.52, Math.sin(a) * 0.2], { rot: [Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35] });
      }
      const tube = cyl(0.07, 0.06, 0.8, mat('#e8e8ea', { roughness: 0.35, metalness: 0.3 }), [0, 1.12, 0.05], { rot: [-1.0, 0, 0] });
      tube.castShadow = true;
      cyl(0.02, 0.02, 0.1, dark, [0, 0.93, -0.25], { rot: [-1.0, 0, 0] });
      break;
    }
    case 'rug-round': {
      const map = kit.canvas(512, 512, (ctx, w, h) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        for (let r = 230; r > 30; r -= 34) {
          ctx.strokeStyle = r % 68 ? shadeHex(color, 0.25) : shadeHex(color, -0.2);
          ctx.lineWidth = 10;
          ctx.beginPath();
          ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      add(new THREE.CircleGeometry(0.9, 48), mat('#ffffff', { map, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }), [0, 0.007, 0], { rot: [-Math.PI / 2, 0, 0], cast: false });
      break;
    }
    case 'aquarium': {
      box(0.9, 0.6, 0.4, wood, [0, 0.3, 0]);
      add(new THREE.BoxGeometry(0.86, 0.5, 0.36), mat('#bfe3f0', { transparent: true, opacity: 0.18, roughness: 0.05 }), [0, 0.86, 0], { cast: false });
      add(new THREE.BoxGeometry(0.84, 0.42, 0.34), mat('#3b8fb5', { transparent: true, opacity: 0.35, roughness: 0.1, emissive: '#1d5f80', emissiveIntensity: 0.25 }), [0, 0.82, 0], { cast: false });
      box(0.84, 0.04, 0.34, mat('#d8c9a0'), [0, 0.63, 0], { cast: false });
      for (let i = 0; i < 5; i++) {
        const fish = add(new THREE.ConeGeometry(0.025, 0.07, 10), mat(i % 2 ? '#f08a2c' : '#f4d03f', { emissive: '#552200', emissiveIntensity: 0.2 }), [(kit.random() - 0.5) * 0.6, 0.72 + kit.random() * 0.25, (kit.random() - 0.5) * 0.2], { rot: [0, 0, Math.PI / 2], cast: false });
        fish.rotation.y = kit.random() > 0.5 ? Math.PI : 0;
      }
      for (let i = 0; i < 4; i++) cyl(0.008, 0.012, 0.18 + kit.random() * 0.1, mat('#3f7a46'), [-0.3 + i * 0.18, 0.75, -0.1], { cast: false });
      box(0.9, 0.04, 0.4, dark, [0, 1.13, 0]);
      break;
    }
    case 'speaker':
      box(0.3, 0.9, 0.3, mat('#1d1d20', { roughness: 0.6 }), [0, 0.45, 0]);
      for (const [y, r] of [[0.68, 0.06], [0.35, 0.11]]) {
        add(new THREE.CircleGeometry(r, 24), mat('#3a3a3e', { roughness: 0.4 }), [0, y, 0.151], { cast: false });
        add(new THREE.CircleGeometry(r * 0.35, 16), mat('#111'), [0, y, 0.152], { cast: false });
      }
      break;
    case 'flatscreen': {
      // A big TV on a low stand, about 1.6 m across.
      box(1.5, 0.42, 0.4, mat('#2b2622', { roughness: 0.5 }), [0, 0.21, 0]);
      box(1.64, 0.94, 0.05, dark, [0, 0.98, 0]);
      add(new THREE.PlaneGeometry(1.58, 0.88), mat('#06070a', { roughness: 0.1, metalness: 0.3, emissive: '#0c1a2e', emissiveIntensity: 0.4 }), [0, 0.98, 0.026], { cast: false });
      box(0.4, 0.03, 0.2, dark, [0, 0.44, 0]);
      break;
    }
    case 'teddy': {
      const fur = mat(color, { roughness: 1 });
      const body = ball(1, fur, [0, 0.2, 0]);
      body.scale.set(0.16, 0.19, 0.14);
      ball(0.12, fur, [0, 0.46, 0.01]);
      for (const x of [-0.08, 0.08]) ball(0.045, fur, [x, 0.57, 0]);
      ball(0.05, mat(shadeHex(color, 0.3), { roughness: 1 }), [0, 0.44, 0.1]);
      for (const x of [-0.04, 0.04]) ball(0.012, mat('#111'), [x, 0.49, 0.1]);
      for (const x of [-0.17, 0.17]) ball(0.06, fur, [x, 0.25, 0.04]);
      for (const x of [-0.08, 0.08]) ball(0.065, fur, [x, 0.06, 0.08]);
      break;
    }
    case 'spider': {
      // A giant toy spider: hairy-dark body, eight bent legs, a few shiny eyes.
      const skin = mat(color, { roughness: 0.9 });
      const abdomen = ball(1, skin, [0, 0.32, -0.22]);
      abdomen.scale.set(0.24, 0.2, 0.3);
      const head = ball(1, skin, [0, 0.28, 0.12]);
      head.scale.set(0.14, 0.12, 0.14);
      for (const [x, y] of [[-0.05, 0.33], [0.05, 0.33], [-0.025, 0.36], [0.025, 0.36]]) ball(0.018, mat('#b8202a', { roughness: 0.2, emissive: '#400', emissiveIntensity: 0.4 }), [x, y, 0.24], { cast: false });
      // Eight legs fanned out around the body, each a thigh up to a knee and a shin down to the floor.
      const segment = (from, to, r1, r2, parent) => {
        const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
        const leg = cyl(r2, r1, a.distanceTo(b), skin, [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], { parent });
        leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      };
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const pivot = new THREE.Group();
          pivot.position.set(side * 0.06, 0.3, 0.12 - i * 0.08);
          const fan = -0.95 + i * 0.6; // front legs reach forward, back legs back
          pivot.rotation.y = side > 0 ? fan : Math.PI - fan;
          group.add(pivot);
          segment([0.05, 0, 0], [0.34, 0.2, 0], 0.018, 0.015, pivot);
          segment([0.34, 0.2, 0], [0.62, -0.3, 0], 0.015, 0.008, pivot);
          ball(0.02, skin, [0.34, 0.2, 0], { parent: pivot });
        }
      }
      break;
    }
    case 'photo': {
      const frame = box(0.66, 0.5, 0.03, mat('#2b2622', { roughness: 0.5 }), [0, 0, 0.015]);
      const picture = add(new THREE.PlaneGeometry(0.6, 0.44), mat('#ffffff', { roughness: 0.8 }), [0, 0, 0.032], { cast: false });
      // Once the picture is loaded, the frame takes its shape (portrait or landscape).
      const fit = (t) => {
        const aspect = t.image.height / t.image.width;
        const h = Math.min(0.9, Math.max(0.3, 0.6 * aspect));
        picture.geometry.dispose();
        picture.geometry = new THREE.PlaneGeometry(h / aspect > 0.9 ? 0.9 : h / aspect, h);
        frame.geometry.dispose();
        frame.geometry = new THREE.BoxGeometry(picture.geometry.parameters.width + 0.06, h + 0.06, 0.03);
      };
      picture.material.map = pictureTexture(item.image, fit);
      picture.material.needsUpdate = true;
      break;
    }
    case 'poster': {
      const map = kit.canvas(360, 500, (ctx, w, h) => {
        ctx.fillStyle = '#f1ebe0';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.42, w * 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = shadeHex(color, -0.45);
        ctx.fillRect(w * 0.15, h * 0.72, w * 0.7, 10);
        ctx.fillRect(w * 0.25, h * 0.79, w * 0.5, 6);
      });
      add(new THREE.PlaneGeometry(0.5, 0.7), mat('#ffffff', { map, roughness: 0.9 }), [0, 0, 0.005], { cast: false });
      break;
    }
    case 'clock': {
      cyl(0.17, 0.17, 0.04, dark, [0, 0, 0.02], { rot: [Math.PI / 2, 0, 0] });
      add(new THREE.CircleGeometry(0.15, 40), mat('#f6f3ec', { roughness: 0.6 }), [0, 0, 0.041], { cast: false });
      const now = new Date();
      const hand = (len, w, angle, z) => {
        const m = box(w, len, 0.004, dark, [Math.sin(angle) * len / 2, Math.cos(angle) * len / 2, z], { cast: false });
        m.rotation.z = -angle;
      };
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        box(0.008, i % 3 ? 0.015 : 0.03, 0.003, dark, [Math.sin(a) * 0.13, Math.cos(a) * 0.13, 0.043], { rot: [0, 0, -a], cast: false });
      }
      hand(0.08, 0.012, ((now.getHours() % 12) + now.getMinutes() / 60) / 12 * Math.PI * 2, 0.045);
      hand(0.12, 0.008, now.getMinutes() / 60 * Math.PI * 2, 0.047);
      break;
    }
    case 'shelf':
      box(0.8, 0.03, 0.2, wood, [0, 0, 0.1]);
      for (const x of [-0.3, 0.3]) box(0.02, 0.12, 0.15, dark, [x, -0.07, 0.075]);
      for (let i = 0; i < 4; i++) box(0.03, 0.2, 0.15, mat(['#8c3b2f', '#2f4d6e', '#c9a54a', '#4e7454'][i]), [-0.33 + i * 0.035, 0.115, 0.1]);
      cyl(0.05, 0.04, 0.08, mat('#c98a63'), [0.15, 0.055, 0.1]);
      for (let i = 0; i < 4; i++) add(new THREE.IcosahedronGeometry(0.035, 0), mat('#4f8a4a'), [0.15 + (kit.random() - 0.5) * 0.06, 0.12 + kit.random() * 0.04, 0.1 + (kit.random() - 0.5) * 0.05]);
      cyl(0.025, 0.025, 0.07, mat('#f3efe6', { emissive: '#ffcf8f', emissiveIntensity: kit.lit ? 0.6 : 0 }), [0.3, 0.05, 0.1]);
      break;
    case 'string-lights': {
      const bulb = mat(color, { emissive: color, emissiveIntensity: kit.lit ? 2.2 : 0.35 });
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        ball(0.018, bulb, [-0.8 + t * 1.6, -Math.sin(t * Math.PI) * 0.18, 0.03], { cast: false });
      }
      kit.light(new THREE.Color(color).getHex(), 1.5, [0, -0.15, 0.3], group);
      break;
    }
    case 'model': {
      // Your own 3D model: resized so its biggest side is 1 m (times its size), sitting on the floor.
      let entry = modelCache.get(item.model);
      if (!entry) {
        entry = gltfLoader.loadAsync(item.model);
        modelCache.set(item.model, entry);
      }
      entry
        .then((gltf) => {
          const model = gltf.scene.clone(true);
          const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
          const fitScale = 1 / Math.max(size.x, size.y, size.z, 0.001);
          model.scale.setScalar(fitScale);
          const bounds = new THREE.Box3().setFromObject(model);
          model.position.y -= bounds.min.y;
          model.position.x -= (bounds.min.x + bounds.max.x) / 2;
          model.position.z -= (bounds.min.z + bounds.max.z) / 2;
          model.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
          group.add(model);
        })
        .catch((err) => console.warn('Could not load 3D model', item.model, err));
      break;
    }
  }
  return group;
}
