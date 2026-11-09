import { EditorView, basicSetup } from 'codemirror';
import { yaml } from '@codemirror/lang-yaml';

export function createEditor(parent, value, onChange) {
  if (!parent) return null;
  const nonce = document.querySelector('meta[name="csp-nonce"]')?.content || '';
  const extensions = [
    basicSetup,
    yaml(),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange?.(update.state.doc.toString());
    }),
  ];
  if (nonce) extensions.push(EditorView.cspNonce.of(nonce));
  const view = new EditorView({
    parent,
    doc: String(value ?? ''),
    extensions,
  });
  return view;
}
