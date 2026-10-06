import * as THREE from 'three';
import type { AvatarParams } from '../avatar/params';
import type { Pose } from '../avatar/animations';

export const PROJECT_EXT = 'kuroi';

export interface ProjectFile {
  app: 'KUROI Studio';
  version: 1;
  savedAt: string;
  avatar: null | {
    params: AvatarParams;
    pose: Pose;
    poseName: string;
    expressions: Record<string, number>;
    clip: string | null;
    visible: boolean;
    transform: { p: number[]; q: number[]; s: number[] };
    /** マテリアル名 → ストロークレイヤー PNG (data URL) */
    paint?: Record<string, string>;
  };
  objects: any[];
  scene: { lightPreset: string; camera: number[]; target: number[] };
}

export function serializeObject(o: THREE.Object3D) {
  return o.toJSON();
}

export async function deserializeObjects(list: any[]): Promise<THREE.Object3D[]> {
  const loader = new THREE.ObjectLoader();
  const out: THREE.Object3D[] = [];
  for (const j of list) {
    try {
      out.push(await loader.parseAsync(j));
    } catch (e) {
      console.warn('オブジェクトの復元に失敗', e);
    }
  }
  return out;
}

export function isProject(json: any): json is ProjectFile {
  return json && json.app === 'KUROI Studio' && json.version === 1;
}

const AUTOSAVE_KEY = 'kuroi-studio-autosave';

export function autosave(p: ProjectFile) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

export function loadAutosave(): ProjectFile | null {
  try {
    const s = localStorage.getItem(AUTOSAVE_KEY);
    if (!s) return null;
    const j = JSON.parse(s);
    return isProject(j) ? j : null;
  } catch {
    return null;
  }
}
