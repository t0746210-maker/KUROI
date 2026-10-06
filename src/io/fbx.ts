import type { BakedMesh } from './bake';

/**
 * FBX 7.4 バイナリライター（依存なし）。
 * Blender / Unity / Maya / 3ds Max で読み込める形式で、メッシュ・法線・UV・頂点カラー・マテリアルを出力する。
 */

type Prop =
  | { t: 'C'; v: boolean }
  | { t: 'I'; v: number }
  | { t: 'L'; v: bigint | number }
  | { t: 'F'; v: number }
  | { t: 'D'; v: number }
  | { t: 'S'; v: string }
  | { t: 'R'; v: Uint8Array }
  | { t: 'i'; v: ArrayLike<number> }
  | { t: 'd'; v: ArrayLike<number> }
  | { t: 'f'; v: ArrayLike<number> };

export interface FBXNode {
  name: string;
  props: Prop[];
  children: FBXNode[];
}

const enc = new TextEncoder();
const S = (v: string): Prop => ({ t: 'S', v });
const I = (v: number): Prop => ({ t: 'I', v });
const L = (v: number | bigint): Prop => ({ t: 'L', v });
const D = (v: number): Prop => ({ t: 'D', v });
const node = (name: string, props: Prop[] = [], children: FBXNode[] = []): FBXNode => ({ name, props, children });

/** Properties70 の P エントリ */
function P(name: string, type: string, label: string, flags: string, ...vals: (number | string | { int: number })[]): FBXNode {
  return node('P', [
    S(name),
    S(type),
    S(label),
    S(flags),
    ...vals.map((v) => (typeof v === 'string' ? S(v) : typeof v === 'number' ? D(v) : I(v.int))),
  ]);
}

class Writer {
  buf = new Uint8Array(1 << 16);
  dv = new DataView(this.buf.buffer);
  pos = 0;
  ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf);
    this.buf = nb;
    this.dv = new DataView(nb.buffer);
  }
  u8(v: number) {
    this.ensure(1);
    this.dv.setUint8(this.pos, v);
    this.pos += 1;
  }
  u32(v: number) {
    this.ensure(4);
    this.dv.setUint32(this.pos, v, true);
    this.pos += 4;
  }
  i32(v: number) {
    this.ensure(4);
    this.dv.setInt32(this.pos, v, true);
    this.pos += 4;
  }
  i64(v: bigint | number) {
    this.ensure(8);
    this.dv.setBigInt64(this.pos, BigInt(v), true);
    this.pos += 8;
  }
  f32(v: number) {
    this.ensure(4);
    this.dv.setFloat32(this.pos, v, true);
    this.pos += 4;
  }
  f64(v: number) {
    this.ensure(8);
    this.dv.setFloat64(this.pos, v, true);
    this.pos += 8;
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  setU32(at: number, v: number) {
    this.dv.setUint32(at, v, true);
  }
  result() {
    return this.buf.slice(0, this.pos);
  }
}

function writeProp(w: Writer, p: Prop) {
  w.u8(p.t.charCodeAt(0));
  switch (p.t) {
    case 'C':
      w.u8(p.v ? 1 : 0);
      break;
    case 'I':
      w.i32(p.v);
      break;
    case 'L':
      w.i64(p.v);
      break;
    case 'F':
      w.f32(p.v);
      break;
    case 'D':
      w.f64(p.v);
      break;
    case 'S': {
      const b = enc.encode(p.v);
      w.u32(b.length);
      w.bytes(b);
      break;
    }
    case 'R':
      w.u32(p.v.length);
      w.bytes(p.v);
      break;
    case 'i':
    case 'd':
    case 'f': {
      const n = p.v.length;
      const size = p.t === 'd' ? 8 : 4;
      w.u32(n);
      w.u32(0); // 非圧縮
      w.u32(n * size);
      for (let k = 0; k < n; k++) {
        if (p.t === 'i') w.i32(p.v[k]);
        else if (p.t === 'd') w.f64(p.v[k]);
        else w.f32(p.v[k]);
      }
      break;
    }
  }
}

