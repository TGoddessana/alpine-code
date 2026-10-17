import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('waits for normal, bold and Nerd Font glyphs once across simultaneous terminals', async () => {
  vi.resetModules();
  const pending: ((faces: FontFace[]) => void)[] = [];
  const load = vi.fn(() => new Promise<FontFace[]>((resolve) => pending.push(resolve)));
  vi.stubGlobal('document', { fonts: { load } });
  const { loadTerminalFonts } = await import('./fonts');
  let ready = false;
  const first = loadTerminalFonts().then(() => {
    ready = true;
  });
  const second = loadTerminalFonts();
  expect(load.mock.calls).toHaveLength(3);
  pending[0]!([{} as FontFace]);
  pending[1]!([{} as FontFace]);
  await Promise.resolve();
  expect(ready).toBe(false);
  pending[2]!([{} as FontFace]);
  await Promise.all([first, second]);
  expect(ready).toBe(true);
  await loadTerminalFonts();
  expect(load.mock.calls).toHaveLength(3);
});

it('allows retry after a missing glyph font rather than caching failure forever', async () => {
  vi.resetModules();
  const load = vi.fn().mockResolvedValue([]);
  vi.stubGlobal('document', { fonts: { load } });
  const { loadTerminalFonts } = await import('./fonts');
  await expect(loadTerminalFonts()).rejects.toThrow('Terminal fonts could not be loaded');
  load.mockResolvedValue([{} as FontFace]);
  await expect(loadTerminalFonts()).resolves.toBeUndefined();
  expect(load).toHaveBeenCalledTimes(6);
});
