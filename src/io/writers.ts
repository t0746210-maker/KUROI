import * as THREE from 'three';
import type { BakedMesh } from './bake';
import { createZip, type ZipEntry } from './zip';
import { fmt, hex2, safeId, xmlEscape, yUpToZUp } from './util';

// ======================================================================== Collada (.dae)

export function writeCollada(meshes: BakedMesh[], opts: { author?: string } = {}): string {
  const now = new Date().toISOString();
  const effects: string[] = [];
  const materials: string[] = [];
  const geoms: string[] = [];
  const nodes: string[] = [];
  const arr = (a: ArrayLike<number>) => Array.from(a, (v) => fmt(v)).join(' ');
  meshes.forEach((m, mi) => {
    const gid = `geom${mi}`;
    const matIds = m.materials.map((mat, k) => {
      const id = `mat${mi}_${k}`;
      const c = mat.color;
      effects.push(
        `<effect id="${id}-fx"><profile_COMMON><technique sid="common"><phong>` +
          `<emission><color>${mat.emissive.map((v) => fmt(v)).join(' ')} 1</color></emission>` +
          `<diffuse><color sid="diffuse">${fmt(c[0])} ${fmt(c[1])} ${fmt(c[2])} 1</color></diffuse>` +
          `<specular><color>0.2 0.2 0.2 1</color></specular>` +
          `<shininess><float>${fmt(Math.max(2, (1 - mat.roughness) * 64))}</float></shininess>` +
          `<transparency><float>${fmt(mat.opacity)}</float></transparency>` +
          `</phong></technique></profile_COMMON></effect>`,
      );
      materials.push(`<material id="${id}" name="${xmlEscape(mat.name)}"><instance_effect url="#${id}-fx"/></material>`);
      return id;
    });
    const src = (sid: string, data: ArrayLike<number>, stride: number, params: string[]) =>
      `<source id="${gid}-${sid}"><float_array id="${gid}-${sid}-array" count="${data.length}">${arr(data)}</float_array>` +
      `<technique_common><accessor source="#${gid}-${sid}-array" count="${data.length / stride}" stride="${stride}">` +
      params.map((p) => `<param name="${p}" type="float"/>`).join('') +
      `</accessor></technique_common></source>`;
    let body = src('positions', m.positions, 3, ['X', 'Y', 'Z']) + src('normals', m.normals, 3, ['X', 'Y', 'Z']);
    if (m.uvs) body += src('uvs', m.uvs, 2, ['S', 'T']);
    if (m.hasVertexColors) body += src('colors', m.colors, 3, ['R', 'G', 'B']);
    body += `<vertices id="${gid}-vertices"><input semantic="POSITION" source="#${gid}-positions"/></vertices>`;
    for (const g of m.groups) {
      const idx = m.indices.subarray(g.start, g.start + g.count);
      let inputs = `<input semantic="VERTEX" source="#${gid}-vertices" offset="0"/><input semantic="NORMAL" source="#${gid}-normals" offset="0"/>`;
      if (m.uvs) inputs += `<input semantic="TEXCOORD" source="#${gid}-uvs" offset="0" set="0"/>`;
      if (m.hasVertexColors) inputs += `<input semantic="COLOR" source="#${gid}-colors" offset="0" set="0"/>`;
      body += `<triangles material="m${g.materialIndex}" count="${idx.length / 3}">${inputs}<p>${Array.from(idx).join(' ')}</p></triangles>`;
    }
    geoms.push(`<geometry id="${gid}" name="${xmlEscape(m.name)}"><mesh>${body}</mesh></geometry>`);
    const binds = m.materials.map((_, k) => `<instance_material symbol="m${k}" target="#${matIds[k]}"/>`).join('');
    nodes.push(
      `<node id="node${mi}" name="${xmlEscape(m.name)}" type="NODE"><instance_geometry url="#${gid}" name="${xmlEscape(m.name)}">` +
        `<bind_material><technique_common>${binds}</technique_common></bind_material></instance_geometry></node>`,
    );
  });
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">\n` +
    `<asset><contributor><author>${xmlEscape(opts.author ?? '')}</author><authoring_tool>KUROI Studio</authoring_tool></contributor>` +
    `<created>${now}</created><modified>${now}</modified><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset>\n` +
    `<library_effects>${effects.join('\n')}</library_effects>\n` +
    `<library_materials>${materials.join('\n')}</library_materials>\n` +
    `<library_geometries>${geoms.join('\n')}</library_geometries>\n` +
    `<library_visual_scenes><visual_scene id="Scene" name="Scene">${nodes.join('\n')}</visual_scene></library_visual_scenes>\n` +
    `<scene><instance_visual_scene url="#Scene"/></scene>\n</COLLADA>\n`
  );
}

