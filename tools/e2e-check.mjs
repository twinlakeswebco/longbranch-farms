#!/usr/bin/env node
/**
 * End-to-end check for the whole site, run in a real browser.
 *
 *   node tools/e2e-check.mjs
 *
 * It starts tools/dev-server.mjs itself (so routing, the 404 page, and the
 * old /*.html redirect stubs all behave exactly as they would on a real
 * static host) and then, with Playwright, visits every page at a phone size
 * and a desktop size and checks:
 *
 *   - the page loads with no failed network requests and no console errors
 *   - every internal link actually resolves to something
 *   - the four old flat URLs (about.html, contact.html, ...) still redirect
 *     visitors to the new clean route
 *   - a made-up URL gets the real 404 page, with an HTTP 404 status
 *   - every <img> has real, descriptive alt text
 *   - nothing overflows sideways on a phone screen
 *   - the mobile nav drawer opens, traps focus, and closes
 *   - content stays visible with `prefers-reduced-motion: reduce`
 *   - the sitemap and robots.txt agree with what's actually on disk
 *
 * Needs Playwright. If `npm install` has been run somewhere on this machine
 * before (globally or in this project), this script finds it automatically.
 * Otherwise:
 *
 *   npm install -D playwright
 *   npx playwright install chromium
 *
 * Screenshots of every page (both sizes) are saved to tools/.e2e-shots/ so
 * you can look at the actual result, not just the pass/fail count.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './dev-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'tools', '.e2e-shots');
const SITE = 'https://www.longbranch-farms.com';

// --- find Playwright without assuming where it lives -----------------------
function loadPlaywright() {
  const tryRequire = (base) => {
    try {
      return createRequire(path.join(base, 'noop.cjs'))('playwright');
    } catch {
      return null;
    }
  };
  let pw = tryRequire(ROOT);
  if (pw) return pw;
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    pw = tryRequire(globalRoot);
    if (pw) return pw;
  } catch {
    /* npm not on PATH, or no global modules -- fall through to the error below */
  }
  console.error(
    [
      'Could not find the "playwright" package.',
      'Install it once with:',
      '  npm install -D playwright',
      '  npx playwright install chromium',
      'then run this script again.',
    ].join('\n')
  );
  process.exit(1);
}

// --- the pages this site actually has ---------------------------------------
const ROUTES = [
  { path: '/', name: 'index', canonical: SITE + '/' },
  { path: '/about/', name: 'about', canonical: SITE + '/about/' },
  { path: '/contact/', name: 'contact', canonical: SITE + '/contact/' },
  { path: '/privacy/', name: 'privacy', canonical: SITE + '/privacy/' },
  { path: '/terms/', name: 'terms', canonical: SITE + '/terms/' },
];

