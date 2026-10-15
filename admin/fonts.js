// Match Sveltia UI 0.85.2's font descriptors so its CDN fallback is never needed.
(() => {
  const latin = ['U+0000-00FF','U+0131','U+0152-0153','U+02BB-02BC','U+02C6','U+02DA','U+02DC','U+0304','U+0308','U+0329','U+2000-206F'];
  const rest = ['U+20AC','U+2122','U+2191','U+2193','U+2212','U+2215','U+FEFF','U+FFFD'];
  const fonts = [
    ['Source Sans 3', 'source-sans-3-latin-wght-normal.woff2', { weight: '200 900', display: 'swap', unicodeRange: [...latin, ...rest].join(', '), sizeAdjust: '110%' }],
    ['Noto Mono', 'noto-mono-latin-400-normal.woff2', { weight: '400', display: 'swap' }],
    ['Material Symbols Outlined', 'material-symbols-outlined-latin-wght-normal.woff2', { weight: '400', display: 'block', unicodeRange: [...latin, 'U+2074', ...rest].join(', ') }]
  ];
  for (const [family, file, options] of fonts) document.fonts.add(new FontFace(family, `url("/admin/vendor/fonts/${file}")`, { style: 'normal', ...options }));
})();
