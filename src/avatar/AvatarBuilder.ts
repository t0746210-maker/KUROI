import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AvatarParams } from './params';
import { axisRing, disc, ellipsoid, loft, normalizeAttributes, strand, type Ring } from './geom';
import { blushTexture, irisTexture, makeMaterial, outlineMaterial } from './materials';

/** VRM 1.0 のヒューマノイドボーン名をそのままボーン名に使う */
export const HUMAN_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
] as const;
export type HumanBone = (typeof HUMAN_BONES)[number];

export const EXPRESSIONS = [
  'happy', 'angry', 'sad', 'relaxed', 'surprised',
  'aa', 'ih', 'ou', 'ee', 'oh',
  'blink', 'blinkLeft', 'blinkRight',
] as const;
export type ExpressionName = (typeof EXPRESSIONS)[number];

export interface SpringChain {
  name: string;
  bones: THREE.Bone[];
  stiffness: number;
  gravityPower: number;
  dragForce: number;
  hitRadius: number;
}

export interface SphereCollider {
  bone: THREE.Bone;
  offset: THREE.Vector3;
  radius: number;
}

export interface AvatarData {
  root: THREE.Group;
  skeleton: THREE.Skeleton;
  bones: Record<string, THREE.Bone>;
  meshes: THREE.SkinnedMesh[];
  /** アウトライン用の反転ハル（エクスポート対象外） */
  outlines: THREE.SkinnedMesh[];
  faceMesh: THREE.SkinnedMesh;
  springs: SpringChain[];
  colliders: SphereCollider[];
  /** 目のボーンからの視線オフセット（VRM lookAt 用） */
  eyeOffset: THREE.Vector3;
  height: number;
}

interface BoneSeg {
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
}

interface Part {
  geo: THREE.BufferGeometry;
  mat: number;
  bones?: string[];
  force?: string;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const deg = THREE.MathUtils.degToRad;

/**
 * パラメータから完全にリギング済みのアバターを生成する。
 * - VRM 互換のヒューマノイドボーン
 * - 距離ベースの滑らかなスキンウェイト
 * - 表情モーフ（VRM 1.0 プリセット13種）
 * - 揺れ物（スプリングボーン）チェーン
 */
export function buildAvatar(p: AvatarParams): AvatarData {
  // ---------------------------------------------------------------- レイアウト（単位空間）
  const hs = p.headSize;
  const L = {
    ankleY: 0.045,
    legSeg: 0.225 * p.legLength,
    kneeY: 0,
    upperLegY: 0,
    hipsY: 0,
    spineY: 0,
    chestY: 0,
    upperChestY: 0,
    shoulderY: 0,
    neckY: 0,
    headY: 0,
    headRx: 0.066 * hs * p.faceWidth,
    headRy: 0.075 * hs,
    headRz: 0.07 * hs,
    headCY: 0,
  };
  L.kneeY = L.ankleY + L.legSeg;
  L.upperLegY = L.kneeY + L.legSeg * 1.03;
  L.hipsY = L.upperLegY + 0.035;
  L.spineY = L.hipsY + 0.06;
  L.chestY = L.spineY + 0.075;
  L.upperChestY = L.chestY + 0.06;
  L.shoulderY = L.upperChestY + 0.045;
  L.neckY = L.upperChestY + 0.065;
  L.headY = L.neckY + 0.045 * p.neckLength;
  L.headCY = L.headY + L.headRy * 0.62;
  const top = L.headCY + L.headRy;
  const S = p.height / top;
  const s = (n: number) => n * S;

  const headC = V(0, s(L.headCY), s(0.004));
  const hrx = s(L.headRx);
  const hry = s(L.headRy);
  const hrz = s(L.headRz);

  // ---------------------------------------------------------------- スケルトン
  const bonePos: Record<string, THREE.Vector3> = {};
  const boneParent: Record<string, string | null> = {};
  const segs: Record<string, BoneSeg> = {};
  const def = (name: string, parent: string | null, pos: THREE.Vector3, radius: number, end?: THREE.Vector3) => {
    bonePos[name] = pos;
    boneParent[name] = parent;
    segs[name] = { start: pos, end: end ?? pos.clone(), radius };
  };
  const shoulderX = s(0.02);
  const upperArmX = s(0.085 * p.shoulderWidth);
  const upperArmLen = s(0.145 * p.armLength);
  const lowerArmLen = s(0.13 * p.armLength);
  const handLen = s(0.075 * p.handSize);
  const legX = s(0.048 * p.hip);
  const footLen = s(0.1 * p.footSize);

  def('hips', null, V(0, s(L.hipsY), 0), s(0.08));
  def('spine', 'hips', V(0, s(L.spineY), 0), s(0.062));
  def('chest', 'spine', V(0, s(L.chestY), 0), s(0.068));
  def('upperChest', 'chest', V(0, s(L.upperChestY), 0), s(0.07));
  def('neck', 'upperChest', V(0, s(L.neckY), 0), s(0.024));
  def('head', 'neck', V(0, s(L.headY), 0), hrx * 1.05, V(0, headC.y + hry, 0));
  const eyeBoneY = headC.y - hry * (0.12 + (0.5 - p.eyeHeight) * 0.3);
  def('leftEye', 'head', V(hrx * 0.42 * p.eyeSpacing, eyeBoneY, headC.z + hrz * 0.25), 0);
  def('rightEye', 'head', V(-hrx * 0.42 * p.eyeSpacing, eyeBoneY, headC.z + hrz * 0.25), 0);
  for (const side of [1, -1] as const) {
    const n = side === 1 ? 'left' : 'right';
    const y = s(L.shoulderY);
    def(`${n}Shoulder`, 'upperChest', V(side * shoulderX, y, 0), s(0.035));
    def(`${n}UpperArm`, `${n}Shoulder`, V(side * upperArmX, y, 0), s(0.024));
    def(`${n}LowerArm`, `${n}UpperArm`, V(side * (upperArmX + upperArmLen), y, 0), s(0.019));
    def(`${n}Hand`, `${n}LowerArm`, V(side * (upperArmX + upperArmLen + lowerArmLen), y, 0), s(0.015),
      V(side * (upperArmX + upperArmLen + lowerArmLen + handLen), y, 0));
    def(`${n}UpperLeg`, 'hips', V(side * legX, s(L.upperLegY), 0), s(0.045));
    def(`${n}LowerLeg`, `${n}UpperLeg`, V(side * legX, s(L.kneeY), 0), s(0.03));
    def(`${n}Foot`, `${n}LowerLeg`, V(side * legX, s(L.ankleY), 0), s(0.02));
    def(`${n}Toes`, `${n}Foot`, V(side * legX, s(0.012), footLen * 0.7), s(0.012), V(side * legX, s(0.01), footLen * 0.95));
  }
  // 子ボーン方向で終点を決める
  for (const name of Object.keys(bonePos)) {
    const par = boneParent[name];
    if (par && segs[par].end.equals(segs[par].start) && !name.endsWith('Eye')) {
      segs[par].end = bonePos[name].clone();
    }
  }

  // ---------------------------------------------------------------- 髪の揺れ物チェーン定義
  const chainDefs: { name: string; points: THREE.Vector3[]; stiffness: number; gravity: number; drag: number }[] = [];
  const P = (phi: number, el: number, k: number) =>
    V(
      headC.x + Math.sin(deg(phi)) * Math.cos(deg(el)) * hrx * k,
      headC.y + Math.sin(deg(el)) * hry * k,
      headC.z + Math.cos(deg(phi)) * Math.cos(deg(el)) * hrz * k,
    );
  const hv = p.hairVolume;
  const hl = p.hairLength;
  const longEndY = s(L.headCY) - s(0.18 + 0.32 * hl);

  const ponyLen = s(0.18 + 0.2 * hl);
  if (p.hairStyle === 'ponytail') {
    const T = V(0, headC.y + hry * 0.35, headC.z - hrz * 1.02);
    const q1 = T.clone().add(V(0, s(0.008), -s(0.045)));
    const q2 = q1.clone().add(V(0, -ponyLen * 0.34, -s(0.02)));
    const q3 = q2.clone().add(V(0, -ponyLen * 0.33, -s(0.004)));
    const q4 = q3.clone().add(V(0, -ponyLen * 0.33, s(0.006)));
    chainDefs.push({ name: 'ponytail', points: [T, q1, q2, q3, q4], stiffness: 0.9, gravity: 0.35, drag: 0.35 });
  }
  if (p.hairStyle === 'twintails') {
    for (const side of [1, -1]) {
      const T = V(side * hrx * 0.82, headC.y + hry * 0.42, headC.z - hrz * 0.3);
      const q1 = T.clone().add(V(side * s(0.04), s(0.004), -s(0.015)));
      const q2 = q1.clone().add(V(side * s(0.018), -ponyLen * 0.36, -s(0.01)));
      const q3 = q2.clone().add(V(side * s(0.004), -ponyLen * 0.34, 0));
      const q4 = q3.clone().add(V(-side * s(0.006), -ponyLen * 0.3, s(0.004)));
      chainDefs.push({ name: side === 1 ? 'twintailL' : 'twintailR', points: [T, q1, q2, q3, q4], stiffness: 0.9, gravity: 0.35, drag: 0.35 });
    }
  }
  if (p.hairStyle === 'long') {
    for (const phi of [150, 180, 210]) {
      const a = P(phi, -15, 1.12);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        pts.push(V(a.x * 1.08, THREE.MathUtils.lerp(a.y, longEndY, t), THREE.MathUtils.lerp(a.z, a.z - s(0.012), t)));
      }
      chainDefs.push({ name: `back${phi}`, points: pts, stiffness: 1.2, gravity: 0.25, drag: 0.45 });
    }
  }
  for (const c of chainDefs) {
    // 末端ボーン（VRM のテール）を追加
    const n = c.points.length;
    c.points.push(c.points[n - 1].clone().add(c.points[n - 1].clone().sub(c.points[n - 2]).multiplyScalar(0.6)));
    c.points.forEach((pt, i) => {
      const name = `hair_${c.name}_${i}`;
      const parent = i === 0 ? 'head' : `hair_${c.name}_${i - 1}`;
      const end = c.points[i + 1] ?? pt.clone();
      def(name, parent, pt, s(0.018), end);
    });
  }

