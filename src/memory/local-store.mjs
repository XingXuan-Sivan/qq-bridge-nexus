import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { addRule, normalizeRules, removeRule, rulesPromptBlock, GROUP_RULE_LIMITS } from '../social/group-rules.js';

// 本机轻量记忆：local-digest provider 自己的存储与「管理」实现。
//
// 这不是一份“页面专用”的存储：它是 memory-provider/1 的一个具体实现，
// 注入（digest）、写回（note）、管理（manage.list/add/update/remove/clear/compact）
// 都在这里，桥接和 MCP 端点只做鉴权与转发。数据与 social-v2.json 完全分开，
// 旧字段（activeTopics / pendingThoughts / memberImpressions / ownerRules）按约定直接丢弃。

export const LOCAL_MEMORY_FILE = 'local-memory.json';

export const LOCAL_MEMORY_LIMITS = Object.freeze({
  // 注入上限：只影响提示词里带几条
  injectTopics: 10,
  injectThoughts: 10,
  injectImpressions: 10,
  // 存储上限：写入时裁剪（compact 也按这组）
  maxTopics: 50,
  maxThoughts: 50,
  maxImpressions: 200,
  maxRules: GROUP_RULE_LIMITS.maxRules,
  maxTraits: 10,
  traitChars: 50,
  itemChars: 200,
  staleHours: 24,
});

export const LOCAL_MEMORY_CATEGORIES = Object.freeze(['topic', 'thought', 'impression', 'rule']);

const BAD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 把配置里的 limits 归一化成完整的一组数值（配置写错时回落到默认值）。 */
export function normalizeLocalLimits(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    injectTopics: clampInt(r.injectTopics, LOCAL_MEMORY_LIMITS.injectTopics, 0, 50),
    injectThoughts: clampInt(r.injectThoughts, LOCAL_MEMORY_LIMITS.injectThoughts, 0, 50),
    injectImpressions: clampInt(r.injectImpressions, LOCAL_MEMORY_LIMITS.injectImpressions, 0, 100),
    maxTopics: clampInt(r.maxTopics, LOCAL_MEMORY_LIMITS.maxTopics, 1, 500),
    maxThoughts: clampInt(r.maxThoughts, LOCAL_MEMORY_LIMITS.maxThoughts, 1, 500),
    maxImpressions: clampInt(r.maxImpressions, LOCAL_MEMORY_LIMITS.maxImpressions, 1, 1000),
    maxRules: clampInt(r.maxRules, LOCAL_MEMORY_LIMITS.maxRules, 1, 50),
    maxTraits: clampInt(r.maxTraits, LOCAL_MEMORY_LIMITS.maxTraits, 1, 30),
    traitChars: clampInt(r.traitChars, LOCAL_MEMORY_LIMITS.traitChars, 10, 200),
    itemChars: clampInt(r.itemChars, LOCAL_MEMORY_LIMITS.itemChars, 20, 2000),
    staleHours: clampInt(r.staleHours, LOCAL_MEMORY_LIMITS.staleHours, 0, 24 * 30),
  };
}

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

function emptyBucket() {
  return { topics: [], thoughts: [], impressions: {}, rules: [] };
}

/**
 * @param {object} opts
 * @param {string} opts.file        存储文件路径（state/local-memory.json）
 * @param {() => object} [opts.limits] 读取当前 limits（每次调用时取，配置热更新后立即生效）
 * @param {(text:string)=>string} [opts.sanitize] 统一脱敏（桥接传入 redactKnownTokensOnly）
 * @param {(msg:string)=>void} [opts.log]
 */
