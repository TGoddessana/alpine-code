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

// App icon on the macOS grid: an 824 px continuous-corner tile inside a 1024 px canvas,
// leaving room for the drop shadow the Dock expects.
const appIcon = async () => {
  const size = 1024;
  const inset = 100;
  const tile = 824;
  const points = Array.from({ length: 360 }, (_, i) => {
    const t = (i / 360) * 2 * Math.PI;
    const axis = (v) => Math.sign(v) * Math.abs(v) ** (2 / 5);
    return [inset + (tile / 2) * (1 + axis(Math.cos(t))), inset + (tile / 2) * (1 + axis(Math.sin(t)))];
  });
  const path = `M${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}Z`;
  const hareHeight = 640;
  const hare = await sharp(await sharp(source('hare-transparent.png')).trim().toBuffer())
    .resize({ height: hareHeight, kernel: 'nearest' })
    .toBuffer({ resolveWithObject: true });
  const left = Math.round((size - hare.info.width) / 2);
  const top = inset + (tile - hareHeight) / 2 + 6;
  const hareShadow = await sharp(hare.data).linear([0, 0, 0, 0.28], [0, 0, 0, 0]).blur(10).toBuffer();
  const background = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9d2f0"/><stop offset="1" stop-color="#6fa6d3"/></linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.18" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#5d93c0" stop-opacity="0.6"/></linearGradient>
      <filter id="drop" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="12"/><feComponentTransfer><feFuncA type="linear" slope="0.32"/></feComponentTransfer></filter>
    </defs>
    <path d="${path}" filter="url(#drop)"/>
    <path d="${path}" fill="url(#sky)"/>
    <path d="${path}" fill="url(#glow)"/>
    <ellipse cx="${size / 2}" cy="${top + hareHeight - 8}" rx="230" ry="26" fill="#0b2a44" fill-opacity="0.16"/>
    <path d="${path}" fill="none" stroke="url(#rim)" stroke-width="3"/>
  </svg>`;
  return sharp(Buffer.from(background))
    .composite([
      { input: hareShadow, left, top: top + 10 },
      { input: hare.data, left, top },
    ])
    .png()
    .toBuffer();
};

await png(source('hare-transparent.png'), 1024, join(brand, 'hare.png'));
const icon = await appIcon();
await sharp(icon).toFile(join(brand, 'icon.png'));
await png(source('hare-transparent.png'), 256, join(publicBrand, 'hare.png'));
for (const size of [16, 32, 48, 64, 128, 180, 192, 256, 512]) {
  // Smooth downscaling keeps the gradient and shadow clean at small sizes.
  await sharp(icon).resize(size, size).png().toFile(join(brand, `icon-${size}.png`));
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
