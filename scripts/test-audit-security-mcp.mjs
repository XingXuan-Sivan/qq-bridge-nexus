// Exercise MCP callbacks with a fake transport: no network, config or stdio server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import { z } from 'zod';
// mcp-snowluma-safe.js 会剥掉 import：它现在自己 configureKeys，这两个符号得注入 VM。
import { configureKeys, key as skillKey, platformOfConfig } from '../src/session/key.mjs';
import { accessState, normalizeAccessConfig } from '../src/session/access.mjs';
// 配置 v2 的派生视图同样是剥掉 import 后的外部依赖；它是纯函数（入参是解析后的配置对象，
// 不读盘），所以直接注入真模块即可，夹具配置照样能算出扁平视图。
import { configViews } from '../src/config/platforms.mjs';
// 工具面由目录推导：8 组 + 组内 op。vm 里剥掉了 import，这几个纯函数要注入。
import { PLATFORM_TOOLS, TOOL_GROUPS, catalogEntry, describeToolGroups, toolGroup } from '../src/tools/catalog.mjs';

function loadWebTools({ safeFetch, webSearch }) {
  const tools = new Map();
  const source = fs.readFileSync(new URL('../src/mcp-web-search-safe.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('await server.connect(new StdioServerTransport());', 'server.connect(new StdioServerTransport());');
  class McpServer {
    tool(name, description, schema, callback) { tools.set(name, { schema, callback }); }
    connect() {}
  }
  vm.runInNewContext(source, {
    safeFetch,
    webSearch,
    McpServer,
    StdioServerTransport: class {},
    z,
    URL,
    path,
    process,
  });
  return async (name, arguments_) => {
    const tool = tools.get(name);
    return tool.callback(z.object(tool.schema).parse(arguments_));
  };
}

test('MCP search sanitizes the query and delegates to the shared web-search module', async () => {
  const calls = [];
  const callTool = loadWebTools({
    safeFetch: async () => { assert.fail('web_search 不应绕开 webSearch() 直接抓 Bing'); },
    webSearch: async (query, options) => {
      calls.push({ query, options });
      return { query, provider: 'deepseek', results: [{ title: 'Fixture title', url: 'https://example.com/', snippet: 'Fixture summary' }] };
    }
  });
  const result = await callTool('web_search', { query: '  fixture [CQ:at,qq=1]\n phrase  ' });
  const parsed = JSON.parse(result.content[0].text);
  assert.equal(parsed.query, 'fixture phrase');
  assert.equal(parsed.provider, 'deepseek');
  assert.equal(parsed.results[0].title, 'Fixture title');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, 'fixture phrase', '查询词必须先清洗再交给搜索模块');
  assert.ok(calls[0].options?.root, '必须把项目根目录传给搜索模块（用于读 config.json）');
});

test('MCP fetch uses shared transport and exposes rejection as a tool error', async () => {
  const callTool = loadWebTools({
    safeFetch: async () => { throw new Error('fixture: internal redirect rejected'); },
    webSearch: async () => { throw new Error('fixture: internal redirect rejected'); },
  });
  for (const [name, args] of [['web_fetch', { url: 'http://example.com' }], ['web_search', { query: 'fixture' }]]) {
    const result = await callTool(name, args);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /internal redirect rejected/);
  }
});

test('empty searches are rejected without calling the transport', async () => {
  const callTool = loadWebTools({
    safeFetch: async () => { assert.fail('Unexpected transport call'); },
    webSearch: async () => { assert.fail('Unexpected search call'); },
  });
  const result = await callTool('web_search', { query: '[CQ:at,qq=1]\n ' });
  assert.equal(result.isError, true);
});

/**
 * 用假 transport 加载 mcp-snowluma-safe.js，拿到它的工具回调。
 * 只需要把 fetch（桥接 API / OneBot HTTP）、http（长轮询）、McpServer、zod、两个本地纯模块塞进上下文。
 */