  // ボーン生成
  const bones: Record<string, THREE.Bone> = {};
  const boneList: THREE.Bone[] = [];
  for (const name of Object.keys(bonePos)) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
    boneList.push(b);
  }
  for (const name of Object.keys(bonePos)) {
    const par = boneParent[name];
    const b = bones[name];
    if (par) {
      bones[par].add(b);
      b.position.copy(bonePos[name]).sub(bonePos[par]);
    } else {
      b.position.copy(bonePos[name]);
    }
  }
  const boneIndex: Record<string, number> = {};
  boneList.forEach((b, i) => (boneIndex[b.name] = i));

  // ---------------------------------------------------------------- 材質
  const toon = p.toon;
  const skinMat = makeMaterial(p.skinColor, { toon, name: 'Skin', shadeColor: shadeOf(p.skinColor, 0.85, -0.02) });

  // ---------------------------------------------------------------- 体
  const bodyParts: Part[] = [];
  const torsoBones = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'leftShoulder', 'rightShoulder', 'leftUpperLeg', 'rightUpperLeg'];
  const torsoProfile = (rows: { y: number; rx: number; rz: number; z?: number }[]) =>
    rows.map((r) => axisRing(V(0, s(r.y), s(r.z ?? 0)), 'y', s(r.rx), s(r.rz)));
  const bustK = p.bust;
  const torsoRows = [
    { y: L.upperLegY - 0.035, rx: 0.045 * p.hip, rz: 0.04 },
    { y: L.upperLegY - 0.012, rx: 0.086 * p.hip, rz: 0.06 * p.hip, z: -0.004 },
    { y: L.hipsY + 0.02, rx: 0.082 * p.hip, rz: 0.056 * p.hip, z: -0.004 },
    { y: L.spineY + 0.04, rx: 0.064 * p.waist, rz: 0.047 * p.waist },
    { y: L.chestY, rx: 0.072 * p.chest, rz: 0.05 * p.chest },
    { y: L.chestY + 0.04, rx: 0.08 * p.chest, rz: (0.054 + 0.004 * bustK) * p.chest, z: 0.002 * bustK },
    { y: L.upperChestY + 0.03, rx: 0.085 * p.shoulderWidth, rz: 0.05 },
    { y: L.shoulderY + 0.012, rx: 0.078 * p.shoulderWidth, rz: 0.04 },
    { y: L.neckY + 0.002, rx: 0.034, rz: 0.03 },
  ];
  bodyParts.push({ geo: loft(torsoProfile(torsoRows), { segments: 28, capStart: true }), mat: 0, bones: torsoBones });
  // バスト
  if (bustK > 0.02) {
    for (const side of [1, -1]) {
      const r = s(0.03 + 0.012 * bustK);
      const c = V(side * s(0.036 * p.chest), s(L.chestY + 0.038), s((0.04 + 0.006 * bustK) * p.chest));
      bodyParts.push({ geo: ellipsoid(c, r * 1.05, r * 0.95, r * (0.55 + 0.25 * bustK), 18, 14), mat: 0, bones: ['chest', 'upperChest', 'spine'] });
    }
  }
  // 首
  bodyParts.push({
    geo: loft([
      axisRing(V(0, s(L.neckY - 0.01), 0), 'y', s(0.024), s(0.023)),
      axisRing(V(0, s(L.headY + 0.035), s(0.003)), 'y', s(0.02), s(0.021)),
    ], { segments: 18 }),
    mat: 0,
    bones: ['neck', 'head', 'upperChest'],
  });
  // 頭部
  const headGeo = headGeometry(headC, hrx, hry, hrz, p);
  bodyParts.push({ geo: headGeo, mat: 0, force: 'head' });
  // 耳
  for (const side of [1, -1]) {
    let ear: THREE.BufferGeometry | null = null;
    const base = V(side * hrx * 0.96, headC.y - hry * 0.18, headC.z - hrz * 0.08);
    if (p.earType === 'human') {
      ear = ellipsoid(base, s(0.006), s(0.018), s(0.012), 12, 10);
    } else if (p.earType === 'elf') {
      ear = strand(
        [base.clone(), base.clone().add(V(side * s(0.025), s(0.012), -s(0.012))), base.clone().add(V(side * s(0.05), s(0.03), -s(0.03)))],
        (t) => s(0.016) * (1 - t * 0.92),
        () => s(0.004),
        { up: V(side, 0, 0), samples: 10 },
      );
    }
    if (ear) bodyParts.push({ geo: ear, mat: 0, force: 'head' });
  }
  // 腕
  for (const side of [1, -1] as const) {
    const n = side === 1 ? 'left' : 'right';
    const x0 = upperArmX - s(0.02);
    const t = p.armThickness;
    const ex = upperArmX + upperArmLen;
    const wx = ex + lowerArmLen;
    const armRows: [number, number][] = [
      [x0, 0.03 * t],
      [upperArmX + s(0.01), 0.027 * t],
      [upperArmX + upperArmLen * 0.5, 0.024 * t],
      [ex, 0.019 * t],
      [ex + lowerArmLen * 0.3, 0.021 * t],
      [wx - s(0.004), 0.015 * t],
      [wx + s(0.006), 0.014 * t],
    ];
    const rings = armRows.map(([x, r]) => axisRing(V(side * x, s(L.shoulderY), 0), 'x', s(r) * 0.92, s(r)));
    bodyParts.push({ geo: loft(rings, { segments: 16 }), mat: 0, bones: [`${n}Shoulder`, `${n}UpperArm`, `${n}LowerArm`, `${n}Hand`] });
    bodyParts.push({ geo: handGeometry(side, wx, s(L.shoulderY), handLen, S), mat: 0, bones: [`${n}LowerArm`, `${n}Hand`] });
    // 脚
    const lt = p.legThickness;
    const lx = side * legX;
    const legRows: [number, number, number][] = [
      [L.upperLegY + 0.02, 0.05 * lt * (0.85 + 0.15 * p.hip), 0],
      [L.upperLegY - 0.04, 0.047 * lt, 0],
      [L.kneeY + 0.06, 0.036 * lt, 0],
      [L.kneeY, 0.03 * lt, 0.002],
      [L.kneeY - 0.06, 0.033 * lt, -0.004],
      [L.ankleY + 0.05, 0.022 * lt, 0],
      [L.ankleY - 0.005, 0.019 * lt, 0],
    ];
    const lrings = legRows.map(([y, r, z]) => axisRing(V(lx, s(y), s(z)), 'y', s(r), s(r)));
    bodyParts.push({ geo: loft(lrings, { segments: 18 }), mat: 0, bones: ['hips', `${n}UpperLeg`, `${n}LowerLeg`, `${n}Foot`] });
    bodyParts.push({ geo: footGeometry(lx, footLen, S, 1), mat: 0, bones: [`${n}LowerLeg`, `${n}Foot`, `${n}Toes`] });
  }

  // ---------------------------------------------------------------- 顔パーツ
  const surf = new FrontSurface(headGeo, 40);
  const conform = (g: THREE.BufferGeometry, offset: number) => {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const q = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      if (surf.query(pos.getX(i), pos.getY(i), q, nrm)) {
        q.addScaledVector(nrm, offset);
        pos.setXYZ(i, q.x, q.y, q.z);
      }
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    return g;
  };

  const facePartsList: { geo: THREE.BufferGeometry; mat: number; meta: number[]; force?: string }[] = [];
  const eyeH = hry * 0.27 * p.eyeSize;
  const eyeW = hrx * 0.25 * p.eyeWidth * Math.sqrt(p.eyeSize);
  const eyeY = eyeBoneY;
  // マテリアル番号: 0 白目, 1 瞳, 2 まつ毛/眉, 3 口, 4 チーク, 5 鼻/肌影
  for (const side of [1, -1]) {
    const cx = side * hrx * 0.42 * p.eyeSpacing;
    const tilt = side * p.eyeTilt * 0.22;
    const rot = (g: THREE.BufferGeometry) => {
      g.translate(-cx, -eyeY, 0);
      g.rotateZ(tilt);
      g.translate(cx, eyeY, 0);
      return g;
    };
    const meta = [side, cx, eyeY, eyeW, eyeH];
    // 白目（上がやや平らな形）
    const white = disc(V(cx, eyeY, 0), eyeW, eyeH, V(0, 0, 1), 28);
    shapeEye(white, cx, eyeY, eyeW, eyeH, side);
    facePartsList.push({ geo: conform(rot(white), s(0.0012)), mat: 0, meta: [1, ...meta] });
    // 瞳
    const iris = disc(V(cx + side * eyeW * 0.04, eyeY - eyeH * 0.05, 0), eyeW * 0.72 * p.irisSize, eyeH * 0.86 * p.irisSize, V(0, 0, 1), 28);
    clipToEye(iris, cx, eyeY, eyeW, eyeH, side);
    facePartsList.push({ geo: conform(rot(iris), s(0.0022)), mat: 1, meta: [2, ...meta], force: side === 1 ? 'leftEye' : 'rightEye' });
    // まつ毛（上）
    const lashPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI * (0.96 - (i / 8) * 0.92);
      const ax = Math.cos(a) * side;
      lashPts.push(V(cx + ax * eyeW * 1.08, eyeY + Math.sin(a) * eyeH * 0.92 + eyeH * 0.05, 0));
    }
    // 目尻を跳ね上げる
    lashPts.push(lashPts[lashPts.length - 1].clone().add(V(side * eyeW * 0.25, eyeH * 0.05, 0)));
    const lash = strand(lashPts, (t) => eyeH * (0.11 + 0.1 * Math.sin(Math.PI * Math.min(1, t * 1.2))), () => s(0.001), { up: V(0, 0, 1), samples: 18 });
    facePartsList.push({ geo: conform(rot(lash), s(0.003)), mat: 2, meta: [3, ...meta] });
    // 下まつ毛（短い）
    const lowPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 4; i++) {
      const a = -Math.PI * (0.15 + (i / 4) * 0.3);
      lowPts.push(V(cx + Math.cos(a) * side * eyeW * 1.0, eyeY + Math.sin(a) * eyeH * 0.95, 0));
    }
    const lowLash = strand(lowPts, (t) => eyeH * 0.05 * Math.sin(Math.PI * t), () => s(0.001), { up: V(0, 0, 1), samples: 8 });
    facePartsList.push({ geo: conform(rot(lowLash), s(0.0028)), mat: 2, meta: [3, ...meta] });
    // 眉
    const browY = eyeY + eyeH * (1.25 + p.browHeight * 0.7);
    const bw = eyeW * 1.15;
    const browPts = [
      V(cx - side * bw * 0.9, browY - eyeH * 0.05, 0),
      V(cx - side * bw * 0.1, browY + eyeH * 0.14, 0),
      V(cx + side * bw * 0.85, browY + eyeH * 0.02, 0),
    ];
    const brow = strand(browPts, (t) => eyeH * 0.075 * p.browThickness * (1 - t * 0.6), () => s(0.001), { up: V(0, 0, 1), samples: 10 });
    facePartsList.push({ geo: conform(brow, s(0.0025)), mat: 2, meta: [4, side, cx, browY, bw, eyeH] });
    // チーク
    const blush = disc(V(cx + side * eyeW * 0.25, eyeY - eyeH * 1.35, 0), eyeW * 0.8, eyeH * 0.35, V(0, 0, 1), 16);
    facePartsList.push({ geo: conform(blush, s(0.0016)), mat: 4, meta: [6, side, cx, eyeY, eyeW, eyeH] });
  }
  // 口
  const mouthY = headC.y - hry * (0.6 + (0.5 - p.mouthHeight) * 0.18);
  const mw = hrx * 0.14 * p.mouthWidth;
  const mh = hry * 0.018;
  const mouth = disc(V(0, mouthY, 0), mw, mh, V(0, 0, 1), 24);
  facePartsList.push({ geo: conform(mouth, s(0.0012)), mat: 3, meta: [5, 0, 0, mouthY, mw, mh] });
  // 鼻（小さな影）
  if (p.noseSize > 0.05) {
    const nose = disc(V(0, headC.y - hry * 0.38, 0), hrx * 0.025 * (0.5 + p.noseSize), hry * 0.02 * (0.5 + p.noseSize), V(0, 0, 1), 10);
    facePartsList.push({ geo: conform(nose, s(0.0012)), mat: 5, meta: [7, 0, 0, 0, 1, 1] });
  }

  // ---------------------------------------------------------------- 髪
  const hairParts: Part[] = [];
  const hairBoneCands = ['head', ...Object.keys(bonePos).filter((n) => n.startsWith('hair_'))];
  const capK = 1.06 + 0.04 * (hv - 1);
  if (p.hairStyle !== 'none') {
    hairParts.push({ geo: hairCap(headC, hrx * capK, hry * capK, hrz * capK, p), mat: 0, force: 'head' });
  }
  const strandW = (w: number) => (t: number) => w * (1 - Math.pow(t, 1.7) * 0.92);
  const strandT = (th: number) => (t: number) => th * (1 - t * 0.6);
  // 前髪
  if (p.bangs !== 'none' && p.hairStyle !== 'none') {
    const n = 11;
    const browEl = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp((eyeY + eyeH * 1.3 - headC.y) / hry, -1, 1)));
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) - 0.5; // -0.5..0.5
      let phi = u * 150;
      let tipPhi = phi * 1.02;
      if (p.bangs === 'side') tipPhi = phi + 28 * (1 - Math.abs(u));
      if (p.bangs === 'parted') {
        phi = (u < 0 ? -1 : 1) * (12 + Math.abs(u) * 2 * 68);
        tipPhi = phi * 1.25;
      }
      const zig = (i % 2) * 5 + (p.bangs === 'side' ? u * 10 : 0);
      const endEl = browEl - zig - (p.bangs === 'parted' ? -4 + Math.abs(u) * -20 : 0);
      const pts = [
        P(phi * 0.35, 66, 0.98 * capK),
        P(phi * 0.75, 40, 1.1 * capK),
        P((phi + tipPhi) / 2, 14, 1.13 * capK),
        P(tipPhi, endEl + 6, 1.11 * capK),
        P(tipPhi * 1.01, endEl, 1.06 * capK),
      ];
      hairParts.push({ geo: strand(pts, strandW(s(0.016) * hv), strandT(s(0.005)), { up: pts[2].clone().sub(headC).normalize() }), mat: 0, force: 'head' });
    }
  }
  // サイドの髪
  const sidelockLong = ['long', 'ponytail', 'twintails', 'bun'].includes(p.hairStyle);
  if (p.hairStyle !== 'none' && p.hairStyle !== 'spiky') {
    for (const side of [1, -1]) {
      const endY = sidelockLong ? s(L.upperChestY + 0.01) + (1 - hl) * s(0.05) : headC.y - hry * 1.15;
      const endZ = sidelockLong ? s(0.065 + 0.012 * bustK) : headC.z + hrz * 0.35;
      const pts = [
        P(side * 60, 35, 1.02 * capK),
        P(side * 76, -5, 1.12 * capK),
        V(side * hrx * 1.08, headC.y - hry * 0.85, headC.z + hrz * 0.35),
        V(side * s(0.068), (headC.y - hry * 0.85 + endY) / 2, (headC.z + hrz * 0.35 + endZ) / 2),
        V(side * s(0.066), endY, endZ),
      ];
      if (!sidelockLong) pts.splice(3, 2, V(side * hrx * 1.02, endY, endZ));
      hairParts.push({ geo: strand(pts, strandW(s(0.017) * hv), strandT(s(0.006)), { up: V(side, 0, 0.3) }), mat: 0, bones: ['head', 'neck'] });
    }
  }
  // 後ろ髪
  const backStyles: Record<string, { from: number; to: number; endY: number; count: number; flare: number }> = {
    long: { from: 105, to: 255, endY: longEndY, count: 15, flare: 1.15 },
    bob: { from: 62, to: 298, endY: headC.y - hry * (0.95 + 0.25 * hl), count: 20, flare: 1.18 },
    short: { from: 70, to: 290, endY: headC.y - hry * (0.55 + 0.25 * hl), count: 18, flare: 1.08 },
    ponytail: { from: 100, to: 260, endY: headC.y - hry * 0.7, count: 12, flare: 1.04 },
    twintails: { from: 100, to: 260, endY: headC.y - hry * 0.8, count: 12, flare: 1.06 },
    bun: { from: 100, to: 260, endY: headC.y - hry * 0.7, count: 12, flare: 1.04 },
  };
  const bs = backStyles[p.hairStyle];
  if (bs) {
    for (let i = 0; i < bs.count; i++) {
      const phi = bs.from + ((bs.to - bs.from) * i) / (bs.count - 1);
      const zig = (i % 2) * s(0.012);
      const pts = [P(phi, 62, 0.97 * capK), P(phi, 25, 1.1 * capK * hv), P(phi, -15, 1.13 * capK * hv)];
      const last = pts[2];
      const dirXZ = V(last.x - headC.x, 0, last.z - headC.z);
      if (bs.endY < last.y - s(0.03)) {
        const steps = p.hairStyle === 'long' ? 3 : 2;
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const fl = THREE.MathUtils.lerp(1.0, bs.flare, Math.sin(t * Math.PI * 0.5)) * (k === steps ? 0.97 : 1);
          pts.push(V(headC.x + dirXZ.x * fl, THREE.MathUtils.lerp(last.y, bs.endY - zig, t), headC.z + dirXZ.z * fl));
        }
      } else {
        pts.push(V(headC.x + dirXZ.x * 0.97, bs.endY - zig, headC.z + dirXZ.z * 0.97));
      }
      const width = (Math.PI * 2 * Math.max(hrx, hrz) * capK * ((bs.to - bs.from) / 360)) / bs.count * 0.75;
      hairParts.push({
        geo: strand(pts, strandW(width * hv), strandT(s(0.007)), { up: dirXZ.clone().normalize(), samples: 18 }),
        mat: 0,
        bones: hairBoneCands,
      });
    }
  }
  // テール
  for (const c of chainDefs) {
    if (!c.name.startsWith('pony') && !c.name.startsWith('twin')) continue;
    const pts = c.points;
    const cnt = 9;
    for (let i = 0; i < cnt; i++) {
      const a = (i / cnt) * Math.PI * 2;
      const dir = pts[pts.length - 1].clone().sub(pts[0]).normalize();
      const side = new THREE.Vector3().crossVectors(dir, V(0, 0, 1)).normalize();
      const fwd = new THREE.Vector3().crossVectors(side, dir).normalize();
      const offs = (k: number) =>
        side.clone().multiplyScalar(Math.cos(a) * k).add(fwd.clone().multiplyScalar(Math.sin(a) * k));
      const sp = pts.map((pt, k) => {
        const t = k / (pts.length - 1);
        const spread = s(0.006) + s(0.024) * Math.sin(Math.PI * Math.min(1, t * 1.25)) * hv;
        return pt.clone().add(offs(spread));
      });
      hairParts.push({ geo: strand(sp, strandW(s(0.013) * hv), strandT(s(0.009)), { up: fwd.clone().multiplyScalar(Math.sin(a)).add(side.clone().multiplyScalar(Math.cos(a))), samples: 18 }), mat: 0, bones: hairBoneCands });
    }
    // ヘアゴム
    const d = pts[1].clone().sub(pts[0]).normalize();
    const sideV = new THREE.Vector3().crossVectors(d, V(0, 1, 0.3)).normalize();
    const upV = new THREE.Vector3().crossVectors(d, sideV).normalize();
    const tieC = pts[0].clone().lerp(pts[1], 0.55);
    const r = s(0.014);
    hairParts.push({
      geo: loft([
        { c: tieC.clone().addScaledVector(d, -s(0.006)), u: sideV.clone().multiplyScalar(r), v: upV.clone().multiplyScalar(r) },
        { c: tieC.clone().addScaledVector(d, s(0.006)), u: sideV.clone().multiplyScalar(r), v: upV.clone().multiplyScalar(r) },
      ], { segments: 16, capStart: true, capEnd: true }),
      mat: 1,
      bones: hairBoneCands,
    });
  }
  // お団子
  if (p.hairStyle === 'bun') {
    const bc = V(0, headC.y + hry * 0.72, headC.z - hrz * 0.62);
    hairParts.push({ geo: ellipsoid(bc, s(0.034) * hv, s(0.032) * hv, s(0.034) * hv, 18, 14), mat: 0, force: 'head' });
    hairParts.push({ geo: ellipsoid(bc.clone().add(V(0, -s(0.024), s(0.012))), s(0.022), s(0.007), s(0.022), 16, 6), mat: 1, force: 'head' });
  }
  // ツンツン
  if (p.hairStyle === 'spiky') {
    const spikes: [number, number][] = [];
    for (let i = 0; i < 9; i++) spikes.push([90 + i * 22.5, 20 + (i % 2) * 10]);
    for (let i = 0; i < 7; i++) spikes.push([110 + i * 23, 55]);
    for (let i = 0; i < 4; i++) spikes.push([-60 + i * 40, 62]);
    spikes.push([0, 85]);
    for (const [phi, el] of spikes) {
      const a = P(phi, el, 0.95 * capK);
      const dir = a.clone().sub(headC).normalize().add(V(0, 0.35, -0.25)).normalize();
      const pts = [a, a.clone().addScaledVector(dir, s(0.03) * hv), a.clone().addScaledVector(dir, s(0.06) * hv * hl).add(V(0, -s(0.005), 0))];
      hairParts.push({ geo: strand(pts, (t) => s(0.022) * (1 - t * 0.95), (t) => s(0.012) * (1 - t * 0.9), { up: V(0, 1, 0) }), mat: 0, force: 'head' });
    }
  }
  // アホ毛
  if (p.ahoge && p.hairStyle !== 'none') {
    const a = P(5, 84, 0.97 * capK);
    const pts = [a, a.clone().add(V(s(0.003), s(0.035), s(0.01))), a.clone().add(V(s(0.008), s(0.06), s(0.04))), a.clone().add(V(s(0.01), s(0.05), s(0.07)))];
    hairParts.push({ geo: strand(pts, (t) => s(0.007) * (1 - t * 0.85), () => s(0.002), { up: V(1, 0, 0) }), mat: 0, force: 'head' });
  }
  // ネコミミ
  if (p.earType === 'cat') {
    for (const side of [1, -1]) {
      const base = P(side * 42, 58, 1.0 * capK);
      const dir = base.clone().sub(headC).normalize().add(V(0, 0.6, 0)).normalize();
      const tip = base.clone().addScaledVector(dir, s(0.055));
      const ringAt = (c: THREE.Vector3, w: number) => ({ c, u: V(w, 0, 0).applyAxisAngle(V(0, 1, 0), deg(side * 42)), v: V(0, 0, w * 0.35).applyAxisAngle(V(0, 1, 0), deg(side * 42)) });
      hairParts.push({ geo: loft([ringAt(base, s(0.03)), ringAt(base.clone().lerp(tip, 0.5), s(0.018)), ringAt(tip, s(0.0015))], { segments: 12, capStart: true, capEnd: true }), mat: 0, force: 'head' });
      const fwd = V(Math.sin(deg(side * 42)), 0, Math.cos(deg(side * 42))).multiplyScalar(s(0.006));
      hairParts.push({ geo: loft([ringAt(base.clone().add(fwd), s(0.02)), ringAt(base.clone().lerp(tip, 0.6).add(fwd), s(0.01)), ringAt(tip.clone().add(fwd.clone().multiplyScalar(0.3)), s(0.0012))], { segments: 12, capStart: true, capEnd: true }), mat: 2, force: 'head' });
    }
  }

  // ---------------------------------------------------------------- 衣装
  const outfitParts: Part[] = [];
  // マテリアル: 0 メイン, 1 サブ, 2 アクセント, 3 靴, 4 靴下/インナー
  const scaleRows = (rows: typeof torsoRows, k: number, add = 0) =>
    rows.map((r) => ({ ...r, rx: r.rx * k + add, rz: r.rz * k + add }));
  const sleeve = (side: 1 | -1, mat: number, frac: number, k: number) => {
    const n = side === 1 ? 'left' : 'right';
    const x0 = upperArmX - s(0.025);
    const totalLen = upperArmLen + lowerArmLen;
    const xEnd = upperArmX + s(0.01) + (totalLen - s(0.01)) * frac;
    const rr = (x: number) => {
      const d = x - upperArmX;
      if (d < upperArmLen) return THREE.MathUtils.lerp(0.032, 0.024, Math.max(0, d) / upperArmLen) * p.armThickness;
      return THREE.MathUtils.lerp(0.022, 0.017, (d - upperArmLen) / lowerArmLen) * p.armThickness;
    };
    const xs: number[] = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) xs.push(THREE.MathUtils.lerp(x0, xEnd, i / steps));
    const rings = xs.map((x, i) => axisRing(V(side * x, s(L.shoulderY), 0), 'x', s(rr(x)) * k * 0.95 * (i === 0 ? 1.15 : 1), s(rr(x)) * k * (i === 0 ? 1.15 : 1)));
    outfitParts.push({ geo: loft(rings, { segments: 16 }), mat, bones: [`${n}Shoulder`, `${n}UpperArm`, `${n}LowerArm`, 'upperChest'] });
    if (frac > 0.92) {
      // 袖口
      const rEnd = rings[rings.length - 1];
      outfitParts.push({
        geo: loft([
          { c: rEnd.c.clone().add(V(-side * s(0.006), 0, 0)), u: rEnd.u.clone().multiplyScalar(1.12), v: rEnd.v.clone().multiplyScalar(1.12) },
          { c: rEnd.c.clone().add(V(side * s(0.004), 0, 0)), u: rEnd.u.clone().multiplyScalar(1.12), v: rEnd.v.clone().multiplyScalar(1.12) },
        ], { segments: 16 }),
        mat: mat === 0 ? 1 : 0,
        bones: [`${n}LowerArm`],
      });
    }
  };
  const topPart = (mat: number, fromRow: number, k: number, cap = false) => {
    const rows = scaleRows(torsoRows.slice(fromRow, torsoRows.length - 1), k, 0.002);
    rows.push({ y: L.neckY + 0.0, rx: 0.036 * k, rz: 0.032 * k, z: 0 });
    outfitParts.push({ geo: loft(torsoProfile(rows), { segments: 28, capStart: cap }), mat, bones: torsoBones });
    if (bustK > 0.02) {
      for (const side of [1, -1]) {
        const r = s(0.03 + 0.012 * bustK) * 1.08;
        const c = V(side * s(0.036 * p.chest), s(L.chestY + 0.038), s((0.041 + 0.006 * bustK) * p.chest));
        outfitParts.push({ geo: ellipsoid(c, r * 1.05, r * 0.98, r * (0.55 + 0.25 * bustK), 18, 14), mat, bones: ['chest', 'upperChest', 'spine'] });
      }
    }
  };
  const skirt = (mat: number, len: number, pleats: number, flare: number) => {
    const topY = L.spineY + 0.035;
    const bottomY = L.upperLegY - 0.03 - len * (L.upperLegY - L.kneeY + 0.06);
    const rows: Ring[] = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = THREE.MathUtils.lerp(topY, bottomY, t);
      const hipT = THREE.MathUtils.smoothstep(t, 0, 0.35);
      const rx = THREE.MathUtils.lerp(0.068 * p.waist, 0.092 * p.hip, hipT) + t * 0.03 * flare;
      const rz = THREE.MathUtils.lerp(0.051 * p.waist, 0.068 * p.hip, hipT) + t * 0.03 * flare;
      rows.push(axisRing(V(0, s(y), s(-0.003)), 'y', s(rx), s(rz)));
    }
    outfitParts.push({
      geo: loft(rows, { segments: Math.max(32, pleats * 4), profile: pleats ? (th, ri) => 1 + 0.035 * (ri / steps) * Math.max(0, Math.cos(th * pleats)) : undefined }),
      mat,
      bones: ['hips', 'spine', 'leftUpperLeg', 'rightUpperLeg'],
    });
    return bottomY;
  };
  let pantsBottomY = Infinity;
  const pants = (mat: number, length: number) => {
    // 腰回り
    outfitParts.push({ geo: loft(torsoProfile(scaleRows(torsoRows.slice(0, 4), 1.08, 0.002)), { segments: 28, capStart: true }), mat, bones: torsoBones });
    for (const side of [1, -1] as const) {
      const n = side === 1 ? 'left' : 'right';
      const lt = p.legThickness;
      const endY = THREE.MathUtils.lerp(L.upperLegY - 0.06, L.ankleY + 0.01, length);
      pantsBottomY = Math.min(pantsBottomY, endY);
      const rows: [number, number][] = [
        [L.upperLegY + 0.025, 0.056 * lt],
        [L.upperLegY - 0.04, 0.052 * lt],
        [L.kneeY + 0.05, 0.042 * lt],
        [L.kneeY, 0.038 * lt],
        [L.kneeY - 0.08, 0.037 * lt],
        [L.ankleY + 0.01, 0.032 * lt],
      ].filter(([y]) => y >= endY - 1e-6) as [number, number][];
      if (rows[rows.length - 1][0] > endY + 1e-4) rows.push([endY, rows[rows.length - 1][1] * 0.98]);
      const rings = rows.map(([y, r]) => axisRing(V(side * legX, s(y), 0), 'y', s(r), s(r)));
      outfitParts.push({ geo: loft(rings, { segments: 18 }), mat, bones: ['hips', `${n}UpperLeg`, `${n}LowerLeg`] });
    }
  };
  const socks = (mat: number, topY: number) => {
    for (const side of [1, -1] as const) {
      const n = side === 1 ? 'left' : 'right';
      const lt = p.legThickness;
      const rows: [number, number, number][] = [
        [topY, 0.036 * lt, 0],
        [L.kneeY - 0.06, 0.035 * lt, -0.004],
        [L.ankleY + 0.05, 0.024 * lt, 0],
        [L.ankleY - 0.002, 0.021 * lt, 0],
      ].filter(([y]) => y <= topY + 1e-6) as [number, number, number][];
      const rings = rows.map(([y, r, z]) => axisRing(V(side * legX, s(y), s(z)), 'y', s(r), s(r)));
      outfitParts.push({ geo: loft(rings, { segments: 18 }), mat, bones: [`${n}UpperLeg`, `${n}LowerLeg`, `${n}Foot`] });
    }
  };
  const bow = (c: THREE.Vector3, size: number, mat: number, bonesB: string[]) => {
    for (const side of [1, -1]) {
      outfitParts.push({ geo: ellipsoid(c.clone().add(V(side * size * 0.9, 0, 0)), size, size * 0.6, size * 0.3, 12, 8), mat, bones: bonesB });
      outfitParts.push({
        geo: strand([c.clone(), c.clone().add(V(side * size * 0.5, -size * 1.2, size * 0.1)), c.clone().add(V(side * size * 0.8, -size * 2.2, size * 0.05))], () => size * 0.35, () => size * 0.06, { up: V(0, 0, 1) }),
        mat,
        bones: bonesB,
      });
    }
    outfitParts.push({ geo: ellipsoid(c, size * 0.35, size * 0.4, size * 0.3, 10, 8), mat, bones: bonesB });
  };

  const sl = p.sleeveLength;
  switch (p.outfit) {
    case 'none': {
      // インナー（ワンピース水着風）
      outfitParts.push({ geo: loft(torsoProfile(scaleRows(torsoRows.slice(0, 6), 1.02, 0.0015)), { segments: 28, capStart: true }), mat: 4, bones: torsoBones });
      break;
    }
    case 'uniform': {
      topPart(1, 3, 1.06);
      for (const side of [1, -1] as const) sleeve(side, 1, 0.25 + sl * 0.75, 1.08);
      // セーラー襟
      const collarRows: Ring[] = [];
      const c0y = L.neckY - 0.002;
      const c1y = L.upperChestY - 0.005;
      collarRows.push(axisRing(V(0, s(c0y), 0), 'y', s(0.04), s(0.036)));
      collarRows.push(axisRing(V(0, s((c0y + c1y) / 2 + 0.01), s(-0.004)), 'y', s(0.088 * p.shoulderWidth * 1.08), s(0.05 * 1.12)));
      collarRows.push(axisRing(V(0, s(c1y - 0.004), s(-0.01)), 'y', s(0.085 * p.shoulderWidth * 1.14), s(0.06 + 0.004 * bustK)));
      outfitParts.push({
        geo: loft(collarRows, { segments: 32, profile: (th) => 1 + 0.03 * Math.max(0, -Math.sin(th)) }),
        mat: 0,
        bones: ['upperChest', 'chest', 'neck', 'leftShoulder', 'rightShoulder'],
      });
      bow(V(0, s(L.upperChestY + 0.005), s(0.06 + 0.014 * bustK)), s(0.016), 2, ['upperChest', 'chest']);
      skirt(0, 0.25 + p.skirtLength * 0.75, 12, 1);
      socks(0, L.kneeY - 0.02);
      break;
    }
    case 'casual': {
      topPart(1, 2, 1.055);
      for (const side of [1, -1] as const) sleeve(side, 1, 0.2 + sl * 0.3, 1.1);
      pants(0, 0.15 + p.skirtLength * 0.85);
      // ベルト
      outfitParts.push({ geo: loft(torsoProfile(scaleRows([torsoRows[2], { ...torsoRows[2], y: torsoRows[2].y + 0.012 }], 1.11, 0.003)), { segments: 28 }), mat: 2, bones: ['hips', 'spine'] });
      break;
    }
    case 'dress': {
      topPart(0, 3, 1.05);
      for (const side of [1, -1] as const) if (sl > 0.15) sleeve(side, 0, 0.1 + sl * 0.9, 1.15);
      skirt(0, 0.35 + p.skirtLength * 0.65, 0, 2.2);
      // ウエストリボン
      const wr = torsoRows[3];
      outfitParts.push({ geo: loft(torsoProfile(scaleRows([{ ...wr, y: wr.y - 0.006 }, { ...wr, y: wr.y + 0.01 }], 1.13, 0.003)), { segments: 28 }), mat: 2, bones: ['spine', 'hips'] });
      bow(V(0, s(wr.y + 0.002), s(-wr.rz * 1.15 - 0.002)), s(0.018), 2, ['spine', 'hips']);
      // 襟元
      outfitParts.push({ geo: loft(torsoProfile([{ y: L.neckY - 0.012, rx: 0.05, rz: 0.042 }, { y: L.neckY, rx: 0.038, rz: 0.034 }]), { segments: 24 }), mat: 1, bones: ['upperChest', 'neck'] });
      break;
    }
    case 'hoodie': {
      topPart(0, 1, 1.1, false);
      for (const side of [1, -1] as const) sleeve(side, 0, 0.5 + sl * 0.5, 1.25);
      // フード
      const hc = V(0, s(L.neckY + 0.01), s(-0.03));
      outfitParts.push({ geo: ellipsoid(hc, s(0.075), s(0.045), s(0.045), 20, 12, (v) => { if (v.z > hc.z + s(0.01)) v.z = hc.z + s(0.01) + (v.z - hc.z - s(0.01)) * 0.3; }), mat: 0, bones: ['upperChest', 'neck'] });
      // ひも
      for (const side of [1, -1]) {
        const a = V(side * s(0.015), s(L.neckY - 0.008), s(0.045));
        outfitParts.push({ geo: strand([a, a.clone().add(V(0, -s(0.04), s(0.012 + 0.012 * bustK))), a.clone().add(V(side * s(0.003), -s(0.08), s(0.02 + 0.016 * bustK)))], () => s(0.002), () => s(0.002)), mat: 2, bones: ['upperChest', 'chest'] });
      }
      pants(1, 0.3 + p.skirtLength * 0.7);
      break;
    }
    case 'suit': {
      topPart(0, 1, 1.075);
      for (const side of [1, -1] as const) sleeve(side, 0, 0.6 + sl * 0.4, 1.2);
      // シャツの襟とネクタイ
      const tieTop = V(0, s(L.neckY - 0.01), s(0.038));
      outfitParts.push({ geo: strand([tieTop, tieTop.clone().add(V(0, -s(0.05), s(0.022 + 0.01 * bustK))), tieTop.clone().add(V(0, -s(0.13), s(0.03 + 0.012 * bustK)))], (t) => s(0.006 + 0.008 * t), () => s(0.002), { up: V(0, 0, 1) }), mat: 2, bones: ['upperChest', 'chest', 'spine'] });
      outfitParts.push({ geo: loft(torsoProfile([{ y: L.neckY - 0.015, rx: 0.052, rz: 0.046 }, { y: L.neckY + 0.006, rx: 0.038, rz: 0.034 }]), { segments: 24 }), mat: 1, bones: ['upperChest', 'neck'] });
      pants(0, 1);
      break;
    }
  }
  // 靴
  if (p.shoes !== 'none') {
    for (const side of [1, -1] as const) {
      const n = side === 1 ? 'left' : 'right';
      outfitParts.push({ geo: footGeometry(side * legX, footLen, S, 1.18), mat: 3, bones: [`${n}LowerLeg`, `${n}Foot`, `${n}Toes`] });
      // 長ズボンの下にブーツの筒が来る場合は、裾から飛び出さないよう省略
      if (p.shoes === 'boots' && pantsBottomY > L.kneeY - 0.04) {
        const lt = p.legThickness;
        const rows: [number, number][] = [
          [L.kneeY - 0.025, 0.037 * lt],
          [L.kneeY - 0.06, 0.037 * lt],
          [L.ankleY + 0.05, 0.027 * lt],
          [L.ankleY + 0.005, 0.026 * lt],
        ];
        outfitParts.push({ geo: loft(rows.map(([y, r]) => axisRing(V(side * legX, s(y), 0), 'y', s(r), s(r))), { segments: 18 }), mat: 3, bones: [`${n}UpperLeg`, `${n}LowerLeg`, `${n}Foot`] });
      }
    }
  }

  // ---------------------------------------------------------------- メッシュ組み立て
  const root = new THREE.Group();
  root.name = p.name || 'Avatar';
  root.add(bones.hips);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneList);

  const skin = (parts: Part[], keep: string[] = []) => {
    for (const part of parts) {
      normalizeAttributes(part.geo, keep);
      computeWeights(part.geo, part.force ? [part.force] : part.bones ?? ['hips'], segs, boneIndex);
    }
  };

  const meshes: THREE.SkinnedMesh[] = [];
  const makeSkinned = (name: string, parts: Part[], mats: THREE.Material[]) => {
    if (!parts.length) return null;
    const byMat = new Map<number, THREE.BufferGeometry[]>();
    for (const part of parts) {
      if (!byMat.has(part.mat)) byMat.set(part.mat, []);
      byMat.get(part.mat)!.push(part.geo);
    }
    const order = [...byMat.keys()].sort((a, b) => a - b);
    const merged = order.map((k) => mergeGeometries(byMat.get(k)!, false)!);
    const geo = mergeGeometries(merged, true)!;
    fixNormals(geo);
    const usedMats = order.map((k) => mats[k]);
    geo.groups.forEach((g, i) => (g.materialIndex = i));
    const mesh = new THREE.SkinnedMesh(geo, usedMats);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
    meshes.push(mesh);
    return mesh;
  };

  // 体
  skin(bodyParts);
  makeSkinned('Body', bodyParts, [skinMat]);

  // 顔
  const faceMats = [
    makeMaterial('#ffffff', { toon, name: 'EyeWhite', unlit: true }),
    makeMaterial('#ffffff', { toon, name: 'Iris', unlit: true, map: irisTexture(p.eyeColor, p.eyeColor2) }),
    makeMaterial(shadeOf(p.hairColor, 0.45, 0), { toon, name: 'EyeLine', unlit: true }),
    makeMaterial('#a8323f', { toon, name: 'Mouth', unlit: true }),
    makeMaterial('#ff7f8f', { toon, name: 'Blush', unlit: true, transparent: true, opacity: 0.45, map: blushTexture() }),
    makeMaterial(shadeOf(p.skinColor, 0.8, 0), { toon, name: 'FaceShade', unlit: true, transparent: true, opacity: 0.6 }),
  ];
  if (!(faceMats[1] as THREE.MeshBasicMaterial).map) (faceMats[1] as THREE.MeshBasicMaterial).color.set(p.eyeColor);
  for (const f of facePartsList) {
    const g = f.geo;
    const n = g.attributes.position.count;
    const meta = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) meta.set(f.meta.slice(0, 6), i * 6);
    g.setAttribute('faceMetaA', new THREE.BufferAttribute(meta.filter((_, i) => i % 6 < 3), 3));
    g.setAttribute('faceMetaB', new THREE.BufferAttribute(meta.filter((_, i) => i % 6 >= 3), 3));
  }
  const faceParts: Part[] = facePartsList.map((f) => ({ geo: f.geo, mat: f.mat, force: f.force ?? 'head' }));
  skin(faceParts, ['faceMetaA', 'faceMetaB']);
  const faceMesh = makeSkinned('Face', faceParts, faceMats)!;
  addFaceMorphs(faceMesh, faceMats.length);

  // 髪
  const hairMats = [
    makeMaterial('#ffffff', { toon, name: 'Hair', vertexColors: true, shadeColor: shadeOf(p.hairColor, 0.6, 0) }),
    makeMaterial(p.accentColor, { toon, name: 'HairAccessory' }),
    makeMaterial('#ffb0c8', { toon, name: 'EarInner' }),
  ];
  const hairTopY = headC.y + hry * 1.1;
  const hairBotY = Math.min(longEndY, headC.y - hry);
  for (const part of hairParts) {
    const pos = part.geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c1 = new THREE.Color(p.hairColor);
    const c2 = new THREE.Color(p.hairColor2);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.smoothstep(pos.getY(i), hairTopY, hairBotY);
      const k = THREE.MathUtils.clamp((hairTopY - pos.getY(i)) / (hairTopY - hairBotY), 0, 1);
      c.copy(c1).lerp(c2, Math.pow(k, 1.6) * 0.85 + t * 0);
      col.set([c.r, c.g, c.b], i * 3);
    }
    part.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  skin(hairParts, ['color']);
  makeSkinned('Hair', hairParts, hairMats);

  // 衣装
  const outfitMats = [
    makeMaterial(p.outfitColor, { toon, name: 'OutfitMain', roughness: 0.8 }),
    makeMaterial(p.outfitColor2, { toon, name: 'OutfitSub', roughness: 0.8 }),
    makeMaterial(p.accentColor, { toon, name: 'OutfitAccent', roughness: 0.5 }),
    makeMaterial(p.shoeColor, { toon, name: 'Shoes', roughness: 0.4 }),
    makeMaterial(p.outfitColor2, { toon, name: 'Inner', roughness: 0.6 }),
  ];
  skin(outfitParts);
  makeSkinned('Outfit', outfitParts, outfitMats);

  // ---------------------------------------------------------------- アウトライン
  const outlines: THREE.SkinnedMesh[] = [];
  const outlineColor = shadeOf(p.hairColor, 0.35, 0.02);
  for (const m of meshes) {
    if (m === faceMesh) continue;
    const hull = new THREE.SkinnedMesh(m.geometry, outlineMaterial(outlineColor, s(0.0011)));
    hull.name = m.name + '_Outline';
    hull.userData.outlineHull = true;
    hull.frustumCulled = false;
    hull.visible = p.outline;
    root.add(hull);
    hull.bind(skeleton, new THREE.Matrix4());
    outlines.push(hull);
  }

  // ---------------------------------------------------------------- 揺れ物 & コライダー
  const springs: SpringChain[] = chainDefs.map((c) => ({
    name: c.name,
    bones: c.points.map((_, i) => bones[`hair_${c.name}_${i}`]),
    stiffness: c.stiffness,
    gravityPower: c.gravity,
    dragForce: c.drag,
    hitRadius: s(0.012),
  }));
  const colliders: SphereCollider[] = [
    { bone: bones.head, offset: headC.clone().sub(bonePos.head), radius: Math.max(hrx, hrz) * 1.02 },
    { bone: bones.upperChest, offset: V(0, s(0.01), -s(0.005)), radius: s(0.07) },
    { bone: bones.chest, offset: V(0, 0, -s(0.004)), radius: s(0.065) },
    { bone: bones.hips, offset: V(0, -s(0.01), -s(0.004)), radius: s(0.08 * p.hip) },
    { bone: bones.leftShoulder, offset: V(s(0.045), 0, 0), radius: s(0.035) },
    { bone: bones.rightShoulder, offset: V(-s(0.045), 0, 0), radius: s(0.035) },
  ];

  root.userData.kuroiAvatar = true;
  return {
    root,
    skeleton,
    bones,
    meshes,
    outlines,
    faceMesh,
    springs,
    colliders,
    eyeOffset: V(0, eyeBoneY - bonePos.head.y, hrz),
    height: p.height,
  };
}

