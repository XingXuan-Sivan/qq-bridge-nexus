// Agent 侧平台注册表（中立，零平台名）。
//
// 内核只通过这里问「当前 Agent 平台能做什么、认领哪些生效方式」。具体平台由
// src/agent-side/builtin.mjs（内置）或插件在运行期（`agent-provider:provide`）注册。
//
// 为什么是同步注册表而不是 await import()：能力档解析在消息处理的热路径上，
// 异步解析会让每次调用都变成 Promise，调用方要穿透 await，收益为零。平台模块本身
// 只是常量与纯函数，同步加载没有副作用。
//
// 未注册时的行为：抛错（fail-closed）。猜一个默认平台会把工具面与对端权限档搞错，
// 比直接报错更贵。
//
// 除「有哪些平台」之外，这张表还记两件事，都因为**只有注册表知道归属**才住在这里：
//   · `owner`：插件注册的平台要能按插件批量注销（与 src/user-side/transport.mjs 同口径）；
//   · `issues`：注册被拒、连接层建不起来、声明的能力对不上实现，要能被控制台看见。
//     issues 描述的是「这个平台的装配结论」，不是运行状态；有没有连上在 runtime.mjs 的单例里。

/** 内置平台的所有者。插件既不能占用这个名字，也不能顶替它的平台 id。 */
export const BUILTIN_OWNER = 'builtin';

/** 平台 id 文法：小写字母开头，2–40 位小写字母 / 数字 / 连字符（与用户侧 transport 同一条）。 */
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

const platforms = new Map();
/** id → [{ code, message }]，最近一次装配失败的结论；注册成功即清空。 */
const issues = new Map();
let activeId = '';

