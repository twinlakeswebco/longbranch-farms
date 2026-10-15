/* Preserve the original HTML and replace only explicitly marked plain-text regions. */
(function () {
  const pattern = /(<([a-z][a-z0-9]*)\b[^>]*\bdata-cms-text="([a-z0-9_]+)"[^>]*>)([\s\S]*?)(<\/\2>)/gi;
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  CMS.registerCustomFormat('farm-html', 'html', {
    fromFile(text) {
      const result = { __html: text };
      for (const match of text.matchAll(pattern)) {
        const element = document.createElement('div'); element.innerHTML = match[4];
        result[match[3]] = element.textContent.trim();
      }
      return result;
    },
    toFile(data) {
      if (typeof data.__html !== 'string') throw new Error('The original page is missing. Reload before saving.');
      return data.__html.replace(pattern, (all, start, tag, key, old, end) => key in data ? start + escape(data[key]) + end : all);
    }
  });
})();
