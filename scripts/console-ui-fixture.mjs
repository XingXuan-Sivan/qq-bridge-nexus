#!/usr/bin/env node
/** Offline console preview. No production modules, credentials, state, or network clients are loaded. */
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleCharStats, roleSectionReport } from '../src/role-card.js';
import { pickBucketMs } from '../src/token-ledger.js';
import { manualDirCommand } from '../src/state-acl.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { createScheduler } from '../src/scheduler/engine.js';
import { parseKey } from '../src/session/key.mjs';
import { CN_HOLIDAYS } from '../src/model-prices.js';
import { DSH_PRICE_TABLE } from './dsh-price-fixture.mjs';
const PLATFORM_PROMPT_SAMPLE = '【平台】你在 QQ 里说话。\n\n1. 引用只在必要时用。\n2. 分条发送。';

import { listBehaviorTypes } from '../src/behaviors/types.mjs';
import { toolCatalogSnapshot } from '../src/tools/catalog.mjs';
import { createSilenceSchedule, peakPresetRanges } from '../src/silence-schedule.js';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const timestamp = '2026-09-20T08:30:00.000Z';

// 预设状态：mock 直接复用真实字段口径，避免与 bridge.js 漂移。
function presetStatusFixture(preset) {
  return {
    preset,
    label: preset === 'chat'
      ? '一代仿真（reserved）'
      : preset === 'chat-v2' ? '二代仿真（reserved2）' : '预设提示词',
    sourceFile: `profiles/agent-platforms/dsh/capabilities/${preset}.yml`,
    requiresRestart: true,
  };
}

// ── 令牌与花费：离线示例数据 ──────────────────────────────────────────────
// 字段口径与 src/token-ledger.js 的 summary()/conversation()/recent() 保持一致，
// 这样控制台渲染路径在离线预览与真实环境走的是同一套形状。
// 价目表取 dsh 平台自己申报的那份，再按 summary() 的投影口径（只给 label/off、节假日只给数量）
// 拍平 —— 不在夹具里另抄一份价格，否则改声明时预览不会跟着变。
const USAGE_SYMBOL = DSH_PRICE_TABLE.symbol;
const USAGE_PRICE_TABLE = {
  version: DSH_PRICE_TABLE.version,
  currency: DSH_PRICE_TABLE.currency,
  symbol: USAGE_SYMBOL,
  unit: DSH_PRICE_TABLE.unit,
  peakMultiplier: DSH_PRICE_TABLE.peakMultiplier,
  peakWindows: DSH_PRICE_TABLE.peakWindows,
  peakWeekdays: DSH_PRICE_TABLE.peakWeekdays,
  holidayCount: DSH_PRICE_TABLE.holidays.length,
  models: Object.fromEntries(Object.entries(DSH_PRICE_TABLE.models).map(([id, m]) => [id, { label: m.label, off: m.off }])),
};

function usageConversationFixture(key, buckets, cost, turns, steps, unattributed = 0) {
  const input = buckets.cacheMiss + buckets.cacheHit + buckets.cacheWrite;
  return {
    key,
    sessionIds: [`fixture-session-${key.replace(/\W/g, '')}`],
    sessions: 1,
    buckets,
    cost,
    unattributedCost: unattributed,
    attributedCost: cost - unattributed,
    byTier: { peak: cost * 0.4, off: cost * 0.6 },
    turns,
    steps,
    unpriced: false,
    unpricedTokens: 0,
    lastAt: Date.parse(timestamp),
    firstAt: Date.parse(timestamp) - 3600_000,
    models: ['deepseek-flash'],
    cacheHitRate: input > 0 ? buckets.cacheHit / input : 0,
  };
}

function usageSummaryFixture() {
  const conversations = [
    usageConversationFixture('group:123456789', { cacheMiss: 41230, cacheHit: 1284000, cacheWrite: 0, output: 18420, reasoning: 0 }, 0.2886, 42, 231),
    usageConversationFixture('private:100001', { cacheMiss: 8600, cacheHit: 210400, cacheWrite: 0, output: 3900, reasoning: 0 }, 0.0467, 9, 48),
    usageConversationFixture('internal:黑话学习', { cacheMiss: 2200, cacheHit: 18000, cacheWrite: 0, output: 900, reasoning: 0 }, 0.0075, 3, 11),
  ];
  const buckets = conversations.reduce((acc, c) => ({
    cacheMiss: acc.cacheMiss + c.buckets.cacheMiss,
    cacheHit: acc.cacheHit + c.buckets.cacheHit,
    cacheWrite: acc.cacheWrite + c.buckets.cacheWrite,
    output: acc.output + c.buckets.output,
    reasoning: 0,
  }), { cacheMiss: 0, cacheHit: 0, cacheWrite: 0, output: 0, reasoning: 0 });
  const cost = conversations.reduce((acc, c) => acc + c.cost, 0);
  const input = buckets.cacheMiss + buckets.cacheHit + buckets.cacheWrite;
  const turns = conversations.reduce((acc, c) => acc + c.turns, 0);
  const steps = conversations.reduce((acc, c) => acc + c.steps, 0);
  return {
    ok: true,
    generatedAt: Date.parse(timestamp),
    priceVersion: USAGE_PRICE_TABLE.version,
    currency: 'CNY',
    symbol: USAGE_SYMBOL,
    nowTier: { tier: 'off', tierLabel: '空闲时段', currency: USAGE_PRICE_TABLE.currency, symbol: USAGE_SYMBOL, peakMultiplier: USAGE_PRICE_TABLE.peakMultiplier },
    priceTable: USAGE_PRICE_TABLE,
    totals: {
      buckets,
      cost,
      attributedCost: cost - 0.02,
      unattributedCost: 0.02,
      byTier: { peak: cost * 0.4, off: cost * 0.6 },
      turns,
      steps,
      conversations: conversations.length,
      unpriced: false,
      unpricedTokens: 0,
      totalTokens: buckets.cacheMiss + buckets.cacheHit + buckets.cacheWrite + buckets.output,
      inputTokens: input,
      cacheHitRate: input > 0 ? buckets.cacheHit / input : 0,
      avgCostPerTurn: cost / turns,
      avgCostPerStep: cost / steps,
    },
    conversations,
    ledger: { file: '(fixture)', journalLines: 0, maxLines: 20000, droppedLines: 0, sessions: 3, baselines: 3, samples: steps, lastIngestAt: Date.parse(timestamp), lastCompactedAt: 0, priceVersion: USAGE_PRICE_TABLE.version },
  };
}

// 走势图示例数据：24 小时 × 30 分钟 = 48 格，故意留出空白时段。
// 峰谷档位按**真实规则**推算（周一至周五 9:00-12:00、14:00-18:00 为高峰），
// 这样示例图看起来和真实使用一致（两条高峰带），而不是人为交替的噪点。
function usageSeriesFixture(hoursRaw) {
  const hours = [24, 72, 168, 720].includes(Number(hoursRaw)) ? Number(hoursRaw) : 24;
  // 桶宽用**生产同一套阶梯**（从 token-ledger 导出），避免预览与线上粒度不一致。
  const bucketMs = pickBucketMs(hours * 3600 * 1000, 48);
  // 走势图的锚点固定在一个**工作日**：fixture 的 timestamp 落在周日，按真实峰谷规则
  // 算出来整条图都是空闲色，示例数据就永远看不到高峰带（离线预览也就失去意义）。
  // 锚点固定也让截图/断言可复现。
  const anchor = Date.parse('2026-09-16T08:30:00.000Z'); // 周三
  const end = Math.floor(anchor / bucketMs) * bucketMs + bucketMs;
  const start = end - Math.ceil((hours * 3600 * 1000) / bucketMs) * bucketMs;
  const count = Math.round((end - start) / bucketMs);
  const isPeakHour = (ms) => {
    const d = new Date(ms);
    const day = d.getDay();
    if (day === 0 || day === 6) return false;
    const h = d.getHours();
    return (h >= 9 && h < 12) || (h >= 14 && h < 18);
  };
  // 档位要**扫完整个桶**，不能只看首尾：12 小时的桶完全可能把 9:00-12:00 整段包在
  // 中间，而两端都在空闲区（首尾采样法会把它误判成「空闲」）。
  const tierOfBucket = (t) => {
    let sawPeak = false;
    let sawOff = false;
    for (let ms = t; ms < t + bucketMs; ms += Math.min(bucketMs, 30 * 60 * 1000)) {
      if (isPeakHour(ms)) sawPeak = true; else sawOff = true;
      if (sawPeak && sawOff) return 'mixed';
    }
    return sawPeak ? 'peak' : 'off';
  };
  const buckets = [];
  // 桶内按 30 分钟小格累加，而不是"只看桶起点那一小时"：
  // 粗桶（如 24 小时）起点可能落在深夜，只看起点会让整条 30 天视图全是 0。
  // 累加也更接近真账本的行为（一个桶 = 该时段所有采样之和）。
  const subStepMs = Math.min(bucketMs, 30 * 60 * 1000);
  for (let i = 0; i < count; i += 1) {
    const t = start + i * bucketMs;
    let cacheMiss = 0;
    let cacheHit = 0;
    let output = 0;
    let cost = 0;
    let turns = 0;
    let steps = 0;
    for (let ms = t; ms < t + bucketMs; ms += subStepMs) {
      const hour = new Date(ms).getHours();
      if (hour < 9 || hour > 23) continue; // 深夜为 0，图上有明显的空白段
      const wave = (Math.sin((ms - start) / (3 * subStepMs)) + 1) / 2;
      const cm = Math.round(300 + wave * 1800);
      const ch = Math.round(6000 + wave * 42000);
      const out = Math.round(60 + wave * 400);
      const sub = (cm / 1e6) * 1 + (ch / 1e6) * 0.02 + (out / 1e6) * 4;
      cacheMiss += cm;
      cacheHit += ch;
      output += out;
      cost += isPeakHour(ms) ? sub * 2 : sub; // 高峰单价 ×2，逐格判定
      turns += 1;
      steps += 3 + (Math.floor(ms / subStepMs) % 5);
    }
    buckets.push({
      t,
      cost,
      tokens: cacheMiss + cacheHit + output,
      cacheMiss,
      cacheHit,
      cacheWrite: 0,
      output,
      turns,
      steps,
      tier: tierOfBucket(t),
      unpricedTokens: 0,
      keys: steps > 0 ? ['group:123456789'] : [],
    });
  }
  const totals = buckets.reduce((acc, b) => ({
    cost: acc.cost + b.cost,
    tokens: acc.tokens + b.tokens,
    turns: acc.turns + b.turns,
    steps: acc.steps + b.steps,
  }), { cost: 0, tokens: 0, turns: 0, steps: 0 });
  const busiest = buckets.reduce((best, b) => (!best || b.cost > best.cost ? b : best), null);
  return {
    ok: true,
    generatedAt: Date.parse(timestamp),
    currency: 'CNY',
    symbol: USAGE_SYMBOL,
    hours,
    bucketMs,
    from: start,
    to: end,
    buckets,
    totals,
    busiest: busiest ? { t: busiest.t, cost: busiest.cost, tokens: busiest.tokens } : null,
    unpriced: false,
    unpricedTokens: 0,
    countedSamples: buckets.reduce((n, b) => n + b.steps, 0),
    offChartCost: 0.02,
    offChartTokens: 18000,
  };
}

function usageTurnsFixture(key) {
  const target = key || 'group:123456789';
  const base = Date.parse(timestamp);
  const rows = [];
  for (let i = 0; i < 6; i += 1) {
    const buckets = { cacheMiss: 900 + i * 120, cacheHit: 32000 + i * 800, cacheWrite: 0, output: 420 + i * 30, reasoning: 0 };
    rows.push({
      sessionId: `fixture-session-${target.replace(/\W/g, '')}`,
      key: target,
      turn: 42 - i,
      steps: 4 + (i % 3),
      attempts: i === 2 ? 1 : 0,
      startedAt: base - (i + 1) * 600_000,
      endedAt: base - i * 600_000,
      model: 'deepseek-flash',
      provider: 'deepseek-official',
      buckets,
      cost: (buckets.cacheMiss / 1e6) * 1 + (buckets.cacheHit / 1e6) * 0.02 + (buckets.output / 1e6) * 4,
      tier: i === 1 ? 'peak' : (i === 4 ? 'mixed' : 'off'),
    });
  }
  const cost = rows.reduce((acc, t) => acc + t.cost, 0);
  return {
    ok: true,
    generatedAt: base,
    currency: 'CNY',
    symbol: USAGE_SYMBOL,
    key: target,
    sessionIds: [`fixture-session-${target.replace(/\W/g, '')}`],
    sessions: 1,
    steps: rows.reduce((acc, t) => acc + t.steps, 0),
    cost,
    attributedCost: cost,
    unattributedCost: 0.0123,
    buckets: rows.reduce((acc, t) => ({
      cacheMiss: acc.cacheMiss + t.buckets.cacheMiss,
      cacheHit: acc.cacheHit + t.buckets.cacheHit,
      cacheWrite: 0,
      output: acc.output + t.buckets.output,
      reasoning: 0,
    }), { cacheMiss: 0, cacheHit: 0, cacheWrite: 0, output: 0, reasoning: 0 }),
    byTier: { peak: cost * 0.3, off: cost * 0.7 },
    unpriced: false,
    unpricedTokens: 0,
    models: ['deepseek-flash'],
    turnLimit: 200,
    // 与 src/token-ledger.js 的 conversation() 一致：`turns` 是**数组**（不是条数）。
    turns: rows,
  };
}

function usageRecentFixture() {
  const base = Date.parse(timestamp);
  const rows = [];
  for (let i = 0; i < 8; i += 1) {
    rows.push({
      time: base - i * 45_000,
      key: i % 3 === 2 ? 'private:100001' : 'group:123456789',
      sessionId: 'fixture-session',
      turn: 42 - Math.floor(i / 4),
      step: 1 + (i % 4),
      retry: 0,
      model: 'deepseek-flash',
      tokens: 34000 + i * 500,
      cacheMiss: 820 + i * 40,
      cacheHit: 33000 + i * 400,
      cacheWrite: 0,
      output: 260 + i * 12,
      reasoning: 0,
      cost: 0.0021 + i * 0.0001,
      tier: i === 3 ? 'peak' : 'off',
      unpriced: false,
    });
  }
  return rows;
}


const MEMORY_LIMIT_DEFAULTS = {
  injectTopics: 10, injectThoughts: 10, injectImpressions: 10,
  maxTopics: 50, maxThoughts: 50, maxImpressions: 200, maxRules: 10,
  maxTraits: 10, traitChars: 50, itemChars: 200, staleHours: 24,
};

function memoryBucket(state, key) {
  if (!state.memoryEntries) state.memoryEntries = {};
  if (!state.memoryEntries[key]) state.memoryEntries[key] = { seq: 0, topics: [], thoughts: [], impressions: [], rules: [] };
  return state.memoryEntries[key];
}

