# Long Branch Farms website editor

## Courtney: changing a photo

1. Open **https://www.longbranch-farms.com/admin/** and sign in with your GitHub account after Casey has connected your access.
2. Choose **Home photos**, **About photos**, **Contact & Terms backgrounds**, or **Logo, sharing image & icons**.
3. Open the entry whose name matches the location you want to change. Each entry shows its current image and explains where it appears. An entry mentioning two locations updates both.
4. Select **Choose replacement photo** and choose a JPG, PNG, WebP, or AVIF from your phone or computer. For HEIC photos, export a JPEG first.
5. Compare the current and new photos in the popup. Check **Yes, I want to change this photo**.
6. Answer the orientation question. Portrait means tall. Landscape means wide. If you choose **No**, you will see: “Changing this may cause the photo to not render properly.” You can still continue. If the editor detects a different orientation, it requires **No** rather than accepting an accidental **Yes**.
7. Describe what the new image shows. This helps visitors who use screen readers.
8. Select **Use this photo**, then **Save** in the editor. The website updates after the hosting provider finishes deploying the commit. Keep the editor open while it prepares the photo. You do not need to rename it or create smaller copies.

**Cancel** keeps the current photo. Nothing goes live just from selecting or preparing a file. Save or discard a draft before replacing the same photo again. If preparing a photo fails, reload the editor before trying again.

The fourth photo in the homepage strip currently turns 90 degrees left. Its previews show that turn. Compare the orientation of the original uploaded files, before that website rotation.

For logos, use a transparent PNG. For browser icons, use a simple square PNG. For the sharing image, use a wide photo with the important subject near the center; it fills the existing sharing-image frame. Social apps and browser icons can retain cached previews for a while after a change.

Use the labeled photo entries for replacements. The generic Sveltia Assets screen is a developer tool and does not run the guided replacement process or regenerate the photo sizes.

## Courtney: changing the wording

Choose **Website wording**, then **Home** or **About**. The fields explain exactly which paragraph changes. Edit and **Save**. These are plain-text fields: there is no HTML or layout code to manage.

Products, inventory, prices, and orders are still managed in Shopify.

## Casey: activate access

The code is configured for `twinlakeswebco/longbranch-farms`, branch `main`. Publishing the implementation exposes `/admin/` on the current static host; no site build command or database is needed. This implementation does not change the host's existing deployment settings.

Courtney needs a GitHub account with **Write** access to this repository. The GitHub connector used for this task cannot create her account, grant repository access, or register an OAuth application.

For the phone-friendly **Sign In with GitHub** flow:

1. Deploy the official [Sveltia CMS Authenticator](https://github.com/sveltia/sveltia-cms-auth) on Cloudflare Workers, following its setup instructions.
2. Register the required GitHub OAuth app with the callback URL specified by that authenticator deployment. Keep the OAuth secret only in the Worker secrets; never put it in this repository.
3. Set `base_url` in `admin/auth-settings.json` to the authenticator's HTTPS origin. Commit and deploy it.
4. Add Courtney as a repository collaborator or via the appropriate organization team with Write access. Have her accept the invitation.
5. Check the real GitHub sign-in on the production origin. Make one test photo save, confirm the existing image files are updated in the same commit as its content JSON, and confirm the host redeploys. Restore the image afterward.

Until OAuth is configured, Sveltia also supports **Sign In with Token** for developer verification. Use a fine-grained token restricted to this repository with Contents read/write. Do not put the token into configuration or send one through chat. Token sign-in is not the recommended client handoff.

References: [GitHub backend](https://sveltiacms.app/en/docs/backends/github), [custom field types and addFile](https://sveltiacms.app/en/docs/api/field-types), [custom file formats](https://sveltiacms.app/en/docs/api/file-formats).

## Implementation

- `admin/photo-slots.json` maps each location to its existing photo files and size variants. The actual homepage hero is `photo-24-background`, not Photo 1. Photo 1 is the first image in the homepage strip.
- `admin/photo-control.js` implements the upload popup, explicit confirmation, mutually exclusive Yes/No answer, measured orientation check, cancellation, and save guard.
- `admin/photo-tools.js` decodes the uploaded file locally, creates all existing responsive sizes, and builds a valid PNG-backed ICO. JPEG and WebP outputs are capped at 400 KiB. Photographic variants preserve the uploaded aspect ratio; fixed social/brand frames fill or contain as described by the control.
- All generated blobs remain referenced in the custom field value, allowing Sveltia to replace existing assets in the same commit as the JSON. The existing filenames, srcsets, CSS backgrounds, OG/Twitter URLs, and JSON-LD image URL continue working without a build pipeline. `replace: true` is essential. Do not enable Sveltia's automatic format conversion; it would change those fixed filenames.
- `site-content.js` reads photo descriptions and intrinsic dimensions for the currently displayed `<img>` elements. Image pixels and responsive selection remain static. If metadata cannot load, the HTML retains its existing descriptions and dimensions. Gallery links receive the updated description, too.
- `admin/text-format.js` keeps a hidden copy of the original HTML and updates only the elements explicitly marked with `data-cms-text`. It escapes edited text and preserves everything else, including structured data, scripts, forms, and links. Reopen entries after source-code changes rather than saving an old draft over newer HTML.
- Admin-only dependencies are vendored and pinned: Sveltia CMS 0.242.0, Sveltia UI font assets 0.85.2, Immutable 5.1.9, and jSquash WebP 1.5.0. The portable WebP encoder supports Safari versions without native canvas WebP encoding. Their licenses are included. Sveltia may still contact its update-check endpoint; this is optional and failure does not block editing. Other optional CMS capabilities may fetch their own third-party dependencies.
- This is a guided editing interface, not a separate permissions boundary: anyone with GitHub Write access can also change files directly. The general Assets screen does not enforce the custom confirmation.

## Verification

With Playwright and Chromium installed:

```sh
node tools/cms-check.mjs
node tools/e2e-check.mjs
```

Set `CMS_TEST_BROWSER` to a Chromium executable path if using an existing browser binary. `cms-check.mjs` injects Sveltia's seeded test backend through Playwright network interception; production always uses GitHub. It never publishes tests to GitHub. The tests check the real custom-field UI, blocked/mismatched confirmations, cancellation, publishing a complete responsive set, ICO publishing, and text escaping. Screenshots are written to the existing ignored `tools/.e2e-shots/` directory.
