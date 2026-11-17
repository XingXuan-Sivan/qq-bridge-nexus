# 新增用户平台（微信 / B 站 / Telegram …）

> 对称于 Agent 侧（`profiles/agent-platforms/<id>/` + `src/agent-side/`）。本文描述 **0.2.0（平台解耦 B5 / B6）**
> 之后、且 **C3 入站接通后**的实际做法；规格与取舍见 [PLATFORM_DECOUPLING.md](../PLATFORM_DECOUPLING.md)
> §2.5 / §3.2 / §5.4 与 [PLATFORM_UNIFICATION.md](../PLATFORM_UNIFICATION.md) §六。

---

## 一、先分清两件事

| 层 | 回答的问题 | 落在哪 |
| --- | --- | --- |
| **传输**（怎么连上平台） | 用什么协议收发、鉴权、重连 | `src/user-side/adapters/<id>/`；出站插件侧入口是 B6 的 `transport:provide`，入站是 C3 的 `connect` |
| **业务**（连上之后拿它做什么） | 会话、准入、唤醒、人格、表情、语音… | 内核模块（`session/` `social/` `runtime/` …），**不需要为新平台改** |

新增平台只碰第一层。如果发现要改第二层，先确认是不是把「平台的实现细节」泄漏成了内核逻辑。

## 二、四步落地

### 1. 声明面：`src/user-side/adapters/<id>/index.mjs`

```js
export const id = 'qq';                       // 地址前缀，也是 sessions.json 的 key 前缀
export const label = 'QQ';                    // 控制台与日志里的称呼
export const conversationTypes = ['group', 'private'];
export const capabilities = ['group', 'direct', 'mention', 'reply', 'recall', 'poke',
  'image', 'voice', 'sticker', 'file', 'forward', 'member-list', 'member-info'];
export const limits = { chunkChars: 4000, markdown: false };

export const actions = ['message.send', 'poke.send', 'history.get', /* … */];  // 敢接的中立动作
export async function actionHandler({ name, params }) {}  // 一个入口收全部动作，内部才碰 bot.raw / 私有动作
export function buildSendCall(kind, id, message) {}       // → { action, params }（报文拆分用，可选）
export async function send({ address, segments, opts }) {} // 真正发出去：中立段 → 本平台报文 → 网络
export async function connect({ signal, onEvent, onStatus }) {} // 收：本平台报文 → 统一事件（可选，见第 4 步）
export function describeBackend(opts) {}                   // 日志里的「经 X 后端」称呼
export async function probeBackend() {}                    // 问后端身份 → { name, version } | null
```

- `capabilities` 是**能力声明**而不是能力检查：内核按它决定降级（缺 `sticker` 发文字占位）还是报错（缺 `poke`）。
- `actions` 是**动作声明**：词表在 `src/user-side/actions.mjs`（13 项，`CAPABILITY_CONTRACT.md` §3.2），
  平台只列自己敢接的。没列的动作内核不会调到这里 —— 能降级的按词表降级（`message.reply` → `message.send`），
  降不了的抛 `capability_unsupported`。新增平台**不必**实现全部 13 项，正向同步、缺项降级才是常态。
- `limits` 参与分条与格式转换，缺省时内核用默认值。
- `send` 是唯一发送出口，收到的是**已校验、已降级的中立段**（`{ type, data }`），不是原始文本。本平台的
  动作名、参数形状、HTTP/鉴权都只该出现在适配器目录里（QQ 的实现见 `adapters/qq/transport.mjs`）。
- `actionHandler` 内部可以直接用平台私有动作（QQ 的 `set_group_poke`、`fetch_custom_face_detail` 等）：
  这正是它存在的理由。**适配器之外**出现 `bot.raw` / `bot.request` 会被门禁拦下（§三 第 8 条）。
- `buildSendCall` 仍保留：报文是数据时（例如需要把「动作 + 参数」交给外部网关）用它，不要两边各写一份三元式。
- `probeBackend` 是异步的（它要发 `get_version_info`）：「是不是 NapCat」这类判定不要缓存到适配器模块级变量，
  交给 `connection.mjs` 随连接失效（换网关后判断会变）。

### 2. 装配：`src/user-side/builtin.mjs`

```js
import * as qq from './adapters/qq/index.mjs';
export const BUILTIN_USER_PLATFORMS = Object.freeze([qq]);
```

