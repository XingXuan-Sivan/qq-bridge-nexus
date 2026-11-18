// 价目表本机覆盖层（src/pricing/store.mjs）与计费口径（src/pricing/policy.mjs）测试。
//
// 覆盖点（每一条都对应一个曾经容易写错的地方）：
// 1. 合并只在申报形状上做：本地只写差异，没写的字段回落申报价；
// 2. 本地新增模型追加进表，已有模型的 label 不被空值冲掉；
// 3. 单价归一化：空值不算覆盖，负数 / 非数字直接拒绝；
// 4. 计费口径归一化：标量逐字段覆盖，时段整组替换（半组合法的输入不能拼出没申报过的时段），
//    显式空组表达「这个模型全天同价」，不能被当成「没写」；
// 5. 落盘是整段替换：没提交的模型 = 取消覆盖，且写前留一份备份；
// 6. 本地新增模型必须同时有「未命中」与「输出」，否则拒写（写了也进不了价目表）；
// 7. 空覆盖 = 没有本机层：删文件、回落申报；
// 8. 非法 agent id 不落到文件系统（防路径穿越），effective 退回申报表而不是抛错；
// 9. 坏 YAML 报出文件名，不静默当成「没有覆盖」；
// 10. 模型级峰谷：声明面给，本机层能逐模型覆盖（只盖写了的组，没写的组回落）；
// 11. 内置官方价是最底下那层：申报优先，没申报的模型用官方价。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createPricingStore,
  isEmptyLocalPricing,
  mergeCatalog,
  normalizeLocalPricing,
  normalizePriceEntry,
  PRICE_KEYS,
} from '../src/pricing/store.mjs';
import { normalizePricingPolicy } from '../src/pricing/policy.mjs';
import { withBuiltin } from '../src/pricing/builtins.mjs';
import { priceTableFromCatalog, ratesAt } from '../src/model-prices.js';

let failed = 0;
function assert(cond, label) {
  if (cond) console.log(`✅ ${label}`);
  else { console.error(`❌ ${label}`); failed = 1; }
}

const DECLARED = {
  models: [
    { id: 'm1', label: '模型一', pricing: { cacheHit: 0.1, cacheMiss: 1, cacheWrite: 1, output: 2 } },
    { id: 'm2', label: '模型二', pricing: { cacheHit: 0.2, cacheMiss: 2, output: 4 } },
  ],
  pricingPolicy: {
    version: 'v1', currency: 'CNY', symbol: '¥', unit: 1e6, peakMultiplier: 2,
    peakWindows: [[9, 12], [14, 18]], peakWeekdays: [1, 2, 3, 4, 5],
  },
};

// ── 1. 合并只落差异 ─────────────────────────────────────────────────────
const onlyOutput = mergeCatalog(DECLARED, {
  version: 1, pricingPolicy: {}, models: { m1: { output: 3 } },
});
assert(onlyOutput.models.length === 2, '合并后模型条数不变');
assert(onlyOutput.models[0].pricing.output === 3, '本地写了的字段用本地值');
assert(onlyOutput.models[0].pricing.cacheMiss === 1, '没写的字段回落申报价');
assert(onlyOutput.models[0].label === '模型一', '本地没给 label 时不冲掉申报的名字');
assert(onlyOutput.models[1].pricing.output === 4, '没被覆盖的模型原样保留');

// ── 2. 本地新增 ─────────────────────────────────────────────────────────
const added = mergeCatalog(DECLARED, {
  version: 1, pricingPolicy: {}, models: { 'local-only': { label: '本地新增', cacheMiss: 5, output: 9 } },
});
assert(added.models.length === 3, '申报里没有的 id 作为新模型并进表');
const newcomer = added.models.find((item) => item.id === 'local-only');
assert(newcomer?.label === '本地新增' && newcomer.pricing.cacheMiss === 5, '新模型带上本地给的 label 与单价');
assert(added.models[0].id === 'm1', '已在申报里的模型保持申报顺序');
assert(mergeCatalog(DECLARED, { version: 1, pricingPolicy: {}, models: {} }) === DECLARED, '空覆盖直接返回申报目录，不做无意义的复制');

