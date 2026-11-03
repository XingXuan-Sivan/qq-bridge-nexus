// 具名注入块注册表（P4）。
//
// 每个块有自己的 id、优先级、字符上限和 render()，内核按优先级拼进 wake prompt。
// 与钩子的区别：钩子是「通知」，块是「内容」——块必须能单独关掉、单独限额，并且在
// 插件停用/重载/卸载时随之消失（注销按 pluginId 走）。
//
// 归属：这里只负责「收块、排序、限额、渲染、记账」，不关心 prompt 长什么样；
// 拼接位置由 bridge 的 deliverPromptNow 决定，总预算由 plugins.json 的
// limits.maxPromptAppendChars 兜底。

export const PROMPT_BLOCK_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

/** render 返回空串/非字符串视为「本轮不注入」，不算失败。 */
function toText(value) {
  return typeof value === 'string' ? value : '';
}

export function createPromptBlockRegistry({ log = () => {}, maxTotalChars = 4000, now = () => Date.now() } = {}) {
  const blocks = new Map(); // id -> { id, pluginId, priority, maxChars, render, calls, failures, lastError, lastRunAt }
  const stats = { renders: 0, injected: 0, skipped: 0 };

  function validate(definition) {
    if (!definition || typeof definition !== 'object') return '定义必须是对象';
    if (typeof definition.id !== 'string' || !PROMPT_BLOCK_ID_RE.test(definition.id)) return `注入块 id 非法：${definition.id}`;
    if (typeof definition.render !== 'function') return 'render 必须是函数';
    if (definition.priority !== undefined && !Number.isFinite(definition.priority)) return 'priority 必须是数字';
    if (definition.maxChars !== undefined && (!Number.isInteger(definition.maxChars) || definition.maxChars < 1)) return 'maxChars 必须是正整数';
    return null;
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
      priority: definition.priority ?? 100,
      maxChars: definition.maxChars ?? maxTotalChars,
      render: definition.render,
      calls: 0,
      failures: 0,
      lastError: null,
      lastRunAt: null,
    });
    return true;
  }

  function unregisterPlugin(pluginId) {
    for (const [id, block] of blocks) {
      if (block.pluginId === pluginId) blocks.delete(id);
    }
  }

  function list() {
    return [...blocks.values()]
      .sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id))
      .map(({ render, ...rest }) => rest);
  }

  /**
   * 渲染所有块。单个块失败只记在它自己头上，不影响其它块；超出总预算的块整块跳过
   * （宁可少一块，也不截半句话）。返回的 blocks 报告用于控制台与排查。
   */
  async function render(context = {}) {
    const ordered = [...blocks.values()].sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));
    const parts = [];
    const report = [];
    let total = 0;
    stats.renders += 1;

    for (const block of ordered) {
      block.calls += 1;
      block.lastRunAt = new Date(now()).toISOString();
      let text = '';
      try {
        text = toText(await block.render(context));
      } catch (error) {
        block.failures += 1;
        block.lastError = String(error?.message ?? error).slice(0, 300);
        report.push({ id: block.id, pluginId: block.pluginId, status: 'error', chars: 0 });
        continue;
      }
      if (!text.trim()) {
        report.push({ id: block.id, pluginId: block.pluginId, status: 'empty', chars: 0 });
        continue;
      }
      const clipped = text.length > block.maxChars ? text.slice(0, block.maxChars) : text;
      if (total + clipped.length > maxTotalChars) {
        stats.skipped += 1;
        report.push({ id: block.id, pluginId: block.pluginId, status: 'budget', chars: 0 });
        continue;
      }
      parts.push(clipped);
      total += clipped.length;
      stats.injected += 1;
      report.push({
        id: block.id,
        pluginId: block.pluginId,
        status: clipped.length < text.length ? 'truncated' : 'injected',
        chars: clipped.length,
      });
    }

    return { text: parts.join('\n\n'), blocks: report, chars: total };
  }

  function status() {
    return {
      total: blocks.size,
      maxTotalChars,
      renders: stats.renders,
      injected: stats.injected,
      skipped: stats.skipped,
      blocks: list().map(({ id, pluginId, priority, maxChars, calls, failures, lastError, lastRunAt }) => ({
        id, pluginId, priority, maxChars, calls, failures, lastError, lastRunAt,
      })),
    };
  }

  return { register, unregisterPlugin, list, render, status };
}
