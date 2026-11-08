// 插件 configSchema：清单校验、默认值、类型/边界与旧插件兼容。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfigSchema, applyPluginConfig } from '../src/plugins/config-schema.mjs';
import { validateManifest } from '../src/plugins/manifest.mjs';

const schema = () => ({
  type: 'object',
  properties: {
    baseUrl: { type: 'string', default: 'http://127.0.0.1:3110' },
    timeoutMs: { type: 'integer', default: 900, minimum: 50, maximum: 5000 },
    view: { type: 'enum', enum: ['self', 'full'], default: 'self' },
    tags: { type: 'array', items: { type: 'string' } },
    enabled: { type: 'boolean', default: true },
  },
  additionalProperties: false,
});

const manifest = (extra = {}) => ({
  id: 'demo', name: '演示', version: '1.0.0', main: 'index.mjs', apiVersion: 1,
  permissions: [], hooks: [], description: '', ...extra,
});

test('normalizeConfigSchema 接受支持的子集，拒绝未知类型', () => {
  const ok = normalizeConfigSchema(schema());
  assert.equal(ok.ok, true);
  assert.equal(ok.schema.properties.timeoutMs.default, 900);
  assert.deepEqual(ok.schema.properties.view.enum, ['self', 'full']);
  assert.equal(ok.schema.additionalProperties, false);

  const bad = normalizeConfigSchema({ type: 'object', properties: { x: { type: 'object' } } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(), /不支持的 type/);
});

test('applyPluginConfig 填默认值、校验边界与枚举', () => {
  const normalized = normalizeConfigSchema(schema()).schema;
  const filled = applyPluginConfig(normalized, {});
  assert.equal(filled.ok, true);
  assert.deepEqual(filled.value, {
    baseUrl: 'http://127.0.0.1:3110', timeoutMs: 900, view: 'self', enabled: true,
  });

  const bad = applyPluginConfig(normalized, { timeoutMs: 10, view: 'nope', tags: ['ok', 1], extra: 1 });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('\n'), /不能小于 50/);
  assert.match(bad.errors.join('\n'), /只能是/);
  assert.match(bad.errors.join('\n'), /必须是字符串/);
  assert.match(bad.errors.join('\n'), /未声明的配置项/);
});

test('无 schema 的插件配置原样透传', () => {
  const result = applyPluginConfig(null, { any: { nested: true }, list: [1, 2] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { any: { nested: true }, list: [1, 2] });
});

test('manifest 校验 configSchema 并写入 manifest', () => {
  const ok = validateManifest(manifest({ configSchema: schema() }), 'demo');
  assert.equal(ok.ok, true);
  assert.equal(ok.manifest.configSchema.properties.timeoutMs.type, 'integer');

  const bad = validateManifest(manifest({ configSchema: { type: 'object', properties: { n: { type: 'null' } } } }), 'demo');
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(), /configSchema/);
});
