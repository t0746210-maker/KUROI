type Child = Node | string | number | null | undefined | false;
type Props = {
  class?: string;
  style?: string;
  title?: string;
  on?: Record<string, (e: any) => void>;
  [k: string]: any;
};

/** 軽量 DOM ビルダー */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v as Record<string, any>)) el.addEventListener(ev, fn);
      else if (k in el && typeof v !== 'string') (el as any)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export interface SliderOpts {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** ドラッグ中 */
  onInput?: (v: number) => void;
  /** 確定時（履歴登録用） */
  onChange?: (v: number, before: number) => void;
  format?: (v: number) => string;
}

export function slider(o: SliderOpts) {
  const step = o.step ?? (o.max - o.min) / 200;
  const fmt = o.format ?? ((v: number) => (Math.abs(step) >= 1 ? String(Math.round(v)) : v.toFixed(step < 0.01 ? 3 : 2)));
  const num = h('input', { class: 'num', type: 'number', step: String(step), value: fmt(o.value) });
  const range = h('input', { type: 'range', min: String(o.min), max: String(o.max), step: String(step), value: String(o.value) });
  let before = o.value;
  const pct = () => {
    const t = ((+range.value - o.min) / (o.max - o.min)) * 100;
    range.style.setProperty('--p', `${Math.max(0, Math.min(100, t))}%`);
  };
  pct();
  range.addEventListener('pointerdown', () => (before = +range.value));
  range.addEventListener('focus', () => (before = +range.value));
  range.addEventListener('input', () => {
    num.value = fmt(+range.value);
    pct();
    o.onInput?.(+range.value);
  });
  range.addEventListener('change', () => {
    o.onChange?.(+range.value, before);
    before = +range.value;
  });
  num.addEventListener('focus', () => (before = +num.value));
  num.addEventListener('change', () => {
    const v = +num.value;
    if (!isFinite(v)) return;
    range.value = String(v);
    pct();
    o.onInput?.(v);
    o.onChange?.(v, before);
    before = v;
  });
  const row = h('div', { class: 'row slider' }, h('label', null, o.label), range, num);
  (row as any).setValue = (v: number) => {
    range.value = String(v);
    num.value = fmt(v);
    pct();
  };
  return row;
}

export function select(label: string, options: [string, string][], value: string, onChange: (v: string, before: string) => void) {
  const sel = h('select', null, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  let before = value;
  sel.addEventListener('change', () => {
    onChange(sel.value, before);
    before = sel.value;
  });
  return h('div', { class: 'row' }, h('label', null, label), sel);
}

export function colorInput(label: string, value: string, onInput: (v: string) => void, onChange: (v: string, before: string) => void) {
  const inp = h('input', { type: 'color', value });
  const hex = h('span', { class: 'hex' }, value);
  let before = value;
  inp.addEventListener('focus', () => (before = inp.value));
  inp.addEventListener('click', () => (before = inp.value));
  inp.addEventListener('input', () => {
    hex.textContent = inp.value;
    onInput(inp.value);
  });
  inp.addEventListener('change', () => {
    onChange(inp.value, before);
    before = inp.value;
  });
  return h('div', { class: 'row color' }, h('label', null, label), h('div', { class: 'swatch' }, inp, hex));
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void) {
  const inp = h('input', { type: 'checkbox', checked: value });
  inp.addEventListener('change', () => onChange(inp.checked));
  return h('label', { class: 'row toggle' }, h('span', null, label), h('span', { class: 'switch' }, inp, h('i')));
}

export function button(label: string, onClick: () => void, opts: { cls?: string; title?: string; icon?: string } = {}) {
  return h(
    'button',
    { class: `btn ${opts.cls ?? ''}`, title: opts.title ?? '', on: { click: onClick } },
    opts.icon ? h('span', { class: 'ico' }, opts.icon) : null,
    label ? h('span', null, label) : null,
  );
}

export function section(title: string, body: (HTMLElement | null)[], open = true) {
  const d = h('details', { class: 'section', open }, h('summary', null, title), h('div', { class: 'section-body' }, ...body));
  return d;
}

let toastBox: HTMLElement | null = null;
export function toast(msg: string, kind: 'info' | 'ok' | 'err' = 'info', ms = 3200) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts' });
    document.body.appendChild(toastBox);
  }
  const t = h('div', { class: `toast ${kind}` }, msg);
  toastBox.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export function modal(title: string, body: HTMLElement, opts: { wide?: boolean; onClose?: () => void } = {}) {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const overlay = h(
    'div',
    { class: 'overlay', on: { pointerdown: (e: PointerEvent) => e.target === overlay && close() } },
    h('div', { class: `modal ${opts.wide ? 'wide' : ''}` }, h('div', { class: 'modal-head' }, h('h2', null, title), button('', close, { icon: '✕', cls: 'ghost', title: '閉じる' })), h('div', { class: 'modal-body' }, body)),
  );
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  return close;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
