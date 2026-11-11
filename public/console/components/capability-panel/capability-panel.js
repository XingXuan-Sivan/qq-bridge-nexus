// 能力面板：编辑 capability.yml（平台工具、Agent 模块、安全补充）。平台说话方式在行为档案里。
// 行为页第二标签与运行方案页共用同一份实现，避免两处各写一套。
// 约定：表格只用 table 组件，字段只用 renderFields，弹窗字段也走 renderFields。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../../components/table/table.js';
import { renderFields, checkListField } from '../../components/form/form.js';
import { modalHtml, openModal, wireModal } from '../../components/modal/modal.js';

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

  /** 平台工具可见集 → 「允许 N / 共 M」+ 被禁工具的 pill。 */
  function visibleSummary(cap) {
    const tools = gatedTools();
    if (!catalog) return '<span class="meta">后端未返回工具目录：重启桥接后生效</span>';
    const visible = Array.isArray(cap.platformVisible) ? cap.platformVisible : tools.map((tool) => tool.flag);
    const blocked = tools.filter((tool) => !visible.includes(tool.flag));
    const pills = blocked.slice(0, 3).map((tool) => `<span class="pill r">${esc(tool.label)}</span>`).join(' ');
    return `<span class="meta">允许 ${tools.length - blocked.length} / ${tools.length}</span>${pills ? ` ${pills}` : ''}`;
  }

  function tableMarkup() {
    if (!capabilities.length) return '<div class="meta">还没有可用的能力预设。</div>';
    const rows = capabilities.map((cap) => [
      `<code>${esc(cap.id)}</code>`,
      visibleSummary(cap),
      (cap.agentModules ?? []).length
        ? `<span class="meta">${esc((cap.agentModules ?? []).join(' / '))}</span>`
        : '<span class="meta">无本地模块</span>',
      extensionSummary(cap.id),
      `<button class="btn small" type="button" data-cap-edit="${esc(cap.id)}">编辑</button> <button class="btn small" type="button" data-cap-advanced="${esc(cap.id)}">高级</button>`,
    ]);
    return dataTableHtml({
      columns: [
        { label: '能力预设', width: '180' },
        { label: '平台工具' },
        { label: 'Agent 模块', width: '220' },
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
    const visible = Array.isArray(cap.platformVisible) ? cap.platformVisible : tools.map((tool) => tool.flag);
    const modules = (catalog?.agent ?? []).map((module) => ({ value: module.id, label: module.label }));
    const toolsHtml = tools.length ? checkListField({
      id: 'capabilityPlatform',
      label: '平台工具',
      options: tools.map((tool) => ({ value: tool.flag, label: `${tool.label}（${tool.flag}）` })),
      value: visible.filter((flag) => tools.some((tool) => tool.flag === flag)),
      columns: 2,
      hint: '勾上 = 允许；只对使用这套能力的方案生效。读类工具不受这里限制，仍由「全局配置 › 拓展功能」的注册开关控制。',
    })
      : '<div class="meta">后端还没有返回工具目录（桥接进程启动早于本次更新）。重启桥接后，这里会列出可收紧的工具。</div>';
    const modulesHtml = checkListField({
      id: 'capabilityAgent',
      label: 'Agent 模块',
      options: modules,
      value: cap.agentModules ?? [],
      columns: 2,
      hint: '本地执行能力（文件 / 命令 / 任务）。聊天类能力应保持全关，由守卫行兜底。',
    });
    renderFields(host, [
      { name: 'capabilityLabel', type: 'text', label: '名称', value: cap.label || '', span: 1 },
      { name: 'capabilityVisibleBlock', type: 'custom', span: 2, html: toolsHtml },
      { name: 'capabilityAgentBlock', type: 'custom', span: 2, html: modulesHtml },
      { name: 'capabilitySafetyNotes', type: 'textarea', label: '安全补充', value: cap.safety?.notes || '', hint: '拼在 persona 安全段末尾；只写这套能力特有的约束。' },
      { name: 'capabilityNote', type: 'text', label: '备注', value: cap.note || '', hint: '给选方案的人看的说明，不进提示词。' },
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
      const platform = {};
      for (const tool of gatedTools()) {
        platform[tool.flag] = overlay.querySelector(`[name="capabilityPlatform"][value="${tool.flag}"]`)?.checked === true;
      }
      const agent = {};
      for (const box of overlay.querySelectorAll('[name="capabilityAgent"]')) {
        if (box.checked) agent[box.value] = true;
      }
      const next = {
        label: overlay.querySelector('#capabilityLabel')?.value ?? '',
        tools: { platform, agent },
        safety: { notes: overlay.querySelector('#capabilitySafetyNotes')?.value ?? '' },
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
