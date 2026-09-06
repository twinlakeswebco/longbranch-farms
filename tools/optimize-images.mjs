#!/usr/bin/env node
/**
 * Long Branch Farms - image optimizer.
 *
 * Turns the camera-original JPEGs in images/ into small, web-sized files:
 * a WebP and a JPEG at 480 / 960 / 1440 / 1920 pixels wide (never bigger
 * than the original). The site picks whichever one fits the visitor's
 * screen, so phones on rural connections download a few hundred KB
 * instead of several megabytes.
 *
 * Naming:
 *   images/photo-3-480.webp   images/photo-3-480.jpeg
 *   images/photo-3-960.webp   images/photo-3-960.jpeg
 *   images/photo-3-1440.webp  images/photo-3.jpeg   <- the 1440px JPEG keeps
 *   images/photo-3-1920.webp  images/photo-3-1920.jpeg   the plain name, so it
 *                                                        stays a working link
 *                                                        and a safe fallback.
 *
 * See tools/README.md for how to run it.
 */

import { readdir, readFile, stat, rename, access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(ROOT, 'images');

const WIDTHS = [480, 960, 1440, 1920];
const BASE_WIDTH = 1440;          // the size that keeps the plain photo-N.jpeg name
const MAX_BYTES = 400_000;        // hard ceiling for any single delivered file
const WEBP_QUALITY = 80;          // 78-82 range
const JPEG_QUALITY = 82;          // 80-85 range
const MIN_QUALITY = 60;           // never drop below this chasing the size cap
const DENOISE_SIGMA = 0.8;        // last resort for grainy low-light photos
const MAX_PIXELS = 1920 * 1440;   // biggest render we ever ship, in pixels
const LOGO_WIDTH = 192;           // logo is never shown taller than 48 CSS px

// Only these PNGs get shrunk. Anything else someone drops in images/ later --
// a share image, a map, a diagram -- is left strictly alone.
const LOGO_FILES = ['LBF-logo-transparent.png'];

// Written next to this script so the next run knows what it already did, and
// so the width/height numbers for new <img> tags are easy to look up.
const MANIFEST = path.join(ROOT, 'tools', 'image-manifest.json');

const force = process.argv.includes('--force');

/**
 * Widths we should actually render for one source image.
 *
 * Never upscale, and never spend more than MAX_PIXELS on a single render. The
 * pixel budget matters for the portrait shots: 1920 pixels wide on a 3:4 photo
 * is a 4.9 megapixel file, nearly twice what the same width costs on a
 * landscape one. Budgeting by pixels rather than by width gives tall and wide
 * photos the same weight, which is what the layout actually cares about.
 *
 * The biggest render is whatever that budget allows rather than the next
 * standard width down, so a very tall photo lands on its own ceiling instead
 * of silently dropping to 960.
 */
function targetsFor(srcWidth, srcHeight) {
  const aspect = srcHeight / srcWidth;
  const budgetWidth = Math.floor(Math.sqrt(MAX_PIXELS / aspect));
  const largest = Math.min(srcWidth, Math.max(...WIDTHS), budgetWidth);

  const list = WIDTHS.filter((w) => w < largest);
  list.push(largest);

  return [...new Set(list)].sort((a, b) => a - b);
}

/** Output path for one photo at one width in one format. */
function outputPath(stem, width, format, baseWidth) {
  if (format === 'jpeg' && width === baseWidth) {
    return path.join(IMAGES, `${stem}.jpeg`);
  }
  return path.join(IMAGES, `${stem}-${width}.${format}`);
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

/**
 * Encode one derivative and get it under the size cap.
 *
 * First pass: step the quality down from the target toward MIN_QUALITY.
 * If a photo is still too big at MIN_QUALITY it is almost always a grainy
 * low-light shot where the "detail" the encoder is spending bytes on is
 * camera noise, so the second pass walks the same ladder with a gentle blur
 * applied first. That buys far more than crushing the quality further, and
 * it leaves every well-lit photo untouched.
 */
async function encode(pipeline, width, format, destination) {
  const startQuality = format === 'webp' ? WEBP_QUALITY : JPEG_QUALITY;
  let best = null;

  const attempt = async (quality, sigma) => {
    let img = pipeline.clone().resize({ width, withoutEnlargement: true });
    if (sigma) img = img.blur(sigma);
    const encoded = format === 'webp'
      ? img.webp({ quality, effort: 6, smartSubsample: true })
      : img.jpeg({ quality, progressive: true, mozjpeg: true, chromaSubsampling: '4:2:0' });

    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    // Keep whichever attempt is smallest, so a pass that fails to get under
    // the cap can never leave a worse file behind than one we already had.
    if (!best || info.size < best.info.size) best = { data, info, quality, denoise: sigma };
    return info.size;
  };

  outer:
  for (const sigma of [0, DENOISE_SIGMA]) {
    let quality = startQuality;
    for (;;) {
      if (await attempt(quality, sigma) <= MAX_BYTES) break outer;
      if (quality <= MIN_QUALITY) break;
      quality = Math.max(MIN_QUALITY, quality - 6);
    }
  }

  await writeFile(destination, best.data);

  if (best.info.size > MAX_BYTES) {
    console.warn(`  ! ${path.basename(destination)} is ${(best.info.size / 1000).toFixed(0)} KB, over the ${MAX_BYTES / 1000} KB cap`);
  }

  return {
    file: path.relative(ROOT, destination).replaceAll(path.sep, '/'),
    width: best.info.width,
    height: best.info.height,
    bytes: best.info.size,
    quality: best.quality,
    denoise: best.denoise,
  };
}

async function optimizePhoto(stem) {
  const source = path.join(IMAGES, `${stem}.jpeg`);
  // Read the original into memory first: the 1440px JPEG is written back over
  // this same path, and every later size still needs the full-size pixels.
  const original = await readFile(source);
  // .rotate() with no argument applies the EXIF orientation and then drops
  // the metadata, so every resized file comes out upright and stripped.
  const pipeline = sharp(original).rotate();
  const meta = await pipeline.metadata();
  const srcWidth = meta.autoOrient?.width ?? meta.width;
  const srcHeight = meta.autoOrient?.height ?? meta.height;

  const widths = targetsFor(srcWidth, srcHeight);
  const baseWidth = Math.max(...widths.filter((w) => w <= BASE_WIDTH));

  const outputs = [];
  for (const width of widths) {
    for (const format of ['webp', 'jpeg']) {
      const destination = outputPath(stem, width, format, baseWidth);
      const result = await encode(pipeline, width, format, destination);
      outputs.push({ ...result, format, requestedWidth: width, base: destination === source });
    }
  }
  return { stem, srcWidth, srcHeight, baseWidth, outputs };
}

async function optimizeLogo(name) {
  const file = path.join(IMAGES, name);
  const temp = `${file}.tmp`;
  const info = await sharp(file)
    .rotate()
    .resize({ width: LOGO_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(temp);
  await rename(temp, file);
  return { file: `images/${name}`, width: info.width, height: info.height, bytes: info.size };
}

/** What the last run produced, or an empty record the first time through. */
async function readManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST, 'utf8'));
  } catch {
    return { photos: {}, logos: {} };
  }
}

