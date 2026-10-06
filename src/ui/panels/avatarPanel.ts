import { presets, randomParams, sections, defaultParams, type AvatarParams } from '../../avatar/params';
import type { App } from '../App';
import { button, colorInput, h, section, select, slider, toggle } from '../dom';

export function buildAvatarPanel(app: App): HTMLElement {
  const p = app.avatar.params;
  const root = h('div', { class: 'avatar-panel' });

  root.append(
    h('div', { class: 'row' }, h('label', null, '名前'), h('input', {
      type: 'text', value: p.name, on: {
        input: (e: Event) => (p.name = (e.target as HTMLInputElement).value),
        change: () => { app.commitParams('名前を変更'); app.rebuildNow(); },
      },
    })),
    h('div', { class: 'row' }, h('label', null, '作者'), h('input', {
      type: 'text', value: p.author, on: {
        input: (e: Event) => (p.author = (e.target as HTMLInputElement).value),
        change: () => app.commitParams('作者を変更'),
      },
    })),
  );

  const presetBtns = h('div', { class: 'preset-grid' },
    ...Object.entries(presets).map(([name, pr]) =>
      button(name, () => app.setAvatarParams({ ...defaultParams, name: p.name, author: p.author, ...pr }, true, `プリセット「${name}」`), { cls: 'preset' }),
    ),
    button('ランダム', () => app.setAvatarParams(randomParams(p), true, 'ランダム生成'), { cls: 'preset accent', icon: '🎲' }),
  );
  root.append(section('プリセット', [presetBtns]));

  sections.forEach((sec, i) => {
    const body: HTMLElement[] = [];
    for (const s of sec.selects ?? []) {
      body.push(select(s.label, s.options, String(p[s.key]), (v) => {
        (p as any)[s.key] = v;
        app.rebuildNow();
        app.commitParams(`${s.label}を変更`);
      }));
    }
    for (const s of sec.sliders ?? []) {
      body.push(slider({
        label: s.label, value: p[s.key] as number, min: s.min, max: s.max, step: s.step ?? 0.01,
        onInput: (v) => app.previewParam(s.key, v as never),
        onChange: () => app.commitParams(`${s.label}を変更`),
      }));
    }
    for (const c of sec.colors ?? []) {
      body.push(colorInput(c.label, String(p[c.key]), (v) => app.previewParam(c.key, v as never), () => app.commitParams(`${c.label}の色を変更`)));
    }
    for (const t of sec.toggles ?? []) {
      body.push(toggle(t.label, !!p[t.key], (v) => {
        (p as any)[t.key] = v;
        app.rebuildNow();
        app.commitParams(`${t.label}を切り替え`);
      }));
    }
    root.append(section(sec.title, body, i < 2));
  });

  const st = app.avatar.stats();
  root.append(section('情報', [
    h('div', { class: 'info-grid' },
      h('span', null, '頂点'), h('b', null, st.verts.toLocaleString()),
      h('span', null, '三角形'), h('b', null, Math.round(st.tris).toLocaleString()),
      h('span', null, 'ボーン'), h('b', null, String(st.bones)),
      h('span', null, '表情モーフ'), h('b', null, String(st.morphs)),
      h('span', null, '揺れ物'), h('b', null, `${app.avatar.data.springs.length} チェーン`),
    ),
    h('p', { class: 'hint' }, 'すべてのスライダーはリアルタイムに反映されます。Ctrl+Z で元に戻せます。'),
  ], false));
  return root;
}

export type { AvatarParams };
