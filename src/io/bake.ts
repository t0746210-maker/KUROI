import * as THREE from 'three';

export interface BakedMaterial {
  name: string;
  /** sRGB 0..1 */
  color: [number, number, number];
  opacity: number;
  roughness: number;
  metalness: number;
  emissive: [number, number, number];
  doubleSide: boolean;
  map: THREE.Texture | null;
  vertexColors: boolean;
}

export interface BakedMesh {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  /** sRGB 0..1, 頂点カラー × マテリアル色 */
  colors: Float32Array;
  hasVertexColors: boolean;
  indices: Uint32Array;
  groups: { start: number; count: number; materialIndex: number }[];
  materials: BakedMaterial[];
}

const _c = new THREE.Color();

export function bakeMaterial(m: THREE.Material): BakedMaterial {
  const anyM = m as any;
  const col: THREE.Color = anyM.color ?? new THREE.Color(1, 1, 1);
  const em: THREE.Color = anyM.emissive ?? new THREE.Color(0, 0, 0);
  const srgb = (c: THREE.Color): [number, number, number] => {
    _c.copy(c).convertLinearToSRGB();
    return [_c.r, _c.g, _c.b];
  };
  return {
    name: m.name || 'Material',
    color: srgb(col),
    opacity: m.transparent ? m.opacity : 1,
    roughness: anyM.roughness ?? (anyM.isMeshToonMaterial ? 0.8 : 0.6),
    metalness: anyM.metalness ?? 0,
    emissive: srgb(em),
    doubleSide: m.side === THREE.DoubleSide,
    map: anyM.map ?? null,
    vertexColors: !!anyM.vertexColors,
  };
}

/** 描画対象メッシュかどうか（アウトライン・ヘルパー・非表示を除外） */
export function isExportableMesh(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || !m.geometry?.attributes.position) return false;
  if (o.userData.outlineHull || o.userData.helper) return false;
  if ((o as any).isLine || (o as any).isPoints) return false;
  let p: THREE.Object3D | null = o;
  while (p) {
    if (!p.visible) return false;
    p = p.parent;
  }
  return true;
}

/**
 * シーンの現在の見た目（ポーズ・表情・スキニング込み）をワールド座標の静的メッシュに焼き込む。
 * FBX / OBJ / STL / PLY / DAE / X3D / 3MF / USDZ の書き出しで共通利用。
 */
export function bakeScene(root: THREE.Object3D): BakedMesh[] {
  root.updateMatrixWorld(true);
  const out: BakedMesh[] = [];
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (isExportableMesh(o)) meshes.push(o);
  });
  const usedNames = new Set<string>();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    const positions = new Float32Array(n * 3);
    const deformed = (mesh as THREE.SkinnedMesh).isSkinnedMesh || !!g.morphAttributes.position?.length;
    for (let i = 0; i < n; i++) {
      mesh.getVertexPosition(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
    }
    let indices: Uint32Array;
    if (g.index) indices = Uint32Array.from(g.index.array as ArrayLike<number>);
    else indices = Uint32Array.from({ length: n }, (_, i) => i);
    if (mesh.matrixWorld.determinant() < 0) {
      for (let i = 0; i < indices.length; i += 3) {
        const t = indices[i + 1];
        indices[i + 1] = indices[i + 2];
        indices[i + 2] = t;
      }
    }
    let normals: Float32Array;
    if (!deformed && g.attributes.normal) {
      normals = new Float32Array(n * 3);
      nm.getNormalMatrix(mesh.matrixWorld);
      const na = g.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
        normals.set([v.x, v.y, v.z], i * 3);
      }
    } else {
      const tmp = new THREE.BufferGeometry();
      tmp.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      tmp.setIndex(new THREE.BufferAttribute(indices, 1));
      tmp.computeVertexNormals();
      normals = (tmp.attributes.normal as THREE.BufferAttribute).array as Float32Array;
    }
    const uvAttr = g.attributes.uv as THREE.BufferAttribute | undefined;
    const uvs = uvAttr ? Float32Array.from({ length: n * 2 }, (_, i) => uvAttr.getComponent(Math.floor(i / 2), i % 2)) : null;

    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(bakeMaterial);
    let groups = g.groups.length
      ? g.groups.map((gr) => ({ start: gr.start, count: Math.min(gr.count, indices.length - gr.start), materialIndex: Array.isArray(mesh.material) ? gr.materialIndex ?? 0 : 0 }))
      : [{ start: 0, count: indices.length, materialIndex: 0 }];
    groups = groups.filter((gr) => gr.count > 0 && gr.materialIndex < mats.length);
    // 連続した同一マテリアルのグループを結合（BoxGeometry の 6 面など）
    groups = groups.reduce<typeof groups>((acc, gr) => {
      const last = acc[acc.length - 1];
      if (last && last.materialIndex === gr.materialIndex && last.start + last.count === gr.start) last.count += gr.count;
      else acc.push({ ...gr });
      return acc;
    }, []);

    // 頂点カラー（マテリアル色を乗算して sRGB に）
    const colors = new Float32Array(n * 3);
    const vc = g.attributes.color as THREE.BufferAttribute | undefined;
    let hasVC = false;
    const vertMat = new Int32Array(n).fill(-1);
    for (const gr of groups) for (let k = gr.start; k < gr.start + gr.count; k++) vertMat[indices[k]] = gr.materialIndex;
    for (let i = 0; i < n; i++) {
      const bm = mats[Math.max(0, vertMat[i])] ?? mats[0];
      let r = bm.color[0], gg = bm.color[1], b = bm.color[2];
      if (vc && bm.vertexColors) {
        _c.setRGB(vc.getX(i), vc.getY(i), vc.getZ(i)).convertLinearToSRGB();
        r *= _c.r;
        gg *= _c.g;
        b *= _c.b;
        hasVC = true;
      }
      colors[i * 3] = r;
      colors[i * 3 + 1] = gg;
      colors[i * 3 + 2] = b;
    }
    // 頂点カラーのみで色を持つマテリアルは平均色を代表色にする（頂点カラー非対応形式向け）
    if (vc) {
      mats.forEach((bm, mi) => {
        if (!bm.vertexColors) return;
        let sr = 0, sg = 0, sb = 0, cnt = 0;
        for (let i = 0; i < n; i++)
          if (vertMat[i] === mi) {
            sr += colors[i * 3];
            sg += colors[i * 3 + 1];
            sb += colors[i * 3 + 2];
            cnt++;
          }
        if (cnt) bm.color = [sr / cnt, sg / cnt, sb / cnt];
      });
    }

    let name = (mesh.name || 'Mesh').replace(/[^\w\-.぀-ヿ一-龯]/g, '_');
    let k = 1;
    const base = name;
    while (usedNames.has(name)) name = `${base}_${k++}`;
    usedNames.add(name);
    out.push({ name, positions, normals, uvs, colors, hasVertexColors: hasVC, indices, groups, materials: mats });
  }
  return out;
}