// ── 3. 单价归一化 ───────────────────────────────────────────────────────
assert(normalizePriceEntry({ cacheMiss: 1, output: 2, cacheHit: null }).output === 2, '给 null 的字段不算覆盖');
assert(normalizePriceEntry({ cacheHit: '', cacheWrite: '  ' }) === null, '全是空值等于没有覆盖');
let rejected = false;
try { normalizePriceEntry({ output: -1 }); } catch { rejected = true; }
assert(rejected, '负数单价被拒绝（不能把钱算反）');
rejected = false;
try { normalizePriceEntry({ output: 'abc' }); } catch { rejected = true; }
assert(rejected, '非数字单价被拒绝');
const normalized = normalizeLocalPricing({ version: 9, models: { m1: { cacheMiss: '3', label: ' 别名 ' }, ' ': { output: 1 } }, junk: 1 });
assert(normalized.version === 1 && normalized.models.m1.cacheMiss === 3 && normalized.models.m1.label === '别名', '归一化只留认识的键，数字字符串转成数字');
assert(Object.keys(normalized.models).length === 1, '空 id 被丢掉');
assert(PRICE_KEYS.length === 4, '四个计费桶：命中 / 未命中 / 写入 / 输出');

// ── 4. 计费口径 ─────────────────────────────────────────────────────────
const policy = normalizePricingPolicy({ version: 'v2', unit: '1000000', peakMultiplier: 3, peakWindows: [[9, 12], [9, 25]], peakWeekdays: [1, 2, 3, 4, 5, 6] });
assert(policy.version === 'v2' && policy.unit === 1000000 && policy.peakMultiplier === 3, '标量逐字段覆盖，数字字符串转数字');
assert(policy.peakWindows === undefined, '时段里有一个非法端点就整组丢弃，不留半组');
assert(policy.peakWeekdays.length === 6, '工作日整组替换成申报的六个数字');
const keptGroup = normalizePricingPolicy({ peakWindows: [[10, 12]] });
assert(keptGroup.peakWindows[0][0] === 10, '合法的时段组整组保留');
assert(Object.keys(normalizePricingPolicy(null)).length === 0 && Object.keys(normalizePricingPolicy([1])).length === 0, '非对象输入当作空口径');
assert(Array.isArray(normalizePricingPolicy({ peakWindows: [] }).peakWindows), '显式空窗口保留（= 这个模型全天同价）');

