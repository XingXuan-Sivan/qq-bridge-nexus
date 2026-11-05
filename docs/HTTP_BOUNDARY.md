# HTTP 边界约定（docs/HTTP_BOUNDARY.md）

> 适用对象：所有改 `src/bridge.js` 请求处理、加静态资源、加插件 UI、动 CSP 的改动。
> 状态：✅ 现行约定（2026-11-04 起）。本文只写「必须怎样」和「为什么」，实现位置见每节末尾。

## 为什么要有这份文档

桥接是一个**单进程、无框架、把控制台和 API 暴露在本机端口**的服务：`http://127.0.0.1:3111` 上既有人点开的控制台页面，也有 QQ 里的 AI 调用的 MCP 接口，还有插件注册进来的命令与任务。
这条边界一旦松动，后果不是「样式错了」，而是**任意文件读取**（路径穿越）、**越权探测**（用 403/404 的差异判断某个功能是否存在）、**样式与脚本互相污染**（插件的 CSS/JS 跑进宿主页面）。所以三条规则在写第一行业务代码之前先定死。

---

## 1. 路径穿越：静态资源只允许 `public/` 下的真实文件

### 规则

1. **只有显式登记的静态前缀才走文件系统**，例如 `/console/` → `public/console/`、`/assets/` → `public/assets/`。不做「兜底把一个 URL 映射成任意路径」。
2. 解析顺序固定：
   ```js
   const rel = decodeURIComponent(pathname).replace(/^\/+/, '');   // 只解码一次
   const abs = path.resolve(staticRoot, rel);
   const relToRoot = path.relative(staticRoot, abs);
   if (!relToRoot || relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) reject(); // 逃逸
   ```
   注意：`path.join` 不防穿越，`path.resolve` + `path.relative` 才防。
3. **拒绝清单**（命中即 404，不解释原因）：
   - 任何解析后落在根外的路径（`..`、`%2e%2e`、`%2f`、`%5c`、多重编码）；
   - Windows 盘符/ADS/UNC：含 `:`（`C:`、`file.txt::$DATA`）、以 `\\` 开头；
   - 解析后若不是**普通文件**（目录、设备、符号链接指向根外）——`fs.lstat` 后 `isSymbolicLink()` 一律拒绝；
   - 大小写不敏感文件系统上的「同名不同大小写」绕过：白名单扩展名按小写比较，且只允许 `.html/.css/.js/.svg/.png/.woff2/.json`。
4. **响应头**：静态资源带 `X-Content-Type-Options: nosniff`；`content-type` 由扩展名映射，**不猜**。
5. **错误一律 404**，body 统一 `{"ok":false,"error":"not found"}`——不回显请求路径，不区分「不存在」与「越界」。

### 现状

- 控制台已是分层目录：`public/console/index.html`（结构）、`public/console/css/{tokens,base,layout,components}.css`（按加载顺序分层）、`public/console/js/*.js`（公用模块 + `pages/<id>/page.js`）；`GET /`、`GET /console/` 与 `GET /console` 返回 index（失败 404「控制台页面缺失」）。
- 静态资源只放行 `^/console/(css|js|img|fonts|pages|gate)/` 这六个子目录，且**排在令牌校验之前**——浏览器取 `<link>`/`<script>` 不会带 `x-console-token`，放在鉴权之后页面会白屏（实测：拆分后不前置时 `/console/js/app.js` 返回 401）。页面本身（`/`、`/console/`、`/console`）仍要求令牌。`pages/` 是页面片段目录（`pages/<id>/page.html`、同目录 `page.css` 与页面模块 `page.js`），由路由器在进入该页时按需 fetch，扩展名仍受白名单约束（`.html/.css/.js`）；`gate/` 是 401 门页自己的 `index.html`、`gate.css`、`gate.js`——门页是**整页文档**，不能并入 `pages/`（那里会被 `console-source` 拼进控制台源码）。
- 无令牌或令牌失效时，页面入口返回 **401 + `public/console/gate/index.html` 的原文**（`src/bridge.js` 读文件，缺文件 500 兜底）。门页不内联脚本/样式，URL 不变，因此 `location.hash` 天然保留；提交后由 `api.js` 落盘令牌并 `replaceState` 还原 hash。
- 页面鉴权通过后服务端种 `qq_console_token`（`Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`）：之后刷新导航由浏览器自动带上，直接 200，不再「401 → 门页 → 跳 `?token=`」闪一下。cookie **只**参与页面 GET，API 仍只认 `x-console-token`；页面取值优先级 `?token=` > cookie > 头。
- 守卫实现：`src/http/static.mjs` 的 `resolveStaticPath` / `serveStaticFile` / `sendNotFound`；用例 `scripts/test-http-boundary.mjs`（7 pass / 1 skip，符号链接用例在无权限环境自动跳过）。
- 新增静态目录（例如将来的 `public/console/img/`）只需在 `resolveStaticPath` 的调用里登记前缀，不要另写一套校验。

---

## 2. 未启用 = 404，不是 403

### 语义表

