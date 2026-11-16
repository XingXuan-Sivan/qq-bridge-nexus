// 测试用的价目表：直接读 dsh 的 agent-platform.yml 声明再折算，不在测试里另抄一份价格。
//
// 为什么这么取：价目是平台自己的商业条款（`modelCatalog.pricing` + `pricingPolicy`），
// 桥接不再内置任何默认价。测试如果把价格抄成常量，改声明时测试会「照样通过」，
// 也就失去了「价目只来自平台声明」这条约束的守卫。
import { listAgentPlatformDirs } from '../src/platforms/index.mjs';
import { AGENT_PLATFORMS_ROOT } from '../src/profiles/paths.mjs';
import { priceTableFromCatalog } from '../src/model-prices.js';

export const DSH_MODEL_CATALOG = listAgentPlatformDirs({ root: AGENT_PLATFORMS_ROOT })
  .find((item) => item.id === 'dsh')?.modelCatalog ?? null;

/** dsh 申报的价目表（与运行期 `priceTableFromCatalog()` 同一口径）。 */
export const DSH_PRICE_TABLE = priceTableFromCatalog(DSH_MODEL_CATALOG);
