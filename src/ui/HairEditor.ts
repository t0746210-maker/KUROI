import * as THREE from 'three';
import type { App } from './App';
import type { HairStrand } from '../avatar/params';
import { scaledPoints } from '../avatar/AvatarBuilder';

type P3 = [number, number, number];
const add = (...vs: P3[]): P3 => vs.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0] as P3);
const mul = (v: P3, k: number): P3 => [v[0] * k, v[1] * k, v[2] * k];
export const norm = (v: P3): P3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const D: P3 = [0, -1, 0];
const U: P3 = [0, 1, 0];
const F: P3 = [0, 0, 1];
const dirOf = (phi: number, el: number): P3 => {
  const p = THREE.MathUtils.degToRad(phi);
  const e = THREE.MathUtils.degToRad(el);
  return [Math.sin(p) * Math.cos(e), Math.sin(e), Math.cos(p) * Math.cos(e)];
};

export interface StrandTemplate {
  label: string;
  icon: string;
  /** 既定の根元（頭部の経度・緯度） */
  root: [number, number];
  /** 根元の経度 phi・緯度 el（度）から制御点を作る。頭の表面に沿ってから垂らす */
  make(phi: number, el: number): P3[];
  defaults?: Partial<HairStrand>;
}

/** 頭部表面（正規化半径 r）上の点 */
const S = (phi: number, el: number, r: number): P3 => mul(dirOf(phi, el), r);

/** 房のテンプレート */
export const STRAND_TEMPLATES: Record<string, StrandTemplate> = {
  long: {
    label: '長い房', icon: '〰', root: [180, 30],
    make: (f, e) => {
      const a = S(f, Math.min(e - 30, -5), 1.16);
      return [S(f, e, 0.97), S(f, e - 15, 1.13), a, add(mul(a, 1.03), mul(D, 0.7)), add(mul(a, 0.98), mul(D, 1.5))];
    },
    defaults: { spring: true },
  },
  bang: {
    label: '前髪の房', icon: '⌒', root: [12, 55],
    make: (f, e) => [S(f, e, 0.97), S(f, e - 15, 1.12), S(f * 1.02, e - 35, 1.15), S(f * 1.05, Math.max(e - 58, -8), 1.1)],
    defaults: { width: 1.4 },
  },
  sidelock: {
    label: '触角（横髪）', icon: '⟆', root: [62, 30],
    make: (f, e) => {
      const a = S(f + 12, e - 45, 1.15);
      return [S(f, e, 0.98), S(f + 6, e - 22, 1.13), a, add(a, mul(D, 0.6), mul(F, 0.2)), add(mul(a, 0.95), mul(D, 1.25), mul(F, 0.35))];
    },
    defaults: { mirror: true, spring: true },
  },
  ahoge: {
    label: 'アホ毛', icon: '?', root: [0, 86],
    make: (f, e) => { const O = dirOf(f, e); return [mul(O, 0.98), add(mul(O, 1.08), mul(U, 0.25), mul(F, 0.03)), add(mul(O, 1.12), mul(U, 0.45), mul(F, 0.22)), add(mul(O, 1.1), mul(U, 0.35), mul(F, 0.45))]; },
    defaults: { width: 0.45, thickness: 0.4, taper: 0.9, spring: true, stiffness: 2 },
  },
  flip: {
    label: 'ハネ毛', icon: '⤴', root: [115, 10],
    make: (f, e) => {
      const a = S(f, e - 30, 1.15);
      return [S(f, e, 0.98), S(f, e - 15, 1.13), a, add(mul(a, 1.18), mul(D, 0.2)), add(mul(a, 1.42), mul(D, 0.12), mul(U, 0.05))];
    },
    defaults: { mirror: true },
  },
  curly: {
    label: 'くせ毛（カール）', icon: '➰', root: [150, 20],
    make: (f, e) => {
      const a = S(f, Math.min(e - 30, -10), 1.17);
      return [S(f, e, 0.97), S(f, e - 15, 1.13), a, add(mul(a, 1.02), mul(D, 0.6)), add(a, mul(D, 1.1))];
    },
    defaults: { curl: 0.8, width: 0.9, spring: true },
  },
  braid: {
    label: 'ねじり房', icon: '⧚', root: [200, 15],
    make: (f, e) => {
      const a = S(f, Math.min(e - 30, -10), 1.16);
      return [S(f, e, 0.97), S(f, e - 15, 1.13), a, add(mul(a, 1.02), mul(D, 0.7)), add(mul(a, 0.98), mul(D, 1.6))];
    },
    defaults: { twist: 9, width: 0.8, thickness: 2.2, taper: 0.5, spring: true },
  },
};