async function main() {
  const previous = await readManifest();
  const manifest = { photos: {}, logos: {} };

  // Files the last run wrote are derivatives, not new sources to process.
  // Reading that from the manifest rather than guessing from the filename
  // keeps a photo like photo-28-1600.jpeg from being mistaken for a source.
  const knownOutputs = new Set(
    Object.values(previous.photos ?? {}).flatMap((p) => p.outputs.map((o) => path.basename(o.file)))
  );

  const entries = await readdir(IMAGES);
  const stems = entries
    .filter((f) => /^photo-.*\.jpeg$/.test(f))
    .map((f) => f.replace(/\.jpeg$/, ''))
    // Keep it if we already track it as a photo (the base JPEG keeps the plain
    // name, so it is both a source and an output), or if it isn't a file the
    // last run wrote at all.
    .filter((stem) => stem in (previous.photos ?? {}) || !knownOutputs.has(`${stem}.jpeg`))
    .sort();

  let before = 0;
  let after = 0;

  for (const stem of stems) {
    const source = path.join(IMAGES, `${stem}.jpeg`);
    const sourceBytes = (await stat(source)).size;

    // Already processed? Running again over an already-shrunk file would only
    // soften it further, so skip unless --force is passed (see tools/README.md).
    const done = previous.photos?.[stem];
    if (!force && done && await Promise.all(done.outputs.map((o) => exists(path.join(ROOT, o.file)))).then((r) => r.every(Boolean))) {
      manifest.photos[stem] = done;
      console.log(`${stem}: already optimized, skipping (use --force to redo)`);
      continue;
    }

    before += sourceBytes;
    const result = await optimizePhoto(stem);
    manifest.photos[stem] = result;
    const total = result.outputs.reduce((sum, o) => sum + o.bytes, 0);
    after += total;

    const largest = Math.max(...result.outputs.map((o) => o.bytes));
    console.log(
      `${stem}: ${(sourceBytes / 1048576).toFixed(2)} MB -> ` +
      `${result.outputs.length} files, ${(total / 1000).toFixed(0)} KB total, ` +
      `largest ${(largest / 1000).toFixed(0)} KB, base ${result.baseWidth}px`
    );
  }

  for (const logo of LOGO_FILES) {
    if (!entries.includes(logo)) continue;
    const sourceBytes = (await stat(path.join(IMAGES, logo))).size;
    const done = previous.logos?.[logo];
    if (!force && done) {
      manifest.logos[logo] = done;
      console.log(`${logo}: already optimized, skipping`);
      continue;
    }
    const result = await optimizeLogo(logo);
    manifest.logos[logo] = result;
    console.log(`${logo}: ${(sourceBytes / 1000).toFixed(0)} KB -> ${(result.bytes / 1000).toFixed(0)} KB`);
  }

  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(
    `\nPhotos: ${(before / 1048576).toFixed(1)} MB of originals -> ` +
    `${(after / 1048576).toFixed(1)} MB of web sizes.` +
    `\nSizes for new <img> tags are listed in ${path.relative(ROOT, MANIFEST)}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