export function createLocalMemory({ file, limits = () => ({}), sanitize = (t) => t, log = () => {}, now = Date.now }) {
  let state = { version: 1, keys: {} };

  function limitsNow() {
    return normalizeLocalLimits(typeof limits === 'function' ? limits() : limits);
  }

  function load() {
    try {
      if (!fs.existsSync(file)) return;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.keys && typeof parsed.keys === 'object') {
        state = { version: 1, keys: parsed.keys };
      }
    } catch (error) {
      // 坏文件不阻塞启动：留一份备份，从空状态开始（记忆不是安全边界的组成部分）。
      try {
        fs.renameSync(file, `${file}.corrupt-${now()}`);
      } catch {}
      log(`本机记忆文件损坏，已重建：${error?.message ?? error}`);
    }
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, file);
    } catch (error) {
      log(`本机记忆写盘失败：${error?.message ?? error}`);
    }
  }

  function bucket(key) {
    const k = String(key ?? '').trim();
    if (!k) return null;
    if (!state.keys[k] || typeof state.keys[k] !== 'object') state.keys[k] = emptyBucket();
    const b = state.keys[k];
    if (!Array.isArray(b.topics)) b.topics = [];
    if (!Array.isArray(b.thoughts)) b.thoughts = [];
    if (!b.impressions || typeof b.impressions !== 'object' || Array.isArray(b.impressions)) b.impressions = {};
    if (!Array.isArray(b.rules)) b.rules = [];
    return b;
  }

  function clean(text, limit) {
    return sanitize(String(text ?? '')).replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  // 按当前存储上限裁剪；返回删掉了多少条（供 compact / 写入后调用）。
  function trim(b, L) {
    const removed = { topics: 0, thoughts: 0, impressions: 0, rules: 0 };
    if (L.staleHours > 0) {
      const before = b.topics.length;
      b.topics = b.topics.filter((t) => !t.lastMentionAt || now() - Number(t.lastMentionAt) < L.staleHours * 3600 * 1000);
      removed.topics += before - b.topics.length;
    }
    const beforeThoughts = b.thoughts.length;
    b.thoughts = b.thoughts.filter((t) => !t.expiresAt || now() < Number(t.expiresAt));
    removed.thoughts += beforeThoughts - b.thoughts.length;
    if (b.topics.length > L.maxTopics) {
      const cut = b.topics.length - L.maxTopics;
      b.topics.splice(0, cut);
      removed.topics += cut;
    }
    if (b.thoughts.length > L.maxThoughts) {
      const cut = b.thoughts.length - L.maxThoughts;
      b.thoughts.splice(0, cut);
      removed.thoughts += cut;
    }
    const names = Object.keys(b.impressions);
    if (names.length > L.maxImpressions) {
      names.sort((a, c) => (Number(b.impressions[a]?.lastSeenAt) || 0) - (Number(b.impressions[c]?.lastSeenAt) || 0));
      const cut = names.length - L.maxImpressions;
      for (let i = 0; i < cut; i += 1) delete b.impressions[names[i]];
      removed.impressions += cut;
    }
    const rules = normalizeRules(b.rules, { maxRules: L.maxRules, maxChars: L.itemChars });
    if (rules.length !== b.rules.length) {
      removed.rules += b.rules.length - rules.length;
      b.rules = rules;
    }
    return removed;
  }

  /** 注入文本：格式与迁移前完全一致，规则放最前面。 */
  function digest(key, inject = {}) {
    const b = bucket(key);
    if (!b) return '';
    const L = { ...limitsNow(), ...(inject && typeof inject === 'object' ? inject : {}) };
    const n = (v, d) => clampInt(v, d, 0, 1000);
    const lines = [];
    const rulesBlock = rulesPromptBlock(b.rules);
    if (rulesBlock) lines.push(rulesBlock);
    const topics = b.topics.filter((t) => t && t.text);
    if (topics.length) {
      lines.push('【进行中的话题】');
      for (const t of topics.slice(-n(L.injectTopics, LOCAL_MEMORY_LIMITS.injectTopics))) {
        const ago = t.lastMentionAt ? Math.round((now() - t.lastMentionAt) / 60000) : 0;
        const stale = t.lastMentionAt && now() - Number(t.lastMentionAt) > 2 * 60 * 60 * 1000 ? '（已搁置）' : '';
        lines.push(`- ${t.text}${stale}（${ago > 0 ? `${ago}分钟前` : '刚刚'}）${t.pendingQuestion ? `；待追问：${t.pendingQuestion}` : ''}`);
      }
    }
    const thoughts = b.thoughts.filter((t) => t && t.text && (!t.expiresAt || now() < t.expiresAt));
    if (thoughts.length) {
      lines.push('【你想说但还没说的】');
      for (const t of thoughts.slice(-n(L.injectThoughts, LOCAL_MEMORY_LIMITS.injectThoughts))) {
        lines.push(`- ${t.text}${t.motivation ? `（${t.motivation}）` : ''}`);
      }
    }
    const names = Object.keys(b.impressions);
    if (names.length) {
      lines.push('【对群友的印象】');
      for (const name of names.slice(-n(L.injectImpressions, LOCAL_MEMORY_LIMITS.injectImpressions))) {
        const im = b.impressions[name] || {};
        const traits = Array.isArray(im.traits) ? im.traits : [];
        lines.push(`- ${name}：${traits.length ? traits.join('、') : '暂无记录'}（互动 ${Number(im.interactionCount) || 0} 次）`);
      }
    }
    return lines.join('\n');
  }

  function list({ key }) {
    const b = bucket(key);
    if (!b) return null;
    const L = limitsNow();
    trim(b, L);
    const impressions = Object.keys(b.impressions).map((name) => ({
      id: b.impressions[name]?.id ?? null,
      target: name,
      traits: Array.isArray(b.impressions[name]?.traits) ? b.impressions[name].traits : [],
      interactionCount: Number(b.impressions[name]?.interactionCount) || 0,
      lastSeenAt: Number(b.impressions[name]?.lastSeenAt) || 0,
    }));
    return {
      key,
      limits: L,
      counts: { topics: b.topics.length, thoughts: b.thoughts.length, impressions: impressions.length, rules: b.rules.length },
      topics: b.topics,
      thoughts: b.thoughts,
      impressions,
      rules: normalizeRules(b.rules, { maxRules: L.maxRules, maxChars: L.itemChars }),
    };
  }

  function add({ key, category, content, extra = {} }) {
    const b = bucket(key);
    if (!b) return { ok: false, status: 400, error: 'key 不能为空' };
    const L = limitsNow();
    const text = clean(content, L.itemChars);
    if (category === 'topic') {
      if (!text) return { ok: false, status: 400, error: '话题内容不能为空' };
      const existing = b.topics.find((t) => t.text === text);
      if (existing) {
        existing.lastMentionAt = now();
        if (Array.isArray(extra.participants)) existing.participants = [...new Set([...(existing.participants || []), ...extra.participants.map((p) => clean(p, L.itemChars))])].slice(0, 10);
        if (extra.pendingQuestion) existing.pendingQuestion = clean(extra.pendingQuestion, L.itemChars);
        trim(b, L); save();
        return { ok: true, item: existing, duplicate: true };
      }
      const item = {
        id: newId('t'),
        text,
        lastMentionAt: now(),
        participants: Array.isArray(extra.participants) ? extra.participants.map((p) => clean(p, L.itemChars)).slice(0, 10) : [],
        pendingQuestion: clean(extra.pendingQuestion ?? '', L.itemChars),
      };
      b.topics.push(item);
      trim(b, L); save();
      return { ok: true, item };
    }
    if (category === 'thought') {
      if (!text) return { ok: false, status: 400, error: '想法内容不能为空' };
      const expiresIn = Number(extra.expiresInMs) || 2 * 60 * 60 * 1000;
      const existing = b.thoughts.find((t) => t.text === text);
      if (existing) {
        existing.createdAt = now();
        existing.expiresAt = now() + Math.max(0, expiresIn);
        if (extra.motivation) existing.motivation = clean(extra.motivation, 50);
        trim(b, L); save();
        return { ok: true, item: existing, duplicate: true };
      }
      const item = { id: newId('w'), text, createdAt: now(), expiresAt: now() + Math.max(0, expiresIn), motivation: clean(extra.motivation ?? 'curiosity', 50) };
      b.thoughts.push(item);
      trim(b, L); save();
      return { ok: true, item };
    }
    if (category === 'impression') {
      const target = clean(extra.target ?? '', 64);
      if (!target) return { ok: false, status: 400, error: 'impression 需要 extra.target' };
      if (BAD_NAMES.has(target)) return { ok: false, status: 400, error: '非法的群友名字' };
      const old = b.impressions[target] || { id: newId('i'), traits: [], interactionCount: 0, lastSeenAt: 0 };
      const traits = Array.isArray(old.traits) ? old.traits.slice(0, L.maxTraits) : [];
      const incoming = [];
      if (Array.isArray(extra.traits)) {
        for (const raw of extra.traits) {
          const s = clean(String(raw ?? ''), L.traitChars);
          if (s) incoming.push(s);
        }
      }
      if (text) incoming.push(text.slice(0, L.traitChars));
      for (const s of incoming) if (!traits.includes(s)) traits.push(s);
      b.impressions[target] = {
        id: old.id || newId('i'),
        traits: traits.slice(-L.maxTraits),
        interactionCount: (Number(old.interactionCount) || 0) + 1,
        lastSeenAt: now(),
      };
      trim(b, L); save();
      return { ok: true, item: { target, ...b.impressions[target] } };
    }
    if (category === 'rule') {
      if (!text) return { ok: false, status: 400, error: '规则内容不能为空' };
      if (text.length > GROUP_RULE_LIMITS.maxChars) return { ok: false, status: 400, error: `规则不能超过 ${GROUP_RULE_LIMITS.maxChars} 字` };
      const r = addRule(b.rules, text, { now: now(), maxRules: L.maxRules, maxChars: L.itemChars });
      if (r.error) return { ok: false, status: 400, error: r.error };
      b.rules = r.rules;
      trim(b, L); save();
      return { ok: true, item: r.rule, duplicate: !!r.duplicate };
    }
    return { ok: false, status: 400, error: 'category 必须是 topic / thought / impression / rule' };
  }

  function update({ key, category, id, content, extra = {} }) {
    const b = bucket(key);
    if (!b) return { ok: false, status: 400, error: 'key 不能为空' };
    const L = limitsNow();
    const text = content === undefined || content === null ? undefined : clean(content, L.itemChars);
    const findById = (arr) => arr.find((x) => x && x.id === id);
    if (category === 'topic') {
      const item = findById(b.topics);
      if (!item) return { ok: false, status: 404, error: '找不到这条话题' };
      if (text !== undefined) item.text = text;
      if (extra.pendingQuestion !== undefined) item.pendingQuestion = clean(extra.pendingQuestion, L.itemChars);
      if (Array.isArray(extra.participants)) item.participants = extra.participants.map((p) => clean(p, L.itemChars)).slice(0, 10);
      trim(b, L); save();
      return { ok: true, item };
    }
    if (category === 'thought') {
      const item = findById(b.thoughts);
      if (!item) return { ok: false, status: 404, error: '找不到这条想法' };
      if (text !== undefined) item.text = text;
      if (extra.motivation !== undefined) item.motivation = clean(extra.motivation, 50);
      if (extra.expiresInMs !== undefined) item.expiresAt = now() + Math.max(0, Number(extra.expiresInMs) || 0);
      trim(b, L); save();
      return { ok: true, item };
    }
    if (category === 'impression') {
      const entry = Object.entries(b.impressions).find(([, im]) => im?.id === id);
      if (!entry) return { ok: false, status: 404, error: '找不到这条印象' };
      const [oldTarget, im] = entry;
      const nextTarget = clean(extra.target ?? oldTarget, 64);
      if (!nextTarget || BAD_NAMES.has(nextTarget)) return { ok: false, status: 400, error: '非法的群友名字' };
      if (text !== undefined) im.traits = text.split(/[,，、]/).map((s) => clean(s, L.traitChars)).filter(Boolean).slice(-L.maxTraits);
      if (Array.isArray(extra.traits)) im.traits = extra.traits.map((s) => clean(s, L.traitChars)).filter(Boolean).slice(-L.maxTraits);
      if (extra.interactionCount !== undefined) im.interactionCount = Math.max(0, Number(extra.interactionCount) || 0);
      im.lastSeenAt = now();
      if (nextTarget !== oldTarget) {
        delete b.impressions[oldTarget];
        b.impressions[nextTarget] = im;
      }
      trim(b, L); save();
      return { ok: true, item: { target: nextTarget, ...im } };
    }
    if (category === 'rule') {
      const item = normalizeRules(b.rules).find((r) => String(r.id) === String(id));
      if (!item) return { ok: false, status: 404, error: '找不到这条规则' };
      if (text !== undefined && text !== item.text) {
        const removed = removeRule(b.rules, item.id);
        if (removed.error) return { ok: false, status: 400, error: removed.error };
        const added = addRule(removed.rules, text, { now: now(), maxRules: L.maxRules, maxChars: L.itemChars });
        if (added.error) return { ok: false, status: 400, error: added.error };
        b.rules = added.rules;
        trim(b, L); save();
        return { ok: true, item: added.rule };
      }
      return { ok: true, item };
    }
    return { ok: false, status: 400, error: 'category 必须是 topic / thought / impression / rule' };
  }

  function remove({ key, category, id }) {
    const b = bucket(key);
    if (!b) return { ok: false, status: 400, error: 'key 不能为空' };
    if (category === 'topic' || category === 'thought') {
      const arr = category === 'topic' ? b.topics : b.thoughts;
      const idx = arr.findIndex((x) => x && x.id === id);
      if (idx < 0) return { ok: false, status: 404, error: '找不到这一条' };
      const [item] = arr.splice(idx, 1);
      save();
      return { ok: true, item };
    }
    if (category === 'impression') {
      const entry = Object.entries(b.impressions).find(([, im]) => im?.id === id);
      if (!entry) return { ok: false, status: 404, error: '找不到这条印象' };
      delete b.impressions[entry[0]];
      save();
      return { ok: true, item: { target: entry[0], ...entry[1] } };
    }
    if (category === 'rule') {
      const r = removeRule(b.rules, id);
      if (r.error) return { ok: false, status: 404, error: r.error };
      b.rules = r.rules;
      save();
      return { ok: true, item: r.removed };
    }
    return { ok: false, status: 400, error: 'category 必须是 topic / thought / impression / rule' };
  }

  function clear({ key, category }) {
    const b = bucket(key);
    if (!b) return { ok: false, status: 400, error: 'key 不能为空' };
    const removed = {};
    if (!category || category === 'topic') { removed.topics = b.topics.length; b.topics = []; }
    if (!category || category === 'thought') { removed.thoughts = b.thoughts.length; b.thoughts = []; }
    if (!category || category === 'impression') { removed.impressions = Object.keys(b.impressions).length; b.impressions = {}; }
    if (!category || category === 'rule') { removed.rules = b.rules.length; b.rules = []; }
    if (!b.topics.length && !b.thoughts.length && !Object.keys(b.impressions).length && !b.rules.length) delete state.keys[String(key).trim()];
    save();
    return { ok: true, removed };
  }

  function compact({ key }) {
    const b = bucket(key);
    if (!b) return { ok: false, status: 400, error: 'key 不能为空' };
    const removed = trim(b, limitsNow());
    save();
    return { ok: true, removed };
  }

  // 收到新消息时刷新「被提到」的话题：命中 10 字前缀或参与者名字就更新 lastMentionAt，
  // 让 digest 的「已搁置」判断反映最近是否还在聊这件事。
  function touch({ key, text } = {}) {
    const b = state.keys[String(key ?? '').trim()];
    if (!b || !Array.isArray(b.topics) || !b.topics.length) return { ok: true, touched: [] };
    const body = String(text ?? '');
    if (!body) return { ok: true, touched: [] };
    const touched = [];
    for (const t of b.topics) {
      if (!t || typeof t !== 'object') continue;
      const topicHit = t.text && body.includes(String(t.text).slice(0, 10));
      const participantHit = Array.isArray(t.participants) && t.participants.some((p) => p && body.includes(String(p)));
      if (!topicHit && !participantHit) continue;
      t.lastMentionAt = now();
      touched.push(t.id);
    }
    if (touched.length) save();
    return { ok: true, touched };
  }

  return {
    file,
    load,
    digest,
    list,
    add,
    update,
    remove,
    clear,
    compact,
    touch,
    limits: limitsNow,
  };
}