function normalizeId(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * 注册一个 Agent 平台实现。
 *
 * @param {object} impl
 * @param {string} impl.id               平台 id（会成为 `platforms.active.agent` 的取值）
 * @param {string} impl.label            控制台显示名
 * @param {string[]} [impl.capabilities]  描述性能力清单（同一份会出现在控制台与诊断里）
 * @param {Function} impl.createRuntime  连接层工厂（成员表见 runtime.mjs 的 RUNTIME_MEMBERS）
 * @param {string[]} [impl.PEER_PERMISSIONS]  对端权限档的静态取值域（空 = 由对端决定）
 * @param {{owner?: string}} [options]   `owner` 缺省为内置；插件注册时传 pluginId
 */
export function registerAgentPlatform(impl, { owner = BUILTIN_OWNER } = {}) {
  const id = normalizeId(impl?.id);
  if (!ID_RE.test(id)) {
    throw new Error(`registerAgentPlatform: id 不合法：${id || '(空)'}（要求小写字母开头，2–40 位小写字母 / 数字 / 连字符）`);
  }
  // createRuntime 是连接层，缺了它这个平台永远不能被配成「当前执行体」。
  // 注册时就判，而不是等到第一次用才炸。
  if (typeof impl.createRuntime !== 'function') {
    throw new Error(`registerAgentPlatform: ${id} 缺少 createRuntime（不能连接的执行体不是平台）`);
  }
  const ownerName = String(owner ?? '').trim() || BUILTIN_OWNER;
  const existing = platforms.get(id);
  // 同 owner 允许覆盖（插件热重载、内置模块重复求值），换 owner 一律拒绝：
  // 两个来源抢同一个 id，「当前执行体是哪份实现」就无法解释了。
  if (existing && existing.owner !== ownerName) {
    throw new Error(`Agent 平台 id 已被占用：${id}（${existing.owner}）；${
      ownerName === BUILTIN_OWNER ? '内置平台不可被顶替' : '插件不得顶替别人的平台'
    }`);
  }
  const entry = {
    ...impl,
    id,
    owner: ownerName,
    source: ownerName === BUILTIN_OWNER ? 'builtin' : 'plugin',
  };
  platforms.set(id, entry);
  // 新实现进来了，旧实现留下的装配结论不再适用。
  issues.delete(id);
  if (!activeId) activeId = id;
  return entry;
}

/** 注销单个平台（测试与注册表自清理用）。 */
export function unregisterAgentPlatform(id) {
  const key = normalizeId(id);
  const existed = platforms.delete(key);
  issues.delete(key);
  if (activeId === key) activeId = platforms.keys().next().value ?? '';
  return existed;
}

/**
 * 按 owner 批量注销（插件卸载 / 停用 / 重载）。
 *
 * 拒绝注销**正在使用**的平台：会话落盘里的 `agentRef.instance` 指着它，换执行体要重启，
 * 运行期悄悄换掉只会让「谁在跑这个会话」变成猜谜。抛错由内核转成一条日志。
 *
 * @returns {object[]} 被移除的条目
 */
export function unregisterAgentPlatformsByOwner(owner) {
  const ownerName = String(owner ?? '').trim();
  if (!ownerName || ownerName === BUILTIN_OWNER) {
    throw new Error('unregisterAgentPlatformsByOwner: 不能按 owner 批量注销内置平台');
  }
  const entries = [...platforms.values()].filter((impl) => impl.owner === ownerName);
  if (entries.some((impl) => impl.id === activeId)) {
    throw new Error(`Agent 平台 ${activeId} 正在作为当前执行体使用；换执行体要重启桥接，不能随插件一起卸载`);
  }
  for (const impl of entries) {
    platforms.delete(impl.id);
    issues.delete(impl.id);
  }
  return entries;
}

/** 清空注册表（测试用）。 */
export function resetAgentPlatforms() {
  platforms.clear();
  issues.clear();
  activeId = '';
}

/** 记一条装配结论（同一 code 只留最新一条，避免每次重试都堆一份）。 */
export function noteAgentPlatformIssue(id, { code, message } = {}) {
  const key = normalizeId(id);
  const issueCode = String(code ?? '').trim();
  if (!key || !issueCode) return;
  const list = (issues.get(key) ?? []).filter((item) => item.code !== issueCode);
  list.push({ code: issueCode, message: String(message ?? '').trim() || issueCode });
  issues.set(key, list);
}

/** 装配成功时清空结论（恢复后不该继续报旧账）。 */
export function clearAgentPlatformIssues(id) {
  issues.delete(normalizeId(id));
}

/** 某平台的装配结论（控制台诊断用；没有时返回空数组）。 */
export function agentPlatformIssues(id) {
  return [...(issues.get(normalizeId(id)) ?? [])];
}

/** 指定当前平台；传空串只读取当前值。 */
export function useAgentPlatform(id) {
  const key = normalizeId(id);
  if (key) {
    if (!platforms.has(key)) throw new Error(`Agent 平台未注册：${key}`);
    activeId = key;
  }
  return activeId;
}

export function activeAgentPlatformId() {
  return activeId;
}

/** 取平台实现；未注册返回 null。 */
export function agentPlatform(id = '') {
  return platforms.get(normalizeId(id) || activeId) ?? null;
}

/** 取平台实现；未注册抛错（调用方通常希望 fail-closed）。 */
export function requireAgentPlatform(id = '') {
  const key = normalizeId(id) || activeId;
  const impl = platforms.get(key);
  if (!impl) throw new Error(`Agent 平台未注册：${key || '(空)'}；检查 src/agent-side/builtin.mjs 与已启用的插件`);
  return impl;
}

/** 控制台 / 健康检查用：所有已注册平台的静态描述（含 owner、来源与装配结论）。 */
export function listAgentPlatforms() {
  return [...platforms.values()].map((impl) => ({
    id: impl.id,
    label: impl.label ?? impl.id,
    capabilities: [...(impl.capabilities ?? [])],
    // 能力档的生效方式、提示注入通道与对端权限档取值域：都是「这个执行体认领什么」
    // 的声明面，控制台的平台详情与能力位矩阵直接读这里，不再从 port 上现问。
    applies: agentPlatformApplies(impl.id),
    promptChannels: agentPlatformPromptChannels(impl.id),
    peerPermissions: agentPlatformPeerPermissions(impl.id),
    // 插件平台的配置模型：控制台要靠它画表单，统一注册表要靠它校 `platforms.agents.<id>`。
    // 内置平台的这一项来自 profiles 目录（agent-platform.yml），不从实现上取。
    configSchema: impl.configSchema ?? null,
    // 模型目录：平台自己声明有哪些模型、怎么计费、能压到多少（只读元数据，与 configSchema 两套语义）。
    modelCatalog: impl.modelCatalog ?? null,
    owner: impl.owner,
    source: impl.source,
    issues: agentPlatformIssues(impl.id),
  }));
}

/**
 * 插件内核透传的注册表依赖（与 `transportRegistry` 同形：一个对象，不是一组函数）。
 *
 * 为什么 owner 只在这里出现：插件拿到的 `ctx.agentPlatforms` 只负责「登记/列出」，
 * 「谁能覆盖谁」「卸载时怎么清」是内核的判断，插件无法绕过 registerAgentPlatform 的校验。
 */
export const agentProviderRegistry = Object.freeze({
  register: (definition, owner) => registerAgentPlatform(definition, { owner }),
  unregisterByOwner: (owner) => unregisterAgentPlatformsByOwner(owner),
  list: () => listAgentPlatforms(),
  get: (id) => agentPlatform(id),
});

// ── 转发查询 ────────────────────────────────────────────────────────────────

export function permissionCommandSucceeded(result, wanted, ctx = {}) {
  const impl = requireAgentPlatform(ctx.agentPlatform);
  return typeof impl.permissionCommandSucceeded === 'function'
    ? impl.permissionCommandSucceeded(result, wanted)
    : false;
}

/** 旧 preset 名归一（未注册平台时原样返回，不阻断读取）。 */
export function normalizeAgentPreset(name, ctx = {}) {
  const impl = agentPlatform(ctx.agentPlatform);
  return typeof impl?.normalizeAgentPreset === 'function' ? impl.normalizeAgentPreset(name) : String(name ?? '').trim();
}

/** 全部受管 preset id（构建期与静态校验用）。 */
export function agentPresetIds(ctx = {}) {
  const impl = requireAgentPlatform(ctx.agentPlatform);
  return [...(impl.AGENT_PRESET_IDS ?? [])];
}

/**
 * 该平台认领哪些生效方式（能力档 `runtime.apply` 的取值）。
 *
 * 认领 `passthrough` 的平台能把会话直接交给自己的原生 agent：不装预设、不建沙箱。
 * 未声明时按 `preset` 处理——只会装预设的平台不需要额外声明。
 */
export function agentPlatformApplies(id = '', ctx = {}) {
  const impl = agentPlatform(id || ctx.agentPlatform);
  const declared = impl?.RUNTIME_APPLY;
  const values = Array.isArray(declared) ? declared.filter((value) => typeof value === 'string' && value.trim()) : [];
  return values.length ? values : ['preset'];
}

/**
 * 该平台声明的对端权限档取值域（能力档 `runtime.peerPermission` 的可选值）。
 *
 * 返回空数组 = 「由对端自己决定」：ACP 这类平台没有静态模式表，可选值只能建立会话后
 * 现读。桥接不会因此放宽校验 —— 写入前仍要按实时清单核对一次。
 */
export function agentPlatformPeerPermissions(id = '', ctx = {}) {
  const declared = agentPlatform(id || ctx.agentPlatform)?.PEER_PERMISSIONS;
  return Array.isArray(declared) ? declared.map(String).filter(Boolean) : [];
}

/**
 * 该平台认领哪些提示注入通道（能力档 `runtime.prompt` 的取值）。
 *
 * 未声明时只给 `tool`：没有注入通道的执行体只能靠 `qq_get_prompt` 拉取提示词，
 * 这是直通模式下唯一不会说谎的兜底。
 */
export function agentPlatformPromptChannels(id = '', ctx = {}) {
  const impl = agentPlatform(id || ctx.agentPlatform);
  const declared = impl?.RUNTIME_PROMPT;
  const values = Array.isArray(declared) ? declared.filter((value) => typeof value === 'string' && value.trim()) : [];
  return values.length ? values : ['tool'];
}
