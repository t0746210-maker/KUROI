import './setup';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { crc32, createZip, readZip } from '../src/io/zip';
import { parseGLB, packGLB, appendImage } from '../src/io/glb';
import { bakeScene } from '../src/io/bake';
import { buildFBX } from '../src/io/fbx';
import { write3MF, writeBVH, writeCollada, writeOBJ, writePLY, writeSTL, writeX3D } from '../src/io/writers';
import { buildAvatar, EXPRESSIONS, HUMAN_BONES } from '../src/avatar/AvatarBuilder';
import { defaultParams, presets } from '../src/avatar/params';
import { exportVRM, defaultMeta } from '../src/io/vrm';

function sampleScene() {
  const root = new THREE.Group();
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial({ color: 0xff0000, name: 'Red' }));
  a.name = 'Box';
  a.position.set(1, 0, 0);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshToonMaterial({ color: 0x00ff00, name: 'Green' }));
  b.name = 'Ball';
  root.add(a, b);
  return root;
}

describe('zip', () => {
  it('crc32 は標準値と一致', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('書き込み → 読み込みで内容が一致', () => {
    const zip = createZip([
      { name: 'a.txt', data: 'hello' },
      { name: 'dir/日本語.bin', data: new Uint8Array([1, 2, 3]) },
    ]);
    const files = readZip(zip);
    expect(new TextDecoder().decode(files['a.txt'])).toBe('hello');
    expect(Array.from(files['dir/日本語.bin'])).toEqual([1, 2, 3]);
  });
});

describe('glb', () => {
  it('pack/parse のラウンドトリップと画像追加', () => {
    const parts = { json: { asset: { version: '2.0' }, buffers: [{ byteLength: 3 }] }, bin: new Uint8Array([9, 8, 7]) };
    const idx = appendImage(parts, new Uint8Array([1, 2, 3, 4, 5]), 'thumb');
    expect(idx).toBe(0);
    const glb = packGLB(parts.json, parts.bin);
    expect(glb.byteLength % 4).toBe(0);
    const back = parseGLB(glb);
    expect(back.json.images[0].name).toBe('thumb');
    const bv = back.json.bufferViews[0];
    expect(Array.from(back.bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('bake', () => {
  it('ワールド変換と頂点カラーを焼き込む', () => {
    const baked = bakeScene(sampleScene());
    expect(baked).toHaveLength(2);
    const box = baked.find((b) => b.name === 'Box')!;
    let minX = Infinity;
    for (let i = 0; i < box.positions.length; i += 3) minX = Math.min(minX, box.positions[i]);
    expect(minX).toBeCloseTo(0.5);
    expect(box.materials[0].color[0]).toBeCloseTo(1);
    expect(box.colors[0]).toBeCloseTo(1);
  });
});

describe('FBX', () => {
  it('バイナリ FBX を three の FBXLoader で読み戻せる', () => {
    const baked = bakeScene(sampleScene());
    const fbx = buildFBX(baked);
    expect(new TextDecoder().decode(fbx.subarray(0, 18))).toBe('Kaydara FBX Binary');
    const obj = new FBXLoader().parse(fbx.buffer.slice(fbx.byteOffset, fbx.byteOffset + fbx.byteLength) as ArrayBuffer, '');
    const meshes: THREE.Mesh[] = [];
    obj.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o as THREE.Mesh));
    expect(meshes.map((m) => m.name).sort()).toEqual(['Ball', 'Box']);
    const box = meshes.find((m) => m.name === 'Box')!;
    expect(box.geometry.attributes.position.count).toBe(baked.find((b) => b.name === 'Box')!.indices.length);
    const mat = box.material as THREE.MeshPhongMaterial;
    expect(mat.color.r).toBeGreaterThan(0.9);
  });
});

describe('テキスト/バイナリ形式', () => {
  const baked = bakeScene(sampleScene());
  const tris = baked.reduce((a, b) => a + b.indices.length / 3, 0);
  it('STL バイナリの三角形数', () => {
    const stl = writeSTL(baked, { binary: true, printReady: true }) as Uint8Array;
    expect(new DataView(stl.buffer).getUint32(80, true)).toBe(tris);
    expect(stl.length).toBe(84 + tris * 50);
  });
  it('STL ASCII', () => {
    const s = writeSTL(baked, { binary: false, printReady: false }) as string;
    expect(s.match(/facet normal/g)!.length).toBe(tris);
  });
  it('PLY ヘッダ', () => {
    const s = writePLY(baked, { binary: false }) as string;
    expect(s).toContain(`element face ${tris}`);
    const bin = writePLY(baked, { binary: true }) as Uint8Array;
    expect(new TextDecoder().decode(bin.subarray(0, 40))).toContain('binary_little_endian');
  });
  it('OBJ / MTL', () => {
    const r = writeOBJ(baked, 'test');
    expect(r.obj.match(/^f /gm)!.length).toBe(tris);
    expect(r.mtl).toContain('newmtl Box_Red');
    expect(r.mtl).toContain('Kd 1 0 0');
  });
  it('Collada / X3D', () => {
    const dae = writeCollada(baked);
    expect(dae).toContain('<COLLADA');
    expect(dae.match(/<triangles /g)!.length).toBe(2);
    const x3d = writeX3D(baked);
    expect(x3d.match(/<Shape /g)!.length).toBe(2);
  });
  it('3MF は ZIP 内にモデルを含む', () => {
    const files = readZip(write3MF(baked));
    const model = new TextDecoder().decode(files['3D/3dmodel.model']);
    expect(Object.keys(files)).toContain('[Content_Types].xml');
    expect(model.match(/<triangle /g)!.length).toBe(tris);
    expect(model).toContain('displaycolor="#FF0000FF"');
  });
});

describe('アバター生成', () => {
  for (const [name, pr] of Object.entries(presets)) {
    it(`プリセット「${name}」が正しいリグを持つ`, () => {
      const d = buildAvatar({ ...defaultParams, ...pr });
      for (const b of HUMAN_BONES) expect(d.bones[b], b).toBeDefined();
      const dict = d.faceMesh.morphTargetDictionary!;
      for (const e of EXPRESSIONS) expect(dict[e], e).toBeDefined();
      for (const m of d.meshes) {
        const w = m.geometry.attributes.skinWeight as THREE.BufferAttribute;
        const p = m.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < w.count; i += 7) {
          const s = w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i);
          expect(s).toBeCloseTo(1, 4);
          expect(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i))).toBe(true);
        }
      }
      // 身長がパラメータどおり
      const box = new THREE.Box3().setFromObject(d.root);
      expect(box.max.y).toBeGreaterThan(d.height * 0.97);
      expect(box.max.y).toBeLessThan(d.height * 1.25);
    });
  }

  it('ポーズで焼き込むと頂点が動く', () => {
    const d = buildAvatar(defaultParams);
    const before = bakeScene(d.root).find((b) => b.name === 'Body')!.positions.slice();
    d.bones.leftUpperArm.rotation.z = -1.2;
    const after = bakeScene(d.root).find((b) => b.name === 'Body')!.positions;
    let moved = 0;
    for (let i = 0; i < before.length; i++) if (Math.abs(before[i] - after[i]) > 0.01) moved++;
    expect(moved).toBeGreaterThan(100);
  });
});

describe('VRM', () => {
  it('VRM 1.0 拡張を書き出す', async () => {
    const ab = await exportVRM(defaultParams, '1.0', defaultMeta(defaultParams), new Uint8Array([137, 80, 78, 71]));
    const { json } = parseGLB(ab);
    expect(json.extensionsUsed).toEqual(expect.arrayContaining(['VRMC_vrm', 'VRMC_springBone', 'VRMC_materials_mtoon']));
    const vrm = json.extensions.VRMC_vrm;
    expect(vrm.specVersion).toBe('1.0');
    for (const b of ['hips', 'spine', 'head', 'leftUpperArm', 'rightFoot']) {
      const n = vrm.humanoid.humanBones[b].node;
      expect(json.nodes[n].name).toBe(b);
    }
    expect(Object.keys(vrm.expressions.preset).sort()).toEqual([...EXPRESSIONS].sort());
    expect(json.images[vrm.meta.thumbnailImage].mimeType).toBe('image/png');
    expect(json.extensions.VRMC_springBone.springs.length).toBeGreaterThan(0);
    expect(json.materials.every((m: any) => m.extensions?.VRMC_materials_mtoon)).toBe(true);
  });

  it('VRM 0.x は -Z 正面に回転し、BlendShape を持つ', async () => {
    const ab = await exportVRM({ ...defaultParams, hairStyle: 'ponytail' }, '0.x', defaultMeta(defaultParams));
    const { json } = parseGLB(ab);
    const v = json.extensions.VRM;
    expect(v.specVersion).toBe('0.0');
    expect(v.humanoid.humanBones.length).toBe(HUMAN_BONES.length);
    expect(v.blendShapeMaster.blendShapeGroups.map((g: any) => g.presetName)).toEqual(expect.arrayContaining(['neutral', 'joy', 'a', 'blink', 'blink_l']));
    expect(v.secondaryAnimation.boneGroups.length).toBe(1);
    // 左手 (leftHand) は -X 側にある（180°回転済み）
    let x = 0;
    let n = json.nodes.findIndex((nd: any) => nd.name === 'leftHand');
    const parentOf = (i: number) => json.nodes.findIndex((nd: any) => nd.children?.includes(i));
    while (n >= 0) {
      x += json.nodes[n].translation?.[0] ?? 0;
      n = parentOf(n);
    }
    expect(x).toBeLessThan(-0.3);
  });
});

describe('BVH', () => {
  it('階層とフレームを書き出す', () => {
    const d = buildAvatar(defaultParams);
    const humanoid = new Set<string>(HUMAN_BONES.filter((b) => !b.endsWith('Eye')));
    const text = writeBVH(d.bones.hips, (b) => humanoid.has(b.name), (t) => (d.bones.spine.rotation.x = t), 1, 30);
    expect(text).toContain('ROOT hips');
    expect(text).toContain('JOINT leftUpperArm');
    expect(text).toContain('Frames: 30');
    const firstFrame = text.split('\n').find((_l, i, arr) => arr[i - 1]?.startsWith('Frame Time'))!;
    expect(firstFrame.split(' ').length).toBe(6 + (humanoid.size - 1) * 3);
  });
});
