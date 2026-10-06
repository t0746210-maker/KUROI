import * as THREE from 'three';
import { Studio, LIGHT_PRESETS, type LightPreset } from '../core/Studio';
import { Avatar, disposeObject } from '../avatar/Avatar';
import { defaultParams, type AvatarParams } from '../avatar/params';
import { createPrimitive } from '../modeling/primitives';
import { importFile, IMPORT_EXTS } from '../io/importers';
import { autosave, deserializeObjects, isProject, loadAutosave, PROJECT_EXT, type ProjectFile } from '../io/project';
import { download, FORMATS, type ExportContext, type ExportFormat, type ExportOptions } from '../io/formats';
import { defaultMeta } from '../io/vrm';
import { button, clear, fmtBytes, h, toast } from './dom';
import { buildAvatarPanel } from './panels/avatarPanel';
import { buildModelPanel } from './panels/modelPanel';
import { buildPosePanel } from './panels/posePanel';
import { buildScenePanel } from './panels/scenePanel';
import { buildPropsPanel } from './panels/propsPanel';
import { openExportDialog } from './panels/exportDialog';
import { PoseEditor } from './PoseEditor';

type Tab = 'avatar' | 'model' | 'pose' | 'scene';

export class App {
  studio: Studio;
  avatar: Avatar;
  committedParams: AvatarParams;
  tab: Tab = 'avatar';
  left!: HTMLElement;
  right!: HTMLElement;
  statusMsg!: HTMLElement;
  statusStats!: HTMLElement;
  poseEditor: PoseEditor;
  mixers = new Map<THREE.Object3D, THREE.AnimationMixer>();
  exportOptions: ExportOptions;
  private rebuildQueued = false;
  private tabButtons: Record<string, HTMLElement> = {};
  private gizmoButtons: Record<string, HTMLElement> = {};
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private autosaveTimer = 0;

  constructor(root: HTMLElement) {
    root.classList.add('app');
    const top = h('header', { class: 'topbar' });
    this.left = h('aside', { class: 'panel left' });
    const viewport = h('main', { class: 'viewport' });
    this.right = h('aside', { class: 'panel right' });
    const status = h('footer', { class: 'statusbar' });
    root.append(top, this.left, viewport, this.right, status);

    this.studio = new Studio(viewport);
    const saved = loadAutosave();
    this.avatar = new Avatar(saved?.avatar?.params ?? {});
    this.committedParams = { ...this.avatar.params };
    this.studio.content.add(this.avatar.holder);
    this.studio.addUpdater((dt) => {
      this.avatar.update(dt);
      for (const m of this.mixers.values()) m.update(dt);
    });
    this.poseEditor = new PoseEditor(this);
    this.exportOptions = {
      tpose: false,
      includeAnimations: true,
      printReady: true,
      transparentBg: false,
      vrmMeta: defaultMeta(this.avatar.params),
    };

    this.buildTopbar(top);
    this.buildViewportOverlay(viewport);
    this.buildStatus(status);
    this.setTab('avatar');
    this.renderProps();

    this.studio.on('select', () => this.renderProps());
    this.studio.on('transformEnd', (o: THREE.Object3D) => {
      if (o.userData.isBone) this.avatar.capturePose();
      this.scheduleAutosave();
    });
    this.studio.history.onChange = () => this.updateUndoButtons();
    this.updateUndoButtons();
    this.setupKeys();
    this.setupDrop(root);
    if (saved) this.restoreProject(saved, true);
    this.studio.frame(this.avatar.root);
    this.studio.camera.position.set(0.6, 1.2, 3.4);
    this.studio.orbit.target.set(0, this.avatar.params.height * 0.55, 0);
    this.updateStats();
    setInterval(() => this.updateStats(), 1000);
    window.addEventListener('beforeunload', () => this.saveAutosaveNow());
  }

  // ------------------------------------------------------------------ アバター編集
  /** パラメータの一時変更（ドラッグ中のプレビュー） */
  previewParam<K extends keyof AvatarParams>(key: K, value: AvatarParams[K]) {
    this.avatar.params[key] = value;
    this.queueRebuild();
  }

