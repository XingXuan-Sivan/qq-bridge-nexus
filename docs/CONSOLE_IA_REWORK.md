# 控制台 IA 重构与平台配置归一

> 状态：**方案定稿，待按 §7 批次执行**。
> 范围：`public/console/**`、`src/bridge.js` 的平台注册表与配置端点、`src/config/platforms.mjs`、`src/agent-side/**`、`profiles/agent-platforms/**`、`config.json` 结构版本、`docs/**`。
> 前置阅读：`CONSOLE.md`（组件与门禁）、`CONSOLE_FORMS.md`（页面骨架与控件工厂）、`CONSOLE_FORM_LESSONS.md`（踩坑 92 条）、`PLATFORM_UNIFICATION.md`（平台模型）、`PROFILES_MODEL.md`（配置分层）。
> 本文只写**结论与边界**，不复述既有规格；与既有文档冲突时以本文为准，并在同一批里改掉旧文档的对应段落。

四条线一次收口：

1. **界面 IA**：平台配置与插件改为「卡片网格 + 独立二级页」，MCP 保留左右分栏并收紧两栏细节。
2. **平台专有配置归一**：模型目录 / 思考强度 / 压缩策略 / 价目表由 Agent 平台自描述，核心与全局配置页不再认识具体平台。
3. **默认运行方案**：由「全局一个」改为「按用户平台各一个」，只影响该平台新建会话。
4. **细节三项**：`full` 档缺失、人格块可关、直通档去特例。

---

## 1. 现状核查（先纠正三处认知偏差）

三处都与「已经修好了」的印象不符，动手前必须先对齐事实。

### 1.1 全局默认运行方案仍在

`config.runtime.defaultPlan` 是活的真源，不是展示残留：

| 位置 | 作用 |
| --- | --- |
| `src/bridge.js:4592` `activePlan()` | 取 `bridgeCfg.runtime.defaultPlan`，没有会话覆盖时就是它 |
| `src/bridge.js:8158` `POST /api/config/runtime` | 校验方案存在后写回 config.json |
| `src/bridge.js:1991` | 读配置时把缺失值补成 `social-v2` |
| `scripts/test-console-ui.mjs:299` | 断言全局配置页 `#runtimeDefaultSelect` 存在且可写 |
| `scripts/test-runtime-plans.mjs:134` | 断言「默认方案来自 `config.runtime.defaultPlan`」 |

所以 §5 不是「加一个平台级字段」，而是**换真源 + 迁移 + 删旧键**，测试断言要同批改写。

### 1.2 DSH 模型与思考强度的数据层已归位，缺的是读口与界面

`config.platforms.agents.<id>.options` 已经是平台选项的唯一存放处（`src/config/platforms.mjs` 的 `normalizeAgentEntry`），DSH 的模型 / 思考强度写进去即可落盘。真正的问题在两端：

- 写口是 DSH 专有的 `POST /api/dsh/model`（`public/console/pages/config/page.js:61`、`:220`），全仓 24 处引用。
- 读口是 `src/dsh-model.js` + `src/model-prices.js` 的 `DEFAULT_PRICE_TABLE`（DeepSeek 专属价目），运行总览的价目表就是它。

即：**存储已经中性，接口与展示还是单平台语义**。归一动作是换接口、换数据来源，不动存储分层。

### 1.3 `full` 档缺失是「选项在模块加载时被写死」，不是开关没生效

`public/console/pages/overview/fields.js:93` 把选项算成了常量：

```js
options: permissionLevelOptions(false),   // 永远只有前三档
```

而 `public/console/pages/config/fields.js` 里 `permission: OVERVIEW_FIELDS.permission` 直接复用这份规格 —— 全局配置页与运行总览的「权限级别」都拿不到 `full`，即使 `allowFull` 已打开。

会话管理页（`pages/sessions/page.js:808`）用的是 `permissionLevelOptions(data.permission?.fullAllowed === true)`，值是动态的，但**只覆盖「已打开的 full」**这一种情形：当某个会话已经存着 `full`、而全局开关此刻是关的，选项里就没有当前值，下拉会渲染成空。两处要一起改（见 §6.1）。

---

## 2. 项目既有的结构与风格基线

**新增的任何页面、卡片、表单、表格都必须长成下面这样。** 这一节是从现有实现里读出来的统一形状，不是重新设计；动手前对照它，而不是凭印象另起一套。

