// 平台统一注册表：把「平台」的四个来源合成一张表 + 一组诊断。
//
// 为什么要有这一层：同一个平台在系统里有四份描述，各自回答不同问题，但控制台和
// 运维只想知道「我接了哪些平台、能不能用、哪里坏了」：
//
//   A  配置面 · 用户侧    profiles/platforms/<id>/          话术、工具表、行为档案
//   B  配置面 · Agent 侧  profiles/agent-platforms/<id>/    能力档、preset 源、产物适配器
//   C  运行期 · 用户侧    src/user-side/runtime-registry    内置 + 插件 transport（谁能发）
//   D  运行期 · Agent 侧  src/agent-side/runtime-registry   内置 Agent 平台（谁能跑）
//
// 合并点放在这里而不是前端：让前端拼三份列表，必然出现「配置面有、运行期没有」这种
// 只在一侧可见的状态，用户无法判断哪个是真的。注册表把这类差异变成**诊断码**，
// 于是「有配置目录但没实现」不再是靠人去比对，而是一条 `profile_only` 警告。
//
// 两条实现约束：
//   · `buildPlatformRegistry()` 是纯函数（输入全是普通对象），可以离线测；
//   · `platformRegistrySnapshot()` 只负责取运行期事实与磁盘目录，不含判断逻辑。
// 这样 `test-platform-registry` 不用起进程就能覆盖全部诊断分支。

import { listAgentPlatformDirs, listPlatforms, readPlatformTools } from './index.mjs';
import { agentPlatformMetadata } from '../agent-side/metadata.mjs';
import { userPlatformMetadata } from '../user-side/metadata.mjs';
import { applyPluginConfig, normalizeConfigSchema } from '../plugins/config-schema.mjs';
// 配置 v2 的段内结构（transport/options/endpoint）不该泄露给前端：注册表对外只给扁平值。
import { flatPlatforms } from '../config/platforms.mjs';
import { AGENT_PLATFORMS_ROOT, PLATFORMS_ROOT } from '../profiles/paths.mjs';

/**
 * 诊断码。分级只有两档：
 *   error —— 这个平台现在就不能按预期工作（用了会出错，或配置指向不存在的东西）；
 *   warn  —— 能用，但有一块能力是缺的（能发不能收、配置改了不生效）。
 * 不设 info：控制台没有地方消费「只是提示」的消息，加了就变成噪音。
 */
export const DIAGNOSTIC_CODES = Object.freeze({
  CAPABILITY_MISSING: 'capability_missing',
  CONFIG_INVALID: 'config_invalid',
  ACTIVE_UNREGISTERED: 'active_unregistered',
  // 配置面与运行期已选的不一致：刚改过默认平台，重启后才会装配新的那个。
  ACTIVE_PENDING_RESTART: 'active_pending_restart',
  INBOUND_UNSUPPORTED: 'inbound_unsupported',
  PROFILE_ONLY: 'profile_only',
  // `profile_only` 的镜像：配置里有这条实例，但既没有声明目录也没有运行期实现。
  CONFIG_ONLY: 'config_only',
  PROBE_FAILED: 'probe_failed',
  ID_CONFLICT: 'id_conflict',
  // Agent 侧的三条装配结论，由 src/agent-side/runtime-registry.mjs 记账：
  // 声明的能力做不到（port 装配失败）、实现不符合契约、此刻连不上。
  CAPABILITY_OVERCLAIMED: 'capability_overclaimed',
  AGENT_PROVIDER_INVALID: 'agent_provider_invalid',
  AGENT_INSTANCE_OFFLINE: 'agent_instance_offline',
});

