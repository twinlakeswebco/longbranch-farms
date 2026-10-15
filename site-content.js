/* Images retain fixed URLs; this updates their descriptions and intrinsic dimensions. */
(() => {
  const groups = new Map();
  document.querySelectorAll('[data-cms-photo]').forEach(image => {
    const key = image.dataset.cmsPhoto;
    if (!/^photo_\d+$/.test(key)) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(image);
  });
  for (const [key, images] of groups) {
    fetch(`/content/${key}.json`).then(response => {
      if (!response.ok) throw new Error('Photo description unavailable');
      return response.json();
    }).then(({ photo }) => {
      if (!photo || typeof photo.alt !== 'string') return;
      for (const image of images) {
        image.alt = photo.alt;
        if (Number.isFinite(photo.width) && Number.isFinite(photo.height) && photo.width > 0 && photo.height > 0) {
          image.width = photo.width; image.height = photo.height;
        }
        const link = image.closest('.gallery-item');
        if (link) link.setAttribute('aria-label', `Enlarge photo: ${photo.alt}`);
      }
    }).catch(() => { /* Static descriptions remain available if metadata is unavailable. */ });
  }
})();