### 2.1 样式只有一个入口，层叠顺序固定

`index.html` 的 link 顺序即层叠顺序：`tokens → base → layout → grid → components → utilities`，组件 CSS 跟在全局层之后、页面片段之前。页面 CSS 由 `hydratePage()` 动态插入 `<link data-page-css>`，天然最后生效。

| 改动性质 | 唯一合法落点 |
| --- | --- |
| 颜色 / 间距 / 字号 / 圆角 / 控件高度 | `css/tokens.css`（只在令牌层加，不在页面里写数值） |
| 一个组件自己的外观 | 该组件目录的 `xxx.css`（`split-view`、`table`、`modal`、`form`…） |
| 全局共用的展示件（card / tile / tag / collapse / badge） | `css/components.css`（`tile` 与 `tag` 没有独立 css，就在这里） |
| 这一页独有的装饰 | `pages/<id>/page.css` |

页面 CSS 里**不许**覆盖 `.field-row` / `.field-control` / `.field-block` / `.table-toolbar` 等原语的 `display` / `grid-template-columns` / `height`，静态检查会拦。

### 2.2 一页的骨架

宿主是 `section[data-page][data-page-css]`，class 用 `page-stack`（`display:contents`，让卡片直接成为 `main` 的网格项），卡片一律 **`span-all`**，否则会掉进 `main` 的两列网格被挤成半宽。

```
<card span-all>            页头：h2 + 一句 .meta（写影响范围与生效时机，不重复字段 hint）
<card span-all>            设置卡：h3 + .meta + 字段宿主 <div data-x-fields="...">
<card span-all>            列表卡：.card-head（左 h3，右主操作）+ 列表宿主
```

卡片由 `cardHtml()` 生成，`page.html` 只留容器与宿主 `div`。列表类内容三选一，不自己拼：

| 内容 | 组件 | 关键尺寸（来自令牌） |
| --- | --- | --- |
| 等权卡片网格 | `tileHtml()` + `.tile-list` | `auto-fill minmax(min(260px,100%),1fr)`，gap `--space-4`（10px），卡片 padding `13px 15px`，radius 11px |
| 需要扫读的清单 | `dataTableHtml()` | 工具栏 / 表体 / 分页三段，全部由组件产出 |
| 少条目可选列表（两栏） | `splitViewHtml()` | 左栏 gap 4px，条目 padding `9px 11px`，容器 padding 6px |

### 2.3 控件只有一个来源

- 字段一律 `renderFields(host, spec, { columns })`，规格写在 `pages/<id>/fields.js`；标签列 148px、控件高 40px，窄屏回落单列。
- 工具栏一律 `tableToolbarHtml({ refresh, filters, search, meta, actions })`；顺序固定：左「刷新 → 筛选项 → 搜索」，右「统计 meta → 主操作」。
- 标签一律 `tag(text, { type, size })`；面板折叠一律 `collapseHtml()` + `initGroups(root, { pageId })` 记忆展开。
- 弹窗一律 `modalHtml()` / `openModal()` / `wireModal()`，三段式（头 / 唯一滚动主体 / 底栏），底栏按钮顺序：危险动作靠左、主操作最右。
- 多个字段的页面级保存一律 `createSaveDock({ sections })`，一个分区 = 一次 POST。
- 详情类字段（只读展示）也走 `renderFields`，重绘后补 `bindSwitches`。

### 2.4 直接打回的五种写法

1. 在 `page.html` 里写 `<button>` / `<input>` / `<select>` / `<textarea>`（`BARE_CONTROL_BASELINE` 已全为 0，加回任何一个门禁立刻红）。
2. 手写 `.card` 外壳、`.tag` 药丸、`<details class="settings-group">`、原生 `confirm/alert`。
3. 在 JS / HTML 里写内联 `style="..."`（CSP `style-src 'self'`，会被浏览器拒掉，且踩坑记录已记过两次）。
4. 为「好看」新增配色或写死像素；颜色只从令牌取。
5. 页面 CSS 覆盖原语布局（见 §2.1 末段）。

---

## 3. 组件能力增量

只加**已被使用者需要**的能力，不预留投机参数。

### 3.1 `split-view`：左栏宽度变量化 + 列表工具栏槽

现状 `components/split-view/split-view.css:1` 把左栏写死成 `minmax(220px, 290px)`，页面无法调。

