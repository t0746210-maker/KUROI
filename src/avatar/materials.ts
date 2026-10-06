import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/** トゥーン用の3段階グラデーション */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([150, 150, 160, 255, 215, 215, 220, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.name = 'toonGradient';
  gradient.needsUpdate = true;
  return gradient;
}

export interface MatOptions {
  toon: boolean;
  name: string;
  unlit?: boolean;
  vertexColors?: boolean;
  map?: THREE.Texture | null;
  transparent?: boolean;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  doubleSide?: boolean;
  /** MToon 出力時の影色 */
  shadeColor?: string;
}

export function makeMaterial(color: string, o: MatOptions): THREE.Material {
  let m: THREE.Material;
  const c = new THREE.Color(color);
  if (o.unlit) {
    m = new THREE.MeshBasicMaterial({ color: c, map: o.map ?? null });
  } else if (o.toon) {
    m = new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient(), map: o.map ?? null });
  } else {
    m = new THREE.MeshStandardMaterial({
      color: c,
      roughness: o.roughness ?? 0.65,
      metalness: o.metalness ?? 0,
      map: o.map ?? null,
    });
  }
  m.name = o.name;
  if (o.vertexColors) (m as THREE.MeshStandardMaterial).vertexColors = true;
  if (o.transparent) {
    m.transparent = true;
    m.opacity = o.opacity ?? 1;
    m.depthWrite = false;
  }
  if (o.doubleSide) m.side = THREE.DoubleSide;
  const shade = o.shadeColor ? new THREE.Color(o.shadeColor) : c.clone().multiplyScalar(0.72);
  m.userData.mtoon = { shadeColor: '#' + shade.getHexString(), unlit: !!o.unlit };
  return m;
}

/** 瞳テクスチャ（Canvas 環境がある場合のみ） */
export function irisTexture(c1: string, c2: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  if (!g) return null;
  const col1 = new THREE.Color(c1);
  const dark = col1.clone().multiplyScalar(0.35);
  g.fillStyle = '#' + dark.getHexString();
  g.fillRect(0, 0, size, size);
  // 縦グラデーション（上が濃く下が明るい、アニメ調）
  const lg = g.createLinearGradient(0, 0, 0, size);
  lg.addColorStop(0, '#' + dark.getHexString());
  lg.addColorStop(0.45, c1);
  lg.addColorStop(1, c2);
  g.fillStyle = lg;
  g.beginPath();
  g.ellipse(size / 2, size / 2, size * 0.47, size * 0.47, 0, 0, Math.PI * 2);
  g.fill();
  // 縁取り
  g.lineWidth = size * 0.04;
  g.strokeStyle = '#' + dark.getHexString();
  g.stroke();
  // 瞳孔
  g.fillStyle = '#' + col1.clone().multiplyScalar(0.15).getHexString();
  g.beginPath();
  g.ellipse(size / 2, size * 0.5, size * 0.17, size * 0.22, 0, 0, Math.PI * 2);
  g.fill();
  // 虹彩の放射線
  g.globalAlpha = 0.25;
  g.strokeStyle = c2;
  g.lineWidth = 2;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    g.beginPath();
    g.moveTo(size / 2 + Math.cos(a) * size * 0.2, size / 2 + Math.sin(a) * size * 0.2);
    g.lineTo(size / 2 + Math.cos(a) * size * 0.42, size / 2 + Math.sin(a) * size * 0.42);
    g.stroke();
  }
  g.globalAlpha = 1;
  // ハイライト
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(size * 0.36, size * 0.3, size * 0.11, size * 0.13, -0.4, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 0.85;
  g.beginPath();
  g.ellipse(size * 0.66, size * 0.7, size * 0.05, size * 0.05, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.name = 'iris';
  return tex;
}

/** チーク用の放射グラデーション */
export function blushTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  if (!g) return null;
  const rg = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.name = 'blush';
  return tex;
}

/** 反転ハル方式のアウトライン用マテリアル（スキニング・モーフに追従） */
export function outlineMaterial(color: string, thickness: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.BackSide });
  m.name = '__outline';
  m.userData.thickness = { value: thickness };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.outlineThickness = m.userData.thickness;
    shader.vertexShader = 'uniform float outlineThickness;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n transformed += normalize( normal ) * outlineThickness;',
    );
  };
  return m;
}