const DIAGNOSTIC_LEVELS = Object.freeze({
  [DIAGNOSTIC_CODES.CAPABILITY_MISSING]: 'error',
  [DIAGNOSTIC_CODES.CONFIG_INVALID]: 'error',
  [DIAGNOSTIC_CODES.ACTIVE_UNREGISTERED]: 'error',
  [DIAGNOSTIC_CODES.ID_CONFLICT]: 'error',
  [DIAGNOSTIC_CODES.CAPABILITY_OVERCLAIMED]: 'error',
  [DIAGNOSTIC_CODES.AGENT_PROVIDER_INVALID]: 'error',
  [DIAGNOSTIC_CODES.INBOUND_UNSUPPORTED]: 'warn',
  [DIAGNOSTIC_CODES.PROFILE_ONLY]: 'warn',
  [DIAGNOSTIC_CODES.CONFIG_ONLY]: 'warn',
  [DIAGNOSTIC_CODES.PROBE_FAILED]: 'warn',
  [DIAGNOSTIC_CODES.AGENT_INSTANCE_OFFLINE]: 'warn',
  [DIAGNOSTIC_CODES.ACTIVE_PENDING_RESTART]: 'warn',
});

export const PLATFORM_SIDES = Object.freeze(['user', 'agent']);

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

function diagnostic(code, side, platformId, message) {
  return { code, side, platformId, level: DIAGNOSTIC_LEVELS[code] ?? 'warn', message };
}

/**
 * 配置面校验：没有 schema 时不判（返回 null schema），有 schema 时按插件那套规则查。
 *
 * 写口（`PATCH .../config`）与注册表的 `config_invalid` 诊断必须用同一个函数：
 * 控制台接受的值和诊断拒绝的值不能是两套规则，否则「保存成功但带一条错误诊断」。
 */
export function vetPlatformConfig(rawSchema, value) {
  const normalized = normalizeConfigSchema(rawSchema);
  if (!normalized.ok) {
    return { schema: null, error: `configSchema 不合法：${normalized.errors.join('；')}` };
  }
  if (!normalized.schema) return { schema: null, error: '' };
  const applied = applyPluginConfig(normalized.schema, value);
  return { schema: normalized.schema, error: applied.ok ? '' : applied.errors.join('；') };
}

/**
 * 合成用户侧平台。
 *
 * 顺序：配置面先出（磁盘上有什么就是什么），运行期里多出来的（插件注册、没有配置
 * 目录的平台）追加在后，最后是「只在 platforms.users 里」的条目。这样控制台的列表在
 * 平台没启用时也不会空，且顺序稳定。
 *
 * 用户侧每一条 = 一个**实例**（平台 + 账号）：`enabled` / `inboundState` / `outbound`
 * 都按条目算，于是「这条连上没有」「这条发消息会走谁」在同一个位置就能回答。
 */
