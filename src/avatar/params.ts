/** アバターの全パラメータ。すべてシリアライズ可能なプレーンデータ。 */
export interface AvatarParams {
  name: string;
  author: string;
  // 体型
  height: number; // m
  headSize: number;
  neckLength: number;
  shoulderWidth: number;
  chest: number;
  bust: number;
  waist: number;
  hip: number;
  armLength: number;
  armThickness: number;
  legLength: number;
  legThickness: number;
  handSize: number;
  footSize: number;
  // 顔
  faceWidth: number;
  chin: number;
  cheek: number;
  eyeSize: number;
  eyeWidth: number;
  eyeSpacing: number;
  eyeHeight: number;
  eyeTilt: number;
  irisSize: number;
  browHeight: number;
  browThickness: number;
  mouthWidth: number;
  mouthHeight: number;
  noseSize: number;
  earType: 'human' | 'elf' | 'cat' | 'none';
  // 髪
  hairStyle: 'short' | 'bob' | 'long' | 'ponytail' | 'twintails' | 'spiky' | 'bun' | 'none';
  bangs: 'straight' | 'side' | 'parted' | 'none';
  hairLength: number;
  hairVolume: number;
  ahoge: boolean;
  // 衣装
  outfit: 'none' | 'casual' | 'dress' | 'uniform' | 'hoodie' | 'suit';
  skirtLength: number;
  sleeveLength: number;
  shoes: 'sneakers' | 'boots' | 'none';
  // 色
  skinColor: string;
  hairColor: string;
  hairColor2: string;
  eyeColor: string;
  eyeColor2: string;
  outfitColor: string;
  outfitColor2: string;
  accentColor: string;
  shoeColor: string;
  // 描画
  toon: boolean;
  outline: boolean;
}

export const defaultParams: AvatarParams = {
  name: 'KUROI-chan',
  author: 'KUROI Studio',
  height: 1.58,
  headSize: 1,
  neckLength: 1,
  shoulderWidth: 1,
  chest: 1,
  bust: 0.4,
  waist: 1,
  hip: 1,
  armLength: 1,
  armThickness: 1,
  legLength: 1,
  legThickness: 1,
  handSize: 1,
  footSize: 1,
  faceWidth: 1,
  chin: 0.5,
  cheek: 0.5,
  eyeSize: 1,
  eyeWidth: 1,
  eyeSpacing: 1,
  eyeHeight: 0.5,
  eyeTilt: 0,
  irisSize: 1,
  browHeight: 0.5,
  browThickness: 1,
  mouthWidth: 1,
  mouthHeight: 0.5,
  noseSize: 0.5,
  earType: 'human',
  hairStyle: 'long',
  bangs: 'straight',
  hairLength: 1,
  hairVolume: 1,
  ahoge: true,
  outfit: 'uniform',
  skirtLength: 0.5,
  sleeveLength: 0.5,
  shoes: 'sneakers',
  skinColor: '#ffe3d4',
  hairColor: '#2b2140',
  hairColor2: '#7a5cc4',
  eyeColor: '#7c4dff',
  eyeColor2: '#ff6ec7',
  outfitColor: '#1f2a44',
  outfitColor2: '#f4f4f8',
  accentColor: '#e5384f',
  shoeColor: '#3a2b2b',
  toon: true,
  outline: true,
};

export type ParamKey = keyof AvatarParams;

export interface SliderDef {
  key: ParamKey;
  label: string;
  min: number;
  max: number;
  step?: number;
}

export interface SelectDef {
  key: ParamKey;
  label: string;
  options: [string, string][];
}

export interface Section {
  title: string;
  sliders?: SliderDef[];
  selects?: SelectDef[];
  colors?: { key: ParamKey; label: string }[];
  toggles?: { key: ParamKey; label: string }[];
}

