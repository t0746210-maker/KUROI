import * as THREE from 'three';
import type { Avatar } from '../avatar/Avatar';
import { bakeMesh, safeMeshName } from './bake';
import type { FBXAnim, FBXBone, FBXMorph, FBXRig, Vec3 } from './fbx';

const deg = THREE.MathUtils.radToDeg;
const _e = new THREE.Euler();

/** three のクォータニオン → FBX eEulerXYZ（度）。FBX の XYZ は three の 'ZYX' 順に相当 */
export function fbxEuler(q: THREE.Quaternion): Vec3 {
  _e.setFromQuaternion(q, 'ZYX');
  return [deg(_e.x), deg(_e.y), deg(_e.z)];
}

/**
 * アバターからボーン付き FBX 用のリグ情報を集める。
 * メッシュはバインド姿勢のまま書き出し、ポーズはボーンの Lcl 値として表現する。
 */
export function collectRig(av: Avatar, opts: { tpose: boolean; includeAnimations: boolean; fps?: number }): FBXRig {
  const data = av.data;
  const root = data.root;
  const bones = data.skeleton.bones;
  const fps = opts.fps ?? 30;
  root.updateMatrixWorld(true);

  // アバターは原点でバインドされているので、boneInverses の逆行列にルートの現在の変換を掛けて
  // 「ルートが今の位置にある状態」のバインド行列にそろえる（FBX ではメッシュの現在位置＝バインド位置とみなす読込側が多い）
  root.updateMatrix();
  const rootMat = root.matrix.clone();
  const bindWorld = data.skeleton.boneInverses.map((inv) => rootMat.clone().multiply(new THREE.Matrix4().copy(inv).invert()));
  const index = new Map(bones.map((b, i) => [b, i] as const));
  const parentIndex = (b: THREE.Bone) => (b.parent && index.has(b.parent as THREE.Bone) ? index.get(b.parent as THREE.Bone)! : -1);

  const restLocal = (i: number) => {
    const pi = parentIndex(bones[i]);
    const parentBind = pi >= 0 ? bindWorld[pi] : rootMat;
    const m = new THREE.Matrix4().copy(parentBind).invert().multiply(bindWorld[i]);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(p, q, s);
    return { p, q, s };
  };

  const fbxBones: FBXBone[] = bones.map((b, i) => {
    const local = opts.tpose ? restLocal(i) : { p: b.position, q: b.quaternion, s: b.scale };
    return {
      name: b.name,
      parent: parentIndex(b),
      t: local.p.toArray() as Vec3,
      r: fbxEuler(local.q),
      s: local.s.toArray() as Vec3,
      bindWorld: bindWorld[i].toArray(),
    };
  });

  const used = new Set<string>();
  const meshes = data.meshes
    .filter((m) => m.visible)
    .map((m) => {
      const g = m.geometry;
      const baked = bakeMesh(m, safeMeshName(m.name, used), true);
      const morphs: FBXMorph[] = [];
      const dict = m.morphTargetDictionary ?? {};
      const names = Object.entries(dict).sort((a, b) => a[1] - b[1]).map(([n]) => n);
      const pos = g.attributes.position as THREE.BufferAttribute;
      (g.morphAttributes.position ?? []).forEach((attr, mi) => {
        const idx: number[] = [];
        const del: number[] = [];
        for (let v = 0; v < attr.count; v++) {
          let dx = attr.getX(v), dy = attr.getY(v), dz = attr.getZ(v);
          if (!g.morphTargetsRelative) {
            dx -= pos.getX(v);
            dy -= pos.getY(v);
            dz -= pos.getZ(v);
          }
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-7) continue;
          idx.push(v);
          del.push(dx, dy, dz);
        }
        if (idx.length) morphs.push({ name: names[mi] ?? `shape${mi}`, indices: Int32Array.from(idx), deltas: Float64Array.from(del) });
      });
      return {
        mesh: baked,
        skinIndex: (g.attributes.skinIndex as THREE.BufferAttribute).array as ArrayLike<number>,
        skinWeight: (g.attributes.skinWeight as THREE.BufferAttribute).array as ArrayLike<number>,
        morphs,
        bindWorld: rootMat.toArray(),
      };
    });

  const anims: FBXAnim[] = [];
  if (opts.includeAnimations && av.clips.length) {
    // 現在の姿勢を退避してから、専用ミキサーで 30fps にサンプリング
    const saved = bones.map((b) => ({ p: b.position.clone(), q: b.quaternion.clone() }));
    const prevFrozen = av.frozen;
    av.frozen = true;
    const mixer = new THREE.AnimationMixer(root);
    try {
      for (const clip of av.clips) {
        const animated = new Set<string>();
        const posAnimated = new Set<string>();
        for (const t of clip.tracks) {
          const [n, prop] = t.name.split('.');
          if (prop === 'quaternion') animated.add(n);
          if (prop === 'position') posAnimated.add(n);
        }
        const targets = bones.map((b, i) => ({ b, i })).filter(({ b }) => animated.has(b.name) || posAnimated.has(b.name));
        if (!targets.length) continue;
        const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
        const rot = targets.map(() => new Float32Array(frames * 3));
        const pos = targets.map(({ b }) => (posAnimated.has(b.name) ? new Float32Array(frames * 3) : undefined));
        // 動かないボーンはレスト姿勢に戻しておく
        bones.forEach((b, i) => {
          if (b.name.startsWith('hair_')) return;
          const r = restLocal(i);
          b.position.copy(r.p);
          b.quaternion.copy(r.q);
        });
        mixer.stopAllAction();
        const action = mixer.clipAction(clip);
        action.play();
        for (let f = 0; f < frames; f++) {
          mixer.setTime(Math.min(clip.duration, f / fps));
          targets.forEach(({ b }, k) => {
            rot[k].set(fbxEuler(b.quaternion), f * 3);
            pos[k]?.set(b.position.toArray(), f * 3);
          });
        }
        action.stop();
        mixer.uncacheClip(clip);
        anims.push({ name: clip.name, fps, frames, tracks: targets.map(({ i }, k) => ({ bone: i, rot: rot[k], pos: pos[k] })) });
      }
    } finally {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      bones.forEach((b, i) => {
        b.position.copy(saved[i].p);
        b.quaternion.copy(saved[i].q);
      });
      root.updateMatrixWorld(true);
      av.frozen = prevFrozen;
    }
  }

  return {
    name: root.name || 'Avatar',
    root: {
      t: root.position.toArray() as Vec3,
      r: fbxEuler(root.quaternion),
      s: root.scale.toArray() as Vec3,
      world: rootMat.toArray(),
    },
    bones: fbxBones,
    meshes,
    anims,
  };
}