这是**唯一**允许写具体平台名的地方。注册进 `runtime-registry.mjs` 后，`useUserPlatform('<id>')` 即可切换当前平台（多平台在线时按会话地址带 `ctx.platform`）。

### 3. 内核侧：不用改

`bridge.js` / `self-test.js` / `launcher` 只经 `src/user-side/user-platform.mjs` 门面调用
（出站 `buildSendCall` / `sendAction` / `previewSegments`，动作 `callAction` / `supportsAction`，
后端 `probeBackend` / `describeBackend`，能力 `supportsUserCapability` / `userPlatformLimits`，
以及入站的 `startUserPlatformInbound` / `configureUserPlatformInbound`）。
门面导出的是**转发函数**而不是常量绑定，所以运行期切平台能立刻生效。

后端配置（地址、token、fetch）也在这里注入：`configureUserPlatformBackend(provider)` 只传
「怎么取配置」的函数，适配器每次发送现取，config 热改后不必重启。入站对称：
`configureUserPlatformInbound(provider)` 交出「怎么拿到底层连接对象」（QQ 是那个 WS 客户端）。

### 4. 收得到：`connect`（C3，可选）

只实现 `send` 的平台合法存在，但会被标成「只出不进」（统一注册表报 `inbound_unsupported`，warn）。
要能收，就在同一个 `index.mjs` 导出 `connect`：

```js
// 只做「本平台报文 → 统一事件」这一件事。
export async function connect({ signal, onEvent, onStatus }) {
  const conn = getTransport();                 // 来自 configureUserPlatformInbound 的注入
  const off = conn.onRawEvent((raw) => {
    if (isSelf(raw)) return;                   // 剔掉自己发的
    void onEvent(toUnifiedEvent(raw));         // 不 await：SDK 回调不能被业务阻塞
  });
  signal?.addEventListener?.('abort', () => off(), { once: true });
  return { close: async () => off() };
}
```

调用方是 `bridge.js`，它把 `onEvent` 接到 `createInboundPipeline` 的 `emit` 上。进到 `onEvent` 之后的事
（校验 → 准入 → 会话映射 → 唤醒）**全在内核**，适配器既不判断准入也不拼会话 key（§三 第 7 条）。
QQ 的完整实现见 `src/user-side/adapters/qq/inbound.mjs`，机制说明见 §五。

## 三、必须守住的不变式

1. **内核不认识具体平台名**：`src/` 根与 `src/lib/` 不得新增 `qq` / `wx` / `bili` 等命名的模块；
   平台专属实现只能出现在 `src/user-side/adapters/<id>/`（`verify:repo` + `test-platform-adapters` 双向钉）。
2. **主程序不直连 `adapters/`**：`bridge.js` / `self-test.js` 只 import 门面。唯一例外是
   `bridge-extensions.js` 对 `qq-backend-label.js` 的直连（0.1.x 公开导出名 + 文件名契约，见 §2.5）。
3. **地址里的平台名不写死**：`key.mjs` 接受开放 type 与 `@account`，新平台直接用自己的 id 作为前缀即可。
4. **测试夹具的注入表跟着改名走**：夹具剥掉 `bridge.js` 的 import 后靠**同名**注入提供绑定；
   门面改名而夹具不同步，bridge 会悄悄落到真实现上（B5 踩过一次：`resolveAgentBaseUrl` 真实现扫本机
   进程找 DSH，单次启动多花约 0.8 秒，把 `test-backfill` 的 2 秒容差断言顶成随机失败）。
5. **外部契约不动**：`src/snowluma-conn.js` 被仓库外独立工具按固定路径引用，
   `src/user-side/adapters/qq/qq-backend-label.js` 的文件名被测试钉住 —— 两者都不得移动或改名。
6. **控制台自动跟随（B7，C1 起单一数据源）**：声明面写全 `label` / `conversationTypes` / `capabilities` / `limits`，
   新平台就会出现在 `GET /api/platforms/registry` 里（用户侧与 Agent 侧同源），控制台的平台下拉、类型筛选、
   标签与上限全从这条响应读，唯一调用点是 `public/console/js/registry.js` —— **不要为此改前端代码**，
   更不要在 `public/console/` 里写新平台名。声明面字段名不变。
