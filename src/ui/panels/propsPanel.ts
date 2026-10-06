import * as THREE from 'three';
import type { App } from '../App';
import { PRIMITIVES, rebuildPrimitive } from '../../modeling/primitives';
import { toonGradient } from '../../avatar/materials';
import { button, colorInput, h, section, select, slider, toggle } from '../dom';

let liveUpdate: (() => void) | null = null;
let hooked = false;

const deg = THREE.MathUtils.radToDeg;
const rad = THREE.MathUtils.degToRad;

export function buildPropsPanel(app: App): HTMLElement {
  const st = app.studio;
  if (!hooked) {
    hooked = true;
    st.on('transform', () => liveUpdate?.());
  }
  liveUpdate = null;
  const o = st.selected;
  if (!o) {
    return h('div', { class: 'props empty' },
      h('h3', null, 'プロパティ'),
      h('p', { class: 'hint' }, 'ビューポートでオブジェクトをクリックすると、ここに詳細が表示されます。'),
      h('div', { class: 'quick' },
        h('h4', null, 'クイックスタート'),
        h('ol', null,
          h('li', null, '「アバター」タブで体型・顔・髪・衣装を調整'),
          h('li', null, '「ポーズ/動き」でポーズ・表情・アニメーション'),
          h('li', null, '「モデリング」で小物やステージを追加'),
          h('li', null, '右上の「エクスポート」から 18 形式で書き出し'),
        ),
      ),
    );
  }
  if (o.userData.isBone) return boneProps(app, o as THREE.Bone);

  const isAvatar = o === app.avatar.root;
  const parts: HTMLElement[] = [];
  parts.push(h('h3', null, isAvatar ? '👤 アバター' : (o as THREE.Mesh).isMesh ? '▣ メッシュ' : '📁 グループ'));
  const nameInput = h('input', { type: 'text', value: o.name });
  nameInput.addEventListener('change', () => {
    const before = o.name;
    const after = nameInput.value;
    if (isAvatar) {
      app.avatar.params.name = after;
      app.commitParams('名前を変更');
    }
    st.history.exec({ label: '名前を変更', redo: () => (o.name = after), undo: () => (o.name = before) });
    app.sceneChanged();
  });
  parts.push(h('div', { class: 'row' }, h('label', null, '名前'), nameInput));

  // ------------------------------------------------ トランスフォーム
  const vecRow = (label: string, get: () => THREE.Vector3 | THREE.Euler, isRot: boolean, step: number) => {
    const inputs = [0, 1, 2].map(() => h('input', { type: 'number', step: String(step), class: 'num' }));
    const keys = ['x', 'y', 'z'] as const;
    const refresh = () => {
      const v = get();
      inputs.forEach((inp, i) => {
        if (document.activeElement !== inp) inp.value = (isRot ? deg((v as any)[keys[i]]) : (v as any)[keys[i]]).toFixed(isRot ? 1 : 2);
      });
    };
    inputs.forEach((inp, i) => {
      inp.addEventListener('change', () => {
        const v = get();
        const before = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
        (v as any)[keys[i]] = isRot ? rad(+inp.value) : +inp.value;
        const after = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
        const apply = (t: typeof before) => {
          o.position.copy(t.p);
          o.quaternion.copy(t.q);
          o.scale.copy(t.s);
          liveUpdate?.();
        };
        st.history.push({ label: `${label}を変更`, undo: () => apply(before), redo: () => apply(after) });
      });
    });
    refresh();
    return { el: h('div', { class: 'row vec' }, h('label', null, label), h('div', { class: 'xyz' }, ...inputs.map((inp, i) => h('span', { class: `axis a${i}` }, 'XYZ'[i], inp)))), refresh };
  };
  const pos = vecRow('位置', () => o.position, false, 0.01);
  const rot = vecRow('回転°', () => o.rotation, true, 1);
  const scl = vecRow('スケール', () => o.scale, false, 0.01);
  liveUpdate = () => {
    pos.refresh();
    rot.refresh();
    scl.refresh();
  };
  parts.push(section('トランスフォーム', [
    pos.el, rot.el, scl.el,
    h('div', { class: 'btn-grid' },
      button('リセット', () => {
        const before = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() };
        const apply = (t: typeof before) => {
          o.position.copy(t.p);
          o.quaternion.copy(t.q);
          o.scale.copy(t.s);
          liveUpdate?.();
        };
        st.history.exec({ label: 'トランスフォームをリセット', redo: () => apply({ p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1) }), undo: () => apply(before) });
      }, { icon: '↺' }),
      button('床に置く', () => app.dropToFloor(), { icon: '⤓' }),
      button('フォーカス', () => st.frame(o), { icon: '◎' }),
    ),
  ]));

  if (isAvatar) {
    const s = app.avatar.stats();
    parts.push(section('アバター', [
      h('div', { class: 'info-grid' },
        h('span', null, '身長'), h('b', null, `${app.avatar.params.height.toFixed(2)} m`),
        h('span', null, '頂点'), h('b', null, s.verts.toLocaleString()),
        h('span', null, 'ボーン'), h('b', null, String(s.bones)),
        h('span', null, 'ポーズ'), h('b', null, app.avatar.currentClip ? `▶ ${app.avatar.currentClip}` : app.avatar.poseName),
      ),
      h('div', { class: 'btn-grid' },
        button('体型を編集', () => app.setTab('avatar'), { icon: '👤' }),
        button('ポーズ', () => app.setTab('pose'), { icon: '🎬' }),
        button('VRM 書き出し', () => app.openExport(), { icon: '⬇', cls: 'primary' }),
      ),
    ]));
    return h('div', { class: 'props' }, ...parts);
  }

  // ------------------------------------------------ 表示
  parts.push(section('表示', [
    toggle('表示', o.visible, (v) => { o.visible = v; app.updateStats(); }),
    toggle('影を落とす', o.castShadow, (v) => o.traverse((c) => (c.castShadow = v))),
    toggle('影を受ける', o.receiveShadow, (v) => o.traverse((c) => (c.receiveShadow = v))),
  ], false));

  // ------------------------------------------------ プリミティブ
  const mesh = o as THREE.Mesh;
  if (mesh.isMesh && o.userData.primitive) {
    const pr = o.userData.primitive;
    const def = PRIMITIVES[pr.type];
    let before: Record<string, number> = { ...pr.params };
    const rows = def.defs.map((d) => slider({
      label: d.label, value: pr.params[d.key], min: d.min, max: d.max, step: d.step,
      onInput: (v) => {
        pr.params[d.key] = d.int ? Math.round(v) : v;
        rebuildPrimitive(mesh);
        if (st.wireframe) st.setWireframe(true);
      },
      onChange: () => {
        const b = before;
        const a = { ...pr.params };
        before = a;
        st.history.push({
          label: `${def.label}の形状を変更`,
          undo: () => { pr.params = { ...b }; o.userData.primitive.params = pr.params; rebuildPrimitive(mesh); app.renderProps(); },
          redo: () => { pr.params = { ...a }; o.userData.primitive.params = pr.params; rebuildPrimitive(mesh); app.renderProps(); },
        });
        app.updateStats();
      },
    }));
    parts.push(section(`形状: ${def.label}`, rows));
  }

  // ------------------------------------------------ マテリアル
  const mats: { mesh: THREE.Mesh; index: number }[] = [];
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh || c.userData.outlineHull) return;
    const n = Array.isArray(m.material) ? m.material.length : 1;
    for (let i = 0; i < n && mats.length < 8; i++) mats.push({ mesh: m, index: i });
  });
  const inAvatar = isInAvatar(app, o);
  if (inAvatar) {
    parts.push(section('マテリアル', [h('p', { class: 'hint' }, 'アバターの色・質感は「アバター」タブのカラー設定で編集できます。')]));
  } else if (mats.length) {
    parts.push(section(`マテリアル (${mats.length})`, mats.map((m) => materialEditor(app, m.mesh, m.index))));
  }

  // ------------------------------------------------ 統計
  let verts = 0;
  let tris = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    verts += m.geometry.attributes.position.count;
    tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  });
  parts.push(section('ジオメトリ', [
    h('div', { class: 'info-grid' }, h('span', null, '頂点'), h('b', null, verts.toLocaleString()), h('span', null, '三角形'), h('b', null, Math.round(tris).toLocaleString())),
    mesh.isMesh ? h('div', { class: 'btn-grid' },
      button('スムーズ', () => { mesh.geometry.computeVertexNormals(); setFlat(mesh, false); }, { icon: '◍' }),
      button('フラット', () => setFlat(mesh, true), { icon: '◆' }),
      button('原点を中心へ', () => { mesh.geometry.center(); app.renderProps(); }, { icon: '⊕' }),
    ) : null,
  ], false));

  return h('div', { class: 'props' }, ...parts);
}

