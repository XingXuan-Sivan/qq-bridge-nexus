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

  function resolve(key) {
    const conversation = String(key);
    const override = roleSourceFor(conversation);

    if (override === 'off') return { kind: 'off', source: 'session' };

    if (override === 'key') {
      const name = roleNameFor(conversation);
      const card = localCard(name, 'session');
      if (card) return card;
      if (name) log(`⚠️ 会话 ${conversation} 指定的人格「${name}」不在本地角色卡里，改为按未指定处理`);
    }

    const provided = plugins?.personaResolve(conversation);
    if (provided?.text) {
      return {
        kind: 'card',
        source: 'provider',
        name: provided.name,
        text: provided.text,
        fingerprint: provided.fingerprint,
        stale: Boolean(provided.stale),
      };
    }

    const globalName = typeof globalRoleName === 'function' ? globalRoleName() : null;
    const globalCard = localCard(globalName, 'global');
    if (globalCard) return globalCard;
    if (globalName) log(`⚠️ 全局人格「${globalName}」不在本地角色卡里，本轮不注入人格`);
    return { kind: 'none', source: 'none' };
  }

  function warm(key, options) {
    if (!plugins?.personaWarm) return Promise.resolve(null);
    return plugins.personaWarm(String(key), options);
  }

  return { resolve, warm };
}
