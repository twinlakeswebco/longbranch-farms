(function () {
  const { createElement: h, Component, createRef } = CMS.React;
  const tools = FarmPhotoTools;
  const plain = value => value?.toJS ? value.toJS() : value;
  class FarmPhotoControl extends Component {
    constructor(props) {
      super(props);
      this.state = { pending: null, confirmed: false, sameOrientation: '', alt: '', busy: false, error: '', fatal: false };
      this.dialog = createRef(); this.input = createRef();
    }
    componentWillUnmount() { if (this.state.pending) URL.revokeObjectURL(this.state.pending.url); }
    get slot() { return plain(this.props.field.get('slot')); }
    get value() { return plain(this.props.value) || {}; }
    isValid() {
      return !this.state.pending && !this.state.busy && !this.state.fatal || { error: { message: 'Finish or cancel the photo change before saving. If preparation failed, reload the editor and try again.' } };
    }
    async choose(event) {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file) return;
      try {
        const pending = await tools.decode(file);
        this.setState({ pending, confirmed: false, sameOrientation: '', alt: '', error: '' }, () => this.dialog.current.showModal());
      } catch (error) { this.setState({ error: error.message }); }
    }
    cancel() {
      if (this.state.busy) return;
      this.dialog.current.close();
      URL.revokeObjectURL(this.state.pending.url);
      this.setState({ pending: null, confirmed: false, sameOrientation: '', error: '' });
    }
    async apply() {
      if (!tools.canApply(this.state)) return;
      const { pending, alt, sameOrientation } = this.state;
      const slot = this.slot;
      this.setState({ busy: true, error: '' });
      try {
        // Prepare the entire set first; a failed conversion cannot partially change a photo.
        const prepared = [];
        for (const spec of slot.files) prepared.push([spec, await tools.render(pending.image, spec, slot.kind)]);
        const files = {};
        for (const [spec, blob] of prepared) files[spec.name] = await this.props.addFile(blob, { name: spec.name, replace: true });
        const base = slot.src.split('/').pop();
        const src = files[base];
        if (!src) throw new Error('The replacement is missing its main image. Reload and try again.');
        const baseSpec = slot.files.find(spec => spec.name === base);
        const nextValue = { src, files, alt: alt.trim(), width: baseSpec.width,
          height: slot.kind === 'photo' ? Math.round(baseSpec.width * pending.height / pending.width) : baseSpec.height,
          orientationAnswer: sameOrientation };
        this.dialog.current.close();
        URL.revokeObjectURL(pending.url);
        this.setState({ pending: null, busy: false }, () => this.props.onChange(nextValue));
      } catch (error) {
        this.setState({ busy: false, error: error.message + ' Reload the editor before trying again.', fatal: true });
      }
    }
    render() {
      const slot = this.slot, value = this.value, state = this.state;
      const fallback = value.src?.startsWith('blob:') ? value.src : '/' + (value.src || slot.src).replace(/^\/+/, '');
      const current = this.props.getAsset?.(value.src)?.url || fallback;
      const unsaved = Object.values(value.files || {}).some(url => url.startsWith('blob:'));
      const actual = state.pending && tools.orientation(state.pending.width, state.pending.height);
      const oldOrientation = tools.orientation(value.width || slot.width, value.height || slot.height);
      const mismatch = state.pending && actual !== oldOrientation;
      const figure = (src, caption) => h('figure', null,
        h('div', { className: 'photo-frame' + (slot.rotation ? ' rotated' : '') }, h('img', { src, alt: caption })),
        h('figcaption', null, caption));
      return h('div', { className: 'farm-editor' },
        h('p', null, slot.label),
        figure(current, 'Current image'),
        h('p', null, `Current orientation: ${oldOrientation}. Portrait means tall; landscape means wide.`),
        slot.rotation ? h('p', null, 'This position turns the photo 90° left on the website. The previews show that turn; the orientation question refers to the uploaded file.') : null,
        slot.kind === 'social' ? h('p', null, 'Shared links use a wide frame. The new image will be cropped from the center to fit. Social apps may take time to refresh a cached preview.') : null,
        slot.kind === 'logo' ? h('p', null, 'Use a transparent PNG. The full logo will fit inside the existing logo space.') : null,
        slot.kind === 'icons' ? h('p', null, 'Use a square PNG with a simple design. All browser and phone icon sizes update together.') : null,
        h('input', { ref: this.input, type: 'file', accept: 'image/jpeg,image/png,image/webp,image/avif', hidden: true, onChange: e => this.choose(e) }),
        h('button', { id: this.props.forID, type: 'button', disabled: unsaved || state.busy || state.fatal, onClick: () => this.input.current.click() }, 'Choose replacement photo'),
        unsaved ? h('p', { className: 'success', role: 'status' }, 'Photo ready. Save this entry to publish it. Save or discard this draft before replacing it again.') : null,
        state.error && !state.pending ? h('p', { className: 'error', role: 'alert' }, state.error) : null,
        h('dialog', { ref: this.dialog, 'aria-labelledby': this.props.forID + '-title', onCancel: e => { e.preventDefault(); this.cancel(); } },
          state.pending ? h('div', null,
            h('h2', { id: this.props.forID + '-title' }, 'Do you want to change this photo?'),
            h('p', null, slot.label),
            h('div', { className: 'photos' }, figure(current, 'Current image'), figure(state.pending.url, 'New image')),
            h('label', { className: 'choice' }, h('input', { type: 'checkbox', checked: state.confirmed, disabled: state.busy, onChange: e => this.setState({ confirmed: e.target.checked, sameOrientation: '' }) }), 'Yes, I want to change this photo.'),
            state.confirmed ? h('div', null,
              h('fieldset', { disabled: state.busy },
                h('legend', null, "Is this image the same orientation as the one it's replacing (Portrait or Landscape)?"),
                h('p', null, `Current: ${oldOrientation}. New: ${actual}.`),
                ...['yes', 'no'].map(answer => h('label', { className: 'choice', key: answer }, h('input', { type: 'radio', name: this.props.forID + '-orientation', value: answer, checked: state.sameOrientation === answer, onChange: () => this.setState({ sameOrientation: answer }) }), answer === 'yes' ? 'Yes' : 'No'))),
              state.sameOrientation === 'no' || mismatch ? h('p', { className: 'warning', role: 'alert' }, 'Changing this may cause the photo to not render properly.') : null,
              mismatch && state.sameOrientation === 'yes' ? h('p', { className: 'warning' }, 'The photo dimensions show a different orientation. Choose No to continue, or Cancel and choose another photo.') : null,
              h('label', null, 'Briefly describe the new photo for visitors who use a screen reader.', h('textarea', { value: state.alt, disabled: state.busy, placeholder: 'For example: Our cows grazing in the pasture at sunset.', onChange: e => this.setState({ alt: e.target.value }) }))
            ) : null,
            state.error ? h('p', { className: 'error', role: 'alert' }, state.error) : null,
            h('div', { className: 'actions' },
              h('button', { type: 'button', disabled: !tools.canApply(state) || (mismatch && state.sameOrientation !== 'no') || state.fatal, onClick: () => this.apply() }, state.busy ? 'Preparing photo sizes…' : 'Use this photo'),
              h('button', { type: 'button', className: 'secondary', disabled: state.busy, onClick: () => this.cancel() }, 'Cancel')),
            h('p', { role: 'status' }, state.busy ? 'Please keep this window open. Your photo is being prepared.' : 'Nothing goes live until you save the entry in the editor.')
          ) : null)
      );
    }
  }
  CMS.registerFieldType('farm-photo', FarmPhotoControl);
})();