function memoryEntryList(state, key) {
  const bucket = memoryBucket(state, key);
  const limits = { ...MEMORY_LIMIT_DEFAULTS, ...(state.memoryConfig.providers?.['local-digest']?.limits || {}) };
  return {
    key,
    limits,
    counts: { topics: bucket.topics.length, thoughts: bucket.thoughts.length, impressions: bucket.impressions.length, rules: bucket.rules.length },
    topics: bucket.topics,
    thoughts: bucket.thoughts,
    impressions: bucket.impressions,
    rules: bucket.rules,
  };
}

function memorySessions(state) {
  const keys = Object.keys(state.memoryEntries || {}).sort();
  return keys.map((key) => ({ key, counts: memoryEntryList(state, key).counts, limits: memoryEntryList(state, key).limits }));
}

function memoryStatusOf(state) {
  const cfg = state.memoryConfig;
  const mk = (id, label, sync, write) => ({
    id, label,
    enabled: cfg.providers?.[id]?.enabled !== false,
    capabilities: { sync, write, listable: true },
    maxChars: cfg.providers?.[id]?.maxChars ?? null,
    timeoutMs: cfg.providers?.[id]?.timeoutMs ?? 900,
    calls: 0, failures: 0, lastStatus: 'idle', lastChars: 0, cache: { hits: 0, misses: 0 },
  });
  return {
    inject: { provider: cfg.inject.provider, maxChars: cfg.inject.maxChars, timeoutMs: cfg.inject.timeoutMs, cacheTtlMs: cfg.inject.cacheTtlMs },
    maxChars: 2400,
    providers: [mk('local-digest', '本机轻量记忆', true, true), mk('soulkit', 'soulkit 长期记忆', false, false)],
    history: [],
  };
}

function ingestStatusOf(state) {
  const config = state.memoryConfig.ingest;
  return { config, enabled: config.enabled === true, baseUrl: config.baseUrl, pending: 0, enqueued: 0, sent: 0, accepted: 0, batches: 0, failed: 0, lastError: null, lastAt: null, lastStatus: 'idle' };
}

const PERMISSION_LABELS = { 'read-only': '只读', 'workspace-write': '工作区读写', 'full-ask': '完全访问 · 每次确认', full: '完全访问' };
const SESSION_PERMISSION_ORDER = ['inherit', 'read-only', 'workspace-write', 'full-ask', 'full'];

/** 会话准入：白名单在 = 允许、黑名单在 = 拒绝（与 resolveAccessSummary 同一套语义）。 */
function fixtureAccessSummary(state, key) {
  const out = {};
  for (const axis of ['passive', 'proactive']) {
    const cfg = state.access[axis] ?? { mode: 'allow', entries: [] };
    const member = (cfg.entries ?? []).some((id) => id === key || id.endsWith(`:${key}`));
    out[axis] = (cfg.mode === 'deny') !== member ? 'allow' : 'deny';
    out[`${axis}Mode`] = cfg.mode === 'deny' ? 'deny' : 'allow';
    out[`${axis}Member`] = member;
  }
  return out;
}

/** 会话权限级别：value 是档案值（inherit = 跟随全局），effective 是解析后的生效档。 */
function fixturePermissionState(state, key) {
  const value = state.sessionPermissions?.[key] ?? 'inherit';
  const capability = fixtureCapabilities().find((item) => item.id === (fixtureSessionCapabilityId(state, key) || 'chat-v2')) ?? null;
  return {
    value,
    effective: value === 'inherit' ? state.permission.default : value,
    options: SESSION_PERMISSION_ORDER.map((id) => ({ value: id, name: PERMISSION_LABELS[id] ?? id })),
    labels: PERMISSION_LABELS,
    // 对端权限档由能力档的 runtime 段决定；直通档不钉，所以这里是空串。
    peerPermission: String(capability?.runtime?.peerPermission ?? ''),
    peerPin: state.agentMirror?.[key] ?? null,
  };
}

/**
 * 能力档：`runtime` 段是「怎么生效」的唯一真源，与控制台的显示同源。
 * 直通档（direct）用 passthrough + 不钉对端档位，覆盖「执行体自己说了算」那一路。
 */
function fixtureCapabilities() {
  return [
    {
      id: 'chat', label: '聊天 Agent', audience: 'access', builtin: true, platformVisible: ['sendMessage', 'sendBurst', 'sendPoke', 'markRead', 'setWakeConfig'],
      agentModules: ['tool-web', 'tool-ask-user', 'tool-todo'],
      tools: { platform: {}, mcp: [{ server: '*', tools: '*' }], skills: ['*'] },
      runtime: { apply: 'preset', prompt: 'none', peerPermission: '', narrow: [] },
      note: '', hasRows: true, rowsCount: 2, usedBy: [], isDefault: false,
    },
    {
      id: 'chat-v2', label: '二代仿真', audience: 'access', builtin: true, platformVisible: ['sendMessage', 'sendBurst', 'sendPoke', 'markRead', 'setWakeConfig'],
      agentModules: ['tool-web', 'tool-ask-user', 'tool-todo'],
      tools: { platform: {}, mcp: [{ server: '*', tools: '*' }], skills: ['*'] },
      runtime: { apply: 'preset', prompt: 'tool', peerPermission: '', narrow: [] },
      note: '', hasRows: true, rowsCount: 2, usedBy: ['group:100003'], isDefault: true,
    },
    {
      id: 'readonly', label: 'Agent · 只读', audience: 'owner', builtin: true, platformVisible: ['sendMessage', 'markRead'],
      agentModules: ['tool-fs', 'tool-fs-search'],
      tools: { platform: {}, mcp: [{ server: '*', tools: '*' }], skills: ['*'] },
      runtime: { apply: 'preset', prompt: 'none', peerPermission: 'read-only', narrow: [] },
      note: '', hasRows: true, rowsCount: 2, usedBy: ['group:123456789'], isDefault: false,
    },
    {
      id: 'direct', label: '直通 · 主人', audience: 'owner', builtin: true, platformVisible: ['sendMessage', 'markRead'],
      agentModules: [],
      tools: { platform: {}, mcp: [], skills: [] },
      runtime: { apply: 'passthrough', prompt: 'system', peerPermission: '', narrow: [] },
      note: '不装预设与沙箱，直接使用执行体自己的会话、工具与权限档', hasRows: false, rowsCount: 0, usedBy: ['private:100001'], isDefault: false,
    },
  ];
}

// 会话显式挂的能力档：空串 = 跟随平台默认（chat-v2）。
// 要验的两条路：直通档（不钉对端档位）、声明了 peerPermission 的只读档。
const FIXTURE_SESSION_CAPABILITY = Object.freeze({ 'private:100001': 'direct', 'group:123456789': 'readonly' });

/** 改过档的会话优先看 state：空串 = 跟随平台默认（chat-v2）。 */
function fixtureSessionCapabilityId(state, key) {
  return state.sessionCapabilities?.[key] ?? (FIXTURE_SESSION_CAPABILITY[key] ?? '');
}

/** 会话详情 ›「Agent 平台与执行体」的离线数据（与 GET /api/sessions/:key/agent 同形）。 */
function fixtureSessionAgent(state, key) {
  const capability = fixtureCapabilities().find((item) => item.id === (fixtureSessionCapabilityId(state, key) || 'chat-v2')) ?? null;
  const runtime = capability?.runtime ?? { apply: 'preset', prompt: 'none', peerPermission: '', narrow: [] };
  const peerPermission = String(runtime.peerPermission ?? '');
  const current = state.agentPresets?.[key] ?? '';
  // 声明了对端档位才去读：读不出来如实标，不拿档案里的旧值充数。
  const peer = peerPermission
    ? (current
      ? { readable: true, preset: current, text: '', reason: '' }
      : { readable: false, preset: '', text: '', reason: '会话还没建立' })
    : null;
  return {
    ok: true,
    key,
    sessionId: state.sessions.find((item) => item.key === key)?.sessionId ?? null,
    instance: 'dsh',
    instanceForeign: state.sessionForeign?.[key] === true,
    agentPlatform: { id: 'dsh', label: 'DeepSeek Harness' },
    capability: capability
      ? {
        id: capability.id,
        label: capability.label,
        note: capability.note,
        audience: capability.audience,
        apply: runtime.apply,
        peerPermission,
        prompt: runtime.prompt,
      }
      : null,
    behavior: state.sessionBehaviors?.[key] ?? 'inherit',
    promptChannel: { channel: runtime.prompt, requested: runtime.prompt, degraded: false },
    permission: { ...fixturePermissionState(state, key), peer },
  };
}

