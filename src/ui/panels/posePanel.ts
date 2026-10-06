import { POSES } from '../../avatar/animations';
import { EXPRESSIONS } from '../../avatar/AvatarBuilder';
import type { App } from '../App';
import { button, h, section, slider, toggle } from '../dom';

const EXPR_LABELS: Record<string, string> = {
  happy: '喜び', angry: '怒り', sad: '悲しみ', relaxed: '安らぎ', surprised: '驚き',
  aa: 'あ', ih: 'い', ou: 'う', ee: 'え', oh: 'お',
  blink: 'まばたき', blinkLeft: 'ウィンク左', blinkRight: 'ウィンク右',
};

export function buildPosePanel(app: App): HTMLElement {
  const av = app.avatar;
  const poseGrid = h('div', { class: 'preset-grid' },
    ...Object.keys(POSES).map((name) => {
      const b = button(name, () => {
        const before = { pose: av.pose, name: av.poseName, clip: av.currentClip };
        const apply = (pose: typeof av.pose, n: string, clip: string | null) => {
          av.play(null);
          av.applyPose(pose, n);
          if (clip) av.play(clip);
          app.setTab('pose');
        };
        app.studio.history.exec({ label: `ポーズ「${name}」`, redo: () => apply(POSES[name], name, null), undo: () => apply(before.pose, before.name, before.clip) });
      }, { cls: `preset ${av.poseName === name && !av.currentClip ? 'active' : ''}` });
      return b;
    }),
  );

  const editToggle = toggle('ボーンを直接編集（クリック→回転）', app.poseEditor.wanted, (v) => {
    app.poseEditor.wanted = v;
    app.poseEditor.setActive(v);
    app.setTab('pose');
  });

  const clipGrid = h('div', { class: 'preset-grid' },
    ...av.clips.map((c) => button(c.name, () => {
      av.play(av.currentClip === c.name ? null : c.name);
      if (av.currentClip) {
        app.poseEditor.wanted = false;
        app.poseEditor.setActive(false);
      }
      app.setTab('pose');
    }, { cls: `preset ${av.currentClip === c.name ? 'active' : ''}`, icon: av.currentClip === c.name ? '■' : '▶' })),
  );
  const speed = slider({ label: '再生速度', value: av.mixer.timeScale, min: 0, max: 3, step: 0.05, onInput: (v) => (av.mixer.timeScale = v) });

  const exprs = EXPRESSIONS.map((e) => slider({
    label: EXPR_LABELS[e] ?? e, value: av.expressions[e] ?? 0, min: 0, max: 1, step: 0.01,
    onInput: (v) => av.setExpression(e, v),
  }));
  const resetExpr = button('表情リセット', () => {
    for (const e of EXPRESSIONS) av.setExpression(e, 0);
    app.setTab('pose');
  }, { icon: '↺' });

  const wind = slider({
    label: '風の強さ', value: av.springs.wind.length(), min: 0, max: 3, step: 0.05,
    onInput: (v) => av.springs.wind.set(0.3 * v, 0, -v),
  });

  return h('div', null,
    section('ポーズ', [poseGrid, editToggle, h('p', { class: 'hint' }, 'ボーン編集中は水色の点をクリックして回転ギズモで調整します。Ctrl+Z で元に戻せます。')]),
    section('アニメーション', [clipGrid, speed, h('p', { class: 'hint' }, 'BVH ファイルをドロップすると、ボーン名が一致するモーションを読み込めます。')]),
    section('表情（VRM プリセット）', [...exprs, resetExpr, toggle('自動まばたき', av.autoBlink, (v) => (av.autoBlink = v))]),
    section('揺れ物（SpringBone）', [
      toggle('物理シミュレーション', av.springEnabled, (v) => (av.springEnabled = v)),
      wind,
      h('p', { class: 'hint' }, `${av.data.springs.length} チェーン / コライダー ${av.data.colliders.length} 個。VRM 出力時に SpringBone として書き出されます。`),
    ]),
  );
}