// =====================================================================================

function shadeOf(hex: string, mul: number, add: number): string {
  const c = new THREE.Color(hex);
  c.multiplyScalar(mul);
  c.r = THREE.MathUtils.clamp(c.r + add, 0, 1);
  c.g = THREE.MathUtils.clamp(c.g + add, 0, 1);
  c.b = THREE.MathUtils.clamp(c.b + add, 0, 1);
  return '#' + c.getHexString();
}

/** アニメ調の頭部: あごを細く、後頭部をふくらませる */
function headGeometry(c: THREE.Vector3, rx: number, ry: number, rz: number, p: AvatarParams) {
  const g = new THREE.SphereGeometry(1, 40, 32);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let { x, y, z } = v;
    if (y < 0) {
      const t = -y;
      const narrow = 1 - (0.16 + 0.24 * p.chin) * Math.pow(t, 2.4) + 0.06 * p.cheek * Math.sin(Math.PI * Math.min(1, t * 1.3));
      x *= narrow;
      z *= z > 0 ? 1 - 0.1 * t * t : 1 - 0.4 * Math.pow(t, 1.4);
      y *= 1 + 0.1 * t * (0.6 + 0.4 * p.chin);
      if (z > 0) z += 0.05 * t * t * p.chin;
    }
    if (z < 0) z *= 1.06;
    pos.setXYZ(i, c.x + x * rx, c.y + y * ry, c.z + z * rz);
  }
  g.computeVertexNormals();
  return g;
}