function buildUserEntries({ profilePlatforms, runtime, config, inbound = {} }) {
  const entries = [];
  const diagnostics = [];
  const live = new Map();
  const stateOf = (id) => inbound?.[id] ?? null;
  const enabledOf = (id) => config?.users?.[id]?.enabled !== false;
  // 条目开关已经单独给 `entry.enabled`，配置面（`entry.config`）只留平台选项面：
  // 写口拿它与补丁合并后校 schema，多一个平台不认识的键会让严格 schema 拒掉整次保存。
  const configOf = (id) => {
    const flat = clone(config?.users?.[id] ?? {}) ?? {};
    delete flat.enabled;
    return flat;
  };
  // 出站解析与 src/user-side/outbound.mjs 同序：插件 transport 优先，其次适配器。
  // 两者不会同 id（注册那一刻就拒绝了冲突），所以来源就等于「谁在发」。
  const outboundOf = (impl) => (impl
    ? { via: String(impl.source ?? '') === 'plugin' ? 'transport' : 'adapter', owner: impl.owner ?? null }
    : { via: 'none', owner: null });
  for (const item of runtime.platforms ?? []) {
    const id = String(item?.id ?? '').trim();
    if (!id) continue;
    if (live.has(id)) {
      diagnostics.push(diagnostic(DIAGNOSTIC_CODES.ID_CONFLICT, 'user', id, `同一平台被注册了两次（${live.get(id).source} 与 ${item.source ?? 'unknown'}）`));
      continue;
    }
    live.set(id, item);
  }

  const seen = new Set();
  for (const profile of profilePlatforms ?? []) {
    const id = String(profile?.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const impl = live.get(id) ?? null;
    const { schema, error } = vetPlatformConfig(profile.configSchema, config?.users?.[id] ?? {});
    if (error) {
      diagnostics.push(diagnostic(DIAGNOSTIC_CODES.CONFIG_INVALID, 'user', id, error));
    }
    if (!impl) {
      diagnostics.push(diagnostic(
        DIAGNOSTIC_CODES.PROFILE_ONLY,
        'user',
        id,
        `有配置目录（${profile.source ?? `profiles/platforms/${id}`}），但没有运行期实现：在这里改的配置不会生效`,
      ));
    } else if (impl.inbound !== true) {
      diagnostics.push(diagnostic(
        DIAGNOSTIC_CODES.INBOUND_UNSUPPORTED,
        'user',
        id,
        '平台未提供 connect()：只能发不能收（入站消息不会进入准入与唤醒流程）',
      ));
    }
    entries.push({
      side: 'user',
      id,
      label: String(impl?.label ?? profile.label ?? id),
      note: '',
      source: impl ? String(impl.source ?? 'builtin') : 'profile-only',
      owner: impl?.owner ?? null,
      active: String(runtime.active ?? '') === id,
      // 配置面选的默认平台 = 重启后会装配的那个；`active` 是**本进程实际装配的**。
      // 两者不一致就是「刚改过、还没重启」，控制台据此显示这一状态。
      configured: String(config?.active?.user ?? '') === id,
      // 条目级开关：停用的实例照样在这里列出（能改回去），但不会装配。
      enabled: enabledOf(id),
      capabilities: [...(impl?.capabilities ?? [])],
      conversationTypes: [...(impl?.conversationTypes ?? [])],
      limits: { ...(impl?.limits ?? {}) },
      inbound: impl ? impl.inbound === true : false,
      // 入站事件里能不能带业务体认识的报文（见 src/user-side/inbound.mjs 的 deliver 契约）。
      rawEvent: impl?.rawEvent === true,
      // 这条实例此刻的入站结论：`open` / `closed` / `error` / `disabled` / `send-only` /
      // `unregistered`，null = 没装配过（进程刚起来还没走到装配那一步）。
      inboundState: stateOf(id),
      outbound: outboundOf(impl),
      configSchema: schema,
      config: configOf(id),
      assets: {
        prompt: {
          active: Boolean(profile?.prompt?.active),
          hasDefault: Boolean(profile?.prompt?.hasDefault),
        },
        tools: clone(profile?.tools ?? []),
        behaviors: [...(profile?.behaviors ?? [])],
        capabilityProfiles: [],
      },
    });
  }

  // 运行期注册了、但没有配置目录的平台（插件 transport 的常态）。
  for (const [id, impl] of live) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (impl.inbound !== true) {
      diagnostics.push(diagnostic(
        DIAGNOSTIC_CODES.INBOUND_UNSUPPORTED,
        'user',
        id,
        '平台未提供 connect()：只能发不能收（入站消息不会进入准入与唤醒流程）',
      ));
    }
    entries.push({
      side: 'user',
      id,
      label: String(impl.label ?? id),
      note: '',
      source: String(impl.source ?? 'plugin'),
      owner: impl.owner ?? null,
      active: String(runtime.active ?? '') === id,
      configured: String(config?.active?.user ?? '') === id,
      enabled: enabledOf(id),
      capabilities: [...(impl.capabilities ?? [])],
      conversationTypes: [...(impl.conversationTypes ?? [])],
      limits: { ...(impl.limits ?? {}) },
      inbound: impl.inbound === true,
      rawEvent: impl.rawEvent === true,
      inboundState: stateOf(id),
      outbound: outboundOf(impl),
      configSchema: null,
      config: {},
      assets: { prompt: { active: false, hasDefault: false }, tools: [], behaviors: [], capabilityProfiles: [] },
    });
  }

  // 只在配置里存在的实例（手写 config.json、或插件卸了而条目还在）：必须仍然可见，
  // 否则控制台既看不到它、也改不了它，而启动时它会被装配并报一句“未注册”。
  for (const id of Object.keys(config?.users ?? {}).sort()) {
    if (seen.has(id)) continue;
    diagnostics.push(diagnostic(
      DIAGNOSTIC_CODES.CONFIG_ONLY,
      'user',
      id,
      '配置里有这条实例，但没有声明目录也没有运行期实现：这条不会被装配（装好它或删掉这条）',
    ));
    entries.push({
      side: 'user',
      id,
      label: id,
      note: '',
      source: 'config-only',
      owner: null,
      active: String(runtime.active ?? '') === id,
      configured: String(config?.active?.user ?? '') === id,
      enabled: enabledOf(id),
      capabilities: [],
      conversationTypes: [],
      limits: {},
      inbound: false,
      rawEvent: false,
      inboundState: stateOf(id),
      outbound: outboundOf(null),
      configSchema: null,
      config: configOf(id),
      assets: { prompt: { active: false, hasDefault: false }, tools: [], behaviors: [], capabilityProfiles: [] },
    });
  }

  return { entries, diagnostics };
}

