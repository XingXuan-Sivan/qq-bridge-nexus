// 平台子面板（平台配置页的第一个标签页）：平台清单（可搜索/刷新，带「编辑行为」入口）
// + 平台提示词（共享 prompt-card）+ 平台工具（只读）。
// 权威存储：profiles/platforms/<id>/{platform.yml,tools.yml,prompt.md,prompt.default.md}。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { dataTableHtml, initDataTables } from '../table/table.js';
import { mountPromptCard } from '../prompt-card/prompt-card.js';

let platforms = [];
let current = null;
let promptCard = null;

function platformTableHtml(list) {
  return dataTableHtml({
    columns: [
      { label: '平台' },
      { label: 'id', width: '140px' },
      { label: '行为档案', width: '110px' },
      { label: '提示词', width: '110px' },
      { label: '来源', width: '240px' },
      { label: '操作', width: '130px' },
    ],
    rows: list.map((item) => ({
      attrs: { 'data-platform-id': item.id, class: item.id === current?.id ? 'is-selected' : '' },
      cells: [
        `<b>${esc(item.label)}</b>`,
        `<code>${esc(item.id)}</code>`,
        `${item.behaviorCount} 个`,
        `${item.promptChars ?? 0} 字`,
        `<code>${esc(item.source)}</code>`,
        `<div class="row-actions"><button class="btn small" type="button" data-platform-edit-behavior="${esc(item.id)}">编辑行为</button></div>`,
      ],
    })),
    pageSize: 10,
    search: { placeholder: '搜索平台 / id' },
    refresh: true,
    empty: '还没有平台。在 profiles/platforms 下新增平台目录后重启桥接。',
  });
}

function toolsTableHtml(tools) {
  return dataTableHtml({
    columns: [
      { label: '工具' },
      { label: '工具名', width: '180px' },
      { label: '说明' },
      { label: '风险', width: '90px' },
      { label: '默认', width: '90px' },
    ],
    rows: tools.map((tool) => ({
      cells: [
        esc(tool.label || tool.flag),
        `<code>${esc(tool.flag)}</code>`,
        esc(tool.desc || '—'),
        `<span class="pill">${esc(tool.risk)}</span>`,
        tool.defaultOff ? '<span class="pill">默认关闭</span>' : '<span class="pill">默认开启</span>',
      ],
    })),
    pageSize: 12,
    empty: '这个平台没有声明工具清单。',
  });
}

function mountTables() {
  const listHost = document.getElementById('platformTable');
  if (listHost) {
    listHost.innerHTML = platformTableHtml(platforms);
    initDataTables(listHost, { onRefresh: () => void loadPlatforms() });
  }
  const toolsHost = document.getElementById('platformTools');
  if (toolsHost) {
    toolsHost.innerHTML = toolsTableHtml(current?.tools ?? []);
    initDataTables(toolsHost);
  }
}

async function loadPrompt(id) {
  const resp = await api(`/api/platform/prompts/${encodeURIComponent(id)}`);
  const doc = resp?.prompt ?? resp;
  if (!resp?.ok || !doc) throw new Error(resp?.error || '读取平台提示词失败');
  const host = document.getElementById('platformPromptCard');
  if (!host) return;
  if (!promptCard) {
    promptCard = mountPromptCard(host, {
      title: '平台提示词',
      hint: '这一层只写「在这个平台怎么当人」：群聊礼仪、引用与分条、该说不该说、发送禁令。占位符 {platform}、{displayName}、{owner} 由适配器渲染；保存写入 prompt.md，下一轮唤醒生效。',
      value: doc.text ?? '',
      factory: doc.factoryText ?? '',
      onSave: async () => {
        if (!current) return;
        const r = await api(`/api/platform/prompts/${encodeURIComponent(current.id)}`, 'PUT', { text: promptCard.getValue() });
        if (!r?.ok) throw new Error(r?.error || '保存失败');
        showConsoleToast('平台提示词已保存');
        return { text: r.prompt?.text ?? promptCard.getValue(), factory: doc.factoryText ?? '' };
      },
      onRestore: async () => {
        if (!current) return;
        const r = await api(`/api/platform/prompts/${encodeURIComponent(current.id)}/restore`, 'POST', {});
        if (!r?.ok) throw new Error(r?.error || '还原失败');
        showConsoleToast('已还原出厂');
        return { text: r.prompt?.text ?? '', factory: r.prompt?.factoryText ?? '' };
      },
    });
  } else {
    promptCard.setValue(doc.text ?? '');
    promptCard.setFactory(doc.factoryText ?? '');
  }
}

async function loadPlatforms() {
  const resp = await api('/api/platforms');
  platforms = Array.isArray(resp?.platforms) ? resp.platforms : [];
  if (!current || !platforms.some((item) => item.id === current.id)) current = platforms[0] ?? null;
  mountTables();
  if (current) {
    const detail = await api(`/api/platforms/${encodeURIComponent(current.id)}`);
    if (detail?.platform) {
      current = { ...current, ...detail.platform };
      mountTables();
    }
    await loadPrompt(current.id);
  }
}

export function initPlatformPanel() {
  if (document.getElementById('platformTable')?.dataset.bound === '1') return;
  const host = document.getElementById('platformTable');
  if (host) host.dataset.bound = '1';
  host?.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-platform-edit-behavior]');
    if (edit) {
      const id = edit.dataset.platformEditBehavior;
      document.dispatchEvent(new CustomEvent('qq:behavior-focus', { detail: { platform: id } }));
      return;
    }
    const row = event.target.closest('tr[data-platform-id]');
    if (!row) return;
    const id = row.dataset.platformId;
    const next = platforms.find((item) => item.id === id);
    if (!next || next.id === current?.id) return;
    current = next;
    void loadPlatforms();
  });
  void loadPlatforms();
}

export function init() {
  initPlatformPanel();
}
