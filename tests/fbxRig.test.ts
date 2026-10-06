import './setup';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { Avatar } from '../src/avatar/Avatar';
import { collectRig } from '../src/io/fbxRig';
import { buildFBX } from '../src/io/fbx';
import { bakeScene } from '../src/io/bake';

function load(buf: Uint8Array) {
  return new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '');
}

describe('ボーン付き FBX', () => {
  it('スケルトン・スキン・ブレンドシェイプ・アニメーションを読み戻せる', () => {
    const av = new Avatar({ hairStyle: 'ponytail' });
    const rig = collectRig(av, { tpose: false, includeAnimations: true });
    const fbx = buildFBX([], { rig, sceneName: 'test' });
    const obj = load(fbx);
    const skinned: THREE.SkinnedMesh[] = [];
    obj.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && skinned.push(o as THREE.SkinnedMesh));
    expect(skinned.map((m) => m.name).sort()).toEqual(['Body', 'Face', 'Hair', 'Outfit']);
    const bones = new Set<string>();
    obj.traverse((o) => (o as THREE.Bone).isBone && bones.add(o.name));
    for (const b of ['hips', 'head', 'leftHand', 'rightFoot', 'hair_ponytail_0']) expect(bones.has(b), b).toBe(true);
    const face = skinned.find((m) => m.name === 'Face')!;
    expect(Object.keys(face.morphTargetDictionary ?? {})).toEqual(expect.arrayContaining(['happy', 'aa', 'blink']));
    expect(obj.animations.map((a) => a.name)).toEqual(expect.arrayContaining(['待機', '歩く', 'ダンス']));
  });

  it('ポーズを付けたスキニング結果が元と一致する', () => {
    const av = new Avatar({ hairStyle: 'short' });
    av.springEnabled = false;
    const b = av.data.bones;
    b.leftUpperArm.rotation.set(0.2, 0.3, -1.1);
    b.leftLowerArm.rotation.set(0, -0.9, 0);
    b.spine.rotation.set(0.25, 0.1, 0);
    b.rightUpperLeg.rotation.set(-0.7, 0, 0.1);
    av.root.position.set(0.3, 0, -0.2);
    av.root.updateMatrixWorld(true);
    const original = bakeScene(av.root).find((m) => m.name === 'Body')!;

    const fbx = buildFBX([], { rig: collectRig(av, { tpose: false, includeAnimations: false }) });
    const obj = load(fbx);
    obj.updateMatrixWorld(true);
    const loaded = bakeScene(obj).find((m) => m.name === 'Body')!;
    // FBXLoader は面を展開するので、元の頂点インデックス経由で比較する
    let maxErr = 0;
    for (let k = 0; k < original.indices.length; k += 97) {
      const vi = original.indices[k];
      const a = new THREE.Vector3().fromArray(original.positions, vi * 3);
      const bb = new THREE.Vector3().fromArray(loaded.positions, k * 3);
      maxErr = Math.max(maxErr, a.distanceTo(bb));
    }
    expect(maxErr).toBeLessThan(1e-3);
  });

  it('T ポーズ出力ではボーンがレスト姿勢になる', () => {
    const av = new Avatar();
    av.data.bones.leftUpperArm.rotation.z = -1.2;
    const rig = collectRig(av, { tpose: true, includeAnimations: false });
    const arm = rig.bones.find((x) => x.name === 'leftUpperArm')!;
    expect(arm.r.map((v) => Math.abs(v) < 1e-6)).toEqual([true, true, true]);
  });
});
