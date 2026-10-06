/** GLB コンテナの分解・再構築ユーティリティ（VRM 拡張の後付けに使用） */

export interface GLBParts {
  json: any;
  bin: Uint8Array;
}

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function parseGLB(ab: ArrayBuffer): GLBParts {
  const dv = new DataView(ab);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('GLB ではありません');
  const total = dv.getUint32(8, true);
  let off = 12;
  let json: any = null;
  let bin = new Uint8Array(0);
  while (off < total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const data = new Uint8Array(ab, off + 8, len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(data));
    else if (type === CHUNK_BIN) bin = new Uint8Array(data);
    off += 8 + len;
  }
  if (!json) throw new Error('GLB に JSON チャンクがありません');
  return { json, bin };
}

export function packGLB(json: any, bin: Uint8Array): ArrayBuffer {
  if (json.buffers?.length) json.buffers[0].byteLength = bin.length;
  else if (bin.length) json.buffers = [{ byteLength: bin.length }];
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const jsonLen = jsonBytes.length + jsonPad;
  const binLen = bin.length + binPad;
  const total = 12 + 8 + jsonLen + (bin.length ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  for (let i = 0; i < jsonPad; i++) out[20 + jsonBytes.length + i] = 0x20;
  if (bin.length) {
    const o = 20 + jsonLen;
    dv.setUint32(o, binLen, true);
    dv.setUint32(o + 4, CHUNK_BIN, true);
    out.set(bin, o + 8);
  }
  return out.buffer;
}

/** BIN チャンクに画像を追加して images のインデックスを返す */
export function appendImage(parts: GLBParts, png: Uint8Array, name: string): number {
  const { json } = parts;
  const pad = (4 - (parts.bin.length % 4)) % 4;
  const offset = parts.bin.length + pad;
  const nb = new Uint8Array(offset + png.length);
  nb.set(parts.bin, 0);
  nb.set(png, offset);
  parts.bin = nb;
  json.bufferViews ??= [];
  json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
  json.images ??= [];
  json.images.push({ name, mimeType: 'image/png', bufferView: json.bufferViews.length - 1 });
  if (!json.buffers?.length) json.buffers = [{ byteLength: nb.length }];
  return json.images.length - 1;
}

export function addTexture(json: any, imageIndex: number): number {
  json.samplers ??= [];
  if (!json.samplers.length) json.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 });
  json.textures ??= [];
  json.textures.push({ sampler: 0, source: imageIndex });
  return json.textures.length - 1;
}

export function addExtensionUsed(json: any, ...names: string[]) {
  json.extensionsUsed ??= [];
  for (const n of names) if (!json.extensionsUsed.includes(n)) json.extensionsUsed.push(n);
}