/** 白目: 上辺を少し平たく */
function shapeEye(g: THREE.BufferGeometry, cx: number, cy: number, w: number, _h: number, side: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    const nx = ((x - cx) / w) * side;
    if (y > cy) y = cy + (y - cy) * (0.92 - 0.08 * nx);
    else y = cy + (y - cy) * (1 - 0.1 * Math.abs(nx));
    pos.setY(i, y);
  }
}

/** 瞳を白目の範囲に収める */
function clipToEye(g: THREE.BufferGeometry, cx: number, cy: number, w: number, h: number, _side: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const dx = (x - cx) / (w * 0.98);
    const dy = (y - cy) / (h * 0.9);
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 1) pos.setXY(i, cx + (x - cx) / d, cy + (y - cy) / d);
  }
}

function handGeometry(side: number, wristX: number, y: number, len: number, S: number) {
  const s = (n: number) => n * S;
  const rows: [number, number, number][] = [
    [0, 0.012, 0.016],
    [0.25, 0.011, 0.022],
    [0.5, 0.0095, 0.022],
    [0.7, 0.008, 0.02],
    [0.88, 0.0065, 0.018],
    [1, 0.003, 0.012],
  ];
  const rings = rows.map(([t, ry, rz]) => ({
    c: new THREE.Vector3(side * (wristX + len * t), y - s(0.002), 0),
    u: new THREE.Vector3(0, 0, s(rz)),
    v: new THREE.Vector3(0, s(ry), 0),
  }));
  const palm = loft(rings, { segments: 16, capStart: true, capEnd: true });
  const tb = new THREE.Vector3(side * (wristX + len * 0.18), y - s(0.004), s(0.014));
  const thumb = strand(
    [tb, tb.clone().add(new THREE.Vector3(side * len * 0.2, -s(0.004), s(0.014))), tb.clone().add(new THREE.Vector3(side * len * 0.42, -s(0.006), s(0.018)))],
    (t) => s(0.0068) * (1 - t * 0.35),
    (t) => s(0.0062) * (1 - t * 0.35),
    { up: new THREE.Vector3(0, 1, 0), segments: 10 },
  );
  return mergeGeometries([normalizeAttributes(palm), normalizeAttributes(thumb)], false)!;
}