// ======================================================================== X3D

export function writeX3D(meshes: BakedMesh[]): string {
  const shapes: string[] = [];
  meshes.forEach((m, mi) => {
    const coordDef = `C${mi}_${safeId(m.name)}`;
    m.groups.forEach((g, gi) => {
      const mat = m.materials[g.materialIndex];
      const idx = Array.from(m.indices.subarray(g.start, g.start + g.count)).join(' ');
      const first = gi === 0;
      const coord = first
        ? `<Coordinate DEF="${coordDef}" point="${Array.from(m.positions, (v) => fmt(v)).join(' ')}"/>` +
          `<Normal DEF="${coordDef}_N" vector="${Array.from(m.normals, (v) => fmt(v, 4)).join(' ')}"/>` +
          (m.uvs ? `<TextureCoordinate DEF="${coordDef}_T" point="${Array.from(m.uvs, (v) => fmt(v, 5)).join(' ')}"/>` : '') +
          (m.hasVertexColors ? `<Color DEF="${coordDef}_C" color="${Array.from(m.colors, (v) => fmt(v, 4)).join(' ')}"/>` : '')
        : `<Coordinate USE="${coordDef}"/><Normal USE="${coordDef}_N"/>` +
          (m.uvs ? `<TextureCoordinate USE="${coordDef}_T"/>` : '') +
          (m.hasVertexColors ? `<Color USE="${coordDef}_C"/>` : '');
      shapes.push(
        `<Shape DEF="${safeId(m.name)}_${gi}"><Appearance><Material DEF="${safeId(mat.name)}_${mi}_${gi}" diffuseColor="${mat.color.map((v) => fmt(v, 4)).join(' ')}" ` +
          `emissiveColor="${mat.emissive.map((v) => fmt(v, 4)).join(' ')}" shininess="${fmt(1 - mat.roughness, 3)}" transparency="${fmt(1 - mat.opacity, 3)}"/></Appearance>` +
          `<IndexedTriangleSet solid="${mat.doubleSide ? 'false' : 'true'}" normalPerVertex="true" colorPerVertex="true" index="${idx}">${coord}</IndexedTriangleSet></Shape>`,
      );
    });
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 3.3//EN" "http://www.web3d.org/specifications/x3d-3.3.dtd">\n` +
    `<X3D profile="Interchange" version="3.3" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `<head><meta name="generator" content="KUROI Studio"/></head>\n<Scene>\n${shapes.join('\n')}\n</Scene>\n</X3D>\n`
  );
}

// ======================================================================== 3MF

export function write3MF(meshes: BakedMesh[], opts: { title?: string } = {}): Uint8Array {
  const scale = 1000; // m → mm
  let minZ = Infinity;
  for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) minZ = Math.min(minZ, m.positions[i + 1] * scale);
  if (!isFinite(minZ)) minZ = 0;
  const bases: string[] = [];
  const objs: string[] = [];
  const items: string[] = [];
  let nextId = 2;
  for (const m of meshes) {
    const baseIndex = bases.length;
    for (const mat of m.materials) bases.push(`<base name="${xmlEscape(mat.name)}" displaycolor="#${hex2(mat.color[0])}${hex2(mat.color[1])}${hex2(mat.color[2])}${hex2(mat.opacity)}"/>`);
    const verts: string[] = [];
    for (let i = 0; i < m.positions.length; i += 3) {
      const [x, y, z] = yUpToZUp(m.positions[i], m.positions[i + 1], m.positions[i + 2], scale);
      verts.push(`<vertex x="${fmt(x, 4)}" y="${fmt(y, 4)}" z="${fmt(z - minZ, 4)}"/>`);
    }
    const tris: string[] = [];
    for (const g of m.groups) {
      for (let k = g.start; k < g.start + g.count; k += 3) {
        tris.push(`<triangle v1="${m.indices[k]}" v2="${m.indices[k + 1]}" v3="${m.indices[k + 2]}" pid="1" p1="${baseIndex + g.materialIndex}"/>`);
      }
    }
    const id = nextId++;
    objs.push(`<object id="${id}" name="${xmlEscape(m.name)}" type="model" pid="1" pindex="${baseIndex}"><mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object>`);
    items.push(`<item objectid="${id}"/>`);
  }
  const model =
    `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="ja-JP" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<metadata name="Title">${xmlEscape(opts.title ?? 'KUROI Model')}</metadata><metadata name="Application">KUROI Studio</metadata>` +
    `<resources><basematerials id="1">${bases.join('')}</basematerials>${objs.join('')}</resources><build>${items.join('')}</build></model>`;
  const files: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data:
        `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data:
        `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
    },
    { name: '3D/3dmodel.model', data: model },
  ];
  return createZip(files);
}

// ======================================================================== OBJ + MTL

export interface OBJResult {
  obj: string;
  mtl: string;
  textures: { name: string; texture: THREE.Texture }[];
}

export function writeOBJ(meshes: BakedMesh[], baseName: string, opts: { vertexColors?: boolean } = {}): OBJResult {
  const lines: string[] = ['# KUROI Studio OBJ Export', `mtllib ${baseName}.mtl`];
  const mtl: string[] = ['# KUROI Studio MTL Export'];
  const textures: OBJResult['textures'] = [];
  const texNames = new Map<THREE.Texture, string>();
  const matNames = new Set<string>();
  let vOff = 1;
  meshes.forEach((m, mi) => {
    lines.push(`o ${m.name}`);
    const n = m.positions.length / 3;
    for (let i = 0; i < n; i++) {
      let l = `v ${fmt(m.positions[i * 3])} ${fmt(m.positions[i * 3 + 1])} ${fmt(m.positions[i * 3 + 2])}`;
      if (opts.vertexColors) l += ` ${fmt(m.colors[i * 3], 4)} ${fmt(m.colors[i * 3 + 1], 4)} ${fmt(m.colors[i * 3 + 2], 4)}`;
      lines.push(l);
    }
    if (m.uvs) for (let i = 0; i < n; i++) lines.push(`vt ${fmt(m.uvs[i * 2])} ${fmt(m.uvs[i * 2 + 1])}`);
    for (let i = 0; i < n; i++) lines.push(`vn ${fmt(m.normals[i * 3], 4)} ${fmt(m.normals[i * 3 + 1], 4)} ${fmt(m.normals[i * 3 + 2], 4)}`);
    const localMat = m.materials.map((mat, k) => {
      let name = safeId(`${m.name}_${mat.name}`);
      if (matNames.has(name)) name = `${name}_${mi}_${k}`;
      matNames.add(name);
      mtl.push('', `newmtl ${name}`);
      mtl.push(`Ka 0 0 0`, `Kd ${mat.color.map((v) => fmt(v, 4)).join(' ')}`, `Ks 0.2 0.2 0.2`, `Ke ${mat.emissive.map((v) => fmt(v, 4)).join(' ')}`);
      mtl.push(`Ns ${fmt(Math.max(2, (1 - mat.roughness) * 200), 1)}`, `d ${fmt(mat.opacity, 3)}`, `illum 2`);
      mtl.push(`Pr ${fmt(mat.roughness, 3)}`, `Pm ${fmt(mat.metalness, 3)}`);
      if (mat.map && mat.map.image) {
        let tn = texNames.get(mat.map);
        if (!tn) {
          tn = `textures/${safeId(mat.map.name || mat.name)}_${texNames.size}.png`;
          texNames.set(mat.map, tn);
          textures.push({ name: tn, texture: mat.map });
        }
        mtl.push(`map_Kd ${tn}`);
      }
      return name;
    });
    for (const g of m.groups) {
      lines.push(`usemtl ${localMat[g.materialIndex]}`);
      for (let k = g.start; k < g.start + g.count; k += 3) {
        const f = [m.indices[k], m.indices[k + 1], m.indices[k + 2]].map((i) => {
          const v = i + vOff;
          return m.uvs ? `${v}/${v}/${v}` : `${v}//${v}`;
        });
        lines.push(`f ${f.join(' ')}`);
      }
    }
    vOff += n;
  });
  return { obj: lines.join('\n') + '\n', mtl: mtl.join('\n') + '\n', textures };
}

