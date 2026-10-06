import { h, modal } from '../dom';

export function openHelp() {
  const rows: [string, string][] = [
    ['左ドラッグ', '視点の回転'],
    ['右ドラッグ / Shift+左', 'パン'],
    ['ホイール', 'ズーム'],
    ['クリック', '選択'],
    ['W / E / R', '移動 / 回転 / 拡大縮小ギズモ'],
    ['F', '選択オブジェクトにフォーカス'],
    ['1 / 3 / 7 / 9', '正面 / 右 / 上 / 背面ビュー'],
    ['G', 'グリッド表示切替'],
    ['Delete', '削除（アバターは表示切替）'],
    ['Ctrl+D', '複製'],
    ['Ctrl+Z / Ctrl+Shift+Z', '元に戻す / やり直す'],
    ['Ctrl+S', 'プロジェクト保存 (.kuroi)'],
    ['Ctrl+E', 'エクスポート'],
    ['Esc', '選択解除'],
  ];
  const body = h('div', { class: 'help' },
    h('p', null, 'KUROI Studio はブラウザだけで動くアバター＆3D モデリングスタジオです。パラメトリックにキャラクターを作り、ポーズ・表情・揺れ物を付けて、VRM 1.0 / 0.x・glTF・FBX・OBJ・USDZ・STL・3MF など 18 形式に書き出せます。'),
    h('table', null, ...rows.map(([k, v]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, v)))),
    h('p', { class: 'hint' }, '作業内容はブラウザに自動保存されます。ファイルとして残すには「保存」で .kuroi プロジェクトを書き出してください。'),
  );
  modal('ヘルプ & ショートカット', body);
}
