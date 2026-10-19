/**
 * What moves in front of the scene: snow drifting down in a few sizes (the bigger ones nearer, so they fall faster
 * and sway wider) and smoke rising from the cabin's chimney. It keeps its own state and draws it on any 2D context
 * the size of the picture, one picture pixel per flake pixel.
 */

interface Flake {
  x: number;
  y: number;
  /** Pixels per second downwards. */
  fall: number;
  /** How far it sways either way, and how fast. */
  sway: number;
  rate: number;
  phase: number;
  size: 1 | 2 | 3;
}

interface Puff {
  x: number;
  y: number;
  age: number;
  life: number;
}

const WIND = 5;

export interface Snowfall {
  step(seconds: number): void;
  draw(context: CanvasRenderingContext2D): void;
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

/** Snow over a `width` x `height` picture, with smoke from `chimney` if given. */
export function createSnowfall(width: number, height: number, chimney?: { x: number; y: number }, seed = 5): Snowfall {
  const rand = random(seed);
  const flakes: Flake[] = Array.from({ length: Math.round((width * height) / 380) }, () => {
    const depth = rand();
    const size = depth > 0.93 ? 3 : depth > 0.72 ? 2 : 1;
    return {
      x: rand() * width,
      y: rand() * height,
      fall: 7 + depth * 22 + rand() * 4,
      sway: 1.5 + depth * 5,
      rate: 0.5 + rand() * 0.9,
      phase: rand() * Math.PI * 2,
      size,
    };
  });
  const puffs: Puff[] = [];
  let clock = 0;
  let nextPuff = 0;

  return {
    step(seconds) {
      clock += seconds;
      for (const flake of flakes) {
        flake.y += flake.fall * seconds;
        flake.x += WIND * seconds * (0.5 + flake.fall / 30);
        if (flake.y > height + 2) {
          flake.y = -3;
          flake.x = rand() * width;
        }
        if (flake.x > width + 3) flake.x -= width + 6;
      }
      if (chimney) {
        if (clock >= nextPuff) {
          nextPuff = clock + 0.55 + rand() * 0.3;
          puffs.push({ x: chimney.x, y: chimney.y, age: 0, life: 5 + rand() * 2 });
        }
        for (const puff of puffs) {
          puff.age += seconds;
          puff.y -= 6 * seconds;
          puff.x += (2.5 + puff.age * 2.2) * seconds;
        }
        while (puffs.length > 0 && puffs[0]!.age > puffs[0]!.life) puffs.shift();
      }
    },
    draw(context) {
      context.clearRect(0, 0, width, height);
      for (const puff of puffs) {
        const t = puff.age / puff.life;
        context.fillStyle = `rgba(248, 250, 252, ${(0.85 * (1 - t)).toFixed(2)})`;
        const size = t < 0.3 ? 1 : t < 0.7 ? 2 : 3;
        context.fillRect(Math.floor(puff.x), Math.floor(puff.y), size, size);
      }
      for (const flake of flakes) {
        const x = Math.floor(flake.x + Math.sin(clock * flake.rate + flake.phase) * flake.sway);
        const y = Math.floor(flake.y);
        if (flake.size > 1) {
          context.fillStyle = 'rgba(120, 150, 185, 0.3)';
          context.fillRect(x + 1, y + 1, flake.size === 3 ? 3 : 2, flake.size === 3 ? 3 : 2);
        }
        context.fillStyle = flake.size === 1 ? 'rgba(255, 255, 255, 0.85)' : '#ffffff';
        if (flake.size === 3) {
          context.fillRect(x, y + 1, 3, 1);
          context.fillRect(x + 1, y, 1, 3);
        } else context.fillRect(x, y, flake.size, flake.size);
      }
    },
  };
}