function isInAvatar(app: App, o: THREE.Object3D) {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (p === app.avatar.holder) return true;
    p = p.parent;
  }
  return false;
}

function setFlat(mesh: THREE.Mesh, flat: boolean) {
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    if ('flatShading' in m) {
      (m as THREE.MeshStandardMaterial).flatShading = flat;
      m.needsUpdate = true;
    }
  }
}

type MatKind = 'toon' | 'standard' | 'physical' | 'basic';
const kindOf = (m: THREE.Material): MatKind =>
  (m as any).isMeshToonMaterial ? 'toon' : (m as any).isMeshPhysicalMaterial ? 'physical' : (m as any).isMeshStandardMaterial ? 'standard' : 'basic';

function convertMaterial(m: THREE.Material, kind: MatKind): THREE.Material {
  const a = m as any;
  const common = { name: m.name, color: a.color?.clone() ?? new THREE.Color(1, 1, 1), map: a.map ?? null, transparent: m.transparent, opacity: m.opacity, side: m.side, wireframe: !!a.wireframe };
  let n: THREE.Material;
  if (kind === 'toon') n = new THREE.MeshToonMaterial({ ...common, gradientMap: toonGradient(), emissive: a.emissive?.clone() });
  else if (kind === 'basic') n = new THREE.MeshBasicMaterial(common);
  else {
    const P = kind === 'physical' ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    n = new P({ ...common, roughness: a.roughness ?? 0.5, metalness: a.metalness ?? 0, emissive: a.emissive?.clone() ?? new THREE.Color(0, 0, 0), emissiveIntensity: a.emissiveIntensity ?? 1 });
  }
  n.userData = { ...m.userData };
  return n;
}

