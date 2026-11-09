// 控制台代码编辑器 vendor 入口（CodeMirror 6 + YAML）。
// 只暴露能力，不在这里写死主题：主题与配色在 code-editor.js 里用 CSS 变量组装，
// 因此改配色不需要重新构建；只有新增 CM6 能力（新的 language / 扩展）才需要重建。
//
// 构建：npm run build:console-vendor
// 产物：public/console/components/code-editor/vendor/codemirror.js（已入库，运行时不需要 node_modules）
import { basicSetup } from 'codemirror';
import { EditorView } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { yaml } from '@codemirror/lang-yaml';

export { basicSetup, EditorView, Compartment, EditorState, HighlightStyle, syntaxHighlighting, tags, yaml };