  /** パラメータ確定（履歴に登録） */
  commitParams(label: string) {
    const before = { ...this.committedParams };
    const after = { ...this.avatar.params };
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.committedParams = { ...after };
    this.studio.history.push({
      label,
      undo: () => this.setAvatarParams(before, false),
      redo: () => this.setAvatarParams(after, false),
    });
    this.scheduleAutosave();
  }

  setAvatarParams(p: AvatarParams, record = true, label = 'アバター変更') {
    Object.assign(this.avatar.params, p);
    this.rebuildNow();
    if (record) this.commitParams(label);
    else this.committedParams = { ...this.avatar.params };
    if (this.tab === 'avatar') this.setTab('avatar');
  }

  queueRebuild() {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    requestAnimationFrame(() => {
      this.rebuildQueued = false;
      this.rebuildNow();
    });
  }

  rebuildNow() {
    const wasSelected = this.studio.selected === this.avatar.root;
    const t0 = performance.now();
    this.avatar.rebuild();
    if (this.studio.wireframe) this.studio.setWireframe(true);
    if (wasSelected) this.studio.select(this.avatar.root);
    this.poseEditor.refresh();
    this.statusMsg.textContent = `アバター再生成 ${(performance.now() - t0).toFixed(0)} ms`;
    this.exportOptions.vrmMeta.name = this.avatar.params.name;
    this.exportOptions.vrmMeta.author = this.avatar.params.author;
    this.updateStats();
  }

  // ------------------------------------------------------------------ シーン操作
  addObject(o: THREE.Object3D, label = `${o.name} を追加`, select = true) {
    const parent = this.studio.content;
    this.studio.history.exec({
      label,
      redo: () => {
        parent.add(o);
        if (select) this.studio.select(o);
        this.sceneChanged();
      },
      undo: () => {
        parent.remove(o);
        if (this.studio.selected === o) this.studio.select(null);
        this.sceneChanged();
      },
    });
  }

  addPrimitive(type: string) {
    const m = createPrimitive(type, this.avatar.params.toon);
    // アバターと重ならないよう横に配置
    const n = this.studio.content.children.length;
    m.position.x = 0.7 + (n % 4) * 0.25;
    m.position.z = -0.2 + Math.floor(n / 4) * 0.3;
    if (this.studio.wireframe) this.studio.setWireframe(true);
    this.addObject(m);
  }

  deleteSelected() {
    const o = this.studio.selected;
    if (!o || o.userData.isBone) return;
    if (o === this.avatar.root) {
      this.setAvatarVisible(!this.avatar.holder.visible);
      return;
    }
    const parent = o.parent!;
    const idx = parent.children.indexOf(o);
    this.studio.history.exec({
      label: `${o.name} を削除`,
      redo: () => {
        parent.remove(o);
        this.studio.select(null);
        this.sceneChanged();
      },
      undo: () => {
        parent.children.splice(idx, 0, o);
        o.parent = parent;
        this.studio.select(o);
        this.sceneChanged();
      },
    });
  }

  duplicateSelected(mirror = false) {
    const o = this.studio.selected;
    if (!o || o === this.avatar.root || o.userData.isBone) return;
    const c = o.clone(true);
    c.traverse((x) => {
      const m = x as THREE.Mesh;
      if (m.isMesh) {
        m.geometry = m.geometry.clone();
        m.material = Array.isArray(m.material) ? m.material.map((mm) => mm.clone()) : m.material.clone();
      }
    });
    c.userData = JSON.parse(JSON.stringify(o.userData));
    c.name = o.name + (mirror ? '_ミラー' : '_コピー');
    if (mirror) {
      c.position.x = -o.position.x || -0.5;
      c.scale.x *= -1;
    } else c.position.x += 0.3;
    this.addObject(c, mirror ? 'ミラー複製' : '複製');
  }

  arrayDuplicate(count: number, offset: THREE.Vector3) {
    const o = this.studio.selected;
    if (!o || o === this.avatar.root || o.userData.isBone) return;
    const group = new THREE.Group();
    group.name = `${o.name}_配列`;
    for (let i = 1; i <= count; i++) {
      const c = o.clone(true);
      c.position.addScaledVector(offset, i);
      group.add(c);
    }
    this.addObject(group, '配列複製');
  }

