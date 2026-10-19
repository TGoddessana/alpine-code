/**
 * The snowy mountain scene behind the new-session screen, drawn in code as pixel art: a late-afternoon sky with the sun
 * low behind two ranges of snow peaks, a hill of pines, snow dunes with a cabin and a few pines on them, and tall pines
 * framing both sides. Every shape comes from a seeded noise, so the same size always paints the same picture, and the
 * picture is built from fractions of its width and height, so it fits any window.
 *
 * Pure: it returns the pixels (RGBA, row by row) and touches no canvas, so the component only has to put them on one.
 */

type RGB = readonly [number, number, number];

const rgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const smooth = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Ordered dithering: how far into a mix a pixel at (x, y) goes, as a threshold between 0 and 1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((step) => (step + 0.5) / 16);
const bayer = (x: number, y: number) => BAYER[((y & 3) << 2) | (x & 3)]!;

function hash(ix: number, iy: number, seed: number): number {
  let n = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed + 1, 0x9e3779b1);
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
}

/** Smooth value noise between 0 and 1. */
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  const top = a + (b - a) * ux;
  return top + (c + (d - c) * ux - top) * uy;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKY = ['#86aed6', '#98bddc', '#abcbe3', '#bfd9ea', '#d3e5f0', '#e5eef4', '#f4f0ec', '#fbe8d9'].map(rgb);
const SUN = rgb('#fffbef');
const GLOW = rgb('#ffe6c4');

interface Range {
  seed: number;
  /** Where its foot is, as a fraction of the height. */
  base: number;
  /** How far its highest peak can rise above the foot, as a fraction of the height. */
  amp: number;
  /** How many peaks fit across: bigger is busier. */
  freq: number;
  /** How much lower it is in the middle, where the heading and the input sit (0 none, 1 flat there). */
  valley: number;
  snowLit: RGB;
  snowShade: RGB;
  rockLit: RGB;
  rockShade: RGB;
  fog: RGB;
}

const FAR: Range = {
  seed: 3,
  base: 0.7,
  amp: 0.62,
  freq: 1.05,
  valley: 0.4,
  snowLit: rgb('#f7f1ec'),
  snowShade: rgb('#cfdcec'),
  rockLit: rgb('#b6c8dc'),
  rockShade: rgb('#96aec8'),
  fog: rgb('#e6eef4'),
};

const MID: Range = {
  seed: 8,
  base: 0.77,
  amp: 0.46,
  freq: 1.5,
  valley: 0.6,
  snowLit: rgb('#fff1e1'),
  snowShade: rgb('#bdd0e5'),
  rockLit: rgb('#8ca8c5'),
  rockShade: rgb('#6385a7'),
  fog: rgb('#dde8f1'),
};

interface PineStyle {
  dark: RGB;
  mid: RGB;
  lit: RGB;
  snow: RGB;
  snowShade: RGB;
  trunk: RGB;
}

const PINE_FAR: PineStyle = {
  dark: rgb('#46697c'),
  mid: rgb('#58798b'),
  lit: rgb('#6f8d9c'),
  snow: rgb('#e9f1f7'),
  snowShade: rgb('#bccfdf'),
  trunk: rgb('#4c6577'),
};
const PINE_NEAR: PineStyle = {
  dark: rgb('#24454f'),
  mid: rgb('#31606b'),
  lit: rgb('#4a7f89'),
  snow: rgb('#f8fbfe'),
  snowShade: rgb('#c4d8e8'),
  trunk: rgb('#43332f'),
};

const SNOW_LIT = rgb('#fff4e6');
const SNOW_COOL = rgb('#e3edf7');
const SNOW_BODY = rgb('#f2f7fc');
const SNOW_SHADE = rgb('#d3e2f0');
const SNOW_DEEP = rgb('#b9d0e5');
const SNOW_WHITE = rgb('#fdfeff');
const CAST = rgb('#c3d7ea');

/**
 * How big one pixel of the picture is on the screen, in CSS pixels: the picture keeps about 300 x 190 of them, so
 * the pines and the cabin keep their look on a small window and on a large one.
 */
