import type * as THREE from 'three';
import type { BakedMaterial, BakedMesh } from './bake';

/**
 * FBX 7.4 バイナリライター（依存なし）。
 * Blender / Unity / Maya / 3ds Max で読み込める形式で、メッシュ・法線・UV・頂点カラー・マテリアル・
 * テクスチャ（埋め込み）・スケルトン・スキンウェイト・ブレンドシェイプ・アニメーションを出力する。
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
  | { t: 'f'; v: ArrayLike<number> }
  | { t: 'l'; v: ArrayLike<number> };

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
    case 'l':
    case 'f': {
      const n = p.v.length;
      const size = p.t === 'd' || p.t === 'l' ? 8 : 4;
      w.u32(n);
      w.u32(0); // 非圧縮
      w.u32(n * size);
      for (let k = 0; k < n; k++) {
        if (p.t === 'i') w.i32(p.v[k]);
        else if (p.t === 'd') w.f64(p.v[k]);
        else if (p.t === 'l') w.i64(Math.round(p.v[k]));
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

// ============================================================================ シーン構築

export type Vec3 = [number, number, number];

export interface FBXBone {
  name: string;
  /** 親ボーンのインデックス（-1 はリグのルート Null） */
  parent: number;
  t: Vec3;
  /** FBX の eEulerXYZ（度）。three の Euler 'ZYX' と同じ回転 */
  r: Vec3;
  s: Vec3;
  /** バインド時（T ポーズ）のワールド行列（列優先 16 要素） */
  bindWorld: number[];
}

export interface FBXMorph {
  name: string;
  indices: Int32Array;
  /** 位置の差分（indices と同じ並び、xyz） */
  deltas: Float64Array;
}

export interface FBXSkinnedMesh {
  mesh: BakedMesh;
  skinIndex: ArrayLike<number>;
  skinWeight: ArrayLike<number>;
  morphs: FBXMorph[];
  bindWorld: number[];
}

export interface FBXAnimTrack {
  bone: number;
  /** フレーム数×3（度, eEulerXYZ） */
  rot: Float32Array;
  pos?: Float32Array;
}

export interface FBXAnim {
  name: string;
  fps: number;
  frames: number;
  tracks: FBXAnimTrack[];
}

export interface FBXRig {
  name: string;
  root: { t: Vec3; r: Vec3; s: Vec3; world: number[] };
  bones: FBXBone[];
  meshes: FBXSkinnedMesh[];
  anims: FBXAnim[];
}

export interface FBXOptions {
  creator?: string;
  sceneName?: string;
  rig?: FBXRig | null;
  /** テクスチャ → PNG バイト列（埋め込み用） */
  textures?: Map<THREE.Texture, Uint8Array>;
}

