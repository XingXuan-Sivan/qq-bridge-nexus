// 人格 provider 注册表（docs/PLUGIN_KERNEL.md §9）。
//
// 关键约束：`resolve()` 必须同步。桥接在组装 prompt 的同步链路里问「这个会话用哪张卡」，
// 所以 provider 只能读缓存；需要网络的部分由 provider 自己的 refresh 预取。
// 这里统一兜住 provider 抛错：人格拿不到就回落 roles/*.md，绝不让插件把消息主链拖死。
import crypto from 'node:crypto';

export function fingerprintOf(name, text) {
  return `sha256:${crypto.createHash('sha256').update(`${name}\n${text}`, 'utf8').digest('hex')}`;
}

export function createPersonaRegistry({ log } = {}) {
  let active = null; // { provider, pluginId }

  function validate(provider) {
    if (!provider || typeof provider !== 'object') return 'provider 必须是对象';
    if (typeof provider.id !== 'string' || !provider.id.trim()) return 'provider.id 必须是非空字符串';
    if (typeof provider.resolve !== 'function') return 'provider.resolve 必须是函数';
    if (provider.refresh !== undefined && typeof provider.refresh !== 'function') return 'provider.refresh 必须是函数';
    return null;
  }

  return {
    /** 注册（同一时刻只有一个生效；后来的覆盖先来的，并留下告警）。 */
    register(provider, pluginId) {
      const problem = validate(provider);
      if (problem) throw new Error(problem);
      if (active) {
        log?.(`⚠️ [plugins] ${pluginId} 注册人格 provider "${provider.id}"，覆盖了 ${active.pluginId} 的 "${active.provider.id}"`);
      }
      active = { provider, pluginId };
    },

    unregister(pluginId) {
      if (active?.pluginId === pluginId) active = null;
    },

    /** 同步解析；没有 provider、返回 null 或抛错都返回 null（调用方回落 roles）。 */
    resolve(key) {
      if (!active) return null;
      try {
        const card = active.provider.resolve(key);
        if (!card || typeof card !== 'object') return null;
        const name = typeof card.name === 'string' ? card.name.trim() : '';
        const text = typeof card.text === 'string' ? card.text : '';
        if (!name || !text) return null;
        const fingerprint = typeof card.fingerprint === 'string' && card.fingerprint
          ? card.fingerprint
          : fingerprintOf(name, text);
        return { name, text, fingerprint, source: active.provider.id };
      } catch (error) {
        log?.(`⚠️ [plugins] 人格 provider "${active.provider.id}" resolve 失败: ${error?.message ?? error}`);
        return null;
      }
    },

    describe() {
      return active ? { id: active.provider.id, plugin: active.pluginId } : null;
    },
  };
}
