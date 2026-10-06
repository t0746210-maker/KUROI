import type { App } from '../App';
import type { PaintLayer } from '../../paint/PaintLayer';
import type { PaintTool } from '../../paint/Painter';
import { button, h, section, slider, toggle } from '../dom';

const MAT_LABELS: Record<string, string> = {
  Skin: '肌', Hair: '髪', HairAccessory: '髪飾り', EarInner: '耳の内側',
  OutfitMain: '衣装メイン', OutfitSub: '衣装サブ', OutfitAccent: '衣装アクセント', Shoes: '靴', Inner: 'インナー',
};

const SWATCHES = ['#1b1b24', '#ffffff', '#ff5fa2', '#e5384f', '#ff8a3d', '#ffd25f', '#7cf29c', '#2fa36b', '#5fc8ff', '#3b6cff', '#8b5cff', '#c9a27a', '#7a4b2a', '#ffb0c8', '#9aa0b4', '#000000'];

export function buildPaintPanel(app: App): HTMLElement {
  const p = app.painter;
  const s = p.settings;
  const tools: [PaintTool, string, string][] = [
    ['brush', '🖌', 'ブラシ'],
    ['eraser', '🩹', '消しゴム'],
    ['picker', '💧', 'スポイト'],
  ];
  const toolRow = h('div', { class: 'preset-grid' },
    ...tools.map(([t, icon, label]) => button(label, () => { s.tool = t; app.setTab('paint'); }, { icon, cls: `preset ${s.tool === t ? 'active' : ''}` })),
  );
  const color = h('input', { type: 'color', value: s.color, on: { input: (e: Event) => (s.color = (e.target as HTMLInputElement).value) } });
  const swatches = h('div', { class: 'swatches' },
    ...SWATCHES.map((c) => h('button', { class: `sw ${c === s.color ? 'on' : ''}`, style: `background:${c}`, title: c, on: { click: () => { s.color = c; if (s.tool !== 'brush') s.tool = 'brush'; app.setTab('paint'); } } })),
  );

  const brush = section('ブラシ', [
    toolRow,
    h('div', { class: 'row color' }, h('label', null, '色'), h('div', { class: 'swatch' }, color, h('span', { class: 'hex' }, s.color))),
    swatches,
    slider({ label: '太さ (cm)', value: s.size, min: 0.1, max: 20, step: 0.1, onInput: (v) => (s.size = v) }),
    slider({ label: '不透明度', value: s.opacity, min: 0.05, max: 1, step: 0.01, onInput: (v) => (s.opacity = v) }),
    slider({ label: '硬さ', value: s.hardness, min: 0, max: 1, step: 0.01, onInput: (v) => (s.hardness = v) }),
    toggle('左右対称に描く（X ミラー）', s.mirror, (v) => (s.mirror = v)),
    h('p', { class: 'hint' }, 'ビューポートのモデルを左ドラッグで描画。何もない所をドラッグすると視点を回転できます。円カーソルが実際のブラシの大きさです。Ctrl+Z でストローク単位に戻せます。'),
  ]);

  // ------------------------------------------------ レイヤー
  const av = app.avatar;
  const rows: HTMLElement[] = [];
  const seen = new Set<string>();
  for (const t of av.paintTargets()) {
    const name = t.material.name;
    if (seen.has(name)) continue;
    seen.add(name);
    const layer = av.paint.get(name) ?? null;
    rows.push(layerRow(app, MAT_LABELS[name] ?? name, layer, () => av.layer(name), () => {
      if (!av.paint.has(name)) return;
      const strokes = av.paint.get(name)!.toDataURL();
      app.studio.history.exec({
        label: `${MAT_LABELS[name] ?? name}のペイントを削除`,
        redo: () => { av.removeLayer(name); app.rebuildNow(); },
        undo: () => { av.layer(name)!.loadStrokes(strokes); },
      });
      app.setTab('paint');
    }));
  }
  const last = p.lastLayer;
  if (last && !seen.has(last.name) && ![...av.paint.values()].includes(last)) {
    rows.push(layerRow(app, `${last.name}（モデル）`, last, () => last, null));
  }

  return h('div', null,
    brush,
    section('ペイントレイヤー', [
      h('p', { class: 'hint' }, 'アバターの色パラメータを変えても、描いた内容は下地の上に重ねて保持されます。'),
      ...rows,
    ]),
  );
}

function layerRow(app: App, label: string, layer: PaintLayer | null, ensure: () => PaintLayer | null, remove: (() => void) | null): HTMLElement {
  const p = app.painter;
  const fileInput = h('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    const l = ensure();
    if (!f || !l) return;
    const img = new Image();
    img.src = URL.createObjectURL(f);
    await img.decode();
    p.layerOp(l, '画像を貼り付け', (ctx) => {
      ctx.globalAlpha = 1;
      ctx.drawImage(img, 0, 0, l.size, l.size);
    });
    app.setTab('paint');
  });
  const thumb = h('canvas', { class: 'layer-thumb', width: 64, height: 64 }) as HTMLCanvasElement;
  if (layer) thumb.getContext('2d')!.drawImage(layer.composite, 0, 0, 64, 64);
  return h('div', { class: `layer-row ${layer ? 'painted' : ''}` },
    thumb,
    h('div', { class: 'layer-info' },
      h('b', null, label),
      h('small', null, layer && !layer.isEmpty ? 'ペイントあり' : '未ペイント'),
      h('div', { class: 'layer-actions' },
        button('', () => {
          const l = ensure();
          if (!l) return;
          p.layerOp(l, '塗りつぶし', (ctx) => {
            ctx.globalAlpha = p.settings.opacity;
            ctx.fillStyle = p.settings.color;
            ctx.fillRect(0, 0, l.size, l.size);
          });
          app.setTab('paint');
        }, { icon: '🪣', title: '現在の色で全体を塗りつぶし', cls: 'ghost' }),
        button('', () => fileInput.click(), { icon: '🖼', title: '画像を貼り付け（UV 全体に）', cls: 'ghost' }),
        layer ? button('', () => {
          const a = document.createElement('a');
          a.href = layer.composite.toDataURL('image/png');
          a.download = `${label}_texture.png`;
          a.click();
        }, { icon: '⬇', title: 'テクスチャを PNG で保存', cls: 'ghost' }) : null,
        layer && remove ? button('', remove, { icon: '🗑', title: 'ペイントを削除して元に戻す', cls: 'ghost' }) : null,
        layer && !remove ? button('', () => { p.layerOp(layer, 'ペイントをクリア', (ctx) => ctx.clearRect(0, 0, layer.size, layer.size)); app.setTab('paint'); }, { icon: '🗑', title: 'クリア', cls: 'ghost' }) : null,
        fileInput,
      ),
    ),
  );
}
