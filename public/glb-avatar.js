// Lets a plain .glb character stand in for a VRM avatar. scene.js drives the
// avatar through a small part of the three-vrm API (normalized humanoid bones,
// expressions, lookAt, update), so this maps a regular skeleton and face shape
// keys onto it. Bones: Mixamo-named rigs (Mixamo, Avaturn), Character Creator,
// Unreal, 3ds Max Biped, Rigify and VRoid-style names. Face: Apple ARKit shape
// keys, visemes, or VRM-style names.
import * as THREE from 'three';

// Names are compared lowercased, with punctuation and rig prefixes removed, so
// "mixamorig:LeftArm", "CC_Base_L_Upperarm" and "upperarm_l" all match.
const BONES = {
  spine: ['spine', 'cspine', 'spine01'],
  chest: ['chest', 'cchest', 'spine1', 'spine02'],
  head: ['head', 'chead'],
  leftUpperArm: ['leftarm', 'leftupperarm', 'lupperarm', 'upperarml'],
  rightUpperArm: ['rightarm', 'rightupperarm', 'rupperarm', 'upperarmr'],
  leftLowerArm: ['leftforearm', 'leftlowerarm', 'lforearm', 'llowerarm', 'lowerarml', 'forearml'],
  rightLowerArm: ['rightforearm', 'rightlowerarm', 'rforearm', 'rlowerarm', 'lowerarmr', 'forearmr'],
  leftEye: ['lefteye', 'leye', 'eyel', 'eyeleft'],
  rightEye: ['righteye', 'reye', 'eyer', 'eyeright'],
};
const boneKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^(mixamorig\d*|ccbase|jbip|bip0*1|def)/, '');
const shapeKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// Each VRM expression is a list of options, and the first option the model has
// any shape key for is used. A part is [alternative names, weight].
const FACE = {
  blink: [
    [[['eyeblinkleft', 'eyeblinkl', 'blinkleft', 'blinkl'], 1], [['eyeblinkright', 'eyeblinkr', 'blinkright', 'blinkr'], 1]],
    [[['blink', 'eyesclosed', 'eyeclose', 'eyeblink', 'fcleyeclose'], 1]],
  ],
  aa: [
    [[['visemeaa', 'aa', 'a', 'vrcvaa', 'fclmtha', 'mouthopen'], 1]],
    [[['jawopen'], 0.7]],
  ],
  oh: [
    [[['visemeo', 'oh', 'o', 'vrcvoh', 'fclmtho'], 1]],
    [[['mouthfunnel'], 0.6], [['mouthpucker'], 0.3]],
  ],
  happy: [
    [[['mouthsmileleft', 'mouthsmilel'], 0.8], [['mouthsmileright', 'mouthsmiler'], 0.8], [['cheeksquintleft', 'cheeksquintl'], 0.4], [['cheeksquintright', 'cheeksquintr'], 0.4]],
    [[['happy', 'joy', 'smile', 'mouthsmile', 'fclalljoy'], 1]],
  ],
  angry: [
    [[['browdownleft', 'browdownl'], 0.9], [['browdownright', 'browdownr'], 0.9], [['nosesneerleft', 'nosesneerl'], 0.3], [['nosesneerright', 'nosesneerr'], 0.3], [['mouthpressleft', 'mouthpressl'], 0.3], [['mouthpressright', 'mouthpressr'], 0.3]],
    [[['angry', 'anger', 'fclallangry'], 1]],
  ],
  sad: [
    [[['browinnerup'], 0.8], [['mouthfrownleft', 'mouthfrownl'], 0.7], [['mouthfrownright', 'mouthfrownr'], 0.7]],
    [[['sad', 'sorrow', 'fclallsorrow'], 1]],
  ],
  relaxed: [
    [[['eyesquintleft', 'eyesquintl'], 0.4], [['eyesquintright', 'eyesquintr'], 0.4], [['mouthsmileleft', 'mouthsmilel'], 0.3], [['mouthsmileright', 'mouthsmiler'], 0.3]],
    [[['relaxed', 'fun', 'calm', 'fclallfun'], 1]],
  ],
  surprised: [
    [[['browinnerup'], 0.8], [['browouterupleft', 'browouterupl'], 0.8], [['browouterupright', 'browouterupr'], 0.8], [['eyewideleft', 'eyewidel'], 0.8], [['eyewideright', 'eyewider'], 0.8], [['jawopen'], 0.25]],
    [[['surprised', 'surprise', 'fclallsurprised'], 1]],
  ],
};

// How far the eyes turn toward the gaze target, in radians.
const EYE_YAW = 0.35;
const EYE_PITCH = 0.25;