  dropToFloor() {
    const o = this.studio.selected;
    if (!o) return;
    const box = new THREE.Box3().setFromObject(o);
    const before = o.position.clone();
    const after = before.clone();
    after.y -= box.min.y;
    this.studio.history.exec({
      label: '床に置く',
      redo: () => o.position.copy(after),
      undo: () => o.position.copy(before),
    });
    this.renderProps();
  }

  setAvatarVisible(v: boolean) {
    this.avatar.holder.visible = v;
    this.sceneChanged();
  }

  sceneChanged() {
    if (this.tab === 'scene') this.setTab('scene');
    this.updateStats();
    this.scheduleAutosave();
  }

  // ------------------------------------------------------------------ UI
  setTab(t: Tab) {
    this.tab = t;
    for (const [k, b] of Object.entries(this.tabButtons)) b.classList.toggle('active', k === t);
    const body = this.left.querySelector('.tab-body') as HTMLElement;
    const scroll = body?.scrollTop ?? 0;
    const content = t === 'avatar' ? buildAvatarPanel(this) : t === 'model' ? buildModelPanel(this) : t === 'pose' ? buildPosePanel(this) : buildScenePanel(this);
    clear(this.left).append(
      h(
        'nav',
        { class: 'tabs' },
        ...(['avatar', 'model', 'pose', 'scene'] as Tab[]).map((k) => {
          const labels: Record<Tab, [string, string]> = { avatar: ['👤', 'アバター'], model: ['🧊', 'モデリング'], pose: ['🎬', 'ポーズ/動き'], scene: ['🗂', 'シーン'] };
          const b = h('button', { class: `tab ${k === t ? 'active' : ''}`, on: { click: () => this.setTab(k) } }, h('span', { class: 'ico' }, labels[k][0]), h('span', null, labels[k][1]));
          this.tabButtons[k] = b;
          return b;
        }),
      ),
      h('div', { class: 'tab-body' }, content),
    );
    const nb = this.left.querySelector('.tab-body') as HTMLElement;
    if (nb) nb.scrollTop = scroll;
    this.poseEditor.setActive(t === 'pose' && this.poseEditor.wanted);
  }

  renderProps() {
    clear(this.right).append(buildPropsPanel(this));
  }

  private buildTopbar(top: HTMLElement) {
    const fileInput = h('input', { type: 'file', multiple: true, accept: [...IMPORT_EXTS, PROJECT_EXT].map((e) => '.' + e).join(','), style: 'display:none' });
    fileInput.addEventListener('change', () => {
      for (const f of Array.from(fileInput.files ?? [])) this.importAny(f);
      fileInput.value = '';
    });
    this.undoBtn = button('', () => this.undo(), { icon: '↶', title: '元に戻す (Ctrl+Z)', cls: 'ghost' }) as HTMLButtonElement;
    this.redoBtn = button('', () => this.redo(), { icon: '↷', title: 'やり直す (Ctrl+Shift+Z)', cls: 'ghost' }) as HTMLButtonElement;
    const gizmo = (mode: 'translate' | 'rotate' | 'scale', icon: string, title: string) => {
      const b = button('', () => this.studio.setGizmoMode(mode), { icon, title, cls: `ghost ${mode === 'translate' ? 'active' : ''}` });
      this.gizmoButtons[mode] = b;
      return b;
    };
    this.studio.on('gizmoMode', (m: string) => {
      for (const [k, b] of Object.entries(this.gizmoButtons)) b.classList.toggle('active', k === m);
    });
    const lightSel = h(
      'select',
      { class: 'light-select', title: 'ライティング', on: { change: (e: Event) => this.studio.applyLightPreset((e.target as HTMLSelectElement).value as LightPreset) } },
      ...Object.entries(LIGHT_PRESETS).map(([k, v]) => h('option', { value: k }, `💡 ${v.label}`)),
    );
    top.append(
      h('div', { class: 'brand' }, h('span', { class: 'logo' }, 'K'), h('b', null, 'KUROI'), h('span', null, 'Studio')),
      h(
        'div',
        { class: 'tools' },
        button('新規', () => this.newProject(), { icon: '✦', title: '新規プロジェクト', cls: 'ghost' }),
        button('開く', () => fileInput.click(), { icon: '📂', title: 'プロジェクト / 3D モデル / 画像 / BVH を開く', cls: 'ghost' }),
        button('保存', () => this.saveProject(), { icon: '💾', title: 'プロジェクトを保存 (Ctrl+S)', cls: 'ghost' }),
        h('span', { class: 'sep' }),
        this.undoBtn,
        this.redoBtn,
        h('span', { class: 'sep' }),
        gizmo('translate', '✥', '移動 (W)'),
        gizmo('rotate', '⟳', '回転 (E)'),
        gizmo('scale', '⤢', '拡大縮小 (R)'),
        h('span', { class: 'sep' }),
        lightSel,
        fileInput,
      ),
      h(
        'div',
        { class: 'tools right' },
        button('', () => this.showHelp(), { icon: '?', title: 'ショートカット / ヘルプ', cls: 'ghost' }),
        button('エクスポート', () => this.openExport(), { icon: '⬇', title: '多形式エクスポート (Ctrl+E)', cls: 'primary' }),
      ),
    );
  }

