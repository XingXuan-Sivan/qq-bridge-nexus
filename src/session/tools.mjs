// 会话能用的工具：平台声明 ∩ 会话权限级别。
//
// 这张卡回答的是「为什么我刚才让它发表情它没发」：模型侧看到的是 8 个中立工具
// （src/tools/catalog.mjs 的 TOOL_GROUPS），每个工具背后是若干平台 flag；一个 flag
// 能不能调，只由两件事决定 ——
//   1. 平台声明了没有（profiles/platforms/<id>/tools.yml；`defaultOff` 的默认不注册）；
//   2. 当前会话的权限级别允不允许这类风险（LEVEL_ALLOWS）。
// 能力档不参与这个求交：工具面归平台声明，能力档只决定装不装预设、钉不钉对端权限档。
//
// 判定函数只有这一份：控制台读的是这里算好的结果，不在页面里再写一遍「谁能不能用」。
import { TOOL_GROUPS, declaredToolFlags, platformToolAllowedAt } from '../tools/catalog.mjs';
import { permissionText } from './permission.mjs';

const RISK_LABEL = Object.freeze({
  read: '读取', send: '发送', state: '状态', write: '写入', exec: '执行', admin: '管理',
});

/**
 * 一条工具为什么不可用 —— 平台声明在前（那是静态事实），权限收紧在后（那是会话选择）。
 * 两边都不成立时返回空串（可用）。
 */
function unavailableReason(flag, registered, level, risk) {
  if (registered === undefined) return '平台没有声明这项';
  if (registered === false) return '平台声明里默认关闭';
  if (!platformToolAllowedAt(level, flag)) return `权限「${permissionText(level)}」不含${RISK_LABEL[risk] ?? risk}类工具`;
  return '';
}

/**
 * 会话工具卡：`{ total, note, groups }`。
 *
 * - `total` 是可用工具的条数（卡头括号里那个数）；
 * - `note` 写清结论从哪来（平台声明 + 权限级别，再加上当前能力档的名字）；
 * - `groups` 与模型侧 8 个中立工具一一对应，组内再分「可用 / 不可用」，不可用的带原因。
 */
export function sessionToolsCard({ declared = [], level = 'read-only', capability = null, platform = '平台' } = {}) {
  const registered = declaredToolFlags(declared);
  const groups = TOOL_GROUPS.map((group) => {
    const available = [];
    const unavailable = [];
    for (const op of group.ops) {
      const reason = unavailableReason(op.flag, registered[op.flag], level, op.risk);
      const item = { id: op.flag, label: op.label, risk: op.risk, reason };
      if (reason) unavailable.push(item);
      else available.push({ ...item, reason: '' });
    }
    return { id: group.id, label: group.label, available, unavailable };
  });
  const total = groups.reduce((sum, group) => sum + group.available.length, 0);
  const source = [`平台声明（${platform}）`, `权限「${permissionText(level)}」`];
  const note = capability
    ? `来自 ${source.join(' ∩ ')}；能力档 ${capability.label || capability.id} 决定注入方式与沙箱`
    : `来自 ${source.join(' ∩ ')}；没有能力档的会话是纯聊天：工具面照旧，权限恒只读`;
  return { total, level, note, groups };
}
