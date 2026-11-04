// `src/upstream/snowluma-conn-update.mjs`：SnowLuma 连接参数自愈的决策表。
//
// 两条都是部署里真踩过的：
//   · HTTP token 与 WS token 是两个不同的值，只修一个会以 1006 反复重连；
//   · 「跟随发现到的端点」默认开，但可以关（多实例/指向另一份安装/经接口平台时）——
//     关了之后**只自愈 token，绝不动 URL、也绝不写回 config.json**，否则「我设了别处」
//     会被自愈持久化地抹掉。
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveConnectionUpdate } from '../src/upstream/snowluma-conn-update.mjs';

const base = {
  current: { wsToken: 'old-ws', wsUrl: 'ws://127.0.0.1:3001' },
  config: { accessToken: 'old-http', wsUrl: 'ws://127.0.0.1:3001' },
  discovered: { token: 'new-http', wsToken: 'new-ws', wsUrl: 'ws://127.0.0.1:3009', baseUrl: 'http://127.0.0.1:3008', source: 'onebot-file' },
};

test('默认跟随：两个 token 都换、端点用发现值、URL 可持久化', () => {
  const r = resolveConnectionUpdate(base);
  assert.equal(r.followEndpoint, true);
  assert.equal(r.httpToken, 'new-http');
  assert.equal(r.wsToken, 'new-ws');
  assert.equal(r.wsUrl, 'ws://127.0.0.1:3009');
  assert.equal(r.wsChanged, true);
  assert.equal(r.httpTokenChanged, true);
  assert.equal(r.persistUrl, true);
  assert.equal(r.endpointIgnored, false);
});

test('followDiscoveredEndpoint=false：只换 token，URL 保持配置值且不持久化', () => {
  const r = resolveConnectionUpdate({ ...base, followDiscoveredEndpoint: false });
  assert.equal(r.followEndpoint, false);
  assert.equal(r.wsUrl, 'ws://127.0.0.1:3001');
  assert.equal(r.persistUrl, false);
  assert.equal(r.endpointIgnored, true, '要能告诉用户「发现到的端点被忽略了」');
  // token 仍然要修——关掉端点跟随不等于放弃换账号自愈
  assert.equal(r.wsToken, 'new-ws');
  assert.equal(r.httpToken, 'new-http');
});

test('经接口平台（viaPlatform）：同样不跟随端点', () => {
  const r = resolveConnectionUpdate({ ...base, viaPlatform: true });
  assert.equal(r.followEndpoint, false);
  assert.equal(r.persistUrl, false);
  assert.equal(r.wsUrl, 'ws://127.0.0.1:3001');
});

test('发现值里没有 wsUrl：回落到配置值，仍可持久化（只是没变化）', () => {
  const r = resolveConnectionUpdate({
    ...base,
    discovered: { token: 'new-http', wsToken: 'new-ws', source: 'file' },
  });
  assert.equal(r.wsUrl, 'ws://127.0.0.1:3001');
  assert.equal(r.persistUrl, true);
  assert.equal(r.endpointIgnored, false);
});

test('wsToken 缺失时回落到 token（老版本 SnowLuma 只暴露一个值）', () => {
  const r = resolveConnectionUpdate({
    ...base,
    discovered: { token: 'only-one', wsUrl: 'ws://127.0.0.1:3009' },
  });
  assert.equal(r.wsToken, 'only-one');
  assert.equal(r.httpToken, 'only-one');
});

test('连接参数完全没变：wsChanged=false（不必重连）', () => {
  const r = resolveConnectionUpdate({
    current: { wsToken: 'same', wsUrl: 'ws://x' },
    config: { accessToken: 'same', wsUrl: 'ws://x' },
    discovered: { token: 'same', wsToken: 'same', wsUrl: 'ws://x' },
  });
  assert.equal(r.wsChanged, false);
  assert.equal(r.httpTokenChanged, false);
});

test('配置与当前都为空、也没发现端点：不产生写回（persistUrl=false）', () => {
  const r = resolveConnectionUpdate({
    current: { wsToken: undefined, wsUrl: undefined },
    config: {},
    discovered: { token: 't' },
  });
  assert.equal(r.wsUrl, '');
  assert.equal(r.persistUrl, false);
  assert.equal(r.wsChanged, true, '从「无 token」变成有 token，仍应触发一次重连');
});

test('endpointIgnored 只在「确实发现了不同端点」时为真（没发现就不打扰用户）', () => {
  const r = resolveConnectionUpdate({
    ...base,
    followDiscoveredEndpoint: false,
    discovered: { token: 'new-http', wsToken: 'new-ws', wsUrl: 'ws://127.0.0.1:3001' },
  });
  assert.equal(r.endpointIgnored, false);
});
