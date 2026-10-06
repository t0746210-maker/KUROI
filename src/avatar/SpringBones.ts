import * as THREE from 'three';
import type { SphereCollider, SpringChain } from './AvatarBuilder';

interface Joint {
  bone: THREE.Bone;
  initRot: THREE.Quaternion;
  axis: THREE.Vector3;
  length: number;
  tailLocal: THREE.Vector3;
  current: THREE.Vector3;
  prev: THREE.Vector3;
  chain: SpringChain;
}

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _wp = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

/** VRM SpringBone と同じアルゴリズムの揺れ物シミュレーション */
export class SpringBoneSimulator {
  private joints: Joint[] = [];
  enabled = true;
  gravityDir = new THREE.Vector3(0, -1, 0);
  wind = new THREE.Vector3();

  constructor(chains: SpringChain[], private colliders: SphereCollider[]) {
    for (const chain of chains) {
      // 最後のボーンはテール（位置のみ）なのでシミュレーションしない
      chain.bones.forEach((bone, i) => {
        const next = chain.bones[i + 1];
        if (!next) return;
        const tailLocal = next.position.clone();
        this.joints.push({
          bone,
          initRot: bone.quaternion.clone(),
          axis: tailLocal.clone().normalize(),
          length: tailLocal.length(),
          tailLocal,
          current: new THREE.Vector3(),
          prev: new THREE.Vector3(),
          chain,
        });
      });
    }
    this.reset();
  }

  reset() {
    for (const j of this.joints) {
      j.bone.quaternion.copy(j.initRot);
      j.bone.updateMatrixWorld(true);
      const tail = j.tailLocal.clone().applyMatrix4(j.bone.matrixWorld);
      j.current.copy(tail);
      j.prev.copy(tail);
    }
  }

  update(dt: number) {
    if (!this.enabled || !this.joints.length) return;
    dt = Math.min(dt, 1 / 30);
    const cols = this.colliders.map((c) => ({
      center: c.offset.clone().applyMatrix4(c.bone.matrixWorld),
      radius: c.radius,
    }));
    for (const j of this.joints) {
      const parent = j.bone.parent!;
      parent.updateWorldMatrix(true, false);
      // 初期姿勢でのワールド行列
      _m.compose(j.bone.position, j.initRot, _one);
      _m2.multiplyMatrices(parent.matrixWorld, _m);
      _wp.setFromMatrixPosition(_m2);
      const length = j.length * _v.setFromMatrixScale(parent.matrixWorld).x;

      const inertia = _v.subVectors(j.current, j.prev).multiplyScalar(1 - j.chain.dragForce);
      const stiffDir = _v2.copy(j.axis).transformDirection(_m2).multiplyScalar(j.chain.stiffness * dt);
      const next = j.current.clone().add(inertia).add(stiffDir)
        .addScaledVector(this.gravityDir, j.chain.gravityPower * dt)
        .addScaledVector(this.wind, dt);
      next.sub(_wp).normalize().multiplyScalar(length).add(_wp);

      for (const c of cols) {
        const r = c.radius + j.chain.hitRadius;
        const d = next.distanceTo(c.center);
        if (d < r) {
          next.sub(c.center).normalize().multiplyScalar(r).add(c.center);
          next.sub(_wp).normalize().multiplyScalar(length).add(_wp);
        }
      }
      j.prev.copy(j.current);
      j.current.copy(next);

      // 回転に反映
      const inv = _m.copy(_m2).invert();
      const to = next.clone().applyMatrix4(inv).normalize();
      _q.setFromUnitVectors(j.axis, to);
      j.bone.quaternion.copy(j.initRot).multiply(_q);
      j.bone.updateMatrixWorld(true);
    }
  }
}