export const sections: Section[] = [
  {
    title: '体型',
    sliders: [
      { key: 'height', label: '身長 (m)', min: 1.1, max: 2.1, step: 0.01 },
      { key: 'headSize', label: '頭の大きさ', min: 0.7, max: 1.5 },
      { key: 'neckLength', label: '首の長さ', min: 0.5, max: 1.8 },
      { key: 'shoulderWidth', label: '肩幅', min: 0.7, max: 1.4 },
      { key: 'chest', label: '胸囲', min: 0.7, max: 1.5 },
      { key: 'bust', label: 'バスト', min: 0, max: 1.5 },
      { key: 'waist', label: 'ウエスト', min: 0.6, max: 1.6 },
      { key: 'hip', label: 'ヒップ', min: 0.7, max: 1.6 },
      { key: 'armLength', label: '腕の長さ', min: 0.7, max: 1.3 },
      { key: 'armThickness', label: '腕の太さ', min: 0.6, max: 1.8 },
      { key: 'legLength', label: '脚の長さ', min: 0.7, max: 1.4 },
      { key: 'legThickness', label: '脚の太さ', min: 0.6, max: 1.8 },
      { key: 'handSize', label: '手の大きさ', min: 0.6, max: 1.5 },
      { key: 'footSize', label: '足の大きさ', min: 0.6, max: 1.5 },
    ],
  },
  {
    title: '顔',
    sliders: [
      { key: 'faceWidth', label: '顔の幅', min: 0.8, max: 1.25 },
      { key: 'chin', label: 'あごの尖り', min: 0, max: 1 },
      { key: 'cheek', label: '頬のふくらみ', min: 0, max: 1 },
      { key: 'eyeSize', label: '目の大きさ', min: 0.5, max: 1.6 },
      { key: 'eyeWidth', label: '目の横幅', min: 0.6, max: 1.5 },
      { key: 'eyeSpacing', label: '目の間隔', min: 0.7, max: 1.35 },
      { key: 'eyeHeight', label: '目の高さ', min: 0, max: 1 },
      { key: 'eyeTilt', label: 'つり目 / たれ目', min: -1, max: 1 },
      { key: 'irisSize', label: '瞳の大きさ', min: 0.6, max: 1.3 },
      { key: 'browHeight', label: '眉の高さ', min: 0, max: 1 },
      { key: 'browThickness', label: '眉の太さ', min: 0.3, max: 2 },
      { key: 'mouthWidth', label: '口の幅', min: 0.5, max: 1.8 },
      { key: 'mouthHeight', label: '口の高さ', min: 0, max: 1 },
      { key: 'noseSize', label: '鼻', min: 0, max: 1 },
    ],
    selects: [
      {
        key: 'earType',
        label: '耳',
        options: [
          ['human', '人間'],
          ['elf', 'エルフ'],
          ['cat', 'ネコミミ'],
          ['none', 'なし'],
        ],
      },
    ],
  },
  {
    title: '髪型',
    selects: [
      {
        key: 'hairStyle',
        label: 'ヘアスタイル',
        options: [
          ['long', 'ロング'],
          ['bob', 'ボブ'],
          ['short', 'ショート'],
          ['ponytail', 'ポニーテール'],
          ['twintails', 'ツインテール'],
          ['bun', 'お団子'],
          ['spiky', 'ツンツン'],
          ['none', 'なし'],
        ],
      },
      {
        key: 'bangs',
        label: '前髪',
        options: [
          ['straight', 'ぱっつん'],
          ['side', '流し'],
          ['parted', 'センター分け'],
          ['none', 'なし'],
        ],
      },
    ],
    sliders: [
      { key: 'hairLength', label: '髪の長さ', min: 0.4, max: 1.6 },
      { key: 'hairVolume', label: 'ボリューム', min: 0.7, max: 1.5 },
    ],
    toggles: [{ key: 'ahoge', label: 'アホ毛' }],
  },
  {
    title: '衣装',
    selects: [
      {
        key: 'outfit',
        label: 'コーディネート',
        options: [
          ['uniform', 'セーラー服'],
          ['casual', 'カジュアル'],
          ['dress', 'ワンピース'],
          ['hoodie', 'パーカー'],
          ['suit', 'スーツ'],
          ['none', 'インナーのみ'],
        ],
      },
      {
        key: 'shoes',
        label: '靴',
        options: [
          ['sneakers', 'スニーカー'],
          ['boots', 'ブーツ'],
          ['none', '素足'],
        ],
      },
    ],
    sliders: [
      { key: 'skirtLength', label: '丈の長さ', min: 0, max: 1 },
      { key: 'sleeveLength', label: '袖の長さ', min: 0, max: 1 },
    ],
  },
  {
    title: 'カラー',
    colors: [
      { key: 'skinColor', label: '肌' },
      { key: 'hairColor', label: '髪' },
      { key: 'hairColor2', label: '髪（グラデ）' },
      { key: 'eyeColor', label: '瞳' },
      { key: 'eyeColor2', label: '瞳（ハイライト）' },
      { key: 'outfitColor', label: '衣装メイン' },
      { key: 'outfitColor2', label: '衣装サブ' },
      { key: 'accentColor', label: 'アクセント' },
      { key: 'shoeColor', label: '靴' },
    ],
    toggles: [
      { key: 'toon', label: 'トゥーンシェーディング' },
      { key: 'outline', label: 'アウトライン' },
    ],
  },
];