/** 正規化座標 → 経度・緯度（度） */
export function toAngles(q: P3): [number, number] {
  const n = norm(q);
  return [THREE.MathUtils.radToDeg(Math.atan2(n[0], n[2])), THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(n[1], -1, 1)))];
}

let idCounter = Date.now() % 100000;

export function makeStrand(key: string, root?: P3): HairStrand {
  const t = STRAND_TEMPLATES[key];
  const [phi, el] = root ? toAngles(root) : t.root;
  return {
    id: `st${++idCounter}`,
    name: t.label,
    points: t.make(phi, el).map((v) => v.map((x) => +x.toFixed(4)) as P3),
    width: 1,
    thickness: 1,
    taper: 0.85,
    twist: 0,
    curl: 0,
    length: 1,
    color: 'gradient',
    mirror: false,
    spring: false,
    stiffness: 1,
    ...t.defaults,
  };
}

/** 髪の房エディタ: 制御点ハンドルの表示・ドラッグ、クリックでの房の配置 */
export class HairEditor {
  active = false;
  selected = -1;
  /** クリック配置に使うテンプレート（null なら配置モードではない） */
  placing: string | null = null;
  template = 'long';
  private group = new THREE.Group();
  private handles: THREE.Mesh[] = [];
  private line: THREE.Line;
  private geo = new THREE.SphereGeometry(1, 12, 8);
  private mat = new THREE.MeshBasicMaterial({ color: 0xffd25f, depthTest: false, transparent: true, opacity: 0.95 });
  private matRoot = new THREE.MeshBasicMaterial({ color: 0xff5fa2, depthTest: false, transparent: true, opacity: 0.95 });
  private matSel = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  private down: { x: number; y: number } | null = null;

