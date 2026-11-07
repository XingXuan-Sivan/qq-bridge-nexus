/**
 * 定时任务「主动未授权」跳过的创建者通知。
 *
 * 只负责判定与文案；按任务/日期去重由 scheduler.noteSkipNotice 负责，
 * 发私聊由 bridge 负责，这样规则可以在不启动桥接的情况下单测。
 */

const DENIED_RE = /未授权主动行为/;

const safeName = (name) => String(name ?? '').trim().slice(0, 40) || '未命名任务';

/**
 * @param {{ task: object, outcomes: Array<{target:string,status:string,reason?:string}>, manual?: boolean }} input
 * @returns {{ targets: string[], text: string } | null}
 */
export function buildSkipNotice({ task, outcomes, manual = false } = {}) {
  if (manual || !task || !Array.isArray(outcomes)) return null;
  const denied = outcomes.filter((o) => o && o.status === 'skipped' && DENIED_RE.test(String(o.reason ?? '')));
  if (!denied.length) return null;
  const targets = [...new Set(denied.map((o) => String(o.target ?? '').trim()).filter((t) => t && t !== '*'))];
  const who = targets.length ? targets.join('、') : '目标会话';
  return {
    targets,
    text: `⏰ 定时任务 #${task.id}「${safeName(task.name)}」因「${who} 未授权主动行为」跳过。\n`
      + '放行后下一次到点会继续投递；同一任务当天不再重复提醒。\n'
      + '改法：控制台 → 会话与审批 → 该会话「管理」→ 准入 → 主动。',
  };
}
