import * as THREE from 'three';

/** ボーン名 → [x, y, z]（度） */
export type Pose = Record<string, [number, number, number]>;

const armsDown = (a = 68): Pose => ({
  leftUpperArm: [0, 0, -a],
  rightUpperArm: [0, 0, a],
  leftLowerArm: [0, -8, 0],
  rightLowerArm: [0, 8, 0],
});

export const POSES: Record<string, Pose> = {
  'Tポーズ': {},
  'Aポーズ': armsDown(45),
  '自然体': {
    ...armsDown(70),
    leftHand: [0, 0, -8],
    rightHand: [0, 0, 8],
    head: [-3, 0, 2],
    spine: [-2, 0, 0],
  },
  'ピース': {
    ...armsDown(70),
    rightUpperArm: [-20, 30, -15],
    rightLowerArm: [0, 95, 20],
    rightHand: [0, 0, 10],
    head: [0, 0, 8],
    spine: [0, 0, -3],
  },
  '手を振る': {
    ...armsDown(70),
    rightUpperArm: [0, 10, -45],
    rightLowerArm: [0, 0, -70],
    head: [0, -8, 4],
  },
  '腰に手': {
    leftUpperArm: [0, -10, -55],
    rightUpperArm: [0, 10, 55],
    leftLowerArm: [0, 110, 0],
    rightLowerArm: [0, -110, 0],
    hips: [0, 0, 4],
    spine: [0, 0, -4],
    head: [0, 0, 5],
  },
  'お辞儀': {
    ...armsDown(78),
    spine: [18, 0, 0],
    chest: [12, 0, 0],
    neck: [10, 0, 0],
    head: [8, 0, 0],
  },
  'バンザイ': {
    leftUpperArm: [0, 0, 70],
    rightUpperArm: [0, 0, -70],
    head: [-10, 0, 0],
    chest: [-5, 0, 0],
  },
  '考える': {
    ...armsDown(70),
    rightUpperArm: [-30, 20, 45],
    rightLowerArm: [0, 135, 0],
    leftUpperArm: [-15, -20, -60],
    leftLowerArm: [0, -100, 0],
    head: [8, 10, 10],
  },
  '座る': {
    ...armsDown(72),
    leftUpperLeg: [-88, 0, -3],
    rightUpperLeg: [-88, 0, 3],
    leftLowerLeg: [88, 0, 0],
    rightLowerLeg: [88, 0, 0],
    leftUpperArm: [-25, 0, -72],
    rightUpperArm: [-25, 0, 72],
  },
};

const _e = new THREE.Euler();
export function poseQuat(r: [number, number, number]) {
  const d = THREE.MathUtils.degToRad;
  return new THREE.Quaternion().setFromEuler(_e.set(d(r[0]), d(r[1]), d(r[2]), 'XYZ'));
}

export function applyPose(bones: Record<string, THREE.Bone>, pose: Pose, restPositions?: Record<string, THREE.Vector3>) {
  for (const [name, b] of Object.entries(bones)) {
    if (name.startsWith('hair_')) continue;
    const r = pose[name];
    b.quaternion.copy(r ? poseQuat(r) : new THREE.Quaternion());
    if (restPositions?.[name]) b.position.copy(restPositions[name]);
  }
}

interface Key {
  t: number;
  pose: Pose;
  hipsY?: number;
}

function makeClip(name: string, duration: number, keys: Key[]): THREE.AnimationClip {
  const boneNames = new Set<string>();
  keys.forEach((k) => Object.keys(k.pose).forEach((b) => boneNames.add(b)));
  const tracks: THREE.KeyframeTrack[] = [];
  for (const b of boneNames) {
    const times: number[] = [];
    const values: number[] = [];
    for (const k of keys) {
      times.push(k.t);
      const q = poseQuat(k.pose[b] ?? [0, 0, 0]);
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, values));
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

/** hips の上下動トラックを追加（rest 位置基準） */
function withHips(clip: THREE.AnimationClip, hipsRest: THREE.Vector3, keys: { t: number; dy: number; dx?: number }[]) {
  const times = keys.map((k) => k.t);
  const values = keys.flatMap((k) => [hipsRest.x + (k.dx ?? 0), hipsRest.y + k.dy, hipsRest.z]);
  clip.tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, values));
  return clip;
}

