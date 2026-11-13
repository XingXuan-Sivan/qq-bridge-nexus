# 新增用户平台（微信 / B 站 / Telegram …）

> 对称于 Agent 侧（`profiles/agent-platforms/<id>/` + `src/agent-side/`）。本文描述 **0.2.0（平台解耦 B5）**
> 之后的实际做法；规格与取舍见 [PLATFORM_DECOUPLING.md](../PLATFORM_DECOUPLING.md) §2.5 / §3.2。

---

## 一、先分清两件事

| 层 | 回答的问题 | 落在哪 |
| --- | --- | --- |
| **传输**（怎么连上平台） | 用什么协议收发、鉴权、重连 | `src/user-side/adapters/<id>/`，插件侧入口在 B6 的 `transport:provide` |
| **业务**（连上之后拿它做什么） | 会话、准入、唤醒、人格、表情、语音… | 内核模块（`session/` `social/` `runtime/` …），**不需要为新平台改** |

新增平台只碰第一层。如果发现要改第二层，先确认是不是把「平台的实现细节」泄漏成了内核逻辑。

## 二、三步落地

### 1. 声明面：`src/user-side/adapters/<id>/index.mjs`

```js
export const id = 'qq';                       // 地址前缀，也是 sessions.json 的 key 前缀
export const label = 'QQ';                    // 控制台与日志里的称呼
export const conversationTypes = ['group', 'private'];
export const capabilities = ['group', 'direct', 'mention', 'reply', 'recall', 'poke',
  'image', 'voice', 'sticker', 'file', 'forward', 'member-list', 'member-info'];
export const limits = { chunkChars: 4000, markdown: false };

export function buildSendCall(kind, id, message) {}       // → { action, params }
export function describeBackend(opts) {}                   // 日志里的「经 X 后端」称呼
export function readBackendInfo(versionInfo) {}            // get_version_info → { name, version }
```

- `capabilities` 是**能力声明**而不是能力检查：内核按它决定降级（缺 `sticker` 发文字占位）还是报错（缺 `poke`）。
- `limits` 参与分条与格式转换，缺省时内核用默认值。
- `buildSendCall` 只返回 `{ action, params }`，**由桥接自己发 HTTP**：传输实现（SnowLuma / NapCat / 将来别的网关）可以换，动作名与参数形状不换。

### 2. 装配：`src/user-side/builtin.mjs`

```js
import * as qq from './adapters/qq/index.mjs';
export const BUILTIN_USER_PLATFORMS = Object.freeze([qq]);
```

这是**唯一**允许写具体平台名的地方。注册进 `runtime-registry.mjs` 后，`useUserPlatform('<id>')` 即可切换当前平台（多平台在线时按会话地址带 `ctx.platform`）。

### 3. 内核侧：不用改

`bridge.js` / `self-test.js` / `launcher` 只经 `src/user-side/user-platform.mjs` 门面调用
（`buildSendCall` / `describeBackend` / `readBackendInfo` / `supportsUserCapability` / `userPlatformLimits`）。
门面导出的是**转发函数**而不是常量绑定，所以运行期切平台能立刻生效。

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

## 四、自检

```powershell
npm run verify:repo        # 目录不变式、语法、门面导出（含 §7.2 静态验收）
npm run test:audit         # 含 test-platform-adapters 的 14 条平台契约
node scripts/test-prompt-layers.mjs      # 平台话术（prompt.mjs）改动后
node scripts/test-onebot-send-call.mjs   # 发送调用构造改动后
```

## 五、还没做的部分（B6）

「插件接管连接」（`transport:provide` + `onOutbound`）尚未实现。在那之前，新平台的入站消息仍由
`bridge.js` 里 QQ 的 WebSocket 分支投递；接入第二个平台**能发不能收**。
B6 落地后，插件可以自带连接器注册为一个 transport，入站事件须先过统一的
`validateUnifiedEvent` 与准入闸门（未准入会话拿不到正文）。
