// 价目表的本机覆盖层：state/pricing/<Agent 平台 id>.yml。
//
// 价目有三层来源，这里只负责最上面那一层：
//   1. 内置官方价 —— src/pricing/builtins.mjs 的 BUILTIN_CATALOG（官方单价与口径），
//      withBuiltin() 把它垫在申报底下：申报没写单价的模型补内置价；
//   2. 平台申报 —— profiles/agent-platforms/<id>/agent-platform.yml 的 modelCatalog，
//      是平台自己的商业条款，只读；
//   3. 本机覆盖 —— 本文件。操作者为同一个平台改价或补一个平台还没申报的模型，
//      不影响申报面，也不影响别的 Agent 平台。
//
// 本地层**只存差异**：按模型 id 扁平写四个单价，没写的字段回落申报价；申报里没有的 id
// 就是本地新增。所以「恢复平台申报」= 删掉这个文件，不需要迁移账本 —— 金额是读取时
// 按采样重算的，换表即重算历史。
//
// 峰谷口径也能逐模型覆盖（`policy`：高峰时段 / 星期 / 倍数），但只写「与申报不同」的那几组，
// 没写的组回落模型级申报 → 平台申报 → 内置口径。覆盖的是「以后怎么算」，
// 账本里只存采样与档位，所以改完仍是可复现的：历史金额按当前表重算，与改单价同一条语义。
// 货币 / 单位不在覆盖范围内 —— 那是平台的商业条款，不是本机的计费选择。
//
// 校验口径与 priceTableFromCatalog 一致：缺「未命中」或「输出」单价的模型不进价目表
// （只计 token、不算钱），本地新增模型必须同时给出这两项，否则写进去也只是看不见。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { atomicWriteFile } from '../lib/json-store.js';
import { priceTableFromCatalog } from '../model-prices.js';
import { normalizePricingPolicy } from './policy.mjs';

/** Agent 平台 id 文法（与平台目录名同一条）：先落成文件名，得先挡住路径穿越。 */
const AGENT_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
/** 四个计费桶，顺序即界面列序。 */
export const PRICE_KEYS = Object.freeze(['cacheHit', 'cacheMiss', 'cacheWrite', 'output']);
/** 本机层能覆盖的峰谷口径键：货币与单位属于平台条款，留在声明面。 */
export const LOCAL_POLICY_KEYS = Object.freeze(['peakMultiplier', 'peakWindows', 'peakWeekdays']);

const LOCAL_HEADER = '# 本机价目覆盖：按模型 id 覆盖单价或高峰口径；没写的字段回落平台申报（profiles/agent-platforms/<id>/agent-platform.yml）。\n'
  + '# 由控制台「全局配置 → 模型与行为 → 价目表」维护；删掉本文件即恢复平台申报。';

function agentName(agent) {
  const id = String(agent ?? '').trim();
  if (!AGENT_ID_RE.test(id)) throw new Error('没有活动的 Agent 平台：先在平台配置里选一个 Agent 平台再改价目');
  return id;
}

function finite(value) {
  // 只有空白的输入框等于「没填」，不能按 Number(' ') = 0 当成免费价。
  if (typeof value === 'string' && !value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * 单个模型的覆盖项：四个单价按需给，`label` 只在本地新增时有用，`policy` 是峰谷口径覆盖。
 * 给 null 表示「这一项不覆盖」（界面上清空的格子）。
 * 口径写了但不合法时报错而不是静默丢弃：那是用户刚在弹窗里改的东西，默默不生效最难查。
 */
export function normalizePriceEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of PRICE_KEYS) {
    const rawValue = raw[key];
    // 空字符串（含只有空白的输入框）表示这一项不覆盖，不是「0 元」。
    if (!(key in raw) || rawValue === null || (typeof rawValue === 'string' && !rawValue.trim())) continue;
    const n = finite(rawValue);
    if (n === null) throw new Error(`单价必须是大于等于 0 的数字：${key} = ${JSON.stringify(rawValue)}`);
    out[key] = n;
  }
  const label = String(raw.label ?? '').trim();
  if (label) out.label = label;
  if ('policy' in raw && raw.policy !== null) {
    if (typeof raw.policy !== 'object' || Array.isArray(raw.policy)) {
      throw new Error(`高峰口径必须是对象：policy = ${JSON.stringify(raw.policy)}`);
    }
    const policy = {};
    const normalized = normalizePricingPolicy(raw.policy);
    for (const key of LOCAL_POLICY_KEYS) if (key in normalized) policy[key] = normalized[key];
    if (!Object.keys(policy).length && Object.keys(raw.policy).length) {
      throw new Error('高峰口径不合法：每个时段要「起点 < 终点」且是 0–24 的整点，星期取 1–7，倍数大于 0');
    }
    if (Object.keys(policy).length) out.policy = policy;
  }
  return Object.keys(out).length ? out : null;
}

/** 归一一份本地覆盖文档；空模型表等于「没有覆盖」。 */
export function normalizeLocalPricing(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const models = {};
  const given = source.models && typeof source.models === 'object' ? source.models : {};
  for (const [id, entry] of Object.entries(given)) {
    const name = String(id).trim();
    if (!name) continue;
    const value = normalizePriceEntry(entry);
    if (value) models[name] = value;
  }
  return { version: 1, models };
}

