let loading: Promise<void> | undefined;

/** Load the actual cell and icon fonts before xterm measures or caches glyphs. */
export function loadTerminalFonts(): Promise<void> {
  if (!document.fonts) return Promise.resolve();
  return (loading ??= Promise.all([
    document.fonts.load('400 13px "JetBrains Mono"', 'MW0'),
    document.fonts.load('700 13px "JetBrains Mono"', 'MW0'),
    document.fonts.load('400 13px "Symbols Nerd Font Mono"', '\ue0b0\uf120\uf07b\uf126\u{f0001}'),
  ])
    .then((faces) => {
      if (faces.some((loaded) => !loaded.length)) throw new Error('Terminal fonts could not be loaded');
    })
    .catch((cause: unknown) => {
      loading = undefined;
      throw cause;
    }));
}