| 情况 | 状态码 | 判据 | 备注 |
| --- | --- | --- | --- |
| 插件不存在 / 未安装 | 404 | `plugins.detail(id)` 为空 | 已有实现：`src/bridge.js:4794` |
| 插件存在但被禁用，且访问的是**它的路由/命令** | 404 | 运行态里 `enabled=false` | 等同于「这个能力当前不存在」 |
| 插件被禁用，但访问的是**审计/历史** | 200 | 审计是宿主资产 | 禁用不等于抹掉痕迹 |
| 未知 API 端点 | 404 | 落到兜底分支 | 已有实现：`src/bridge.js:9136` |
| 未知页面 hash | 200 + 首页 | `consolePages` 不含该 key | 见 §4，前端行为 |
| 令牌缺失/错误 | 401 | 鉴权中间件 | 与「存在性」无关，**先鉴权后存在性** |
| 已鉴权但无权限做该动作 | 403 | 权限位/模式闸门 | 仅用于「资源存在且你有权知道它存在」 |

### 为什么不能用 403 表示未启用

403 等于承认「这东西存在，只是不给你」，攻击者可据此枚举插件 id、探测未发布功能。**存在性只对已鉴权的主体暴露**；对未鉴权请求，401 先于一切。

### 实现位置

鉴权/路由都在 `src/bridge.js` 的请求处理段；抽 HTTP 层后统一由 `src/http/router.mjs` 的 `notFound()` 与 `requireEnabledPlugin()` 保证。

---

## 3. CSP 与安全响应头

### 现状（2026-11-05：已收紧，无 `unsafe-inline`）

```js
// src/http/security.mjs
export const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
```

控制台已彻底外置：`public/console/index.html` 只留骨架与 `<link>`，样式在 `css/{tokens,base,layout,components,utilities}.css`，脚本在 `js/*.js` 与 `pages/<id>/page.js`；401 门页 `public/console/gate/` 同样只走外链（`gate.css`、`gate.js`），响应体是它的 HTML 原文。收敛路径（`docs/PLUGIN_ROADMAP.md` §8.7 的 3.3）：

1. 407 处内联 `style` → 57 个工具类（`utilities.css`），HTML 与页面模块里现在 **0 处内联 style**；
2. 表格列宽由 `style="width:Npx"` 改成 `data-w="N"`，`components.css` 按 `th[data-w]` 给宽度；
3. `el.style.display` 全部改成 `hidden` 属性（`base.css` 有 `[hidden]{display:none!important}` 兜底）；
4. 内联主题脚本抽成 `js/theme-boot.js`（仍是同步 `<script src>`，放样式表之前防闪白）；
5. 动态尺寸（搜索候选定位、用量进度条宽度）走 **CSSOM**（`el.style.width = …`），CSP 的 `style-src` 不拦 CSSOM 写入——这是「不用 `unsafe-inline` 也能动态排版」的正规路径。

回归门禁：`scripts/test-http-boundary.mjs` 断言 CSP 不含 `unsafe-inline`；`scripts/test-console-static.mjs` 断言 HTML/页面模块 0 处内联 style、index 无内联 `<script>`/`<style>`，并把每个控制台模块复制成 `.mjs` 交给 `node --check` 做语法校验。

### 约定

- 任何新页面不得新增内联 `onclick=` / `style=` / `<style>` 块；需要动态尺寸时用 CSSOM 或工具类；
- 控制台不加载任何第三方 CDN 资源（离线可用的前提）；
- 改 CSP 必须同时跑 `test-http-boundary` 与 `test-console-static`，并在浏览器里确认没有 `securitypolicyviolation`。

### 为什么必须 `frame-ancestors 'none'` + `X-Frame-Options: DENY`

控制台持有 `x-console-token`，被任何站点 iframe 嵌套都可能被点击劫持。两个头同时给，兼容老浏览器。

---

## 4. 路由与刷新语义（前端契约）

### 页面标识

- 唯一真源是 URL hash：`#overview`、`#plugins`、`#scheduler`…，键集合 = `consolePages` 的 key。
- 导航点击 → `pushState` 写 hash；**刷新必须回到同一页**，这是硬要求（三层恢复见下，B1 已收口）。

### 令牌门页

- 401 只发生在页面入口（`/`、`/console/`、`/console`）；响应体是 `public/console/gate/index.html`（整页文档），URL 不变，所以 `location.hash` 天然保留。
- 门页提交时拼成 `/?token=<新令牌>#<原页面>`；`api.js` 的 `bootstrapConsoleToken()` 落盘后 `replaceState` 回 `#<原页面>`。
- 带 `?token=` 仍 401 ⇒ 令牌被拒：门页清掉本地令牌、抹掉地址栏里的失效令牌并提示「令牌无效或已更换」，不自动重试；`?manual=1` 跳过自动尝试（控制中心的手动入口）。
- 控制台里 API 401 不弹原生 `prompt`，统一跳 `/?reauth=1#<原页面>`；服务端见到 `reauth=1` 时忽略仍然有效的页面 cookie、强制返回门页（否则会 401 → 控制台 → 401 循环）。门页清掉旧令牌并提示「登录状态已失效」，提交后回原页面。
- 鉴权通过后服务端种 `qq_console_token`（HttpOnly / SameSite=Strict / 30 天滑动）：刷新导航直接 200，不再回门页；`page.js` 放 `<head>` 先于样式表，只在没有 cookie 且本地有令牌时于首绘前跳 `?token=`。