function footGeometry(x: number, footLen: number, S: number, k: number) {
  const s = (n: number) => n * S;
  const rows: [number, number, number, number][] = [
    // z, y, rx, ry
    [-0.25, 0.025, 0.017, 0.02],
    [0.0, 0.032, 0.021, 0.03],
    [0.35, 0.022, 0.024, 0.02],
    [0.7, 0.014, 0.025, 0.013],
    [0.95, 0.011, 0.019, 0.009],
  ];
  const rings = rows.map(([z, y, rx, ry]) =>
    axisRing(new THREE.Vector3(x, s(y) * (k > 1 ? 0.95 : 1), footLen * z * (k > 1 ? 1.05 : 1) - (k > 1 ? s(0.003) : 0)), 'z', s(rx) * k, s(ry) * k),
  );
  const g = loft(rings, { segments: 16, capStart: true, capEnd: true });
  // 足裏を平らに
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < 0.0005) pos.setY(i, k > 1 ? -0.0005 : 0.0015);
  g.computeVertexNormals();
  return g;
}

/** 髪のベース（頭皮を覆うキャップ）。生え際より下の頂点は頭の内側へ押し込む */
function hairCap(c: THREE.Vector3, rx: number, ry: number, rz: number, p: AvatarParams) {
  const g = new THREE.SphereGeometry(1, 40, 28);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const backLow = p.hairStyle === 'short' || p.hairStyle === 'bob' || p.hairStyle === 'long' ? -0.62 : -0.45;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const phi = Math.atan2(v.x, v.z); // 0 = 正面
    const front = (Math.cos(phi) + 1) / 2; // 1 = 正面, 0 = 背面
    const line = THREE.MathUtils.lerp(backLow, 0.32, Math.pow(front, 1.5));
    let k = 1;
    if (v.y < line) k = 0.86;
    else if (v.y < line + 0.12) k = THREE.MathUtils.lerp(0.86, 1, (v.y - line) / 0.12);
    // 後頭部はふくらませる
    const puff = v.z < 0 ? 1 + 0.04 * -v.z : 1;
    pos.setXYZ(i, c.x + v.x * rx * k * puff, c.y + v.y * ry * k * (v.y > 0 ? 1.02 : 1), c.z + v.z * rz * k * puff);
  }
  g.computeVertexNormals();
  return g;
}

