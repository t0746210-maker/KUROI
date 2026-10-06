import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';
import type { Avatar } from '../avatar/Avatar';
import { bakeScene, bakedToGroup, textureToPNG, type BakedMesh } from './bake';
import { collectRig } from './fbxRig';
import { buildFBX } from './fbx';
import { exportVRM, type VRMMeta } from './vrm';
import { write3MF, writeBVH, writeCollada, writeOBJ, writePLY, writeSTL, writeX3D } from './writers';
import { createZip, type ZipEntry } from './zip';

export interface ExportOptions {
  /** アバターを T ポーズ（レスト姿勢）で出力 */
  tpose: boolean;
  includeAnimations: boolean;
  printReady: boolean;
  transparentBg: boolean;
  vrmMeta: VRMMeta;
}

export interface ExportContext {
  content: THREE.Object3D;
  avatar: Avatar | null;
  name: string;
  options: ExportOptions;
  thumbnail: () => Promise<Uint8Array | null>;
  screenshot: (transparent: boolean) => string;
  recordTurntable: (seconds: number) => Promise<Blob>;
}

export interface ExportResult {
  data: BlobPart;
  filename: string;
  mime: string;
}

export type Category = 'avatar' | 'universal' | 'print' | 'cg' | 'motion' | 'image';

export interface ExportFormat {
  id: string;
  label: string;
  ext: string;
  category: Category;
  desc: string;
  tags: string[];
  needsAvatar?: boolean;
  run(ctx: ExportContext): Promise<ExportResult>;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  avatar: 'VTuber / アバター',
  universal: '汎用 3D（ゲームエンジン・Web）',
  cg: 'DCC ツール（Blender / Maya / 3ds Max）',
  print: '3D プリント',
  motion: 'モーション',
  image: '画像・動画',
};

/** シーン状態を一時的に変更してから戻すヘルパー */
async function withExportState<T>(ctx: ExportContext, fn: () => Promise<T> | T): Promise<T> {
  const av = ctx.avatar;
  const hulls: THREE.Object3D[] = [];
  ctx.content.traverse((o) => {
    if (o.userData.outlineHull && o.visible) {
      hulls.push(o);
      o.visible = false;
    }
  });
  const prevFrozen = av?.frozen ?? false;
  if (av) {
    av.frozen = true;
    if (ctx.options.tpose) av.resetToRest();
  }
  ctx.content.updateMatrixWorld(true);
  try {
    return await fn();
  } finally {
    hulls.forEach((h) => (h.visible = true));
    if (av) {
      av.frozen = prevFrozen;
      if (ctx.options.tpose) {
        av.applyPose(av.pose, av.poseName);
        av.applyExpressions();
      }
    }
  }
}

/** トゥーン等の非標準マテリアルを一時的に MeshStandardMaterial に置換 */
async function withStandardMaterials<T>(root: THREE.Object3D, fn: () => Promise<T>): Promise<T> {
  const restore: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
  const conv = (m: THREE.Material): THREE.Material => {
    if ((m as any).isMeshStandardMaterial || (m as any).isMeshBasicMaterial) return m;
    const a = m as any;
    const s = new THREE.MeshStandardMaterial({
      name: m.name,
      color: a.color ?? new THREE.Color(1, 1, 1),
      map: a.map ?? null,
      emissive: a.emissive ?? new THREE.Color(0, 0, 0),
      emissiveMap: a.emissiveMap ?? null,
      normalMap: a.normalMap ?? null,
      roughness: a.isMeshToonMaterial ? 0.85 : a.shininess !== undefined ? 1 - Math.min(1, a.shininess / 100) : 0.7,
      metalness: 0,
      transparent: m.transparent,
      opacity: m.opacity,
      side: m.side,
      vertexColors: (m as any).vertexColors,
      alphaTest: m.alphaTest,
    });
    s.userData = { ...m.userData };
    return s;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    restore.push([mesh, mesh.material]);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  });
  try {
    return await fn();
  } finally {
    for (const [mesh, mat] of restore) mesh.material = mat;
  }
}

const paintMaps = (ctx: ExportContext) =>
  Object.fromEntries([...(ctx.avatar?.paint ?? new Map())].map(([k, l]) => [k, l.composite as HTMLCanvasElement]));

