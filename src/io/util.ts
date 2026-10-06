/** 数値を短く整形（末尾の 0 を削る） */
export function fmt(n: number, digits = 6): string {
  if (!isFinite(n)) return '0';
  const s = n.toFixed(digits);
  if (s.indexOf('.') < 0) return s;
  const t = s.replace(/0+$/, '').replace(/\.$/, '');
  return t === '-0' ? '0' : t;
}

export function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export function safeId(s: string): string {
  const r = s.replace(/[^A-Za-z0-9_\-]/g, '_');
  return /^[A-Za-z_]/.test(r) ? r : '_' + r;
}

export function hex2(n: number): string {
  return Math.round(Math.min(1, Math.max(0, n)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

/** Y-up（メートル）→ Z-up（任意単位）変換 */
export function yUpToZUp(x: number, y: number, z: number, scale: number): [number, number, number] {
  return [x * scale, -z * scale, y * scale];
}
