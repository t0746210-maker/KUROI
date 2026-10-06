import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { buildAvatar, EXPRESSIONS, HUMAN_BONES, type AvatarData } from '../avatar/AvatarBuilder';
import type { AvatarParams } from '../avatar/params';
import { addExtensionUsed, addTexture, appendImage, packGLB, parseGLB } from './glb';

export interface VRMMeta {
  name: string;
  author: string;
  version: string;
  contact?: string;
  reference?: string;
  /** VRM 1.0 の利用条件 */
  avatarPermission: 'onlyAuthor' | 'onlySeparatelyLicensedPerson' | 'everyone';
  commercialUsage: 'personalNonProfit' | 'personalProfit' | 'corporation';
  allowRedistribution: boolean;
  modification: 'prohibited' | 'allowModification' | 'allowModificationRedistribution';
  creditNotation: 'required' | 'unnecessary';
  allowExcessivelyViolentUsage: boolean;
  allowExcessivelySexualUsage: boolean;
}

export const defaultMeta = (p: AvatarParams): VRMMeta => ({
  name: p.name,
  author: p.author,
  version: '1.0',
  avatarPermission: 'everyone',
  commercialUsage: 'personalNonProfit',
  allowRedistribution: false,
  modification: 'prohibited',
  creditNotation: 'required',
  allowExcessivelyViolentUsage: false,
  allowExcessivelySexualUsage: false,
});

/** VRM 0.x 用プリセット名の対応 */
const VRM0_PRESETS: Record<string, [string, string]> = {
  happy: ['Joy', 'joy'],
  angry: ['Angry', 'angry'],
  sad: ['Sorrow', 'sorrow'],
  relaxed: ['Fun', 'fun'],
  surprised: ['Surprised', 'unknown'],
  aa: ['A', 'a'],
  ih: ['I', 'i'],
  ou: ['U', 'u'],
  ee: ['E', 'e'],
  oh: ['O', 'o'],
  blink: ['Blink', 'blink'],
  blinkLeft: ['Blink_L', 'blink_l'],
  blinkRight: ['Blink_R', 'blink_r'],
};

/** Y 軸 180° 回転（VRM 0.x は -Z 正面） */
function rotateAvatar180(data: AvatarData) {
  const flip = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
    for (let i = 0; i < attr.count; i++) {
      attr.setX(i, -attr.getX(i));
      attr.setZ(i, -attr.getZ(i));
    }
    attr.needsUpdate = true;
  };
  const done = new Set<THREE.BufferGeometry>();
  for (const m of data.meshes) {
    const g = m.geometry;
    if (done.has(g)) continue;
    done.add(g);
    flip(g.attributes.position);
    if (g.attributes.normal) flip(g.attributes.normal);
    for (const ma of g.morphAttributes.position ?? []) flip(ma);
    for (const ma of g.morphAttributes.normal ?? []) flip(ma);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  for (const b of data.skeleton.bones) b.position.set(-b.position.x, b.position.y, -b.position.z);
  for (const c of data.colliders) c.offset.set(-c.offset.x, c.offset.y, -c.offset.z);
  data.eyeOffset.set(-data.eyeOffset.x, data.eyeOffset.y, -data.eyeOffset.z);
  data.root.updateMatrixWorld(true);
  data.skeleton.calculateInverses();
}

async function toGLB(root: THREE.Object3D, animations: THREE.AnimationClip[] = []): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const res = await exporter.parseAsync(root, { binary: true, onlyVisible: true, animations, trs: true });
  return res as ArrayBuffer;
}

function linearToSRGBArray(c: THREE.Color): [number, number, number] {
  const s = c.clone().convertLinearToSRGB();
  return [s.r, s.g, s.b];
}

/**
 * アバターを VRM（1.0 または 0.x）としてエクスポート。
 * エクスポート専用にアバターを再生成するため、シーン上のアバターには影響しない。
 */
