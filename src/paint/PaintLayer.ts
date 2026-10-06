import * as THREE from 'three';

export const PAINT_SIZE = 1024;

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/**
 * ペイントレイヤー:
 *  base      … マテリアル本来の色（頂点カラー・既存テクスチャ込み）を UV 空間に焼いたもの
 *  strokes   … ユーザーが描いたストローク（透明背景）
 *  composite … base + strokes。これがマテリアルの map になる
 * base を作り直しても strokes は残るので、色パラメータを変えてもペイントが保たれる。
 */
export class PaintLayer {
  readonly size: number;
  readonly strokes: HTMLCanvasElement;
  readonly composite: HTMLCanvasElement;
  base: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  readonly sctx: CanvasRenderingContext2D;
  private cctx: CanvasRenderingContext2D;

  constructor(readonly name: string, size = PAINT_SIZE) {
    this.size = size;
    this.strokes = canvas(size);
    this.composite = canvas(size);
    this.base = canvas(size);
    this.sctx = this.strokes.getContext('2d', { willReadFrequently: true })!;
    this.cctx = this.composite.getContext('2d', { willReadFrequently: true })!;
    this.texture = new THREE.CanvasTexture(this.composite);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.name = `paint_${name}`;
    this.texture.anisotropy = 4;
  }

  setBase(base: HTMLCanvasElement) {
    this.base = base;
    this.recomposite();
  }

  /** 指定矩形（省略時は全体）を再合成 */
  recomposite(x = 0, y = 0, w = this.size, h = this.size) {
    x = Math.max(0, Math.floor(x));
    y = Math.max(0, Math.floor(y));
    w = Math.min(this.size - x, Math.ceil(w));
    h = Math.min(this.size - y, Math.ceil(h));
    if (w <= 0 || h <= 0) return;
    const c = this.cctx;
    c.clearRect(x, y, w, h);
    c.drawImage(this.base, x, y, w, h, x, y, w, h);
    c.drawImage(this.strokes, x, y, w, h, x, y, w, h);
    this.texture.needsUpdate = true;
  }

  get isEmpty() {
    const d = this.sctx.getImageData(0, 0, this.size, this.size).data;
    for (let i = 3; i < d.length; i += 16) if (d[i]) return false;
    return true;
  }

  clear() {
    this.sctx.clearRect(0, 0, this.size, this.size);
    this.recomposite();
  }

  /** 合成結果の色をサンプリング（スポイト） */
  sample(px: number, py: number): string {
    const d = this.cctx.getImageData(Math.floor(px), Math.floor(py), 1, 1).data;
    return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  toDataURL() {
    return this.strokes.toDataURL('image/png');
  }

  async loadStrokes(src: string | CanvasImageSource) {
    let img: CanvasImageSource;
    if (typeof src === 'string') {
      const im = new Image();
      im.src = src;
      await im.decode();
      img = im;
    } else img = src;
    this.sctx.clearRect(0, 0, this.size, this.size);
    this.sctx.drawImage(img, 0, 0, this.size, this.size);
    this.recomposite();
  }
}

/**
 * マテリアルの見た目（色 × 頂点カラー × テクスチャ）を GPU で UV 空間にレンダリングして
 * キャンバスに読み出す。ペイントの下地として使う。
 */
export class UVBaker {
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private target: THREE.WebGLRenderTarget | null = null;
  private floatOK = true;

  constructor(private renderer: THREE.WebGLRenderer) {}

  bake(mesh: THREE.Mesh, materialIndex: number, size = PAINT_SIZE, override?: THREE.Material): HTMLCanvasElement {
    const src = mesh.geometry;
    const uv = src.attributes.uv as THREE.BufferAttribute;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mat = (override ?? mats[materialIndex]) as any;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) {
      pos[i * 3] = uv.getX(i) * 2 - 1;
      pos[i * 3 + 1] = uv.getY(i) * 2 - 1;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', uv);
    if (src.attributes.color) g.setAttribute('color', src.attributes.color);
    // 対象マテリアルの三角形だけ
    const index = src.index ? (src.index.array as ArrayLike<number>) : Uint32Array.from({ length: uv.count }, (_, i) => i);
    const groups = src.groups.length && Array.isArray(mesh.material) ? src.groups.filter((gr) => (gr.materialIndex ?? 0) === materialIndex) : [{ start: 0, count: index.length }];
    const idx: number[] = [];
    for (const gr of groups) for (let k = gr.start; k < Math.min(index.length, gr.start + gr.count); k++) idx.push(index[k]);
    g.setIndex(idx);
    const color: THREE.Color = mat.color?.clone() ?? new THREE.Color(1, 1, 1);
    const m = new THREE.MeshBasicMaterial({
      color,
      map: mat.map ?? null,
      vertexColors: !!mat.vertexColors && !!src.attributes.color,
      side: THREE.DoubleSide,
    });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(g, m));

    const r = this.renderer;
    const type = this.floatOK ? THREE.FloatType : THREE.UnsignedByteType;
    if (!this.target || this.target.width !== size || this.target.texture.type !== type) {
      this.target?.dispose();
      this.target = new THREE.WebGLRenderTarget(size, size, { type, depthBuffer: false });
    }
    const prevTarget = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    // 背景は基本色で塗っておき、UV の継ぎ目に黒い線が出ないようにする
    r.setRenderTarget(this.target);
    r.setClearColor(color, 1);
    r.clear();
    r.render(scene, this.camera);
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const ctx = out.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    try {
      if (this.floatOK) {
        const buf = new Float32Array(size * size * 4);
        r.readRenderTargetPixels(this.target, 0, 0, size, size, buf);
        writeFlipped(buf, img.data, size, true);
      } else {
        const buf = new Uint8Array(size * size * 4);
        r.readRenderTargetPixels(this.target, 0, 0, size, size, buf);
        writeFlipped(buf, img.data, size, false);
      }
    } catch (e) {
      if (this.floatOK) {
        this.floatOK = false;
        r.setRenderTarget(prevTarget);
        return this.bake(mesh, materialIndex, size, override);
      }
      throw e;
    } finally {
      r.setRenderTarget(prevTarget);
      r.setClearColor(prevClear, prevAlpha);
      g.dispose();
      m.dispose();
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }
}

const LUT = new Uint8ClampedArray(4096);
for (let i = 0; i < 4096; i++) {
  const c = i / 4095;
  LUT[i] = Math.round(255 * (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
}

/** linear → sRGB 変換しつつ上下反転（WebGL は左下原点、Canvas は左上原点） */
function writeFlipped(src: ArrayLike<number>, dst: Uint8ClampedArray, size: number, isFloat: boolean) {
  for (let y = 0; y < size; y++) {
    const sy = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const si = (sy * size + x) * 4;
      const di = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) {
        const v = isFloat ? src[si + k] : src[si + k] / 255;
        dst[di + k] = LUT[Math.max(0, Math.min(4095, Math.round(v * 4095)))];
      }
      dst[di + 3] = 255;
    }
  }
}