// Returns an object shaped like the parts of a VRM that scene.js uses, plus
// `missing`: which of 'skeleton', 'mouth' and 'blink' the model couldn't be wired up for.
export function glbAvatar(root) {
  const found = {};
  root.traverse((obj) => {
    const key = boneKey(obj.name || '');
    for (const [bone, names] of Object.entries(BONES)) {
      if (names.includes(key) && (!found[bone] || (obj.isBone && !found[bone].isBone))) found[bone] = obj;
    }
  });

  // glTF characters face +Z like VRM 1.0 ones, but some exports face the other
  // way. The character's left arm is on the +X side when it faces +Z.
  root.updateMatrixWorld(true);
  const at = (obj) => obj.getWorldPosition(new THREE.Vector3());
  if (found.leftUpperArm && found.rightUpperArm && at(found.leftUpperArm).x < at(found.rightUpperArm).x) {
    root.rotation.y += Math.PI;
  }
  // Meters, feet on the floor. Exports in centimeters come out 100 times too big.
  let box = new THREE.Box3().setFromObject(root);
  const height = box.max.y - box.min.y;
  if (height > 2.6 || height < 0.6) root.scale.multiplyScalar(1.7 / height);
  root.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(root);
  if (Math.abs(box.min.y) > 0.05) root.position.y -= box.min.y;
  root.updateMatrixWorld(true);

  // Normalized bones, as in three-vrm: each one starts at no rotation in the
  // character's own frame, and its rotation is carried over onto the real bone
  // on top of the real bone's rest pose. `fix` turns arms that rest in an A-pose
  // out to the T-pose that scene.js's arm angles assume.
  const rig = {};
  for (const [name, raw] of Object.entries(found)) {
    rig[name] = {
      raw,
      node: new THREE.Object3D(),
      rest: raw.quaternion.clone(),
      parentWorld: raw.parent ? raw.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(),
      fix: new THREE.Quaternion(),
    };
  }
  for (const [upper, lower, side] of [['leftUpperArm', 'leftLowerArm', 1], ['rightUpperArm', 'rightLowerArm', -1]]) {
    if (!rig[upper] || !rig[lower]) continue;
    const along = at(rig[lower].raw).sub(at(rig[upper].raw)).normalize();
    rig[upper].fix.setFromUnitVectors(along, new THREE.Vector3(side, 0, 0));
  }

  // Shape keys: every mesh with a key of that name gets it (heads, teeth and
  // tongues often share mouth keys).
  const keys = new Map();
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.morphTargetDictionary) return;
    for (const [name, index] of Object.entries(obj.morphTargetDictionary)) {
      const key = shapeKey(name);
      if (!keys.has(key)) keys.set(key, []);
      keys.get(key).push({ mesh: obj, index });
    }
  });
  const driven = new Map(); // "meshId:index" -> { mesh, index, sum }
  const expressions = {};
  for (const [expression, options] of Object.entries(FACE)) {
    for (const option of options) {
      const parts = option
        .map(([names, weight]) => {
          const name = names.find((n) => keys.has(n));
          if (!name) return null;
          const targets = keys.get(name).map(({ mesh, index }) => {
            const id = `${mesh.id}:${index}`;
            if (!driven.has(id)) driven.set(id, { mesh, index, sum: 0 });
            return driven.get(id);
          });
          return { targets, weight };
        })
        .filter(Boolean);
      if (parts.length) {
        expressions[expression] = parts;
        break;
      }
    }
  }

  const values = {};
  const eyes = ['leftEye', 'rightEye'].filter((name) => rig[name]);
  const lookAt = eyes.length ? { target: null } : null;
  const q = new THREE.Quaternion();
  const inverse = new THREE.Quaternion();
  const toTarget = new THREE.Vector3();

  function aimEyes() {
    if (!lookAt?.target) return;
    const goal = lookAt.target.getWorldPosition(new THREE.Vector3());
    for (const name of eyes) {
      const eye = rig[name];
      // The eye's frame now: its parent's current turn away from its rest pose.
      const parentNow = eye.raw.parent.getWorldQuaternion(q).multiply(inverse.copy(eye.parentWorld).invert());
      toTarget.copy(goal).sub(at(eye.raw)).applyQuaternion(parentNow.invert()).normalize();
      const yaw = THREE.MathUtils.clamp(Math.atan2(toTarget.x, toTarget.z), -EYE_YAW, EYE_YAW);
      const pitch = THREE.MathUtils.clamp(-Math.asin(toTarget.y), -EYE_PITCH, EYE_PITCH);
      eye.node.rotation.set(pitch, yaw, 0, 'YXZ');
    }
  }

  return {
    scene: root,
    humanoid: { getNormalizedBoneNode: (name) => rig[name]?.node ?? null },
    expressionManager: {
      setValue(name, value) { values[name] = value; },
      getValue: (name) => values[name] ?? 0,
    },
    lookAt,
    missing: [
      ...(rig.head && rig.leftUpperArm && rig.rightUpperArm ? [] : ['skeleton']),
      ...(expressions.aa ? [] : ['mouth']),
      ...(expressions.blink ? [] : ['blink']),
    ],
    update() {
      aimEyes();
      // real bone = parent rest^-1 * (normalized rotation * fix) * parent rest * rest
      for (const bone of Object.values(rig)) {
        q.copy(bone.node.quaternion).multiply(bone.fix);
        bone.raw.quaternion.copy(inverse.copy(bone.parentWorld).invert()).multiply(q).multiply(bone.parentWorld).multiply(bone.rest);
      }
      for (const target of driven.values()) target.sum = 0;
      for (const [expression, parts] of Object.entries(expressions)) {
        const value = values[expression] ?? 0;
        if (!value) continue;
        for (const { targets, weight } of parts) for (const target of targets) target.sum += value * weight;
      }
      for (const { mesh, index, sum } of driven.values()) mesh.morphTargetInfluences[index] = Math.min(1, sum);
    },
  };
}