export async function exportVRM(
  params: AvatarParams,
  version: '1.0' | '0.x',
  meta: VRMMeta,
  thumbnail?: Uint8Array | null,
): Promise<ArrayBuffer> {
  const data = buildAvatar({ ...params, toon: false, outline: false });
  // アウトライン用ハルは除外
  for (const o of data.outlines) data.root.remove(o);
  // MToon は頂点カラーを使わないため、髪は代表色に置き換える
  const matByName = new Map<string, THREE.Material>();
  for (const m of data.meshes) {
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (mat.name === 'Hair') {
        (mat as THREE.MeshStandardMaterial).vertexColors = false;
        const c1 = new THREE.Color(params.hairColor);
        const c2 = new THREE.Color(params.hairColor2);
        (mat as THREE.MeshStandardMaterial).color.copy(c1.lerp(c2, 0.2));
        mat.userData.mtoon = { shadeColor: '#' + c1.clone().multiplyScalar(0.6).getHexString() };
      }
      matByName.set(mat.name, mat);
    }
  }
  if (version === '0.x') rotateAvatar180(data);
  data.root.updateMatrixWorld(true);

  const glb = await toGLB(data.root);
  const parts = parseGLB(glb);
  const json = parts.json;
  const nodeIndex = new Map<string, number>();
  (json.nodes ?? []).forEach((n: any, i: number) => n.name && !nodeIndex.has(n.name) && nodeIndex.set(n.name, i));
  const faceNode = nodeIndex.get('Face');
  if (faceNode === undefined) throw new Error('Face メッシュが見つかりません');
  const faceMesh = json.nodes[faceNode].mesh;
  const targetNames: string[] = json.meshes[faceMesh].extras?.targetNames ?? [...EXPRESSIONS];
  const morphIndex = (name: string) => targetNames.indexOf(name);

  let thumbImage = -1;
  if (thumbnail && thumbnail.length) thumbImage = appendImage(parts, thumbnail, 'thumbnail');

  // スプリング
  const springNodes = data.springs.map((s) => s.bones.map((b) => nodeIndex.get(b.name)!).filter((n) => n !== undefined));
  const colliderNodes = data.colliders.map((c) => nodeIndex.get(c.bone.name)!);

  if (version === '1.0') {
    const humanBones: Record<string, { node: number }> = {};
    for (const b of HUMAN_BONES) {
      const n = nodeIndex.get(b);
      if (n !== undefined) humanBones[b] = { node: n };
    }
    const preset: Record<string, any> = {};
    for (const e of EXPRESSIONS) {
      const idx = morphIndex(e);
      if (idx < 0) continue;
      const isMouth = ['aa', 'ih', 'ou', 'ee', 'oh'].includes(e);
      const isEmotion = ['happy', 'angry', 'sad', 'relaxed', 'surprised'].includes(e);
      preset[e] = {
        morphTargetBinds: [{ node: faceNode, index: idx, weight: 1 }],
        isBinary: false,
        overrideBlink: isEmotion ? 'blend' : 'none',
        overrideLookAt: e.startsWith('blink') ? 'block' : 'none',
        overrideMouth: isEmotion ? 'blend' : 'none',
      };
      if (isMouth) preset[e].overrideMouth = 'none';
    }
    const vrm: any = {
      specVersion: '1.0',
      meta: {
        name: meta.name,
        version: meta.version,
        authors: [meta.author || 'Unknown'],
        copyrightInformation: `© ${meta.author}`,
        contactInformation: meta.contact ?? '',
        references: meta.reference ? [meta.reference] : [],
        thirdPartyLicenses: '',
        licenseUrl: 'https://vrm.dev/licenses/1.0/',
        avatarPermission: meta.avatarPermission,
        allowExcessivelyViolentUsage: meta.allowExcessivelyViolentUsage,
        allowExcessivelySexualUsage: meta.allowExcessivelySexualUsage,
        commercialUsage: meta.commercialUsage,
        allowPoliticalOrReligiousUsage: false,
        allowAntisocialOrHateUsage: false,
        creditNotation: meta.creditNotation,
        allowRedistribution: meta.allowRedistribution,
        modification: meta.modification,
        otherLicenseUrl: '',
      },
      humanoid: { humanBones },
      firstPerson: {
        meshAnnotations: (json.nodes as any[])
          .map((n, i) => ({ n, i }))
          .filter(({ n }) => n.mesh !== undefined)
          .map(({ n, i }) => ({ node: i, type: n.name === 'Hair' || n.name === 'Face' ? 'thirdPersonOnly' : 'auto' })),
      },
      lookAt: {
        offsetFromHeadBone: data.eyeOffset.toArray(),
        type: 'bone',
        rangeMapHorizontalInner: { inputMaxValue: 90, outputScale: 10 },
        rangeMapHorizontalOuter: { inputMaxValue: 90, outputScale: 10 },
        rangeMapVerticalDown: { inputMaxValue: 90, outputScale: 10 },
        rangeMapVerticalUp: { inputMaxValue: 90, outputScale: 10 },
      },
      expressions: { preset, custom: {} },
    };
    if (thumbImage >= 0) vrm.meta.thumbnailImage = thumbImage;

    const springBone = {
      specVersion: '1.0',
      colliders: data.colliders.map((c, i) => ({ node: colliderNodes[i], shape: { sphere: { offset: c.offset.toArray(), radius: c.radius } } })),
      colliderGroups: [{ name: 'Body', colliders: data.colliders.map((_, i) => i) }],
      springs: data.springs.map((s, i) => ({
        name: s.name,
        joints: springNodes[i].map((node) => ({
          node,
          hitRadius: s.hitRadius,
          stiffness: s.stiffness,
          gravityPower: s.gravityPower,
          gravityDir: [0, -1, 0],
          dragForce: s.dragForce,
        })),
        colliderGroups: [0],
      })),
    };

    // MToon
    (json.materials ?? []).forEach((m: any) => {
      const src = matByName.get(m.name);
      const shade = new THREE.Color(src?.userData.mtoon?.shadeColor ?? '#999999');
      m.extensions ??= {};
      m.extensions.VRMC_materials_mtoon = {
        specVersion: '1.0',
        transparentWithZWrite: false,
        renderQueueOffsetNumber: 0,
        shadeColorFactor: shade.toArray(),
        shadingShiftFactor: -0.05,
        shadingToonyFactor: 0.92,
        giEqualizationFactor: 0.9,
        matcapFactor: [0, 0, 0],
        parametricRimColorFactor: [0, 0, 0],
        parametricRimFresnelPowerFactor: 5,
        parametricRimLiftFactor: 0,
        rimLightingMixFactor: 1,
        outlineWidthMode: ['Skin', 'Hair', 'OutfitMain', 'OutfitSub', 'OutfitAccent', 'Shoes', 'Inner', 'HairAccessory'].includes(m.name) ? 'worldCoordinates' : 'none',
        outlineWidthFactor: 0.0012,
        outlineColorFactor: new THREE.Color(params.hairColor).multiplyScalar(0.35).toArray(),
        outlineLightingMixFactor: 1,
        uvAnimationScrollXSpeedFactor: 0,
        uvAnimationScrollYSpeedFactor: 0,
        uvAnimationRotationSpeedFactor: 0,
      };
      if (src?.userData.mtoon?.unlit) m.extensions.VRMC_materials_mtoon.shadeColorFactor = (m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1]).slice(0, 3);
    });
    json.extensions ??= {};
    json.extensions.VRMC_vrm = vrm;
    json.extensions.VRMC_springBone = springBone;
    addExtensionUsed(json, 'VRMC_vrm', 'VRMC_springBone', 'VRMC_materials_mtoon');
  } else {
    // ---------------------------------------------------------------- VRM 0.x
    let thumbTex = -1;
    if (thumbImage >= 0) thumbTex = addTexture(json, thumbImage);
    const humanBones = HUMAN_BONES.filter((b) => nodeIndex.has(b)).map((b) => ({ bone: b, node: nodeIndex.get(b)!, useDefaultValues: true }));
    const groups = EXPRESSIONS.filter((e) => morphIndex(e) >= 0).map((e) => ({
      name: VRM0_PRESETS[e][0],
      presetName: VRM0_PRESETS[e][1],
      binds: [{ mesh: faceMesh, index: morphIndex(e), weight: 100 }],
      materialValues: [],
      isBinary: false,
    }));
    groups.unshift({ name: 'Neutral', presetName: 'neutral', binds: [], materialValues: [], isBinary: false });
    const curve = { curve: [0, 0, 0, 1, 1, 1, 1, 0], xRange: 90, yRange: 10 };
    const vec = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });
    const materialProperties = (json.materials ?? []).map((m: any) => {
      const src = matByName.get(m.name);
      const base = m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
      const baseS = linearToSRGBArray(new THREE.Color(base[0], base[1], base[2]));
      const shade = src?.userData.mtoon?.unlit ? baseS : linearToSRGBArray(new THREE.Color(src?.userData.mtoon?.shadeColor ?? '#999999'));
      const transparent = m.alphaMode === 'BLEND';
      const tex = m.pbrMetallicRoughness?.baseColorTexture?.index;
      const outline = ['Skin', 'Hair', 'OutfitMain', 'OutfitSub', 'OutfitAccent', 'Shoes', 'Inner', 'HairAccessory'].includes(m.name);
      return {
        name: m.name,
        shader: 'VRM/MToon',
        renderQueue: transparent ? 3000 : 2000,
        floatProperties: {
          _Cutoff: 0.5, _BumpScale: 1, _ReceiveShadowRate: 1, _ShadingGradeRate: 1, _ShadeShift: -0.05, _ShadeToony: 0.92,
          _LightColorAttenuation: 0, _IndirectLightIntensity: 0.1, _RimLightingMix: 0, _RimFresnelPower: 1, _RimLift: 0,
          _OutlineWidth: outline ? 0.12 : 0, _OutlineScaledMaxDistance: 1, _OutlineLightingMix: 1,
          _UvAnimScrollX: 0, _UvAnimScrollY: 0, _UvAnimRotation: 0, _MToonVersion: 38, _DebugMode: 0,
          _BlendMode: transparent ? 2 : 0, _OutlineWidthMode: outline ? 1 : 0, _OutlineColorMode: 0, _CullMode: 2, _OutlineCullMode: 1,
          _SrcBlend: transparent ? 5 : 1, _DstBlend: transparent ? 10 : 0, _ZWrite: transparent ? 0 : 1,
        },
        vectorProperties: {
          _Color: [...baseS, base[3] ?? 1],
          _ShadeColor: [...shade, 1],
          _MainTex: [0, 0, 1, 1],
          _ShadeTexture: [0, 0, 1, 1],
          _EmissionColor: [0, 0, 0, 1],
          _RimColor: [0, 0, 0, 1],
          _OutlineColor: [...linearToSRGBArray(new THREE.Color(params.hairColor).multiplyScalar(0.35)), 1],
        },
        textureProperties: tex !== undefined ? { _MainTex: tex } : {},
        keywordMap: transparent ? { _ALPHABLEND_ON: true } : {},
        tagMap: { RenderType: transparent ? 'Transparent' : 'Opaque' },
      };
    });
    const vrm0: any = {
      exporterVersion: 'KUROI-Studio-1.0',
      specVersion: '0.0',
      meta: {
        title: meta.name,
        version: meta.version,
        author: meta.author,
        contactInformation: meta.contact ?? '',
        reference: meta.reference ?? '',
        allowedUserName: meta.avatarPermission === 'everyone' ? 'Everyone' : meta.avatarPermission === 'onlyAuthor' ? 'OnlyAuthor' : 'ExplicitlyLicensedPerson',
        violentUssageName: meta.allowExcessivelyViolentUsage ? 'Allow' : 'Disallow',
        sexualUssageName: meta.allowExcessivelySexualUsage ? 'Allow' : 'Disallow',
        commercialUssageName: meta.commercialUsage === 'personalNonProfit' ? 'Disallow' : 'Allow',
        otherPermissionUrl: '',
        licenseName: meta.allowRedistribution ? 'CC_BY' : 'Redistribution_Prohibited',
        otherLicenseUrl: '',
      },
      humanoid: {
        humanBones,
        armStretch: 0.05, legStretch: 0.05, upperArmTwist: 0.5, lowerArmTwist: 0.5,
        upperLegTwist: 0.5, lowerLegTwist: 0.5, feetSpacing: 0, hasTranslationDoF: false,
      },
      firstPerson: {
        firstPersonBone: nodeIndex.get('head'),
        firstPersonBoneOffset: vec(data.eyeOffset),
        meshAnnotations: (json.meshes as any[]).map((_, i) => ({ mesh: i, firstPersonFlag: 'Auto' })),
        lookAtTypeName: 'Bone',
        lookAtHorizontalInner: curve,
        lookAtHorizontalOuter: curve,
        lookAtVerticalDown: curve,
        lookAtVerticalUp: curve,
      },
      blendShapeMaster: { blendShapeGroups: groups },
      secondaryAnimation: {
        boneGroups: data.springs.map((s, i) => ({
          comment: s.name,
          stiffiness: s.stiffness,
          gravityPower: s.gravityPower,
          gravityDir: { x: 0, y: -1, z: 0 },
          dragForce: s.dragForce,
          center: -1,
          hitRadius: s.hitRadius,
          bones: [springNodes[i][0]],
          colliderGroups: data.colliders.map((_, k) => k),
        })),
        colliderGroups: data.colliders.map((c, i) => ({ node: colliderNodes[i], colliders: [{ offset: vec(c.offset), radius: c.radius }] })),
      },
      materialProperties,
    };
    if (thumbTex >= 0) vrm0.meta.texture = thumbTex;
    json.extensions ??= {};
    json.extensions.VRM = vrm0;
    addExtensionUsed(json, 'VRM');
  }
  json.asset = { ...(json.asset ?? {}), generator: 'KUROI Studio', version: '2.0' };
  return packGLB(json, parts.bin);
}