/** 覆盖文档是否为空（没有任何改动就等于没有本地层）。 */
export function isEmptyLocalPricing(local) {
  return !local || !Object.keys(local.models ?? {}).length;
}

function localText(local) {
  return `${LOCAL_HEADER}\n\n${YAML.stringify({ version: 1, models: local.models }, { lineWidth: 0, singleQuote: true })}`;
}

/**
 * 把申报表与本机覆盖合成一张价目表。
 *
 * 合并在**申报的原始形状**上做（models 数组 + pricing 对象），再交给
 * `priceTableFromCatalog()` 换算 —— 判据与单位换算只有那一处，这里不复制一份。
 */
export function mergeCatalog(declaredCatalog, local) {
  const declared = declaredCatalog && typeof declaredCatalog === 'object' ? declaredCatalog : {};
  if (isEmptyLocalPricing(local)) return declared;
  const merged = new Map();
  for (const item of declared.models ?? []) {
    if (!item?.id) continue;
    merged.set(String(item.id), { ...item, id: String(item.id), pricing: { ...(item.pricing ?? {}) } });
  }
  for (const [id, override] of Object.entries(local.models)) {
    const base = merged.get(id) ?? { id, label: id, pricing: {} };
    const { label, policy, ...prices } = override;
    const next = { ...base, label: label ?? base.label ?? id, pricing: { ...(base.pricing ?? {}), ...prices } };
    // 口径按组盖：本机写了哪组就用本机的，没写的组仍回落申报 / 平台 / 内置。
    if (policy) next.pricingPolicy = { ...(base.pricingPolicy ?? {}), ...policy };
    merged.set(id, next);
  }
  return { ...declared, models: [...merged.values()] };
}

export function createPricingStore({ root, log = () => {} } = {}) {
  if (!root) throw new Error('价目目录未指定：调用方要传当前实例的 state/pricing');
  // 备份与 state/pricing 同源：换一个根（测试夹具、部署副本）时备份也跟着走。
  const backupsRoot = path.join(path.dirname(root), 'platform-backups', 'pricing');

  const fileOf = (agent) => path.join(root, `${agentName(agent)}.yml`);

  function backup(agent, file) {
    if (!fs.existsSync(file)) return;
    const dir = path.join(backupsRoot, agent);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(dir, `${stamp}.yml`));
  }

  /** 读本地覆盖；没有文件就是 null（= 完全跟随平台申报）。 */
  function readLocal(agent) {
    const file = fileOf(agent);
    if (!fs.existsSync(file)) return null;
    let raw;
    try {
      raw = YAML.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new Error(`state/pricing/${agent}.yml 不是合法 YAML：${error?.message ?? error}`);
    }
    const local = normalizeLocalPricing(raw);
    return isEmptyLocalPricing(local) ? null : local;
  }

  /** 合成后的价目表；申报与本机都没有报价时返回 null。 */
  function effective(agent, declaredCatalog) {
    // 平台清单是逐个 id 算的：id 不合法（还没选活动平台、或将来改了命名规则）时
    // 就直接用申报表，不能让一个配置缺口把整张模型清单读成错误。
    if (!AGENT_ID_RE.test(String(agent ?? '').trim())) return priceTableFromCatalog(declaredCatalog);
    return priceTableFromCatalog(mergeCatalog(declaredCatalog, readLocal(agent)));
  }

  /**
   * 整段写入本机覆盖（控制台一次提交整张表）：没出现在 patch 里的模型即取消覆盖。
   * `catalog` 是平台的申报目录，用来判断「新增模型」—— 本地新增必须自带未命中与输出价，
   * 否则写进去也不会进价目表，用户会以为保存失败。
   */
  function save(agent, patch = {}, catalog = null) {
    const local = normalizeLocalPricing(patch);
    const declared = new Map((catalog?.models ?? []).filter((item) => item?.id).map((item) => [String(item.id), item]));
    for (const [id, entry] of Object.entries(local.models)) {
      if (declared.has(id)) continue;
      if (finite(entry.cacheMiss) === null || finite(entry.output) === null) {
        throw new Error(`新模型 ${id} 要同时填「未命中」与「输出」单价，否则算不了钱`);
      }
    }
    if (isEmptyLocalPricing(local)) {
      remove(agent);
      return null;
    }
    const file = fileOf(agent);
    fs.mkdirSync(root, { recursive: true });
    backup(agent, file);
    atomicWriteFile(file, localText(local));
    log(`[pricing] 已保存本机覆盖 ${agent}`);
    return readLocal(agent);
  }

  /** 删掉本机覆盖，回落平台申报。返回是否真的删了文件。 */
  function remove(agent) {
    const file = fileOf(agent);
    if (!fs.existsSync(file)) return false;
    backup(agent, file);
    fs.rmSync(file, { force: true });
    log(`[pricing] 已恢复平台申报 ${agent}`);
    return true;
  }

  return { root, readLocal, effective, save, remove };
}
