import * as THREE from 'three';
import type { App } from '../ui/App';
import { PaintLayer } from './PaintLayer';

export type PaintTool = 'brush' | 'eraser' | 'picker';

export interface BrushSettings {
  tool: PaintTool;
  color: string;
  /** ブラシの直径（cm, ワールド空間） */
  size: number;
  opacity: number;
  hardness: number;
  mirror: boolean;
}

interface Hit {
  mesh: THREE.Mesh;
  layer: PaintLayer;
  px: number;
  py: number;
  /** この位置での 1m あたりのテクスチャ px 数（ブラシをワールド空間サイズにするため） */
  pxPerM: number;
  point: THREE.Vector3;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _ua = new THREE.Vector2(), _ub = new THREE.Vector2(), _uc = new THREE.Vector2();

/** ヒットした三角形のワールド面積と UV 面積の比から、テクセル密度を求める */
function texelDensity(mesh: THREE.Mesh, face: THREE.Face, size: number): number {
  mesh.getVertexPosition(face.a, _a).applyMatrix4(mesh.matrixWorld);
  mesh.getVertexPosition(face.b, _b).applyMatrix4(mesh.matrixWorld);
  mesh.getVertexPosition(face.c, _c).applyMatrix4(mesh.matrixWorld);
  const worldArea = _b.sub(_a).cross(_c.sub(_a)).length() / 2;
  const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute;
  _ua.fromBufferAttribute(uv, face.a);
  _ub.fromBufferAttribute(uv, face.b).sub(_ua);
  _uc.fromBufferAttribute(uv, face.c).sub(_ua);
  const uvArea = (Math.abs(_ub.x * _uc.y - _ub.y * _uc.x) / 2) * size * size;
  if (worldArea < 1e-12 || uvArea < 1e-9) return size * 2;
  return Math.sqrt(uvArea / worldArea);
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** ビューポート上でメッシュに直接描くテクスチャペイント */
export class Painter {
  active = false;
  settings: BrushSettings = { tool: 'brush', color: '#ff5fa2', size: 1.5, opacity: 0.9, hardness: 0.6, mirror: true };
  /** 最後に塗った（ポイントした）レイヤー名 */
  lastLayer: PaintLayer | null = null;
  onChange: () => void = () => {};
  private userLayers = new WeakMap<THREE.Material, PaintLayer>();
  private stroke: { before: Map<PaintLayer, HTMLCanvasElement>; dirty: Map<PaintLayer, Rect>; last: (Hit | null)[]; meshes: THREE.Mesh[] } | null = null;
  private cursor: HTMLDivElement;
  private ray = new THREE.Raycaster();
  private cursorDist: number | null = null;
  private cursorThrottle = 0;

  constructor(private app: App) {
    const el = app.studio.renderer.domElement;
    this.cursor = document.createElement('div');
    this.cursor.className = 'brush-cursor';
    el.parentElement!.appendChild(this.cursor);
    el.addEventListener('pointerdown', (e) => this.down(e), { capture: true });
    el.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', () => this.up());
    el.addEventListener('pointerleave', () => (this.cursor.style.display = 'none'));
  }

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.cursor.style.display = 'none';
    if (on) this.app.studio.select(null);
    this.app.studio.renderer.domElement.style.cursor = on ? 'crosshair' : '';
  }

  /** ペイント可能なメッシュ */
  private targets(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    const av = this.app.avatar;
    if (av.holder.visible) for (const t of av.paintTargets()) if (!out.includes(t.mesh)) out.push(t.mesh);
    for (const c of this.app.studio.content.children) {
      if (c === av.holder) continue;
      c.traverseVisible((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.geometry.attributes.uv && !o.userData.outlineHull) out.push(m);
      });
    }
    return out;
  }

  private layerFor(mesh: THREE.Mesh, materialIndex: number): PaintLayer | null {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mat = mats[materialIndex] ?? mats[0];
    if (!mat) return null;
    const av = this.app.avatar;
    if (av.data.meshes.includes(mesh as THREE.SkinnedMesh)) return av.layer(mat.name);
    let l = this.userLayers.get(mat);
    if (!l) {
      const baker = av.baker;
      if (!baker) return null;
      l = new PaintLayer(mat.name || mesh.name);
      l.setBase(baker.bake(mesh, mats.indexOf(mat)));
      const m = mat as THREE.MeshStandardMaterial;
      if (m.color) m.color.set(0xffffff);
      m.vertexColors = false;
      m.map = l.texture;
      m.needsUpdate = true;
      this.userLayers.set(mat, l);
    }
    return l;
  }