const KTIME_PER_SEC = 46186158000;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** 焼き込みメッシュ群（＋任意でリグ）から FBX シーンを構築 */
export function buildFBX(meshes: BakedMesh[], opts: FBXOptions = {}): Uint8Array {
  const creator = opts.creator ?? 'KUROI Studio';
  let nextId = 1000000;
  const id = () => nextId++;
  const objects: FBXNode[] = [];
  const conns: FBXNode[] = [];
  const counts: Record<string, number> = {};
  const count = (t: string) => (counts[t] = (counts[t] ?? 0) + 1);
  const OO = (child: number, parent: number) => conns.push(node('C', [S('OO'), L(child), L(parent)]));
  const OP = (child: number, parent: number, prop: string) => conns.push(node('C', [S('OP'), L(child), L(parent), S(prop)]));
  const now = new Date();
  const texIds = new Map<THREE.Texture, number>();
  const usedNames = new Set<string>();
  const uniq = (n: string) => {
    let name = n;
    let k = 1;
    while (usedNames.has(name)) name = `${n}_${k++}`;
    usedNames.add(name);
    return name;
  };

  const modelNode = (mid: number, name: string, type: string, t: Vec3, r: Vec3, sc: Vec3, extra: FBXNode[] = []) =>
    node('Model', [L(mid), S(`${name}\x00\x01Model`), S(type)], [
      node('Version', [I(232)]),
      node('Properties70', [], [
        P('Lcl Translation', 'Lcl Translation', '', 'A', ...t),
        P('Lcl Rotation', 'Lcl Rotation', '', 'A', ...r),
        P('Lcl Scaling', 'Lcl Scaling', '', 'A', ...sc),
        P('DefaultAttributeIndex', 'int', 'Integer', '', { int: 0 }),
        ...extra,
      ]),
      node('Shading', [{ t: 'C', v: true }]),
      node('Culling', [S('CullingOff')]),
    ]);

  const textureNode = (tex: THREE.Texture): number | null => {
    const png = opts.textures?.get(tex);
    if (!png) return null;
    const existing = texIds.get(tex);
    if (existing) return existing;
    const base = uniq((tex.name || 'texture').replace(/[^\w\-]/g, '_'));
    const file = `${base}.png`;
    const vid = id();
    const tid = id();
    count('Video');
    count('Texture');
    objects.push(
      node('Video', [L(vid), S(`${base}\x00\x01Video`), S('Clip')], [
        node('Type', [S('Clip')]),
        node('Properties70', [], [P('Path', 'KString', 'XRefUrl', '', file)]),
        node('UseMipMap', [I(0)]),
        node('Filename', [S(file)]),
        node('RelativeFilename', [S(file)]),
        node('Content', [{ t: 'R', v: png }]),
      ]),
      node('Texture', [L(tid), S(`${base}\x00\x01Texture`), S('')], [
        node('Type', [S('TextureVideoClip')]),
        node('Version', [I(202)]),
        node('TextureName', [S(`${base}\x00\x01Texture`)]),
        node('Properties70', [], [P('UVSet', 'KString', '', '', 'UVMap'), P('UseMaterial', 'bool', '', '', { int: 1 })]),
        node('Media', [S(`${base}\x00\x01Video`)]),
        node('FileName', [S(file)]),
        node('RelativeFilename', [S(file)]),
        node('ModelUVTranslation', [D(0), D(0)]),
        node('ModelUVScaling', [D(1), D(1)]),
        node('Texture_Alpha_Source', [S('None')]),
        node('Cropping', [I(0), I(0), I(0), I(0)]),
      ]),
    );
    OO(vid, tid);
    texIds.set(tex, tid);
    return tid;
  };

  const materialNode = (mat: BakedMaterial, modelId: number) => {
    const matId = id();
    count('Material');
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
    OO(matId, modelId);
    if (mat.map) {
      const tid = textureNode(mat.map);
      if (tid) OP(tid, matId, 'DiffuseColor');
    }
  };

  const geometryNode = (m: BakedMesh, geoId: number) => {
    count('Geometry');
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
    const ch: FBXNode[] = [
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
      ch.push(
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
      ch.push(
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
    ch.push(
      node('LayerElementMaterial', [I(0)], [
        node('Version', [I(101)]),
        node('Name', [S('')]),
        node('MappingInformationType', [S('ByPolygon')]),
        node('ReferenceInformationType', [S('IndexToDirect')]),
        node('Materials', [{ t: 'i', v: triMat }]),
      ]),
      node('Layer', [I(0)], [node('Version', [I(100)]), ...layerElems]),
    );
    objects.push(node('Geometry', [L(geoId), S(`${m.name}\x00\x01Geometry`), S('Mesh')], ch));
  };

  const addMesh = (m: BakedMesh, parent: number) => {
    const modelId = id();
    const geoId = id();
    count('Model');
    usedNames.add(m.name);
    geometryNode(m, geoId);
    objects.push(modelNode(modelId, m.name, 'Mesh', [0, 0, 0], [0, 0, 0], [1, 1, 1]));
    OO(modelId, parent);
    OO(geoId, modelId);
    for (const mat of m.materials) materialNode(mat, modelId);
    return { modelId, geoId };
  };

  // ------------------------------------------------ 静的メッシュ
  for (const m of meshes) addMesh(m, 0);

  // ------------------------------------------------ リグ
  let animStop = 0;
  const takes: FBXNode[] = [];
  const rig = opts.rig;
  if (rig) {
    const rootId = id();
    count('Model');
    const rootName = uniq(rig.name || 'Armature');
    const rootAttr = id();
    count('NodeAttribute');
    objects.push(node('NodeAttribute', [L(rootAttr), S(`${rootName}\x00\x01NodeAttribute`), S('Null')], [node('TypeFlags', [S('Null')])]));
    objects.push(modelNode(rootId, rootName, 'Null', rig.root.t, rig.root.r, rig.root.s));
    OO(rootAttr, rootId);
    OO(rootId, 0);

    const boneIds = rig.bones.map(() => id());
    rig.bones.forEach((b, i) => {
      count('Model');
      count('NodeAttribute');
      const attrId = id();
      usedNames.add(b.name);
      objects.push(node('NodeAttribute', [L(attrId), S(`${b.name}\x00\x01NodeAttribute`), S('LimbNode')], [
        node('Properties70', [], [P('Size', 'double', 'Number', '', 1)]),
        node('TypeFlags', [S('Skeleton')]),
      ]));
      objects.push(modelNode(boneIds[i], b.name, 'LimbNode', b.t, b.r, b.s, [P('InheritType', 'enum', '', '', { int: 1 })]));
      OO(attrId, boneIds[i]);
      OO(boneIds[i], b.parent < 0 ? rootId : boneIds[b.parent]);
    });

    const poseNodes: FBXNode[] = [];
    const poseNode = (nid: number, m: number[]) => node('PoseNode', [], [node('Node', [L(nid)]), node('Matrix', [{ t: 'd', v: m }])]);
    poseNodes.push(poseNode(rootId, rig.root.world));
    rig.bones.forEach((b, i) => poseNodes.push(poseNode(boneIds[i], b.bindWorld)));

    for (const sm of rig.meshes) {
      const { modelId, geoId } = addMesh(sm.mesh, rootId);
      poseNodes.push(poseNode(modelId, sm.bindWorld));
      // スキン
      const skinId = id();
      count('Deformer');
      objects.push(node('Deformer', [L(skinId), S(`${sm.mesh.name}\x00\x01Deformer`), S('Skin')], [node('Version', [I(101)]), node('Link_DeformAcuracy', [D(50)])]));
      OO(skinId, geoId);
      const perBone = new Map<number, { idx: number[]; w: number[] }>();
      const vcount = sm.mesh.positions.length / 3;
      for (let v = 0; v < vcount; v++) {
        for (let k = 0; k < 4; k++) {
          const w = sm.skinWeight[v * 4 + k];
          if (w <= 1e-5) continue;
          const bi = sm.skinIndex[v * 4 + k];
          if (!perBone.has(bi)) perBone.set(bi, { idx: [], w: [] });
          const e = perBone.get(bi)!;
          e.idx.push(v);
          e.w.push(w);
        }
      }
      for (const [bi, e] of perBone) {
        const b = rig.bones[bi];
        if (!b) continue;
        const cid = id();
        count('Deformer');
        // Transform = (ボーンのバインド行列)^-1 × メッシュのバインド行列
        const transform = mul4(invert4(b.bindWorld), sm.bindWorld);
        objects.push(node('Deformer', [L(cid), S(`${b.name}\x00\x01SubDeformer`), S('Cluster')], [
          node('Version', [I(100)]),
          node('UserData', [S(''), S('')]),
          node('Indexes', [{ t: 'i', v: Int32Array.from(e.idx) }]),
          node('Weights', [{ t: 'd', v: Float64Array.from(e.w) }]),
          node('Transform', [{ t: 'd', v: transform }]),
          node('TransformLink', [{ t: 'd', v: b.bindWorld }]),
        ]));
        OO(cid, skinId);
        OO(boneIds[bi], cid);
      }
      // ブレンドシェイプ
      if (sm.morphs.length) {
        const bsId = id();
        count('Deformer');
        objects.push(node('Deformer', [L(bsId), S(`${sm.mesh.name}\x00\x01Deformer`), S('BlendShape')], [node('Version', [I(100)])]));
        OO(bsId, geoId);
        for (const mo of sm.morphs) {
          const chId = id();
          const shId = id();
          count('Deformer');
          count('Geometry');
          objects.push(node('Deformer', [L(chId), S(`${mo.name}\x00\x01SubDeformer`), S('BlendShapeChannel')], [
            node('Version', [I(100)]),
            node('DeformPercent', [D(0)]),
            node('FullWeights', [{ t: 'd', v: [100] }]),
          ]));
          objects.push(node('Geometry', [L(shId), S(`${mo.name}\x00\x01Geometry`), S('Shape')], [
            node('Version', [I(100)]),
            node('Indexes', [{ t: 'i', v: mo.indices }]),
            node('Vertices', [{ t: 'd', v: mo.deltas }]),
            node('Normals', [{ t: 'd', v: new Float64Array(mo.deltas.length) }]),
          ]));
          OO(chId, bsId);
          OO(shId, chId);
        }
      }
    }

    const poseId = id();
    count('Pose');
    objects.push(node('Pose', [L(poseId), S(`${rootName}\x00\x01Pose`), S('BindPose')], [
      node('Type', [S('BindPose')]),
      node('Version', [I(100)]),
      node('NbPoseNodes', [I(poseNodes.length)]),
      ...poseNodes,
    ]));

    // ------------------------------------------------ アニメーション
    for (const an of rig.anims) {
      const stop = Math.round(((an.frames - 1) / an.fps) * KTIME_PER_SEC);
      animStop = Math.max(animStop, stop);
      const stackId = id();
      const layerId = id();
      count('AnimationStack');
      count('AnimationLayer');
      objects.push(node('AnimationStack', [L(stackId), S(`${an.name}\x00\x01AnimStack`), S('')], [
        node('Properties70', [], [
          node('P', [S('LocalStart'), S('KTime'), S('Time'), S(''), L(0)]),
          node('P', [S('LocalStop'), S('KTime'), S('Time'), S(''), L(stop)]),
          node('P', [S('ReferenceStart'), S('KTime'), S('Time'), S(''), L(0)]),
          node('P', [S('ReferenceStop'), S('KTime'), S('Time'), S(''), L(stop)]),
        ]),
      ]));
      objects.push(node('AnimationLayer', [L(layerId), S('BaseLayer\x00\x01AnimLayer'), S('')]));
      OO(layerId, stackId);
      const times = Array.from({ length: an.frames }, (_, f) => Math.round((f / an.fps) * KTIME_PER_SEC));
      const addCurves = (data: Float32Array, target: number, prop: 'Lcl Rotation' | 'Lcl Translation', short: 'R' | 'T') => {
        const cnId = id();
        count('AnimationCurveNode');
        objects.push(node('AnimationCurveNode', [L(cnId), S(`${short}\x00\x01AnimCurveNode`), S('')], [
          node('Properties70', [], [P('d|X', 'Number', '', 'A', data[0]), P('d|Y', 'Number', '', 'A', data[1]), P('d|Z', 'Number', '', 'A', data[2])]),
        ]));
        OO(cnId, layerId);
        OP(cnId, target, prop);
        (['X', 'Y', 'Z'] as const).forEach((axis, ai) => {
          const cid = id();
          count('AnimationCurve');
          const vals = new Float32Array(an.frames);
          for (let f = 0; f < an.frames; f++) vals[f] = data[f * 3 + ai];
          objects.push(node('AnimationCurve', [L(cid), S('\x00\x01AnimCurve'), S('')], [
            node('Default', [D(vals[0])]),
            node('KeyVer', [I(4009)]),
            node('KeyTime', [{ t: 'l', v: times }]),
            node('KeyValueFloat', [{ t: 'f', v: vals }]),
            node('KeyAttrFlags', [{ t: 'i', v: [8456] }]),
            node('KeyAttrDataFloat', [{ t: 'f', v: [0, 0, 0, 0] }]),
            node('KeyAttrRefCount', [{ t: 'i', v: [an.frames] }]),
          ]));
          OP(cid, cnId, `d|${axis}`);
        });
      };
      for (const tr of an.tracks) {
        addCurves(tr.rot, boneIds[tr.bone], 'Lcl Rotation', 'R');
        if (tr.pos) addCurves(tr.pos, boneIds[tr.bone], 'Lcl Translation', 'T');
      }
      takes.push(node('Take', [S(an.name)], [
        node('FileName', [S(`${an.name}.tak`)]),
        node('LocalTime', [L(0), L(stop)]),
        node('ReferenceTime', [L(0), L(stop)]),
      ]));
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
      node('P', [S('TimeSpanStart'), S('KTime'), S('Time'), S(''), L(0)]),
      node('P', [S('TimeSpanStop'), S('KTime'), S('Time'), S(''), L(animStop)]),
      P('CustomFrameRate', 'double', 'Number', '', 30),
    ]),
  ]);
  counts.GlobalSettings = 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const defs = node('Definitions', [], [
    node('Version', [I(100)]),
    node('Count', [I(total)]),
    ...Object.entries(counts).map(([k, v]) => node('ObjectType', [S(k)], [node('Count', [I(v)])])),
  ]);
  const docId = id();
  const firstTake = rig?.anims[0]?.name ?? '';
  const tree: FBXNode[] = [
    header,
    node('FileId', [{ t: 'R', v: FILE_ID }]),
    node('CreationTime', [S('1970-01-01 10:00:00:000')]),
    node('Creator', [S(creator)]),
    globalSettings,
    node('Documents', [], [
      node('Count', [I(1)]),
      node('Document', [L(docId), S(opts.sceneName ?? 'Scene'), S('Scene')], [
        node('Properties70', [], [P('SourceObject', 'object', '', ''), P('ActiveAnimStackName', 'KString', '', '', firstTake)]),
        node('RootNode', [L(0)]),
      ]),
    ]),
    node('References'),
    defs,
    node('Objects', [], objects),
    node('Connections', [], conns),
    node('Takes', [], [node('Current', [S(firstTake)]), ...takes]),
  ];
  return encodeFBX(tree);
}

// ---------------------------------------------------------------- 4x4 行列（列優先）
export function mul4(a: number[], b: number[]): number[] {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  return o;
}

export function invert4(m: number[]): number[] {
  const inv = new Array(16);
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return [...IDENTITY];
  det = 1 / det;
  inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return inv;
}
