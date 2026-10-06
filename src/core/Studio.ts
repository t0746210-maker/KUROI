import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { History } from './History';

export type GizmoMode = 'translate' | 'rotate' | 'scale';

export const LIGHT_PRESETS = {
  studio: { label: 'スタジオ', bg: ['#2a2d3a', '#14151c'], hemi: ['#ffffff', '#445', 1.4], key: ['#ffffff', 2.4], rim: ['#9fb4ff', 1.2] },
  daylight: { label: '屋外', bg: ['#9fd3ff', '#e9f4ff'], hemi: ['#dff1ff', '#8a7a5a', 1.8], key: ['#fff4e0', 2.8], rim: ['#ffffff', 0.6] },
  sunset: { label: '夕暮れ', bg: ['#ff9a6b', '#3b2559'], hemi: ['#ffc4a0', '#3b2559', 1.3], key: ['#ffae70', 2.6], rim: ['#7f6bff', 1.6] },
  night: { label: '夜', bg: ['#0e1430', '#05060d'], hemi: ['#8090ff', '#101020', 0.8], key: ['#bcd0ff', 1.4], rim: ['#ff5fd2', 2.2] },
  neon: { label: 'ネオン', bg: ['#1a0730', '#04161f'], hemi: ['#ff7ce6', '#00e5ff', 1.2], key: ['#ffffff', 1.6], rim: ['#00f0ff', 2.8] },
  white: { label: 'ホワイト', bg: ['#ffffff', '#e6e8ef'], hemi: ['#ffffff', '#c8c8d0', 1.7], key: ['#ffffff', 2.0], rim: ['#ffffff', 0.8] },
} as const;
export type LightPreset = keyof typeof LIGHT_PRESETS;

/**
 * 3D ビューポート: レンダラー、カメラ、ライト、選択、ギズモ、履歴を管理する。
 */
