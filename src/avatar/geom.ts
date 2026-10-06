import * as THREE from 'three';

/** 断面リング: 中心と、断面楕円を張る2本のベクトル（長さ = 半径） */
export interface Ring {
  c: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
}

export interface LoftOptions {
  segments?: number;
  capStart?: boolean;
  capEnd?: boolean;
  /** 断面の形状を歪める関数（角度 → 半径倍率） */
  profile?: (theta: number, ringIndex: number) => number;
}

/**
 * リング列からチューブ状のジオメトリを生成する。
 * 胴体・手足・髪の房・衣装など、ほぼすべての有機的形状の基礎。
 */
export function loft(rings: Ring[], opts: LoftOptions = {}): THREE.BufferGeometry {
  const seg = opts.segments ?? 16;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const tmp = new THREE.Vector3();

  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    for (let j = 0; j <= seg; j++) {
      const t = (j / seg) * Math.PI * 2;
      const k = opts.profile ? opts.profile(t, i) : 1;
      tmp.copy(r.c)
        .addScaledVector(r.u, Math.cos(t) * k)
        .addScaledVector(r.v, Math.sin(t) * k);
      positions.push(tmp.x, tmp.y, tmp.z);
      uvs.push(j / seg, i / Math.max(1, rings.length - 1));
    }
  }
  const row = seg + 1;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * row + j;
      const b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const addCap = (ringIdx: number, flip: boolean) => {
    const r = rings[ringIdx];
    const center = positions.length / 3;
    positions.push(r.c.x, r.c.y, r.c.z);
    uvs.push(0.5, ringIdx === 0 ? 0 : 1);
    for (let j = 0; j < seg; j++) {
      const a = ringIdx * row + j;
      if (flip) indices.push(center, a + 1, a);
      else indices.push(center, a, a + 1);
    }
  };
  if (opts.capStart) addCap(0, false);
  if (opts.capEnd) addCap(rings.length - 1, true);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  fixWinding(g, rings);
  g.computeVertexNormals();
  return g;
}

/**
 * u×v が進行方向と逆向きの場合は面が裏返るので、インデックスを反転させる。
 */
function fixWinding(g: THREE.BufferGeometry, rings: Ring[]) {
  if (rings.length < 2) return;
  const dir = rings[rings.length - 1].c.clone().sub(rings[0].c);
  const n = rings[0].u.clone().cross(rings[0].v);
  if (n.dot(dir) > 0) {
    const idx = g.getIndex()!;
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
}

/** 軸に沿って楕円断面を並べる簡易版 */
export function axisRing(
  c: THREE.Vector3,
  axis: 'x' | 'y' | 'z',
  r1: number,
  r2: number,
): Ring {
  switch (axis) {
    case 'x':
      return { c, u: new THREE.Vector3(0, 0, r2), v: new THREE.Vector3(0, r1, 0) };
    case 'y':
      return { c, u: new THREE.Vector3(r1, 0, 0), v: new THREE.Vector3(0, 0, -r2) };
    case 'z':
      return { c, u: new THREE.Vector3(r1, 0, 0), v: new THREE.Vector3(0, r2, 0) };
  }
}

/**
 * 3D曲線に沿った房（髪束・リボン等）を生成。
 * width / thickness は t(0..1) の関数で先細りを表現できる。
 */
export function strand(
  points: THREE.Vector3[],
  width: (t: number) => number,
  thickness: (t: number) => number,
  opts: { samples?: number; segments?: number; up?: THREE.Vector3; twist?: number } = {},
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const samples = opts.samples ?? 14;
  const up = (opts.up ?? new THREE.Vector3(0, 0, 1)).clone().normalize();
  const rings: Ring[] = [];
  let prevSide: THREE.Vector3 | null = null;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = curve.getPointAt(t);
    const T = curve.getTangentAt(t).normalize();
    let side = new THREE.Vector3().crossVectors(T, up);
    if (side.lengthSq() < 1e-6) side = prevSide ? prevSide.clone() : new THREE.Vector3(1, 0, 0);
    side.normalize();
    if (opts.twist) side.applyAxisAngle(T, opts.twist * t);
    if (prevSide && side.dot(prevSide) < 0) side.negate();
    prevSide = side.clone();
    const normal = new THREE.Vector3().crossVectors(side, T).normalize();
    // 先端は完全に0にせず、わずかに残して法線の破綻を防ぐ
    const w = Math.max(width(t), 0.0004);
    const th = Math.max(thickness(t), 0.0004);
    rings.push({ c: p, u: side.multiplyScalar(w), v: normal.multiplyScalar(th) });
  }
  return loft(rings, { segments: opts.segments ?? 8, capStart: true, capEnd: true });
}

/** 楕円体（変形可能な球） */
export function ellipsoid(
  center: THREE.Vector3,
  rx: number,
  ry: number,
  rz: number,
  wSeg = 24,
  hSeg = 18,
  deform?: (p: THREE.Vector3) => void,
): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, wSeg, hSeg);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.set(v.x * rx, v.y * ry, v.z * rz);
    if (deform) deform(v);
    v.add(center);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** 平面の円盤（目・口などの顔パーツ用）。uv は 0..1 の正方形にマップされる */
export function disc(
  center: THREE.Vector3,
  rx: number,
  ry: number,
  normal: THREE.Vector3,
  seg = 24,
  curvature = 0,
): THREE.BufferGeometry {
  const positions: number[] = [center.x, center.y, center.z];
  const uvs: number[] = [0.5, 0.5];
  const indices: number[] = [];
  const n = normal.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const upv = new THREE.Vector3().crossVectors(n, right).normalize();
  const p = new THREE.Vector3();
  for (let j = 0; j <= seg; j++) {
    const t = (j / seg) * Math.PI * 2;
    const cx = Math.cos(t);
    const cy = Math.sin(t);
    p.copy(center).addScaledVector(right, cx * rx).addScaledVector(upv, cy * ry).addScaledVector(n, -curvature);
    positions.push(p.x, p.y, p.z);
    uvs.push(0.5 + cx * 0.5, 0.5 + cy * 0.5);
  }
  for (let j = 1; j <= seg; j++) indices.push(0, j, j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** ジオメトリを非インデックス化せずに、属性セットを揃える（結合のため） */
export function normalizeAttributes(g: THREE.BufferGeometry, keep: string[] = []): THREE.BufferGeometry {
  let geo = g;
  if (!geo.index) {
    const count = geo.attributes.position.count;
    const idx: number[] = [];
    for (let i = 0; i < count; i++) idx.push(i);
    geo.setIndex(idx);
  }
  if (!geo.attributes.uv) {
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  for (const name of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight', ...keep].includes(name)) geo.deleteAttribute(name);
  }
  geo.morphAttributes = {};
  return geo;
}

/** X=0 平面で鏡映したコピーを作る（左右対称パーツ用） */
export function mirrorX(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  m.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  const idx = m.getIndex();
  if (idx) {
    const arr = idx.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  m.computeVertexNormals();
  return m;
}