// ======================================================================== STL

export function writeSTL(meshes: BakedMesh[], opts: { binary: boolean; printReady: boolean }): Uint8Array | string {
  const scale = opts.printReady ? 1000 : 1;
  let minZ = Infinity;
  const tx = (x: number, y: number, z: number): [number, number, number] => (opts.printReady ? yUpToZUp(x, y, z, scale) : [x, y, z]);
  if (opts.printReady) for (const m of meshes) for (let i = 0; i < m.positions.length; i += 3) minZ = Math.min(minZ, m.positions[i + 1] * scale);
  const shift = opts.printReady && isFinite(minZ) ? minZ : 0;
  const tris: number[][] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const m of meshes) {
    for (let k = 0; k < m.indices.length; k += 3) {
      const p = [m.indices[k], m.indices[k + 1], m.indices[k + 2]].map((i) => {
        const v = tx(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
        if (opts.printReady) v[2] -= shift;
        return v;
      });
      a.fromArray(p[0]);
      b.fromArray(p[1]);
      c.fromArray(p[2]);
      const nrm = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
      tris.push([nrm.x, nrm.y, nrm.z, ...p[0], ...p[1], ...p[2]]);
    }
  }
  if (opts.binary) {
    const out = new Uint8Array(84 + tris.length * 50);
    const dv = new DataView(out.buffer);
    const header = new TextEncoder().encode('KUROI Studio binary STL');
    out.set(header.subarray(0, 80), 0);
    dv.setUint32(80, tris.length, true);
    let off = 84;
    for (const t of tris) {
      for (let k = 0; k < 12; k++) dv.setFloat32(off + k * 4, t[k], true);
      dv.setUint16(off + 48, 0, true);
      off += 50;
    }
    return out;
  }
  const L = ['solid kuroi'];
  for (const t of tris) {
    L.push(` facet normal ${fmt(t[0])} ${fmt(t[1])} ${fmt(t[2])}`, '  outer loop');
    for (let v = 0; v < 3; v++) L.push(`   vertex ${fmt(t[3 + v * 3])} ${fmt(t[4 + v * 3])} ${fmt(t[5 + v * 3])}`);
    L.push('  endloop', ' endfacet');
  }
  L.push('endsolid kuroi');
  return L.join('\n') + '\n';
}

