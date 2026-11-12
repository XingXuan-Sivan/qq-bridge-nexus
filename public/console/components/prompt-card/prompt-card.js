// 提示词卡片：说明在上、编辑器默认只读；下方按钮统一为「编辑内容 / 取消编辑」「保存」「还原」。
// 平台提示词、行为提示词共用这一份结构，避免两处各写一套按钮与状态。
import { esc } from '../../js/ui.js';
import { mountCodeEditor } from '../code-editor/code-editor.js';

function countText(value) {
  return String(value ?? '').length;
}

export function mountPromptCard(host, {
  title,
  hint = '',
  value = '',
  factory = '',
  language = 'markdown',
  height = '420px',
  onSave = async () => {},
  onRestore = async () => {},
} = {}) {
  if (!host) throw new Error('提示词卡片缺少宿主元素');
  host.innerHTML = `
    <h2>${esc(title || '提示词')}</h2>
    ${hint ? `<p class="meta">${hint}</p>` : ''}
    <div class="prompt-card-body" data-prompt-body></div>
    <div class="prompt-card-actions">
      <button class="btn primary" type="button" data-prompt-edit>编辑内容</button>
      <button class="btn" type="button" data-prompt-save disabled>保存</button>
      <button class="btn" type="button" data-prompt-restore>还原</button>
      <span class="meta" data-prompt-status role="status"></span>
    </div>
  `;
  const body = host.querySelector('[data-prompt-body]');
  const editButton = host.querySelector('[data-prompt-edit]');
  const saveButton = host.querySelector('[data-prompt-save]');
  const restoreButton = host.querySelector('[data-prompt-restore]');
  const status = host.querySelector('[data-prompt-status]');

  let current = String(value ?? '');
  let factoryText = String(factory ?? '');
  let editing = false;
  let busy = false;

  const editor = mountCodeEditor(body, {
    value: current,
    language,
    height,
    readOnly: true,
  });

  function renderStatus() {
    const text = editor?.getValue?.() ?? current;
    const same = text === factoryText;
    status.textContent = `${countText(text)} 字 · ${same ? '与出厂一致' : '与出厂不一致'}`;
  }

  function renderButtons() {
    editButton.textContent = editing ? '取消编辑' : '编辑内容';
    editButton.classList.toggle('primary', !editing);
    saveButton.disabled = !editing || busy;
    restoreButton.disabled = busy;
    editor?.setReadOnly?.(!editing);
  }

  editButton.addEventListener('click', () => {
    if (busy) return;
    if (editing) {
      editor?.setValue?.(current);
      editing = false;
    } else {
      editing = true;
      editor?.focus?.();
    }
    renderStatus();
    renderButtons();
  });

  saveButton.addEventListener('click', async () => {
    if (busy || !editing) return;
    busy = true;
    renderButtons();
    try {
      const text = editor?.getValue?.() ?? current;
      await onSave(text);
      current = text;
      editing = false;
      renderStatus();
    } catch (error) {
      status.textContent = String(error?.message ?? error);
    } finally {
      busy = false;
      renderButtons();
    }
  });

  restoreButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    renderButtons();
    try {
      const next = await onRestore();
      if (next && typeof next === 'object') {
        current = String(next.text ?? current);
        factoryText = String(next.factory ?? factoryText);
      }
      editor?.setValue?.(current);
      editing = false;
      renderStatus();
    } catch (error) {
      status.textContent = String(error?.message ?? error);
    } finally {
      busy = false;
      renderButtons();
    }
  });

  renderStatus();
  renderButtons();

  return {
    getValue: () => editor?.getValue?.() ?? current,
    setValue(next) {
      current = String(next ?? '');
      editor?.setValue?.(current);
      renderStatus();
    },
    setFactory(next) {
      factoryText = String(next ?? '');
      renderStatus();
    },
  };
}