export class Studio {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitControls;
  readonly gizmo: TransformControls;
  /** ユーザーのコンテンツ（エクスポート対象） */
  readonly content = new THREE.Group();
  readonly helpers = new THREE.Group();
  readonly history = new History();
  readonly timer = new THREE.Timer();
  readonly hemi: THREE.HemisphereLight;
  readonly key: THREE.DirectionalLight;
  readonly rim: THREE.DirectionalLight;
  readonly grid: THREE.GridHelper;
  readonly ground: THREE.Mesh;
  selected: THREE.Object3D | null = null;
  wireframe = false;
  autoRotate = false;
  lightPreset: LightPreset = 'studio';
  private bgTexture: THREE.CanvasTexture | null = null;
  private selectionBox: THREE.BoxHelper;
  private listeners: Record<string, ((...a: any[]) => void)[]> = {};
  private updaters: ((dt: number) => void)[] = [];
  private gizmoStart: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 } | null = null;
  /** クリック選択の対象をフィルタ（ポーズ編集時など） */
  pickFilter: ((o: THREE.Object3D) => THREE.Object3D | null) | null = null;
  frames = 0;

  constructor(readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 200);
    this.camera.position.set(0.9, 1.25, 3.1);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.hemi = new THREE.HemisphereLight('#ffffff', '#444455', 1.4);
    this.key = new THREE.DirectionalLight('#ffffff', 2.4);
    this.key.position.set(2.2, 4, 3);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.left = -2.5;
    this.key.shadow.camera.right = 2.5;
    this.key.shadow.camera.top = 3;
    this.key.shadow.camera.bottom = -1;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.rim = new THREE.DirectionalLight('#9fb4ff', 1.2);
    this.rim.position.set(-3, 2.5, -3);
    this.scene.add(this.hemi, this.key, this.rim);

    this.grid = new THREE.GridHelper(20, 40, 0x6b6f86, 0x34374a);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.5;
    this.grid.userData.noOutline = true;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.25 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.userData.noOutline = true;
    this.helpers.add(this.grid, this.ground);
    this.helpers.name = '__helpers';
    this.content.name = 'Scene';
    this.scene.add(this.content, this.helpers);

    this.selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffb02e);
    this.selectionBox.visible = false;
    this.helpers.add(this.selectionBox);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.85, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.screenSpacePanning = true;
    this.orbit.minDistance = 0.1;
    this.orbit.maxDistance = 50;

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(0.85);
    const gizmoHelper = this.gizmo.getHelper();
    gizmoHelper.userData.noOutline = true;
    this.helpers.add(gizmoHelper);
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      const o = this.gizmo.object;
      if (!o) return;
      if (e.value) {
        this.gizmoStart = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
      } else if (this.gizmoStart) {
        const before = this.gizmoStart;
        const after = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
        this.gizmoStart = null;
        const apply = (t: typeof before) => {
          o.position.copy(t.p);
          o.quaternion.copy(t.q);
          o.scale.copy(t.s);
          o.updateMatrixWorld(true);
          this.emit('transform', o);
        };
        this.history.push({ label: `${o.name || 'オブジェクト'} を変形`, undo: () => apply(before), redo: () => apply(after) });
        this.emit('transformEnd', o);
      }
    });
    this.gizmo.addEventListener('objectChange', () => this.emit('transform', this.gizmo.object));

    this.setupPicking();
    this.applyLightPreset('studio');
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  on(ev: string, fn: (...a: any[]) => void) {
    (this.listeners[ev] ??= []).push(fn);
  }
  emit(ev: string, ...a: any[]) {
    for (const fn of this.listeners[ev] ?? []) fn(...a);
  }
  addUpdater(fn: (dt: number) => void) {
    this.updaters.push(fn);
  }

  private setupPicking() {
    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4 || this.gizmo.dragging) return;
      const hit = this.pick(e.clientX, e.clientY);
      if (hit === undefined) return;
      this.select(hit);
    });
  }

  /** スクリーン座標からオブジェクトを選択（ギズモ上なら undefined） */
  pick(cx: number, cy: number): THREE.Object3D | null | undefined {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    if (this.gizmo.object && (this.gizmo as any).axis) return undefined;
    const pickables: THREE.Object3D[] = [this.content, ...this.helpers.children.filter((c) => c.userData.pickable)];
    const hits = ray.intersectObjects(pickables, true).filter((h) => h.object.visible && !(h.object as any).isLine);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      if (this.pickFilter) {
        const f = this.pickFilter(o);
        if (f) return f;
        continue;
      }
      // アバターはルート単位で選択
      while (o && o.parent && o.parent !== this.content) {
        if (o.userData.kuroiAvatar) break;
        o = o.parent;
      }
      if (o?.parent?.userData.isAvatarHolder) return o;
      if (o) return o;
    }
    return null;
  }

  select(o: THREE.Object3D | null) {
    this.selected = o;
    if (o && !o.userData.locked) this.gizmo.attach(o);
    else this.gizmo.detach();
    this.selectionBox.visible = !!o && !o.userData.isBone;
    if (o) this.selectionBox.setFromObject(o);
    this.emit('select', o);
  }

  setGizmoMode(m: GizmoMode) {
    this.gizmo.setMode(m);
    this.emit('gizmoMode', m);
  }

  setWireframe(on: boolean) {
    this.wireframe = on;
    this.content.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) if ('wireframe' in mat) (mat as THREE.MeshBasicMaterial).wireframe = on;
    });
  }

  applyLightPreset(name: LightPreset) {
    this.lightPreset = name;
    const p = LIGHT_PRESETS[name];
    this.hemi.color.set(p.hemi[0]);
    this.hemi.groundColor.set(p.hemi[1]);
    this.hemi.intensity = p.hemi[2];
    this.key.color.set(p.key[0]);
    this.key.intensity = p.key[1];
    this.rim.color.set(p.rim[0]);
    this.rim.intensity = p.rim[1];
    this.setBackground(p.bg[0], p.bg[1]);
    const light = name === 'white' || name === 'daylight';
    (this.grid.material as THREE.LineBasicMaterial).color.set(light ? 0x9aa0b4 : 0x50546a);
  }

  setBackground(top: string, bottom: string) {
    const cv = document.createElement('canvas');
    cv.width = 4;
    cv.height = 256;
    const g = cv.getContext('2d')!;
    const lg = g.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, top);
    lg.addColorStop(1, bottom);
    g.fillStyle = lg;
    g.fillRect(0, 0, 4, 256);
    this.bgTexture?.dispose();
    this.bgTexture = new THREE.CanvasTexture(cv);
    this.bgTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.bgTexture;
  }

  /** 選択オブジェクト（なければ全体）にカメラを合わせる */
  frame(o: THREE.Object3D | null = this.selected) {
    const box = new THREE.Box3().setFromObject(o ?? this.content);
    if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1.6, 0.5));
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.5;
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, Math.max(dist, 0.3));
  }

  setView(view: 'front' | 'back' | 'left' | 'right' | 'top' | 'face') {
    const t = this.orbit.target;
    const d = this.camera.position.distanceTo(t);
    const dirs = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      left: [1, 0, 0],
      right: [-1, 0, 0],
      top: [0, 1, 0.0001],
    } as const;
    if (view === 'face') {
      const head = this.content.getObjectByName('head');
      if (head) {
        const p = new THREE.Vector3().setFromMatrixPosition(head.matrixWorld);
        t.set(p.x, p.y + 0.1, p.z);
        this.camera.position.set(p.x, p.y + 0.11, p.z + 0.75);
      }
      return;
    }
    const v = dirs[view];
    this.camera.position.set(t.x + v[0] * d, t.y + v[1] * d, t.z + v[2] * d);
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    for (const u of this.updaters) u(dt);
    if (this.autoRotate) {
      const t = this.orbit.target;
      const off = this.camera.position.clone().sub(t).applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.5);
      this.camera.position.copy(t).add(off);
    }
    this.orbit.update();
    if (this.selected && this.selectionBox.visible) this.selectionBox.setFromObject(this.selected);
    this.render();
    this.frames++;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** 高解像度スクリーンショット（背景透過も可） */
  screenshot(scale = 2, transparent = false): string {
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    const bg = this.scene.background;
    const helpersVis = this.helpers.visible;
    this.helpers.visible = false;
    if (transparent) this.scene.background = null;
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(size.x, size.y, false);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(size.x, size.y, false);
    this.scene.background = bg;
    this.helpers.visible = helpersVis;
    return url;
  }
}