export function makeFixtureState() {
  return {
    mode: 'reserved2', role: '小鲸鱼', roleMode: 'active', paused: false,
    memoryConfig: {
      inject: { provider: 'soulkit', maxChars: 2400, timeoutMs: 900, cacheTtlMs: 60000 },
      providers: { 'local-digest': { enabled: true }, soulkit: { enabled: true, baseUrl: 'http://127.0.0.1:3110', timeoutMs: 900, maxChars: 1200 } },
      tools: { recall: true, note: false },
      handover: { enabled: true },
      ingest: { enabled: false, baseUrl: 'http://127.0.0.1:3110', maxQueue: 200, batchSize: 40, flushIntervalMs: 1500, timeoutMs: 5000 },
    },
    roles: ['小鲸鱼', '温柔助手', '技术伙伴'],
    // 按会话设置人格（假群号）：null = 不挂卡
    roleByKey: { 'group:123456789': '技术伙伴', 'group:987654321': null },
    roleKnownKeys: ['group:123456789', 'group:987654321', 'group:555666777', 'private:10001'],
    roleContents: {
      小鲸鱼: '# 小鲸鱼\n\n- 性格：好奇、爱接梗，遇到不懂的会直接问\n- 说话风格：简短，偶尔用 emoji',
      温柔助手: '# 温柔助手\n\n- 性格：温和、有耐心\n- 说话风格：先共情再回答',
      技术伙伴: '# 技术伙伴\n\n- 性格：直接、爱讲原理\n- 说话风格：先给结论再解释',
    },
    // 外部人格（soulkit provider 的角色卡）；桥接按 name 代理读取与写入。
    externalPersonas: {
      星苒: { slug: '星苒', description: '群里的主角色', overlay: '雨夜的北京，窗没关。', systemAppend: '说话别太长。' },
      备用角色: { slug: '备用角色', description: '备用设定', overlay: '', systemAppend: '' },
    },
    simPrompts: {
      'chat-v2': '你是 QQ 群里的仿真群友。\n\n【安全边界（最高优先级，不可违反）】\n1. 你没有本地工具。\n\n【送达方式：工具发送】\n1. 文本输出不会自动发送给群友。',
      'chat': '你是 QQ 群里的仿真群友（一代）。\n\n【安全边界（最高优先级，不可违反）】\n1. 你没有本地工具。\n\n【送达方式：自动转发】\n1. 回复会自动转发到 QQ。',
      // 自建预设：persona.prefix 为空，用来验证「提示词卡不该被隐藏、空内容也能编辑」。
      'demo-agent': '',
    },
    // 「初始版本」：与 simPrompts 起始值一致，用来测「已修改 / 还原」。
    simDefaults: {
      'chat-v2': '你是 QQ 群里的仿真群友。\n\n【安全边界（最高优先级，不可违反）】\n1. 你没有本地工具。\n\n【送达方式：工具发送】\n1. 文本输出不会自动发送给群友。',
      'chat': '你是 QQ 群里的仿真群友（一代）。\n\n【安全边界（最高优先级，不可违反）】\n1. 你没有本地工具。\n\n【送达方式：自动转发】\n1. 回复会自动转发到 QQ。',
      'demo-agent': '',
    },
    roleInjectMax: 6000,
    // 人格卡虚拟块的开关（promptBlocks['core-persona'].enabled）。
    personaEnabled: true,
    dshProvider: 'deepseek-official',
    dshModel: 'deepseek-flash',
    // Agent 平台的配置面与最近一次显式探活（P2 写口 / probe 的落点）：初值与注册表里的 config 一致。
    agentConfigs: {
      dsh: {
        baseUrl: '',
        authToken: '',
        authTokenExplicit: false,
        authHeader: 'authorization',
        authPrefix: 'Bearer',
        allowRemote: false,
        provider: 'deepseek-official',
        model: 'deepseek-flash',
        reasoningEffort: 'max',
        vision: 'auto',
      },
      acp: { command: 'npx @zed-industries/agent', args: ['--stdio'], timeoutMs: 120000 },
    },
    agentProbes: {},
    defaultAgent: 'dsh',
    // 对端权限档：执行体自报的现值（permission.peer）+ 建会话时钉住的基线（peerPin）。
    agentPresets: { 'group:123456789': 'read-only' },
    agentMirror: { 'group:123456789': { preset: 'read-only', at: timestamp } },
    // 会话级选择：缺省 = 跟随平台默认；能力档由 FIXTURE_SESSION_CAPABILITY 决定。
    sessionBehaviors: { 'group:123456789': 'social-v2' },
    sessionCapabilities: {},
    sessionPermissions: { 'group:123456789': 'workspace-write' },
    sessionForeign: {},
    // 用户实例（一条 `platforms.users` 条目 = 一个实例）。qq 是默认且在用；wx 是插件注册的
    // 第二条平台、条目被停用 —— 用来验条目开关、入站状态与「设为默认实例」。
    userConfigs: {
      qq: { account: '', httpUrl: 'http://127.0.0.1:3000', wsUrl: 'ws://127.0.0.1:3001', accessToken: '', followDiscoveredEndpoint: true, viaPlatform: false, silenceWarnMs: 600000 },
    },
    userEnabled: { qq: true, wx: false },
    // 条目级默认行为（`platforms.users.<id>.defaultBehavior`）：空串 = 不设置，新建会话回落到聊天模式。
    userDefaultBehaviors: { qq: 'social-v2', wx: '' },
    userInbound: {
      qq: { state: 'open', detail: '', at: timestamp },
      wx: { state: 'disabled', detail: '配置里停用了这条实例', at: timestamp },
    },
    defaultUser: 'qq',
    whitelist: { ownerQQ: '100001', admins: [] },
    access: {
      passive: { mode: 'allow', entries: ['qq:group:123456789', 'qq:group:100003', 'qq:private:100001'] },
      proactive: { mode: 'allow', entries: ['qq:group:123456789', 'qq:group:100003'] },
    },
    permission: { default: 'read-only' },
    sessions: [
      { key: 'group:123456789', sessionId: 'demo-community-20260920', owner: false },
      { key: 'group:100003', sessionId: 'demo-development-20260920', owner: false },
      { key: 'private:100001', sessionId: 'demo-owner-20260920', owner: true },
    ],
    social: {
      triggerProbability: 0.2, activeCheckMinMs: 10000, activeCheckMaxMs: 30000,
      activeReplyDelayMinMs: 1000, activeReplyDelayMaxMs: 3000, activeDurationEnabled: true,
      activeDurationMinMs: 180000, activeDurationMaxMs: 600000, idleWindowMs: 300000,
      idleRetryProbability: 0.4, idleRetryWaitMs: 120000, skipProbability: 0.15,
      surrenderProbability: 0.08, contextWindow: 20, maxReplyChars: 500,
      burstEnabled: true, burstIntervalMinMs: 1000, burstIntervalMaxMs: 3000,
      longGapProbability: 0.1, longGapMinMs: 2500, longGapMaxMs: 5000,
      mustReplyKeywords: ['小鲸鱼', 'DeepSeek'], proactiveEnabled: true,
      proactiveIdleThresholdMs: 1800000, proactiveCheckMinMs: 300000,
      proactiveCheckMaxMs: 900000, proactiveProbability: 0.2,
    },
    socialStates: { 'group:123456789': { phase: 'active' }, 'group:100003': { phase: 'idle' } },
    v2: { enabled: true, agentPreset: 'chat-v2', provideRecommendations: true, tools: {} },
    behaviors: {
      'social-v1': 'version: 1\nplatform: qq\nkind: social-v1\nlabel: 默认 v1\ndescription: 离线示例\nconfig:\n  triggerProbability: 0.2\n  contextWindow: 20\n',
      'social-v2': 'version: 1\nplatform: qq\nkind: social-v2\nlabel: 默认 v2\ndescription: 离线示例\nconfig:\n  wake:\n    defaultMode: diving\n  send:\n    burstEnabled: true\n',
    },
    behaviorDocs: {
      'social-v1': { id: 'social-v1', platform: 'qq', kind: 'social-v1', label: '一代仿真默认行为', description: '离线示例', config: { triggerProbability: 0.2, contextWindow: 20 } },
      'social-v2': { id: 'social-v2', platform: 'qq', kind: 'social-v2', label: '二代仿真默认行为', description: '离线示例', config: { wake: { defaultMode: 'diving' }, send: { burstEnabled: true } } },
    },
    behaviorDefault: 'social-v2',
    limits: { send: { maxSendPerMinute: 8, maxSendPerHour: 60 } },
    tools: { getPrompt: true, getUnread: true, getRecent: true, socialState: true, sendMessage: true, sendVoice: true },
    // 上下文压缩（config.compact）：和真 bridge 一样，阈值留空 = 跟随平台申报点。
    compact: { mode: 'early', thresholdTokens: 300000 },
    // 会话初始提示词（离线示例）：整段内容都是虚构的演示文本。
    initPrompt: '离线示例：这是一个演示用的群聊环境说明，不会写进任何真实配置。',
    slangConfig: { enabled: true, extractMinMessages: 10, extractCooldownMs: 300000, inferenceThresholds: [2, 4, 8], injectMax: 8, learnerPreset: 'chat', workspaceTitle: 'QQ 黑话学习', autoResearch: true },
    slang: [
      { id: 'demo-candidate', content: '有被治愈到', meaning: '感到温暖和安慰', status: 'candidate', count: 4, source: 'auto', evidence: [{ sender: '演示群友', text: '今天这张图，有被治愈到。' }], createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-guess', content: '示例新词', meaning: '', status: 'candidate', count: 2, source: 'auto', evidence: [{ sender: '演示群友', text: '这也太示例新词了吧。' }], lastGuess: { meaning: '（演示推测）形容事情很离谱', usage: '吐槽时用', example: '', at: timestamp }, createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-confirmed', content: '绝绝子', meaning: '很好、很棒', usage: '表达赞美', example: '这个设计绝绝子。', status: 'confirmed', count: 12, source: 'manual', createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-rejected', content: '测试噪声', meaning: '', risk: '演示排除项', status: 'rejected', count: 1, source: 'auto', createdAt: timestamp, updatedAt: timestamp },
    ],
    security: { interceptNotify: true },
    // state/ 的 ACL 是否已收紧。离线演示默认给「未收紧」，这样告警条在预览里可见
    // （真实场景：Windows 上未以管理员身份运行桥接时就是这个状态）。
    hardenStateDir: false,
    toolLog: [
      { time: timestamp, key: 'group:123456789', tool: 'qq_get_recent_messages', type: 'call', args: JSON.stringify({ key: 'group:123456789', limit: 20 }) },
      { time: timestamp, key: 'group:123456789', tool: 'qq_get_recent_messages', type: 'result', ok: true },
    ],
    feedback: [{ time: timestamp, level: 'info', message: '这是离线演示反馈。' }],
  };
}

/** Bind only to loopback. Mutations affect this server's disposable in-memory state. */
// 离线演示用的 DSH 模型目录（假数据）：两个 DeepSeek 自家模型 + 一个虚构的第三方提供方（含无档位模型）。
const FIXTURE_EFFORTS = [
  { id: 'off', name: 'Off', description: '关闭思考' },
  { id: 'low', name: 'Low', description: 'routine' },
  { id: 'high', name: 'High', description: 'default balance' },
  { id: 'max', name: 'Max', description: 'hardest tasks' },
];
const FIXTURE_DSH_PROVIDERS = [
  { id: 'deepseek-official', name: 'DeepSeek', thirdParty: false, models: [
    { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', description: '', efforts: FIXTURE_EFFORTS, defaultEffort: 'high', vision: 'yes', priced: true },
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', description: '', efforts: FIXTURE_EFFORTS, defaultEffort: 'high', vision: 'unknown', priced: true },
  ] },
  { id: 'example-cloud', name: 'Example Cloud（演示）', thirdParty: true, models: [
    { id: 'example-chat', name: 'Example Chat', description: '没有思考档位的演示模型', efforts: [], defaultEffort: null, vision: 'unknown', priced: false },
    { id: 'example-reasoner', name: 'Example Reasoner', description: '', efforts: [{ id: 'minimal', name: 'Minimal' }, { id: 'medium', name: 'Medium' }, { id: 'xhigh', name: 'XHigh' }], defaultEffort: 'medium', vision: 'unknown', priced: false },
  ] },
];
// 平台声明面（profiles/agent-platforms/dsh/agent-platform.yml 的 modelCatalog）：
// 档位中文名、看图声明与价目覆盖都从这里来，与实时目录分开。
const FIXTURE_DSH_DECLARED = {
  models: [
    { id: 'deepseek-flash', label: 'DeepSeek-V4.1-Flash', contextWindow: 1000000, vision: true, pricing: { cacheHit: 0.02, cacheMiss: 1, cacheWrite: 1, output: 4 } },
    { id: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro-0813', pricing: { cacheHit: 0.15, cacheMiss: 4.5, cacheWrite: 4.5, output: 13.5 } },
  ],
  pricingPolicy: { version: '2026-11-04', currency: 'CNY', symbol: '¥', unit: 1000000, peakMultiplier: 2, peakWindows: [[9, 12], [14, 18]], peakWeekdays: [1, 2, 3, 4, 5] },
  efforts: [
    { id: 'off', label: '关闭' }, { id: 'minimal', label: '极低' }, { id: 'low', label: '低' },
    { id: 'medium', label: '中' }, { id: 'high', label: '高' }, { id: 'xhigh', label: '极高' }, { id: 'max', label: '最高' },
  ],
  effortFallback: ['low', 'high', 'max'],
  compact: { approxTokens: 800000 },
};

// ── 定时任务夹具（假数据；发送不会真的发出去） ──────────────────────────────
let fixtureScheduler = null;
function getFixtureScheduler() {
  if (fixtureScheduler) return fixtureScheduler;
  const dir = mkdtempSync(joinPath(tmpdir(), 'qqb-fixture-scheduler-'));
  fixtureScheduler = createScheduler({
    file: joinPath(dir, 'scheduler.json'),
    deliver: async () => ({ status: 'sent', reason: '离线演示，没有真的发送' }),
    validateTarget: (k) => (parseKey(k) ? null : `发送对象「${k}」格式不对`),
    ownerKey: () => 'private:100001',
    holidays: CN_HOLIDAYS,
  });
  fixtureScheduler.createTask({ name: '早安', kind: 'text', text: '早上好', schedule: { type: 'daily', times: ['06:00'] }, targets: ['private:100001'] }, { source: 'console' });
  fixtureScheduler.createTask({ name: '随机陪聊', kind: 'ai', instruction: '随便跟我聊一句，或者发个可爱的表情包', schedule: { type: 'dailyRandom', count: 3, window: ['09:00', '22:00'], minGapMin: 60 }, targets: ['private:100001'] }, { source: 'owner-chat-ai' });
  const t3 = fixtureScheduler.createTask({ name: '周报提醒', kind: 'ai', instruction: '提醒大家交周报，语气轻松一点', schedule: { type: 'workdays', times: ['18:00'] }, targets: ['group:123456789', 'group:100003'], maxRuns: 8 }, { source: 'console' });
  fixtureScheduler.setEnabled(t3.id, false, { source: 'console' });
  return fixtureScheduler;
}
// ── 定时静默夹具（真实模块 + 临时文件；演示数据：工作日下午高峰 + 周末深夜） ──────────────
let fixtureSilence = null;
function getFixtureSilence() {
  if (fixtureSilence) return fixtureSilence;
  const dir = mkdtempSync(joinPath(tmpdir(), 'qqb-fixture-silence-'));
  fixtureSilence = createSilenceSchedule({ file: joinPath(dir, 'silence.json'), holidays: CN_HOLIDAYS });
  fixtureSilence.update({
    enabled: true, timezone: 'Asia/Shanghai',
    ranges: [
      { name: '上午高峰', start: '09:00', end: '12:00', days: 'workdays', skipHolidays: true },
      { name: '下午高峰', start: '14:00', end: '18:00', days: 'workdays', skipHolidays: true },
      { name: '深夜', enabled: false, start: '01:00', end: '08:00', days: 'custom', weekdays: [6, 7] },
    ],
  });
  return fixtureSilence;
}
async function handleFixtureSilence(req, method, json, requests, state) {
  const sil = getFixtureSilence();
  if (method === 'POST') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    requests.push({ method, path: '/api/silence', body });
    try { sil.update(body); } catch (error) { return json({ ok: false, error: error?.message ?? String(error) }, 400); }
  }
  return json({ ok: true, ...sil.status(), manual: state.roleMode === 'silent', peakPreset: peakPresetRanges(DSH_PRICE_TABLE), writable: true });
}

async function handleFixtureScheduler(req, method, path, json, requests) {
  const sch = getFixtureScheduler();
  const sub = path.slice('/api/scheduler'.length);
  let body = {};
  if (method !== 'GET') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    requests.push({ method, path, body });
  }
  try {
    if (method === 'GET' && (sub === '' || sub === '/')) {
      return json({ ok: true, ...sch.snapshot(), writable: true, mode: 'reserved2', targets: [
        { key: 'private:100001', label: '管理员私聊', kind: 'owner' },
        { key: 'group:123456789', label: '群 123456789', kind: 'group' },
        { key: 'group:100003', label: '群 100003', kind: 'group' },
      ] });
    }
    if (method === 'POST' && sub === '/settings') return json({ ok: true, settings: sch.updateSettings(body, { source: 'console' }) });
    if (method === 'POST' && sub === '/preview') return json({ ok: true, ...sch.preview(body, 5) });
    if (method === 'POST' && sub === '/tasks') return json({ ok: true, task: sch.createTask(body, { source: 'console' }) });
    const m = /^\/tasks\/(\d+)(\/run|\/enable|\/disable)?$/.exec(sub);
    if (m) {
      const id = Number(m[1]);
      if (method === 'PATCH' && !m[2]) return json({ ok: true, task: sch.updateTask(id, body, { source: 'console' }) });
      if (method === 'DELETE' && !m[2]) return json({ ok: true, task: sch.deleteTask(id, { source: 'console' }) });
      if (method === 'POST' && m[2] === '/run') return json({ ok: true, ...(await sch.runNow(id, { source: 'console' })) });
      if (method === 'POST') return json({ ok: true, task: sch.setEnabled(id, m[2] === '/enable', { source: 'console' }) });
    }
    return json({ ok: false, error: '不存在的定时任务接口' }, 404);
  } catch (error) {
    return json({ ok: false, error: error?.message ?? String(error) }, 400);
  }
}

export async function startConsoleFixture({ port = 0, original = false, htmlPath, logWrites = false } = {}) {
  const file = htmlPath || resolve(projectRoot, original ? 'scripts/fixtures/console.before.html' : 'public/console/index.html');
  await readFile(file); // Fail early rather than displaying a broken preview.
  // 拆分后控制台的样式/脚本是独立文件：预览也要按真实路径提供，否则页面只剩空壳。
  const assets = new Map();
  if (!htmlPath && !original) {
    const dir = resolve(projectRoot, 'public/console');
    for (const name of ['tokens.css', 'base.css', 'layout.css', 'grid.css', 'components.css', 'utilities.css']) {
      assets.set(`/console/css/${name}`, { body: await readFile(resolve(dir, 'css', name)), type: 'text/css; charset=utf-8' });
    }
    // js/ 下的模块逐个提供：入口 app.js 会 import ./api.js、./router.js、./components/*.js 等，
    // 所以这里要递归（components/ 子目录也是真实请求路径的一部分，漏了就整页起不来）。
    const jsRoot = resolve(dir, 'js');
    const walkJs = async (abs, rel = '') => {
      for (const entry of await readdir(abs, { withFileTypes: true })) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { await walkJs(resolve(abs, entry.name), relPath); continue; }
        if (!entry.name.endsWith('.js')) continue;
        assets.set(`/console/js/${relPath}`, { body: await readFile(resolve(abs, entry.name)), type: 'text/javascript; charset=utf-8' });
      }
    };
    await walkJs(jsRoot);
    // components/ 下的组件把 js 与 css 放在同一目录（docs/CONSOLE_UI.md）：两类都要按真实路径提供。
    const componentRoot = resolve(dir, 'components');
    const walkComponents = async (abs, rel = '') => {
      for (const entry of await readdir(abs, { withFileTypes: true }).catch(() => [])) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { await walkComponents(resolve(abs, entry.name), relPath); continue; }
        const type = entry.name.endsWith('.js') ? 'text/javascript; charset=utf-8'
          : entry.name.endsWith('.css') ? 'text/css; charset=utf-8'
            : entry.name.endsWith('.html') ? 'text/html; charset=utf-8' : null;
        if (!type) continue;
        assets.set(`/console/components/${relPath}`, { body: await readFile(resolve(abs, entry.name)), type });
      }
    };
    await walkComponents(componentRoot);
    // 图片与字体（favicon.svg、以后的自托管字体）：按真实路径提供，缺了会 404 打断资源断言。
    const binaryTypes = { svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff' };
    const walkBinary = async (abs, urlBase, rel = '') => {
      for (const entry of await readdir(abs, { withFileTypes: true }).catch(() => [])) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { await walkBinary(resolve(abs, entry.name), urlBase, relPath); continue; }
        const type = binaryTypes[entry.name.split('.').pop()?.toLowerCase()];
        if (!type) continue;
        assets.set(`${urlBase}/${relPath}`, { body: await readFile(resolve(abs, entry.name)), type });
      }
    };
    await walkBinary(resolve(dir, 'img'), '/console/img');
    await walkBinary(resolve(dir, 'fonts'), '/console/fonts');
    // 自托管 vendor（CodeMirror）：运行时也走 /console/vendor/。
    for (const entry of await readdir(resolve(dir, 'vendor'), { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      assets.set(`/console/vendor/${entry.name}`, {
        body: await readFile(resolve(dir, 'vendor', entry.name)),
        type: 'text/javascript; charset=utf-8',
      });
    }
    // 页面片段：pages/<id>/{page.html,page.css,page.js} 按浏览器真实请求路径提供。
    for (const id of await readdir(resolve(dir, 'pages')).catch(() => [])) {
      const pageDir = resolve(dir, 'pages', id);
      for (const name of await readdir(pageDir).catch(() => [])) {
        const type = name.endsWith('.html') ? 'text/html; charset=utf-8'
          : name.endsWith('.css') ? 'text/css; charset=utf-8'
            : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : null;
        if (!type) continue;
        assets.set(`/console/pages/${id}/${name}`, { body: await readFile(resolve(pageDir, name)), type });
      }
    }
  }
  const state = makeFixtureState();
  const requests = [];
  const unknownRequests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname;
    const method = req.method || 'GET';
    const json = (value, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    try {
      if (method === 'GET' && ['/', '/console', '/console/'].includes(path)) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
          'content-security-policy': "connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'" });
        res.end(await readFile(file));
        return;
      }
      if (method === 'GET' && assets.has(path)) {
        const asset = assets.get(path);
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' });
        res.end(asset.body);
        return;
      }
      if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (method === 'GET' && path === '/__fixture/requests') return json({ requests, unknownRequests });
      if (method === 'GET' && path === '/__fixture/info') return json({ offline: true, htmlPath: file });
      if (!path.startsWith('/api/')) return json({ ok: false, error: 'Offline fixture route not found' }, 404);
      // 定时任务：直接用真实的调度引擎（临时数据文件 + 假发送），预览里看到的规则计算与真实一致
      if (path === '/api/scheduler' || path.startsWith('/api/scheduler/')) return handleFixtureScheduler(req, method, path, json, requests);
      if (path === '/api/silence') return handleFixtureSilence(req, method, json, requests, state);

      let body = {};
      if (method !== 'GET') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        requests.push({ method, path, body });
        if (logWrites) console.log(`[mock write] ${method} ${path} ${JSON.stringify(body)}`);
      }
      // 预设：新建 / 插件配置 / 还原出厂（表单化后控制台只走这三个写接口）。
      if (method === 'POST' && path === '/api/extensions/presets/create') {
        return json({ ok: true, id: body?.id ?? 'new-preset', from: body?.from ?? '', presets: [] });
      }
      const presetEdit = path.match(/^\/api\/extensions\/presets\/([a-z0-9-]+)\/(meta|extensions|yaml|validate|apply|rollback)$/);
      if (presetEdit) {
        const [, presetId, action] = presetEdit;
        if (action === 'validate') return json({ ok: true, validation: { ok: true, rows: 3 } });
        if (action === 'apply') return json({ ok: true, preset: presetStatusFixture(presetId), requiresRestart: true });
        if (action === 'rollback') return json({ ok: true, restored: '2026-01-01-00-00-00-000' });
        return json({ ok: true, id: presetId, preset: { id: presetId } });
      }
      const presetDelete = path.match(/^\/api\/extensions\/presets\/([a-z0-9-]+)$/);
      if (presetDelete && method === 'DELETE') {
        const id = presetDelete[1];
        if (['chat', 'chat-v2'].includes(id)) return json({ ok: false, error: '系统自带预设不能删除' }, 400);
        return json({ ok: true, id, presets: [] });
      }
      const presetAction = path.match(/^\/api\/extensions\/presets\/([a-z0-9-]+)\/(agent|factory)$/);
      if (presetAction) {
        const [, presetId, action] = presetAction;
        if (action === 'factory') return json({ ok: true, id: presetId, restored: ['capability.yml'] });
        if (method === 'PUT') return json({ ok: true, id: presetId, rows: Array.isArray(body?.rows) ? body.rows.length : 0 });
        return json({ ok: true, preset: { id: presetId, rows: [] } });
      }
      const demoPlugin = {
        id: 'demo-plugin', name: '演示插件', version: '0.1.0', status: 'active',
        description: '离线预览用的假插件，不加载任何代码。',
        permissions: ['state'], hooks: [], commands: [], blocks: [], personas: [], taskTypes: [],
        source: { dir: 'plugins/demo-plugin', main: 'index.mjs' },
        counters: { hookCalls: 1, hookErrors: 0, reloads: 0 },
        updatedAt: '2026-11-09T04:00:00.000Z',
        config: { enabled: true, baseUrl: 'http://127.0.0.1:3110', timeoutMs: 1200 },
        configSchema: {
          type: 'object',
          properties: {
            baseUrl: { type: 'string', title: '服务地址', default: 'http://127.0.0.1:3110' },
            timeoutMs: { type: 'integer', title: '超时', default: 1200, minimum: 50, maximum: 10000 },
          },
          additionalProperties: false,
        },
        audit: [{ ts: '2026-11-09T04:00:01.000Z', event: 'config', plugin: 'demo-plugin' }],
      };
      const pluginMatch = path.match(/^\/api\/plugins\/([a-z][a-z0-9-]+)(?:\/(config|test))?$/);
      if (pluginMatch) {
        const [, pluginId, suffix] = pluginMatch;
        if (method === 'GET' && !suffix && pluginId === 'demo-plugin') return json({ ok: true, plugin: demoPlugin });
        if (method === 'PATCH' && suffix === 'config') return json({ ok: true, config: body?.config ?? {}, reloaded: true });
        if (method === 'POST' && suffix === 'test') return json({ ok: true, valid: true, config: body?.config ?? {} });
      }
      // 外部 MCP 的连接测试：弹窗里的草稿（/test）与已存条目的测试（/<id>/test）同一形状。
      if (method === 'POST' && /^\/api\/extensions\/mcp\/(?:[a-z0-9-]+\/)?test$/.test(path)) {
        return json({ ok: true, tools: [{ name: 'demo_tool', description: '外部测试工具' }] });
      }
      if (method === 'DELETE' && path.startsWith('/api/extensions/mcp/')) {
        return json({ ok: true, id: decodeURIComponent(path.split('/').pop()) });
      }
      const behaviorMatch = path.match(/^\/api\/config\/behaviors(?:\/([^/]+))?(?:\/(validate|reset))?$/);
      if (behaviorMatch) {
        const [, behaviorId, action] = behaviorMatch;
        const docs = state.behaviorDocs;
        if (method === 'GET' && !behaviorId) {
          return json({ ok: true, behaviors: Object.values(docs).map((doc) => ({ id: doc.id, file: doc.id + '.yml', label: doc.label, kind: doc.kind, valid: true, builtin: true })) });
        }
        if (method === 'GET' && behaviorId) {
          const doc = docs[behaviorId];
          if (!doc) return json({ ok: false, error: '行为档案不存在' }, 404);
          return json({ ok: true, id: doc.id, text: '', header: '', kind: doc.kind, label: doc.label, description: doc.description, builtin: true, factoryPrompt: doc.factoryPrompt ?? '', data: { version: 1, kind: doc.kind, label: doc.label, description: doc.description, config: doc.config } });
        }
        if (method === 'POST' && action === 'validate') return json({ ok: true, validation: { ok: true } });
        if (method === 'POST' && action === 'reset') {
          const doc = docs[behaviorId];
          if (!doc) return json({ ok: false, error: '行为档案不存在' }, 404);
          return json({ ok: true, requiresRestart: true, doc: { id: doc.id, kind: doc.kind, label: doc.label, description: doc.description, config: doc.config } });
        }
        if (method === 'PUT' && behaviorId) {
          const data = body?.data;
          docs[behaviorId] = { id: behaviorId, kind: data?.kind || docs[behaviorId]?.kind || 'v2', label: data?.label || behaviorId, description: data?.description ?? '', config: data?.config ?? {} };
          return json({ ok: true, id: behaviorId, requiresRestart: true });
        }
      }
      if (path === '/api/config/behavior-default') {
        if (method === 'GET') return json({ ok: true, value: state.behaviorDefault ?? null, options: (state.behaviorDocs ? Object.values(state.behaviorDocs) : []).map((doc) => ({ id: doc.id, label: doc.label, kind: doc.kind })) });
        const value = typeof body?.value === 'string' ? body.value.trim() : '';
        state.behaviorDefault = value || null;
        return json({ ok: true, value: state.behaviorDefault, message: value ? '已设为「' + value + '」，下一条消息生效' : '已清空默认行为档案' });
      }
      if (path === '/api/config/runtime') {
        if (method === 'GET') {
          return json({
            ok: true,
            // 默认行为不在这个端点上：它是用户平台的条目级键。
            runtime: { defaultAgent: state.defaultAgent, defaultUser: state.defaultUser },
            // 运行期恒为 dsh / qq：切换默认只落盘，本进程不换装配。
            runningAgent: 'dsh',
            runningUser: 'qq',
          });
        }
        // 默认执行体 / 默认用户实例：设置即落盘，重启后装配（与真实桥接同一语义：
        // 选中的就是本进程在跑的那个时不要求重启）。
        if (body?.defaultUser !== undefined) {
          const wanted = String(body.defaultUser);
          state.defaultUser = wanted;
          return json({ ok: true, requiresRestart: wanted !== 'qq', runtime: { defaultUser: wanted }, runningUser: 'qq' });
        }
        if (body?.defaultAgent !== undefined) {
          state.defaultAgent = String(body.defaultAgent);
          return json({ ok: true, requiresRestart: true, runtime: { defaultAgent: state.defaultAgent }, runningAgent: 'dsh' });
        }
        return json({ ok: false, error: '没有可改的项（defaultAgent / defaultUser）' }, 400);
      }
      // 平台写口与探活（两侧同一条路径文法）。保存改 state 里的那一份（下一次拉注册表就能
      // 读回来），探活结论记在 state.agentProbes —— 控制台要验的是「按钮发对了请求、结论画出来了」。
      const platformWrite = path.match(/^\/api\/platforms\/registry\/(user|agent)\/([a-z][a-z0-9-]{0,15})\/(config|probe)$/);
      if (platformWrite && (method === 'PATCH' || method === 'POST')) {
        const [, side, platformId, action] = platformWrite;
        const patch = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
        if (side === 'agent') {
          if (!state.agentConfigs[platformId]) return json({ ok: false, error: `没有这个 Agent 平台：${platformId}` }, 404);
          if (action === 'config' && method === 'PATCH') {
            state.agentConfigs[platformId] = { ...state.agentConfigs[platformId], ...patch };
            const endpointKeys = ['baseUrl', 'authToken', 'authTokenExplicit', 'authHeader', 'authPrefix', 'allowRemote'];
            return json({ ok: true, requiresRestart: Object.keys(patch).some((key) => endpointKeys.includes(key)) });
          }
          if (action === 'probe' && method === 'POST') {
            state.agentProbes[platformId] = { ok: true, error: '', url: `http://127.0.0.1:3080/${platformId}`, at: timestamp };
            return json({ ok: true, probe: state.agentProbes[platformId] });
          }
          return json({ ok: false, error: '不支持的方法' }, 405);
        }
        if (!(platformId in state.userEnabled)) return json({ ok: false, error: `没有这个用户实例：${platformId}` }, 404);
        // 用户实例没有主动探活：入站通不通由装配过程记录，只有连接本身知道。
        if (action === 'probe') return json({ ok: false, error: '用户实例没有主动探活：入站结论见注册表的 inboundState' }, 400);
        if (method !== 'PATCH') return json({ ok: false, error: '不支持的方法' }, 405);
        const { enabled, defaultBehavior, ...fields } = patch;
        state.userConfigs[platformId] = { ...(state.userConfigs[platformId] ?? {}), ...fields };
        // 条目级默认行为：空串 = 清掉（新建会话回落到聊天模式），与写口的取值一样不做“补默认值”。
        if (defaultBehavior !== undefined) state.userDefaultBehaviors[platformId] = String(defaultBehavior ?? '');
        if (enabled !== undefined) {
          const next = enabled !== false;
          const changed = state.userEnabled[platformId] !== next;
          state.userEnabled[platformId] = next;
          // 条目开关只在真的翻了面时改变装配：改完重启才生效，勾着不改不该把在跑的连接写成“已断开”。
          if (changed) {
            state.userInbound[platformId] = next
              ? { state: 'closed', detail: '已启用，重启桥接后重新连接', at: timestamp }
              : { state: 'disabled', detail: '配置里停用了这条实例', at: timestamp };
          }
        }
        const transportKeys = ['wsUrl', 'httpUrl', 'accessToken', 'followDiscoveredEndpoint', 'viaPlatform', 'silenceWarnMs', 'launcherPath', 'homeDir'];
        const restart = enabled !== undefined || Object.keys(patch).some((key) => transportKeys.includes(key));
        return json({ ok: true, requiresRestart: restart });
      }
      if (path === '/api/config/send-limit') {
        if (method === 'GET') return json({ ok: true, send: state.limits.send });
        state.limits.send = { maxSendPerMinute: Number(body?.maxSendPerMinute) || 0, maxSendPerHour: Number(body?.maxSendPerHour) || 0 };
        return json({ ok: true, send: state.limits.send });
      }
      if (path === '/api/config/permission') {
        if (method === 'GET') {
          return json({ ok: true, permission: state.permission, levels: ['read-only', 'workspace-write', 'full-ask', 'full'], labels: PERMISSION_LABELS });
        }
        // 会话权限级别的档案里只有 default 一项。
        state.permission = { default: ['read-only', 'workspace-write', 'full-ask', 'full'].includes(body?.default) ? body.default : 'read-only' };
        return json({ ok: true, permission: state.permission });
      }
      if (method === 'POST' && /\/reset$/.test(path)) return json({ ok: true, requiresRestart: true });
      if (method === 'GET') {
        const profileMatch = path.match(/^\/api\/sessions\/([^/]+)\/profile$/);
        if (profileMatch) {
          const key = decodeURIComponent(profileMatch[1]);
          const capabilityId = fixtureSessionCapabilityId(state, key);
          const capability = fixtureCapabilities().find((item) => item.id === (capabilityId || 'chat-v2')) ?? null;
          return json({
            ok: true,
            key,
            displayName: state.displayNames?.[key] ?? '',
            sessionId: state.sessions.find((item) => item.key === key)?.sessionId ?? null,
            dsh: { label: 'DSH 已连接' },
            access: fixtureAccessSummary(state, key),
            // 会话级选择：`capability` 空 = 跟随平台默认；`behavior` 的 inherit = 用平台默认行为。
            capability: capabilityId || null,
            defaultCapability: 'chat-v2',
            capabilities: fixtureCapabilities().map((item) => ({ id: item.id, label: item.label, audience: item.audience })),
            behavior: state.sessionBehaviors?.[key] ?? 'inherit',
            defaultBehavior: state.userDefaultBehaviors.qq || null,
            behaviors: ['social-v1', 'social-v2'],
            effectiveMode: state.mode,
            apply: capability?.runtime.apply ?? 'preset',
            persona: { mode: 'inherit' },
            prompt: { maxChars: 2000, text: '', updatedAt: 0 },
            wake: { triggers: { atMention: true } },
            permission: fixturePermissionState(state, key),
            model: {},
            effectiveModel: { provider: state.dshProvider, model: state.dshModel },
          });
        }
        const sessionAgentMatch = path.match(/^\/api\/sessions\/([^/]+)\/agent$/);
        if (sessionAgentMatch) return json(fixtureSessionAgent(state, decodeURIComponent(sessionAgentMatch[1])));
        // 模型目录读口：`declared` 随注册表带回，这里只补实时目录整理出的 `view`。
        // 与真实桥接同一条语义：读不到也是结论（一律 200，靠 error / unsupported 说明）。
        const agentModelsMatch = path.match(/^\/api\/platforms\/registry\/agent\/([a-z][a-z0-9-]{0,15})\/models$/);
        if (agentModelsMatch) {
          const platformId = agentModelsMatch[1];
          if (!state.agentConfigs[platformId]) return json({ ok: false, error: `没有这个 Agent 平台：${platformId}` }, 404);
          if (platformId !== 'dsh') {
            return json({ ok: true, agent: platformId, declared: null, live: null, view: null, error: `${platformId} 没有声明 models 能力位`, unsupported: true });
          }
          return json({
            ok: true,
            agent: platformId,
            declared: FIXTURE_DSH_DECLARED,
            live: { groups: FIXTURE_DSH_PROVIDERS, failures: [] },
            view: { providers: FIXTURE_DSH_PROVIDERS, failures: [] },
            error: '',
            unsupported: false,
          });
        }
        switch (path) {
          case '/api/roles/limit':
            return json({
              ok: true,
              limits: { injectMaxChars: state.roleInjectMax },
              persona: { saveApply: state.roleSaveApply ?? 'nextWake' },
            });
          case '/api/status': {
            const allowed = state.access.passive.entries;
            const ids = (kind) => allowed.filter((key) => key.includes(`:${kind}:`)).map((key) => key.split(':').pop());
            return json({ ok: true, agent: { id: 'dsh', label: 'DeepSeek Harness', mode: 'http', ready: true }, platform: 'qq', snowluma: { connected: true, good: true, lastPacketAgoMs: 12000 }, mode: state.mode, role: state.role, roleMode: state.roleMode, ownerQQ: state.whitelist.ownerQQ, allowGroups: ids('group'), allowPrivate: ids('private'), activity: '[08:30:00] 演示桥接已连接\n[08:30:12] group:123456789 · 已处理一条消息\n[08:30:20] 二代社交助手正在运行\n以上均为离线模拟数据。' });
          }
          case '/api/behaviors/kinds': return json({ ok: true, kinds: listBehaviorTypes() });
          case '/api/runtime/capabilities': return json({
            ok: true,
            catalog: toolCatalogSnapshot(),
            capabilities: fixtureCapabilities(),
          });
          // 行为档案：`usedBy` 与真实桥接同形（显式挂它的会话 + 把它设为默认行为的用户平台）。
          case '/api/config/behaviors': return json({
            ok: true,
            behaviors: [
              { id: 'social-v1', file: 'social-v1.yml', label: '一代仿真', platform: 'qq', kind: 'social-v1', engine: 'v1', valid: true, builtin: true, usedBy: { sessions: [], platforms: [] } },
              { id: 'social-v2', file: 'social-v2.yml', label: '二代仿真', platform: 'qq', kind: 'social-v2', engine: 'v2', valid: true, builtin: true, usedBy: { sessions: ['group:123456789'], platforms: ['qq'] } },
            ],
          });
          // C1：平台统一注册表。控制台只读这一个端点回答「接了哪些平台、能不能用」。
          // 两侧都列（user / agent），诊断与汇总与真实桥接同形。C3 起 qq 有 connect()
          // （inbound: true），所以不再有 inbound_unsupported 这条诊断——预览也要照实反映。
          case '/api/platforms/registry': return json({
            ok: true,
            // 配置面（`configured`）由 state.defaultAgent 派生，运行期（`active`）恒为 dsh：
            // 切换默认执行体之后重拉快照，就能同时看到「待重启」与那条诊断。
            active: { user: 'qq', agent: 'dsh' },
            platforms: [
              {
                side: 'user',
                id: 'qq',
                label: 'QQ',
                note: '',
                source: 'builtin',
                owner: null,
                active: true,
                configured: state.defaultUser === 'qq',
                capabilities: ['group', 'direct', 'mention', 'reply', 'recall', 'poke', 'image', 'voice', 'sticker', 'file', 'forward', 'member-list', 'member-info'],
                conversationTypes: ['group', 'private'],
                limits: { chunkChars: 4000, markdown: false },
                inbound: true,
                rawEvent: true,
                enabled: state.userEnabled.qq,
                // 条目级默认行为：会话详情里「行为档案 › 跟随平台默认」读它。
                defaultBehavior: state.userDefaultBehaviors.qq,
                // 这条实例此刻的入站结论（open / closed / error / disabled / send-only / unregistered）。
                inboundState: state.userInbound.qq ?? null,
                // 插件 transport 优先、其次适配器：qq 只有内置适配器。
                outbound: { via: 'adapter', owner: null },
                // 配置面照抄 profiles/platforms/qq/platform.yml 的 configSchema：
                // 「平台 › 配置」那一栏要能真占出一张表，而不是永远空着。
                configSchema: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    account: { type: 'string', title: '账号名', description: '同一平台多账号时的名字；留空表示默认账号（会话 key 里不写 @账号）。' },
                    httpUrl: { type: 'string', title: 'OneBot HTTP 地址', description: '发送消息走这里。指向 WebSocket 端口会得到 HTTP 426。' },
                    wsUrl: { type: 'string', title: 'OneBot WebSocket 地址', description: '入站与主动拉取走这里；与 httpUrl 是同一后端的两个端口。' },
                    accessToken: { type: 'string', format: 'textarea', title: '访问令牌', description: 'QQ 后端里配置的 token；后端没开鉴权时留空。' },
                    followDiscoveredEndpoint: { type: 'boolean', title: '跟随发现的端点', description: '后端换了端口（如 SnowLuma 重启）时自动改用探测到的地址。' },
                    viaPlatform: { type: 'boolean', title: '经接口平台转发', description: '出站先交给 interface-platform，再由它转给 QQ 后端。' },
                    silenceWarnMs: { type: 'number', title: '静默告警阈值（毫秒）', description: '这么久没收到任何事件就打一条告警；0 表示不告警。' },
                  },
                },
                // 配置 v2 把「怎么连上」放在 transport、其余放 options，注册表拍平后交给控制台。
                // 写口（PATCH .../user/qq/config）存的就是 state 里这一份：改完再拉快照能读回来。
                config: { ...state.userConfigs.qq },
                assets: {
                  prompt: { active: true, hasDefault: true },
                  tools: [{ flag: 'sendGroup', label: '发群消息', desc: '往群里发一条消息', risk: 'send', defaultOff: false }],
                  behaviors: ['social-v1', 'social-v2'],
                  capabilityProfiles: [],
                },
              },
              {
                // 第二条用户实例：插件注册的平台，没有配置目录也没有 configSchema。
                // 条目被停用 —— 用来验「已停用」徽标、入站 disabled 与「设为默认实例」。
                side: 'user',
                id: 'wx',
                label: '微信',
                note: '',
                source: 'plugin',
                owner: 'wx-adapter',
                active: false,
                configured: state.defaultUser === 'wx',
                enabled: state.userEnabled.wx,
                defaultBehavior: state.userDefaultBehaviors.wx,
                capabilities: ['group', 'direct', 'reply'],
                conversationTypes: ['group', 'private'],
                limits: { chunkChars: 2000, markdown: false },
                inbound: true,
                rawEvent: true,
                inboundState: state.userInbound.wx ?? null,
                // 插件注册的平台出站走它自己的 transport，不是内置适配器。
                outbound: { via: 'transport', owner: 'wx-adapter' },
                configSchema: null,
                config: {},
                assets: { prompt: { active: false, hasDefault: false }, tools: [], behaviors: [], capabilityProfiles: [] },
              },
              {
                side: 'agent',
                id: 'dsh',
                label: 'DeepSeek Harness',
                note: '',
                source: 'builtin',
                owner: null,
                active: true,
                configured: state.defaultAgent === 'dsh',
                capabilities: ['session', 'rename', 'permission', 'models', 'settings', 'workspace', 'events', 'compact'],
                // 声明面三件套：能跑哪些应用方式、话术能走哪些通道、对端权限档可钉哪些值。
                applies: ['preset', 'passthrough'],
                promptChannels: ['prefix', 'tool'],
                peerPermissions: ['read-only', 'workspace-write', 'qq-full-ask'],
                conversationTypes: [],
                limits: {},
                inbound: false,
                // 配置面照抄 profiles/agent-platforms/dsh/agent-platform.yml。
                configSchema: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    baseUrl: { type: 'string', title: 'DSH 地址', description: '留空时自动发现（命令行版 3080 / 桌面版与 0.2.1 均为随机端口）。' },
                    authToken: { type: 'string', format: 'textarea', title: '鉴权令牌', description: '一般由桥接从 ~/.dsh/.credentials.yaml 自取。' },
                    authTokenExplicit: { type: 'boolean', title: '使用显式令牌', description: '为 true 时只用 authToken，不再自动读取凭据文件。' },
                    authHeader: { type: 'string', title: '鉴权头名称', description: '默认 Authorization；换成反代自己的头名时改这里。' },
                    authPrefix: { type: 'string', title: '鉴权前缀', description: '令牌前面的修饰词，默认 Bearer。' },
                    allowRemote: { type: 'boolean', title: '允许远程连接', description: '默认只连本机；打开后 baseUrl 可以指向另一台机器。' },
                  },
                },
                // 声明面（agent-platform.yml 的 modelCatalog）：模型、价目、档位与压缩点。
                // 配置页的模型卡先按它画出档位中文名，实时目录回来再补提供方与模型。
                modelCatalog: FIXTURE_DSH_DECLARED,
                // 写口（PATCH .../config）存的就是这一份：控制台改完再拉快照要能读回来。
                config: { ...state.agentConfigs.dsh },
                // 最近一次显式探活（POST .../probe）；null = 本次运行里还没探过。
                probe: state.agentProbes.dsh ?? null,
                assets: {
                  prompt: { active: false, hasDefault: false },
                  tools: [],
                  behaviors: [],
                  capabilityProfiles: ['chat', 'chat-v2', 'direct', 'full', 'readonly', 'workspace'],
                },
              },
              {
                // 第二个 Agent 平台：没被选中、也没设为默认。用来验「设为默认执行体」与多实例配置，
                // 不声明能力档 —— 可选的几套能力档都由 dsh 提供。
                side: 'agent',
                id: 'acp',
                label: 'ACP 执行体',
                note: '',
                source: 'builtin',
                owner: null,
                active: false,
                configured: state.defaultAgent === 'acp',
                capabilities: ['session', 'events'],
                applies: ['preset', 'passthrough'],
                promptChannels: ['system', 'tool'],
                peerPermissions: [],
                conversationTypes: [],
                limits: {},
                inbound: false,
                configSchema: {
                  type: 'object',
                  additionalProperties: true,
                  properties: {
                    command: { type: 'string', title: '启动命令', description: 'stdio 执行体的命令行；留空时按 agent-platform.yml 里的默认值。' },
                    args: { type: 'array', title: '参数', description: '逐项传给启动命令。' },
                    timeoutMs: { type: 'integer', title: '超时（毫秒）', description: '单轮调用的总时长上限。' },
                  },
                },
                // 没有声明 models 能力位的平台也就没有模型目录（声明面与实时都为空）。
                modelCatalog: null,
                config: { ...state.agentConfigs.acp },
                probe: state.agentProbes.acp ?? null,
                assets: {
                  prompt: { active: false, hasDefault: false },
                  tools: [],
                  behaviors: [],
                  capabilityProfiles: [],
                },
              },
            ],
            // 配置面与运行期选的不一致 = 刚改过、还没重启：与真实桥接同一条诊断（两侧各一条）。
            diagnostics: [
              ...(state.defaultAgent === 'dsh' ? [] : [{
                code: 'active_pending_restart',
                side: 'agent',
                platformId: state.defaultAgent,
                level: 'warn',
                message: `配置已把默认平台改为 ${state.defaultAgent}，本进程仍装配 dsh：重启桥接后生效`,
              }]),
              ...(state.defaultUser === 'qq' ? [] : [{
                code: 'active_pending_restart',
                side: 'user',
                platformId: state.defaultUser,
                level: 'warn',
                message: `配置已把默认实例改为 ${state.defaultUser}，本进程仍装配 qq：重启桥接后生效`,
              }]),
            ],
            summary: {
              total: 4,
              user: 2,
              agent: 2,
              errors: 0,
              warnings: (state.defaultAgent === 'dsh' ? 0 : 1) + (state.defaultUser === 'qq' ? 0 : 1),
            },
          });
          case '/api/presets': return json({ presets: [{ id: 'chat-v2', trust: 'user' }, { id: 'chat', trust: 'user' }] });
          // 以下几个是控制台「扩展」页在页面片段化之后新增的只读接口：预览也要给响应，
          // 否则 Playwright 的「没有未知 API / JS 错误」检查会被 404 打穿（真实桥接里它们都在）。
          case '/api/plugins': return json({
            ok: true,
            enabled: true,
            dir: 'plugins',
            plugins: [demoPlugin],
            persona: { plugin: null },
            coreBlocks: { blocks: [], catalog: [] },
            taskTypes: [],
            settings: { watch: false, filters: { inbound: false }, limits: { hookTimeoutMs: 2000, maxPromptAppendChars: 4000 }, install: { enabled: true } },
          });
          case '/api/prompt-blocks': return json({
            ok: true,
            profiles: ['wake', 'reminder', 'context'],
            slots: ['head', 'identity', 'behavior', 'resources', 'situation', 'action', 'tail'],
            platformPrompt: '【平台】你在 QQ 里说话。\n\n1. 引用只在必要时用。\n2. 分条发送。',
  limits: { total: 0, perBlockDefault: 0, roleInjectMaxChars: 6000 },
            stats: { total: 26, maxTotalChars: 0, renders: 12, injected: 40, skipped: 1 },
            blocks: [
              { id: 'core-role', pluginId: 'core', owner: 'core', label: '当前角色', priority: 100, slot: 'identity', timing: 'every-wake', reasons: [], profiles: ['wake'], enabled: true, maxChars: null, calls: 12, failures: 0, lastError: null, lastRunAt: Date.parse(timestamp), lastChars: 220, lastStatus: 'injected' },
              { id: 'core-identity', pluginId: 'core', owner: 'core', label: '你的身份', priority: 110, slot: 'identity', timing: 'every-wake', reasons: [], profiles: ['wake'], enabled: true, maxChars: null, calls: 12, failures: 0, lastError: null, lastRunAt: Date.parse(timestamp), lastChars: 180, lastStatus: 'injected' },
              { id: 'core-stickers', pluginId: 'core', owner: 'core', label: '表情包策略', priority: 170, slot: 'resources', timing: 'every-wake', reasons: [], profiles: ['wake'], enabled: false, maxChars: 1200, calls: 8, failures: 0, lastError: null, lastRunAt: Date.parse(timestamp), lastChars: 0, lastStatus: 'off' },
              { id: 'core-wake-task', pluginId: 'core', owner: 'core', label: '这次要做什么', priority: 100, slot: 'action', timing: 'reason', reasons: ['bootstrap', 'timeout', 'replyCheck'], profiles: ['wake'], enabled: true, maxChars: null, calls: 12, failures: 0, lastError: null, lastRunAt: Date.parse(timestamp), lastChars: 640, lastStatus: 'injected' },
              { id: 'core-slang', pluginId: 'core', owner: 'core', label: '群聊黑话表', priority: 110, slot: 'tail', timing: 'on-change', reasons: [], profiles: ['context'], enabled: true, maxChars: null, calls: 12, failures: 0, lastError: null, lastRunAt: Date.parse(timestamp), lastChars: 96, lastStatus: 'injected' },
              // 人格卡不经过注册表，由 /api/prompt-blocks 追加成虚拟块：开关与上限都在这里管。
              { id: 'core-persona', pluginId: 'core', owner: 'core', label: '人格卡（人格提示词正文）', priority: 0, slot: 'head', timing: 'every-wake', reasons: ['persona'], profiles: ['wake', 'reminder'], enabled: state.personaEnabled !== false, maxChars: 6000, calls: 0, lastChars: 0, lastError: null, lastRunAt: null, lastStatus: state.personaEnabled !== false ? 'injected' : 'off', synthetic: true },
            ],
          });
          case '/api/prompt-preview': return json({
            ok: true,
            profile: 'wake',
            reason: 'atMention',
            key: 'qq:group:123456789',
            chars: 812,
            maxTotalChars: 0,
            text: '【当前角色】演示角色（完整角色卡请调用 qq_get_prompt 查看）\n\n【你的身份】离线预览。\n\n【此刻状态】未读 1 条。',
            blocks: [
              { id: 'core-role', slot: 'identity', status: 'injected', chars: 220, text: '【当前角色】演示角色' },
              { id: 'core-identity', slot: 'identity', status: 'injected', chars: 180, text: '【你的身份】离线预览。' },
            ],
          });
          case '/api/commands': return json({
            ok: true,
            bridge: { builtin: [{ id: 'reset', name: '/reset', aliases: ['/new'], scope: 'all', permission: 'owner', group: '会话', description: '重置会话' }], plugin: [] },
            dsh: [{ name: '/compact', note: '桥接在上下文压缩时调用，由 DSH 执行' }],
            tools: [{ name: 'web_search', source: 'src/mcp-web-search-safe.js', managed: 'dsh' }],
          });
          case '/api/extensions/presets': return json({
            ok: true,
            presets: [
              {
                id: 'chat',
                name: 'QQ 群聊',
                description: '离线预览用的安全群聊预设。',
                order: 1,
                editable: true,
                builtin: true,
                error: null,
                hasExtensions: true,
                extensions: { mcp: { allow: ['*'], tools: { allow: [], deny: [] } }, skills: { allow: ['*'] } },
              },
              {
                id: 'chat-v2',
                name: 'QQ 群聊（二代）',
                description: '离线预览用的二代群聊预设。',
                order: 2,
                editable: true,
                builtin: true,
                error: null,
                hasExtensions: true,
                extensions: { mcp: { allow: ['*'], tools: { allow: ['*'], deny: [] } }, skills: { allow: ['*'] } },
              },
              {
                id: 'demo-agent',
                name: '演示预设',
                description: '离线预览用的自建预设，persona 提示词为空。',
                order: 3,
                editable: true,
                builtin: false,
                error: null,
                hasExtensions: false,
                extensions: { mcp: { allow: ['*'], tools: { allow: [], deny: [] } }, skills: { allow: [] } },
              },
            ],
          });
          case '/api/extensions/presets/chat': return json({
            ok: true,
            preset: {
              id: 'chat',
              meta: { name: 'QQ 群聊（一代）', description: '离线预览用的群聊预设。', order: 1 },
              extensions: { mcp: { allow: ['*'], tools: { allow: [], deny: [] } }, skills: { allow: ['*'] } },
              extensionsExists: true,
              agent: [
                { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '测试用提示词。' } },
                { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { search: false, fetch: false, searchTimeoutMs: 60000 } },
                { id: 'qq-tool-restrict', name: 'qq-agent-presets/qq-tool-restrict.mjs', config: { profile: 'chat' } },
              ],
              agentYaml: '- id: persona\n  name: ./persona\n  config:\n    prefix: 测试用提示词。\n- id: tool-web\n  name: ./tool-web\n  config:\n    search: false\n- id: qq-tool-restrict\n  name: qq-agent-presets/qq-tool-restrict.mjs\n',
              validation: { ok: true, rows: 3 },
              backups: [],
            },
          });
          case '/api/extensions/presets/chat-v2': return json({
            ok: true,
            preset: {
              id: 'chat-v2',
              meta: { name: 'QQ 群聊（二代）', description: '离线预览用的二代群聊预设。', order: 2 },
              extensions: { mcp: { allow: ['*'], tools: { allow: ['*'], deny: [] } }, skills: { allow: ['*'] } },
              extensionsExists: true,
              agent: [
                { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '测试用提示词。' } },
                { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { search: false, fetch: false, searchTimeoutMs: 60000 } },
                { id: 'qq-tool-restrict', name: 'qq-agent-presets/qq-tool-restrict.mjs', config: { profile: 'chat' } },
              ],
              agentYaml: '- id: persona\n  name: ./persona\n  config:\n    prefix: 测试用提示词。\n- id: tool-web\n  name: ./tool-web\n  config:\n    search: false\n- id: qq-tool-restrict\n  name: qq-agent-presets/qq-tool-restrict.mjs\n',
              validation: { ok: true, rows: 3 },
              backups: [],
            },
          });
          case '/api/extensions/presets/demo-agent': return json({
            ok: true,
            preset: {
              id: 'demo-agent',
              meta: { name: '演示预设', description: '离线预览用的自建预设，persona 提示词为空。', order: 3 },
              extensions: { mcp: { allow: ['*'], tools: { allow: [], deny: [] } }, skills: { allow: [] } },
              extensionsExists: false,
              agent: [
                { id: 'persona', name: '@deepseek-ai/dsh-persona' },
                { id: 'qq-tool-restrict', name: 'qq-agent-presets/qq-tool-restrict.mjs', config: {} },
              ],
              agentYaml: '- id: persona\n  name: ./persona\n- id: qq-tool-restrict\n  name: qq-agent-presets/qq-tool-restrict.mjs\n  config: {}\n',
              validation: { ok: true, rows: 2 },
              backups: [],
            },
          });
          case '/api/extensions/skills': return json({
            ok: true,
            skills: [
              { id: 'demo-skill', name: 'demo-skill', description: '离线预览用的假技能。', path: 'C:/fixture/skills/demo-skill', source: 'dsh', editable: false, active: true },
              { id: 'demo-external', name: 'demo-external', description: '离线预览用的外部技能。', path: 'C:/fixture/extensions/skills/demo-external', source: 'user', editable: true, active: true },
            ],
          });
          case '/api/platform/prompts': return json({ ok: true, prompts: [{ id: 'qq', platform: 'QQ', chars: PLATFORM_PROMPT_SAMPLE.length }] });
        case '/api/platform/prompts/qq': return json({ ok: true, id: 'qq', platform: 'QQ', text: PLATFORM_PROMPT_SAMPLE, chars: PLATFORM_PROMPT_SAMPLE.length, isFactory: true });
        case '/api/capabilities': return json({ ok: true, capability: { id: body?.id ?? 'new-cap' }, capabilities: [] });
        case '/api/extensions': return json({
            ok: true,
            version: 2,
            generatedAt: Date.parse(timestamp),
            skills: [{ id: 'demo-skill', name: 'demo-skill', description: '离线预览用的假技能。', path: 'C:/fixture/skills/demo-skill' }],
            mcp: [{
              id: 'snowluma-host',
              name: 'snowluma-host',
              file: 'src/mcp-host-server.js',
              note: 'SnowLuma 网关状态，只读',
              status: 'online',
              toolCount: 1,
              tools: [{ name: 'snowluma_status', description: '读取网关状态' }],
            }, {
              id: 'test-ext',
              name: 'test-ext',
              source: 'external',
              transport: 'stdio',
              file: 'extensions/mcp/test-ext/server.json',
              note: '外部测试 server',
              status: 'running',
              toolCount: 1,
              tools: [{ name: 'demo_tool', description: '外部测试工具' }],
            }],
            summary: { servers: 2, online: 2, errors: 0, tools: 2, skills: 1 },
          });
          case '/api/persona/sources': return json({ ok: true, provider: null, rows: [] });
          case '/api/persona/external': return json({
            ok: true,
            provider: 'soulkit',
            listable: true,
            stale: false,
            error: null,
            capabilities: { perSession: true, conditional: true, listable: true },
            cards: Object.entries(state.externalPersonas).map(([name, card]) => ({
              name,
              slug: card.slug,
              description: card.description,
              systemAppendChars: card.systemAppend.length,
              overlayChars: card.overlay.length,
              updatedAt: Date.parse(timestamp),
              hasText: true,
              stale: false,
            })),
          });
          case '/api/personas': {
            const builtin = new Set(['小鲸鱼', '傲娇助手']);
            const items = state.roles.map((name) => ({
              uid: `local:${name}`,
              source: 'local',
              id: name,
              name,
              description: '',
              chars: (state.roleContents[name] ?? '').length,
              updatedAt: Date.parse(timestamp),
              default: state.role === name,
              builtin: builtin.has(name),
              deletable: !builtin.has(name),
              resettable: builtin.has(name),
              capabilities: { create: true, update: true, rename: true, remove: true },
              cached: true,
              stale: false,
            }));
            for (const [name, card] of Object.entries(state.externalPersonas)) {
              const text = card.text ?? `# ${name}\n\n${card.overlay || ''}\n${card.systemAppend || ''}`.trim();
              items.push({
                uid: `soulkit:${card.slug ?? name}`,
                source: 'provider',
                provider: 'soulkit',
                id: card.slug ?? name,
                name,
                description: card.description,
                chars: text.length,
                updatedAt: Date.parse(timestamp),
                default: state.role === name,
                builtin: false,
                deletable: false,
                resettable: false,
                capabilities: { create: true, update: true, rename: false, remove: false },
                cached: true,
                stale: Boolean(card.stale),
              });
            }
            return json({
              ok: true,
              default: items.find((item) => item.default)?.uid ?? null,
              items,
              providers: [{
                id: 'soulkit',
                online: true,
                capabilities: { catalog: true, create: true, update: true, rename: false, remove: false },
              }],
              providerErrors: {},
            });
          }
          case '/api/config/role-default': return json({
            ok: true,
            value: state.role ?? null,
            options: state.roles.slice(),
            external: Object.keys(state.externalPersonas ?? {}).filter((name) => !state.roles.includes(name)),
          });
          case '/api/roles': return json({
            roles: state.roles.slice(),
            summaries: state.roles.map((name) => {
              const content = state.roleContents[name] ?? '';
              const stats = roleCharStats(content);
              const injectMax = state.roleInjectMax;
              return {
                name,
                bytes: Buffer.byteLength(content, 'utf8'),
                chars: content.length,
                lines: content.split('\n').length,
                mtime: Date.parse(timestamp),
                excerpt: content.split('\n').find((line) => line.trim() && !line.trim().startsWith('#')) ?? '',
                injectedV1: Math.min(stats.v1, injectMax),
                injectedV2: Math.min(stats.v2, injectMax),
                charsV1: stats.v1,
                charsV2: stats.v2,
                hasModeTags: stats.v1Only > 0 || stats.v2Only > 0,
                truncated: stats.v1 > injectMax || stats.v2 > injectMax,
                warnings: 0,
              };
            }),
            current: state.role,
            assignments: [...new Set([...state.roleKnownKeys, ...Object.keys(state.roleByKey)])].sort().map((key) => {
              const has = Object.hasOwn(state.roleByKey, key);
              const role = has ? state.roleByKey[key] : state.role;
              return { key, source: !has ? 'global' : role === null ? 'off' : 'key', role, missing: !!role && !state.roles.includes(role) };
            }),
            limits: { nameMax: 40, contentMaxBytes: 65536, injectMaxChars: state.roleInjectMax },
          });
          case '/api/roles/content': {
            const name = url.searchParams.get('name') ?? '';
            if (!state.roleContents[name]) return json({ ok: false, error: `人格「${name}」不存在` }, 404);
            const content = state.roleContents[name];
            return json({
              ok: true,
              name,
              content,
              chars: content.length,
              bytes: Buffer.byteLength(content, 'utf8'),
              warnings: [],
              limits: { injectMaxChars: state.roleInjectMax },
              stats: roleCharStats(content),
              sections: { v1: roleSectionReport(content, 'v1'), v2: roleSectionReport(content, 'v2') },
            });
          }
          case '/api/preset/sim-prompt': {
            const preset = String(url.searchParams.get('preset') || 'chat-v2');
            const content = state.simPrompts[preset] ?? '';
            const initial = state.simDefaults[preset];
            return json({
              ok: true,
              content,
              chars: content.length,
              bytes: Buffer.byteLength(content, 'utf8'),
              warnings: [],
              status: presetStatusFixture(preset),
              presets: [presetStatusFixture('chat'), presetStatusFixture('chat-v2')],
              hasDefault: initial !== undefined,
              modified: content !== (initial ?? ''),
              defaultContent: initial ?? '',
              defaultChars: (initial ?? '').length,
            });
          }
          case '/api/preset/sim-prompt/backups': {
            const preset = String(url.searchParams.get('preset') || 'chat-v2');
            return json({ ok: true, backups: [{ file: `${preset}.capability.yml.fixture`, mtime: Date.parse(timestamp) }] });
          }
          case '/api/memory/entries': return json({ ok: true, provider: 'local-digest', key: url.searchParams.get('key') || '', data: memoryEntryList(state, url.searchParams.get('key') || '') });
        case '/api/memory/sessions': return json({ ok: true, provider: 'local-digest', sessions: memorySessions(state) });
          case '/api/memory': return json({ ok: true, config: state.memoryConfig, status: memoryStatusOf(state), ingest: ingestStatusOf(state), promptBlocks: { maxTotalChars: 200000, blocks: [] } });
          case '/api/whitelist': return json(state.whitelist);
          case '/api/access': return json({ ok: true, access: state.access });
          case '/api/sessions': return json({ sessions: state.sessions });
          case '/api/pending': return json({ pending: [{ key: 'group:123456789', kind: 'approval', toolName: '演示工具', reason: '等待管理员确认（离线示例）' }] });
          case '/api/social': return json({ config: state.social, states: state.socialStates, pendingSummaries: { 'group:123456789': 2 } });
          case '/api/socialV2/config': return json({ ok: true, config: state.v2 });
          case '/api/socialV2/activity': return json({ ok: true, paused: state.paused });
          case '/api/socialV2/tool-log': return json({ ok: true, entries: state.toolLog });
          case '/api/socialV2/feedback': return json({ ok: true, entries: state.feedback });
          case '/api/socialV2/memory': return json({ ok: true, raw: { activeTopics: [{ text: '周末的阅读计划', pendingQuestion: '有没有推荐的书？' }], pendingThoughts: [{ text: '分享一张风景照片', motivation: '轻松交流' }], memberImpressions: { 演示群友: { traits: ['友善', '喜欢技术'], interactionCount: 6 } } } });
          case '/api/socialV2/state': return json({ ok: true, key: url.searchParams.get('key'), wakeConfig: { mode: 'diving', infinite: false, sleepUntil: '2026-09-20T09:00:00.000Z', triggers: { atMention: true, keywords: ['小鲸鱼'] }, wakeCount: 4 }, wakeSafety: { guaranteed: true }, unreadCount: 2, lastWakeReason: 'atMention' });
          case '/api/socialV2/states': return json({ ok: true, conversations: state.sessions.map(x => ({ key: x.key, phase: 'diving', unreadCount: 2 })) });
          case '/api/socialV2/initial-prompt': {
            const key = url.searchParams.get('key') || '';
            if (!key) {
              return json({
                ok: true,
                maxChars: 2000,
                writable: true,
                entries: state.initPrompt
                  ? [{ key: 'group:123456789', chars: String(state.initPrompt).length, updatedAt: Date.now(), preview: String(state.initPrompt).slice(0, 80) }]
                  : []
              });
            }
            return json({
              ok: true, key, exists: !!state.initPrompt, text: state.initPrompt || '',
              createdAt: Date.now(), updatedAt: Date.now(), maxChars: 2000, writable: true
            });
          }
          // 语音库（离线示例：不含任何真实音频路径）
          case '/api/voice/list':
          case '/api/socialV2/voices': return json({
            ok: true,
            key: url.searchParams.get('key') || 'group:123456789',
            count: 2,
            voices: [
              { name: '演示-问候.mp3', ok: true, bytes: 20480, detail: '2秒 · 20.0 KB · mp3 · 24.0kHz · 单声道', seconds: 2 },
              { name: '演示-太长.wav', ok: false, bytes: 99999999, error: '时长 12分00秒 超过上限 5分00秒' },
            ],
            limits: { maxSeconds: 300, maxBytes: 20971520, maxPerMinute: 2, maxPerHour: 10 },
            hint: '用 qq_send_voice 传 name 即可把其中一个当语音发出去',
          });
          case '/api/slang': return json({ ok: true, entries: state.slang, config: state.slangConfig });
          case '/api/compact/config': return json({ ok: true, ...state.compact, cooldownMinutes: 120, idleDelayMs: 20000, approxTokens: FIXTURE_DSH_DECLARED.compact.approxTokens, min: 50000, sessions: [{ key: 'group:10001', inputTokens: 680000, lastAttemptAt: null }, { key: 'group:10002', inputTokens: 120000, lastAttemptAt: null }] });
          case '/api/roles/defaults': return json({ ok: true, current: '小鲸鱼', defaults: [{ name: '傲娇助手', exists: !!state.restoredTsundere, modified: false }, { name: '小鲸鱼', exists: true, modified: !state.restoredWhale }] });
          case '/api/stickers/describe': return json({ ok: true, total: 21, undescribed: state.stickerDescribed ? 0 : 10, running: false, progress: { done: 0, total: 0 }, last: state.stickerDescribed ? { ok: true, text: '补好 10 张，其中 2 张偏凶或带粗口，已标「慎用」，所有表情都有说明了' } : null, blocker: '', model: 'deepseek-flash', max: 20 });
          // state/ 的 ACL 收紧结果：用离线示例值演示「未收紧」的告警条（Windows 上未提权时的真实情况）
          // 命令本身必须来自 `src/state-acl.mjs`，不能在这里另抄一份：这里曾经抄的是
          // `icacls DIR /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F" /T /C` —— 正是那句
          // 会把子文件 DACL 清空、让桥接读不到自己令牌的破坏性命令。示例数据是给人照抄的，
          // 抄错的那一版和真的那一版看起来一模一样。
          case '/api/security': return json({
            ok: true,
            security: state.security,
            stateDir: state.hardenStateDir
              ? { hardened: true, path: 'D:\\demo\\qq-bridge\\state', manualCommand: '' }
              : { hardened: false, path: 'D:\\demo\\qq-bridge\\state', manualCommand: manualDirCommand('D:\\demo\\qq-bridge\\state') }
          });
          // 令牌与花费：全部为离线示例数据，不含任何真实用量。
          case '/api/tokens/summary': return json(usageSummaryFixture());
          case '/api/tokens/series': return json(usageSeriesFixture(url.searchParams.get('hours')));
          case '/api/tokens/turns': return json(usageTurnsFixture(url.searchParams.get('key')));
          case '/api/tokens/recent': return json({ ok: true, symbol: '¥', entries: usageRecentFixture() });
        }
      }
      if (method === 'PATCH' || method === 'DELETE') {
        if (method === 'PATCH' && path === '/api/access') {
          const axis = (raw) => ({
            mode: raw?.mode === 'deny' ? 'deny' : 'allow',
            entries: Array.isArray(raw?.entries) ? raw.entries.map(String) : [],
          });
          state.access = { passive: axis(body?.passive), proactive: axis(body?.proactive) };
          return json({ ok: true, access: state.access });
        }
        if (method === 'PATCH' && path.startsWith('/api/runtime/capabilities/')) {
          const id = decodeURIComponent(path.slice('/api/runtime/capabilities/'.length));
          state.capabilityPatches = state.capabilityPatches ?? {};
          state.capabilityPatches[id] = body;
          return json({ ok: true, capability: { id, label: body?.label, note: body?.note, tools: body?.tools, builtin: true, platformVisible: [], agentModules: [], hasRows: true, rowsCount: 2 } });
        }
        // 会话档案：与真实 PATCH 同一条落点（capability 空 = 跟随平台默认，behavior 的 inherit = 用平台默认行为）。
        const profilePatch = path.match(/^\/api\/sessions\/([^/]+)\/profile$/);
        if (method === 'PATCH' && profilePatch) {
          const key = decodeURIComponent(profilePatch[1]);
          if (body.displayName !== undefined) state.displayNames = { ...(state.displayNames ?? {}), [key]: String(body.displayName) };
          if (body.capability !== undefined) state.sessionCapabilities = { ...(state.sessionCapabilities ?? {}), [key]: String(body.capability ?? '') };
          if (body.behavior !== undefined) state.sessionBehaviors = { ...(state.sessionBehaviors ?? {}), [key]: String(body.behavior ?? '') || 'inherit' };
          if (body.permission !== undefined) state.sessionPermissions = { ...(state.sessionPermissions ?? {}), [key]: String(body.permission ?? '') || 'inherit' };
          return json({ ok: true, key, permission: fixturePermissionState(state, key), accessPersisted: true });
        }
        if (path === '/api/memory/sessions' && method === 'DELETE') {
          const key = String(body.key || '');
          const existed = Boolean(state.memoryEntries && state.memoryEntries[key]);
          if (existed) delete state.memoryEntries[key];
          return json({ ok: true, key, removed: existed });
        }
        if (path === '/api/memory/entries') {
          const key = String(body.key || '');
          const bucket = memoryBucket(state, key);
          const map = { topic: 'topics', thought: 'thoughts', impression: 'impressions', rule: 'rules' };
          const field = map[String(body.category || '')];
          if (!field) return json({ ok: false, error: 'category 必须是 topic/thought/impression/rule' }, 400);
          const idx = bucket[field].findIndex((x) => String(x.id) === String(body.id));
          if (idx < 0) return json({ ok: false, error: '条目不存在' }, 404);
          if (method === 'DELETE') {
            bucket[field].splice(idx, 1);
            return json({ ok: true, removed: true });
          }
          const item = bucket[field][idx];
          if (body.category === 'impression') {
            if (Array.isArray(body.extra?.traits)) item.traits = body.extra.traits;
            if (body.extra?.interactionCount != null) item.interactionCount = Number(body.extra.interactionCount) || 0;
          } else if (body.category === 'topic') {
            if (body.content != null) item.text = String(body.content);
            if (body.extra?.participants) item.participants = body.extra.participants;
            if (body.extra?.pendingQuestion != null) item.pendingQuestion = body.extra.pendingQuestion;
          } else {
            if (body.content != null) item.text = String(body.content);
            if (body.extra?.motivation != null) item.motivation = body.extra.motivation;
          }
          return json({ ok: true, item });
        }
        if (method === 'PATCH' && path === '/api/config/promptBlocks') {
          state.promptBlockPatches = body;
          const personaMax = Number(body.promptBlocks?.['core-persona']?.maxChars);
          if (personaMax >= 1000) state.roleInjectMax = personaMax;
          if (typeof body.promptBlocks?.['core-persona']?.enabled === 'boolean') state.personaEnabled = body.promptBlocks['core-persona'].enabled;
          return json({ ok: true, promptBlocks: body.promptBlocks ?? {}, limits: { total: body.limits?.total ?? 0, perBlockDefault: body.limits?.perBlockDefault ?? 0, roleInjectMaxChars: state.roleInjectMax }, coreBlocks: { total: 0, maxTotalChars: 0 } });
        }
        return json({ ok: false, error: 'not found' }, 404);
      }
      if (method === 'POST') {
        switch (path) {
          case '/api/prompt-preview':
            return json({ ok: true, profile: body.profile || 'wake', reason: body.reason || 'atMention', key: body.key || 'qq:group:123456789', chars: 812, maxTotalChars: 0, text: '【当前角色】演示角色（完整角色卡请调用 qq_get_prompt 查看）\n\n【你的身份】离线预览。', blocks: [{ id: 'core-role', slot: 'identity', status: 'injected', chars: 220, text: '【当前角色】演示角色' }] });
          case '/api/config/promptBlocks':
            return json({ ok: true, promptBlocks: body.promptBlocks ?? {}, limits: body.limits ?? { total: 0, perBlockDefault: 0 }, coreBlocks: { blocks: [], total: 0, maxTotalChars: 0 } });
          case '/api/compact/config': {
            if (!['early', 'agent'].includes(body.mode)) return json({ ok: false, error: '压缩方式只能是「提前压缩」或「交给 Agent 平台」' }, 400);
            const blank = body.thresholdWan === undefined || body.thresholdWan === null || body.thresholdWan === '';
            if (body.mode === 'early' && !blank && !(Number(body.thresholdWan) >= 5 && Number(body.thresholdWan) <= 80)) return json({ ok: false, error: '压缩阈值要在 5～80 万 token 之间（平台自己在 80 万左右压）' }, 400);
            state.compact = { mode: body.mode, thresholdTokens: body.mode === 'early' && !blank ? Math.round(Number(body.thresholdWan) * 10000) : null };
            return json({ ok: true, ...state.compact, approxTokens: FIXTURE_DSH_DECLARED.compact.approxTokens });
          }
          case '/api/roles/assign': {
            if (!/^(?:[a-z][a-z0-9-]{0,15}:)?(group|private):[1-9]\d*$/.test(String(body.key ?? ''))) return json({ ok: false, error: '会话格式应为 qq:group:群号 或 qq:private:QQ号' }, 400);
            if (body.use === 'default') delete state.roleByKey[body.key];
            else if (body.use === 'off') state.roleByKey[body.key] = null;
            else if (body.use === 'role' && state.roles.includes(body.role)) state.roleByKey[body.key] = body.role;
            else return json({ ok: false, error: `人格「${body.role}」不存在` }, 400);
            const has = Object.hasOwn(state.roleByKey, body.key);
            const role = has ? state.roleByKey[body.key] : state.role;
            return json({ ok: true, key: body.key, use: body.use, role, source: !has ? 'global' : role === null ? 'off' : 'key', refresh: body.apply === 'immediate' ? { apply: 'immediate', mode: 'reserved2', woke: 1, pending: 0 } : { apply: 'nextWake', mode: 'reserved2', woke: 0, pending: 1 } });
          }
          case '/api/roles/restore-default':
            if (body.name === '小鲸鱼') { state.restoredWhale = true; return json({ ok: true, name: '小鲸鱼', created: false, unchanged: false, backup: '小鲸鱼-20261026-090000.md', refresh: { apply: body.apply || 'nextWake', woke: [], pending: 2 } }); }
            state.restoredTsundere = true; return json({ ok: true, name: body.name, created: true, unchanged: false, backup: null, refresh: { apply: body.apply || 'nextWake', notActive: true } });
          case '/api/stickers/describe': state.stickerDescribed = true; return json({ ok: true, started: true, total: 21, undescribed: 10, running: true, progress: { done: 0, total: 10 }, last: null, blocker: '', model: 'deepseek-flash', max: 20 });
          case '/api/persona/external/card': {
            const card = state.externalPersonas[body.name];
            if (!card) return json({ ok: false, error: '角色卡不存在' }, 404);
            const text = `【人格卡：${body.name}｜${'a1b2c3d4e5'}】\n${card.overlay}\n${body.name} 的 soul\n${card.systemAppend}`;
            return json({ ok: true, name: body.name, text, chars: text.length });
          }
          case '/api/persona/external/detail': {
            const card = state.externalPersonas[body.name];
            if (!card) return json({ ok: false, error: '角色卡不存在' }, 404);
            return json({ ok: true, stale: false, character: { name: body.name, slug: card.slug, description: card.description, overlay: card.overlay, systemAppend: card.systemAppend } });
          }
          case '/api/persona/external/save': {
            const card = state.externalPersonas[body.name];
            if (!card) return json({ ok: false, error: '角色卡不存在' }, 404);
            if (typeof body.description === 'string') card.description = body.description;
            if (typeof body.overlay === 'string') card.overlay = body.overlay;
            if (typeof body.systemAppend === 'string') card.systemAppend = body.systemAppend;
            return json({ ok: true, name: body.name, message: '已保存' });
          }
          case '/api/persona/external/rename': {
            const card = state.externalPersonas[body.name];
            if (!card) return json({ ok: false, error: '角色卡不存在' }, 404);
            const next = String(body.nextName ?? '').trim();
            if (!next) return json({ ok: false, error: '新名字为空' }, 400);
            delete state.externalPersonas[body.name];
            state.externalPersonas[next] = { ...card, slug: next };
            return json({ ok: true, name: next });
          }
          case '/api/persona/external/save-as-role': {
            const as = String(body.as ?? '').trim();
            if (!as) return json({ ok: false, error: '缺少内部人格名' }, 400);
            if (!state.roles.includes(as)) state.roles.push(as);
            const text = String(body.text ?? `# ${as}\n\n- 从外部人格另存。`);
            state.roleContents[as] = text;
            return json({ ok: true, name: as, chars: text.length, message: `已另存为「${as}」` });
          }
          case '/api/personas/default': {
            const uid = String(body.uid ?? '');
            if (uid.startsWith('local:')) state.role = uid.slice('local:'.length);
            return json({ ok: true, value: state.role });
          }
          case '/api/personas/update': {
            const uid = String(body.uid ?? '');
            const text = String(body.text ?? '');
            if (uid.startsWith('local:')) state.roleContents[uid.slice('local:'.length)] = text;
            else if (uid.startsWith('soulkit:')) {
              const id = uid.slice('soulkit:'.length);
              for (const [name, card] of Object.entries(state.externalPersonas)) {
                if ((card.slug ?? name) === id) card.text = text;
              }
            }
            return json({ ok: true });
          }
          case '/api/personas/delete': {
            const uid = String(body.uid ?? '');
            if (uid.startsWith('local:')) {
              const name = uid.slice('local:'.length);
              const at = state.roles.indexOf(name);
              if (at >= 0) state.roles.splice(at, 1);
              delete state.roleContents[name];
              if (state.role === name) state.role = null;
            } else if (uid.startsWith('soulkit:')) {
              const id = uid.slice('soulkit:'.length);
              for (const [name, card] of Object.entries(state.externalPersonas)) {
                if ((card.slug ?? name) === id) delete state.externalPersonas[name];
              }
            }
            return json({ ok: true });
          }
          case '/api/personas/create': {
            const name = String(body.name ?? '').trim();
            if (!name) return json({ ok: false, error: '缺少人格名' }, 400);
            if (!state.roles.includes(name)) state.roles.push(name);
            state.roleContents[name] = String(body.text ?? '');
            return json({ ok: true, uid: `local:${name}`, name });
          }
          case '/api/config/role-default': {
            const value = typeof body.value === 'string' ? body.value.trim() : '';
            if (value && !state.roles.includes(value)) {
              // 外部人格：桥接会先另存为内部人格再设为默认，这里用同样的语义。
              if (!state.externalPersonas || !state.externalPersonas[value]) {
                return json({ ok: false, error: `人格「${value}」不存在` }, 400);
              }
              state.roles.push(value);
              state.roleContents[value] = `【人格卡：${value}】\n（fixture 另存）`;
            }
            state.role = value || null;
            return json({ ok: true, value: state.role, message: value ? `已设为「${value}」，下一条消息生效` : '已清空默认人格' });
          }
          case '/api/role': state.role = body.role; return json({ ok: true, role: body.role, refresh: body.apply === 'immediate' ? { apply: 'immediate', mode: 'reserved2', woke: 2, pending: 0 } : { apply: 'nextWake', mode: 'reserved2', woke: 0, pending: 3 } });
          case '/api/roles/create': state.roles.push(body.name); state.roleContents[body.name] = body.content ?? ''; return json({ ok: true, role: body.name, warnings: [] });
          case '/api/roles/update': state.roleContents[body.name] = body.content ?? ''; return json({ ok: true, role: body.name, chars: String(body.content ?? '').length, warnings: [], refresh: body.name !== state.role ? { apply: body.apply || 'nextWake', notActive: true } : body.apply === 'immediate' ? { apply: 'immediate', mode: 'reserved2', woke: 2, pending: 0 } : { apply: 'nextWake', mode: 'reserved2', woke: 0, pending: 3 } });
          case '/api/roles/rename': {
            const idx = state.roles.indexOf(body.from);
            if (idx >= 0) state.roles[idx] = body.to;
            state.roleContents[body.to] = state.roleContents[body.from] ?? '';
            delete state.roleContents[body.from];
            if (state.role === body.from) state.role = body.to;
            return json({ ok: true, role: body.to, renamed: true, currentFollowed: state.role === body.to });
          }
          case '/api/roles/delete': {
            const idx = state.roles.indexOf(body.name);
            if (idx >= 0) state.roles.splice(idx, 1);
            delete state.roleContents[body.name];
            const cleared = state.role === body.name;
            if (cleared) state.role = null;
            return json({ ok: true, deleted: body.name, clearedCurrent: cleared });
          }
          case '/api/roles/limit':
            if (method === 'GET') {
              return json({
                ok: true,
                limits: { injectMaxChars: state.roleInjectMax },
                persona: { saveApply: state.roleSaveApply ?? 'nextWake' },
              });
            }
            state.roleSaveApply = body.saveApply === 'immediate' ? 'immediate' : 'nextWake';
            return json({
              ok: true,
              saveApply: state.roleSaveApply,
              limits: { injectMaxChars: state.roleInjectMax, source: 'promptBlocks.core-persona.maxChars' },
            });
          case '/api/preset/sim-prompt': {
            const preset = String(body.preset || 'chat-v2');
            const content = String(body.content ?? '');
            const unchanged = content === state.simPrompts[preset];
            if (!unchanged) state.simPrompts[preset] = content;
            return json({ ok: true, unchanged, chars: content.length, warnings: [], synced: true, requiresRestart: !unchanged, status: presetStatusFixture(preset) });
          }
          case '/api/preset/sim-prompt/reset': {
            const preset = String(body.preset || 'chat-v2');
            state.simPrompts[preset] = state.simDefaults[preset];
            return json({ ok: true, restored: true, chars: state.simDefaults[preset].length, warnings: [], requiresRestart: true, status: presetStatusFixture(preset) });
          }
          case '/api/preset/sim-prompt/restore': {
            const preset = String(body.preset || 'chat-v2');
            return json({ ok: true, restoredFrom: `${preset}.capability.yml.fixture`, requiresRestart: true });
          }
          case '/api/memory/entries': {
            const key = String(body.key || '');
            const bucket = memoryBucket(state, key);
            if (!key) return json({ ok: false, error: '缺少 key' }, 400);
            const category = String(body.category || '');
            const map = { topic: 'topics', thought: 'thoughts', impression: 'impressions', rule: 'rules' };
            const field = map[category];
            if (!field) return json({ ok: false, error: 'category 必须是 topic/thought/impression/rule' }, 400);
            const idPrefix = { topic: 't_', thought: 'w_', impression: 'i_', rule: '' }[category];
            const id = idPrefix + (++bucket.seq);
            const item = category === 'impression'
              ? { id, target: String(body.extra?.target || ''), traits: body.extra?.traits || [], interactionCount: Number(body.extra?.interactionCount) || 0, lastSeenAt: Date.now() }
              : category === 'topic'
                ? { id, text: String(body.content || ''), participants: body.extra?.participants || [], pendingQuestion: body.extra?.pendingQuestion || '', lastMentionAt: Date.now() }
                : category === 'thought'
                  ? { id, text: String(body.content || ''), motivation: body.extra?.motivation || '', at: Date.now() }
                  : { id: ++bucket.seq, text: String(body.content || ''), at: Date.now() };
            bucket[field].push(item);
            return json({ ok: true, item, duplicate: false });
          }
          case '/api/memory/sessions': {
            const key = String(body.key || '');
            if (!key) return json({ ok: false, error: 'key 不能为空' }, 400);
            memoryBucket(state, key);
            return json({ ok: true, key });
          }
          case '/api/memory/entries/clear': {
            const bucket = memoryBucket(state, String(body.key || ''));
            const map = { topic: 'topics', thought: 'thoughts', impression: 'impressions', rule: 'rules' };
            if (map[body.category]) bucket[map[body.category]] = [];
            else for (const f of Object.values(map)) bucket[f] = [];
            return json({ ok: true, removed: {} });
          }
          case '/api/memory': {
            const next = state.memoryConfig;
            for (const key of ['inject', 'tools', 'handover', 'ingest']) if (body[key] && typeof body[key] === 'object') next[key] = { ...next[key], ...body[key] };
            if (body.providers && typeof body.providers === 'object') {
              for (const [id, patch] of Object.entries(body.providers)) if (patch && typeof patch === 'object') next.providers[id] = { ...(next.providers[id] || {}), ...patch };
            }
            return json({ ok: true, memory: next, status: memoryStatusOf(state), ingest: ingestStatusOf(state) });
          }
          case '/api/role-mode': state.roleMode = body.mode; return json({ ok: true });
          case '/api/whitelist': state.whitelist = body; return json({ ok: true });
          case '/api/access':
            state.access = {
              passive: { mode: body?.passive?.mode === 'deny' ? 'deny' : 'allow', entries: Array.isArray(body?.passive?.entries) ? body.passive.entries : [] },
              proactive: { mode: body?.proactive?.mode === 'deny' ? 'deny' : 'allow', entries: Array.isArray(body?.proactive?.entries) ? body.proactive.entries : [] },
            };
            return json({ ok: true, access: state.access });
          case '/api/social': state.social = body; return json({ ok: true });
          case '/api/social/state': state.socialStates[body.key] = { phase: body.phase }; return json({ ok: true });
          case '/api/socialV2/config': state.v2 = body; return json({ ok: true });
          case '/api/socialV2/activity': state.paused = body.paused; return json({ ok: true });
          case '/api/socialV2/tool-log/clear': state.toolLog = []; return json({ ok: true });
          case '/api/socialV2/feedback-clear': state.feedback = []; return json({ ok: true });
          case '/api/socialV2/reset': return json({ ok: true });
          case '/api/socialV2/initial-prompt': {
            const text = body.delete === true ? '' : String(body.text ?? '');
            state.initPrompt = text;
            return json({
              ok: true, key: body.key || '', deleted: !text, chars: text.length,
              exists: !!text, updatedAt: Date.now(), maxChars: 2000
            });
          }
          case '/api/slang/config': state.slangConfig = body; return json({ ok: true });
          case '/api/slang': state.slang.push({ ...body, id: `demo-${state.slang.length + 1}`, status: 'confirmed', source: 'manual', count: 1 }); return json({ ok: true });
          case '/api/security':
            if (body.rehardenStateDir === true) {
              // 离线演示：把「重新检测」当成一次成功的收紧（真实实现要管理员权限）
              state.hardenStateDir = true;
              return json({ ok: true, hardened: true, path: 'D:\\demo\\qq-bridge\\state' });
            }
            state.security = body;
            return json({ ok: true });
          case '/api/console/token': return json({ ok: true, token: body.token || 'offline-demo-token-123456', generated: !body.token });
          case '/api/test-send': return json({ ok: true, message_id: 'mock-message-001' });
          // 语音试发（操作者通道）：离线只回执，不产生任何真实 QQ 消息
          case '/api/voice/send': return json(body.dryRun
            ? { ok: true, dryRun: true, target: body.target, file: body.file, detail: '2秒 · 20.0 KB · mp3 · 24.0kHz · 单声道', verified: false }
            : { ok: true, target: body.target, file: body.file, detail: '2秒 · 20.0 KB · mp3', messageId: 9001, verified: true, limits: { maxSeconds: 300, maxBytes: 20971520, maxPerMinute: 2, maxPerHour: 10 } });
          case '/api/console/notify-ai': return json({ ok: true, sessionId: 'mock-dsh-session' });
          case '/api/restart': return json({ ok: true, message: '离线预览：已模拟重启，实际服务未改变。' });
          case '/api/workspace/reset': state.sessions = []; return json({ ok: true, archivedCount: 3 });
          case '/api/session/reset': state.sessions = state.sessions.filter(x => x.key !== body.key); return json({ ok: true });
          case '/api/slang/extract': return json({ ok: true });
          case '/api/slang/research': return json({ ok: true, count: body.ids?.length || 1 });
          case '/api/slang/batch-confirm':
          case '/api/slang/batch-reject':
          case '/api/slang/batch-delete': {
            const ids = body.ids || [];
            if (path.endsWith('delete')) state.slang = state.slang.filter(x => !ids.includes(x.id));
            else state.slang.forEach(x => { if (ids.includes(x.id)) x.status = path.endsWith('confirm') ? 'confirmed' : 'rejected'; });
            return json({ ok: true, count: ids.length, confirmed: ids.length, rejected: ids.length, deleted: ids.length });
          }
          case '/api/social/flush':
          case '/api/socialV2/wake':
          case '/api/socialV2/memory-clear':
          case '/api/socialV2/memory-update':
          case '/api/socialV2/memory-remove': return json({ ok: true });
          case '/api/tokens/reset': return json({ ok: true });
        }
      }
      const slangMatch = path.match(/^\/api\/slang\/([^/]+)(?:\/(confirm|reject))?$/);
      if (slangMatch && ['POST', 'PATCH', 'DELETE'].includes(method)) {
        const entry = state.slang.find(x => x.id === slangMatch[1]);
        if (!entry) return json({ ok: false, error: '演示词条不存在' }, 404);
        if (method === 'DELETE') state.slang = state.slang.filter(x => x !== entry);
        else Object.assign(entry, body, slangMatch[2] ? { status: slangMatch[2] === 'confirm' ? 'confirmed' : 'rejected' } : {});
        return json({ ok: true });
      }
      unknownRequests.push({ method, path });
      return json({ ok: false, error: `Unimplemented fixture route: ${method} ${path}` }, 404);
    } catch (error) {
      json({ ok: false, error: error.message }, 500);
    }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); });
  return { server, state, requests, unknownRequests, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolveClose => server.close(resolveClose)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = name => args.find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
  const fixture = await startConsoleFixture({ port: Number(value('--port') || 4173), original: args.includes('--original'), htmlPath: value('--html') ? resolve(value('--html')) : undefined, logWrites: true });
  console.log(`Offline console preview: ${fixture.url}\nAll data is synthetic; writes stay in memory.\nRecorded requests: ${fixture.url}/__fixture/requests`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await fixture.close(); process.exit(0); });
}
