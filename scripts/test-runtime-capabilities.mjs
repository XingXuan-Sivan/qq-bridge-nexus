// 行为 kind 注册表与能力授予（grants）的单元测试。
import assert from 'node:assert/strict';
import { listKinds, getKind } from '../src/behaviors/kinds/index.mjs';
import { normalizeGrants, normalizeCapability, createCapabilityRegistry, GATEABLE_TOOLS } from '../src/runtime/capabilities.mjs';

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`ok ${pass + fail} - ${name}`);
  } catch (error) {
    fail += 1;
    console.error(`not ok ${pass + fail} - ${name}`);
    console.error(error?.stack || error);
  }
}

test('kind 注册表提供 v1/v2 的字段与嵌套默认值', () => {
  const kinds = listKinds();
  assert.deepEqual(kinds.map((k) => k.kind).sort(), ['v1', 'v2']);
  const v2 = getKind('v2');
  assert.ok(v2.fields.length > 20);
  assert.ok(v2.fields.some((field) => field.name === 'wake_defaultMode'));
  const entry = kinds.find((k) => k.kind === 'v2');
  assert.equal(entry.defaults.wake.defaultMode, '');
  assert.equal(entry.defaults.sticker?.enabled, false);
  assert.deepEqual(Object.keys(entry.defaults).sort().slice(0, 3), ['autoReplyCheckMs', 'context', 'feedback']);
  assert.equal(getKind('nope'), null);
});

test('grants 只保留可收紧工具里的名字', () => {
  const grants = normalizeGrants({ disable: ['sendMessage', 'nope', 'sendMessage', '  sendPoke  '] });
  assert.deepEqual(grants.disable, ['sendMessage', 'sendPoke']);
  assert.deepEqual(normalizeGrants(null), { disable: [] });
});

test('能力补丁归一化：未知沙箱回落到工作区读写', () => {
  assert.deepEqual(normalizeCapability({ id: 'qq-chat', sandbox: 'root', grants: { disable: ['sendVoice'] } }), {
    id: 'qq-chat',
    sandbox: 'workspace-write',
    grants: { disable: ['sendVoice'] },
    note: '',
  });
  assert.equal(normalizeCapability({}, ''), null);
});

test('注册表：列表合并目录、保存触发回调、grantsOf 反映禁用项', () => {
  let saved = null;
  const registry = createCapabilityRegistry({
    catalog: [{ id: 'qq-chat', label: '聊天' }, { id: 'qq-chat-v2', label: '二代' }],
    config: { 'qq-chat-v2': { sandbox: 'read-only', grants: { disable: ['schedule'] } } },
    onChange: (next) => { saved = next; },
  });
  const list = registry.list();
  assert.equal(list.length, 2);
  assert.equal(list.find((item) => item.id === 'qq-chat').label, '聊天');
  assert.equal(list.find((item) => item.id === 'qq-chat').sandbox, 'workspace-write');
  assert.equal(registry.grantsOf('qq-chat-v2', 'schedule'), false);
  assert.equal(registry.grantsOf('qq-chat-v2', 'sendMessage'), true);
  assert.equal(registry.grantsOf('qq-chat', 'schedule'), true);
  registry.save('qq-chat', { grants: { disable: ['sendVoice'] } });
  assert.deepEqual(saved['qq-chat'].grants.disable, ['sendVoice']);
  assert.throws(() => registry.save('missing', {}), /没有这个能力预设/);
});

test('可收紧工具都在 v2ToolEnabled 的读写面上（没有重复）', () => {
  const flags = GATEABLE_TOOLS.map((tool) => tool.flag);
  assert.equal(new Set(flags).size, flags.length);
  assert.ok(flags.includes('sendMessage'));
  assert.ok(flags.includes('schedule'));
});

console.log(`# pass ${pass}`);
console.log(`# fail ${fail}`);
if (fail) process.exitCode = 1;