改动（全部在本组件内）：

```css
.split-view {
  /* 左栏宽度的唯一开关：页面在自己的 page.css 里对宿主作用域重设即可 */
  --split-list-w: minmax(272px, 348px);
  grid-template-columns: var(--split-list-w) minmax(0, 1fr);
  gap: var(--space-6);           /* 16px，原来是字面量 */
}
.split-list { border-radius: var(--radius-md); padding: 6px; gap: 4px; }
```

- 默认从 220–290px 提到 272–348px：默认更宽但仍留出右栏的阅读宽度，不越过分栏的视觉平衡点。
- **自定义方式是 CSS 变量，不做拖拽手柄**：拖拽需要宽度落盘、窄屏重置、键盘可达性与双击复位，成本高于收益；而页面级需求（MCP 左栏条目含标题 + 三行摘要）用一行变量就能满足。
- 窄屏（≤900px）堆叠规则不变，`--split-list-w` 在断点里被覆盖为单列。

新增可选参数：`splitViewHtml({ ..., toolbar })`，渲染成列表上方的 `.split-toolbar`。**槽里放的是调用方用 `tableToolbarHtml()` 生成的工具栏**，组件只负责它和列表的间距（`margin-bottom: var(--space-3)`），不重新定义工具栏内部布局。

同时删除两个无人使用的残留（不留旧方案）：`height` 参数、`.split-view[data-fixed-height]` 与 `--split-height` 规则。它靠内联 `style` 注入变量，与 CSP 冲突，且 `mcp` / `platforms` 两处调用都没传。

### 3.2 `tile`：可选的图标区域

`components/tile/tile.js` 增加 `icon` 参数，结构固定为「图标 + 标题块」：

```js
tileHtml({
  id, title,
  icon,            // { glyph?: 'D', src?: '/console/...png', tone?: 'accent'|'ok'|'warn'|'neutral' } | 省略
  badges, description, tags, error, actions, body, interactive, className,
})
```

- `icon` 省略时**照样渲染**图标块：`.tile-icon.is-default`，内容取标题首字（中文取首字符，英文取首字母大写），底色走 `--surface-subtle` + `--border-chip`。这样「预留图标位」在尚无自定义图标时就成立，DOM 结构不会因有无图标而分叉。
- `icon.src` 有值时渲染 `<img>`；`icon.glyph` 有值时渲染文本。两者都给时以 `src` 为准。
- 标题与徽标包进 `.tile-head-body`，`.tile-icon` 与它同处 `.tile-head` 的 flex 行（gap `--space-3`）。
- 样式加在 `css/components.css` 紧邻 `.tile` 段（`tile` 无独立 css，遵循既有归属）。图标块 36×36、radius 10px，不改变卡片现有 padding 与栅格间距。

`tile` 现有使用者只有 `pages/persona/page.js:74` 与 `pages/plugins/page.js:275`，平台页将成为第三个；三处都不传 `icon` 即得到默认图标，无需各自改动。

### 3.3 路由：页面级子路由

二级页必须能被深链、刷新与前进/后退恢复，所以改在 `js/router.js`，而不是页面内部自管显隐。

hash 形状：`#<page>[/<sub>[/<tab>]]`，`sub` / `tab` 对路由器是不透明字符串。

| 落点 | 改动 |
| --- | --- |
| 新增 `parsePageHash(hash)` | 返回 `{ page, sub, tab }`；`page` 必须属于 `consolePages`，否则整条视为无效 |
| `setConsolePage(page, { sub, tab, ... })` | 写 hash 时拼全三段；`sub` 为空时仍写 `#page`（不写尾斜杠） |
| `hashchange` / `popstate` | 用 `parsePageHash` 解析后把 `sub` / `tab` 一起透传；`setConsolePage` 返回 `false`（脏值守卫拦下）时照旧把地址栏改回来 |
| 新增 `onPageRoute(page, fn)` | 页面注册「子段变了要做什么」，签名 `fn({ sub, tab })`；`hydratePage` 完成后与 `pageRefreshers` 同批调用 |
| `console:page-change` 事件 detail | 增加 `sub` / `tab`，挂在 body 上的浮层组件据此判断该不该显示 |

`PAGE_ALIASES` 仍只允许「删页时的一次性兼容」，不因本次改造新增别名。

