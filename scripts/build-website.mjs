import { mkdir, cp, copyFile, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const site = join(root, 'apps/website');
const dist = join(site, 'dist');
await rm(dist, { recursive: true, force: true });
await cp(join(site, 'src'), dist, { recursive: true });
await mkdir(join(dist, 'brand'), { recursive: true });
for (const file of [
  'hare.png',
  'icon.png',
  'icon-16.png',
  'icon-32.png',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
  'favicon.ico',
  'site.webmanifest',
  'wordmark.png',
  'wordmark-light.png',
  'social-preview.png',
]) {
  await copyFile(join(root, 'assets/brand', file), join(dist, 'brand', file));
}
await mkdir(join(dist, 'images'), { recursive: true });
for (const file of ['start.png', 'agents.png']) {
  await copyFile(join(root, 'assets/images', file), join(dist, 'images', file));
}
await mkdir(join(dist, 'fonts'), { recursive: true });
const font = join(root, 'packages/ui/node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2');
await access(font);
await copyFile(font, join(dist, 'fonts/PretendardVariable.woff2'));
await copyFile(join(root, 'packages/ui/node_modules/pretendard/dist/LICENSE.txt'), join(dist, 'fonts/LICENSE.txt'));
console.log(`Website built: ${dist}`);