function getMat(mesh: THREE.Mesh, i: number): THREE.Material {
  return Array.isArray(mesh.material) ? mesh.material[i] : mesh.material;
}
function setMat(mesh: THREE.Mesh, i: number, m: THREE.Material) {
  if (Array.isArray(mesh.material)) mesh.material[i] = m;
  else mesh.material = m;
}

function materialEditor(app: App, mesh: THREE.Mesh, index: number): HTMLElement {
  const st = app.studio;
  const m = getMat(mesh, index) as any;
  const rec = (label: string, _key: string, before: any, after: any, apply: (v: any) => void) =>
    st.history.push({ label: `${label}を変更`, undo: () => { apply(before); app.renderProps(); }, redo: () => { apply(after); app.renderProps(); } });
  const numProp = (label: string, key: string, min: number, max: number, step = 0.01) =>
    key in m && typeof m[key] === 'number'
      ? slider({ label, value: m[key], min, max, step, onInput: (v) => { m[key] = v; m.needsUpdate = key === 'opacity'; }, onChange: (v, b) => rec(label, key, b, v, (x) => (m[key] = x)) })
      : null;
  const colProp = (label: string, key: string) =>
    m[key]?.isColor
      ? colorInput(label, '#' + m[key].getHexString(), (v) => m[key].set(v), (v, b) => rec(label, key, b, v, (x) => m[key].set(x)))
      : null;

  const texInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  texInput.addEventListener('change', async () => {
    const f = texInput.files?.[0];
    if (!f) return;
    const tex = await new THREE.TextureLoader().loadAsync(URL.createObjectURL(f));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.name = f.name.replace(/\.[^.]+$/, '');
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const before = m.map;
    const apply = (t: THREE.Texture | null) => { m.map = t; m.needsUpdate = true; };
    apply(tex);
    rec('テクスチャ', 'map', before, tex, apply);
    app.renderProps();
  });

  const kind = kindOf(m);
  const body = [
    select('種類', [['toon', 'トゥーン'], ['standard', 'PBR スタンダード'], ['physical', 'PBR フィジカル'], ['basic', 'アンリット']], kind, (v, b) => {
      const old = getMat(mesh, index);
      const nm = convertMaterial(old, v as MatKind);
      setMat(mesh, index, nm);
      st.history.push({ label: 'マテリアル種類を変更', undo: () => { setMat(mesh, index, old); app.renderProps(); }, redo: () => { setMat(mesh, index, nm); app.renderProps(); } });
      void b;
      app.renderProps();
    }),
    colProp('ベースカラー', 'color'),
    numProp('ラフネス', 'roughness', 0, 1),
    numProp('メタリック', 'metalness', 0, 1),
    colProp('発光色', 'emissive'),
    numProp('発光強度', 'emissiveIntensity', 0, 10, 0.05),
    kind === 'physical' ? numProp('クリアコート', 'clearcoat', 0, 1) : null,
    kind === 'physical' ? numProp('透過 (ガラス)', 'transmission', 0, 1) : null,
    kind === 'physical' ? numProp('屈折率 IOR', 'ior', 1, 2.33) : null,
    kind === 'physical' ? numProp('虹彩 (玉虫色)', 'iridescence', 0, 1) : null,
    kind === 'physical' ? numProp('シーン (布)', 'sheen', 0, 1) : null,
    slider({ label: '不透明度', value: m.opacity, min: 0, max: 1, step: 0.01, onInput: (v) => { m.opacity = v; const t = v < 1; if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; } }, onChange: (v, b) => rec('不透明度', 'opacity', b, v, (x) => { m.opacity = x; m.transparent = x < 1; m.needsUpdate = true; }) }),
    toggle('両面表示', m.side === THREE.DoubleSide, (v) => { m.side = v ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; }),
    'flatShading' in m ? toggle('フラットシェード', !!m.flatShading, (v) => { m.flatShading = v; m.needsUpdate = true; }) : null,
    h('div', { class: 'btn-grid' },
      button(m.map ? 'テクスチャ変更' : 'テクスチャ追加', () => texInput.click(), { icon: '🖼' }),
      m.map ? button('テクスチャ削除', () => { const b = m.map; m.map = null; m.needsUpdate = true; rec('テクスチャ', 'map', b, null, (t) => { m.map = t; m.needsUpdate = true; }); app.renderProps(); }, { icon: '✕' }) : null,
      texInput,
    ),
  ].filter(Boolean) as HTMLElement[];
  const title = h('div', { class: 'mat-title' }, h('span', { class: 'dot', style: `background:#${m.color?.getHexString?.() ?? 'fff'}` }), `${mesh.name} / ${m.name || 'マテリアル'}`);
  return h('div', { class: 'mat-editor' }, title, ...body);
}

