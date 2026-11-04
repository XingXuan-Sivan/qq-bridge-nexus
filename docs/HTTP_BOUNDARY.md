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

- 控制台已是分层目录：`public/console/index.html`（结构）、`public/console/css/app.css`、`public/console/js/app.js`；`GET /` 与 `GET /console/` 返回 index（失败 404「控制台页面缺失」）。
- 静态资源只放行 `^/console/(css|js|img|fonts|pages)/` 这五个子目录，且**排在令牌校验之前**——浏览器取 `<link>`/`<script>` 不会带 `x-console-token`，放在鉴权之后页面会白屏（实测：拆分后不前置时 `/console/js/app.js` 返回 401）。页面本身（`/`、`/console/`）仍要求令牌。`pages/` 是页面片段目录（`pages/<id>/page.html`、同目录 `page.css` 与页面模块 `page.js`），由路由器在进入该页时按需 fetch，扩展名仍受白名单约束（`.html/.css/.js`）。
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

### 现状（2026-11-04）

```js
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
```

控制台已拆成 `public/console/index.html` + `css/app.css` + `js/app.js`，但 `unsafe-inline` 仍在：`index.html` 里还有一小段内联的主题脚本（防首屏闪白）和若干内联 `style="..."` 属性。下一步是把主题脚本改成外部 module、内联样式收敛成 class，然后才能去掉 `unsafe-inline`。

### 目标（前端分层完成后）

```
default-src 'self';
script-src 'self';
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
frame-ancestors 'none';
base-uri 'none';
form-action 'self';
object-src 'none'
```

- 迁移期允许「先外链、后删 `unsafe-inline`」两步走，但**不允许长期停留在 `unsafe-inline`**；
- 任何新页面不得新增内联 `onclick=` / `<style>` 块；老代码迁移时按页替换；
- 控制台不加载任何第三方 CDN 资源（离线可用的前提）。

### 为什么必须 `frame-ancestors 'none'` + `X-Frame-Options: DENY`

控制台持有 `x-console-token`，被任何站点 iframe 嵌套都可能被点击劫持。两个头同时给，兼容老浏览器。

---

## 4. 路由与刷新语义（前端契约）

### 页面标识

- 唯一真源是 URL hash：`#overview`、`#plugins`、`#scheduler`…，键集合 = `consolePages` 的 key。
- 导航点击 → `pushState` 写 hash；**刷新必须回到同一页**，这是硬要求（当前实现不满足，见 `PLUGIN_ROADMAP.md` §8.7 的 B1）。

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
| 面包屑 | 任意二级页的可点父级能回到父页，键盘 Tab 可达 |
| 搜索层级 | 任意页面点开搜索候选，候选不被卡片遮挡（截图 + `z-index` 断言） |
| CSP | 响应头不含 `unsafe-inline`（迁移完成后）；控制台无内联 `onclick=` |

自动化入口：`npm run test:console-static`（静态断言）、`npm run test:audit`（接口与集成）、新增 `test:http-boundary`（穿越/404 用例，随 HTTP 层抽取一起加）。