**面包屑不参与子段**：二级页自带 `h3` 与「返回」按钮，面包屑第二段仍是页面名。这样 `consolePages` 不必长出第三列标题，也就不会出现「表加了、面包屑忘了」的漂移。

详情页的「返回」用 `setConsolePage(page, { sub: '' })`（入历史栈），不用 `history.back()`：从外部深链进来时栈里没有上一页，`back()` 会把用户送出控制台。

---

## 4. 平台专有配置归一

### 4.1 归属判定：三个问题定去处

| 问题 | 去到哪 |
| --- | --- |
| 换个 Agent 平台还成立吗？ | 成立 → 全局配置（`config.json` 顶层段）；不成立 → 平台配置（`platforms.agents.<id>.options`） |
| 换个用户平台还成立吗？ | 不成立 → 用户平台条目（`platforms.users.<id>`） |
| 需要连上对端才知道吗？ | 需要 → 平台自带的 `modelCatalog` 声明；不需要 → 静态配置 |

按此判据，模型目录、思考强度、上下文压缩策略、价目表**全部属于 Agent 平台**，因为它们描述的是「这个平台有什么模型、怎么涨上下文、多少钱」。

### 4.2 `modelCatalog`：平台自描述

在 `profiles/agent-platforms/<id>/platform.yml` 顶层新增 `modelCatalog`（与 `configSchema` 同级，由 `src/platforms/index.mjs:67` 同一处读入）：

```yaml
modelCatalog:
  models:
    - { id: deepseek-v3, label: 'DeepSeek V3', contextWindow: 128000,
        pricing: { input: 2, output: 8, cacheRead: 0.5, unit: 'perMillionCNY' } }
  efforts:                       # 思考强度档位；没有就是单档
    - { id: off, label: '关闭' }
    - { id: high, label: '高' }
  compact: { approxTokens: 800000 }   # 平台自己压缩时的近似触发点
```

规则：

- 全部字段可缺省；缺省即「本平台不声明」，界面按无该能力降级，不阻塞聊天。
- **不做 schema 校验器的共用**：`configSchema` 校验的是用户可写的平台选项（`vetPlatformConfig`，`src/bridge.js:7772`），`modelCatalog` 是平台作者写的只读元数据，两套语义不同，混进同一个校验器会让「作者写错目录」变成「用户配置非法」。
- 目录经注册表投影一路带出：`src/agent-side/runtime-registry.mjs:179` 与 `src/platforms/registry.mjs:320` 的条目加 `modelCatalog`。

### 4.3 接口

| 接口 | 语义 |
| --- | --- |
| `GET /api/platforms/registry` | 已有；Agent 侧条目新增 `modelCatalog`（声明部分，纯静态，随注册表一次带回） |
| `GET /api/platforms/registry/agent/<id>/models` | 新增；返回 `{ declared, live }`。`live` 来自该平台的 `listModels()`，30 秒内存缓存，失败为 `null` 且不影响 `declared` |

`live` 单独成端点，是因为 ACP 实现会为读目录建一个探测会话（`src/agent-side/adapters/acp/port.mjs:14`），不能塞进被轮询的注册表响应里。

控制台侧只在 `js/registry.js` 增加 `loadModelCatalog(agentId)`（复用同一个缓存骨架），不新建模块。

### 4.4 四个消费点改造

| 消费点 | 现在 | 改为 |
| --- | --- | --- |
| 全局配置页的模型 / 思考强度卡 | `POST /api/dsh/model` | 移到平台详情页；写 `platforms.agents.<id>.options`，走 `models` 能力位的 `selectModel(ref, params)` |
| 运行总览价目表 | `src/model-prices.js` 的 `DEFAULT_PRICE_TABLE`（DeepSeek 专属） | `modelCatalog.models[].pricing`，`config.pricing` 仍可作为运维覆盖 |
| 上下文压缩 | `config.socialV2.compact`，模式值 `early` / `dsh`，文案写死「交给 DSH 自己压缩」 | 模式值 `early` / `agent`，阈值缺省取 `modelCatalog.compact.approxTokens` |
| 能力档 / 工具面展示 | `CAPABILITIES_ROOT` 硬编码 `dsh` | 按当前活动的 Agent 平台 id 取目录 |

`src/model-prices.js` 里的价格计算函数保留（它是纯算术），只删掉 DeepSeek 专属的默认表与「只有 DSH 模型」的注释；没有 `pricing` 时不估算、显示为「未声明」，**不做兜底猜测**。