### 恢复顺序（三层保底）

1. `location.hash` 有效 → 用它；
2. hash 为空/非法 → 读 `sessionStorage['console-page']`（同标签页刷新/回退）；
3. 仍无 → `overview`，并用 `replaceState` 把 URL 补成 `#overview`（避免地址栏长期裸着）。

### 事件

- `hashchange`：外部改 hash（手输、深链）；
- `popstate`：前进/后退。**两者都要监听**，且都要走同一个 `applyPage()`，不允许两套逻辑。

### 未知页面

不弹错、不白屏：回 `overview`，并在页内提示一次「没有这个页面，已回到运行总览」。**不允许** 500 或空白。

---

## 5. 样式与脚本隔离

### 宿主

- 控制台所有样式集中在 `public/console/css/`，用 CSS 变量（`--surface`、`--accent`…）表达主题，禁止在 JS 里拼 `style="..."` 做布局；
- 组件类名走统一前缀语义：布局（`.workspace/.topbar`）、组件（`.tile-list/.tile`、`.settings-group/.settings-content`）、页面（`#section-*`）。新增页面前先对照「人格与角色」页，不许自造网格与间距。

### 共享令牌（控制台 / 控制中心）

- 唯一来源是 `public/console/css/tokens.css`：两个页面都 `<link>` 同一份文件，不复制、不各自维护色板。
- 控制中心由 launcher 在 `127.0.0.1:3099` 托管，读不到桥接的 `/console/*` 路由；`src/launcher/control-center.mjs` 用固定文件表暴露 `/shared/tokens.css` 与 `/shared/theme-boot.js`（只这两个文件，不走目录遍历），内容与磁盘上一模一样。
- 令牌按语义命名，不按消费方命名：`--term-*`（终端面板）控制中心现在用、控制台以后也可以直接用于日志视图；字体 `--font-ui/--font-mono`、实心底色 `--on-solid`、危险实心 `--danger-solid` 同理。
- 主题仍是 `:root` 浅色 + `[data-theme="dark"]`；终端配色只在 `:root` 定义、深色块不覆盖（终端恒深底）。
- `public/control-center/app.css` 不再有 `:root`、不再用 `prefers-color-scheme`；控制中心 `index.html` 先加载 `/shared/theme-boot.js` 与 `/shared/tokens.css`，再加载自己的 `app.css`。

### 插件 UI（未来契约，先定边界）

插件若要在控制台里出界面，**一律 iframe 沙箱**：

```html
<iframe sandbox="allow-scripts" src="/plugin-ui/<id>/"></iframe>
```

- 不给 `allow-same-origin`（插件脚本拿不到宿主 cookie/localStorage/token）；
- 通信只走 `postMessage`，协议版本化（`{v:1, type, payload}`），宿主侧对消息做白名单校验；
- 插件 CSS 只作用于自己的 iframe 文档，**禁止**通过注入 `<style>` 影响宿主；
- 插件 UI 的资源同样走 §1 的静态守卫（前缀 `/plugin-ui/<id>/`）。

### 为什么不用「同一个文档 + 命名空间前缀」

命名空间靠自觉，一次 `body{...}` 就污染全局；iframe 是浏览器强制的边界，代价只是多一次 postMessage。

---

## 6. 验收清单（改这块时必须跑）

| 项 | 怎么验 |
| --- | --- |
| 路径穿越 | `GET /console/../../state/console-token`、`/%2e%2e/state/console-token`、`/console/..%5c..%5cstate` 全部 404，且 body 不含路径 |
| 符号链接 | 在 `public/` 下建指向 `state/` 的链接，请求必须 404 |
| 未启用 404 | 禁用某插件后请求它的路由得 404；审计仍 200 |
| 未知 API | 任意 `/api/nope` → 404 `{"ok":false,"error":"not found"}` |
| 刷新保页 | 打开 `#scheduler` 后 F5，仍在 `#scheduler`；关闭标签再开回落 `#overview` |
| 刷新不闪门页 | 登录后 F5 直接 200（响应带 `Set-Cookie` 续期），不出现门页卡片 |
| 无令牌打开控制台 | `GET /` 得 401 + 门页（有输入框、无白屏），源码不含内联 `<script>` |
| 令牌失效回跳 | 带旧令牌打开 `#scheduler`，门页提示并抹掉 URL 里的 `?token=`；输入新令牌后落回 `#scheduler` |
| 面包屑 | 任意二级页的可点父级能回到父页，键盘 Tab 可达 |
| 搜索层级 | 任意页面点开搜索候选，候选不被卡片遮挡（截图 + `z-index` 断言） |
| CSP | 响应头不含 `unsafe-inline`；控制台与 401 门页都没有内联 `onclick=` / `<script>` |

自动化入口：`npm run test:console-static`（静态断言）、`npm run test:audit`（接口与集成）、新增 `test:http-boundary`（穿越/404 用例，随 HTTP 层抽取一起加）。