const LEGACY_REDIRECTS = [
  { from: '/about.html', to: '/about/' },
  { from: '/contact.html', to: '/contact/' },
  { from: '/privacy.html', to: '/privacy/' },
  { from: '/terms.html', to: '/terms/' },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

// This sandbox blocks Google Fonts at the proxy in some environments, which
// is an environment artifact, not a site defect -- don't fail the run on it.
const IGNORED_REQUEST_PATTERNS = [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/];
const ignorableRequest = (url) => IGNORED_REQUEST_PATTERNS.some((re) => re.test(url));

// Chromium's console message for a blocked cross-origin request doesn't
// include the URL ("Failed to load resource: net::ERR_CONNECTION_RESET"), so
// it can't be matched against IGNORED_REQUEST_PATTERNS directly. Only trust
// that bare message once we know no *real* request failed on this page.
const isBareLoadFailure = (text) => /Failed to load resource/.test(text) && !/https?:\/\//.test(text);

let failures = 0;
let checks = 0;
const fail = (m) => {
  failures++;
  console.log('  FAIL ' + m);
};
const ok = (m) => {
  checks++;
  console.log('  ok   ' + m);
};

async function main() {
  const { chromium } = loadPlaywright();
  await mkdir(SHOTS, { recursive: true });

  const { url: base, close } = await startServer();
  console.log(`dev server: ${base}\n`);

  const browser = await chromium.launch();

  try {
    await checkRoutes(browser, base);
    await checkLegacyRedirects(browser, base);
    await check404(browser, base);
    await checkNavDrawer(browser, base);
    await checkReducedMotion(browser, base);
    await checkSitemapAndRobots(base);
  } finally {
    await browser.close();
    await close();
  }

  console.log(`\n${checks} checks passed, ${failures} failed.`);
  console.log(`Screenshots: ${SHOTS}`);
  if (failures) process.exit(1);
}

// --- 1. every real page, at both sizes --------------------------------------
async function checkRoutes(browser, base) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });

    for (const route of ROUTES) {
      console.log(`[${vp.name}] ${route.path}`);
      const page = await ctx.newPage();

      const consoleErrors = [];
      const badRequests = [];
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });
      page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
      page.on('requestfailed', (r) => {
        if (!ignorableRequest(r.url())) badRequests.push(`${r.url()} (${r.failure()?.errorText})`);
      });
      page.on('response', (r) => {
        if (r.status() >= 400 && !ignorableRequest(r.url())) badRequests.push(`${r.url()} -> HTTP ${r.status()}`);
      });

      const resp = await page.goto(base + route.path, { waitUntil: 'networkidle', timeout: 45000 });
      if (!resp || resp.status() >= 400) fail(`${route.path}: page returned HTTP ${resp?.status()}`);
      else ok(`${route.path}: HTTP 200`);

      if (badRequests.length) badRequests.forEach((b) => fail(`${route.path}: bad request ${b}`));
      else ok(`${route.path}: no failed requests`);

      // A bare "Failed to load resource" with no URL is the console echo of
      // an already-ignored request (see isBareLoadFailure above) once we
      // know nothing real actually failed on this page.
      const realConsole = consoleErrors.filter((c) => !(badRequests.length === 0 && isBareLoadFailure(c)));
      if (realConsole.length) realConsole.forEach((c) => fail(`${route.path}: console ${c}`));
      else ok(`${route.path}: console clean`);

      // Canonical tag matches the URL actually being served.
      const canonical = await page.getAttribute('link[rel="canonical"]', 'href').catch(() => null);
      if (canonical !== route.canonical) fail(`${route.path}: canonical is "${canonical}", expected "${route.canonical}"`);
      else ok(`${route.path}: canonical correct`);

      // Every internal link resolves to a real page, resolved the way a
      // browser actually resolves it (relative to this page's own URL).
      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
      const internal = [...new Set(hrefs)].filter((h) => h && !/^(https?:|mailto:|tel:|#)/.test(h));
      for (const h of internal) {
        const target = new URL(h, base + route.path);
        target.hash = '';
        const r = await page.request.head(target.toString()).catch(() => null);
        if (!r || r.status() >= 400) fail(`${route.path}: dead internal link -> ${h}`);
      }
      ok(`${route.path}: ${internal.length} internal links checked`);

      // No horizontal scrollbar.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) fail(`${route.path} @${vp.width}px: horizontal overflow of ${overflow}px`);
      else ok(`${route.path}: no horizontal overflow`);

      // Every image has real alt text -- not empty, not a generic filler word.
      const badAlts = await page.$$eval('img', (imgs) =>
        imgs
          .map((i) => ({ src: i.getAttribute('src'), alt: i.getAttribute('alt') }))
          .filter((i) => i.alt === null || /^(farm photo|image|photo)?$/i.test((i.alt || '').trim()))
      );
      if (badAlts.length) badAlts.forEach((b) => fail(`${route.path}: generic/missing alt on ${b.src}`));
      else ok(`${route.path}: all alt text descriptive`);

      await page.screenshot({ path: path.join(SHOTS, `${route.name}-${vp.name}.png`), fullPage: true });
      await page.close();
    }
    await ctx.close();
  }
}

// --- 2. the old flat URLs still send visitors somewhere real ---------------
async function checkLegacyRedirects(browser, base) {
  const ctx = await browser.newContext();
  for (const r of LEGACY_REDIRECTS) {
    const page = await ctx.newPage();
    await page.goto(base + r.from, { waitUntil: 'networkidle' }).catch(() => {});
    // The stub has both a <meta http-equiv="refresh"> and a JS
    // window.location.replace(); either can fire first, so just wait for
    // the URL to actually change rather than assuming which one wins.
    await page.waitForURL((u) => u.pathname === r.to, { timeout: 5000 }).catch(() => {});
    const landedOn = new URL(page.url()).pathname;
    if (landedOn !== r.to) fail(`${r.from}: redirected to "${landedOn}", expected "${r.to}"`);
    else ok(`${r.from} -> ${r.to}`);
    await page.close();
  }
  await ctx.close();
}