const SENTINEL = new Uint8Array(13);

function writeNode(w: Writer, n: FBXNode, isLast: boolean) {
  const start = w.pos;
  w.u32(0); // endOffset（後で埋める）
  w.u32(n.props.length);
  w.u32(0); // propertyListLen
  const nameB = enc.encode(n.name);
  w.u8(nameB.length);
  w.bytes(nameB);
  const pStart = w.pos;
  for (const p of n.props) writeProp(w, p);
  w.setU32(start + 8, w.pos - pStart);
  if (n.children.length) {
    n.children.forEach((c, i) => writeNode(w, c, i === n.children.length - 1));
    w.bytes(SENTINEL);
  } else if (!n.props.length && !isLast) {
    w.bytes(SENTINEL);
  }
  w.setU32(start, w.pos);
}

const FILE_ID = new Uint8Array([0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1]);
const FOOT_ID = new Uint8Array([0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e]);
const FOOT_MAGIC = new Uint8Array([0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b]);

export function encodeFBX(root: FBXNode[], version = 7400): Uint8Array {
  const w = new Writer();
  w.bytes(enc.encode('Kaydara FBX Binary  '));
  w.u8(0);
  w.u8(0x1a);
  w.u8(0);
  w.u32(version);
  root.forEach((n, i) => writeNode(w, n, i === root.length - 1));
  w.bytes(SENTINEL);
  w.bytes(FOOT_ID);
  let pad = ((w.pos + 15) & ~15) - w.pos;
  if (pad === 0) pad = 16;
  w.bytes(new Uint8Array(pad));
  w.u32(version);
  w.bytes(new Uint8Array(120));
  w.bytes(FOOT_MAGIC);
  return w.result();
}