### 4.5 全局配置页只剩通用项

`POST /api/dsh/model` 与其全部引用（24 处）当批删除，替换为 4.4 的读口。

删完后逐项核对：全局配置页每个分区都必须是 `config.json` 的顶层段（`saveConfigSection()` 写回）。当前已满足的有 `permission`、`limits.send`、`role.default`、`runtime.*`、`socialV2.*`、`security.*`；改造后新增的项若落在 `state/*.json`，一律改到 `config.json`，不留第二种存储。

### 4.6 去硬编码清单（当批核销）

- `CAPABILITIES_ROOT` 里的 `dsh` 常量。
- `src/dsh-model.js` 中供界面使用的专有分支（纯文本解析工具保留）。
- 界面文案里的「DSH 自己压缩」「DSH 模型」「运行期恒为 dsh」（后者若是测试 fixture 的注释，改成「运行期平台固定」）。
- `docs/` 与代码注释里把「执行体」当唯一说法的段落（改写范围见 §7 B2 第 5 条）。

---

## 5. 默认运行方案：三级链

### 5.1 解析链

```
会话 planId（state/profiles 里的覆盖）
  → platforms.users.<用户平台 id>.defaultPlan（该平台新建会话的默认）
    → 内置常量 DEFAULT_PLAN_ID（'social-v2'）
```

- 会话 key 形如 `qq:group:1054824508`，首段即用户平台 id，因此「按平台」不需要额外索引。
- 与现状的差别：`activePlan()` 不再读 `config.runtime.defaultPlan`，改为按 key 首段查平台条目。
- 只影响**新建会话**；已有会话的 `planId` 覆盖行为不变。

### 5.2 配置落点

`platforms.users.<id>.defaultPlan` 必须是**条目级键**，与 `enabled` 同级，不能落进 `options`：`normalizeUserEntry()`（`src/config/platforms.mjs:107`）会把未知键并入 `options` 交给适配器，`defaultPlan` 是桥接自己的语义，进 `options` 会让用户平台适配器收到一个与它无关的键。

```js
// normalizeUserEntry 的返回值
{ account, enabled, defaultPlan: normalizeRuntimePlanId(src.defaultPlan) || '', transport, options }
```

写口复用 `patchPlatformConfig`（`src/bridge.js:1073`）的用户侧分支，不新开端点。

### 5.3 版本迁移

`CONFIG_VERSION` 2 → 3（`src/config/platforms.mjs:36`），迁移函数沿用现有 `migrateConfigToV2` 的位置与调用约定（返回 `{ config, migrated, notes }`，由调用方备份后写盘）：

1. 把 `runtime.defaultPlan` 的值写进**当时活动的用户平台**条目的 `defaultPlan`；
2. 删掉 `runtime.defaultPlan` 键（其余 `runtime.*` 保留）；
3. `notes` 里记一句人话，进启动日志。

**不留兼容层**：迁移完成后，`/api/config/runtime` 的 GET 响应里不再出现 `defaultPlan`，`activePlan()` 里不再有「先读全局再兜底」的双路径，`test-runtime-plans.mjs:134` 的断言改成「默认方案来自活动用户平台条目」。

### 5.4 界面落点

- 平台详情页新增「默认运行方案」字段：`renderFields` + `page_defaultPlan` 规格；保存走该页 save-dock 的分区（一次 `POST /api/platforms/users/<id>`）。
- 运行总览删掉「全局默认运行方案」卡片；概览指标格里那格「默认方案」改为显示**当前运行平台**的默认方案。
- 全局配置页与运行方案页**都不再出现**全局默认方案控件（运行方案页只解释方案本身）。`#runtimeDefaultSelect` 随之退役，新字段 id 为 `platformDefaultPlan`，同批更新 `scripts/console-ui-legacy-ids.json` 与 `console-ui-retired-ids.json`。

---

## 6. 细节三项

### 6.1 `full` 档