/** 焼き込み結果を three.js オブジェクトに戻す（three 標準エクスポーター用） */
export function bakedToGroup(baked: BakedMesh[], opts: { vertexColors?: boolean } = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Export';
  for (const b of baked) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3));
    if (b.uvs) g.setAttribute('uv', new THREE.BufferAttribute(b.uvs, 2));
    if (opts.vertexColors) {
      // three の頂点カラーは linear
      const lin = new Float32Array(b.colors.length);
      for (let i = 0; i < lin.length; i += 3) {
        _c.setRGB(b.colors[i], b.colors[i + 1], b.colors[i + 2]).convertSRGBToLinear();
        lin[i] = _c.r;
        lin[i + 1] = _c.g;
        lin[i + 2] = _c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(lin, 3));
    }
    g.setIndex(new THREE.BufferAttribute(b.indices, 1));
    for (const gr of b.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    const mats = b.materials.map((bm) => {
      const m = new THREE.MeshStandardMaterial({
        name: bm.name,
        color: new THREE.Color().setRGB(bm.color[0], bm.color[1], bm.color[2], THREE.SRGBColorSpace),
        roughness: bm.roughness,
        metalness: bm.metalness,
        emissive: new THREE.Color().setRGB(bm.emissive[0], bm.emissive[1], bm.emissive[2], THREE.SRGBColorSpace),
        map: bm.map,
        transparent: bm.opacity < 1,
        opacity: bm.opacity,
        side: bm.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        vertexColors: !!opts.vertexColors,
      });
      if (opts.vertexColors) m.color.set(0xffffff);
      return m;
    });
    const mesh = new THREE.Mesh(g, mats.length === 1 ? mats[0] : mats);
    mesh.name = b.name;
    group.add(mesh);
  }
  return group;
}

/** 焼き込みメッシュの総計 */
export function bakedStats(baked: BakedMesh[]) {
  let verts = 0;
  let tris = 0;
  for (const b of baked) {
    verts += b.positions.length / 3;
    tris += b.indices.length / 3;
  }
  return { verts, tris, meshes: baked.length };
}

/** テクスチャを PNG バイト列へ（ブラウザ環境のみ） */
export async function textureToPNG(tex: THREE.Texture): Promise<Uint8Array | null> {
  const img = tex.image as any;
  if (!img || typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const g = cv.getContext('2d');
  if (!g) return null;
  if (tex.flipY === false) {
    // glTF 流儀（flipY=false）のテクスチャは、OBJ 等の慣例（左下原点）に合わせて上下反転
    g.translate(0, cv.height);
    g.scale(1, -1);
  }
  g.drawImage(img, 0, 0);
  const blob: Blob | null = await new Promise((r) => cv.toBlob(r, 'image/png'));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}
