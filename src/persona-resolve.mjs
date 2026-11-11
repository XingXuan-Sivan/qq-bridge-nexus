// 人格的三层解析（docs/PERSONA_PROVIDER.md §4）：
//
//   L1 会话覆盖：/role 选的本会话卡（或显式 off）
//   L2 外部 provider：soulkit 按会话返回的卡
//   L3 全局本地卡：state/current-role.json 的 role + roles/*.md
//
// 优先级是「越具体越优先」，但 off 是硬覆盖：管理员明确说了这个会话说不要挂卡，
// 就不能被 provider 的卡片绕过。L2 是「按会话」的，所以不是全局替换——
// 没有绑定 soulkit 的会话仍然走 L3。
export function createPersonaResolver({
  plugins = null,
  roleSourceFor,
  roleNameFor,
  roleCardFor,
  globalRoleName,
  log = () => {},
}) {
  function localCard(name, source) {
    const card = name ? roleCardFor(name) : null;
    if (!card) return null;
    return { kind: 'card', source, name, text: card.text, fingerprint: card.fingerprint };
  }

  function providerCard(conversation) {
    const provided = plugins?.personaResolve?.(conversation);
    if (!provided?.text) return null;
    return {
      kind: 'card',
      source: 'provider',
      name: provided.name,
      text: provided.text,
      fingerprint: provided.fingerprint,
      stale: Boolean(provided.stale),
    };
  }

  function resolve(key) {
    const conversation = String(key);
    const override = roleSourceFor(conversation);

    // off 是硬覆盖：管理员明确说了这个会话说不要挂卡。
    if (override === 'off') return { kind: 'off', source: 'session' };

    // 外部 provider 是第一来源；缓存只是在服务不可达时兜底（warm 会先拉一次）。
    const provided = providerCard(conversation);
    if (provided) return provided;

    const name = override === 'key' ? roleNameFor(conversation) : null;
    const local = localCard(name, 'session');
    if (local) return local;

    const globalName = typeof globalRoleName === 'function' ? globalRoleName() : null;
    const globalCard = localCard(globalName, 'global');
    if (globalCard) return globalCard;

    // 只有“外部服务没给、本地也没有”才值得告警，且不再暗示是本地缺卡。
    if (name) log(`⚠️ 会话 ${conversation} 的人格「${name}」外部服务与本地都没取到，按未指定处理`);
    else if (globalName) log(`⚠️ 全局人格「${globalName}」外部服务与本地都没取到，本轮不注入人格`);
    return { kind: 'none', source: 'none' };
  }

  async function warm(key, options = {}) {
    if (!plugins?.personaWarm) return null;
    const conversation = String(key);
    const first = await plugins.personaWarm(conversation, options);
    if (providerCard(conversation)) return first;
    // 缓存还没有这张卡：强制再拉一次（外部服务才是第一来源，缓存只是兜底）。
    try {
      return await plugins.personaWarm(conversation, { ...options, force: true, name: roleNameFor(conversation) });
    } catch (error) {
      log(`⚠️ 人格服务拉取失败（${conversation}）：${error?.message ?? error}，本轮退回本地/缓存`);
      return first;
    }
  }

  return { resolve, warm };
}