  private buildViewportOverlay(vp: HTMLElement) {
    const viewBtn = (label: string, v: Parameters<Studio['setView']>[0]) => button(label, () => this.studio.setView(v), { cls: 'chip' });
    const tg = (label: string, init: boolean, fn: (v: boolean) => void, title: string) => {
      const b = h('button', { class: `chip ${init ? 'on' : ''}`, title }, label);
      let state = init;
      b.addEventListener('click', () => {
        state = !state;
        b.classList.toggle('on', state);
        fn(state);
      });
      return b;
    };
    vp.append(
      h(
        'div',
        { class: 'vp-overlay top' },
        viewBtn('正面', 'front'),
        viewBtn('背面', 'back'),
        viewBtn('左', 'left'),
        viewBtn('右', 'right'),
        viewBtn('上', 'top'),
        viewBtn('顔', 'face'),
        button('全体', () => this.studio.frame(null), { cls: 'chip' }),
      ),
      h(
        'div',
        { class: 'vp-overlay bottom' },
        tg('グリッド', true, (v) => (this.studio.grid.visible = v), 'グリッド表示'),
        tg('ワイヤー', false, (v) => this.studio.setWireframe(v), 'ワイヤーフレーム'),
        tg('影', true, (v) => (this.studio.ground.visible = v), '接地影'),
        tg('自動回転', false, (v) => (this.studio.autoRotate = v), 'カメラ自動回転'),
        button('📷', () => this.quickScreenshot(), { cls: 'chip', title: 'スクリーンショット' }),
      ),
    );
  }

  private buildStatus(status: HTMLElement) {
    this.statusMsg = h('span', { class: 'msg' }, 'ようこそ KUROI Studio へ — アバターを作って、あらゆる形式で書き出そう');
    this.statusStats = h('span', { class: 'stats' });
    status.append(this.statusMsg, this.statusStats);
  }