export function buildClips(hipsRest: THREE.Vector3, height: number): THREE.AnimationClip[] {
  const h = height / 1.6;
  const base = POSES['自然体'];
  const idle = withHips(
    makeClip('待機', 4, [
      { t: 0, pose: { ...base, chest: [0, 0, 0], head: [-3, 0, 2] } },
      { t: 1, pose: { ...base, chest: [-2.5, 0, 0], spine: [-1, 0, 1], head: [-4, 3, 3], leftUpperArm: [0, 0, -72], rightUpperArm: [0, 0, 72] } },
      { t: 2, pose: { ...base, chest: [0, 0, 0], head: [-3, 0, 2] } },
      { t: 3, pose: { ...base, chest: [-2.5, 0, 0], spine: [-1, 0, -1], head: [-2, -3, 0], leftUpperArm: [0, 0, -71], rightUpperArm: [0, 0, 71] } },
      { t: 4, pose: { ...base, chest: [0, 0, 0], head: [-3, 0, 2] } },
    ]),
    hipsRest,
    [
      { t: 0, dy: 0 },
      { t: 1, dy: -0.004 * h },
      { t: 2, dy: 0 },
      { t: 3, dy: -0.004 * h },
      { t: 4, dy: 0 },
    ],
  );

  const wave = (a: number): Pose => ({
    ...base,
    rightUpperArm: [0, 10, -48],
    rightLowerArm: [0, 0, a],
    rightHand: [0, 0, a / 4],
    head: [0, -8, 6],
    spine: [0, 0, -2],
  });
  const waveClip = makeClip('手を振る', 1.6, [
    { t: 0, pose: wave(-55) },
    { t: 0.4, pose: wave(-95) },
    { t: 0.8, pose: wave(-55) },
    { t: 1.2, pose: wave(-95) },
    { t: 1.6, pose: wave(-55) },
  ]);

  const walkPose = (s: number): Pose => ({
    leftUpperLeg: [-28 * s, 0, 0],
    rightUpperLeg: [28 * s, 0, 0],
    leftLowerLeg: [s < 0 ? 40 : 8, 0, 0],
    rightLowerLeg: [s > 0 ? 40 : 8, 0, 0],
    leftFoot: [s > 0 ? -5 : 10, 0, 0],
    rightFoot: [s < 0 ? -5 : 10, 0, 0],
    leftUpperArm: [22 * s, 0, -72],
    rightUpperArm: [-22 * s, 0, 72],
    leftLowerArm: [0, -18, 0],
    rightLowerArm: [0, 18, 0],
    spine: [3, 6 * s, 0],
    chest: [0, -8 * s, 0],
    head: [-2, 2 * s, 0],
  });
  const walkMid = (s: number): Pose => ({
    leftUpperLeg: [s > 0 ? -10 : 5, 0, 0],
    rightUpperLeg: [s > 0 ? 5 : -10, 0, 0],
    leftLowerLeg: [s > 0 ? 50 : 5, 0, 0],
    rightLowerLeg: [s > 0 ? 5 : 50, 0, 0],
    leftUpperArm: [0, 0, -72],
    rightUpperArm: [0, 0, 72],
    leftLowerArm: [0, -15, 0],
    rightLowerArm: [0, 15, 0],
    spine: [3, 0, 0],
    chest: [0, 0, 0],
    head: [-2, 0, 0],
  });
  const walk = withHips(
    makeClip('歩く', 1.1, [
      { t: 0, pose: walkPose(1) },
      { t: 0.275, pose: walkMid(-1) },
      { t: 0.55, pose: walkPose(-1) },
      { t: 0.825, pose: walkMid(1) },
      { t: 1.1, pose: walkPose(1) },
    ]),
    hipsRest,
    [
      { t: 0, dy: -0.012 * h },
      { t: 0.275, dy: 0.004 * h },
      { t: 0.55, dy: -0.012 * h },
      { t: 0.825, dy: 0.004 * h },
      { t: 1.1, dy: -0.012 * h },
    ],
  );

  const dancePose = (s: number, up: boolean): Pose => ({
    hips: [0, 10 * s, 6 * s],
    spine: [0, -6 * s, -5 * s],
    chest: [0, -6 * s, -4 * s],
    head: [0, 8 * s, 8 * s],
    leftUpperArm: up ? [0, 0, s > 0 ? 40 : -30] : [-30, 0, -60],
    rightUpperArm: up ? [0, 0, s > 0 ? 30 : -40] : [-30, 0, 60],
    leftLowerArm: [0, up ? -40 : -90, 0],
    rightLowerArm: [0, up ? 40 : 90, 0],
    leftUpperLeg: [s > 0 ? -15 : 0, 0, -4],
    rightUpperLeg: [s < 0 ? -15 : 0, 0, 4],
    leftLowerLeg: [s > 0 ? 30 : 5, 0, 0],
    rightLowerLeg: [s < 0 ? 30 : 5, 0, 0],
  });
  const dance = withHips(
    makeClip('ダンス', 2, [
      { t: 0, pose: dancePose(1, false) },
      { t: 0.5, pose: dancePose(-1, true) },
      { t: 1, pose: dancePose(-1, false) },
      { t: 1.5, pose: dancePose(1, true) },
      { t: 2, pose: dancePose(1, false) },
    ]),
    hipsRest,
    [
      { t: 0, dy: -0.03 * h, dx: 0.01 * h },
      { t: 0.25, dy: 0 },
      { t: 0.5, dy: -0.03 * h, dx: -0.01 * h },
      { t: 0.75, dy: 0 },
      { t: 1, dy: -0.03 * h, dx: -0.01 * h },
      { t: 1.25, dy: 0 },
      { t: 1.5, dy: -0.03 * h, dx: 0.01 * h },
      { t: 1.75, dy: 0 },
      { t: 2, dy: -0.03 * h, dx: 0.01 * h },
    ],
  );

  const bowClip = makeClip('お辞儀', 3, [
    { t: 0, pose: base },
    { t: 0.8, pose: POSES['お辞儀'] },
    { t: 1.8, pose: POSES['お辞儀'] },
    { t: 2.6, pose: base },
    { t: 3, pose: base },
  ]);

  const jumpClip = withHips(
    makeClip('ジャンプ', 1.2, [
      { t: 0, pose: base },
      { t: 0.25, pose: { ...base, leftUpperLeg: [-35, 0, 0], rightUpperLeg: [-35, 0, 0], leftLowerLeg: [60, 0, 0], rightLowerLeg: [60, 0, 0], spine: [15, 0, 0], leftUpperArm: [30, 0, -70], rightUpperArm: [30, 0, 70] } },
      { t: 0.55, pose: { leftUpperArm: [0, 0, 60], rightUpperArm: [0, 0, -60], head: [-10, 0, 0], leftLowerLeg: [20, 0, 0], rightLowerLeg: [20, 0, 0] } },
      { t: 0.85, pose: { ...base, leftUpperLeg: [-20, 0, 0], rightUpperLeg: [-20, 0, 0], leftLowerLeg: [35, 0, 0], rightLowerLeg: [35, 0, 0], spine: [8, 0, 0] } },
      { t: 1.2, pose: base },
    ]),
    hipsRest,
    [
      { t: 0, dy: 0 },
      { t: 0.25, dy: -0.07 * h },
      { t: 0.55, dy: 0.22 * h },
      { t: 0.85, dy: -0.04 * h },
      { t: 1.2, dy: 0 },
    ],
  );

  return [idle, waveClip, walk, dance, bowClip, jumpClip];
}
