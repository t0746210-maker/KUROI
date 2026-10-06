import * as THREE from 'three';
import { PRIMITIVES } from '../../modeling/primitives';
import type { App } from '../App';
import { button, h, section } from '../dom';

export function buildModelPanel(app: App): HTMLElement {
  const grid = h('div', { class: 'prim-grid' },
    ...Object.entries(PRIMITIVES).map(([k, d]) =>
      h('button', { class: 'prim', title: `${d.label}を追加`, on: { click: () => app.addPrimitive(k) } }, h('span', { class: 'ico' }, d.icon), h('span', null, d.label)),
    ),
  );
  const need = () => {
    const o = app.studio.selected;
    return !!o && o !== app.avatar.root && !o.userData.isBone;
  };
  const guard = (fn: () => void) => () => {
    if (!need()) {
      app.statusMsg.textContent = '先にオブジェクトを選択してください（アバター以外）';
      return;
    }
    fn();
  };
  const ops = h('div', { class: 'btn-grid' },
    button('複製', guard(() => app.duplicateSelected()), { icon: '⧉', title: 'Ctrl+D' }),
    button('ミラー複製', guard(() => app.duplicateSelected(true)), { icon: '⇋' }),
    button('配列 ×5 (X)', guard(() => app.arrayDuplicate(5, new THREE.Vector3(0.3, 0, 0))), { icon: '⋯' }),
    button('円形配列 ×8', guard(() => circularArray(app, 8)), { icon: '✺' }),
    button('床に置く', () => app.dropToFloor(), { icon: '⤓' }),
    button('削除', guard(() => app.deleteSelected()), { icon: '🗑', title: 'Delete', cls: 'danger' }),
  );
  return h('div', null,
    section('プリミティブを追加', [grid]),
    section('編集', [ops, h('p', { class: 'hint' }, 'オブジェクトをクリックで選択、ギズモで移動 (W) / 回転 (E) / 拡大 (R)。右パネルで形状パラメータやマテリアルを調整できます。')]),
    section('読み込み', [
      h('p', { class: 'hint' }, 'GLB / glTF / VRM / FBX / OBJ / STL / PLY / DAE / 3MF / USDZ / three.js JSON / 画像（下絵）をビューポートへドラッグ＆ドロップ、または「開く」から読み込めます。'),
    ]),
  );
}

function circularArray(app: App, n: number) {
  const o = app.studio.selected!;
  const group = new THREE.Group();
  group.name = `${o.name}_円形配列`;
  const r = Math.max(0.4, Math.hypot(o.position.x, o.position.z));
  for (let i = 0; i < n; i++) {
    const c = o.clone(true);
    const a = (i / n) * Math.PI * 2;
    c.position.set(Math.cos(a) * r, o.position.y, Math.sin(a) * r);
    c.rotation.y = -a;
    group.add(c);
  }
  app.addObject(group, '円形配列');
}
