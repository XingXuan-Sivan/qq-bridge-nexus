import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPresetPolicy, mcpServerAllowed, mcpToolAllowed, skillAllowed, normalizePresetPolicy } from '../src/extensions/preset-policy.mjs';
import { createCapabilityStore } from '../src/capabilities/store.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qqbridge-preset-'));
}

// C4 起策略住在能力档的 extensions 段：一个 id 一份 <id>.yml。
function writeCapability(root, id, yaml) {
  fs.writeFileSync(path.join(root, `${id}.yml`), yaml, 'utf8');
}

test('预设策略：缺省拒绝、allow/deny 优先级、通配符', () => {
  const root = tempRoot();
  writeCapability(root, 'open', `extensions:\n  mcp:\n    allow: ['*']\n    tools:\n      allow: ['*']\n      deny: ['bad__*']\n  skills:\n    allow: ['demo']\n`);
  writeCapability(root, 'closed', `extensions:\n  mcp:\n    allow: []\n`);
  writeCapability(root, 'invalid', `extensions: [not-an-object]\n`);
  const capabilities = createCapabilityStore({ root });
  const policy = createPresetPolicy({ capabilities });
  const open = policy.get('open');
  assert.equal(mcpServerAllowed(open, 'anything'), true);
  assert.equal(mcpToolAllowed(open, 'demo', 'echo'), true);
  assert.equal(mcpToolAllowed(open, 'bad', 'danger'), false);
  assert.equal(skillAllowed(open, 'demo'), true);
  assert.equal(skillAllowed(open, 'other'), false);
  assert.equal(mcpServerAllowed(policy.get('closed'), 'demo'), false);
  assert.equal(mcpServerAllowed(policy.get('invalid'), 'demo'), false);
  // 非法 id 不抛错，一律按「全部拒绝」处理（守卫路径不能因为一个坏名字整条挂掉）。
  assert.deepEqual(policy.get('../bad'), { mcp: { allow: [], tools: { allow: [], deny: [] } }, skills: { allow: [] } });
  // 不存在的预设同样拒绝。
  assert.equal(mcpServerAllowed(policy.get('nope'), 'demo'), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('预设策略：改 extensions 段后立即生效（mtime 缓存会失效）', () => {
  const root = tempRoot();
  writeCapability(root, 'open', 'extensions:\n  mcp:\n    allow: [demo]\n');
  const policy = createPresetPolicy({ capabilities: createCapabilityStore({ root }) });
  assert.equal(mcpServerAllowed(policy.get('open'), 'demo'), true);
  assert.equal(mcpServerAllowed(policy.get('open'), 'other'), false);
  writeCapability(root, 'open', 'extensions:\n  mcp:\n    allow: [other]\n');
  assert.equal(mcpServerAllowed(policy.get('open'), 'other'), true, '改完 extensions 必须重新读到');
  fs.rmSync(root, { recursive: true, force: true });
});

test('预设策略：normalize 校验数组与上限', () => {
  const normalized = normalizePresetPolicy({
    extensions: {
      mcp: { allow: ['a', 'a', 'b'], tools: { allow: ['*'], deny: ['x'] } },
      skills: { allow: ['s'] },
    },
  });
  assert.deepEqual(normalized.mcp.allow, ['a', 'b']);
  assert.deepEqual(normalized.mcp.tools.deny, ['x']);
  assert.throws(() => normalizePresetPolicy({ extensions: { mcp: { allow: 'x' } } }), /数组/);
});
