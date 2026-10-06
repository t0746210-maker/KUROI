import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';

export const IMPORT_EXTS = ['glb', 'gltf', 'vrm', 'fbx', 'obj', 'stl', 'ply', 'dae', '3mf', 'usdz', 'json', 'bvh', 'png', 'jpg', 'jpeg', 'webp'];

export interface ImportResult {
  object?: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** BVH 等、モーションのみの読み込み */
  motionOnly?: boolean;
  note?: string;
}

const defaultMat = () => new THREE.MeshStandardMaterial({ color: 0xd8d8e0, roughness: 0.6, name: 'Imported' });

export async function importFile(file: File): Promise<ImportResult> {
  const ext = file.name.split('.').pop()!.toLowerCase();
  const base = file.name.replace(/\.[^.]+$/, '');
  const ab = () => file.arrayBuffer();
  const text = () => file.text();
  let res: ImportResult;
  switch (ext) {
    case 'glb':
    case 'gltf':
    case 'vrm': {
      const loader = new GLTFLoader();
      const data = ext === 'gltf' ? await text() : await ab();
      const gltf = await loader.parseAsync(data as any, '');
      res = { object: gltf.scene, animations: gltf.animations, note: ext === 'vrm' ? 'VRM をメッシュ・ボーン付きで読み込みました' : undefined };
      break;
    }
    case 'fbx': {
      const obj = new FBXLoader().parse(await ab(), '');
      res = { object: obj, animations: obj.animations ?? [] };
      break;
    }
    case 'obj': {
      res = { object: new OBJLoader().parse(await text()), animations: [] };
      break;
    }
    case 'stl': {
      const g = new STLLoader().parse(await ab());
      g.computeVertexNormals();
      res = { object: new THREE.Mesh(g, defaultMat()), animations: [] };
      break;
    }
    case 'ply': {
      const g = new PLYLoader().parse(await ab());
      if (!g.attributes.normal) g.computeVertexNormals();
      const m = defaultMat();
      if (g.attributes.color) {
        m.vertexColors = true;
        m.color.set(0xffffff);
      }
      res = { object: g.index || g.attributes.position.count % 3 === 0 ? new THREE.Mesh(g, m) : new THREE.Points(g, new THREE.PointsMaterial({ size: 0.01, vertexColors: !!g.attributes.color })), animations: [] };
      break;
    }
    case 'dae': {
      const c = new ColladaLoader().parse(await text(), '');
      res = { object: c!.scene, animations: (c!.scene as any).animations ?? [] };
      break;
    }
    case '3mf': {
      res = { object: new ThreeMFLoader().parse(await ab()), animations: [] };
      break;
    }
    case 'usdz': {
      const loader = new USDLoader() as any;
      res = { object: loader.parse(await ab()), animations: [] };
      break;
    }
    case 'json': {
      const json = JSON.parse(await text());
      const obj = await new THREE.ObjectLoader().parseAsync(json);
      res = { object: obj, animations: obj.animations ?? [] };
      break;
    }
    case 'bvh': {
      const r = new BVHLoader().parse(await text());
      // BVH はセンチ単位のことが多いので位置トラックは除外し、回転のみ使う
      r.clip.tracks = r.clip.tracks.filter((t) => t.name.endsWith('.quaternion'));
      r.clip.name = base;
      res = { animations: [r.clip], motionOnly: true };
      break;
    }
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp': {
      const url = URL.createObjectURL(file);
      const tex = await new THREE.TextureLoader().loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      const img = tex.image as HTMLImageElement;
      const aspect = img.width / img.height;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(1.6 * aspect, 1.6),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, name: base }),
      );
      plane.position.set(0, 0.8, -1);
      plane.userData.referenceImage = true;
      res = { object: plane, animations: [], note: '画像を下絵（リファレンス）として配置しました' };
      break;
    }
    default:
      throw new Error(`未対応の形式です: .${ext}`);
  }
  if (res.object) {
    res.object.name = res.object.name || base;
    if (!res.object.name || res.object.name === 'Scene' || res.object.name === 'AuxScene') res.object.name = base;
    res.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    res.object.userData.imported = file.name;
    normalizeScale(res.object, res);
  }
  return res;
}

/** 極端に大きい/小さいモデル（cm 単位の FBX 等）を自動でメートル換算 */
function normalizeScale(o: THREE.Object3D, res: ImportResult) {
  o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const m = Math.max(size.x, size.y, size.z);
  let k = 1;
  if (m > 30) k = m > 3000 ? 0.001 : 0.01;
  else if (m < 0.02) k = 1 / m;
  if (k !== 1) {
    o.scale.multiplyScalar(k);
    res.note = (res.note ? res.note + ' / ' : '') + `スケールを自動調整しました (×${+k.toFixed(4)})`;
    o.updateMatrixWorld(true);
    box.setFromObject(o);
  }
  // 床に接地
  if (!o.userData.referenceImage && isFinite(box.min.y)) o.position.y -= box.min.y;
}