7. **入站只翻译，不判准入（C3）**：`connect` 交出去的事件必须是**已校验形状**的统一事件，但**不要**在适配器里
   判断“这条会话能不能回”、也不要自己拼会话 key。原因：准入的真相在内核（白名单 / 管理通道 / 当前模式），
   适配器判一次就会与内核分叉；而会话 key 的拼法一旦被适配器复写，插件就能把事件投到任意会话上。
   同理：把整条消息判成 INVALID 是最坏的降级方式（一个陌生段就能让一句话消失），未知段一律降成占位文本。
8. **平台私有动作不出适配器（C4）**：`bot.raw` / `bot.request` / `bot.send*` 只允许出现在 `src/user-side/adapters/`，
   内核经 `callAction(name, params)` 说中立词。门禁是 `verify:repo` 对 `src/**/*.{mjs,js}` 排除适配器目录后的
   正则扫描，所以「绕过办法」不是加白名单，而是先把这件事变成词表里的一个动作。

## 四、自检

```powershell
npm run verify:repo        # 目录不变式、语法、门面导出（含 §7.2 静态验收）
npm run test:audit         # 含 test-platform-adapters / test-transport-plugin 等契约
node scripts/test-platform-metadata.mjs  # 声明面字段（label/会话类型/limits）改动后
node scripts/test-unified-segments.mjs   # 段类型或降级表改动后
node scripts/test-transport-plugin.mjs   # 出站报文/transport 路由改动后
node scripts/test-qq-inbound.mjs         # 入站报文翻译/connect 改动后（QQ 参考实现）
node scripts/test-unified-inbound.mjs    # 入站管线四步顺序/丢弃原因改动后
node scripts/test-prompt-layers.mjs      # 平台话术（prompt.mjs）改动后
node scripts/test-onebot-send-call.mjs   # 发送调用构造改动后
node scripts/test-user-actions.mjs       # 动作词表 / actionHandler 回调改动后
```

## 五、入站：已接通（PLATFORM_UNIFICATION C3）

出站：插件可以用 `transport:provide` 自带连接器注册为一个 transport，出站经内核 `sendAction`
（顺序是 `onOutbound` 改中立段 → 降级 → `transport.send`）。

入站：`transport` 契约里的 `connect({ signal, onEvent, onStatus })` 就是这条路。插件与内置平台走**同一条**
管线 `createInboundPipeline`（`src/user-side/inbound.mjs`）：

```
raw event → validateUnifiedEvent(raw, origin) → 准入 → 会话映射 → 唤醒
```

**顺序不可换**：校验必须在准入之前，否则插件（或任何一个适配器）能看到未准入会话的正文。四步里
只有第一步（报文 → 统一事件）在适配器，后三步全在 `bridge.js`。

- 管道 `emit` **永不抛错**：任何异常都变成 `{ ok: false, reason }` 交给 `onDrop`（内置原因码 `INBOUND_DROP` 四个：
  `invalid` / `not_admitted` / `conversation_unresolved` / `deliver_failed`；`deliver` 也可以自己返回 `reason`）。
- **一条实例一条管线**：`platforms.users` 里每条启用的条目都会单独装配，`origin` 是那条条目的
  `{ platform, account }` —— 会话 key 与准入白名单都按它算，多实例并存也不会串号。
- **正文只说一遍**：统一事件 `message.text` 由校验阶段从段里拼出，`ext.raw` 只是适配器侧的排障入口，
  内核业务体一处不读（门禁 `verify:adaptation` 断言这个目录之外零读取）。
- 未实现 `connect` 的平台仍合法：统一注册表把它标成 `inbound: false` 并报 `inbound_unsupported`（warn），
  不再静默地“看起来能用”。QQ 在 C3 之后不再触发该诊断。
- 启动与退出：`startUserPlatformInbound(...)` 返回 `{ close }`，`bridge.js` 逐条收集并在 `shutdownThenExit`
  里先摘订阅。适配器内部守卫了重复 `connect`，同一条实例不会装两条订阅。

QQ 的参考实现：`src/user-side/adapters/qq/inbound.mjs`（报文 → 统一事件、剔自己发的消息、
`onMessage` 优先于旧 SDK 的分类型订阅、未知段降级）；回归 `scripts/test-qq-inbound.mjs`（14 条）与
`scripts/test-unified-inbound.mjs`（13 条）、`scripts/test-user-instances.mjs`（10 条），
端到端见 `test-transport-plugin.mjs` 的 mock 平台用例。
