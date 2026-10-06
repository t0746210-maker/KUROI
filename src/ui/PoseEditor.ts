import * as THREE from 'three';
import type { App } from './App';
import { HUMAN_BONES } from '../avatar/AvatarBuilder';

/** ボーンをクリックして回転させるポーズ編集モード */
export class PoseEditor {
  active = false;
  /** ポーズタブで有効化を希望しているか */
  wanted = false;
  private handles: THREE.Mesh[] = [];
  private group = new THREE.Group();
  private geo = new THREE.SphereGeometry(1, 12, 8);
  private matIdle = new THREE.MeshBasicMaterial({ color: 0x5fc8ff, depthTest: false, transparent: true, opacity: 0.85 });
  private matSel = new THREE.MeshBasicMaterial({ color: 0xffb02e, depthTest: false, transparent: true, opacity: 0.95 });

  constructor(private app: App) {
    this.group.name = '__poseHandles';
    this.group.renderOrder = 999;
    app.studio.helpers.add(this.group);
    app.studio.addUpdater(() => this.update());
  }

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    const st = this.app.studio;
    if (on) {
      this.app.avatar.play(null);
      this.refresh();
      st.pickFilter = (o) => (o.userData.boneHandle ? o.userData.boneHandle : null);
      st.setGizmoMode('rotate');
      st.gizmo.setSpace('local');
    } else {
      st.pickFilter = null;
      if (st.selected?.userData.isBone) st.select(null);
      st.gizmo.setSpace('world');
      this.clearHandles();
    }
  }

  private clearHandles() {
    for (const h of this.handles) this.group.remove(h);
    this.handles = [];
  }

  refresh() {
    if (!this.active) return;
    this.clearHandles();
    const bones = this.app.avatar.data.bones;
    const s = this.app.avatar.params.height / 1.6;
    for (const name of HUMAN_BONES) {
      const b = bones[name];
      if (!b || name.endsWith('Eye') || name.endsWith('Toes')) continue;
      b.userData.isBone = true;
      const m = new THREE.Mesh(this.geo, this.matIdle);
      m.scale.setScalar((name === 'hips' ? 0.028 : name.includes('Hand') || name === 'neck' ? 0.014 : 0.018) * s);
      m.renderOrder = 999;
      m.userData.boneHandle = b;
      m.userData.pickable = true;
      m.name = name;
      this.handles.push(m);
      this.group.add(m);
    }
    this.group.userData.pickable = true;
    // Studio.pick は helpers 直下の pickable を見るので、各ハンドルを登録
    for (const h of this.handles) h.userData.pickable = true;
  }

  private update() {
    if (!this.active) return;
    const sel = this.app.studio.selected;
    for (const h of this.handles) {
      const b = h.userData.boneHandle as THREE.Bone;
      h.position.setFromMatrixPosition(b.matrixWorld);
      h.material = b === sel ? this.matSel : this.matIdle;
    }
  }
}