  private ndc(e: PointerEvent) {
    const r = this.app.studio.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  /** レイを投げてペイント位置を求める。mirror=true なら X 軸対称のレイ */
  private pick(e: PointerEvent, mirror: boolean, onlyMeshes?: THREE.Mesh[]): Hit | null {
    this.ray.setFromCamera(this.ndc(e), this.app.studio.camera);
    const meshes = onlyMeshes ?? this.targets();
    if (mirror) {
      // アバター（または最初の対象）のローカル空間で X を反転
      const ref = this.app.avatar.holder.visible ? this.app.avatar.root : meshes[0];
      if (!ref) return null;
      const inv = ref.matrixWorld.clone().invert();
      const o = this.ray.ray.origin.clone().applyMatrix4(inv);
      const d = this.ray.ray.direction.clone().transformDirection(inv);
      o.x = -o.x;
      d.x = -d.x;
      this.ray.ray.origin.copy(o.applyMatrix4(ref.matrixWorld));
      this.ray.ray.direction.copy(d.transformDirection(ref.matrixWorld)).normalize();
    }
    const hits = this.ray.intersectObjects(meshes, false);
    for (const h of hits) {
      if (!h.uv || !h.face) continue;
      const mesh = h.object as THREE.Mesh;
      const layer = this.layerFor(mesh, h.face.materialIndex ?? 0);
      if (!layer) return null;
      return { mesh, layer, px: h.uv.x * layer.size, py: (1 - h.uv.y) * layer.size, pxPerM: texelDensity(mesh, h.face, layer.size), point: h.point.clone() };
    }
    return null;
  }

  private down(e: PointerEvent) {
    if (!this.active || e.button !== 0) return;
    for (const m of this.targets()) m.geometry.computeBoundingSphere?.();
    for (const m of this.app.avatar.data.meshes) m.computeBoundingSphere();
    const hit = this.pick(e, false);
    if (!hit) return; // 空振りなら通常のカメラ操作
    e.stopImmediatePropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    this.lastLayer = hit.layer;
    if (this.settings.tool === 'picker') {
      this.settings.color = hit.layer.sample(hit.px, hit.py);
      this.settings.tool = 'brush';
      this.onChange();
      return;
    }
    this.stroke = { before: new Map(), dirty: new Map(), last: [null, null], meshes: [hit.mesh] };
    this.paintAt(e, hit, 0);
    if (this.settings.mirror) {
      const mh = this.pick(e, true);
      if (mh) {
        this.paintAt(e, mh, 1);
        if (!this.stroke.meshes.includes(mh.mesh)) this.stroke.meshes.push(mh.mesh);
      }
    }
    this.onChange();
  }

  private move(e: PointerEvent) {
    if (!this.active) return;
    this.updateCursor(e);
    if (!this.stroke) return;
    // ストローク中は開始時に当たったメッシュだけを判定（スキンメッシュのレイキャストは重いため）
    const hit = this.pick(e, false, this.stroke.meshes);
    if (hit) this.paintAt(e, hit, 0);
    if (this.settings.mirror) {
      const mh = this.pick(e, true, this.stroke.meshes);
      if (mh) this.paintAt(e, mh, 1);
    }
  }

  private updateCursor(e: PointerEvent) {
    const st = this.app.studio;
    const r = st.renderer.domElement.getBoundingClientRect();
    // ブラシ径（ワールド）を画面上のピクセルに換算。モデル上にいなければ注視点の距離で概算
    this.ray.setFromCamera(this.ndc(e), st.camera);
    const meshes = this.stroke?.meshes ?? this.targets();
    const hit = this.cursorThrottle++ % 3 === 0 ? this.ray.intersectObjects(meshes, false)[0] : null;
    if (hit) this.cursorDist = hit.distance;
    const dist = this.cursorDist ?? st.camera.position.distanceTo(st.orbit.target);
    const worldPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(st.camera.fov / 2))) / r.height;
    const s = Math.max(4, this.settings.size / 100 / worldPerPx);
    Object.assign(this.cursor.style, {
      display: 'block',
      left: `${e.clientX - r.left - s / 2}px`,
      top: `${e.clientY - r.top - s / 2}px`,
      width: `${s}px`,
      height: `${s}px`,
      borderColor: this.settings.tool === 'eraser' ? '#ffffff' : this.settings.color,
    });
  }

  private paintAt(_e: PointerEvent, hit: Hit, side: number) {
    const st = this.stroke!;
    const layer = hit.layer;
    if (!st.before.has(layer)) {
      const copy = document.createElement('canvas');
      copy.width = copy.height = layer.size;
      copy.getContext('2d')!.drawImage(layer.strokes, 0, 0);
      st.before.set(layer, copy);
    }
    const last = st.last[side];
    const r = Math.max(0.75, Math.min(layer.size / 4, (this.settings.size / 100 / 2) * hit.pxPerM));
    const pts: [number, number][] = [];
    // 同じレイヤー上で近ければ間を補間（UV の継ぎ目をまたいだ大きな跳びは補間しない）
    if (last && last.layer === layer && Math.hypot(hit.px - last.px, hit.py - last.py) < layer.size * 0.08) {
      const d = Math.hypot(hit.px - last.px, hit.py - last.py);
      const step = Math.max(1, r * 0.3);
      const n = Math.max(1, Math.ceil(d / step));
      for (let i = 1; i <= n; i++) pts.push([last.px + ((hit.px - last.px) * i) / n, last.py + ((hit.py - last.py) * i) / n]);
    } else pts.push([hit.px, hit.py]);
    for (const [x, y] of pts) this.dab(layer, x, y, r);
    st.last[side] = hit;
    const rect = st.dirty.get(layer) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const [x, y] of pts) {
      rect.x0 = Math.min(rect.x0, x - r - 1);
      rect.y0 = Math.min(rect.y0, y - r - 1);
      rect.x1 = Math.max(rect.x1, x + r + 1);
      rect.y1 = Math.max(rect.y1, y + r + 1);
    }
    st.dirty.set(layer, rect);
  }

  private dab(layer: PaintLayer, x: number, y: number, r: number) {
    const c = layer.sctx;
    const s = this.settings;
    c.save();
    c.globalAlpha = s.opacity;
    c.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
    const hex = /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#ffffff';
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');
    const g = c.createRadialGradient(x, y, r * Math.min(0.99, s.hardness), x, y, r);
    g.addColorStop(0, hex);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = s.hardness >= 0.99 ? hex : g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.restore();
    layer.recomposite(x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2);
  }

  private up() {
    const st = this.stroke;
    if (!st) return;
    this.stroke = null;
    const entries: { layer: PaintLayer; x: number; y: number; before: ImageData; after: ImageData }[] = [];
    for (const [layer, rect] of st.dirty) {
      const x = Math.max(0, Math.floor(rect.x0));
      const y = Math.max(0, Math.floor(rect.y0));
      const w = Math.min(layer.size, Math.ceil(rect.x1)) - x;
      const h = Math.min(layer.size, Math.ceil(rect.y1)) - y;
      if (w <= 0 || h <= 0) continue;
      const before = st.before.get(layer)!.getContext('2d')!.getImageData(x, y, w, h);
      const after = layer.sctx.getImageData(x, y, w, h);
      entries.push({ layer, x, y, before, after });
    }
    if (!entries.length) return;
    const put = (which: 'before' | 'after') => {
      for (const en of entries) {
        en.layer.sctx.putImageData(en[which], en.x, en.y);
        en.layer.recomposite(en.x, en.y, en[which].width, en[which].height);
      }
    };
    this.app.studio.history.push({
      label: this.settings.tool === 'eraser' ? 'ペイントを消去' : 'ペイント',
      undo: () => put('before'),
      redo: () => put('after'),
    });
    this.app.scheduleAutosave();
  }

  /** レイヤー全体に対する操作（塗りつぶし・クリア・画像貼り付け）を履歴付きで実行 */
  layerOp(layer: PaintLayer, label: string, op: (ctx: CanvasRenderingContext2D) => void | Promise<void>) {
    const before = layer.sctx.getImageData(0, 0, layer.size, layer.size);
    const finish = () => {
      layer.recomposite();
      const after = layer.sctx.getImageData(0, 0, layer.size, layer.size);
      this.app.studio.history.push({
        label,
        undo: () => {
          layer.sctx.putImageData(before, 0, 0);
          layer.recomposite();
        },
        redo: () => {
          layer.sctx.putImageData(after, 0, 0);
          layer.recomposite();
        },
      });
      this.app.scheduleAutosave();
      this.onChange();
    };
    const r = op(layer.sctx);
    if (r instanceof Promise) r.then(finish);
    else finish();
  }
}