// ── 4b. 模型级峰谷（声明面给，本机层可逐模型覆盖） ──────────────────────
const MON_10 = Date.parse('2026-03-02T10:00:00+08:00'); // 周一 10:00
const MON_03 = Date.parse('2026-03-02T03:00:00+08:00'); // 周一 03:00
const ownPeak = {
  ...DECLARED,
  models: [
    { ...DECLARED.models[0], pricingPolicy: { peakWindows: [], peakWeekdays: [] } },
    { ...DECLARED.models[1], pricingPolicy: { peakWindows: [[0, 8]] } },
  ],
};
const ownTable = priceTableFromCatalog(ownPeak);
assert(ratesAt('m1', MON_10, ownTable).tier === 'off', '模型级空窗口：该模型没有高峰时段（全天同价）');
assert(ratesAt('m2', MON_10, ownTable).tier === 'off', '模型级窗口盖掉平台窗口：平台高峰时段内也算空闲');
assert(ratesAt('m2', MON_03, ownTable).tier === 'peak', '模型级窗口生效：该模型自己声明的高峰时段');
assert(ratesAt('m1', MON_10, priceTableFromCatalog(DECLARED)).tier === 'peak', '没写模型级口径时仍按平台峰谷');
assert(ownTable.models.m1.peak.peakWindows.length === 0 && ownTable.models.m2.peak.peakWindows[0][1] === 8, '模型级口径只盖写了的组，与单价分开存');
// 本机覆盖与申报共用同一套判据：只盖写了的那组，没写的组回落下一层。
const localPeak = mergeCatalog(ownPeak, normalizeLocalPricing({ models: { m2: { output: 9, policy: { peakWindows: [], peakWeekdays: [] } } } }));
const localPeakTable = priceTableFromCatalog(localPeak);
assert(localPeak.models[1].pricingPolicy.peakWindows.length === 0, '本机层能改模型级峰谷：整组盖掉申报的窗口');
assert(localPeak.models[1].pricing.output === 9 && localPeak.models[1].pricingPolicy.peakWeekdays.length === 0, '单价与口径可以同时覆盖');
assert(ratesAt('m2', MON_03, localPeakTable).tier === 'off', '本机空窗口立即生效：原来 00–08 的高峰不再算高峰');
const partialPeak = mergeCatalog(ownPeak, normalizeLocalPricing({ models: { m2: { policy: { peakWeekdays: [3] } } } }));
assert(partialPeak.models[1].pricingPolicy.peakWeekdays.join() === '3', '只写星期时窗口仍用申报的那组');
assert(partialPeak.models[1].pricingPolicy.peakWindows[0][1] === 8, '没写的组回落模型级申报');
// 写了不合法的口径要报错：用户刚在弹窗里改的东西默默不生效最难查。
rejected = false;
try { normalizePriceEntry({ policy: { peakWindows: [[20, 8]] } }); } catch { rejected = true; }
assert(rejected, '起止颠倒的高峰时段被拒绕，不静默丢掉');
rejected = false;
try { normalizePriceEntry({ policy: { peakMultiplier: 0 } }); } catch { rejected = true; }
assert(rejected, '0 倍的高峰口径被拒绕');

// ── 4c. 内置官方价 ─────────────────────────────────────────
const builtinOnly = priceTableFromCatalog(withBuiltin(null));
assert(builtinOnly.models['deepseek-flash']?.off.cacheMiss === 1, '没有平台声明时用内置官方价（DeepSeek-V4.1-Flash）');
assert(builtinOnly.models['deepseek-v4-pro']?.off.output === 13.5, '内置官方价包含 DeepSeek-V4-Pro');
const declaredWins = priceTableFromCatalog(withBuiltin({
  models: [{ id: 'deepseek-flash', label: '平台改过名', pricing: { cacheMiss: 2, output: 8 } }],
}));
assert(declaredWins.models['deepseek-flash'].off.cacheMiss === 2 && declaredWins.models['deepseek-flash'].origin === 'declared', '申报价优先于内置价');
assert(declaredWins.models['deepseek-flash'].label === '平台改过名', '申报的 label 不被内置表冲掉');
assert(ratesAt('deepseek-flash', MON_10, declaredWins).cacheMiss === 4, '申报没写峰谷时沿用内置的官方高峰倍数');

// ── 5~9. 落盘 ───────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-pricing-'));
const root = path.join(tmp, 'state', 'pricing');
const backups = path.join(tmp, 'state', 'platform-backups', 'pricing', 'dsh');
const store = createPricingStore({ root });
const file = path.join(root, 'dsh.yml');

assert(store.readLocal('dsh') === null, '没有文件 = 完全跟随平台申报');
assert(store.effective('dsh', DECLARED).models.m1.off.output === 2, '没有覆盖时价目表就是申报表');

const first = store.save('dsh', { models: { m1: { output: 3 } } }, DECLARED);
assert(fs.existsSync(file), '保存后价目文件落到 state/pricing/<agent>.yml');
assert(first.models.m1.output === 3 && first.models.m1.cacheMiss === undefined, '本地文件只存差异，不抄整份申报');
assert(store.effective('dsh', DECLARED).models.m1.off.output === 3, 'effective() 合并本地覆盖');
assert(store.effective('dsh', DECLARED).models.m1.off.cacheMiss === 1, '没覆盖的字段仍按申报价');

