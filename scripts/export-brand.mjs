import { mkdir, writeFile, copyFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

// Export approved artwork; do not regenerate or redraw it per application.
const root = fileURLToPath(new URL('../', import.meta.url));
const brand = join(root, 'assets/brand');
const desktop = join(root, 'apps/desktop');
const publicBrand = join(desktop, 'public/brand');
await mkdir(publicBrand, { recursive: true });
const source = (name) => join(brand, 'source', name);
const png = async (input, size, output) => sharp(input).resize(size, size, { kernel: 'nearest' }).png().toFile(output);

await png(source('hare-transparent.png'), 1024, join(brand, 'hare.png'));
await png(source('icon-transparent.png'), 1024, join(brand, 'icon.png'));
await png(source('hare-transparent.png'), 256, join(publicBrand, 'hare.png'));
for (const size of [16, 32, 48, 64, 128, 180, 192, 256, 512]) {
  await png(source('icon-transparent.png'), size, join(brand, `icon-${size}.png`));
}
await copyFile(join(brand, 'icon-32.png'), join(desktop, 'public/favicon.png'));

// Official Tauri exporter supplies native formats and Windows tile dimensions.
const temporary = await mkdtemp(join(tmpdir(), 'alpine-brand-'));
try {
  execFileSync('pnpm', ['--filter', '@alpine/desktop', 'tauri', 'icon', join(brand, 'icon.png'), '-o', temporary], {
    cwd: root,
    stdio: 'pipe',
  });
  const icons = join(desktop, 'src-tauri/icons');
  for (const file of await readdir(temporary, { withFileTypes: true })) {
    if (file.isFile()) await copyFile(join(temporary, file.name), join(icons, file.name));
  }
  await copyFile(join(temporary, 'icon.ico'), join(brand, 'favicon.ico'));
  await copyFile(join(temporary, 'icon.icns'), join(brand, 'icon.icns'));
} finally {
  await rm(temporary, { recursive: true });
}

// Embed the repository's font explicitly so Linux and macOS exports use the same lettering.
const fontRoot = join(root, 'packages/ui/node_modules/pretendard/dist/public/static');
// sharp's bundled fontconfig may have no host configuration (notably on macOS).
const fontConfig = await mkdtemp(join(tmpdir(), 'alpine-fonts-'));
const xmlPath = (path) => path.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
await writeFile(
  join(fontConfig, 'fonts.conf'),
  `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>${xmlPath(fontRoot)}</dir><cachedir>${xmlPath(fontConfig)}</cachedir></fontconfig>`,
);
process.env.FONTCONFIG_FILE = join(fontConfig, 'fonts.conf');
const label = async (text, size, ink, bold = false) =>
  sharp({
    text: {
      text: `<span foreground="${ink}">${text}</span>`,
      font: `Pretendard ${bold ? 'Bold' : 'Regular'} ${size}`,
      fontfile: join(fontRoot, `Pretendard-${bold ? 'Bold' : 'Regular'}.otf`),
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer();
const character = await sharp(join(brand, 'hare.png')).resize(240, 240, { kernel: 'nearest' }).toBuffer();
for (const [name, ink] of [
  ['wordmark', '#1a222a'],
  ['wordmark-light', '#fdfeff'],
]) {
  await sharp({ create: { width: 960, height: 240, channels: 4, background: '#00000000' } })
    .composite([
      { input: character, left: 0, top: 0 },
      { input: await label('Alpine Code', 88, ink, true), left: 260, top: 88 },
    ])
    .png()
    .toFile(join(brand, `${name}.png`));
}
await sharp({ create: { width: 1280, height: 640, channels: 4, background: '#eaf1f7' } })
  .composite([
    {
      input: await sharp(join(brand, 'hare.png')).resize(500, 500, { kernel: 'nearest' }).toBuffer(),
      left: 780,
      top: 65,
    },
    { input: await label('Alpine Code', 84, '#1a222a', true), left: 88, top: 155 },
    { input: await label('An open-source AI coding agent.', 29, '#2c5a7a'), left: 92, top: 285 },
    { input: await label('github.com/TGoddessana/alpine-code', 20, '#53616f'), left: 92, top: 480 },
  ])
  .png()
  .toFile(join(brand, 'social-preview.png'));
await rm(fontConfig, { recursive: true });
const manifest = {
  name: 'Alpine Code',
  short_name: 'Alpine',
  icons: [192, 512].map((size) => ({
    src: `icon-${size}.png`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: 'any',
  })),
  theme_color: '#2c5a7a',
  background_color: '#eaf1f7',
  display: 'standalone',
};
await writeFile(join(brand, 'site.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Brand exports written to ${resolve(brand)}`);