const _ap = new THREE.Vector3();
const _seg = new THREE.Vector3();
/** 骨セグメントへの距離（骨の太さを差し引く）からスキンウェイトを算出 */
function computeWeights(
  g: THREE.BufferGeometry,
  cands: string[],
  segs: Record<string, BoneSeg>,
  boneIndex: Record<string, number>,
) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  const v = new THREE.Vector3();
  const list = cands.filter((c) => segs[c]);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    const ws: [number, number][] = [];
    for (const name of list) {
      const sg = segs[name];
      let d: number;
      _seg.subVectors(sg.end, sg.start);
      const len2 = _seg.lengthSq();
      if (len2 < 1e-10) d = v.distanceTo(sg.start);
      else {
        const t = THREE.MathUtils.clamp(_ap.subVectors(v, sg.start).dot(_seg) / len2, 0, 1);
        d = v.distanceTo(_ap.copy(sg.start).addScaledVector(_seg, t));
      }
      const e = Math.max(d - sg.radius, 0) + 0.006;
      ws.push([boneIndex[name], Math.pow(e, -5)]);
    }
    ws.sort((a, b) => b[1] - a[1]);
    const top = ws.slice(0, 4);
    const sum = top.reduce((a, b) => a + b[1], 0) || 1;
    for (let k = 0; k < 4; k++) {
      if (top[k]) {
        si[i * 4 + k] = top[k][0];
        sw[i * 4 + k] = top[k][1] / sum;
      }
    }
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}

