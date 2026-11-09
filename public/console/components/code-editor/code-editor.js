// 共享代码编辑器组件（CodeMirror 6，vendor 见 ./vendor/codemirror.js）。
// 用法：
//   mountCodeEditor(el, { value, language:'yaml', height:'420px', onChange })
//   attachTextareaEditor(textarea, { language, height })   // 把现有 textarea 升级成编辑器，值仍同步回 textarea
// 主题：配色全部走 CSS 变量（--editor-* / --syntax-*），亮暗切换自动跟随，无需重建编辑器。

const LABELS = { yaml: 'YAML', json: 'JSON', text: '文本' };

function cm() {
  return window.ConsoleCM || null;
}

function cspNonce() {
  return document.querySelector('meta[name="csp-nonce"]')?.content || '';
}

function editorTheme(CM) {
  return CM.EditorView.theme({
    // 背景色由宿主 .code-editor 提供：CM 的选区层是 z-index:-2 的子元素，
    // 如果给 .cm-editor 自己铺不透明背景，会把它自己的选区盖住。
    '&': {
      height: '100%',
      color: 'var(--text)',
      fontSize: '12.5px',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
    '.cm-content': { padding: '10px 0', caretColor: 'var(--text)' },
    '.cm-line': { padding: '0 12px 0 6px' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--editor-gutter)',
      borderRight: '1px solid var(--border-subtle)',
    },
    // 只有半透明底色才不会盖住选区：CM 的 .cm-selectionLayer 是 z-index:-2 的子层，
    // 活跃行若用不透明背景，单选一行内的选区会整段「消失」。
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
    '.cm-selectionBackground': { backgroundColor: 'var(--editor-selection) !important' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--editor-selection) !important' },
    '.cm-content ::selection': { backgroundColor: 'var(--editor-selection)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
    '.cm-searchMatch': { backgroundColor: 'var(--editor-selection)' },
    '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--text)' },
    '.cm-tooltip': { backgroundColor: 'var(--surface)', border: '1px solid var(--border)' },
  });
}

// YAML 的 lezer 语法把键标成 definition(propertyName)，纯量值标成 content，注释是 lineComment。
function editorHighlight(CM) {
  const { tags } = CM;
  return CM.syntaxHighlighting(CM.HighlightStyle.define([
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--syntax-comment)', fontStyle: 'italic' },
    { tag: tags.definition(tags.propertyName), color: 'var(--syntax-key)' },
    { tag: [tags.string, tags.content, tags.special(tags.string)], color: 'var(--syntax-string)' },
    { tag: [tags.number, tags.integer, tags.float, tags.bool], color: 'var(--syntax-number)' },
    { tag: [tags.keyword, tags.typeName, tags.labelName], color: 'var(--syntax-keyword)' },
    { tag: [tags.separator, tags.punctuation, tags.bracket], color: 'var(--fg-dim)' },
  ]));
}

function createFallback(container, { value, language, readOnly, onChange }) {
  const area = document.createElement('textarea');
  area.className = 'code-editor-fallback';
  area.spellcheck = false;
  area.value = String(value ?? '');
  area.readOnly = Boolean(readOnly);
  area.setAttribute('aria-label', `${LABELS[language] || '代码'}编辑器`);
  area.addEventListener('input', () => onChange?.(area.value));
  container.appendChild(area);
  return {
    fallback: true,
    el: area,
    getValue: () => area.value,
    setValue: (next) => { if (area.value !== next) area.value = String(next ?? ''); },
    focus: () => area.focus(),
    setReadOnly: (next) => { area.readOnly = Boolean(next); },
    layout: () => {},
    destroy: () => area.remove(),
  };
}

export function mountCodeEditor(container, {
  value = '',
  language = 'yaml',
  height = '',
  readOnly = false,
  onChange = null,
} = {}) {
  if (!container) throw new Error('mountCodeEditor: container 不能为空');
  const root = document.createElement('div');
  root.className = 'code-editor';
  if (height) root.style.setProperty('--code-editor-height', height);
  root.dataset.language = language;
  container.replaceChildren(root);

  const CM = cm();
  if (!CM?.EditorView) return createFallback(root, { value, language, readOnly, onChange });

  const body = document.createElement('div');
  body.className = 'code-editor-body';
  root.appendChild(body);

  const editable = new CM.Compartment();
  const extensions = [
    CM.basicSetup,
    // 只有声明 yaml 才挂 YAML 高亮；纯文本（如仿真提示词）不要被当成 YAML 着色。
    ...(language === 'yaml' ? [CM.yaml()] : []),
    CM.EditorView.lineWrapping,
    editorTheme(CM),
    editorHighlight(CM),
    editable.of(readOnly ? [CM.EditorState.readOnly.of(true), CM.EditorView.editable.of(false)] : []),
    CM.EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange?.(update.state.doc.toString());
    }),
  ];
  const nonce = cspNonce();
  if (nonce) extensions.push(CM.EditorView.cspNonce.of(nonce));

  const view = new CM.EditorView({
    parent: body,
    doc: String(value ?? ''),
    extensions,
  });
  view.dom.setAttribute('aria-label', `${LABELS[language] || '代码'}编辑器`);

  return {
    fallback: false,
    el: root,
    view,
    getValue: () => view.state.doc.toString(),
    setValue: (next) => {
      const text = String(next ?? '');
      if (view.state.doc.toString() === text) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    focus: () => view.focus(),
    setReadOnly: (next) => {
      view.dispatch({
        effects: editable.reconfigure(next
          ? [CM.EditorState.readOnly.of(true), CM.EditorView.editable.of(false)]
          : []),
      });
    },
    layout: () => view.requestMeasure(),
    destroy: () => {
      view.destroy();
      root.remove();
    },
  };
}

// 把已有 textarea 升级成编辑器：编辑结果写回 textarea，原有读写 textarea.value 的逻辑不用改。
export function attachTextareaEditor(textarea, { language = 'yaml', height = '', readOnly = false } = {}) {
  if (!textarea) return null;
  if (textarea.dataset.codeEditorAttached === '1') return textarea._codeEditorHandle || null;
  const host = document.createElement('div');
  host.className = 'code-editor-host';
  textarea.parentNode.insertBefore(host, textarea);
  textarea.hidden = true;
  textarea.readOnly = Boolean(readOnly);
  textarea.dataset.codeEditorAttached = '1';
  const handle = mountCodeEditor(host, {
    value: textarea.value,
    language,
    height,
    readOnly,
    onChange: (next) => { textarea.value = next; },
  });
  const setReadOnly = handle.setReadOnly?.bind(handle);
  handle.setReadOnly = (next) => {
    textarea.readOnly = Boolean(next);
    setReadOnly?.(next);
  };
  textarea._codeEditorHandle = handle;
  return handle;
}
