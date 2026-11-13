// 用户侧平台元数据（控制台 / 健康检查的唯一数据源，B7）。
//
// 两个来源合成一张表：
//   · 内置平台：src/user-side/runtime-registry.mjs，随仓库发布，source=builtin；
//   · 插件平台：src/user-side/transport.mjs，运行期注册，source=plugin 且带 owner。
// 控制台只读这一张表决定「列出哪些平台、每个平台有哪些会话类型、表单上限多少」，
// 于是新增平台不需要改前端，内核里也不会再长出 `if (platform === 'qq')`。
//
// 这里同时提供 resolveSendTarget()：HTTP 发送端点拿到的是「平台 + 会话类型 + id」三件
// 散参数，拼 key 与「这个平台有没有这种会话」的校验都在一处做完 —— 端点只负责取字段
// 与回错误。放在这里而不是端点里，是因为它是纯函数、可以离线测（test-platform-metadata）。

// 装配点必须先求值：注册表本身不会自己填表，内置平台是在 builtin.mjs 的 import 里注册的。
// 少了这一行，metadata 在「调用方尚未 import 门面」时（测试、独立脚本）会看到一张空表，
// 然后把「没有任何平台」当成事实报给控制台。
import './builtin.mjs';
import { activeUserPlatformId, listUserPlatforms, userPlatform } from './runtime-registry.mjs';
import { getTransport, listTransports } from './transport.mjs';
import { formatKey, parseKey, sameConversationType } from '../session/key.mjs';

/** 描述里只放常量：这个对象会原样进 `/api/platforms`。 */
function describePlatform(impl, { source, owner = null, active = false }) {
  return {
    id: impl.id,
    label: impl.label ?? impl.id,
    conversationTypes: [...(impl.conversationTypes ?? [])],
    capabilities: [...(impl.capabilities ?? [])],
    limits: { ...(impl.limits ?? {}) },
    source,
    owner,
    active,
  };
}

/**
 * 全部用户侧平台（内置 + 插件）。
 *
 * 顺序：内置在前（恒存在，控制台的默认选项来自这里），插件在后（随启用/停用变化）。
 * 两者不会同 id —— registerTransport 在注册那一刻就拒绝了与内置平台冲突的 id。
 */
export function userPlatformMetadata() {
  const active = activeUserPlatformId();
  const builtin = listUserPlatforms().map((impl) => describePlatform(impl, {
    source: 'builtin',
    active: impl.id === active,
  }));
  const plugins = listTransports().map((impl) => describePlatform(impl, {
    source: 'plugin',
    owner: impl.owner,
    active: impl.id === active,
  }));
  return { active, platforms: [...builtin, ...plugins] };
}

/** 单个平台的描述；未注册返回 null（内置优先，插件兜底）。 */
export function userPlatformDescriptor(id = '') {
  const key = String(id ?? '').trim().toLowerCase() || activeUserPlatformId();
  const builtin = userPlatform(key);
  const plugin = builtin ? null : getTransport(key);
  const impl = builtin ?? plugin;
  if (!impl) return null;
  return describePlatform(impl, {
    source: builtin ? 'builtin' : 'plugin',
    owner: plugin?.owner ?? null,
    active: key === activeUserPlatformId(),
  });
}

/**
 * 「平台 + 会话类型 + id」→ 规范地址与会话 key。
 *
 * 校验顺序刻意如此：
 *   1. 平台必须已注册。不校验时 formatKey 仍能拼出一个语法合法的 key，消息会带着
 *      一个没有实现负责的平台名进入下游，错误要等排到队尾才以「发送超时」露出；
 *   2. 会话类型必须在该平台声明的列表里（**声明为空时不校验**：插件可以只实现发送，
 *      强迫它为了能被调用而声明一个类型，等于让它编一个）；
 *   3. 最后才拼 key，字符集校验与前导零归一由 formatKey 负责。
 *
 * 抛错信息直接给控制台用（带支持的类型列表），所以不在这里套一层通用错误。
 *
 * @param {{platform?: string, account?: string, type?: string, id?: string|number}} target
 * @returns {{platform: string, account: string, type: string, id: string, key: string}}
 */
export function resolveSendTarget({ platform, account = '', type, id } = {}) {
  const wanted = String(platform ?? '').trim().toLowerCase() || activeUserPlatformId();
  if (!wanted) throw new Error('无法确定用户平台：请求里没有 platform，进程也没有当前平台');
  const descriptor = userPlatformDescriptor(wanted);
  if (!descriptor) throw new Error(`用户平台未注册：${wanted}`);
  const kind = String(type ?? '').trim().toLowerCase();
  if (!kind) throw new Error('缺少会话类型（group / direct / …）');
  const declared = descriptor.conversationTypes;
  if (declared.length && !declared.some((item) => sameConversationType(item, kind))) {
    // `private` / `direct` / `chat` / `dm` 是同一个内核语义（见 key.mjs 的 TYPE_ALIAS），所以平台
    // 只声明其中一个名字时也放行。这里**不能用 shape** 做兜底：平台自有类型（`channel`、
    // `thread`）的 shape 都是 `group`，拿 shape 比等于「声明了 group 就什么类型都放行」。
    throw new Error(`平台 ${wanted} 不支持会话类型 ${kind}（支持：${declared.join(' / ')}）`);
  }
  const text = id === null || id === undefined ? '' : String(id).trim();
  if (!text) throw new Error(`缺少会话 id（${wanted}:${kind}）`);
  const key = formatKey({ platform: wanted, type: kind, id: text, account });
  // 回读规范化结果：formatKey 会去前导零，调用方拿去和状态表比对的必须是同一份 id。
  const parsed = parseKey(key);
  return { platform: parsed.platform, account: parsed.account, type: parsed.type, id: parsed.id, key: parsed.key };
}
