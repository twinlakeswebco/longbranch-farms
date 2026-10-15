/** Browser integration checks. Test backend is injected only in this process, never shipped. */
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startServer } from './dev-server.mjs';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = createRequire(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/package.json')('playwright'); }
const server = await startServer(0);
const port = server.port;
const base = `http://127.0.0.1:${port}`;
const browser = await playwright.chromium.launch({ executablePath: process.env.CMS_TEST_BROWSER || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu'] });
const shots = new URL('./.e2e-shots/', import.meta.url);
await mkdir(shots, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('requestfailed', r => console.log('FAILED:', r.url()));
page.on('console', msg => { if(msg.type()==='error') console.log('BROWSER:',msg.text().slice(0,500)); });
try {
  const slots = JSON.parse(await readFile(new URL('../admin/photo-slots.json', import.meta.url)));
  const seedFiles = ['index.html', 'about/index.html', ...slots.map(s => `content/${s.key}.json`), ...slots.flatMap(s => s.files.map(f => (s.folder === '.' ? '' : s.folder + '/') + f.name))];
  await page.route('**/admin/', async route => {
    const html = await readFile(new URL('../admin/index.html', import.meta.url), 'utf8');
    await route.fulfill({ contentType: 'text/html', body: html.replace('</head>', '<link rel="cms-seed-url" href="/__cms-test-manifest.json"></head>') });
  });
  await page.route('**/__cms-test-manifest.json', route => route.fulfill({ json: { files: [...new Set(seedFiles)] } }));
  await page.route('**/admin/editor.js', async route => {
    const script = await readFile(new URL('../admin/editor.js', import.meta.url), 'utf8');
    await route.fulfill({ contentType: 'application/javascript', body: script.replace("name: 'github', repo: 'twinlakeswebco/longbranch-farms', branch: 'main'", "name: 'test-repo'") });
  });
  await page.goto(base + '/admin/');
  await page.getByRole('button', { name: 'Start Demo', exact: true }).click({ timeout: 30000 });
  await page.getByText('Home photos', { exact: true }).first().waitFor({ timeout: 60000 });
  console.log('PASS: actual Sveltia initialization and configuration');
  await page.getByText('Home — hero photo at the very top', { exact: true }).dblclick();
  await page.getByRole('button', { name: 'Choose replacement photo' }).waitFor();
  await page.locator('.farm-editor input[type=file]').setInputFiles(new URL('../images/photo-7.jpeg', import.meta.url).pathname);
  const dialog = page.getByRole('dialog', { name: 'Do you want to change this photo?' });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Use this photo' }).isEnabled(), false);
  assert.equal(await dialog.getByRole('radio').count(), 0);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('radio', { name: 'Yes', exact: true }).check();
  await dialog.getByRole('textbox').fill('A portrait test photo of the family on a tractor.');
  assert.equal(await dialog.getByRole('button', { name: 'Use this photo' }).isEnabled(), false);
  await dialog.getByRole('radio', { name: 'No', exact: true }).check();
  await dialog.getByText('Changing this may cause the photo to not render properly.', { exact: true }).waitFor();
  console.log('PASS: confirmation, required orientation answer, and detected mismatch guard');
  await page.screenshot({ path: new URL('cms-confirm-desktop.png', shots).pathname, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL('cms-confirm-mobile.png', shots).pathname, fullPage: true, animations: 'disabled' });
  assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isEnabled(), false);
  console.log('PASS: Cancel leaves the entry unchanged');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.farm-editor input[type=file]').setInputFiles(new URL('../images/photo-3.jpeg', import.meta.url).pathname);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('radio', { name: 'Yes', exact: true }).check();
  await dialog.getByRole('textbox').fill('Cattle eating in the snow, with a child watching.');
  await dialog.getByRole('button', { name: 'Use this photo' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Choose replacement photo' }).waitFor({ state: 'hidden' });
  await page.getByText('Home — hero photo at the very top', { exact: true }).dblclick();
  await page.getByRole('button', { name: 'Choose replacement photo' }).waitFor();
  await page.getByText('Photo ready.', { exact: false }).waitFor({ state: 'hidden', timeout: 30000 });
  assert.equal(await page.getByRole('button', { name: 'Choose replacement photo' }).isEnabled(), true);
  console.log('PASS: real Sveltia addFile, save, and re-enable after publishing');
  const saved = await page.evaluate(async () => {
    const files = [];
    async function visit(directory, path = '') {
      for await (const [name, handle] of directory.entries()) {
        if (handle.kind === 'directory') await visit(handle, path + name + '/');
        else files.push({ path: path + name, file: await handle.getFile() });
      }
    }
    await visit(await navigator.storage.getDirectory());
    const content = files.find(f => f.path.endsWith('content/photo_24.json'));
    return { paths: files.map(f => f.path), data: content ? JSON.parse(await content.file.text()) : null };
  });

  assert.ok(saved.data);
  assert.equal(saved.data.photo.alt, 'Cattle eating in the snow, with a child watching.');
  assert.equal(saved.data.photo.src.replace(/^\/+/, ''), 'images/photo-24-background.jpeg');
  assert.ok(!JSON.stringify(saved.data).includes('blob:'));
  assert.equal(Object.keys(saved.data.photo.files).length, slots[0].files.length);
  console.log('PASS: persisted fixed filenames and complete responsive set, no temporary URLs');
  const heroHash = new URL(page.url()).hash;

  await page.goto(base + '/admin/' + heroHash.replace('home_photos', 'branding').replace('photo_24', 'icons'));
  await page.getByRole('button', { name: 'Choose replacement photo' }).waitFor();
  await page.locator('.farm-editor input[type=file]').setInputFiles(new URL('../favicon-32x32.png', import.meta.url).pathname);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('radio', { name: 'Yes', exact: true }).check();
  await dialog.getByRole('textbox').fill('Long Branch Farms browser icon');
  await dialog.getByRole('button', { name: 'Use this photo' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Choose replacement photo' }).waitFor({ state: 'hidden' });
  const iconData = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const repo = await root.getDirectoryHandle('sveltia-cms-test');
    const content = await repo.getDirectoryHandle('content');
    const entry = await content.getFileHandle('icons.json');
    const data = JSON.parse(await (await entry.getFile()).text());
    const icon = await repo.getFileHandle('favicon.ico');
    return { data, bytes: Array.from(new Uint8Array(await (await icon.getFile()).arrayBuffer())).slice(0, 6) };
  });
  assert.equal(iconData.data.photo.src.replace(/^\/+/, ''), 'favicon-32x32.png');
  assert.deepEqual(iconData.bytes, [0, 0, 1, 0, 1, 0]);
  console.log('PASS: browser icon set, including ICO, saves to the repository root');
  await page.goto(base + '/admin/' + heroHash.replace('home_photos', 'wording').replace('photo_24', 'home'));
  const story = page.getByRole('textbox', { name: 'Our story — first paragraph', exact: false });
  await story.waitFor();
  await story.fill('A plain-text story updated through Sveltia.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await story.waitFor({ state: 'hidden' });
  const publishedText = await page.evaluate(async () => {
    const repo = await (await navigator.storage.getDirectory()).getDirectoryHandle('sveltia-cms-test');
    return (await (await repo.getFileHandle('index.html')).getFile()).text();
  });
  assert.ok(publishedText.includes('A plain-text story updated through Sveltia.'));
  assert.ok(publishedText.includes('<script type="application/ld+json">'));
  assert.ok(publishedText.includes('images/photo-3-480.webp'));
  console.log('PASS: real wording save preserves static page markup and structured data');
  const formatTest = await page.evaluate(async () => {
    const text = await (await fetch('/index.html')).text();
    // Registration is the public API; capture the formatter from the source in a separate instance.
    let format;
    const api = window.CMS;
    window.CMS = { registerCustomFormat: (name, extension, value) => { format = value; } };
    try { (0, eval)(await (await fetch('/admin/text-format.js')).text()); } finally { window.CMS = api; }
    const data = format.fromFile(text);

    data.story_intro = '<script>alert(1)</script> & our family';
    const changed = format.toFile(data);
    return { safe: changed.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; our family'), intro: data.hero_sub, preserved: changed.includes('<script type="application/ld+json">') };
  });
  assert.equal(formatTest.safe, true);
  assert.ok(formatTest.intro);
  assert.equal(formatTest.preserved, true);
  console.log('PASS: website wording formatter escapes HTML and reads the marked content');
  const portable = await page.evaluate(async () => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      return original.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality);
    };
    try {
      const file = await (await fetch('/images/photo-3.jpeg')).blob();
      const decoded = await FarmPhotoTools.decode(file);
      try {
        const blob = await FarmPhotoTools.render(decoded.image, { width: 480, height: 360, type: 'image/webp' }, 'photo');
        return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())).slice(0, 12) };
      } finally { URL.revokeObjectURL(decoded.url); }
    } finally { HTMLCanvasElement.prototype.toBlob = original; }
  });
  assert.equal(portable.type, 'image/webp');
  assert.equal(String.fromCharCode(...portable.bytes.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...portable.bytes.slice(8, 12)), 'WEBP');
  console.log('PASS: portable WebP generation when native canvas encoding is unavailable');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: new URL('cms-desktop.png', shots).pathname, fullPage: true, animations: 'disabled' });
} finally {
  console.log('Page errors:', JSON.stringify(errors));
  await browser.close(); server.close();
}