/** 焼き込みメッシュ群から FBX シーンを構築 */
export function buildFBX(meshes: BakedMesh[], opts: { creator?: string; sceneName?: string } = {}): Uint8Array {
  const creator = opts.creator ?? 'KUROI Studio';
  let nextId = 1000000;
  const id = () => nextId++;
  const objects: FBXNode[] = [];
  const conns: FBXNode[] = [];
  let nModels = 0;
  let nGeoms = 0;
  let nMats = 0;
  const now = new Date();

  for (const m of meshes) {
    const modelId = id();
    const geoId = id();
    nModels++;
    nGeoms++;
    const vcount = m.positions.length / 3;
    const tris = m.indices.length / 3;
    const pvi = new Int32Array(m.indices.length);
    for (let t = 0; t < tris; t++) {
      pvi[t * 3] = m.indices[t * 3];
      pvi[t * 3 + 1] = m.indices[t * 3 + 1];
      pvi[t * 3 + 2] = ~m.indices[t * 3 + 2];
    }
    const normals = new Float64Array(m.indices.length * 3);
    for (let k = 0; k < m.indices.length; k++) {
      const vi = m.indices[k];
      normals[k * 3] = m.normals[vi * 3];
      normals[k * 3 + 1] = m.normals[vi * 3 + 1];
      normals[k * 3 + 2] = m.normals[vi * 3 + 2];
    }
    const triMat = new Int32Array(tris);
    for (const g of m.groups) for (let k = g.start / 3; k < (g.start + g.count) / 3; k++) triMat[k] = g.materialIndex;

    const layerElems: FBXNode[] = [
      node('LayerElement', [], [node('Type', [S('LayerElementNormal')]), node('TypedIndex', [I(0)])]),
      node('LayerElement', [], [node('Type', [S('LayerElementMaterial')]), node('TypedIndex', [I(0)])]),
    ];
    const geoChildren: FBXNode[] = [
      node('Vertices', [{ t: 'd', v: Float64Array.from(m.positions) }]),
      node('PolygonVertexIndex', [{ t: 'i', v: pvi }]),
      node('GeometryVersion', [I(124)]),
      node('LayerElementNormal', [I(0)], [
        node('Version', [I(101)]),
        node('Name', [S('')]),
        node('MappingInformationType', [S('ByPolygonVertex')]),
        node('ReferenceInformationType', [S('Direct')]),
        node('Normals', [{ t: 'd', v: normals }]),
      ]),
    ];
    if (m.uvs) {
      geoChildren.push(
        node('LayerElementUV', [I(0)], [
          node('Version', [I(101)]),
          node('Name', [S('UVMap')]),
          node('MappingInformationType', [S('ByPolygonVertex')]),
          node('ReferenceInformationType', [S('IndexToDirect')]),
          node('UV', [{ t: 'd', v: Float64Array.from(m.uvs) }]),
          node('UVIndex', [{ t: 'i', v: Int32Array.from(m.indices) }]),
        ]),
      );
      layerElems.push(node('LayerElement', [], [node('Type', [S('LayerElementUV')]), node('TypedIndex', [I(0)])]));
    }
    if (m.hasVertexColors) {
      const cols = new Float64Array(vcount * 4);
      for (let i = 0; i < vcount; i++) {
        cols[i * 4] = m.colors[i * 3];
        cols[i * 4 + 1] = m.colors[i * 3 + 1];
        cols[i * 4 + 2] = m.colors[i * 3 + 2];
        cols[i * 4 + 3] = 1;
      }
      geoChildren.push(
        node('LayerElementColor', [I(0)], [
          node('Version', [I(101)]),
          node('Name', [S('Col')]),
          node('MappingInformationType', [S('ByPolygonVertex')]),
          node('ReferenceInformationType', [S('IndexToDirect')]),
          node('Colors', [{ t: 'd', v: cols }]),
          node('ColorIndex', [{ t: 'i', v: Int32Array.from(m.indices) }]),
        ]),
      );
      layerElems.push(node('LayerElement', [], [node('Type', [S('LayerElementColor')]), node('TypedIndex', [I(0)])]));
    }
    geoChildren.push(
      node('LayerElementMaterial', [I(0)], [
        node('Version', [I(101)]),
        node('Name', [S('')]),
        node('MappingInformationType', [S('ByPolygon')]),
        node('ReferenceInformationType', [S('IndexToDirect')]),
        node('Materials', [{ t: 'i', v: triMat }]),
      ]),
      node('Layer', [I(0)], [node('Version', [I(100)]), ...layerElems]),
    );
    objects.push(node('Geometry', [L(geoId), S(`${m.name}\x00\x01Geometry`), S('Mesh')], geoChildren));
    objects.push(
      node('Model', [L(modelId), S(`${m.name}\x00\x01Model`), S('Mesh')], [
        node('Version', [I(232)]),
        node('Properties70', [], [
          P('Lcl Translation', 'Lcl Translation', '', 'A', 0, 0, 0),
          P('Lcl Rotation', 'Lcl Rotation', '', 'A', 0, 0, 0),
          P('Lcl Scaling', 'Lcl Scaling', '', 'A', 1, 1, 1),
          P('DefaultAttributeIndex', 'int', 'Integer', '', { int: 0 }),
        ]),
        node('Shading', [{ t: 'C', v: true }]),
        node('Culling', [S('CullingOff')]),
      ]),
    );
    conns.push(node('C', [S('OO'), L(modelId), L(0)]));
    conns.push(node('C', [S('OO'), L(geoId), L(modelId)]));
    for (const mat of m.materials) {
      const matId = id();
      nMats++;
      const [r, g, b] = mat.color;
      objects.push(
        node('Material', [L(matId), S(`${mat.name}\x00\x01Material`), S('')], [
          node('Version', [I(102)]),
          node('ShadingModel', [S('phong')]),
          node('MultiLayer', [I(0)]),
          node('Properties70', [], [
            P('ShadingModel', 'KString', '', '', 'phong'),
            P('DiffuseColor', 'Color', '', 'A', r, g, b),
            P('DiffuseFactor', 'Number', '', 'A', 1),
            P('EmissiveColor', 'Color', '', 'A', ...mat.emissive),
            P('AmbientColor', 'Color', '', 'A', 0, 0, 0),
            P('SpecularColor', 'Color', '', 'A', 0.2, 0.2, 0.2),
            P('SpecularFactor', 'Number', '', 'A', (1 - mat.roughness) * 0.5),
            P('Shininess', 'Number', '', 'A', Math.max(2, (1 - mat.roughness) * 100)),
            P('TransparencyFactor', 'Number', '', 'A', 1 - mat.opacity),
            P('Opacity', 'Number', '', 'A', mat.opacity),
            P('Diffuse', 'Vector3D', 'Vector', '', r, g, b),
          ]),
        ]),
      );
      conns.push(node('C', [S('OO'), L(matId), L(modelId)]));
    }
  }

  const header = node('FBXHeaderExtension', [], [
    node('FBXHeaderVersion', [I(1003)]),
    node('FBXVersion', [I(7400)]),
    node('EncryptionType', [I(0)]),
    node('CreationTimeStamp', [], [
      node('Version', [I(1000)]),
      node('Year', [I(now.getFullYear())]),
      node('Month', [I(now.getMonth() + 1)]),
      node('Day', [I(now.getDate())]),
      node('Hour', [I(now.getHours())]),
      node('Minute', [I(now.getMinutes())]),
      node('Second', [I(now.getSeconds())]),
      node('Millisecond', [I(0)]),
    ]),
    node('Creator', [S(creator)]),
  ]);
  const globalSettings = node('GlobalSettings', [], [
    node('Version', [I(1000)]),
    node('Properties70', [], [
      P('UpAxis', 'int', 'Integer', '', { int: 1 }),
      P('UpAxisSign', 'int', 'Integer', '', { int: 1 }),
      P('FrontAxis', 'int', 'Integer', '', { int: 2 }),
      P('FrontAxisSign', 'int', 'Integer', '', { int: 1 }),
      P('CoordAxis', 'int', 'Integer', '', { int: 0 }),
      P('CoordAxisSign', 'int', 'Integer', '', { int: 1 }),
      P('OriginalUpAxis', 'int', 'Integer', '', { int: 1 }),
      P('OriginalUpAxisSign', 'int', 'Integer', '', { int: 1 }),
      P('UnitScaleFactor', 'double', 'Number', '', 100),
      P('OriginalUnitScaleFactor', 'double', 'Number', '', 100),
      P('AmbientColor', 'ColorRGB', 'Color', '', 0, 0, 0),
      P('DefaultCamera', 'KString', '', '', 'Producer Perspective'),
      P('TimeMode', 'enum', '', '', { int: 6 }),
      P('TimeSpanStart', 'KTime', 'Time', '', { int: 0 }),
      P('TimeSpanStop', 'KTime', 'Time', '', { int: 0 }),
      P('CustomFrameRate', 'double', 'Number', '', 30),
    ]),
  ]);
  const defs = node('Definitions', [], [
    node('Version', [I(100)]),
    node('Count', [I(1 + nModels + nGeoms + nMats)]),
    node('ObjectType', [S('GlobalSettings')], [node('Count', [I(1)])]),
    node('ObjectType', [S('Model')], [node('Count', [I(nModels)])]),
    node('ObjectType', [S('Geometry')], [node('Count', [I(nGeoms)])]),
    node('ObjectType', [S('Material')], [node('Count', [I(nMats)])]),
  ]);
  const docId = id();
  const tree: FBXNode[] = [
    header,
    node('FileId', [{ t: 'R', v: FILE_ID }]),
    node('CreationTime', [S('1970-01-01 10:00:00:000')]),
    node('Creator', [S(creator)]),
    globalSettings,
    node('Documents', [], [
      node('Count', [I(1)]),
      node('Document', [L(docId), S(opts.sceneName ?? 'Scene'), S('Scene')], [
        node('Properties70', [], [P('SourceObject', 'object', '', ''), P('ActiveAnimStackName', 'KString', '', '', '')]),
        node('RootNode', [L(0)]),
      ]),
    ]),
    node('References'),
    defs,
    node('Objects', [], objects),
    node('Connections', [], conns),
    node('Takes', [], [node('Current', [S('')])]),
  ];
  return encodeFBX(tree);
}