/** 焼き込みメッシュが参照するテクスチャを PNG に変換 */
async function encodeTextures(meshes: BakedMesh[]): Promise<Map<THREE.Texture, Uint8Array>> {
  const out = new Map<THREE.Texture, Uint8Array>();
  for (const m of meshes)
    for (const mat of m.materials) {
      if (!mat.map || out.has(mat.map)) continue;
      try {
        const png = await textureToPNG(mat.map);
        if (png) out.set(mat.map, png);
      } catch (e) {
        console.warn('テクスチャの変換に失敗', e);
      }
    }
  return out;
}

const bake = (ctx: ExportContext): Promise<BakedMesh[]> => withExportState(ctx, () => bakeScene(ctx.content));

async function gltf(ctx: ExportContext, binary: boolean): Promise<ArrayBuffer | object> {
  return withExportState(ctx, () =>
    withStandardMaterials(ctx.content, async () => {
      const exporter = new GLTFExporter();
      const animations = ctx.options.includeAnimations && ctx.avatar ? ctx.avatar.clips : [];
      return exporter.parseAsync(ctx.content, { binary, onlyVisible: true, animations, trs: true });
    }),
  );
}

export const FORMATS: ExportFormat[] = [
  {
    id: 'vrm1',
    label: 'VRM 1.0',
    ext: 'vrm',
    category: 'avatar',
    desc: '最新 VRM 規格。ヒューマノイド・表情・視線・揺れ物（SpringBone）・MToon を含みます。VRChat 変換 / VSeeFace / cluster / バーチャルキャスト等に。',
    tags: ['ボーン', '表情', '揺れ物', 'MToon', 'サムネイル'],
    needsAvatar: true,
    async run(ctx) {
      const thumb = await ctx.thumbnail();
      const data = await exportVRM(ctx.avatar!.params, '1.0', ctx.options.vrmMeta, thumb, paintMaps(ctx));
      return { data, filename: `${ctx.name}.vrm`, mime: 'model/gltf-binary' };
    },
  },
  {
    id: 'vrm0',
    label: 'VRM 0.x',
    ext: 'vrm',
    category: 'avatar',
    desc: '互換性の高い旧 VRM 規格（UniVRM 0.x）。BlendShape・SecondaryAnimation・MToon マテリアル情報付き。',
    tags: ['ボーン', 'BlendShape', '揺れ物', 'MToon'],
    needsAvatar: true,
    async run(ctx) {
      const thumb = await ctx.thumbnail();
      const data = await exportVRM(ctx.avatar!.params, '0.x', ctx.options.vrmMeta, thumb, paintMaps(ctx));
      return { data, filename: `${ctx.name}_vrm0.vrm`, mime: 'model/gltf-binary' };
    },
  },
  {
    id: 'glb',
    label: 'glTF バイナリ (.glb)',
    ext: 'glb',
    category: 'universal',
    desc: 'Web・Unity・Unreal・Godot・Blender 対応の標準形式。スキンメッシュ・モーフ・アニメーション・テクスチャを1ファイルに。',
    tags: ['ボーン', 'モーフ', 'アニメ', 'テクスチャ'],
    async run(ctx) {
      const data = (await gltf(ctx, true)) as ArrayBuffer;
      return { data, filename: `${ctx.name}.glb`, mime: 'model/gltf-binary' };
    },
  },
  {
    id: 'gltf',
    label: 'glTF (.gltf JSON)',
    ext: 'gltf',
    category: 'universal',
    desc: '人が読める JSON 形式の glTF 2.0（バッファ埋め込み）。',
    tags: ['ボーン', 'モーフ', 'アニメ', 'テクスチャ'],
    async run(ctx) {
      const json = await gltf(ctx, false);
      return { data: JSON.stringify(json, null, 2), filename: `${ctx.name}.gltf`, mime: 'model/gltf+json' };
    },
  },
  {
    id: 'usdz',
    label: 'USDZ',
    ext: 'usdz',
    category: 'universal',
    desc: 'Apple AR Quick Look / Reality Composer / Omniverse 向け。iPhone でそのまま AR 表示できます。',
    tags: ['AR', 'テクスチャ', 'PBR'],
    async run(ctx) {
      const baked = await bake(ctx);
      const group = bakedToGroup(baked);
      const data = await new USDZExporter().parseAsync(group);
      return { data: data as unknown as BlobPart, filename: `${ctx.name}.usdz`, mime: 'model/vnd.usdz+zip' };
    },
  },
  {
    id: 'fbx',
    label: 'FBX 7.4（ボーン付き）',
    ext: 'fbx',
    category: 'cg',
    desc: 'Unity / Unreal / Blender / Maya / 3ds Max / Mixamo 向け。スケルトン・スキンウェイト・表情ブレンドシェイプ・アニメーション・テクスチャ埋め込み。',
    tags: ['ボーン', 'スキン', 'ブレンドシェイプ', 'アニメ', 'テクスチャ'],
    async run(ctx) {
      const data = await withExportState(ctx, async () => {
        const av = ctx.avatar;
        const statics = bakeScene(ctx.content, av ? (o) => o === av.holder : undefined);
        const rig = av ? collectRig(av, { tpose: ctx.options.tpose, includeAnimations: ctx.options.includeAnimations }) : null;
        const textures = await encodeTextures([...statics, ...(rig?.meshes.map((m) => m.mesh) ?? [])]);
        return buildFBX(statics, { sceneName: ctx.name, rig, textures });
      });
      return { data: data as BlobPart, filename: `${ctx.name}.fbx`, mime: 'application/octet-stream' };
    },
  },
  {
    id: 'fbx-static',
    label: 'FBX 7.4（ポーズ焼き込み）',
    ext: 'fbx',
    category: 'cg',
    desc: '現在のポーズ・表情をメッシュに焼き込んだボーンなし FBX。古いツールや静止画用途、3D プリント前の調整に。',
    tags: ['静的メッシュ', 'マテリアル', 'テクスチャ'],
    async run(ctx) {
      const baked = await bake(ctx);
      const data = buildFBX(baked, { sceneName: ctx.name, textures: await encodeTextures(baked) });
      return { data: data as BlobPart, filename: `${ctx.name}_static.fbx`, mime: 'application/octet-stream' };
    },
  },
  {
    id: 'obj',
    label: 'OBJ + MTL (ZIP)',
    ext: 'zip',
    category: 'cg',
    desc: 'ほぼ全ての 3D ソフトで開ける定番形式。マテリアル (.mtl) とテクスチャ PNG を ZIP にまとめて出力。',
    tags: ['マテリアル', 'テクスチャ', '頂点カラー'],
    async run(ctx) {
      const baked = await bake(ctx);
      const r = writeOBJ(baked, ctx.name, { vertexColors: true });
      const files: ZipEntry[] = [
        { name: `${ctx.name}.obj`, data: r.obj },
        { name: `${ctx.name}.mtl`, data: r.mtl },
      ];
      for (const t of r.textures) {
        const png = await textureToPNG(t.texture);
        if (png) files.push({ name: t.name, data: png });
      }
      return { data: createZip(files) as BlobPart, filename: `${ctx.name}_obj.zip`, mime: 'application/zip' };
    },
  },
  {
    id: 'dae',
    label: 'Collada (.dae)',
    ext: 'dae',
    category: 'cg',
    desc: 'SketchUp / Cinema 4D / Godot / Second Life などで使える XML 形式。',
    tags: ['マテリアル', '頂点カラー', 'UV'],
    async run(ctx) {
      const baked = await bake(ctx);
      return { data: writeCollada(baked, { author: ctx.options.vrmMeta.author }), filename: `${ctx.name}.dae`, mime: 'model/vnd.collada+xml' };
    },
  },
  {
    id: 'x3d',
    label: 'X3D',
    ext: 'x3d',
    category: 'cg',
    desc: 'ISO 標準の Web3D 形式（X3DOM / CAD / 教育用途）。',
    tags: ['マテリアル', '頂点カラー'],
    async run(ctx) {
      const baked = await bake(ctx);
      return { data: writeX3D(baked), filename: `${ctx.name}.x3d`, mime: 'model/x3d+xml' };
    },
  },
  {
    id: 'ply',
    label: 'PLY（頂点カラー付き）',
    ext: 'ply',
    category: 'cg',
    desc: 'マテリアル色を頂点カラーに焼き込んだ PLY。MeshLab / CloudCompare / フルカラー 3D プリント向け。',
    tags: ['頂点カラー', 'バイナリ'],
    async run(ctx) {
      const baked = await bake(ctx);
      return { data: writePLY(baked, { binary: true }) as BlobPart, filename: `${ctx.name}.ply`, mime: 'application/octet-stream' };
    },
  },
  {
    id: 'stl',
    label: 'STL バイナリ',
    ext: 'stl',
    category: 'print',
    desc: '3D プリンタ用の定番形式。「3Dプリント向け」オプションで mm 単位・Z 軸上向き・接地済みに変換。',
    tags: ['3Dプリント', 'mm'],
    async run(ctx) {
      const baked = await bake(ctx);
      return { data: writeSTL(baked, { binary: true, printReady: ctx.options.printReady }) as BlobPart, filename: `${ctx.name}.stl`, mime: 'model/stl' };
    },
  },
  {
    id: 'stl-ascii',
    label: 'STL ASCII',
    ext: 'stl',
    category: 'print',
    desc: 'テキスト形式の STL。',
    tags: ['3Dプリント', 'テキスト'],
    async run(ctx) {
      const baked = await bake(ctx);
      return { data: writeSTL(baked, { binary: false, printReady: ctx.options.printReady }) as BlobPart, filename: `${ctx.name}_ascii.stl`, mime: 'model/stl' };
    },
  },
  {
    id: '3mf',
    label: '3MF（カラー）',
    ext: '3mf',
    category: 'print',
    desc: 'マテリアル色付きの次世代 3D プリント形式。Bambu Studio / PrusaSlicer / Cura 対応（mm・Z-up）。',
    tags: ['3Dプリント', 'カラー', 'mm'],
    async run(ctx) {
      const baked = await bake(ctx);
      return { data: write3MF(baked, { title: ctx.name }) as BlobPart, filename: `${ctx.name}.3mf`, mime: 'model/3mf' };
    },
  },
  {
    id: 'bvh',
    label: 'BVH モーション',
    ext: 'bvh',
    category: 'motion',
    desc: '再生中のアニメーション（未再生なら現在のポーズ）をモーションキャプチャ形式で出力。Blender / MotionBuilder / MMD ツールへ。',
    tags: ['モーション', '30fps'],
    needsAvatar: true,
    async run(ctx) {
      const av = ctx.avatar!;
      const clip = av.clips.find((c) => c.name === av.currentClip) ?? null;
      const prevFrozen = av.frozen;
      av.frozen = true;
      const mixer = new THREE.AnimationMixer(av.root);
      const action = clip ? mixer.clipAction(clip).play() : null;
      const humanoid = new Set(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes']);
      try {
        const text = writeBVH(
          av.data.bones.hips,
          (b) => humanoid.has(b.name),
          (t) => {
            if (action) mixer.setTime(t);
          },
          clip ? clip.duration : 1 / 30,
        );
        return { data: text, filename: `${ctx.name}_${clip?.name ?? 'pose'}.bvh`, mime: 'text/plain' };
      } finally {
        mixer.stopAllAction();
        mixer.uncacheRoot(av.root);
        av.frozen = prevFrozen;
        if (av.currentClip) av.play(av.currentClip);
        else av.applyPose(av.pose, av.poseName);
      }
    },
  },
  {
    id: 'threejs',
    label: 'three.js JSON',
    ext: 'json',
    category: 'universal',
    desc: 'three.js の ObjectLoader でそのまま読み込める JSON シーン。',
    tags: ['Web', 'シーン'],
    async run(ctx) {
      const json = await withExportState(ctx, () => ctx.content.toJSON());
      return { data: JSON.stringify(json), filename: `${ctx.name}.three.json`, mime: 'application/json' };
    },
  },
  {
    id: 'png',
    label: 'PNG スクリーンショット',
    ext: 'png',
    category: 'image',
    desc: '現在のビューを高解像度（2倍）で保存。背景透過オプション対応。',
    tags: ['高解像度', '透過'],
    async run(ctx) {
      const url = ctx.screenshot(ctx.options.transparentBg);
      const blob = await (await fetch(url)).blob();
      return { data: blob, filename: `${ctx.name}.png`, mime: 'image/png' };
    },
  },
  {
    id: 'webm',
    label: 'ターンテーブル動画 (WebM)',
    ext: 'webm',
    category: 'image',
    desc: 'カメラを360°回転させた紹介動画（6秒）を録画します。SNS 投稿に。',
    tags: ['動画', '360°'],
    async run(ctx) {
      const blob = await ctx.recordTurntable(6);
      return { data: blob, filename: `${ctx.name}_turntable.webm`, mime: 'video/webm' };
    },
  },
];

export function download(r: ExportResult) {
  const blob = r.data instanceof Blob ? r.data : new Blob([r.data], { type: r.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = r.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return blob.size;
}