function boneProps(app: App, b: THREE.Bone): HTMLElement {
  const st = app.studio;
  const e = new THREE.Euler().setFromQuaternion(b.quaternion, 'XYZ');
  let before = b.quaternion.clone();
  const mk = (axis: 'x' | 'y' | 'z', label: string) => slider({
    label, value: deg(e[axis]), min: -180, max: 180, step: 1,
    onInput: (v) => {
      e[axis] = rad(v);
      b.quaternion.setFromEuler(e);
    },
    onChange: () => {
      const bq = before.clone();
      const aq = b.quaternion.clone();
      before = aq.clone();
      app.avatar.capturePose();
      st.history.push({ label: `${b.name} を回転`, undo: () => { b.quaternion.copy(bq); app.avatar.capturePose(); app.renderProps(); }, redo: () => { b.quaternion.copy(aq); app.avatar.capturePose(); app.renderProps(); } });
    },
  });
  return h('div', { class: 'props' },
    h('h3', null, `🦴 ${b.name}`),
    section('ボーン回転', [mk('x', 'X 軸 (前後)'), mk('y', 'Y 軸 (ひねり)'), mk('z', 'Z 軸 (左右)'),
      button('このボーンをリセット', () => {
        const bq = b.quaternion.clone();
        b.quaternion.identity();
        app.avatar.capturePose();
        st.history.push({ label: `${b.name} をリセット`, undo: () => { b.quaternion.copy(bq); app.avatar.capturePose(); }, redo: () => { b.quaternion.identity(); app.avatar.capturePose(); } });
        app.renderProps();
      }, { icon: '↺' }),
    ]),
    h('p', { class: 'hint' }, 'ギズモの円をドラッグしても回転できます。左右対称のボーンは個別に調整してください。'),
  );
}