export const presets: Record<string, Partial<AvatarParams>> = {
  'スタンダード': {},
  'クール': {
    height: 1.72,
    headSize: 0.9,
    eyeSize: 0.85,
    eyeTilt: 0.6,
    hairStyle: 'ponytail',
    bangs: 'side',
    hairColor: '#cfd6e6',
    hairColor2: '#6c8cff',
    eyeColor: '#2bb5ff',
    eyeColor2: '#bff3ff',
    outfit: 'suit',
    outfitColor: '#20232b',
    outfitColor2: '#ffffff',
    accentColor: '#2bb5ff',
    shoes: 'boots',
    bust: 0.6,
    ahoge: false,
  },
  'ちびキャラ': {
    height: 1.15,
    headSize: 1.45,
    eyeSize: 1.4,
    irisSize: 1.15,
    legLength: 0.75,
    armLength: 0.8,
    hairStyle: 'twintails',
    hairColor: '#ff8fb8',
    hairColor2: '#ffe066',
    eyeColor: '#ff4d8d',
    eyeColor2: '#fff2a8',
    outfit: 'dress',
    outfitColor: '#ffb3cf',
    outfitColor2: '#ffffff',
    bust: 0,
    earType: 'cat',
  },
  '少年': {
    height: 1.65,
    headSize: 0.95,
    bust: 0,
    hip: 0.85,
    waist: 1.1,
    shoulderWidth: 1.15,
    chest: 1.1,
    hairStyle: 'spiky',
    bangs: 'side',
    hairColor: '#ff7a1a',
    hairColor2: '#ffd36b',
    eyeColor: '#35c46b',
    eyeColor2: '#d3ffcf',
    eyeTilt: 0.3,
    eyeSize: 0.85,
    outfit: 'hoodie',
    outfitColor: '#2e3b55',
    outfitColor2: '#e7e7e7',
    accentColor: '#ff7a1a',
    skirtLength: 0.6,
    ahoge: true,
  },
  'エルフ': {
    height: 1.7,
    headSize: 0.92,
    earType: 'elf',
    hairStyle: 'long',
    hairLength: 1.5,
    bangs: 'parted',
    hairColor: '#f2e6b8',
    hairColor2: '#a6e3b0',
    eyeColor: '#2fa36b',
    eyeColor2: '#e1ffe8',
    outfit: 'dress',
    outfitColor: '#2f6b4a',
    outfitColor2: '#f0e6c8',
    accentColor: '#d8b45a',
    skirtLength: 1,
    shoes: 'boots',
    shoeColor: '#5a3d24',
  },
};

export function randomParams(base: AvatarParams): AvatarParams {
  const p: AvatarParams = { ...base };
  const r = (a: number, b: number) => a + Math.random() * (b - a);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
  const hsl = (h: number, s: number, l: number) => {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * c)
        .toString(16)
        .padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  };
  p.height = r(1.3, 1.85);
  p.headSize = r(0.85, 1.25);
  p.shoulderWidth = r(0.85, 1.2);
  p.bust = r(0, 1.1);
  p.waist = r(0.8, 1.2);
  p.hip = r(0.85, 1.25);
  p.legLength = r(0.9, 1.2);
  p.eyeSize = r(0.8, 1.35);
  p.eyeTilt = r(-0.6, 0.6);
  p.irisSize = r(0.85, 1.15);
  p.chin = r(0.2, 0.9);
  p.hairStyle = pick(['short', 'bob', 'long', 'ponytail', 'twintails', 'spiky', 'bun'] as const);
  p.bangs = pick(['straight', 'side', 'parted'] as const);
  p.hairLength = r(0.7, 1.4);
  p.hairVolume = r(0.9, 1.25);
  p.ahoge = Math.random() < 0.5;
  p.earType = pick(['human', 'human', 'elf', 'cat'] as const);
  p.outfit = pick(['casual', 'dress', 'uniform', 'hoodie', 'suit'] as const);
  p.skirtLength = r(0.2, 0.9);
  p.sleeveLength = r(0, 1);
  p.shoes = pick(['sneakers', 'boots'] as const);
  const hh = r(0, 360);
  p.hairColor = hsl(hh, r(0.3, 0.9), r(0.2, 0.75));
  p.hairColor2 = hsl((hh + r(20, 80)) % 360, r(0.5, 1), r(0.5, 0.8));
  const eh = r(0, 360);
  p.eyeColor = hsl(eh, r(0.6, 1), r(0.4, 0.6));
  p.eyeColor2 = hsl((eh + 40) % 360, 0.9, 0.85);
  const oh = r(0, 360);
  p.outfitColor = hsl(oh, r(0.2, 0.7), r(0.2, 0.6));
  p.outfitColor2 = hsl((oh + 180) % 360, r(0.1, 0.4), r(0.75, 0.95));
  p.accentColor = hsl(r(0, 360), 0.8, 0.55);
  p.shoeColor = hsl(r(0, 360), 0.3, r(0.15, 0.4));
  p.skinColor = pick(['#ffe3d4', '#fdd5bf', '#f2c4a5', '#d9a07c', '#a8714f', '#ffeee6']);
  return p;
}
