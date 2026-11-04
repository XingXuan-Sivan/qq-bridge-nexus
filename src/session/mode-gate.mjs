/**
 * 会话准入闸门：白名单 + 模式。
 *
 * 为什么单独成文件（P7 第三步）：`modeAllowed` 在 bridge.js 里有 18 处调用
 * （HTTP 路由、唤醒调度、测试消息、定时任务投递、审批…），每一处都是
 * 「这个会话现在能不能碰」的同一套判断。留在 14k 行的 bridge.js 里时，
 * 想验证「群聊在 chat 模式下到底能不能进」只能起整个桥接。
 *
 * 这里保持纯函数：不读全局、不碰配置对象以外的状态，`cfg` 由调用方传入。
 * 行为与原实现逐字一致——搬迁不改语义。
 */

/**
 * 白名单判定。
 *
 * OneBot 事件里的 id 可能是数字也可能是字符串（int64 序列化差异），统一转字符串比较。
 * 配置字段兼容单数（group/private）与复数（groups/privates）两种写法。
 */
export function allowed(kind, id, cfg) {
  const s = String(id);
  const denyList = cfg.deny[kind] ?? cfg.deny[kind + 's'] ?? [];
  if (denyList.map(String).includes(s)) return false;
  const allowList = cfg.allow[kind] ?? cfg.allow[kind + 's'] ?? [];
  if (allowList.length > 0) return allowList.map(String).includes(s);
  return cfg.allowAllWhenEmpty;
}

/** 当前模式是否允许该会话进入 */
export function modeAllowed(key, kind, id, cfg, mode) {
  if (mode === 'closed-agent') {
    // 封闭 agent 模式：仅 owner 私聊
    return key === `private:${String(cfg.ownerQQ ?? '')}`;
  }
  // chat / reserved / reserved2（仿真模式，暂同 chat 白名单）
  return allowed(kind, id, cfg);
}

/**
 * 判断一个会话 key 是否仍被当前模式/白名单允许（供唤醒调度与 HTTP 路由共用）。
 * key 只认 `group:<id>` / `private:<id>`；其它形态一律拒绝。
 */
export function isSessionAllowedInCurrentMode(key, cfg, mode) {
  const m = /^(group|private):(\d+)$/.exec(key);
  if (!m) return false;
  return modeAllowed(key, m[1], Number(m[2]), cfg, mode);
}
