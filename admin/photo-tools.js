/* Shared with the browser tests. Image work stays local until Sveltia saves the entry. */
(function (root) {
  const orientation = (width, height) => width === height ? 'Square' : width > height ? 'Landscape' : 'Portrait';
  async function decode(file) {
    if (file.size > 30 * 1024 * 1024) throw new Error('This file is too large. Choose a photo smaller than 30 MB.');
    const url = URL.createObjectURL(file);
    const image = new Image();
    try {
      image.src = url;
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 60000000) throw new Error('This photo is too large. Export a smaller JPEG and try again.');
      return { image, url, width: image.naturalWidth, height: image.naturalHeight };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw new Error(error.message.startsWith('This photo') ? error.message : 'This image could not be opened. Please use a JPG, PNG, WebP, or AVIF photo. For iPhone HEIC photos, export as JPEG first.');
    }
  }
  let webpModule;
  async function portableWebP(canvas, quality) {
    // Safari can decode WebP without implementing WebP canvas encoding.
    // The portable libwebp encoder preserves the required .webp responsive filenames.
    const [{ default: factory }, { defaultOptions }] = await Promise.all([
      import('./vendor/webp/webp_enc.js'), import('./vendor/webp/meta.js')
    ]);
    webpModule ||= factory({ noInitialRun: true });
    const encoder = await webpModule;
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const encoded = encoder.encode(data.data, data.width, data.height, { ...defaultOptions, quality: quality * 100 });
    if (!encoded) throw new Error('This photo could not be prepared. Try a smaller image.');
    return new Blob([encoded], { type: 'image/webp' });
  }
  function canvasBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (type === 'image/webp' && (!blob || blob.type !== type)) portableWebP(canvas, quality).then(resolve, reject);
      else if (!blob || blob.type !== type) reject(new Error('Your browser cannot create this image format. Please try an up-to-date Chrome, Safari, or Firefox.'));
      else resolve(blob);
    }, type, quality));
  }
  async function render(image, spec, kind) {
    const canvas = document.createElement('canvas');
    canvas.width = spec.width;
    canvas.height = kind === 'photo' ? Math.round(spec.width * image.naturalHeight / image.naturalWidth) : spec.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Unable to prepare this photo. Please reload and try again.');
    if (canvas.width * canvas.height > 16000000) throw new Error('This photo is too tall for this position. Please crop it and try again.');
    if (spec.type !== 'image/png' || kind === 'icons') {
      ctx.fillStyle = '#f5f0e8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (kind === 'photo') ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    else {
      // Social cards fill their fixed frame. Logos and icons retain the entire design.
      const scale = (kind === 'social' ? Math.max : Math.min)(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    }
    if (spec.type === 'image/x-icon') {
      const png = await canvasBlob(canvas, 'image/png');
      const bytes = new Uint8Array(await png.arrayBuffer());
      const buffer = new ArrayBuffer(22 + bytes.length);
      const view = new DataView(buffer);
      view.setUint16(2, 1, true); view.setUint16(4, 1, true);
      view.setUint8(6, canvas.width === 256 ? 0 : canvas.width);
      view.setUint8(7, canvas.height === 256 ? 0 : canvas.height);
      view.setUint16(10, 1, true); view.setUint16(12, 32, true);
      view.setUint32(14, bytes.length, true); view.setUint32(18, 22, true);
      new Uint8Array(buffer).set(bytes, 22);
      return new Blob([buffer], { type: spec.type });
    }
    let blob = await canvasBlob(canvas, spec.type, 0.84);
    if (spec.type === 'image/jpeg' || spec.type === 'image/webp') {
      for (const quality of [0.75, 0.65, 0.5, 0.35]) {
        if (blob.size <= 400 * 1024) break;
        blob = await canvasBlob(canvas, spec.type, quality);
      }
      if (blob.size > 400 * 1024) throw new Error('This photo has too much detail to load quickly here. Please export a smaller or less noisy photo and try again.');
    }
    return blob;
  }
  function canApply({ confirmed, sameOrientation, alt, busy }) {
    return confirmed && ['yes', 'no'].includes(sameOrientation) && alt.trim().length > 0 && !busy;
  }
  root.FarmPhotoTools = { orientation, decode, render, canApply };
})(globalThis);
