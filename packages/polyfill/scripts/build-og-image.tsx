import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import sharp from 'sharp';
import { OgTemplate } from './og/template';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'assets/og');
const FONTS_DIR = resolve(__dirname, 'og/fonts');

const OG = {
  eyebrow: 'Open Source Polyfill',
  title: '@ait-co/polyfill',
  subtitle: '표준 Web API로 미니앱을 작성',
  footer: 'aitc.dev · github.com/apps-in-toss-community/polyfill',
};

async function loadFonts(): Promise<Parameters<typeof satori>[1]['fonts']> {
  const [bold, semibold, medium] = await Promise.all([
    readFile(resolve(FONTS_DIR, 'Pretendard-Bold.otf')),
    readFile(resolve(FONTS_DIR, 'Pretendard-SemiBold.otf')),
    readFile(resolve(FONTS_DIR, 'Pretendard-Medium.otf')),
  ]);
  return [
    { name: 'Pretendard', data: medium, weight: 500, style: 'normal' },
    { name: 'Pretendard', data: semibold, weight: 600, style: 'normal' },
    { name: 'Pretendard', data: bold, weight: 700, style: 'normal' },
  ];
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const fonts = await loadFonts();

  const start = Date.now();
  const svg = await satori(<OgTemplate {...OG} />, { width: 1200, height: 630, fonts });
  const png = await sharp(Buffer.from(svg))
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
  await writeFile(resolve(OUT_DIR, 'image.png'), png);
  console.log(`[og] wrote assets/og/image.png in ${Date.now() - start}ms`);
}

main().catch((err) => {
  console.error('[og] failed:', err);
  process.exit(1);
});
