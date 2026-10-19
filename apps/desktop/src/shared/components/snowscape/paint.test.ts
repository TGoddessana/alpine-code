import { describe, expect, it } from 'vitest';

import { paintSnowscape, pixelSizeFor } from './paint';
import { createSnowfall } from './snowfall';

const pixel = (data: Uint8ClampedArray, width: number, x: number, y: number) => {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

describe('paintSnowscape', () => {
  it('paints every pixel of the size asked, the same way each time', () => {
    const first = paintSnowscape(120, 80);
    expect(first.data).toHaveLength(120 * 80 * 4);
    for (let i = 3; i < first.data.length; i += 4) expect(first.data[i]).toBe(255);
    expect(paintSnowscape(120, 80).data).toEqual(first.data);
    expect(paintSnowscape(120, 80, 99).data).not.toEqual(first.data);
  });

  it('has sky above and snow below, and a chimney inside the picture', () => {
    const { data, chimney } = paintSnowscape(200, 130);
    const [r, , b] = pixel(data, 200, 100, 1);
    expect(b!).toBeGreaterThan(r!); // blue sky at the top
    const [snowR, snowG, snowB] = pixel(data, 200, 100, 129);
    expect(Math.min(snowR!, snowG!, snowB!)).toBeGreaterThan(200); // pale snow at the bottom
    expect(chimney.x).toBeGreaterThan(0);
    expect(chimney.x).toBeLessThan(200);
    expect(chimney.y).toBeGreaterThan(0);
    expect(chimney.y).toBeLessThan(130);
  });

  it('copes with a tiny size', () => {
    expect(paintSnowscape(1, 1).data).toHaveLength(4);
  });
});

describe('pixelSizeFor', () => {
  it('keeps the picture about 300 x 190 pixels, within 3 to 6 screen pixels each', () => {
    expect(pixelSizeFor(1170, 810)).toBe(4);
    expect(pixelSizeFor(480, 400)).toBe(3);
    expect(pixelSizeFor(3000, 2000)).toBe(6);
  });
});

function recorder() {
  const calls: number[][] = [];
  const context = {
    clearRect: () => {},
    fillRect: (x: number, y: number) => calls.push([x, y]),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D;
  return { calls, context };
}

describe('createSnowfall', () => {
  it('keeps its flakes inside the picture as time passes', () => {
    const { calls, context } = recorder();
    const snowfall = createSnowfall(100, 60);
    for (let tick = 0; tick < 400; tick++) snowfall.step(0.1);
    snowfall.draw(context);
    expect(calls.length).toBeGreaterThan(10);
    for (const [x, y] of calls) {
      expect(x!).toBeGreaterThanOrEqual(-12);
      expect(x!).toBeLessThanOrEqual(120);
      expect(y!).toBeGreaterThanOrEqual(-6);
      expect(y!).toBeLessThanOrEqual(66);
    }
  });

  it('lets smoke rise from the chimney and drift off to the side', () => {
    const { calls: without, context: plain } = recorder();
    const { calls: withSmoke, context } = recorder();
    const bare = createSnowfall(100, 60);
    const smoking = createSnowfall(100, 60, { x: 50, y: 50 });
    for (let tick = 0; tick < 20; tick++) {
      bare.step(0.1);
      smoking.step(0.1);
    }
    bare.draw(plain);
    smoking.draw(context);
    const smoke = withSmoke.filter(([x, y]) => x! >= 50 && x! <= 60 && y! >= 40 && y! <= 51);
    expect(withSmoke.length).toBeGreaterThan(without.length);
    expect(smoke.length).toBeGreaterThan(0);
  });
});