/** 顔メッシュに VRM プリセット表情のモーフターゲットを追加 */
function addFaceMorphs(mesh: THREE.SkinnedMesh, _matCount: number) {
  const g = mesh.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const A = g.attributes.faceMetaA as THREE.BufferAttribute; // type, side, cx
  const B = g.attributes.faceMetaB as THREE.BufferAttribute; // cy, w, h
  const n = pos.count;
  type Fn = (x: number, y: number, z: number, type: number, side: number, cx: number, cy: number, w: number, h: number) => [number, number, number];
  const clamp = THREE.MathUtils.clamp;

  const closeEye = (x: number, y: number, cx: number, cy: number, w: number, h: number) => {
    const nx = clamp((x - cx) / w, -1.2, 1.2);
    return cy - h * 0.42 + h * 0.14 * nx * nx + (y - cy) * 0.05;
  };
  const archEye = (x: number, y: number, cx: number, cy: number, w: number, h: number) => {
    const nx = clamp((x - cx) / w, -1.2, 1.2);
    return cy - h * 0.05 - h * 0.32 * nx * nx + (y - cy) * 0.05;
  };
  const isEye = (t: number) => t >= 1 && t <= 3;

  const defs: Record<string, Fn> = {
    blink: (x, y, z, t, _s, cx, cy, w, h) => (isEye(t) ? [x, closeEye(x, y, cx, cy, w, h), z + 0.0004] : t === 4 ? [x, y - h * 0.08, z] : [x, y, z]),
    blinkLeft: (x, y, z, t, s, cx, cy, w, h) => (isEye(t) && s > 0 ? [x, closeEye(x, y, cx, cy, w, h), z + 0.0004] : [x, y, z]),
    blinkRight: (x, y, z, t, s, cx, cy, w, h) => (isEye(t) && s < 0 ? [x, closeEye(x, y, cx, cy, w, h), z + 0.0004] : [x, y, z]),
    happy: (x, y, z, t, _s, cx, cy, w, h) => {
      if (isEye(t)) return [x, archEye(x, y, cx, cy, w, h), z + 0.0004];
      if (t === 4) return [x, y + h * 0.12, z];
      if (t === 5) {
        const nx = clamp((x - cx) / w, -1, 1);
        const ny = y - cy;
        return [cx + (x - cx) * 1.1, cy + (ny < 0 ? ny * 7 : ny * 1.5) + h * 2.2 * nx * nx - h * 0.6, z + 0.0006];
      }
      return [x, y, z];
    },
    angry: (x, y, z, t, s, cx, cy, w, h) => {
      if (isEye(t)) {
        const nx = ((x - cx) / w) * s;
        const top = y > cy ? cy + (y - cy) * 0.62 - h * 0.12 * (1 - nx) * 0.5 : y;
        return [x, top, z];
      }
      if (t === 4) {
        const inner = clamp((1 + (s * (cx - x)) / w) / 2, 0, 1);
        return [x, y - h * 0.5 * inner + h * 0.05, z];
      }
      if (t === 5) {
        const nx = clamp((x - cx) / w, -1, 1);
        return [cx + (x - cx) * 0.8, cy + (y - cy) * 1.8 - h * 1.2 * nx * nx, z + 0.0004];
      }
      return [x, y, z];
    },
    sad: (x, y, z, t, s, cx, cy, w, h) => {
      if (isEye(t)) {
        const nx = ((x - cx) / w) * s;
        return [x, y > cy ? cy + (y - cy) * 0.75 - h * 0.1 * (1 + nx) * 0.5 : y, z];
      }
      if (t === 4) {
        const inner = clamp((1 + (s * (cx - x)) / w) / 2, 0, 1);
        return [x, y + h * 0.45 * inner - h * 0.1, z];
      }
      if (t === 5) {
        const nx = clamp((x - cx) / w, -1, 1);
        return [cx + (x - cx) * 0.85, cy + (y - cy) * 1.3 - h * 1.6 * nx * nx + h * 0.6, z + 0.0004];
      }
      return [x, y, z];
    },
    relaxed: (x, y, z, t, _s, cx, cy, w, h) => {
      if (isEye(t)) return [x, y > cy - h * 0.1 ? cy - h * 0.1 + (y - cy + h * 0.1) * 0.45 : y, z + 0.0002];
      if (t === 5) {
        const nx = clamp((x - cx) / w, -1, 1);
        return [x, y + h * 1.0 * nx * nx - h * 0.3, z + 0.0004];
      }
      return [x, y, z];
    },
    surprised: (x, y, z, t, _s, cx, cy, _w, h) => {
      if (isEye(t)) return [cx + (x - cx) * 1.06, cy + (y - cy) * 1.12, z + 0.0005];
      if (t === 4) return [x, y + h * 0.35, z];
      if (t === 5) return [cx + (x - cx) * 0.55, cy + (y - cy) * 5, z + 0.0006];
      return [x, y, z];
    },
    aa: (x, y, z, t, _s, cx, cy) => (t === 5 ? [cx + (x - cx) * 0.9, cy + (y - cy) * 6.5, z + 0.0006] : [x, y, z]),
    ih: (x, y, z, t, _s, cx, cy) => (t === 5 ? [cx + (x - cx) * 1.15, cy + (y - cy) * 2.6, z + 0.0006] : [x, y, z]),
    ou: (x, y, z, t, _s, cx, cy) => (t === 5 ? [cx + (x - cx) * 0.45, cy + (y - cy) * 4.2, z + 0.0006] : [x, y, z]),
    ee: (x, y, z, t, _s, cx, cy) => (t === 5 ? [cx + (x - cx) * 1.25, cy + (y - cy) * 3.2, z + 0.0006] : [x, y, z]),
    oh: (x, y, z, t, _s, cx, cy) => (t === 5 ? [cx + (x - cx) * 0.7, cy + (y - cy) * 5.5, z + 0.0006] : [x, y, z]),
  };
  const morphs: THREE.BufferAttribute[] = [];
  const dict: Record<string, number> = {};
  for (const name of EXPRESSIONS) {
    const fn = defs[name];
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = fn(pos.getX(i), pos.getY(i), pos.getZ(i), Math.round(A.getX(i)), A.getY(i), A.getZ(i), B.getX(i), B.getY(i), B.getZ(i));
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.name = name;
    dict[name] = morphs.length;
    morphs.push(attr);
  }
  g.morphAttributes.position = morphs;
  g.deleteAttribute('faceMetaA');
  g.deleteAttribute('faceMetaB');
  mesh.updateMorphTargets();
  mesh.morphTargetDictionary = dict;
  mesh.morphTargetInfluences = new Array(morphs.length).fill(0);
}