- 选项生成改成函数式：在渲染时按 `allowFull` 动态算，**且当前值始终并入选项**（即使全局开关此刻关着，已存 `full` 的会话/配置也要能显示出来，否则下拉显示为空）。
- 落点：`js/permission-levels.js` 增加 `permissionLevelOptionsFor({ allowFull, current })`；`pages/overview/fields.js` 的静态 `options` 改为 `optionsFor` 钩子，`renderFields` 支持函数型 `options`（这是唯一需要扩的点，扩完其他静态 `options` 不受影响）。
- 同时把「关掉 `allowFull` 立刻收回授权」的既有后端行为（`src/bridge.js:9926`）在界面上显式写进字段 hint，避免用户以为只是「不显示了」。

### 6.2 人格注入块可关

- 注入块页的人格槽位新增「启用」开关；`enabled: false` 时**不注入该槽位**（而不是注入空串——空串会占掉提示词里的分隔位置，让模型看到一段空白）。
- 配置落点：`config.promptBlocks.<slot>.enabled`（现有 `limits` 同段），存储仍走 `saveConfigSection`。
- 关闭态在注入块页的槽位卡片上直接体现（`tag('已关闭', { type: 'warning' })`），不另开弹窗解释。

### 6.3 直通档去特例

- 会话管理弹窗里为直通单独开的那张配置卡取消，直通并入统一的「执行与权限」卡：它是一个各平台通用的运行方案，不该在详情里长出一个别人没有的区块。
- 直通特有的「重新打开」动作移到危险操作区（会话弹窗的危险动作区已存在），不新开区块。
- `EXECUTION_BODY_GENERALIZATION.md` 里把直通写成「特殊方案」的措辞同批改掉。

---

## 7. 批次计划

四批，**批内任务连续做完再停**；每批必须带着全绿门禁收尾，不留半成品跨批。每批都含「当批删除」，旧方案不推到下一批再删。

**进度**：B1 ✅ 已收尾；B2 进行中（1–3 已完成：平台清单与二级页、插件二级页）；B3 / B4 未开始。

### B1 底座：组件能力 + 子路由 + 令牌债

| # | 任务 | 落点 |
| --- | --- | --- |
| 1 | `--split-list-w` 变量化（默认 `minmax(272px, 348px)`）、`gap` 与圆角改走令牌、新增 `toolbar` 槽、删 `height` 参数与 `--split-height`/`data-fixed-height` | `components/split-view/{split-view.js,split-view.css}` |
| 2 | `tileHtml` 增加 `icon` 与默认首字图标块、`.tile-head-body` | `components/tile/tile.js`、`css/components.css` |
| 3 | `parsePageHash` / `sub`+`tab` 贯通 / `onPageRoute` / 事件 detail 扩展 | `js/router.js` |
| 4 | 令牌债：`var(--line)`（mcp 1 处、plugins 2 处）改用 `--border-chip`；`var(--text-2)`（mcp 1 处）改用 `--muted`；`var(--danger)` 当文字色的 2 处（mcp）改用 `--danger-fg` | `pages/mcp/page.css`、`pages/plugins/page.css` |

**当批删除**：`split-view` 的 `height` 支路与相关 CSS；上述三处未定义令牌的引用。

**出口**：`npm run test:console:static`、`npm run test:console:ui`、三档宽度（≤760 / 900–1180 / ≥1500）截图核对「MCP 左栏变宽、插件与人格卡片出现默认图标、其余页面零视觉变化」。

### B2 页面 IA：平台两级 + 插件二级页 + MCP 两栏

| # | 任务 | 落点 |
| --- | --- | --- |
| 1 | 平台页改为「诊断汇总（仅有 error 时出现）+ 两个 `collapseHtml` 分组（用户平台 / Agent 平台）+ `tileHtml` 网格」；每张卡进二级页 | `pages/platforms/{page.html,page.js,page.css}` |
| 2 | 平台二级页：把现有右栏 `shell()` 的内容搬成整页，`#platforms/<side>:<id>`，页头「返回」+ 平台名 + 状态徽标，正文按「连接 / 平台选项 / 工具与话术 / 行为 / 诊断」分节卡 | 同上 |
| 3 | 插件详情由弹窗改为二级页 `#plugins/<id>`：概览 / 配置 / 审计三块折叠或分节，保存走该页 save-dock | `pages/plugins/{page.html,page.js,page.css}` |
| 4 | MCP 两栏细节：工具栏下沉左栏（槽里放 `tableToolbarHtml`）、右栏分节卡、列表项信息重排（标题 + 状态徽标 + 一行摘要） | `pages/mcp/{page.html,page.js,page.css}` |
| 5 | 名词统一：界面文案与 `consolePages` 说明里「执行体 / Agent 侧 / 用户侧」→「Agent 平台 / 用户平台」（协议字段名 `agent` / `user` 不动，它们本来就中性） | `js/router.js`、各页文案 |
| 6 | `full` 档（§6.1） | `js/permission-levels.js`、`pages/overview/fields.js`、`pages/sessions/page.js` |
| 7 | 直通去特例（§6.3） | `pages/sessions/{page.js,fields.js}` |