export function pixelSizeFor(width: number, height: number): number {
  return clamp(Math.round(Math.min(width / 300, height / 190)), 3, 6);
}

export interface Snowscape {
  /** RGBA bytes, row by row. */
  data: Uint8ClampedArray<ArrayBuffer>;
  /** The top of the cabin's chimney, where its smoke starts. */
  chimney: { x: number; y: number };
}

/** The scene, `width` x `height` pixels. */
export function paintSnowscape(width: number, height: number, seed = 11): Snowscape {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const data = new Uint8ClampedArray(w * h * 4);
  const rand = random(seed);

  const put = (x: number, y: number, color: RGB) => {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const i = (py * w + px) * 4;
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = 255;
  };
  const get = (x: number, y: number): RGB => {
    const i = (clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, color: RGB) => {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) put(x, y, color);
  };

  // Sky: bands that meet in a narrow dithered seam.
  const skyEnd = h * 0.68;
  for (let y = 0; y < h; y++) {
    const p = clamp(y / skyEnd, 0, 1) * (SKY.length - 1);
    const index = Math.min(SKY.length - 2, Math.floor(p));
    const upper = clamp((p - index - 0.5) * 2.6 + 0.5, 0, 1);
    for (let x = 0; x < w; x++) put(x, y, SKY[index + (bayer(x, y) < upper ? 1 : 0)]!);
  }

  // Sun, and the warm glow round it that takes the colour out of the sky.
  const sunX = w * 0.7;
  const sunY = h * 0.37;
  const sunR = Math.max(5, h * 0.034);
  const glowR = h * 0.3;
  for (let y = 0; y < Math.min(h, Math.ceil(sunY + glowR)); y++) {
    for (let x = Math.max(0, Math.floor(sunX - glowR)); x < Math.min(w, Math.ceil(sunX + glowR)); x++) {
      const d = Math.hypot(x - sunX, y - sunY);
      if (d < sunR) put(x, y, SUN);
      else if (d < glowR) {
        const t = 1 - d / glowR;
        const level = Math.min(3, Math.floor(t * t * 4.2 + bayer(x, y)));
        if (level > 0) put(x, y, mix(get(x, y), GLOW, [0, 0.24, 0.46, 0.68][level]!));
      }
    }
  }

  // Clouds: a few round-topped ones with flat bottoms, lit on the sun's side.
  const cloud = (cx: number, cy: number, unit: number) => {
    const blobs: [number, number, number][] = [
      [-2.5, 0.1, 0.9],
      [-1.3, -0.5, 1.25],
      [0, -0.95, 1.55],
      [1.35, -0.45, 1.15],
      [2.6, 0.1, 0.85],
    ];
    const top = cy - 2.5 * unit;
    for (let y = Math.floor(top); y <= cy; y++) {
      for (let x = Math.floor(cx - 3.6 * unit); x <= Math.ceil(cx + 3.6 * unit); x++) {
        const inside = blobs.some(([bx, by, br]) => {
          const dx = x - (cx + bx * unit);
          const dy = y - (cy + by * unit);
          return dx * dx + dy * dy < br * br * unit * unit && y <= cy;
        });
        if (!inside) continue;
        const t = (y - top) / (cy - top) + bayer(x, y) * 0.12 - (x > cx ? 0.1 : 0);
        put(x, y, t < 0.34 ? rgb('#fffdf9') : t < 0.66 ? rgb('#edf3f8') : rgb('#cfdfed'));
      }
    }
  };
  cloud(w * 0.15, h * 0.22, h * 0.04);
  cloud(w * 0.37, h * 0.12, h * 0.027);
  cloud(w * 0.84, h * 0.19, h * 0.034);
  cloud(w * 0.64, h * 0.255, h * 0.02);
  cloud(w * 0.95, h * 0.33, h * 0.022);

  const range = (r: Range) => {
    const ridge = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const xn = x / w;
      let sum = 0;
      let norm = 0;
      let weight = 1;
      let freq = r.freq * 3;
      for (let octave = 0; octave < 3; octave++) {
        const n = noise(xn * freq + r.seed * 7.1, 0, r.seed + octave);
        const peak = 1 - Math.abs(2 * n - 1);
        sum += peak * peak * weight;
        norm += weight;
        weight *= 0.55;
        freq *= 2.2;
      }
      const edge = smooth(0.05, 0.9, Math.abs(xn - 0.5) * 2);
      const lift = 1 - r.valley + r.valley * edge;
      ridge[x] = (r.base - r.amp * lift * (0.2 + 0.8 * (sum / norm))) * h;
    }
    const soft = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      let total = 0;
      for (let k = -5; k <= 5; k++) total += ridge[clamp(x + k, 0, w - 1)]!;
      soft[x] = total / 11;
    }
    const foot = r.base * h;
    const fogDepth = h * 0.05;
    for (let x = 0; x < w; x++) {
      const slope = (soft[Math.min(w - 1, x + 3)]! - soft[Math.max(0, x - 3)]!) / 6;
      const steep = Math.min(1, Math.abs(slope) / 1.1);
      for (let y = Math.ceil(ridge[x]!); y < h; y++) {
        if (y >= foot) {
          put(x, y, r.fog);
          continue;
        }
        const depth = y - ridge[x]!;
        const altitude = (foot - y) / (r.amp * h);
        const crease = noise((x + depth * 0.55 * (slope < 0 ? -1 : 1)) * 0.32, y * 0.09, r.seed + 3);
        const grain = noise(x * 0.7, y * 0.7, r.seed + 9);
        const lit = 0.5 + clamp(slope * 0.9, -0.5, 0.5) + (crease - 0.5) * 0.9 + (bayer(x, y) - 0.5) * 0.12 > 0.5;
        const snowy =
          altitude * 1.5 - steep * 0.3 + (grain - 0.5) * 0.5 - (crease < 0.25 ? 0.12 : 0) + (bayer(x, y) - 0.5) * 0.1 >
          0.2;
        let color = snowy ? (lit ? r.snowLit : r.snowShade) : lit ? r.rockLit : r.rockShade;
        const fog = smooth(foot - fogDepth, foot, y);
        if (bayer(x, y) < fog * 0.92) color = r.fog;
        put(x, y, color);
      }
    }
  };
  range(FAR);
  range(MID);

  /** A pine: tiers of boughs with snow lying on their tops, lit from the right, and a long shadow to the left. */
  const pine = (cx: number, baseY: number, height: number, style: PineStyle, shadow = true) => {
    const tiers = clamp(Math.round(height / 6.5), 3, 12);
    const trunk = Math.max(1, Math.round(height * 0.07));
    const body = height - trunk;
    const tierHeight = body / tiers;
    const half = height * 0.27;
    const top = baseY - height;
    if (shadow) {
      const length = Math.round(height * 0.6);
      for (let k = 0; k < length; k++) {
        const thick = Math.max(1, Math.round((height / 26) * (1 - k / length)) + 1);
        for (let t = 0; t < thick; t++) put(cx - k, baseY + t + Math.floor(k * 0.08), CAST);
      }
    }
    for (let row = 0; row < body; row++) {
      const p = row / body;
      const tier = Math.floor(row / tierHeight);
      const u = (row - tier * tierHeight) / tierHeight;
      const ragged = (hash(row, Math.floor(cx), 5) - 0.5) * 1.4 + (u > 0.8 ? 0.9 : 0);
      const reach = Math.max(0.6, 0.5 + half * (0.12 + 0.88 * p) * (0.5 + 0.5 * u) + ragged);
      const y = top + row;
      for (let x = Math.floor(cx - reach); x < Math.ceil(cx + reach); x++) {
        const s = (x + 0.5 - cx) / reach;
        const clump = noise(x * 0.45, row * 0.6, 17);
        let color: RGB;
        if (row < 2 || (u < 0.26 + 0.2 * clump && Math.abs(s) < 0.86 - 0.3 * u))
          color = s > 0.1 ? style.snow : style.snowShade;
        else if (u > 0.82) color = style.dark;
        else {
          const shade = s + (bayer(x, y) - 0.5) * 0.35;
          color = shade > 0.4 ? style.lit : shade < -0.2 ? style.dark : style.mid;
        }
        put(x, y, color);
      }
    }
    rect(cx - 0.5, baseY - trunk, cx + 0.5 + (height > 36 ? 1 : 0), baseY, style.trunk);
  };

  // A hill of far pines before the dunes: back row lighter and smaller, front row darker.
  const hillBase = h * 0.745;
  const hill = new Float32Array(w);
  for (let x = 0; x < w; x++)
    hill[x] = hillBase - h * 0.045 * noise(x * 0.012, 0, 41) - h * 0.015 * noise(x * 0.05, 3, 42);
  for (let x = 0; x < w; x++) {
    for (let y = Math.ceil(hill[x]!); y < h; y++) put(x, y, y < hill[x]! + 5 ? PINE_FAR.mid : PINE_FAR.dark);
  }
  for (let row = 0; row < 2; row++) {
    const style = row === 0 ? PINE_FAR : PINE_NEAR;
    for (let x = row * 3; x < w + 6; x += 4 + Math.floor(rand() * 4)) {
      const at = clamp(x, 0, w - 1);
      const size = h * (row === 0 ? 0.052 : 0.07) * (0.75 + rand() * 0.55);
      pine(x, hill[at]! + (row === 0 ? 4 : 8), size, { ...style, trunk: style.dark }, false);
    }
  }

  // Dunes, back to front. Each crest is lit warm where it faces the sun and cool where it faces away; the hollow
  // in front of the next crest lies in shadow.
  const dunes = [
    { base: 0.775, amp: 0.012, freq: 1.7, phase: 0.6 },
    { base: 0.825, amp: 0.02, freq: 1.15, phase: 2.1 },
    { base: 0.89, amp: 0.028, freq: 0.8, phase: 4.0 },
    { base: 0.96, amp: 0.032, freq: 0.62, phase: 1.3 },
  ];
  const crest = dunes.map((dune, index) => {
    const line = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const xn = x / w;
      line[x] =
        (dune.base +
          dune.amp *
            (Math.sin(xn * dune.freq * Math.PI * 2 + dune.phase) * 0.6 +
              Math.sin(xn * dune.freq * Math.PI * 4.6 + dune.phase * 2) * 0.4 +
              (noise(xn * 9, 0, 60 + index) - 0.5) * 0.7)) *
        h;
    }
    return line;
  });

  const chimney = { x: 0, y: 0 };
  const cabin = (cx: number, baseY: number) => {
    chimney.x = Math.round(cx - 7) + 10.5;
    chimney.y = baseY - 20;
    const logs = rgb('#7a5a47');
    const logsDark = rgb('#654a3b');
    const bx = Math.round(cx - 7);
    // Smoke-grey chimney and the wall of logs.
    rect(bx + 9, baseY - 18, bx + 12, baseY - 11, rgb('#8d7770'));
    rect(bx + 8, baseY - 19, bx + 13, baseY - 18, SNOW_WHITE);
    rect(bx, baseY - 9, bx + 15, baseY, logs);
    for (let r = baseY - 8; r < baseY; r += 2) rect(bx, r, bx + 15, r + 1, logsDark);
    rect(bx + 14, baseY - 9, bx + 15, baseY, logsDark);
    // Roof with snow on it.
    for (let r = 0; r < 8; r++) {
      const reach = 9 - r;
      rect(
        cx - reach,
        baseY - 10 - r,
        cx + reach + 1,
        baseY - 9 - r,
        r === 7 ? SNOW_WHITE : r < 6 ? SNOW_WHITE : SNOW_COOL,
      );
      put(cx - reach, baseY - 10 - r, SNOW_COOL);
    }
    rect(cx - 9, baseY - 10, cx + 10, baseY - 9, rgb('#bcd0e4'));
    // Window and door, with the lamp-light of the window on the snow.
    rect(bx + 3, baseY - 7, bx + 6, baseY - 4, rgb('#ffd27d'));
    rect(bx + 3, baseY - 6, bx + 6, baseY - 5, rgb('#ffe9ae'));
    rect(bx + 9, baseY - 6, bx + 12, baseY, rgb('#4d382e'));
    rect(bx + 2, baseY, bx + 7, baseY + 1, rgb('#ffe9ba'));
  };

  /** A hare's tracks hopping along a dune: two long hind prints side by side, then two small front ones in a line. */
  const tracks = (line: Float32Array, from: number, to: number, drop: number) => {
    const print = rgb('#b9cde1');
    for (let x = Math.floor(from * w); x < to * w; x += 17) {
      const y = Math.round(line[x]! + drop + Math.sin(x * 0.05) * 2);
      rect(x, y, x + 2, y + 1, print);
      rect(x, y + 3, x + 2, y + 4, print);
      put(x + 6, y + 1, print);
      put(x + 8, y + 2, print);
    }
  };

  const trees: Record<number, [number, number][]> = {
    0: [
      [0.06, 0.1],
      [0.09, 0.075],
      [0.4, 0.075],
      [0.66, 0.08],
      [0.93, 0.095],
    ],
    1: [
      [0.17, 0.15],
      [0.2, 0.11],
      [0.36, 0.1],
      [0.74, 0.14],
      [0.77, 0.1],
      [0.9, 0.16],
    ],
    2: [[0.7, 0.1]],
  };

  dunes.forEach((_, index) => {
    const line = crest[index]!;
    const next = crest[index + 1];
    for (let x = 0; x < w; x++) {
      const slope = (line[Math.min(w - 1, x + 2)]! - line[Math.max(0, x - 2)]!) / 4;
      for (let y = Math.ceil(line[x]!); y < h; y++) {
        const depth = y - line[x]!;
        let color: RGB;
        if (depth < 1.2) color = SNOW_WHITE;
        else if (depth < 4.5) color = bayer(x, y) < smooth(-0.15, 0.15, slope) ? SNOW_LIT : SNOW_COOL;
        else color = SNOW_BODY;
        if (next) {
          const gap = next[x]! - y;
          const band = h * (0.045 + index * 0.012);
          if (gap > 0 && gap < band) {
            const t = 1 - gap / band;
            color = t > 0.78 ? SNOW_DEEP : bayer(x, y) < t * 1.1 ? SNOW_SHADE : color;
          }
        }
        put(x, y, color);
      }
    }
    // Wind-blown ripples.
    for (let n = 0; n < w / 7; n++) {
      const x = Math.floor(rand() * w);
      const y = Math.floor(line[x]! + 3 + rand() * h * 0.05);
      const length = 2 + Math.floor(rand() * 6);
      for (let k = 0; k < length; k++) if (y < h) put(x + k, y, SNOW_SHADE);
    }
    for (const [xn, size] of trees[index] ?? []) {
      const x = Math.floor(xn * w);
      pine(x, line[clamp(x, 0, w - 1)]! + 3, size * h, index === 0 ? PINE_FAR : PINE_NEAR);
    }
    if (index === 2) tracks(line, 0.29, 0.69, 6);
    if (index === 1) cabin(Math.floor(w * 0.3), Math.round(line[Math.floor(w * 0.3)]! + 4));
  });

  // The big pines at the sides, nearest of all.
  const hero: [number, number, number][] = [
    [0.035, 0.93, 0.72],
    [0.135, 0.89, 0.46],
    [0.96, 0.94, 0.6],
    [0.875, 0.9, 0.4],
  ];
  for (const [xn, baseY, size] of hero)
    pine(Math.floor(xn * w), Math.floor(baseY * h), Math.round(size * h), PINE_NEAR);
  // The last dune crest covers their feet.
  const front = crest[crest.length - 1]!;
  for (let x = 0; x < w; x++) {
    for (let y = Math.ceil(front[x]!); y < h; y++) {
      const depth = y - front[x]!;
      put(x, y, depth < 1.2 ? SNOW_WHITE : depth < 4.5 ? SNOW_LIT : SNOW_BODY);
    }
  }
  return { data, chimney };
}
