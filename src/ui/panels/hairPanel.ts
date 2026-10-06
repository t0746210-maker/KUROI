import type { App } from '../App';
import type { HairStrand } from '../../avatar/params';
import { makeStrand, STRAND_TEMPLATES } from '../HairEditor';
import { button, h, section, select, slider, toggle } from '../dom';

export function buildHairPanel(app: App): HTMLElement {
  const ed = app.hairEditor;
  const strands = ed.strands;
  if (ed.selected >= strands.length) ed.selected = strands.length - 1;

  const tplGrid = h('div', { class: 'preset-grid' },
    ...Object.entries(STRAND_TEMPLATES).map(([k, t]) =>
      button(t.label, () => {
        ed.template = k;
        if (ed.placing) {
          ed.placing = k;
          app.setTab('hair');
        } else ed.addStrand(makeStrand(k));
      }, { icon: t.icon, cls: `preset ${ed.template === k && ed.placing ? 'active' : ''}` }),
    ),
  );
  const placeToggle = toggle('クリックで頭に配置するモード', !!ed.placing, (v) => {
    ed.placing = v ? ed.template : null;
    app.setTab('hair');
  });

  const list = h('div', { class: 'strand-list' },
    ...strands.map((st, i) =>
      h('div', { class: `strand-item ${i === ed.selected ? 'sel' : ''}`, on: { click: () => { ed.select(i); app.setTab('hair'); } } },
        h('span', { class: 'ico' }, STRAND_TEMPLATES[Object.keys(STRAND_TEMPLATES).find((k) => STRAND_TEMPLATES[k].label === st.name) ?? 'long']?.icon ?? '〰'),
        h('span', { class: 'name' }, `${i + 1}. ${st.name}`),
        h('span', { class: 'badges' }, st.mirror ? '⇋' : '', st.spring ? '🌀' : ''),
      ),
    ),
  );
  if (!strands.length) list.append(h('p', { class: 'hint' }, 'まだ房はありません。上のテンプレートから追加してください。'));

  const parts: HTMLElement[] = [
    section('房を追加', [
      tplGrid,
      placeToggle,
      h('p', { class: 'hint' }, ed.placing
        ? `配置モード: 頭や髪の上をクリックすると「${STRAND_TEMPLATES[ed.placing].label}」をその位置から生やします。`
        : 'テンプレートを押すと既定の位置に追加。配置モードをオンにすると、ビューポートでクリックした場所から生やせます。ベースの髪型を「ベースのみ」にすると一から房で組み立てられます。'),
    ]),
    section(`房の一覧 (${strands.length})`, [list]),
  ];

  const st = strands[ed.selected];
  if (st) parts.push(strandSettings(app, st, ed.selected));
  return h('div', null, ...parts);
}

function strandSettings(app: App, st: HairStrand, index: number): HTMLElement {
  const ed = app.hairEditor;
  const num = (key: keyof HairStrand, label: string, min: number, max: number, step = 0.01) =>
    slider({
      label, value: st[key] as number, min, max, step,
      onInput: (v) => { (st as any)[key] = v; app.queueRebuild(); },
      onChange: () => app.commitParams(`房の${label}を変更`),
    });
  const setAndCommit = (label: string, fn: () => void) => {
    fn();
    app.rebuildNow();
    app.commitParams(label);
    ed.refresh();
    app.setTab('hair');
  };
  const nameInput = h('input', { type: 'text', value: st.name });
  nameInput.addEventListener('change', () => setAndCommit('房の名前を変更', () => (st.name = nameInput.value || '房')));
  return section(`選択中の房: ${index + 1}. ${st.name}`, [
    h('div', { class: 'row' }, h('label', null, '名前'), nameInput),
    num('width', '幅', 0.15, 3),
    num('thickness', '厚み', 0.2, 3),
    num('taper', '先細り', 0, 1),
    num('length', '長さ', 0.3, 2.5),
    num('curl', 'カール', 0, 1),
    num('twist', 'ねじれ', -12, 12, 0.1),
    select('色', [['gradient', '髪色グラデーション'], ['main', '髪色（単色）'], ['sub', 'グラデ色（単色）'], ['accent', 'アクセントカラー']], st.color, (v) =>
      setAndCommit('房の色を変更', () => (st.color = v as HairStrand['color'])),
    ),
    toggle('左右対称（X ミラー）', st.mirror, (v) => setAndCommit('房のミラーを切替', () => (st.mirror = v))),
    toggle('揺れ物（SpringBone）', st.spring, (v) => setAndCommit('房の揺れ物を切替', () => (st.spring = v))),
    st.spring ? num('stiffness', '硬さ（戻る力）', 0.2, 4, 0.05) : null,
    h('div', { class: 'btn-grid' },
      button('点を追加', () => setAndCommit('制御点を追加', () => {
        const n = st.points.length;
        const a = st.points[n - 1];
        const b = st.points[n - 2] ?? [a[0], a[1] + 0.3, a[2]];
        st.points.push([a[0] + (a[0] - b[0]) * 0.6, a[1] + (a[1] - b[1]) * 0.6, a[2] + (a[2] - b[2]) * 0.6]);
      }), { icon: '＋' }),
      button('点を削除', () => st.points.length > 2 && setAndCommit('制御点を削除', () => st.points.pop()), { icon: '－' }),
      button('複製', () => {
        const c = structuredClone(st);
        c.id = `${st.id}c${Date.now() % 1000}`;
        c.name = `${st.name} コピー`;
        c.points = c.points.map(([x, y, z]) => [x + 0.08, y, z]);
        ed.addStrand(c);
      }, { icon: '⧉' }),
      button('削除', () => ed.removeStrand(index), { icon: '🗑', cls: 'danger' }),
    ),
    h('p', { class: 'hint' }, 'ビューポートの黄色い点（根元はピンク）をクリックしてギズモで動かすと形を編集できます。'),
  ].filter(Boolean) as HTMLElement[]);
}
