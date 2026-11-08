import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionHub, HubError } from '../src/extensions/hub.mjs';
import { normalizePresetPolicy } from '../src/extensions/preset-policy.mjs';

const policyOpen = normalizePresetPolicy({
  extensions: { mcp: { allow: ['*'], tools: { allow: ['*'] } }, skills: { allow: ['*'] } },
});
const policyEchoOnly = normalizePresetPolicy({
  extensions: { mcp: { allow: ['demo'], tools: { allow: ['echo'], deny: [] } }, skills: { allow: [] } },
});

function setup() {
  const catalog = {
    async snapshot() {
      return { skills: [{ id: 'demo-skill', name: '演示技能', description: '' }] };
    },
  };
  const calls = [];
  const runtime = {
    list: () => [{
      id: 'demo',
      name: '演示 MCP',
      description: '演示用',
      transport: 'stdio',
      enabled: true,
      status: 'running',
      error: null,
      tools: [
        { name: 'echo', description: '回显' },
        { name: 'danger', description: '危险' },
      ],
    }],
    listTools: async () => [],
    call: async (id, tool, args) => {
      calls.push({ id, tool, args });
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  };
  const hub = createExtensionHub({
    catalog,
    runtime,
    policyFor: (preset) => (preset === 'open' ? policyOpen : policyEchoOnly),
  });
  return { hub, calls };
}

test('Hub：list 按 preset 过滤 server/tool，skills 也受策略约束', async () => {
  const { hub } = setup();
  const open = await hub.list({ preset: 'open' });
  assert.equal(open.summary.servers, 1);
  assert.equal(open.summary.tools, 2);
  assert.equal(open.summary.skills, 1);

  const limited = await hub.list({ preset: 'limited' });
  assert.equal(limited.mcp[0].id, 'demo');
  assert.deepEqual(limited.mcp[0].tools.map((tool) => tool.name), ['echo']);
  assert.equal(limited.summary.tools, 1);
  assert.equal(limited.skills.length, 0);
});

test('Hub：describe 返回 schema，deny 工具不可见也不可调用', async () => {
  const { hub, calls } = setup();
  const described = await hub.describe({ preset: 'limited', server: 'demo', tool: 'echo' });
  assert.equal(described.tool.name, 'echo');
  await assert.rejects(() => hub.describe({ preset: 'limited', server: 'demo', tool: 'danger' }), HubError);

  const result = await hub.call({ preset: 'limited', server: 'demo', tool: 'echo', args: { text: 'hi' } });
  assert.equal(result.content[0].text, 'ok');
  assert.deepEqual(calls, [{ id: 'demo', tool: 'echo', args: { text: 'hi' } }]);
  await assert.rejects(() => hub.call({ preset: 'limited', server: 'demo', tool: 'danger' }), /不允许工具/);
  await assert.rejects(() => hub.call({ preset: 'limited', server: 'missing', tool: 'echo' }), /不允许|不存在/);
});
