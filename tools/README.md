# tools/

One-off generators for committed assets. Nothing here runs at page load — the
site is hand-written static HTML with no build step and no `package.json`.

## Making the farm photos web-ready

The photos that come off a phone or camera are huge — five to seven megabytes
each. A visitor on a phone out in the county would have to download all of them
just to read the page, which can take a minute or more and eats their data.

`optimize-images.mjs` fixes that. It takes each photo in `images/` and saves
several smaller copies of it. The website then hands each visitor whichever
copy fits their screen: a small one on a phone, a larger one on a desktop.

Nothing on the site needs this script to run day to day. You only need it when
you **add new photos**.

## Adding new photos

1. Put the new photo in the `images/` folder and name it in the same pattern as
   the others — `photo-28.jpeg`, `photo-29.jpeg`, and so on. It must be a
   `.jpeg` file.
2. Open a terminal in the project folder and run these two commands:

   ```
   npm install --no-save sharp
   node tools/optimize-images.mjs
   ```

3. That's it. The script prints a line per photo showing how much smaller it
   got. It skips any photo it has already handled, so it is safe to run again.
4. Add the photo to a page. Copy an existing `<picture>` block from
   `index.html` and change the photo number, the `width`/`height` numbers, and
   the `alt` description.

The `width` and `height` numbers, and the exact list of files that exist for
each photo, are recorded in `tools/image-manifest.json` every time the script
runs. Look your photo up there rather than guessing — a wrong `width`/`height`
makes the page jump around while it loads.

If the photo is going to be used as a full-page background behind a heading
rather than as a normal picture, add a `.bg-photo-NN` rule to `styles.css`
instead; copy one of the existing ones in the "background photos" section.

`npm install` downloads a helper library called sharp into a `node_modules`
folder. That folder is deliberately not part of the project — it is listed in
`.gitignore` — so don't worry about it.

## What the script produces

For `photo-3.jpeg` it writes:

```
images/photo-3-480.webp    images/photo-3-480.jpeg     small, for phones
images/photo-3-960.webp    images/photo-3-960.jpeg     medium, for tablets
images/photo-3-1440.webp   images/photo-3.jpeg         large, for desktops
images/photo-3-1920.webp   images/photo-3-1920.jpeg    extra large
```

Two things worth knowing:

- **WebP and JPEG.** WebP is a newer picture format that is roughly a third
  smaller at the same quality. Every current browser reads it. The JPEG next to
  it is the backup for anything that doesn't.
- **The large JPEG keeps the plain name** (`photo-3.jpeg`, no number on the
  end). That is on purpose: it means any older link to `images/photo-3.jpeg`
  still works, and it is the safe fallback everywhere.

Tall (portrait) photos stop at the 1440 size. At 1920 pixels wide a tall photo
would hold nearly twice as many pixels as a wide photo at the same width, so
the script budgets by pixels instead of by width and both orientations end up
costing about the same to download.

Every file it writes is kept under 400 KB. If a photo can't get there it says
so on screen rather than shipping it quietly.

## The originals

The script **replaces** each original photo with the web-sized version. The
full-resolution originals are not deleted from the project's history — they are
saved in Git at commit `fca7c38`.

If you ever need an original back:

```
git checkout fca7c38 -- images/photo-3.jpeg
```

That also means you should not run the script twice over the same photo, since
the second run would be shrinking an already-shrunk file. It guards against
this by keeping a record in `tools/image-manifest.json` of everything it has
already done and skipping those. If you genuinely need to redo one — say you
want a different quality setting — restore the original from Git first and
then run:

```
node tools/optimize-images.mjs --force
```

## Settings

Near the top of `optimize-images.mjs` there are a few plainly named settings if
someone technical ever needs to adjust them: the sizes it renders, the quality
level for each format, and the 400 KB ceiling. It automatically lowers the
quality on any photo that would otherwise come out over that ceiling, and for a
few very grainy low-light photos it also softens the camera noise slightly,
which is invisible on screen but saves a lot of file size.

## Brand assets (favicons + social card)

`generate-brand-assets.js` produces, from `images/LBF-logo-transparent.png` and
`images/photo-2.jpeg`:

| Output | Notes |
| --- | --- |
| `favicon.ico` | multi-size, 16 / 32 / 48, PNG payloads in an ICO container |
| `favicon-16x16.png`, `favicon-32x32.png` | standard PNG favicons |
| `apple-touch-icon.png` | 180x180, opaque cream ground (iOS does not honour transparency) |
| `android-chrome-192x192.png`, `android-chrome-512x512.png` | referenced by `site.webmanifest` |
| `images/social-card.jpg` | 1200x630 Open Graph / Twitter card, kept under 300 KB |

Run it from the repo root:

```sh
npm i --no-save sharp
node tools/generate-brand-assets.js
rm -rf node_modules            # node_modules is gitignored; do not commit it
```

Then commit the regenerated files.

### Why the favicon is a monogram

The logo lockup is a fine-line plough engraving above four lines of type. Scaled
to 16 px it turns into grey mush, so the favicon instead sets the brand monogram
"LBF" in the logo's own ink-on-cream colourway (`--soil` on `--cream`, with a
`--hay` rule at the larger sizes). The opaque cream tile stays legible against
both light and dark browser chrome. The 16 and 32 px tiles drop the rule and set
slightly larger type to buy back pixels.

## Metadata check

`check-metadata.mjs` verifies the `<head>` layer of every page: canonical, Open
Graph and Twitter tags present and non-empty, every asset URL referenced in
metadata resolving with HTTP 200, and the `index.html` / `contact/index.html` JSON-LD
parsing and carrying the expected (and only the expected) properties.

```sh
npx http-server . -p 8103 -s &
node tools/check-metadata.mjs http://localhost:8103
```

## Previewing the site locally

`dev-server.mjs` is a tiny local web server with no dependencies. Unlike
`npx http-server`, it serves this site's clean routes and its 404 page the
same way a real static host does: a request for `/about/` serves
`about/index.html`, and a made-up address gets this site's own `404.html`
back with a real 404 status, instead of a generic directory listing or a
plain "Cannot GET" error.

```sh
node tools/dev-server.mjs
# then open http://localhost:8080
```

Pass a port number to use a different one: `node tools/dev-server.mjs 5050`.

## Full site check (`e2e-check.mjs`)

`e2e-check.mjs` is the most thorough check in this folder. It starts
`dev-server.mjs` itself and drives a real browser (via Playwright) through
every page, at both a phone size and a desktop size, checking:

- the page loads with no failed network requests and no console errors
- every link on the page actually goes somewhere
- the four old addresses (`about.html`, `contact.html`, `privacy.html`,
  `terms.html`) still send a visitor on to the new clean route
- a made-up address gets the real 404 page, with an HTTP 404 status
- every photo has real, descriptive alt text (not "Farm photo" or blank)
- nothing overflows sideways on a phone screen
- the mobile menu opens, keeps keyboard focus inside itself, and closes
- the page stays readable with the "reduce motion" accessibility setting on
- `sitemap.xml` and `robots.txt` agree with what pages actually exist

Run it after making any change to the HTML, the CSS, or anything under
`images/`:

```sh
npm install -D playwright   # only needed the first time
npx playwright install chromium
node tools/e2e-check.mjs
```

If Playwright is already installed somewhere on the machine (globally, or in
another project), the script finds it on its own and the two setup lines
above can be skipped. It prints one line per check and a pass/fail count at
the end, and saves a screenshot of every page to `tools/.e2e-shots/` (not
committed) so a failure can be looked at, not just read about.
