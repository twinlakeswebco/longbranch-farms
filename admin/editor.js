(async () => {
  try {
    const [slots, textPages, auth] = await Promise.all(['photo-slots.json', 'text-fields.json', 'auth-settings.json'].map(async file => {
      const response = await fetch(file);
      if (!response.ok) throw new Error('Could not load the editor settings.');
      return response.json();
    }));
    const group = (name, label, filter) => ({
      name, label, editor: { preview: false }, files: slots.filter(filter).map(slot => ({
        name: slot.key, label: slot.label, file: `content/${slot.key}.json`, format: 'json',
        fields: [{ name: 'photo', label: slot.label, widget: 'farm-photo', slot,
          media_folder: slot.folder === '.' ? '/' : '/images', public_folder: slot.folder === '.' ? '/' : '/images' }]
      }))
    });
    document.getElementById('nc-root').replaceChildren();
    await CMS.init({ config: {
      load_config_file: false,
      backend: { name: 'github', repo: 'twinlakeswebco/longbranch-farms', branch: 'main', ...(auth.base_url ? { base_url: auth.base_url } : {}) },
      site_url: 'https://www.longbranch-farms.com', display_url: 'https://www.longbranch-farms.com',
      logo: { src: '/images/LBF-logo-transparent.png', show_in_header: true },
      media_folder: 'images', public_folder: '/images',
      // Fixed asset names are required by the static site's responsive markup and metadata.
      media_libraries: { default: { config: { transformations: {} } } },
      collections: [
        group('home_photos', 'Home photos', s => s.label.startsWith('Home')),
        group('about_photos', 'About photos', s => s.label.startsWith('About')),
        group('contact_photos', 'Contact & Terms backgrounds', s => s.label.startsWith('Contact')),
        { name: 'wording', label: 'Website wording', editor: { preview: false }, files: Object.entries(textPages).map(([name, page]) => ({
          name, label: page.label, file: page.file, format: 'farm-html',
          fields: [{ name: '__html', widget: 'hidden' }, ...Object.entries(page.fields).map(([name, label]) => ({ name, label, widget: 'text' }))]
        })) },
        group('branding', 'Logo, sharing image & icons', s => ['logo', 'social', 'icons'].includes(s.kind))
      ]
    } });
  } catch (error) {
    const root = document.getElementById('nc-root'); root.textContent = 'The editor could not load. Please reload this page. ' + error.message;
  }
})();
