// 具名注入块注册表（P4）。
//
// 每个块有自己的 id、owner、优先级、字符上限和 render()，内核按优先级拼进 wake prompt。
// 与钩子的区别：钩子是「通知」，块是「内容」——块必须能单独关掉、单独限额，并且在
// 插件停用/重载/卸载时随之消失（注销按 pluginId 走）。
//
// 归属：owner 区分 core / plugin:<id> / declared，控制台按它分组与展示。
// 这里只负责「收块、排序、限额、渲染、记账」，不关心 prompt 长什么样；
// 拼接位置由 bridge 的 deliverPromptNow 决定，总预算由 plugins.json 的
// limits.maxPromptAppendChars 兜底。
//
// 覆盖：开关与上限可以按块 id 从配置覆盖（`setOverrides`），对任意 owner 生效；
// 插件块默认不限（maxChars=null），块内部各段的预算由实现者自己决定。

export const PROMPT_BLOCK_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

/** render 返回空串/非字符串视为「本轮不注入」，不算失败。 */
function toText(value) {
  return typeof value === 'string' ? value : '';
}

export function createPromptBlockRegistry({ log = () => {}, maxTotalChars = 4000, now = () => Date.now() } = {}) {
  // id -> { id, pluginId, owner, label, priority, maxChars, enabled, render, calls, failures,
  //         lastError, lastRunAt, lastChars, lastStatus, truncated, skipped }
  const blocks = new Map();
  const stats = { renders: 0, injected: 0, skipped: 0 };
  // id -> { enabled?: boolean, maxChars?: number|null }，来自 config.json.promptBlocks。
  let overrides = {};

  function validate(definition) {
    if (!definition || typeof definition !== 'object') return '定义必须是对象';
    if (typeof definition.id !== 'string' || !PROMPT_BLOCK_ID_RE.test(definition.id)) return `注入块 id 非法：${definition.id}`;
    if (typeof definition.render !== 'function') return 'render 必须是函数';
    if (definition.priority !== undefined && !Number.isFinite(definition.priority)) return 'priority 必须是数字';
    if (definition.maxChars !== undefined && definition.maxChars !== null && (!Number.isInteger(definition.maxChars) || definition.maxChars < 1)) return 'maxChars 必须是正整数或 null';
    return null;
  }

  function normalizeOwner(definition, pluginId) {
    if (typeof definition.owner === 'string' && definition.owner.trim()) return definition.owner.trim();
    return pluginId === 'core' ? 'core' : `plugin:${pluginId}`;
  }

  /** 生效值：有覆盖用覆盖，否则用注册时的默认值。`maxChars: null` = 不限。 */
  function effective(block) {
    const override = overrides[block.id] || {};
    return {
      enabled: override.enabled !== undefined ? override.enabled : block.enabledDefault,
      maxChars: override.maxChars !== undefined ? override.maxChars : block.maxCharsDefault,
    };
  }

  function register(definition, pluginId) {
    const error = validate(definition);
    if (error) {
      log(`⚠️ [plugins] ${pluginId} 注册注入块失败：${error}`);
      return false;
    }
    if (blocks.has(definition.id)) {
      log(`⚠️ [plugins] 注入块 "${definition.id}" 已被 ${blocks.get(definition.id).pluginId} 注册，忽略 ${pluginId} 的重复注册`);
      return false;
    }
    blocks.set(definition.id, {
      id: definition.id,
      pluginId,
      owner: normalizeOwner(definition, pluginId),
      label: typeof definition.label === 'string' && definition.label.trim() ? definition.label.trim() : definition.id,
      priority: definition.priority ?? 100,
      enabledDefault: true,
      maxCharsDefault: definition.maxChars ?? null,
      render: definition.render,
      calls: 0,
      failures: 0,
      lastError: null,
      lastRunAt: null,
      lastChars: 0,
      lastStatus: 'idle',
      truncated: 0,
      skipped: 0,
    });
    return true;
  }

  function unregisterPlugin(pluginId) {
    for (const [id, block] of blocks) {
      if (block.pluginId === pluginId) blocks.delete(id);
    }
  }

  /** 整体替换覆盖表（bridge 在配置变更与启动时调用）。 */
  function setOverrides(next = {}) {
    overrides = {};
    if (!next || typeof next !== 'object') return;
    for (const [id, value] of Object.entries(next)) {
      if (!PROMPT_BLOCK_ID_RE.test(id) || !value || typeof value !== 'object') continue;
      const conf = {};
      if (typeof value.enabled === 'boolean') conf.enabled = value.enabled;
      if (value.maxChars === null) conf.maxChars = null;
      else if (Number.isInteger(value.maxChars) && value.maxChars > 0) conf.maxChars = value.maxChars;
      if (Object.keys(conf).length) overrides[id] = conf;
    }
  }

  function list() {
    return [...blocks.values()]
      .sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id))
      .map(({ render, enabledDefault, maxCharsDefault, ...rest }) => {
        const live = effective({ ...rest, enabledDefault, maxCharsDefault });
        return { ...rest, enabled: live.enabled, maxChars: live.maxChars };
      });
  }

  function begin(block) {
    block.calls += 1;
    block.lastRunAt = new Date(now()).toISOString();
  }

  function finish(block, status, chars, text = '') {
    block.lastStatus = status;
    block.lastChars = chars;
    if (status === 'truncated') block.truncated += 1;
    if (status === 'budget') block.skipped += 1;
    return text;
  }

  /**
   * 渲染所有块。单个块失败只记在它自己头上，不影响其它块；超出总预算的块整块跳过
   * （宁可少一块，也不截半句话）。关闭的块直接跳过（status='off'）。
   * 返回的 blocks 报告用于控制台与排查。
   */
  async function render(context = {}) {
    const ordered = [...blocks.values()].sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));
    const parts = [];
    const report = [];
    let total = 0;
    stats.renders += 1;

    for (const block of ordered) {
      const live = effective(block);
      if (!live.enabled) {
        report.push({ id: block.id, owner: block.owner, status: 'off', chars: 0 });
        continue;
      }
      begin(block);
      let text = '';
      try {
        text = toText(await block.render(context));
      } catch (error) {
        block.failures += 1;
        block.lastError = String(error?.message ?? error).slice(0, 300);
        finish(block, 'error', 0);
        report.push({ id: block.id, owner: block.owner, status: 'error', chars: 0 });
        continue;
      }
      if (!text.trim()) {
        finish(block, 'empty', 0);
        report.push({ id: block.id, owner: block.owner, status: 'empty', chars: 0 });
        continue;
      }
      const limit = live.maxChars;
      const clipped = limit !== null && text.length > limit ? text.slice(0, limit) : text;
      if (total + clipped.length > maxTotalChars) {
        stats.skipped += 1;
        finish(block, 'budget', 0);
        report.push({ id: block.id, owner: block.owner, status: 'budget', chars: 0 });
        continue;
      }
      parts.push(clipped);
      total += clipped.length;
      stats.injected += 1;
      const status = clipped.length < text.length ? 'truncated' : 'injected';
      finish(block, status, clipped.length);
      report.push({ id: block.id, owner: block.owner, status, chars: clipped.length });
    }

    return { text: parts.join('\n\n'), blocks: report, chars: total };
  }

  /**
   * 渲染单个块（同步）。给内置段落的块化用：`buildWakePromptV2Core` 是同步函数，
   * 而内置 render 只做字符串拼装，没有异步需求。返回 Promise 的 render 会被判为失败，
   * 避免「偷偷异步」导致文本悄悄变成空串。
   */
  function renderBlockSync(id, context = {}) {
    const block = blocks.get(id);
    if (!block) return { id, status: 'missing', text: '', chars: 0 };
    const live = effective(block);
    if (!live.enabled) return { id, owner: block.owner, status: 'off', text: '', chars: 0 };
    let text = '';
    begin(block);
    try {
      const value = block.render(context);
      if (value && typeof value.then === 'function') throw new Error('同步渲染不接受 Promise 返回值');
      text = toText(value);
    } catch (error) {
      block.failures += 1;
      block.lastError = String(error?.message ?? error).slice(0, 300);
      finish(block, 'error', 0);
      return { id, pluginId: block.pluginId, owner: block.owner, status: 'error', text: '', chars: 0 };
    }
    if (!text.trim()) {
      finish(block, 'empty', 0);
      return { id, pluginId: block.pluginId, owner: block.owner, status: 'empty', text: '', chars: 0 };
    }
    const limit = live.maxChars;
    const clipped = limit !== null && text.length > limit ? text.slice(0, limit) : text;
    stats.injected += 1;
    const status = clipped.length < text.length ? 'truncated' : 'injected';
    finish(block, status, clipped.length);
    return {
      id,
      pluginId: block.pluginId,
      owner: block.owner,
      status,
      text: clipped,
      chars: clipped.length,
    };
  }

  function status() {
    const items = list();
    return {
      total: items.length,
      maxTotalChars,
      renders: stats.renders,
      injected: stats.injected,
      skipped: stats.skipped,
      blocks: items.map(({ id, pluginId, owner, label, priority, enabled, maxChars, calls, failures, lastError, lastRunAt, lastChars, lastStatus, truncated }) => ({
        id, pluginId, owner, label, priority, enabled, maxChars, calls, failures, lastError, lastRunAt, lastChars, lastStatus, truncated,
      })),
    };
  }

  return { register, unregisterPlugin, setOverrides, list, render, renderBlockSync, status };
}
