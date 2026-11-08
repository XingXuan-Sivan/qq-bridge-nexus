import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPresetPolicy, mcpServerAllowed, mcpToolAllowed, skillAllowed, normalizePresetPolicy } from '../src/extensions/preset-policy.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qqbridge-preset-'));
}

function writePreset(root, id, yaml) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'extensions.yml'), yaml, 'utf8');
}

test('预设策略：缺省拒绝、allow/deny 优先级、通配符', () => {
  const root = tempRoot();
  writePreset(root, 'open', `extensions:\n  mcp:\n    allow: ['*']\n    tools:\n      allow: ['*']\n      deny: ['bad__*']\n  skills:\n    allow: ['demo']\n`);
  writePreset(root, 'closed', `name: closed\n`);
  writePreset(root, 'invalid', `extensions: [not-an-object]\n`);
  const policy = createPresetPolicy({ root });
  const open = policy.get('open');
  assert.equal(mcpServerAllowed(open, 'anything'), true);
  assert.equal(mcpToolAllowed(open, 'demo', 'echo'), true);
  assert.equal(mcpToolAllowed(open, 'bad', 'danger'), false);
  assert.equal(skillAllowed(open, 'demo'), true);
  assert.equal(skillAllowed(open, 'other'), false);
  assert.equal(mcpServerAllowed(policy.get('closed'), 'demo'), false);
  assert.equal(mcpServerAllowed(policy.get('invalid'), 'demo'), false);
  assert.throws(() => policy.get('../bad'), /不合法/);
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
