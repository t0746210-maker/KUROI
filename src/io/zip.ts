/** 依存ライブラリなしの ZIP（無圧縮 STORE）ライター */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

const enc = new TextEncoder();

export function toBytes(d: Uint8Array | string | ArrayBuffer): Uint8Array {
  if (typeof d === 'string') return enc.encode(d);
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  return d;
}

export function createZip(entries: ZipEntry[]): Uint8Array {
  const files = entries.map((e) => ({ name: enc.encode(e.name), data: toBytes(e.data) }));
  let size = 22;
  for (const f of files) size += 30 + f.name.length + f.data.length + 46 + f.name.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let off = 0;
  const central: { off: number; crc: number; f: (typeof files)[number] }[] = [];
  // 1980-01-01 00:00 の DOS 日時
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1;
  for (const f of files) {
    const crc = crc32(f.data);
    central.push({ off, crc, f });
    dv.setUint32(off, 0x04034b50, true);
    dv.setUint16(off + 4, 20, true);
    dv.setUint16(off + 6, 0x0800, true); // UTF-8 ファイル名
    dv.setUint16(off + 8, 0, true);
    dv.setUint16(off + 10, dosTime, true);
    dv.setUint16(off + 12, dosDate, true);
    dv.setUint32(off + 14, crc, true);
    dv.setUint32(off + 18, f.data.length, true);
    dv.setUint32(off + 22, f.data.length, true);
    dv.setUint16(off + 26, f.name.length, true);
    dv.setUint16(off + 28, 0, true);
    out.set(f.name, off + 30);
    out.set(f.data, off + 30 + f.name.length);
    off += 30 + f.name.length + f.data.length;
  }
  const cdStart = off;
  for (const c of central) {
    dv.setUint32(off, 0x02014b50, true);
    dv.setUint16(off + 4, 20, true);
    dv.setUint16(off + 6, 20, true);
    dv.setUint16(off + 8, 0x0800, true);
    dv.setUint16(off + 10, 0, true);
    dv.setUint16(off + 12, dosTime, true);
    dv.setUint16(off + 14, dosDate, true);
    dv.setUint32(off + 16, c.crc, true);
    dv.setUint32(off + 20, c.f.data.length, true);
    dv.setUint32(off + 24, c.f.data.length, true);
    dv.setUint16(off + 28, c.f.name.length, true);
    dv.setUint16(off + 30, 0, true);
    dv.setUint16(off + 32, 0, true);
    dv.setUint16(off + 34, 0, true);
    dv.setUint16(off + 36, 0, true);
    dv.setUint32(off + 38, 0, true);
    dv.setUint32(off + 42, c.off, true);
    out.set(c.f.name, off + 46);
    off += 46 + c.f.name.length;
  }
  const cdSize = off - cdStart;
  dv.setUint32(off, 0x06054b50, true);
  dv.setUint16(off + 4, 0, true);
  dv.setUint16(off + 6, 0, true);
  dv.setUint16(off + 8, files.length, true);
  dv.setUint16(off + 10, files.length, true);
  dv.setUint32(off + 12, cdSize, true);
  dv.setUint32(off + 16, cdStart, true);
  dv.setUint16(off + 20, 0, true);
  return out;
}

/** テスト・検証用の最小 ZIP リーダー（STORE のみ） */
export function readZip(buf: Uint8Array): Record<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out: Record<string, Uint8Array> = {};
  let off = 0;
  const dec = new TextDecoder();
  while (off + 4 <= buf.length && dv.getUint32(off, true) === 0x04034b50) {
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extra = dv.getUint16(off + 28, true);
    const name = dec.decode(buf.subarray(off + 30, off + 30 + nameLen));
    const start = off + 30 + nameLen + extra;
    out[name] = buf.subarray(start, start + size);
    off = start + size;
  }
  return out;
}