/** 合成 Agent 侧平台。结构与用户侧同形，差异在 `assets`（能力档而不是行为档案）与 `probe`。 */
function buildAgentEntries({ profilePlatforms, runtime, config, probes }) {
  const probeOf = (id) => probes?.[id] ?? null;
  const entries = [];
  const diagnostics = [];
  const live = new Map();
  for (const item of runtime.platforms ?? []) {
    const id = String(item?.id ?? '').trim();
    if (!id) continue;
    if (live.has(id)) {
      diagnostics.push(diagnostic(DIAGNOSTIC_CODES.ID_CONFLICT, 'agent', id, '同一 Agent 平台被注册了两次'));
      continue;
    }
    live.set(id, item);
    // 装配结论是注册表记的账（自证失败 / 契约不合规 / 实例建不起来），逐条转成诊断：
    // 它们描述的是「这个平台本身有问题」，与下文的配置 / 目录类诊断互不影响。
    for (const issue of item.issues ?? []) {
      diagnostics.push(diagnostic(issue.code, 'agent', id, issue.message));
    }
  }

  const seen = new Set();
  for (const profile of profilePlatforms ?? []) {
    const id = String(profile?.id ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const impl = live.get(id) ?? null;
    const { schema, error } = vetPlatformConfig(profile.configSchema, config?.agents?.[id] ?? {});
    if (error) {
      diagnostics.push(diagnostic(DIAGNOSTIC_CODES.CONFIG_INVALID, 'agent', id, error));
    }
    if (!impl) {
      diagnostics.push(diagnostic(
        DIAGNOSTIC_CODES.PROFILE_ONLY,
        'agent',
        id,
        `有声明目录（${profile.source ?? `profiles/agent-platforms/${id}`}），但没有装配进内核：src/agent-side/builtin.mjs 与已启用的插件都没注册它`,
      ));
    }
    entries.push({
      side: 'agent',
      id,
      label: String(impl?.label ?? profile.label ?? id),
      note: '',
      source: impl ? String(impl.source ?? 'builtin') : 'profile-only',
      owner: impl?.owner ?? null,
      active: String(runtime.active ?? '') === id,
      configured: String(config?.active?.agent ?? '') === id,
      capabilities: [...(impl?.capabilities ?? [])],
      conversationTypes: [],
      limits: {},
      inbound: false,
      configSchema: schema,
      config: clone(config?.agents?.[id] ?? {}),
      // 最近一次显式探活（控制台按钮 / 切换预检）的结论；null = 没探过。
      // 与 `agentConnected` 分工不同：后者是后台轮询的「现在能不能用」，这里只回答「刚才探了一次」。
      probe: probeOf(id),
      assets: {
        prompt: { active: false, hasDefault: false },
        tools: [],
        behaviors: [],
        // C4 起 preset 与能力档同名同文件（capabilities/<id>.yml 的 preset + rows），
        // 不再有平行的 agents/ 目录，也不再另给一份 agentPresets —— 能力档列表就是预设列表。
        capabilityProfiles: [...(profile?.capabilities ?? [])],
      },
    });
  }

  // 运行期注册了、但没有声明目录的平台（插件 Agent 平台的常态）：配置模型来自实现本身，
  // 校验规则与声明面同一套（同一个 `platforms.agents.<id>`）。
  for (const [id, impl] of live) {
    if (seen.has(id)) continue;
    const { schema, error } = vetPlatformConfig(impl.configSchema, config?.agents?.[id] ?? {});
    if (error) {
      diagnostics.push(diagnostic(DIAGNOSTIC_CODES.CONFIG_INVALID, 'agent', id, error));
    }
    entries.push({
      side: 'agent',
      id,
      label: String(impl.label ?? id),
      note: '',
      source: String(impl.source ?? 'builtin'),
      owner: impl.owner ?? null,
      active: String(runtime.active ?? '') === id,
      configured: String(config?.active?.agent ?? '') === id,
      capabilities: [...(impl.capabilities ?? [])],
      conversationTypes: [],
      limits: {},
      inbound: false,
      configSchema: schema,
      config: clone(config?.agents?.[id] ?? {}),
      probe: probeOf(id),
      assets: { prompt: { active: false, hasDefault: false }, tools: [], behaviors: [], capabilityProfiles: [] },
    });
  }

  return { entries, diagnostics };
}

function summarize(entries, diagnostics) {
  const bySide = { user: 0, agent: 0 };
  for (const entry of entries) bySide[entry.side] += 1;
  return {
    total: entries.length,
    user: bySide.user,
    agent: bySide.agent,
    errors: diagnostics.filter((item) => item.level === 'error').length,
    warnings: diagnostics.filter((item) => item.level === 'warn').length,
  };
}

/**
 * 合成一张表。
 *
 * @param {object} input
 * @param {Array} [input.profilePlatforms]      `listPlatforms()` 的结果（补齐 tools）
 * @param {Array} [input.profileAgentPlatforms] `listAgentPlatformDirs()` 的结果
 * @param {{active: string, platforms: Array}} [input.userRuntime]  `userPlatformMetadata()`
 * @param {{active: string, platforms: Array}} [input.agentRuntime] `agentPlatformMetadata()`
 * @param {{users?: object, agents?: object}} [input.config]        配置面（C2 起为配置 v2 的 platforms 段）
 * @param {object} [input.userInbound]                              各用户实例的入站结论（按实例 id 索引）
 * @param {boolean|null} [input.agentConnected]                     当前执行体的探活结论；null = 还不知道
 * @param {object} [input.agentProbes]                              各 Agent 平台最近一次显式探活的结果（按 id 索引）
 */
export function buildPlatformRegistry({
  profilePlatforms = [],
  profileAgentPlatforms = [],
  userRuntime = { active: '', platforms: [] },
  agentRuntime = { active: '', platforms: [] },
  config = {},
  userInbound = {},
  agentConnected = null,
  agentProbes = {},
} = {}) {
  const user = buildUserEntries({ profilePlatforms, runtime: userRuntime, config, inbound: userInbound });
  const agent = buildAgentEntries({ profilePlatforms: profileAgentPlatforms, runtime: agentRuntime, config, probes: agentProbes });
  const entries = [...user.entries, ...agent.entries];
  const diagnostics = [...user.diagnostics, ...agent.diagnostics];

  // 「当前平台」指向一个谁都不认识的名字：启动时 useUserPlatform 就会抛错，
  // 但配置文件被手改时进程可能还没走到那一步，所以这里补一条能看见的错。
  // 只有配置、没有实现的条目不算「认识」：它确实装不上，不该把这条错降成警告。
  for (const side of PLATFORM_SIDES) {
    const active = String((side === 'user' ? userRuntime : agentRuntime).active ?? '').trim();
    if (!active) continue;
    if (entries.some((entry) => entry.side === side && entry.id === active && entry.source !== 'config-only')) continue;
    diagnostics.push(diagnostic(
      DIAGNOSTIC_CODES.ACTIVE_UNREGISTERED,
      side,
      active,
      `当前平台指向未注册的 id：${active}（能用这一侧的平台：${entries.filter((entry) => entry.side === side).map((entry) => entry.id).join(' / ') || '无'}）`,
    ));
  }

  // 配置面写的默认平台与本进程实际装配的不一致：刚改过、还没重启。这不是错误 ——
  // 下次启动就一致了 —— 但必须看得见：否则控制台会一边说「已设为默认」一边说「未启用」。
  for (const side of PLATFORM_SIDES) {
    const wanted = String(config?.active?.[side] ?? '').trim();
    const running = String((side === 'user' ? userRuntime : agentRuntime).active ?? '').trim();
    if (!wanted || !running || wanted === running) continue;
    diagnostics.push(diagnostic(
      DIAGNOSTIC_CODES.ACTIVE_PENDING_RESTART,
      side,
      wanted,
      `配置已把默认平台改为 ${wanted}，本进程仍装配 ${running}：重启桥接后生效`,
    ));
  }

  // 当前执行体在注册表里、但桥接报它没连上：进程在而连接不在，是最容易被误判成
  // 「配置错了」的一类故障，所以单独给一条诊断。未知（null）不判 —— 启动早期的探活
  // 结果还没出来时，把「还没探」报告成「不可用」只会制造噪音。
  if (agentConnected === false) {
    const active = String(agentRuntime.active ?? '').trim();
    if (active && entries.some((entry) => entry.side === 'agent' && entry.id === active)) {
      diagnostics.push(diagnostic(
        DIAGNOSTIC_CODES.AGENT_INSTANCE_OFFLINE,
        'agent',
        active,
        '当前执行体探活未通过：桥接进程还在，但对端没响应（消息会入队等待，不会丢）',
      ));
    }
  }

  return {
    ok: true,
    active: {
      user: String(userRuntime.active ?? ''),
      agent: String(agentRuntime.active ?? ''),
    },
    platforms: entries,
    diagnostics,
    summary: summarize(entries, diagnostics),
  };
}

/**
 * 取当前进程的真实快照。
 *
 * 两个 root 可注入是为了测试与离线夹具；默认值与运行时一致。
 * `config` 接受配置 v2 的 `platforms` 段（也可直接传扁平形状）；内部统一扁平化后再校 schema。
 */
export function platformRegistrySnapshot({
  profilesRoot = PLATFORMS_ROOT,
  agentPlatformsRoot = AGENT_PLATFORMS_ROOT,
  config = {},
  userInbound = {},
  agentConnected = null,
  agentProbes = {},
} = {}) {
  const profilePlatforms = listPlatforms({ root: profilesRoot }).map((item) => ({
    ...item,
    tools: readPlatformTools({ root: profilesRoot, id: item.id }),
  }));
  return buildPlatformRegistry({
    profilePlatforms,
    profileAgentPlatforms: listAgentPlatformDirs({ root: agentPlatformsRoot }),
    userRuntime: userPlatformMetadata(),
    agentRuntime: agentPlatformMetadata(),
    config: flatPlatforms(config),
    userInbound,
    agentConnected,
    agentProbes,
  });
}

/** 单个平台（控制台详情页用）；未找到返回 null。 */
export function findRegistryPlatform(snapshot, side, id) {
  const wanted = String(id ?? '').trim();
  if (!wanted || !PLATFORM_SIDES.includes(side)) return null;
  return (snapshot?.platforms ?? []).find((entry) => entry.side === side && entry.id === wanted) ?? null;
}

/** 该平台的诊断（详情页顶部用）。 */
export function platformDiagnostics(snapshot, side, id) {
  return (snapshot?.diagnostics ?? []).filter((item) => item.side === side && item.platformId === id);
}