function loadSnowlumaTools(fetchImpl, fixtureConfig = null, httpImpl = null) {
  const tools = new Map();
  // vm 里没有 ESM 的 import.meta，把模块顶部的 __dirname 推导整段替换成固定值。
  const source = fs.readFileSync(new URL('../src/mcp-snowluma-safe.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace("const __dirname = path.dirname(fileURLToPath(import.meta.url));", "const __dirname = '/fixture/src';")
    .replace('await server.connect(new StdioServerTransport());', 'server.connect(new StdioServerTransport());');
  class McpServer {
    constructor() {
      this.tool = () => {};
      this.registerTool = (name, config, callback) => tools.set(name, { schema: config.inputSchema, callback });
    }
    connect() {}
  }
  const fixtureFs = fixtureConfig === null ? fs : {
    ...fs,
    readFileSync(file, ...args) {
      if (path.basename(String(file)) === 'config.json' && String(file).includes('fixture')) {
        return JSON.stringify(fixtureConfig);
      }
      return fs.readFileSync(file, ...args);
    },
  };
  vm.runInNewContext(source, {
    McpServer,
    StdioServerTransport: class {},
    z,
    URL,
    URLSearchParams,
    fetch: fetchImpl,
    AbortSignal,
    http: httpImpl ?? { request: () => { throw new Error('test did not inject http'); } },
    process,
    setTimeout,
    clearTimeout,
    console,
    Buffer,
    path,
    fs: fixtureFs,
    SENSITIVE_RE: { test: () => false },
    serializeModelData: (value) => JSON.stringify(value),
    // 真实模块从平台声明推导注册面；vm 里剥掉了 import，用夹具的工具表代替。
    platformFlags: () => (fixtureConfig?.tools ?? {}),
    // 工具面住在平台声明（profiles/platforms/<id>/tools.yml）：vm 里用目录里的 QQ 声明代替读盘。
    readPlatformTools: () => PLATFORM_TOOLS.map((tool) => ({ flag: tool.flag, names: tool.names })),
    PLATFORMS_ROOT: '/fixture/profiles/platforms',
    // 注册面由目录推导（8 组）；这些是纯函数，直接把真实现注入。
    TOOL_GROUPS,
    toolGroup,
    catalogEntry,
    describeToolGroups,
    // 会话 key 与准入：模块加载期就会跑 configureKeys，白名单判定用同一个 key 构造出口。
    configureKeys,
    platformOfConfig,
    skillKey,
    accessState,
    normalizeAccessConfig,
    configViews,
  });
  return async (name, arguments_ = {}) => {
    const tool = tools.get(name);
    assert.ok(tool, `tool ${name} should be registered`);
    return tool.callback(await tool.schema.parseAsync(arguments_));
  };
}

// 回归（issue #24）：`qq_wait_for_messages` 以前走全局 fetch（undici 自带 300s headersTimeout），
// 而沉睡前观察的预算就是 300s —— 第 301 秒必然 `fetch failed`，桥接侧却还在跑满预算占着
// activeWaits，AI 只能重试烧 token。现在必须走 node:http 长轮询（没有默认响应超时）。
test('wait uses the node:http long-poll channel, not fetch', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  let requested = null;
  const fakeHttp = {
    request(options, callback) {
      requested = options;
      const req = new EventEmitter();
      req.destroy = () => {};
      req.end = (body) => {
        requested.body = body;
        queueMicrotask(() => {
          const res = new PassThrough();
          res.statusCode = 200;
          res.complete = false;
          callback(res);
          res.end(JSON.stringify({ ok: true, newMessages: [], readThroughSeq: 7 }));
        });
      };
      return req;
    }
  };
  const callTool = loadSnowlumaTools(
    async () => { assert.fail('wait 不得再走 fetch（会被 undici 的 300s headersTimeout 掐断）'); },
    null,
    fakeHttp
  );
  const result = await callTool('read_messages', { op: 'wait_for_messages', key: 'group:1', token: 'fixture-token', timeoutMs: 300000, quietMs: 10000 });
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  assert.ok(requested, '必须真的发起 http.request');
  assert.equal(requested.path, '/api/socialV2/wait');
  assert.equal(requested.method, 'POST');
  assert.equal(requested.hostname, '127.0.0.1');
  assert.ok(Number(requested.port) > 0, '必须打到控制台端口');
  assert.match(String(requested.body), /"timeoutMs":300000/);
  assert.equal(JSON.parse(result.content[0].text).readThroughSeq, 7, '长轮询响应必须原样返回给模型');
});

// 回归：桥接个别分支会把 error 回成**对象**。直接 `new Error(obj)` 会变成
// "[object Object]"（r3 的已知未修项里就有一条线上记录：qq_wait_for_messages 报
// `error: "\"Error: [object Object]\""`）。必须序列化成可读文本。
test('object-shaped bridge errors are rendered readably, not as [object Object]', async () => {
  const callTool = loadSnowlumaTools(async () => Response.json(
    { ok: false, error: { code: 'send/rejected', message: '消息含敏感信息，已阻止发送' } },
    { status: 200 },
  ));
  const result = await callTool('send', { op: 'send_group_message', groupId: '456', message: 'fixture' });
  assert.equal(result.isError, true);
  const text = String(result.content[0].text);
  assert.ok(!/\[object Object\]/.test(text), `错误文本不得是不可读的对象：${text}`);
  assert.match(text, /send\/rejected|阻止发送/, `应带出对象里的原因：${text}`);
});

// 回归：桥接用 200 + {ok:false} 表达业务失败（例如发送被安全审计拦截）。
// agentApi 若不检查 body.ok，就会把「被拦截」当成「发送成功」报给模型 ——
// 模型据此认为消息已发出，既不再重试也不告诉用户，是典型的静默错误。
test('a bridge 200 with ok:false is reported to the model as a failure', async () => {
  const callTool = loadSnowlumaTools(async () => Response.json(
    { ok: false, error: '消息含敏感信息，已阻止发送' },
    { status: 200 },
  ));
  const result = await callTool('send', { op: 'send_group_message', groupId: '456', message: 'fixture' });
  assert.equal(result.isError, true, 'ok:false 必须作为工具错误返回');
  assert.match(result.content[0].text, /阻止发送/);
});

// 回归：旧的无令牌只读工具（qq_list_groups / qq_get_group_members / qq_get_group_history）已下线。
// 群名与成员名单只能经带会话令牌的桥接接口读，准入与可见范围由桥接一侧判定。
// 这条断言防的是「顺手把旧工具加回来」：它们没有令牌，会把白名单群名与群成员名单
// 直接注入模型上下文。
test('legacy token-less group read tools are not registered', async () => {
  const callTool = loadSnowlumaTools(async () => Response.json({ status: 'ok', retcode: 0, data: [] }));
  for (const name of ['qq_list_groups', 'qq_get_group_members', 'qq_get_group_history']) {
    await assert.rejects(callTool(name, {}), /should be registered/, `${name} 不应再注册`);
  }
});

// 工具面是目录的 8 组：宿主名（qq_*）不再作为工具出现，组内动作走 op。
test('tools/list exposes the eight catalogue groups only', async () => {
  const callTool = loadSnowlumaTools(async () => Response.json({ status: 'ok', retcode: 0, data: [] }));
  for (const name of ['read_messages', 'get_member', 'send', 'act', 'conversation_state', 'memory', 'slang', 'admin']) {
    const error = await callTool(name, { op: 'no_such_op' }).then(() => null, (cause) => cause);
    assert.ok(error, `${name} 应已注册`);
    assert.doesNotMatch(String(error.message ?? error), /should be registered/, `${name} 应已注册`);
  }
  for (const name of ['qq_status', 'qq_get_unread_messages', 'qq_send_message', 'qq_mark_read']) {
    await assert.rejects(callTool(name, {}), /should be registered/, `${name} 不应再作为工具注册`);
  }
});