// ======================================================================== PLY

export function writePLY(meshes: BakedMesh[], opts: { binary: boolean }): Uint8Array | string {
  let vtotal = 0;
  let ftotal = 0;
  for (const m of meshes) {
    vtotal += m.positions.length / 3;
    ftotal += m.indices.length / 3;
  }
  const hasUV = meshes.every((m) => m.uvs);
  const header = [
    'ply',
    `format ${opts.binary ? 'binary_little_endian' : 'ascii'} 1.0`,
    'comment KUROI Studio',
    `element vertex ${vtotal}`,
    'property float x',
    'property float y',
    'property float z',
    'property float nx',
    'property float ny',
    'property float nz',
    ...(hasUV ? ['property float s', 'property float t'] : []),
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    `element face ${ftotal}`,
    'property list uchar int vertex_indices',
    'end_header',
  ].join('\n') + '\n';
  const c8 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  if (!opts.binary) {
    const L: string[] = [header.trimEnd()];
    for (const m of meshes) {
      const n = m.positions.length / 3;
      for (let i = 0; i < n; i++) {
        const parts = [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2], m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]].map((v) => fmt(v));
        if (hasUV) parts.push(fmt(m.uvs![i * 2]), fmt(m.uvs![i * 2 + 1]));
        parts.push(String(c8(m.colors[i * 3])), String(c8(m.colors[i * 3 + 1])), String(c8(m.colors[i * 3 + 2])));
        L.push(parts.join(' '));
      }
    }
    let off = 0;
    for (const m of meshes) {
      for (let k = 0; k < m.indices.length; k += 3) L.push(`3 ${m.indices[k] + off} ${m.indices[k + 1] + off} ${m.indices[k + 2] + off}`);
      off += m.positions.length / 3;
    }
    return L.join('\n') + '\n';
  }
  const hb = new TextEncoder().encode(header);
  const vsize = 24 + (hasUV ? 8 : 0) + 3;
  const out = new Uint8Array(hb.length + vtotal * vsize + ftotal * 13);
  out.set(hb, 0);
  const dv = new DataView(out.buffer);
  let o = hb.length;
  for (const m of meshes) {
    const n = m.positions.length / 3;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, m.positions[i * 3 + k], true);
      for (let k = 0; k < 3; k++) dv.setFloat32(o + 12 + k * 4, m.normals[i * 3 + k], true);
      o += 24;
      if (hasUV) {
        dv.setFloat32(o, m.uvs![i * 2], true);
        dv.setFloat32(o + 4, m.uvs![i * 2 + 1], true);
        o += 8;
      }
      out[o] = c8(m.colors[i * 3]);
      out[o + 1] = c8(m.colors[i * 3 + 1]);
      out[o + 2] = c8(m.colors[i * 3 + 2]);
      o += 3;
    }
  }
  let off = 0;
  for (const m of meshes) {
    for (let k = 0; k < m.indices.length; k += 3) {
      out[o] = 3;
      dv.setInt32(o + 1, m.indices[k] + off, true);
      dv.setInt32(o + 5, m.indices[k + 1] + off, true);
      dv.setInt32(o + 9, m.indices[k + 2] + off, true);
      o += 13;
    }
    off += m.positions.length / 3;
  }
  return out;
}

