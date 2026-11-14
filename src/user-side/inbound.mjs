// 统一入站管线（docs/PLATFORM_UNIFICATION.md §六，C3）。
//
// 顺序不可交换，而且只能有**这一份**实现：
//
//   厂商报文 → （transport 的 connect/onEvent 翻译）
//            → validateUnifiedEvent(raw, origin)   ← 校验并补全来源
//            → 准入                                ← 按会话判断放不放
//            → 会话映射                            ← 得出规范 key
//            → 唤醒（deliver）
//
// 为什么校验必须排在准入之前：准入要读按会话记账的状态（模式、静默档、黑话库、
// 人物关系）。半成品事件带着伪造的 conversation 进到准入的入参里，等于让插件
// 用一条畸形事件去探「这个会话存不存在、属于谁」。先校验，畸形的直接丢。
//
// 本文件不读配置、不碰网络、不写日志：策略与副作用全部由调用方以函数注入，
// 于是它在 bridge 里跑真链路，在 scripts/test-unified-inbound.mjs 里离线跑。

import { validateUnifiedEvent } from './event.mjs';

/** 丢弃原因（审计与日志用；只带原因码，不带正文）。 */
export const INBOUND_DROP = Object.freeze({
  INVALID: 'invalid',
  NOT_ADMITTED: 'not_admitted',
  UNRESOLVED: 'conversation_unresolved',
  DELIVER_FAILED: 'deliver_failed',
});

function text(value, max = 64) {
  return String(value ?? '').trim().toLowerCase().slice(0, max);
}

/**
 * 建一条入站管线。一条管线 = 一个平台实例（平台 + 账号），来源由内核给定。
 *
 * @param {object} options
 * @param {{platform: string, account?: string}} options.origin 内核认定的来源（必填）
 * @param {(event: object) => boolean|Promise<boolean>} options.admit 准入；抛错按拒绝处理（fail-closed）
 * @param {(event: object) => ({key: string, type: string, id: string}|null)} options.resolve 会话映射
 * @param {(payload: {event: object, address: object, key: string}) => unknown} options.deliver 唤醒
 * @param {(drop: {reason: string, errors: string[]}) => void} [options.onDrop] 丢弃审计
 */
export function createInboundPipeline({ origin, admit, resolve, deliver, onDrop } = {}) {
  const platform = text(origin?.platform);
  const account = text(origin?.account);
  // 来源由内核给，缺了就是装配错误：没有 platform 的事件无法判断该落进哪条准入规则。
  if (!platform) throw new Error('入站管线必须知道来源平台（origin.platform）');
  // 三个策略都必须显式给：默认放行/默认映射会让「忘了接」变成静默可用。
  if (typeof admit !== 'function') throw new Error('入站管线缺少准入函数 admit(event)');
  if (typeof resolve !== 'function') throw new Error('入站管线缺少会话映射函数 resolve(event)');
  if (typeof deliver !== 'function') throw new Error('入站管线缺少唤醒函数 deliver(payload)');

  function drop(reason, errors = []) {
    try {
      onDrop?.({ reason, errors });
    } catch {
      // 审计自己出错不能把入站链路带崩：事件已经确定要丢了。
    }
    return { ok: false, reason, errors };
  }

  /**
   * 把一条**未校验**的原始事件送进管线。
   *
   * 永不抛错：所有异常都变成 `{ok:false, reason}`，调用方（WS 回调、插件钩子）
   * 不需要包 try/catch —— 一条坏事件不该终结整条连接。
   */
  async function emit(raw) {
    // 1) 校验：platform/account 一律取内核的 origin，插件写什么都覆盖掉。
    const checked = validateUnifiedEvent(raw, { platform, account });
    if (!checked.ok) return drop(INBOUND_DROP.INVALID, checked.errors);
    const { event } = checked;

    // 2) 准入：抛错 = 拒绝（fail-closed），不猜「大概是允许的」。
    let admitted;
    try {
      admitted = await admit(event);
    } catch (error) {
      return drop(INBOUND_DROP.NOT_ADMITTED, [String(error?.message ?? error)]);
    }
    if (!admitted) return drop(INBOUND_DROP.NOT_ADMITTED);

    // 3) 会话映射：拿不到 key 就没有「哪个会话」可言，后面全是按 key 记账。
    let target;
    try {
      target = resolve(event);
    } catch (error) {
      return drop(INBOUND_DROP.UNRESOLVED, [String(error?.message ?? error)]);
    }
    const key = String(target?.key ?? '').trim();
    const type = text(target?.type, 32);
    const id = target?.id === null || target?.id === undefined ? '' : String(target.id).trim();
    if (!key || !type || !id) return drop(INBOUND_DROP.UNRESOLVED, ['会话映射缺少 key/type/id']);

    // 4) 唤醒：地址由管线拼好，唤醒侧不再自己拼（少一处能拼错的平台名/账号）。
    const address = { platform, account, conversation: { type, id } };
    try {
      await deliver({ event, address, key });
    } catch (error) {
      return drop(INBOUND_DROP.DELIVER_FAILED, [String(error?.message ?? error)]);
    }

    return { ok: true, key, address, event };
  }

  return { platform, account, emit };
}
