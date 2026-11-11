// 能力预设面板：桥接侧的能力补丁（可用工具 + 权限建议 + 平台提示词）。
// 行为页第二标签与运行方案页共用同一份实现，避免两处各写一套。
// 约定：表格只用 table 组件，字段只用 renderFields，弹窗字段也走 renderFields。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { renderFields, checkListField } from '../../components/form/form.js';
import { modalHtml, openModal, wireModal } from '../../components/modal/modal.js';

const PERMISSION_OPTIONS = [
  { value: '', label: '跟随级别（不提示）' },
  { value: 'read-only', label: '只读' },
  { value: 'workspace-write', label: '工作区读写' },
  { value: 'full-ask', label: '完全访问 · 每次确认' },
  { value: 'full', label: '完全访问 · 短时授权' },
];

/**
 * @param {{ tableHost: HTMLElement, editorHost?: HTMLElement, onSaved?: Function }} options
 */
export function createCapabilityPanel({ tableHost, onSaved = null }) {
  let capabilities = [];
  let presets = [];
  let catalog = null;

  const el = (id) => document.getElementById(id);
  const gatedTools = () => (catalog?.platform ?? []).filter((tool) => tool.gated);
  const byId = (id) => capabilities.find((item) => item.id === id) ?? null;
  const presetById = (id) => presets.find((item) => item.id === id) ?? null;

  /** 预设里 MCP / 技能的放行数量（DSH 侧），没有就写「未配置」。 */
  function extensionSummary(id) {
    const preset = presetById(id);
    if (!preset) return '<span class="meta">—</span>';
    const mcp = preset.extensions?.mcpServers?.allow?.length ?? 0;
    const tools = preset.extensions?.mcpServers?.tools?.allow?.length ?? 0;
    const skills = preset.extensions?.skills?.allow?.length ?? 0;
    return `<span class="meta">MCP ${mcp} · 工具 ${tools} · 技能 ${skills}</span>`;
  }

  /** 可见集（null = 全部）→ 「允许 N / 共 M」+ 被禁工具的 pill。 */
  function visibleSummary(cap) {
    const tools = gatedTools();
    const blocked = tools.filter((tool) => cap.tools?.visible?.includes(tool.flag) === false);
    const allowed = cap.tools?.visible === null || cap.tools?.visible === undefined
      ? tools.length
      : tools.length - blocked.length;
    const pills = blocked.slice(0, 4).map((tool) => `<span class="pill r">${esc(tool.label)}</span>`).join(' ');
    return `<span class="meta">允许 ${allowed} / ${tools.length}</span>${pills ? ` ${pills}` : ''}`;
  }

  function tableMarkup() {
    if (!capabilities.length) return '<div class="meta">还没有可用的能力预设。</div>';
    const rows = capabilities.map((cap) => [
      `<code>${esc(cap.id)}</code>`,
      visibleSummary(cap),
      cap.prompt?.personaPrefix
        ? `<span class="meta">${esc(cap.prompt.personaPrefix.slice(0, 28))}${cap.prompt.personaPrefix.length > 28 ? '…' : ''}</span>`
        : '<span class="meta">未设置</span>',
      extensionSummary(cap.id),
      `<button class="btn small" type="button" data-cap-edit="${esc(cap.id)}">编辑</button> <button class="btn small" type="button" data-cap-advanced="${esc(cap.id)}">高级</button>`,
    ]);
    return dataTableHtml({
      columns: [
        { label: '能力预设', width: '180' },
        { label: '可用工具' },
        { label: '平台提示词', width: '220' },
        { label: 'MCP / 技能', width: '170' },
        { label: '操作', width: '150' },
      ],
      rows,
      pageSize: 10,
      meta: `共 ${capabilities.length} 项`,
      empty: '没有匹配的能力预设。',
    });
  }

  function render() {
    if (!tableHost) return;
    tableHost.innerHTML = tableMarkup();
    initDataTables(tableHost);
  }

  function editorMarkup(cap) {
    return modalHtml({
      id: 'capabilityEditor',
      title: `能力预设 · ${cap.id}`,
      body: '<div class="form-stack" id="capabilityFields"></div>',
      footer: '<button class="btn" type="button" data-modal-close>取消</button><button class="btn primary" type="button" id="capabilitySave">保存</button>',
    });
  }

  function renderEditorFields(cap) {
    const host = el('capabilityFields');
    if (!host) return;
    const tools = gatedTools();
    const allowed = cap.tools?.visible === null || cap.tools?.visible === undefined
      ? tools.map((tool) => tool.flag)
      : cap.tools.visible.filter((flag) => tools.some((tool) => tool.flag === flag));
    const toolsHtml = checkListField({
      id: 'capabilityVisible',
      label: '允许调用的工具',
      options: tools.map((tool) => ({ value: tool.flag, label: `${tool.label}（${tool.flag}）` })),
      value: allowed,
      columns: 2,
      hint: '勾上 = 允许；只对固定使用这个能力预设的方案生效。读类工具不受这里限制，仍由「全局配置 › 拓展功能」的注册开关控制。',
    });
    renderFields(host, [
      { name: 'capabilityVisibleBlock', type: 'custom', span: 1, html: toolsHtml },
      { name: 'capabilityPermission', type: 'select', label: '权限建议', options: PERMISSION_OPTIONS, value: cap.suggestedPermission || '', hint: '只作提示：新建或改会话时建议选这个级别，不会自动套用。' },
      { name: 'capabilityPersona', type: 'textarea', label: '平台提示词', value: cap.prompt?.personaPrefix || '', hint: '拼进 Agent 的平台补充（可用 {platform} {displayName} {owner} 占位符）。' },
      { name: 'capabilityNote', type: 'text', label: '备注', value: cap.note || '' },
    ], { columns: 1 });
  }

  function open(id) {
    const cap = byId(id);
    if (!cap) return;
    document.body.insertAdjacentHTML('beforeend', editorMarkup(cap));
    const overlay = el('capabilityEditor');
    if (!overlay) return;
    openModal(overlay);
    renderEditorFields(cap);
    wireModal(overlay);
    overlay.querySelector('#capabilitySave')?.addEventListener('click', async () => {
      const next = {
        tools: { visible: [...overlay.querySelectorAll('[name="capabilityVisible"]:checked')].map((box) => box.value) },
        prompt: { personaPrefix: overlay.querySelector('#capabilityPersona')?.value ?? '' },
        suggestedPermission: overlay.querySelector('#capabilityPermission')?.value ?? '',
        note: overlay.querySelector('#capabilityNote')?.value ?? '',
      };
      try {
        const r = await api(`/api/runtime/capabilities/${encodeURIComponent(id)}`, 'PATCH', next);
        if (!r?.ok) throw new Error(r?.error || '保存失败');
        showConsoleToast('能力预设已保存');
        overlay.remove();
        await load();
        onSaved?.();
      } catch (error) {
        showConsoleToast(`保存失败：${error?.message ?? error}`, 'err');
      }
    });
  }

  async function load() {
    try {
      const [caps, list] = await Promise.all([
        api('/api/runtime/capabilities'),
        api('/api/presets').catch(() => null),
      ]);
      catalog = caps?.catalog ?? null;
      capabilities = caps?.capabilities ?? [];
      presets = list?.presets ?? [];
      render();
    } catch (error) {
      if (tableHost) tableHost.innerHTML = `<div class="meta">读取能力预设失败：${esc(error?.message ?? error)}</div>`;
    }
  }

  tableHost?.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-cap-edit]');
    if (trigger) {
      open(trigger.dataset.capEdit);
      return;
    }
    // 「高级」去能力预设页：MCP / 技能 / YAML 在那儿改，这里只做桥接侧补丁。
    const advanced = event.target.closest('[data-cap-advanced]');
    if (advanced) window.location.hash = '#presets';
  });

  return { load, render };
}