**当批删除**：`platforms` 页的 `splitViewHtml` 用法、`.split-group`、右栏 `shell()` 内部布局；`plugins` 的详情弹窗 HTML 与打开路径；`pages/mcp/page.css` 的 `.mcp-tool-list/.mcp-tool`（与 `dataTableHtml` 重复的第二套表格样式）；`overview/fields.js` 里 `permissionLevelOptions(false)` 的静态选项。

**出口**：新增的路由深链（`#platforms/agent:dsh`、`#plugins/<id>`）刷新后能还原、前进/后退可回退；27 条写载荷契约不变（详情页保存走同一批端点）；`legacy-ids` 与 `retired-ids` 同批对齐。

### B3 配置归一：平台自描述 + 全局配置收口

| # | 任务 | 落点 |
| --- | --- | --- |
| 1 | `platform.yml` 增加 `modelCatalog`，注册表两处投影带出 | `profiles/agent-platforms/dsh/platform.yml`、`src/platforms/{index.mjs,registry.mjs}`、`src/agent-side/runtime-registry.mjs` |
| 2 | `GET /api/platforms/registry/agent/<id>/models`（`declared` + `live`，30s 缓存，失败降级） | `src/bridge.js` |
| 3 | 控制台读口：`loadModelCatalog(agentId)` | `js/registry.js` |
| 4 | 模型 / 思考强度从全局配置搬到平台详情页，写 `platforms.agents.<id>.options`，走 `models` 能力位 | `pages/config/**`、`pages/platforms/page.js` |
| 5 | 价目表改由 `modelCatalog.models[].pricing` 提供，`config.pricing` 作为覆盖；无声明时显示「未声明」，不估算 | `src/model-prices.js`、`pages/overview/**` |
| 6 | 压缩模式 `early` / `agent`，阈值缺省取 `modelCatalog.compact.approxTokens` | `src/bridge.js`、`pages/config/compact.js` |
| 7 | `CAPABILITIES_ROOT` 去硬编码 | `src/**` |
| 8 | 人格注入块可关（§6.2） | `pages/prompt-blocks/**`、`src/bridge.js` |
| 9 | 全局配置页逐项核对：每个分区都写 `config.json` 顶层段 | `pages/config/**` |

**当批删除**：`POST/GET /api/dsh/model` 及其 24 处引用；`DEFAULT_PRICE_TABLE` 的 DeepSeek 专属条目与「只有 DSH 模型」注释；`config.socialV2.compact` 的 `dsh` 模式值（迁移到 `agent`，不留双写）；`src/dsh-model.js` 的界面专有分支。

**出口**：把 Agent 平台切到 ACP（config 里改 active）后，全局配置页与运行总览**不显示任何 DSH 专属内容**，且不报错；`test-audit`、`test-token-usage`、`test-dsh-model` 同批改写通过。

### B4 默认方案三级链 + 收口

| # | 任务 | 落点 |
| --- | --- | --- |
| 1 | 条目级 `defaultPlan`（`normalizeUserEntry`）+ 写口复用 `patchPlatformConfig` | `src/config/platforms.mjs`、`src/bridge.js` |
| 2 | `CONFIG_VERSION` 3 + 迁移（旧 `runtime.defaultPlan` → 活动用户平台条目，删旧键） | `src/config/platforms.mjs` |
| 3 | 解析链按会话 key 首段取平台默认；删 `activePlan()` 的全局分支 | `src/bridge.js:4592` |
| 4 | 平台详情页「默认运行方案」字段（`platformDefaultPlan`） | `pages/platforms/**` |
| 5 | 运行总览删「全局默认运行方案」卡，指标格改显示当前运行平台的默认方案 | `pages/overview/**` |
| 6 | 契约与夹具：`--accept-contracts` 重录；`console-ui-fixture.mjs` 的 `state.defaultPlan` 改到平台条目；`legacy-ids` / `retired-ids` 收口 | `scripts/**` |
| 7 | 文档全量同步（§9） | `docs/**` |

