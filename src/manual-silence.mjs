// 手动静默：由主人手动开启，直到手动恢复（不自动过期）。
//
// 与定时静默（src/silence-schedule.js）分开：
// - 定时静默按时间段自动开始/结束；手动静默是主人显式控制的状态，不会被时间段覆盖。
// - 两者都只决定「AI 是否活动 / 是否发送」，不改变准入名单。
//
// 策略字段：
//   mode: 'full'（完全静默）| 'sendOnly'（只静默发送，AI 仍可被唤醒思考）
//   stages: 哪些环节受静默影响。true = 该环节被静默；false = 该环节照常。
//     passive       被动行为：群/好友消息触发的唤醒与回复
//     proactive     主动行为：主动冒泡、回复检查、潜水超时等
//     scheduledAi   定时任务「叫 AI 来说」
//     scheduledText 定时任务「固定文字」
//     pluginTasks   插件注册的任务类型
//   adminApplies: 管理员是否也受静默影响（owner 始终例外）
//   recordMessages: 静默期间是否记录群消息（不唤醒），恢复后可补看
//   catchUp: 解除时对静默期间被直接找过的会话补一次唤醒
//
// owner 私聊始终例外；管理员私聊在 adminApplies=false 时例外。
// 群聊里的 owner / 管理员不单独豁免（按群会话处理）。

export const MANUAL_SILENCE_STAGES = Object.freeze([
  'passive',
  'proactive',
  'scheduledAi',
  'scheduledText',
  'pluginTasks',
]);

export const MANUAL_SILENCE_STAGE_LABELS = Object.freeze({
  passive: '被动行为',
  proactive: '主动行为',
  scheduledAi: '定时任务·叫 AI 来说',
  scheduledText: '定时任务·固定文字',
  pluginTasks: '插件任务',
});

export const MANUAL_SILENCE_MODE_LABELS = Object.freeze({
  full: '完全静默',
  sendOnly: '只静默发送',
});

const DEFAULT_STAGES = Object.freeze({
  passive: true,
  proactive: true,
  scheduledAi: true,
  scheduledText: true,
  pluginTasks: true,
});

export const DEFAULT_MANUAL_SILENCE_POLICY = Object.freeze({
  mode: 'full',
  stages: DEFAULT_STAGES,
  adminApplies: false,
  recordMessages: true,
  catchUp: true,
});

/** 旧状态只有 mode:'silent' 时使用的默认值：无限期、锁定、全静默。 */
export const DEFAULT_MANUAL_SILENCE = Object.freeze({
  startedAt: 0,
  indefinite: true,
  locked: true,
  ...DEFAULT_MANUAL_SILENCE_POLICY,
});

const bool = (v, def) => (typeof v === 'boolean' ? v : def);

/** 规范化策略；非法字段回落到默认值，不抛错（状态文件可能被手改）。 */
export function normalizeManualSilencePolicy(raw = {}) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawStages = r.stages && typeof r.stages === 'object' && !Array.isArray(r.stages) ? r.stages : {};
  const stages = {};
  for (const stage of MANUAL_SILENCE_STAGES) stages[stage] = bool(rawStages[stage], DEFAULT_STAGES[stage]);
  return {
    mode: r.mode === 'sendOnly' ? 'sendOnly' : 'full',
    stages,
    adminApplies: r.adminApplies === true,
    recordMessages: bool(r.recordMessages, true),
    catchUp: bool(r.catchUp, true),
  };
}

/** 规范化完整手动静默状态；没有 startedAt 的旧状态按 0（未知）处理。 */
export function normalizeManualSilence(raw = {}) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const policy = normalizeManualSilencePolicy(r);
  return {
    startedAt: Number(r.startedAt) > 0 ? Number(r.startedAt) : 0,
    indefinite: r.indefinite !== false,
    locked: r.locked !== false,
    ...policy,
  };
}

/** 角色状态里的 silent 只在 mode==='silent' 时有意义。 */
export function manualSilenceOfState(state) {
  if (!state || state.mode !== 'silent') return null;
  return normalizeManualSilence(state.silent);
}

/** 这个环节是否被静默（true=停，false=照常）。 */
export function stageSuppressed(silent, stage) {
  if (!silent) return false;
  return silent.stages?.[stage] !== false;
}

/** 目标会话是否属于 owner / 管理员 / 普通会话。 */
export function audienceRole(key, { ownerQQ = null, admins = [] } = {}) {
  const m = /:private:(\d+)$/.exec(String(key ?? ''));
  const qq = m ? m[1] : '';
  if (qq && ownerQQ != null && qq === String(ownerQQ)) return 'owner';
  if (qq && Array.isArray(admins) && admins.some((a) => String(a?.qq ?? a) === qq)) return 'admin';
  return 'other';
}

/**
 * 该环节是否允许这个目标活动。
 * - sendOnly：任何环节都允许活动（只拦发送）；
 * - 环节未被静默：允许；
 * - 环节被静默：owner 允许；管理员仅在 adminApplies=false 时允许；群/好友不允许。
 */
export function silenceAllowsStage(silent, stage, audience = 'other') {
  if (!silent) return true;
  if (silent.mode === 'sendOnly') return true;
  if (!stageSuppressed(silent, stage)) return true;
  return audience === 'owner' || (audience === 'admin' && silent.adminApplies !== true);
}

/**
 * 出站发送是否允许。
 * - sendOnly：除 owner / 例外管理员外一律不允许；
 * - full：owner / 例外管理员允许；其余只有在该会话本轮拿到“允许回合”通行证时允许。
 */
export function silenceAllowsSend(silent, audience = 'other', hasPass = false) {
  if (!silent) return true;
  if (audience === 'owner') return true;
  if (audience === 'admin' && silent.adminApplies !== true) return true;
  if (silent.mode === 'sendOnly') return false;
  return hasPass === true;
}

/**
 * 唤醒原因归到哪个环节。未知原因按被动行为处理，宁可多停，不要漏停。
 */
export function manualSilenceStageForReason(reason) {
  const base = String(reason ?? '').split(':')[0];
  if (base === 'scheduled') return 'scheduledAi';
  if (['timeout', 'replyCheck', 'proactiveCheck', 'roleRefresh'].includes(base)) return 'proactive';
  return 'passive';
}

/** 给控制台展示用的摘要。 */
export function manualSilenceSummary(silent, now = Date.now()) {
  if (!silent) return null;
  const stages = MANUAL_SILENCE_STAGES.filter((s) => silent.stages?.[s] !== false);
  return {
    mode: silent.mode,
    modeLabel: MANUAL_SILENCE_MODE_LABELS[silent.mode] ?? silent.mode,
    stages,
    stageLabels: stages.map((s) => MANUAL_SILENCE_STAGE_LABELS[s] ?? s),
    adminApplies: silent.adminApplies === true,
    recordMessages: silent.recordMessages !== false,
    catchUp: silent.catchUp !== false,
    startedAt: silent.startedAt || 0,
    elapsedMs: silent.startedAt > 0 ? Math.max(0, now - silent.startedAt) : null,
    indefinite: silent.indefinite !== false,
    locked: silent.locked !== false,
  };
}
