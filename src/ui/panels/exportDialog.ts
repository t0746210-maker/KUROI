import type { App } from '../App';
import { CATEGORY_LABELS, type Category, type ExportFormat } from '../../io/formats';
import { h, modal, select, toggle } from '../dom';

export function openExportDialog(app: App, formats: ExportFormat[]) {
  const o = app.exportOptions;
  const meta = o.vrmMeta;
  const hasAvatar = app.avatar.holder.visible;
  const text = (label: string, value: string, set: (v: string) => void) =>
    h('div', { class: 'row' }, h('label', null, label), h('input', { type: 'text', value, on: { input: (e: Event) => set((e.target as HTMLInputElement).value) } }));

  const cats = Object.keys(CATEGORY_LABELS) as Category[];
  const list = h('div', { class: 'fmt-list' });
  let filter: Category | 'all' = 'all';
  const renderList = () => {
    list.innerHTML = '';
    for (const c of cats) {
      if (filter !== 'all' && filter !== c) continue;
      const fs = formats.filter((f) => f.category === c);
      if (!fs.length) continue;
      list.append(h('h4', { class: 'cat' }, CATEGORY_LABELS[c]));
      list.append(h('div', { class: 'fmt-grid' }, ...fs.map((f) => {
        const disabled = f.needsAvatar && !hasAvatar;
        const card = h('button', { class: `fmt ${disabled ? 'disabled' : ''}`, title: disabled ? 'アバターが非表示のため利用できません' : `${f.label} で書き出す` },
          h('div', { class: 'fmt-head' }, h('span', { class: 'ext' }, '.' + f.ext), h('b', null, f.label)),
          h('p', null, f.desc),
          h('div', { class: 'tags' }, ...f.tags.map((t) => h('span', { class: 'tag' }, t))),
        );
        card.addEventListener('click', async () => {
          if (disabled) return;
          card.classList.add('busy');
          await app.runExport(f);
          card.classList.remove('busy');
          card.classList.add('done');
        });
        return card;
      })));
    }
  };
  renderList();

  const tabs = h('div', { class: 'fmt-tabs' },
    ...(['all', ...cats] as const).map((c) => {
      const b = h('button', { class: `chip ${c === filter ? 'on' : ''}` }, c === 'all' ? `すべて (${formats.length})` : CATEGORY_LABELS[c as Category].split('（')[0]);
      b.addEventListener('click', () => {
        filter = c as any;
        tabs.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        renderList();
      });
      return b;
    }),
  );

  const opts = h('div', { class: 'export-opts' },
    h('h4', null, '共通オプション'),
    toggle('アバターを T ポーズで出力', o.tpose, (v) => (o.tpose = v)),
    toggle('アニメーションを含める (glTF)', o.includeAnimations, (v) => (o.includeAnimations = v)),
    toggle('3D プリント向け (mm / Z-up / 接地)', o.printReady, (v) => (o.printReady = v)),
    toggle('PNG 背景を透過', o.transparentBg, (v) => (o.transparentBg = v)),
    h('h4', null, 'VRM メタ情報'),
    text('モデル名', meta.name, (v) => (meta.name = v)),
    text('作者', meta.author, (v) => (meta.author = v)),
    text('バージョン', meta.version, (v) => (meta.version = v)),
    text('連絡先', meta.contact ?? '', (v) => (meta.contact = v)),
    select('アバター利用', [['everyone', '誰でも'], ['onlySeparatelyLicensedPerson', '許可した人'], ['onlyAuthor', '作者のみ']], meta.avatarPermission, (v) => (meta.avatarPermission = v as any)),
    select('商用利用', [['personalNonProfit', '個人・非営利のみ'], ['personalProfit', '個人の営利まで'], ['corporation', '法人も可']], meta.commercialUsage, (v) => (meta.commercialUsage = v as any)),
    select('改変', [['prohibited', '禁止'], ['allowModification', '許可'], ['allowModificationRedistribution', '改変・再配布可']], meta.modification, (v) => (meta.modification = v as any)),
    select('クレジット表記', [['required', '必要'], ['unnecessary', '不要']], meta.creditNotation, (v) => (meta.creditNotation = v as any)),
    toggle('再配布を許可', meta.allowRedistribution, (v) => (meta.allowRedistribution = v)),
    toggle('暴力表現での利用', meta.allowExcessivelyViolentUsage, (v) => (meta.allowExcessivelyViolentUsage = v)),
    toggle('性的表現での利用', meta.allowExcessivelySexualUsage, (v) => (meta.allowExcessivelySexualUsage = v)),
  );

  const body = h('div', { class: 'export-dialog' },
    h('div', { class: 'export-main' }, tabs, list),
    opts,
  );
  modal(`エクスポート — ${formats.length} 形式に対応`, body, { wide: true });
}
