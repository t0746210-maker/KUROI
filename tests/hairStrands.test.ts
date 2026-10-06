import './setup';
import { describe, expect, it } from 'vitest';
import { buildAvatar } from '../src/avatar/AvatarBuilder';
import { defaultParams, type HairStrand } from '../src/avatar/params';
import { exportVRM, defaultMeta } from '../src/io/vrm';
import { parseGLB } from '../src/io/glb';

const strand = (o: Partial<HairStrand> = {}): HairStrand => ({
  id: 't', name: 'テスト', points: [[0, 0.5, -0.85], [0, 0.3, -1.1], [0, -0.4, -1.15], [0, -1.2, -1.05]],
  width: 1, thickness: 1, taper: 0.8, twist: 0, curl: 0, length: 1, color: 'gradient', mirror: false, spring: false, stiffness: 1, ...o,
});

const hairVerts = (p: typeof defaultParams) => buildAvatar(p).meshes.find((m) => m.name === 'Hair')!.geometry.attributes.position.count;

describe('髪の房エディタ', () => {
  const base = { ...defaultParams, hairStyle: 'cap' as const, ahoge: false, bangs: 'none' as const };

  it('房を追加するとメッシュが増え、ミラーで 2 本になる', () => {
    const v0 = hairVerts(base);
    const v1 = hairVerts({ ...base, customStrands: [strand()] });
    const v2 = hairVerts({ ...base, customStrands: [strand({ mirror: true, points: strand().points.map(([x, y, z]) => [x + 0.4, y, z]) as any })] });
    expect(v1).toBeGreaterThan(v0);
    expect(v2 - v0).toBe((v1 - v0) * 2);
  });

  it('揺れ物の房は制御点がボーンチェーンになり、VRM の SpringBone に出力される', async () => {
    const p = { ...base, customStrands: [strand({ spring: true, mirror: true, points: strand().points.map(([x, y, z]) => [x + 0.4, y, z]) as any })] };
    const d = buildAvatar(p);
    expect(d.bones['hair_s0_0']).toBeDefined();
    expect(d.bones['hair_s1_3']).toBeDefined();
    expect(d.springs.map((s) => s.name)).toEqual(['s0', 's1']);
    // 房の先端は房のチェーンにウェイトが乗る
    const hair = d.meshes.find((m) => m.name === 'Hair')!;
    const si = hair.geometry.attributes.skinIndex;
    const used = new Set<string>();
    for (let i = 0; i < si.count; i++) used.add(d.skeleton.bones[si.getX(i)].name);
    expect([...used].some((n) => n.startsWith('hair_s0_'))).toBe(true);
    const { json } = parseGLB(await exportVRM(p, '1.0', defaultMeta(p)));
    expect(json.extensions.VRMC_springBone.springs.map((s: any) => s.name)).toEqual(['s0', 's1']);
  });

  it('長さ・カール・ねじれ・色指定でも生成できる', () => {
    const d = buildAvatar({ ...base, customStrands: [strand({ length: 1.8, curl: 0.9, twist: 6, color: 'accent' })] });
    const hair = d.meshes.find((m) => m.name === 'Hair')!;
    const mats = (hair.material as any[]).map((m) => m.name);
    expect(mats).toContain('HairAccessory');
  });
});
