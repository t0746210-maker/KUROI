import * as THREE from 'three';
import type { App } from '../App';
import { button, h, section, select, slider } from '../dom';
import { LIGHT_PRESETS, type LightPreset } from '../../core/Studio';

export function buildScenePanel(app: App): HTMLElement {
  const st = app.studio;
  const tree = h('div', { class: 'outliner' });
  const sel = st.selected;
  const row = (o: THREE.Object3D, depth: number, label: string, icon: string) => {
    const eye = h('button', { class: 'eye', title: '表示切替', on: { click: (e: Event) => { e.stopPropagation(); o.visible = !o.visible; app.setTab('scene'); app.updateStats(); } } }, o.visible ? '👁' : '—');
    return h('div', {
      class: `node ${sel === o ? 'sel' : ''} ${o.visible ? '' : 'hidden'}`,
      style: `padding-left:${8 + depth * 14}px`,
      on: { click: () => { st.select(o); app.setTab('scene'); } },
    }, h('span', { class: 'ico' }, icon), h('span', { class: 'name' }, label), eye);
  };
  const walk = (o: THREE.Object3D, depth: number) => {
    for (const c of o.children) {
      if (c === app.avatar.holder) {
        const r = app.avatar.root;
        const node = row(app.avatar.holder, depth, `${r.name}（アバター）`, '👤');
        node.addEventListener('click', () => st.select(r));
        tree.append(node);
        for (const m of app.avatar.data.meshes) tree.append(row(m, depth + 1, m.name, '▣'));
        continue;
      }
      const icon = (c as THREE.Mesh).isMesh ? '▣' : (c as THREE.Light).isLight ? '💡' : (c as THREE.Bone).isBone ? '🦴' : '📁';
      tree.append(row(c, depth, c.name || c.type, icon));
      if (depth < 3 && c.children.length && c.children.length < 60) walk(c, depth + 1);
    }
  };
  walk(st.content, 0);
  if (!st.content.children.length) tree.append(h('p', { class: 'hint' }, 'シーンは空です'));

  const bgTop = h('input', { type: 'color', value: LIGHT_PRESETS[st.lightPreset].bg[0] });
  const bgBot = h('input', { type: 'color', value: LIGHT_PRESETS[st.lightPreset].bg[1] });
  const applyBg = () => st.setBackground(bgTop.value, bgBot.value);
  bgTop.addEventListener('input', applyBg);
  bgBot.addEventListener('input', applyBg);

  return h('div', null,
    section('アウトライナー', [tree]),
    section('ライティング', [
      select('プリセット', Object.entries(LIGHT_PRESETS).map(([k, v]) => [k, v.label]), st.lightPreset, (v) => {
        st.applyLightPreset(v as LightPreset);
        app.setTab('scene');
      }),
      slider({ label: 'キーライト', value: st.key.intensity, min: 0, max: 6, step: 0.05, onInput: (v) => (st.key.intensity = v) }),
      slider({ label: '環境光', value: st.hemi.intensity, min: 0, max: 4, step: 0.05, onInput: (v) => (st.hemi.intensity = v) }),
      slider({ label: 'リムライト', value: st.rim.intensity, min: 0, max: 6, step: 0.05, onInput: (v) => (st.rim.intensity = v) }),
      slider({ label: 'ライト方向', value: THREE.MathUtils.radToDeg(Math.atan2(st.key.position.x, st.key.position.z)), min: -180, max: 180, step: 1, onInput: (v) => {
        const r = Math.hypot(st.key.position.x, st.key.position.z);
        const a = THREE.MathUtils.degToRad(v);
        st.key.position.set(Math.sin(a) * r, st.key.position.y, Math.cos(a) * r);
      } }),
      slider({ label: '露出', value: st.renderer.toneMappingExposure, min: 0.2, max: 2.5, step: 0.01, onInput: (v) => (st.renderer.toneMappingExposure = v) }),
      h('div', { class: 'row color' }, h('label', null, '背景'), h('div', { class: 'swatch' }, bgTop, bgBot)),
    ]),
    section('カメラ', [
      slider({ label: '画角 (FOV)', value: st.camera.fov, min: 10, max: 90, step: 1, onInput: (v) => { st.camera.fov = v; st.camera.updateProjectionMatrix(); } }),
      h('div', { class: 'btn-grid' },
        button('全体を表示', () => st.frame(null), { icon: '⛶' }),
        button('選択を表示', () => st.frame(), { icon: '◎', title: 'F' }),
      ),
    ]),
  );
}
