import * as THREE from 'three';
import { buildAvatar, EXPRESSIONS, type AvatarData, type ExpressionName } from './AvatarBuilder';
import { defaultParams, type AvatarParams } from './params';
import { SpringBoneSimulator } from './SpringBones';
import { applyPose, buildClips, POSES, type Pose } from './animations';

/**
 * 生成済みアバターのランタイム（アニメーション・揺れ物・表情・自動まばたき）。
 * パラメータが変わるたびに再生成されるが、ポーズ・表情・再生状態は引き継ぐ。
 */
export class Avatar {
  params: AvatarParams;
  data!: AvatarData;
  mixer!: THREE.AnimationMixer;
  clips: THREE.AnimationClip[] = [];
  springs!: SpringBoneSimulator;
  action: THREE.AnimationAction | null = null;
  currentClip: string | null = null;
  pose: Pose = POSES['自然体'];
  poseName = '自然体';
  expressions: Record<string, number> = {};
  autoBlink = true;
  springEnabled = true;
  /** エクスポート中などに更新を止める */
  frozen = false;
  private restPositions: Record<string, THREE.Vector3> = {};
  private blinkTimer = 2;
  private blinkPhase = -1;
  readonly holder = new THREE.Group();

  constructor(params: Partial<AvatarParams> = {}) {
    this.params = { ...defaultParams, ...params };
    this.holder.name = 'AvatarHolder';
    this.holder.userData.isAvatarHolder = true;
    for (const e of EXPRESSIONS) this.expressions[e] = 0;
    this.rebuild();
  }

  get root() {
    return this.data.root;
  }

  rebuild(params?: AvatarParams) {
    if (params) this.params = { ...params };
    const old = this.data;
    const oldTransform = old ? { p: old.root.position.clone(), q: old.root.quaternion.clone(), s: old.root.scale.clone() } : null;
    if (old) {
      this.holder.remove(old.root);
      disposeObject(old.root);
    }
    this.data = buildAvatar(this.params);
    if (oldTransform) {
      this.data.root.position.copy(oldTransform.p);
      this.data.root.quaternion.copy(oldTransform.q);
      this.data.root.scale.copy(oldTransform.s);
    }
    this.holder.add(this.data.root);
    this.restPositions = {};
    for (const [n, b] of Object.entries(this.data.bones)) this.restPositions[n] = b.position.clone();
    this.mixer = new THREE.AnimationMixer(this.data.root);
    this.clips = buildClips(this.restPositions.hips, this.params.height);
    this.springs = new SpringBoneSimulator(this.data.springs, this.data.colliders);
    this.springs.enabled = this.springEnabled;
    this.applyPose(this.pose, this.poseName);
    if (this.currentClip) this.play(this.currentClip);
    this.applyExpressions();
  }

  applyPose(pose: Pose, name = 'カスタム') {
    this.pose = pose;
    this.poseName = name;
    applyPose(this.data.bones, pose, this.restPositions);
    this.data.root.updateMatrixWorld(true);
    this.springs.reset();
  }

  /** 現在のボーン回転をポーズとして取り込む（ポーズ編集後） */
  capturePose(): Pose {
    const pose: Pose = {};
    const e = new THREE.Euler();
    for (const [n, b] of Object.entries(this.data.bones)) {
      if (n.startsWith('hair_')) continue;
      e.setFromQuaternion(b.quaternion, 'XYZ');
      const r: [number, number, number] = [e.x, e.y, e.z].map((v) => +THREE.MathUtils.radToDeg(v).toFixed(2)) as [number, number, number];
      if (r.some((v) => Math.abs(v) > 0.01)) pose[n] = r;
    }
    this.pose = pose;
    this.poseName = 'カスタム';
    return pose;
  }

  resetToRest() {
    applyPose(this.data.bones, {}, this.restPositions);
    for (const e of EXPRESSIONS) this.setMorph(e, 0);
    this.data.root.updateMatrixWorld(true);
  }

  play(name: string | null) {
    this.mixer.stopAllAction();
    this.action = null;
    this.currentClip = name;
    if (!name) {
      this.applyPose(this.pose, this.poseName);
      return;
    }
    const clip = this.clips.find((c) => c.name === name);
    if (!clip) return;
    this.action = this.mixer.clipAction(clip);
    this.action.play();
  }

  setExpression(name: string, value: number) {
    this.expressions[name] = value;
    this.applyExpressions();
  }

  private setMorph(name: string, v: number) {
    const m = this.data.faceMesh;
    const i = m.morphTargetDictionary?.[name];
    if (i !== undefined && m.morphTargetInfluences) m.morphTargetInfluences[i] = v;
  }

  applyExpressions(extraBlink = 0) {
    for (const e of EXPRESSIONS) {
      let v = this.expressions[e] ?? 0;
      if (e === 'blink') v = Math.min(1, v + extraBlink);
      // 笑顔などの目を閉じる表情と瞬きの重なりを抑える
      if (e === 'blink' && (this.expressions.happy > 0.5 || this.expressions.relaxed > 0.5)) v *= 0.2;
      this.setMorph(e as ExpressionName, v);
    }
  }

  update(dt: number) {
    if (this.frozen) return;
    if (this.action) this.mixer.update(dt);
    this.data.root.updateMatrixWorld(true);
    this.springs.enabled = this.springEnabled;
    this.springs.update(dt);
    // 自動まばたき
    if (this.autoBlink) {
      if (this.blinkPhase < 0) {
        this.blinkTimer -= dt;
        if (this.blinkTimer <= 0) this.blinkPhase = 0;
        this.applyExpressions(0);
      } else {
        this.blinkPhase += dt / 0.16;
        const v = this.blinkPhase < 1 ? Math.sin(this.blinkPhase * Math.PI) : 0;
        this.applyExpressions(v);
        if (this.blinkPhase >= 1) {
          this.blinkPhase = -1;
          this.blinkTimer = 2 + Math.random() * 3.5;
        }
      }
    }
  }

  stats() {
    let verts = 0;
    let tris = 0;
    for (const m of this.data.meshes) {
      verts += m.geometry.attributes.position.count;
      tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    }
    return { verts, tris, bones: this.data.skeleton.bones.length, morphs: EXPRESSIONS.length };
  }
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture && v.name !== 'toonGradient') v.dispose();
      mat.dispose();
    }
  });
}