  constructor(private app: App) {
    this.group.name = '__hairHandles';
    this.group.userData.pickable = true;
    this.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd25f, depthTest: false, transparent: true, opacity: 0.7 }));
    this.line.renderOrder = 998;
    this.line.raycast = () => {};
    this.group.add(this.line);
    app.studio.helpers.add(this.group);
    app.studio.addUpdater(() => this.update());
    app.studio.on('transform', (o: THREE.Object3D) => o?.userData.strandHandle && this.dragHandle(o as THREE.Mesh));
    app.studio.on('transformEnd', (o: THREE.Object3D) => o?.userData.strandHandle && app.commitParams('房の制御点を移動'));
    const el = app.studio.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (this.active && this.placing && e.button === 0) {
        this.down = { x: e.clientX, y: e.clientY };
      }
    }, { capture: true });
    el.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || !this.placing || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
      this.placeAt(e);
    });
  }

  get strands(): HairStrand[] {
    return this.app.avatar.params.customStrands ?? [];
  }

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    const st = this.app.studio;
    if (on) {
      st.pickFilter = (o) => (o.userData.strandHandle ? o : null);
      st.setGizmoMode('translate');
      st.gizmo.setSpace('world');
    } else {
      this.placing = null;
      if (st.selected?.userData.strandHandle) st.select(null);
      st.pickFilter = null;
    }
    this.refresh();
  }

  select(i: number) {
    this.selected = i;
    if (this.app.studio.selected?.userData.strandHandle) this.app.studio.select(null);
    this.refresh();
  }

  /** 頭部ボーンのワールド行列と頭部フレーム */
  private frame() {
    const d = this.app.avatar.data;
    const head = d.bones.head;
    head.updateWorldMatrix(true, false);
    return { m: head.matrixWorld, f: d.headFrame };
  }

  toWorld(q: P3): THREE.Vector3 {
    const { m, f } = this.frame();
    return new THREE.Vector3(q[0] * f.radii.x, q[1] * f.radii.y, q[2] * f.radii.z).add(f.offset).applyMatrix4(m);
  }

  toHead(w: THREE.Vector3): P3 {
    const { m, f } = this.frame();
    const l = w.clone().applyMatrix4(m.clone().invert()).sub(f.offset);
    return [l.x / f.radii.x, l.y / f.radii.y, l.z / f.radii.z].map((x) => +x.toFixed(4)) as P3;
  }

  refresh() {
    const studio = this.app.studio;
    const selIndex: number | null = studio.selected?.userData.strandHandle ? studio.selected.userData.strandHandle.index : null;
    for (const h of this.handles) this.group.remove(h);
    this.handles = [];
    const st = this.strands[this.selected];
    this.line.visible = !!st && this.active;
    if (!st || !this.active) {
      if (selIndex !== null) studio.select(null);
      return;
    }
    const s = this.app.avatar.params.height / 1.6;
    st.points.forEach((_, i) => {
      const h = new THREE.Mesh(this.geo, i === 0 ? this.matRoot : this.mat);
      h.scale.setScalar((i === 0 ? 0.008 : 0.0065) * s);
      h.renderOrder = 999;
      h.userData.strandHandle = { index: i };
      h.userData.pickable = true;
      h.name = `制御点 ${i + 1}`;
      this.handles.push(h);
      this.group.add(h);
    });
    this.update(true);
    // 作り直したハンドルにギズモを付け替える（ドラッグ中の再生成・アンドゥ後など）
    if (selIndex !== null) studio.select(this.handles[selIndex] ?? null);
  }

  private update(force = false) {
    if (!this.active) return;
    const st = this.strands[this.selected];
    if (!st) return;
    if (this.handles.length !== st.points.length) return this.refresh();
    const pts = scaledPoints(st).map((q) => this.toWorld(q));
    const dragging = this.app.studio.gizmo.dragging;
    const sel = this.app.studio.selected;
    this.handles.forEach((h, i) => {
      if (!(dragging && sel === h) || force) h.position.copy(pts[i]);
      h.material = sel === h ? this.matSel : i === 0 ? this.matRoot : this.mat;
    });
    this.line.geometry.setFromPoints(pts);
  }

  private dragHandle(h: THREE.Mesh) {
    const st = this.strands[this.selected];
    if (!st) return;
    const i = h.userData.strandHandle.index as number;
    const q = this.toHead(h.position);
    if (i > 0 && st.length && st.length !== 1) {
      // 長さ倍率を考慮して元の制御点に戻す
      const r = st.points[0];
      for (let k = 0; k < 3; k++) q[k] = +(r[k] + (q[k] - r[k]) / st.length).toFixed(4);
    }
    st.points[i] = q;
    this.app.queueRebuild();
  }

  /** ビューポートのクリック位置（頭・髪の上）にテンプレートの房を置く */
  private placeAt(e: PointerEvent) {
    const st = this.app.studio;
    const r = st.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), st.camera);
    const meshes = this.app.avatar.data.meshes.filter((m) => m.name === 'Hair' || m.name === 'Body');
    meshes.forEach((m) => m.computeBoundingSphere());
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) {
      this.app.statusMsg.textContent = '頭や髪の上をクリックしてください';
      return;
    }
    const q = this.toHead(hit.point);
    if (Math.hypot(...q) > 1.6) {
      this.app.statusMsg.textContent = '頭から離れすぎています。頭や髪の上をクリックしてください';
      return;
    }
    this.addStrand(makeStrand(this.template, q));
  }

  addStrand(s: HairStrand) {
    const p = this.app.avatar.params;
    p.customStrands = [...(p.customStrands ?? []), s];
    this.selected = p.customStrands.length - 1;
    this.app.rebuildNow();
    this.app.commitParams(`房「${s.name}」を追加`);
    this.refresh();
    this.app.setTab('hair');
  }

  removeStrand(i: number) {
    const p = this.app.avatar.params;
    const name = p.customStrands[i]?.name;
    p.customStrands = p.customStrands.filter((_, k) => k !== i);
    this.selected = Math.min(this.selected, p.customStrands.length - 1);
    this.app.rebuildNow();
    this.app.commitParams(`房「${name}」を削除`);
    this.refresh();
    this.app.setTab('hair');
  }
}