// ======================================================================== BVH

export function writeBVH(
  root: THREE.Bone,
  include: (b: THREE.Bone) => boolean,
  sample: (t: number) => void,
  duration: number,
  fps = 30,
): string {
  const scale = 100; // m → cm
  const joints: THREE.Bone[] = [];
  const lines: string[] = ['HIERARCHY'];
  const write = (b: THREE.Bone, depth: number, isRoot: boolean) => {
    const ind = '  '.repeat(depth);
    joints.push(b);
    lines.push(`${ind}${isRoot ? 'ROOT' : 'JOINT'} ${b.name}`, `${ind}{`);
    const off = b.position;
    lines.push(`${ind}  OFFSET ${fmt(off.x * scale, 4)} ${fmt(off.y * scale, 4)} ${fmt(off.z * scale, 4)}`);
    lines.push(`${ind}  CHANNELS ${isRoot ? '6 Xposition Yposition Zposition' : '3'} Zrotation Xrotation Yrotation`);
    const kids = b.children.filter((c): c is THREE.Bone => (c as THREE.Bone).isBone && include(c as THREE.Bone));
    if (!kids.length) {
      const tip = b.position.clone().normalize().multiplyScalar(Math.max(0.03, b.position.length() * 0.5));
      lines.push(`${ind}  End Site`, `${ind}  {`, `${ind}    OFFSET ${fmt(tip.x * scale, 4)} ${fmt(tip.y * scale, 4)} ${fmt(tip.z * scale, 4)}`, `${ind}  }`);
    }
    for (const k of kids) write(k, depth + 1, false);
    lines.push(`${ind}}`);
  };
  write(root, 0, true);
  const frames = Math.max(1, Math.round(duration * fps));
  lines.push('MOTION', `Frames: ${frames}`, `Frame Time: ${fmt(1 / fps, 7)}`);
  const e = new THREE.Euler();
  for (let f = 0; f < frames; f++) {
    sample(f / fps);
    const vals: string[] = [];
    joints.forEach((j, i) => {
      if (i === 0) vals.push(fmt(j.position.x * scale, 4), fmt(j.position.y * scale, 4), fmt(j.position.z * scale, 4));
      e.setFromQuaternion(j.quaternion, 'ZXY');
      vals.push(fmt(THREE.MathUtils.radToDeg(e.z), 4), fmt(THREE.MathUtils.radToDeg(e.x), 4), fmt(THREE.MathUtils.radToDeg(e.y), 4));
    });
    lines.push(vals.join(' '));
  }
  return lines.join('\n') + '\n';
}