/**
 * メッシュ前面（+Z 方向から見える面）への高速な投影。
 * XY 平面で三角形をグリッドに分類し、Z 方向のレイキャストを近似なしで解く。
 */
class FrontSurface {
  private tris: Float32Array;
  private normals: Float32Array;
  private bins: number[][];
  private minX: number;
  private minY: number;
  private cw: number;
  private ch: number;
  constructor(g: THREE.BufferGeometry, private res: number) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const idx = g.index!;
    const tris: number[] = [];
    const nrms: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i));
      b.fromBufferAttribute(pos, idx.getX(i + 1));
      c.fromBufferAttribute(pos, idx.getX(i + 2));
      n.subVectors(c, b).cross(_ap.subVectors(a, b)).normalize();
      if (n.z <= 0.02) continue;
      tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      nrms.push(n.x, n.y, n.z);
    }
    this.tris = new Float32Array(tris);
    this.normals = new Float32Array(nrms);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    this.minX = bb.min.x;
    this.minY = bb.min.y;
    this.cw = (bb.max.x - bb.min.x) / res || 1;
    this.ch = (bb.max.y - bb.min.y) / res || 1;
    this.bins = Array.from({ length: res * res }, () => []);
    const T = this.tris;
    for (let t = 0; t < T.length / 9; t++) {
      const xs = [T[t * 9], T[t * 9 + 3], T[t * 9 + 6]];
      const ys = [T[t * 9 + 1], T[t * 9 + 4], T[t * 9 + 7]];
      const x0 = this.cell(Math.min(...xs), this.minX, this.cw);
      const x1 = this.cell(Math.max(...xs), this.minX, this.cw);
      const y0 = this.cell(Math.min(...ys), this.minY, this.ch);
      const y1 = this.cell(Math.max(...ys), this.minY, this.ch);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.bins[y * res + x].push(t);
    }
  }
  private cell(v: number, min: number, size: number) {
    return THREE.MathUtils.clamp(Math.floor((v - min) / size), 0, this.res - 1);
  }
  query(x: number, y: number, out: THREE.Vector3, normal: THREE.Vector3): boolean {
    const bin = this.bins[this.cell(y, this.minY, this.ch) * this.res + this.cell(x, this.minX, this.cw)];
    const T = this.tris;
    let best = -Infinity;
    for (const t of bin) {
      const o = t * 9;
      const ax = T[o], ay = T[o + 1], bx = T[o + 3], by = T[o + 4], cx = T[o + 6], cy = T[o + 7];
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-14) continue;
      const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
      const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const z = l1 * T[o + 2] + l2 * T[o + 5] + l3 * T[o + 8];
      if (z > best) {
        best = z;
        normal.set(this.normals[t * 3], this.normals[t * 3 + 1], this.normals[t * 3 + 2]);
      }
    }
    if (best === -Infinity) return false;
    out.set(x, y, best);
    return true;
  }
}

/** 退化三角形で生じたゼロ長の法線を補修（glTF は正規化済み法線が必須） */
function fixNormals(g: THREE.BufferGeometry) {
  const n = g.attributes.normal as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i);
    const l = v.length();
    if (l < 1e-6 || !isFinite(l)) v.set(0, 1, 0);
    else v.divideScalar(l);
    n.setXYZ(i, v.x, v.y, v.z);
  }
}