store.save('dsh', { models: { m1: { output: 3 }, m2: { cacheHit: 0.5 } } }, DECLARED);
assert(fs.readdirSync(backups).length >= 1, '写前在 state/platform-backups/pricing/<agent>/ 留了副本');
assert(store.readLocal('dsh').models.m2.cacheHit === 0.5, '整段写入：后一次提交覆盖前一次');

// 新增模型必须能算钱
rejected = false;
try { store.save('dsh', { models: { 'local-only': { output: 9 } } }, DECLARED); } catch (error) { rejected = /未命中/.test(error.message); }
assert(rejected, '本地新增缺「未命中」价时拒写');
assert(store.readLocal('dsh').models['local-only'] === undefined, '被拒的写入不落盘');

store.save('dsh', { models: { 'local-only': { label: '本地新增', cacheMiss: 5, output: 9 } } }, DECLARED);
const effective = store.effective('dsh', DECLARED);
assert(effective.models['local-only']?.off.cacheMiss === 5 && effective.models['local-only'].off.cacheWrite === 5, '新增模型进价目表，缺写入价时按未命中价计');
assert(effective.models.m1.off.output === 2, '整段写入：上一次提交里没出现的模型被取消覆盖');

// 口径覆盖要跟着落盘，而且不需要同时改单价。
store.save('dsh', { models: { m1: { output: 3 }, m2: { policy: { peakWindows: [[10, 12]], peakMultiplier: 1.8 } } } }, DECLARED);
assert(store.readLocal('dsh').models.m2.policy.peakWindows[0][1] === 12, '本机层的 policy 与单价一起落盘');
const localPeakEffective = store.effective('dsh', DECLARED);
assert(localPeakEffective.models.m2.peak.peakWindows[0][0] === 10 && localPeakEffective.models.m2.peak.peakMultiplier === 1.8, 'effective() 用本机口径重算峰谷');
assert(ratesAt('m2', Date.parse('2026-03-02T11:00:00+08:00'), localPeakEffective).tier === 'peak', '本机口径改完后 11:00 算高峰');
assert(ratesAt('m2', Date.parse('2026-03-02T09:30:00+08:00'), localPeakEffective).tier === 'off', '申报的 09–12 窗口被整组盖掉：09:30 变成空闲');

// 空覆盖 = 删文件
const cleared = store.save('dsh', { models: {} }, DECLARED);
assert(cleared === null && !fs.existsSync(file), '提交空覆盖等于删掉本机层');
assert(isEmptyLocalPricing({ version: 1, models: {} }), '空文档判定为没有本机层');

store.save('dsh', { models: { m1: { output: 3 } } }, DECLARED);
assert(store.remove('dsh') === true && !fs.existsSync(file), '「恢复平台申报」删掉本机覆盖');
assert(store.remove('dsh') === false, '重复恢复不报错');
assert(store.effective('dsh', DECLARED).models.m1.off.output === 2, '恢复后价目表回到申报价');

// 文件名安全 + 坏文件
for (const bad of ['../etc', '', 'AstrBot', 'a/b']) {
  rejected = false;
  try { store.save(bad, { models: { m1: { output: 3 } } }, DECLARED); } catch { rejected = true; }
  assert(rejected, `非法 agent id 拒写：${JSON.stringify(bad)}`);
}
assert(store.effective('', DECLARED).models.m1.off.output === 2, '没有活动平台时 effective() 退回申报表，不抛错');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(file, 'models: [unclosed\n', 'utf8');
rejected = false;
try { store.readLocal('dsh'); } catch (error) { rejected = error.message.includes('dsh.yml') && error.message.includes('YAML'); }
assert(rejected, '坏 YAML 报出文件名，不静默当作没有覆盖');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? '\n有失败用例' : '\n全部通过');
process.exitCode = failed;