  updateStats() {
    let verts = 0;
    let tris = 0;
    let objs = 0;
    this.studio.content.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || o.userData.outlineHull) return;
      objs++;
      const g = m.geometry;
      verts += g.attributes.position?.count ?? 0;
      tris += (g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3;
    });
    const fps = this.studio.frames;
    this.studio.frames = 0;
    if (this.statusStats) this.statusStats.textContent = `メッシュ ${objs} ・ 頂点 ${verts.toLocaleString()} ・ 三角形 ${Math.round(tris).toLocaleString()} ・ ボーン ${this.avatar.data.skeleton.bones.length} ・ ${fps} fps`;
  }

  updateUndoButtons() {
    if (!this.undoBtn) return;
    this.undoBtn.disabled = !this.studio.history.canUndo;
    this.redoBtn.disabled = !this.studio.history.canRedo;
    this.undoBtn.title = `元に戻す: ${this.studio.history.nextUndoLabel ?? '-'} (Ctrl+Z)`;
    this.redoBtn.title = `やり直す: ${this.studio.history.nextRedoLabel ?? '-'} (Ctrl+Shift+Z)`;
  }

  undo() {
    const c = this.studio.history.undo();
    if (c) this.statusMsg.textContent = `元に戻す: ${c.label}`;
    this.renderProps();
  }
  redo() {
    const c = this.studio.history.redo();
    if (c) this.statusMsg.textContent = `やり直し: ${c.label}`;
    this.renderProps();
  }

  private setupKeys() {
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') && (t as HTMLInputElement).type !== 'range') return;
      if (document.querySelector('.overlay')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        this.redo();
      } else if (mod && k === 's') {
        e.preventDefault();
        this.saveProject();
      } else if (mod && k === 'e') {
        e.preventDefault();
        this.openExport();
      } else if (mod && k === 'd') {
        e.preventDefault();
        this.duplicateSelected();
      } else if (mod) return;
      else if (k === 'w') this.studio.setGizmoMode('translate');
      else if (k === 'e') this.studio.setGizmoMode('rotate');
      else if (k === 'r') this.studio.setGizmoMode('scale');
      else if (k === 'f') this.studio.frame();
      else if (k === 'delete' || k === 'backspace') this.deleteSelected();
      else if (k === 'escape') this.studio.select(null);
      else if (k === '1') this.studio.setView('front');
      else if (k === '3') this.studio.setView('right');
      else if (k === '7') this.studio.setView('top');
      else if (k === '9') this.studio.setView('back');
      else if (k === 'g') this.studio.grid.visible = !this.studio.grid.visible;
    });
  }

  private setupDrop(root: HTMLElement) {
    const hint = h('div', { class: 'drop-hint' }, h('div', null, h('b', null, 'ここにドロップして読み込み'), h('small', null, IMPORT_EXTS.map((e) => '.' + e).join(' ') + ' .kuroi')));
    root.appendChild(hint);
    let depth = 0;
    root.addEventListener('dragenter', (e) => {
      e.preventDefault();
      depth++;
      hint.classList.add('show');
    });
    root.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) hint.classList.remove('show');
    });
    root.addEventListener('dragover', (e) => e.preventDefault());
    root.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      hint.classList.remove('show');
      for (const f of Array.from(e.dataTransfer?.files ?? [])) this.importAny(f);
    });
  }

  // ------------------------------------------------------------------ 入出力
  async importAny(file: File) {
    const ext = file.name.split('.').pop()!.toLowerCase();
    try {
      if (ext === PROJECT_EXT || file.name.endsWith('.kuroi.json')) {
        const json = JSON.parse(await file.text());
        if (!isProject(json)) throw new Error('KUROI プロジェクトではありません');
        await this.restoreProject(json);
        toast(`プロジェクト「${file.name}」を開きました`, 'ok');
        return;
      }
      if (ext === 'json') {
        const json = JSON.parse(await file.text());
        if (isProject(json)) {
          await this.restoreProject(json);
          toast(`プロジェクト「${file.name}」を開きました`, 'ok');
          return;
        }
      }
      this.statusMsg.textContent = `${file.name} を読み込み中…`;
      const r = await importFile(file);
      if (r.motionOnly) {
        const clip = r.animations[0];
        const names = new Set(Object.keys(this.avatar.data.bones));
        clip.tracks = clip.tracks.filter((t) => names.has(t.name.split('.')[0]));
        if (!clip.tracks.length) throw new Error('アバターのボーン名と一致するトラックがありません');
        this.avatar.clips.push(clip);
        this.avatar.play(clip.name);
        if (this.tab === 'pose') this.setTab('pose');
        toast(`モーション「${clip.name}」を読み込み、再生しました（${clip.tracks.length} トラック）`, 'ok');
        return;
      }
      if (r.object) {
        if (this.studio.wireframe) this.studio.setWireframe(true);
        this.addObject(r.object, `${file.name} を読み込み`);
        if (r.animations.length) {
          const mixer = new THREE.AnimationMixer(r.object);
          mixer.clipAction(r.animations[0]).play();
          this.mixers.set(r.object, mixer);
          r.object.userData.clipNames = r.animations.map((a) => a.name);
          (r.object as any).animations = r.animations;
        }
        this.studio.frame(r.object);
        toast(`${file.name} を読み込みました${r.note ? '（' + r.note + '）' : ''}`, 'ok', 4500);
      }
      this.statusMsg.textContent = `${file.name} を読み込みました`;
    } catch (err: any) {
      console.error(err);
      toast(`読み込み失敗: ${err?.message ?? err}`, 'err', 6000);
    }
  }

  buildProject(): ProjectFile {
    const objects = this.studio.content.children.filter((o) => o !== this.avatar.holder).map((o) => o.toJSON());
    const r = this.avatar.root;
    return {
      app: 'KUROI Studio',
      version: 1,
      savedAt: new Date().toISOString(),
      avatar: {
        params: { ...this.avatar.params },
        pose: this.avatar.pose,
        poseName: this.avatar.poseName,
        expressions: { ...this.avatar.expressions },
        clip: this.avatar.currentClip,
        visible: this.avatar.holder.visible,
        transform: { p: r.position.toArray(), q: r.quaternion.toArray(), s: r.scale.toArray() },
      },
      objects,
      scene: {
        lightPreset: this.studio.lightPreset,
        camera: this.studio.camera.position.toArray(),
        target: this.studio.orbit.target.toArray(),
      },
    };
  }

  async restoreProject(p: ProjectFile, silent = false) {
    for (const o of [...this.studio.content.children]) {
      if (o === this.avatar.holder) continue;
      this.studio.content.remove(o);
      disposeObject(o);
    }
    this.mixers.clear();
    this.studio.select(null);
    if (p.avatar) {
      this.avatar.params = { ...defaultParams, ...p.avatar.params };
      this.avatar.pose = p.avatar.pose;
      this.avatar.poseName = p.avatar.poseName;
      Object.assign(this.avatar.expressions, p.avatar.expressions);
      this.avatar.currentClip = p.avatar.clip;
      this.avatar.rebuild();
      const t = p.avatar.transform;
      this.avatar.root.position.fromArray(t.p);
      this.avatar.root.quaternion.fromArray(t.q);
      this.avatar.root.scale.fromArray(t.s);
      this.avatar.holder.visible = p.avatar.visible;
      this.committedParams = { ...this.avatar.params };
    }
    for (const o of await deserializeObjects(p.objects)) this.studio.content.add(o);
    if (p.scene) {
      if (p.scene.lightPreset in LIGHT_PRESETS) {
        this.studio.applyLightPreset(p.scene.lightPreset as LightPreset);
        const sel = document.querySelector('.light-select') as HTMLSelectElement | null;
        if (sel) sel.value = p.scene.lightPreset;
      }
      if (!silent) {
        this.studio.camera.position.fromArray(p.scene.camera);
        this.studio.orbit.target.fromArray(p.scene.target);
      }
    }
    this.studio.history.clear();
    this.exportOptions.vrmMeta = defaultMeta(this.avatar.params);
    this.setTab(this.tab);
    this.renderProps();
    this.updateStats();
  }

  saveProject() {
    const p = this.buildProject();
    const name = (this.avatar.params.name || 'project').replace(/[\\/:*?"<>|]/g, '_');
    const size = download({ data: JSON.stringify(p), filename: `${name}.${PROJECT_EXT}`, mime: 'application/json' });
    toast(`プロジェクトを保存しました (${fmtBytes(size)})`, 'ok');
    this.saveAutosaveNow();
  }

  newProject() {
    if (!confirm('新規プロジェクトを作成します。保存していない変更は失われます。よろしいですか？')) return;
    const p = this.buildProject();
    p.objects = [];
    p.avatar!.params = { ...defaultParams };
    p.avatar!.pose = {};
    p.avatar!.poseName = '自然体';
    p.avatar!.clip = null;
    p.avatar!.visible = true;
    p.avatar!.transform = { p: [0, 0, 0], q: [0, 0, 0, 1], s: [1, 1, 1] };
    for (const k of Object.keys(p.avatar!.expressions)) p.avatar!.expressions[k] = 0;
    this.restoreProject(p).then(() => {
      this.avatar.applyPose(this.avatar.pose, '自然体');
      toast('新規プロジェクト', 'ok');
    });
  }

  scheduleAutosave() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => this.saveAutosaveNow(), 1500);
  }

  saveAutosaveNow() {
    const p = this.buildProject();
    // 大きすぎるオブジェクト（テクスチャ付き読み込みモデル等）は自動保存しない
    const json = JSON.stringify(p.objects);
    if (json.length > 2_000_000) p.objects = [];
    autosave(p);
  }

  exportContext(): ExportContext {
    const safe = (this.avatar.params.name || 'kuroi_model').replace(/[\\/:*?"<>|\s]/g, '_');
    return {
      content: this.studio.content,
      avatar: this.avatar.holder.visible ? this.avatar : null,
      name: safe,
      options: this.exportOptions,
      thumbnail: () => this.makeThumbnail(),
      screenshot: (tr) => this.studio.screenshot(2, tr),
      recordTurntable: (s) => this.recordTurntable(s),
    };
  }

  async runExport(f: ExportFormat) {
    const ctx = this.exportContext();
    if (f.needsAvatar && !ctx.avatar) {
      toast('この形式はアバターが必要です（アバターが非表示になっています）', 'err');
      return;
    }
    const t0 = performance.now();
    this.statusMsg.textContent = `${f.label} を書き出し中…`;
    try {
      const res = await f.run(ctx);
      const size = download(res);
      const msg = `${f.label} を書き出しました: ${res.filename} (${fmtBytes(size)}, ${((performance.now() - t0) / 1000).toFixed(1)} 秒)`;
      this.statusMsg.textContent = msg;
      toast(msg, 'ok', 4500);
    } catch (err: any) {
      console.error(err);
      toast(`書き出し失敗 (${f.label}): ${err?.message ?? err}`, 'err', 7000);
    }
  }

  openExport() {
    openExportDialog(this, FORMATS);
  }

  async makeThumbnail(): Promise<Uint8Array | null> {
    const st = this.studio;
    const camPos = st.camera.position.clone();
    const target = st.orbit.target.clone();
    const aspect = st.camera.aspect;
    st.setView('face');
    st.camera.position.z += 0.25;
    st.camera.position.y -= 0.02;
    st.orbit.update();
    const url = st.screenshot(1, false);
    st.camera.position.copy(camPos);
    st.orbit.target.copy(target);
    st.camera.aspect = aspect;
    st.camera.updateProjectionMatrix();
    const img = new Image();
    img.src = url;
    await img.decode();
    const size = 512;
    const cv = h('canvas', { width: size, height: size }) as HTMLCanvasElement;
    const g = cv.getContext('2d')!;
    const s = Math.min(img.width, img.height);
    g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    const blob: Blob | null = await new Promise((r) => cv.toBlob(r, 'image/png'));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  }

  recordTurntable(seconds: number): Promise<Blob> {
    const canvas = this.studio.renderer.domElement;
    if (!('captureStream' in canvas) || typeof MediaRecorder === 'undefined') return Promise.reject(new Error('このブラウザは動画録画に対応していません'));
    const stream = canvas.captureStream(30);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const st = this.studio;
    const start = st.camera.position.clone();
    const t = st.orbit.target.clone();
    const gridVis = st.grid.visible;
    st.grid.visible = false;
    st.select(null);
    let elapsed = 0;
    return new Promise((resolve) => {
      const upd = (dt: number) => {
        if (elapsed < 0) return;
        elapsed += dt;
        const a = (elapsed / seconds) * Math.PI * 2;
        const off = start.clone().sub(t).applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
        st.camera.position.copy(t).add(off);
        if (elapsed >= seconds) {
          elapsed = -1;
          rec.stop();
        }
      };
      rec.onstop = () => {
        st.camera.position.copy(start);
        st.grid.visible = gridVis;
        resolve(new Blob(chunks, { type: 'video/webm' }));
      };
      st.addUpdater(upd);
      rec.start(100);
      toast(`ターンテーブル録画中… (${seconds} 秒)`, 'info', seconds * 1000);
    });
  }

  quickScreenshot() {
    const url = this.studio.screenshot(2, false);
    const a = h('a', { href: url, download: `${this.avatar.params.name || 'kuroi'}.png` });
    a.click();
    toast('スクリーンショットを保存しました', 'ok');
  }

  showHelp() {
    import('./panels/help').then((m) => m.openHelp());
  }
}