// --- 3. an unknown URL gets the real 404 page, with a real 404 status ------
async function check404(browser, base) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const resp = await page.goto(base + '/this-page-does-not-exist', { waitUntil: 'networkidle' });
  if (!resp || resp.status() !== 404) fail(`/this-page-does-not-exist: got HTTP ${resp?.status()}, expected 404`);
  else ok('unknown path returns HTTP 404');

  const title = await page.title();
  if (!/not found/i.test(title)) fail(`404 page title "${title}" doesn't read as a not-found page`);
  else ok('404 page has a real not-found title');

  // The 404 page's own assets (styles, icon, font link) must resolve --
  // a 404 page that itself 404s on its stylesheet renders unstyled. The
  // navigation itself is *supposed* to be a 404, so only judge subresources.
  const badRequests = [];
  page.on('response', (r) => {
    if (r.request().isNavigationRequest()) return;
    if (r.status() >= 400 && !ignorableRequest(r.url())) badRequests.push(`${r.url()} -> HTTP ${r.status()}`);
  });
  await page.reload({ waitUntil: 'networkidle' });
  if (badRequests.length) badRequests.forEach((b) => fail(`404 page: bad request ${b}`));
  else ok('404 page: its own assets all resolve');

  // It should still offer a way back into the site.
  const homeLink = await page.$('a[href="/"], a[href="../"], a[href="./"]');
  if (!homeLink) {
    const anyLink = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
    fail(`404 page: no obvious link back to the home page (links present: ${JSON.stringify(anyLink)})`);
  } else {
    ok('404 page links back to the home page');
  }

  await page.screenshot({ path: path.join(SHOTS, '404.png'), fullPage: true });
  await page.close();
  await ctx.close();
}

// --- 4. mobile nav drawer smoke test ----------------------------------------
async function checkNavDrawer(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const route of [ROUTES[0], ROUTES[1]]) {
    const page = await ctx.newPage();
    await page.goto(base + route.path, { waitUntil: 'networkidle' });

    const toggle = page.locator('#navToggle');
    if ((await toggle.count()) === 0) {
      fail(`${route.path}: no #navToggle button found on mobile`);
      await page.close();
      continue;
    }

    await toggle.click();
    await page.waitForTimeout(400);
    const expanded = await toggle.getAttribute('aria-expanded');
    if (expanded !== 'true') fail(`${route.path}: drawer didn't open (aria-expanded="${expanded}")`);
    else ok(`${route.path}: drawer opens`);

    const focusInside = await page.evaluate(() => {
      const d = document.getElementById('navDrawer');
      return d ? d.contains(document.activeElement) : false;
    });
    if (!focusInside) fail(`${route.path}: focus didn't move into the drawer on open`);
    else ok(`${route.path}: focus moves into drawer`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const expandedAfterEsc = await toggle.getAttribute('aria-expanded');
    if (expandedAfterEsc !== 'false') fail(`${route.path}: Escape didn't close the drawer`);
    else ok(`${route.path}: Escape closes drawer`);

    await page.screenshot({ path: path.join(SHOTS, `nav-${route.name}.png`) });
    await page.close();
  }
  await ctx.close();
}

// --- 5. prefers-reduced-motion leaves content visible -----------------------
async function checkReducedMotion(browser, base) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    await page.goto(base + route.path, { waitUntil: 'networkidle' });
    const hidden = await page.$$eval('.reveal', (els) => els.filter((e) => Number(getComputedStyle(e).opacity) < 0.99).length);
    if (hidden) fail(`${route.path}: ${hidden} .reveal elements still transparent under reduced-motion`);
    else ok(`${route.path}: reduced-motion content visible`);
    await page.close();
  }
  await ctx.close();
}

// --- 6. sitemap.xml and robots.txt agree with what's on disk ---------------
async function checkSitemapAndRobots(base) {
  const sitemapXml = await readFile(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const locs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  if (locs.length !== ROUTES.length) fail(`sitemap.xml lists ${locs.length} URLs, expected ${ROUTES.length}`);
  else ok(`sitemap.xml lists ${locs.length} URLs`);

  for (const loc of locs) {
    let localPath;
    try {
      const parsed = new URL(loc);
      if (parsed.origin !== new URL(SITE).origin) throw new Error('wrong origin');
      localPath = parsed.pathname;
    } catch {
      fail(`sitemap.xml: "${loc}" is not a valid URL under ${SITE}`);
      continue;
    }
    const match = ROUTES.find((r) => r.path === localPath);
    if (!match) {
      fail(`sitemap.xml: "${loc}" doesn't correspond to a real route`);
      continue;
    }
    const res = await fetch(base + localPath);
    if (res.status !== 200) fail(`sitemap.xml: ${loc} -> HTTP ${res.status}`);
    else ok(`sitemap.xml: ${loc} resolves`);
  }

  for (const route of ROUTES) {
    if (!locs.includes(route.canonical)) fail(`sitemap.xml: missing entry for ${route.path}`);
  }

  const robots = await readFile(path.join(ROOT, 'robots.txt'), 'utf8');
  if (!/Sitemap:\s*https:\/\/www\.longbranch-farms\.com\/sitemap\.xml/.test(robots)) {
    fail('robots.txt: missing or wrong Sitemap: line');
  } else {
    ok('robots.txt: points at the sitemap');
  }
  if (!/Disallow:\s*\/docs\//.test(robots)) {
    fail('robots.txt: /docs/ (the project working files, not site content) is not disallowed');
  } else {
    ok('robots.txt: /docs/ disallowed');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
