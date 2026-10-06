import * as THREE from 'three';
import { makeMaterial } from '../avatar/materials';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  int?: boolean;
}

export interface PrimitiveDef {
  label: string;
  icon: string;
  params: Record<string, number>;
  defs: ParamDef[];
  build(p: Record<string, number>): THREE.BufferGeometry;
}

const seg = (key: string, label: string, min: number, max: number): ParamDef => ({ key, label, min, max, step: 1, int: true });
const len = (key: string, label: string, min = 0.01, max = 4): ParamDef => ({ key, label, min, max, step: 0.01 });

function starShape(points: number, outer: number, inner: number) {
  const s = new THREE.Shape();
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return s;
}

function heartShape(size: number) {
  const s = new THREE.Shape();
  const k = size / 1.2;
  s.moveTo(0, -0.6 * k);
  s.bezierCurveTo(-0.9 * k, 0.0, -0.75 * k, 0.75 * k, 0, 0.4 * k);
  s.bezierCurveTo(0.75 * k, 0.75 * k, 0.9 * k, 0.0, 0, -0.6 * k);
  return s;
}

export const PRIMITIVES: Record<string, PrimitiveDef> = {
  box: {
    label: '立方体',
    icon: '◼',
    params: { width: 0.5, height: 0.5, depth: 0.5, segments: 1 },
    defs: [len('width', '幅'), len('height', '高さ'), len('depth', '奥行'), seg('segments', '分割', 1, 32)],
    build: (p) => new THREE.BoxGeometry(p.width, p.height, p.depth, p.segments, p.segments, p.segments),
  },
  sphere: {
    label: '球',
    icon: '●',
    params: { radius: 0.3, widthSegments: 48, heightSegments: 32 },
    defs: [len('radius', '半径'), seg('widthSegments', '横分割', 3, 128), seg('heightSegments', '縦分割', 2, 96)],
    build: (p) => new THREE.SphereGeometry(p.radius, p.widthSegments, p.heightSegments),
  },
  cylinder: {
    label: '円柱',
    icon: '▮',
    params: { radiusTop: 0.25, radiusBottom: 0.25, height: 0.6, radialSegments: 40 },
    defs: [len('radiusTop', '上半径', 0, 4), len('radiusBottom', '下半径', 0, 4), len('height', '高さ'), seg('radialSegments', '分割', 3, 128)],
    build: (p) => new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments),
  },
  cone: {
    label: '円錐',
    icon: '▲',
    params: { radius: 0.3, height: 0.6, radialSegments: 40 },
    defs: [len('radius', '半径'), len('height', '高さ'), seg('radialSegments', '分割', 3, 128)],
    build: (p) => new THREE.ConeGeometry(p.radius, p.height, p.radialSegments),
  },
  capsule: {
    label: 'カプセル',
    icon: '⬭',
    params: { radius: 0.18, length: 0.4, capSegments: 12, radialSegments: 32 },
    defs: [len('radius', '半径'), len('length', '長さ'), seg('capSegments', '端分割', 1, 32), seg('radialSegments', '分割', 3, 96)],
    build: (p) => new THREE.CapsuleGeometry(p.radius, p.length, p.capSegments, p.radialSegments),
  },
  torus: {
    label: 'トーラス',
    icon: '◯',
    params: { radius: 0.3, tube: 0.1, radialSegments: 24, tubularSegments: 64 },
    defs: [len('radius', '半径'), len('tube', '太さ', 0.005, 2), seg('radialSegments', '断面分割', 3, 64), seg('tubularSegments', '周分割', 3, 256)],
    build: (p) => new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments),
  },
  torusKnot: {
    label: 'トーラス結び目',
    icon: '∞',
    params: { radius: 0.25, tube: 0.07, p: 2, q: 3 },
    defs: [len('radius', '半径'), len('tube', '太さ', 0.005, 1), seg('p', 'P', 1, 12), seg('q', 'Q', 1, 12)],
    build: (p) => new THREE.TorusKnotGeometry(p.radius, p.tube, 200, 24, p.p, p.q),
  },
  plane: {
    label: '平面',
    icon: '▭',
    params: { width: 1, height: 1, segments: 1 },
    defs: [len('width', '幅', 0.01, 40), len('height', '高さ', 0.01, 40), seg('segments', '分割', 1, 128)],
    build: (p) => new THREE.PlaneGeometry(p.width, p.height, p.segments, p.segments).rotateX(-Math.PI / 2),
  },
  icosahedron: {
    label: '多面体',
    icon: '⬢',
    params: { radius: 0.3, detail: 0 },
    defs: [len('radius', '半径'), seg('detail', '細分化', 0, 6)],
    build: (p) => new THREE.IcosahedronGeometry(p.radius, p.detail),
  },
  ring: {
    label: 'リング',
    icon: '◎',
    params: { innerRadius: 0.15, outerRadius: 0.35, thetaSegments: 48 },
    defs: [len('innerRadius', '内半径', 0, 4), len('outerRadius', '外半径'), seg('thetaSegments', '分割', 3, 128)],
    build: (p) => new THREE.RingGeometry(p.innerRadius, p.outerRadius, p.thetaSegments).rotateX(-Math.PI / 2),
  },
  star: {
    label: '星',
    icon: '★',
    params: { points: 5, outer: 0.35, inner: 0.15, depth: 0.1 },
    defs: [seg('points', '頂点数', 3, 16), len('outer', '外半径'), len('inner', '内半径'), len('depth', '厚み', 0.005, 2)],
    build: (p) =>
      new THREE.ExtrudeGeometry(starShape(p.points, p.outer, p.inner), { depth: p.depth, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 3 }).center(),
  },
  heart: {
    label: 'ハート',
    icon: '♥',
    params: { size: 0.5, depth: 0.12 },
    defs: [len('size', '大きさ'), len('depth', '厚み', 0.005, 2)],
    build: (p) =>
      new THREE.ExtrudeGeometry(heartShape(p.size), { depth: p.depth, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 6, curveSegments: 32 }).center(),
  },
};

let counter = 0;
const PALETTE = ['#ff5fa2', '#5fc8ff', '#ffd25f', '#7cf29c', '#b48cff', '#ff8a5f', '#e6e6f0'];

export function createPrimitive(type: string, toon = false): THREE.Mesh {
  const def = PRIMITIVES[type];
  const params = { ...def.params };
  const color = PALETTE[counter % PALETTE.length];
  const mesh = new THREE.Mesh(def.build(params), makeMaterial(color, { toon, name: `${def.label}マテリアル`, roughness: 0.45 }));
  mesh.name = `${def.label}${++counter}`;
  mesh.userData.primitive = { type, params };
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const box = new THREE.Box3().setFromObject(mesh);
  mesh.position.y = -box.min.y;
  return mesh;
}

export function rebuildPrimitive(mesh: THREE.Mesh) {
  const pr = mesh.userData.primitive;
  if (!pr) return;
  const def = PRIMITIVES[pr.type];
  const g = def.build(pr.params);
  mesh.geometry.dispose();
  mesh.geometry = g;
}