**当批删除**：`config.runtime.defaultPlan`（读、写、补默认值、端点响应字段、fixture、测试断言全部一次清）；`#runtimeDefaultSelect` 相关字段规格。

**出口**：全量门禁绿；`grep -r "defaultPlan" src/ scripts/` 只剩平台条目路径；两平台各设不同默认方案后，新建会话分别落对方案。

---

## 8. 验收

每批收尾必跑（顺序固定，先静态后浏览器）：

```powershell
node scripts/test-console-static.mjs
npm run test:console:ui
npm run test:audit
npm run verify:repo
```

补充判据：

- **契约变更**：本改造会改「默认方案来源」与「平台配置写口」两类载荷，属于真变更 —— 用 `node scripts/test-console-ui.mjs --accept-contracts` 重录后，把变更点逐条写进当批说明，不允许「重录即通过」了事。
- **三档截图**：≤760 / 900–1180 / ≥1500 各一张，覆盖平台页、平台二级页、插件二级页、MCP 页。核对项：栏宽、卡片间距、控件同高、图标与标题基线。
- **平台无关性**：B3、B4 收尾时把活动 Agent 平台临时改成 ACP，确认全局配置页、运行总览、平台页不出现 DSH 专属项。

---

## 9. 文档维护清单

改造与文档同批完成，不留「下个版本再补」。

| 文档 | 要改的部分 |
| --- | --- |
| `docs/CONSOLE.md` | §4 组件 API（`tile` 的 `icon`、`split-view` 的 `toolbar` 与 `--split-list-w`）；§6 契约（子路由、`platformDefaultPlan` 替代 `runtimeDefaultSelect`）；§9 界面口径表（默认方案落点、名词统一） |
| `docs/CONSOLE_FORMS.md` | §4「一个页面的固定骨架」补两种骨架：卡片网格页、二级详情页；工具栏复用规则 |
| `docs/CONSOLE_FORM_LESSONS.md` | 修 1.53 / 1.74 里已废弃的 `.pill` 表述；新增条目：子路由三处必须同批改、`tile` 图标缺省也要渲染、`split-view` 宽度只用变量、二级页返回不能 `history.back()` |
| `docs/PLATFORM_UNIFICATION.md` | 界面 IA 章节改写为「卡片 + 二级页」；`modelCatalog` 与 `/api/platforms/registry/agent/<id>/models` |
| `docs/PROFILES_MODEL.md` | 三层默认方案解析链；`platforms.users.<id>.defaultPlan` 的条目级地位；config v3 |
| `docs/EXECUTION_BODY_GENERALIZATION.md` | 名词统一（执行体 → Agent 平台）；直通不再是特例方案 |
| `docs/SESSION_SUBSYSTEM.md` | 会话默认方案来源改按平台 |
| `docs/AGENT_PLATFORM_EVOLUTION.md` | `modelCatalog` 作为平台自描述的一部分 |
| `docs/guides/CONFIGURATION.md` | config v3 字段与迁移说明；`compact` 的 `agent` 模式 |
| `docs/FOLDER_MAP.md` | 若 `js/registry.js` 职责扩张，补一句 |
| `docs/README.md` | 登记本文档（见已加的行） |
| `CHANGELOG.md` | 发布时汇总，不逐批改 |

---

## 10. 已定口径

写在这里是因为它们会反复被问到，且都已有充分理由，不再逐条征询。

1. **兜底方案仍是 `social-v2`**：内置方案是只读文件、不会缺失，用常量兜底比「无默认」更可预期。
2. **人格块关闭 = 不注入该槽位**，不是注入空串（空串会占掉提示词里的分隔位）。
3. **名词统一只改界面文案与文档**，协议字段名保持 `agent` / `user`：它们本来就中性，改名要动配置存储与契约，收益为零。
4. **子路由不参与面包屑**，避免 `consolePages` 长出第三列标题造成两处漂移。
5. **`split-view` 左栏宽度只给 CSS 变量**，不做拖拽手柄：拖拽需要落盘、窄屏重置、键盘可达性与复位，成本高于收益。
6. **`modelCatalog` 不并入 `configSchema` 校验器**：一个是平台作者的只读元数据，一个是用户可写的平台选项，混用会把作者笔误报成用户配置非法。
