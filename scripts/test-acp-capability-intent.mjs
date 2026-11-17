// 第二消费者（T-067）：同一份能力档意图，两个执行体各自编译成自己的形状。
//
//   DSH —— effects + runtime → cordis 插件行（adapters/render.mjs，产物落 artifacts/）
//   ACP —— runtime → session/new 报文（adapters/acp/port.mjs：systemPrompt / cwd / mcpServers）
//
// 这里断言的是「换执行体不用重写意图」：
//   1. 能力档只写意图，不含任何平台的插件名、行结构或预设元信息；
//   2. 「装不装」由 runtime.apply 决定，而不是由某个平台的渲染细节决定；
//   3. 两个执行体对同一份意图的认领差异（通道、权限档）是**可计算**的，
//      不认的那一项会显式降级或拒绝，不静默失真。
//
// 不连 DSH、不起 ACP 子进程：两个消费者都是可单测的纯函数。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { appliesPreset, createCapabilityStore } from '../src/capabilities/store.mjs';
import { renderPresetRows } from '../profiles/agent-platforms/dsh/adapters/render.mjs';
import { sessionNewPayload } from '../src/agent-side/adapters/acp/port.mjs';
import { agentPlatformApplies, agentPlatformPeerPermissions, agentPlatformPromptChannels } from '../src/agent-side/runtime-registry.mjs';
import { AGENT_PLATFORMS_ROOT, SHARED_CAPABILITIES_DIR } from '../src/profiles/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DSH_DIR = path.join(AGENT_PLATFORMS_ROOT, 'dsh');
const PRESETS_DIR = path.join(ROOT, 'artifacts', 'dsh', 'qq-agent-presets', 'presets');

// 执行体注册表要先装好内置执行体，agentPlatform* 才有声明面可读。
await import('../src/agent-side/builtin.mjs');

const dshCaps = createCapabilityStore({ root: path.join(DSH_DIR, 'capabilities') });
const sharedCaps = createCapabilityStore({ root: SHARED_CAPABILITIES_DIR });
/** 跨平台共用档：任何 Agent 平台都能选，所以它是「同一份意图」最直接的样本。 */
const direct = sharedCaps.get('direct');
const dshRender = YAML.parse(fs.readFileSync(path.join(DSH_DIR, 'render.yml'), 'utf8'));

/** 能力档能出现的字段：多一个就说明又混进了执行体材质。 */
const INTENT_KEYS = new Set([
  'version', 'id', 'label', 'note', 'behavior', 'effects', 'runtime', 'audience', 'mcp', 'skills',
]);

/** 执行体材质：插件名、行结构、预设元信息都不该出现在能力档里（`mcp.tools` 是 Hub 授权形状，不在此列）。 */
const PLATFORM_MATERIAL = [/@deepseek-ai\//, /\bcordis\b/, /^\s*rows:/m, /^preset:/m];

function readCapabilityText(root, id) {
  return fs.readFileSync(path.join(root, `${id}.yml`), 'utf8');
}

test('能力档只写意图：字段白名单内，且不含任何执行体材质', () => {
  const samples = [
    ...dshCaps.list().map((capability) => ({ dir: path.join(DSH_DIR, 'capabilities'), id: capability.id })),
    { dir: SHARED_CAPABILITIES_DIR, id: direct.id },
  ];
  for (const { dir, id } of samples) {
    const text = readCapabilityText(dir, id);
    const raw = YAML.parse(text) ?? {};
    for (const key of Object.keys(raw)) {
      assert.ok(INTENT_KEYS.has(key), `${id} 出现执行体材质字段 ${key}`);
    }
    for (const material of PLATFORM_MATERIAL) {
      assert.ok(!material.test(text), `${id} 里出现了执行体材质：${material}`);
    }
  }
});

test('装不装由 runtime.apply 决定：预设式产出行，直通式一条都不产', () => {
  // 预设式：DSH 侧编译成 cordis 插件行，行序与产物一致。
  const presetCaps = dshCaps.list().filter((capability) => appliesPreset(capability));
  assert.ok(presetCaps.length > 0, 'DSH 的能力档至少有一个是预设式');
  const chatV2 = presetCaps.find((capability) => capability.id === 'chat-v2');
  const rendered = renderPresetRows(chatV2, dshRender);
  assert.deepEqual(rendered.degraded, [], '预设式意图在 DSH 上不应有任何装不出的效果');
  const artifact = YAML.parse(fs.readFileSync(path.join(PRESETS_DIR, 'chat-v2.patch.yml'), 'utf8'));
  assert.deepEqual(
    rendered.rows.map((row) => row.id),
    artifact[0].insert[0].config.plugins.map((row) => row.id),
    '渲染结果必须与产物里的行一一对应（同一个消费者的两条路径）',
  );

  // 直通式：不装预设、不产 patch。DSH 上没有 direct.patch.yml 不是漏产，是设计。
  assert.equal(appliesPreset(direct), false, '直通档不装预设');
  assert.equal(fs.existsSync(path.join(PRESETS_DIR, 'direct.patch.yml')), false, '直通档不应有产物');
});

test('同一份直通意图在 ACP 上装成 session/new 报文：系统话术进，工作区与 agent 不进', () => {
  // 生效方式是意图的一部分，执行体必须认领它（不认就该在 plan 校验时拒绝，而不是猜）。
  assert.ok(agentPlatformApplies('acp').includes(direct.runtime.apply), `ACP 应认领 ${direct.runtime.apply}`);
  assert.ok(agentPlatformPromptChannels('acp').includes(direct.runtime.prompt), `ACP 应认领 ${direct.runtime.prompt}`);

  const platformPrompt = '【QQ 场景规则】示例话术';
  const payload = sessionNewPayload({ cwd: 'C:/state/agents', systemPrompt: platformPrompt, workspaceId: 'ws-1' }, '');
  assert.deepEqual(payload, {
    cwd: 'C:/state/agents',
    mcpServers: [],
    systemPrompt: platformPrompt,
  });
  // 桥接给的中立入参有两项 ACP 没有落点：工作区在 ACP 里由 cwd 决定，
  // agent 名称走建会话后的 set_config_option，都不该混进 session/new。
  assert.equal('workspaceId' in payload, false);
  assert.equal('agentPreset' in payload, false);
  // 缺省目录由平台配置兜底，不能让报文里的 cwd 变成空串。
  assert.equal(sessionNewPayload({}, 'C:/state/fallback').cwd, 'C:/state/fallback');
});

test('两个执行体对同一份意图的认领差异是可计算的，且不静默', () => {
  const dshPrompts = agentPlatformPromptChannels('dsh');
  assert.ok(agentPlatformApplies('dsh').includes(direct.runtime.apply), 'DSH 也认领直通');
  // 直通档要求 system 通道：ACP 原生支持，DSH 没有 —— 这条差异必须来自声明面，
  // 不能靠两边各写一份「谁支持什么」的清单。DSH 上它会降级为首轮前置并记审计。
  assert.ok(!dshPrompts.includes(direct.runtime.prompt),
    `DSH 若新增了 ${direct.runtime.prompt} 通道，这条降级断言要跟着改（当前声明面：${dshPrompts.join(' / ')}）`);

  // 对端权限档同理：DSH 有静态取值域，ACP 的名单只能建会话后向对端要（空 = 不预设）。
  assert.ok(agentPlatformPeerPermissions('dsh').length > 0, 'DSH 的权限档是静态取值域');
  assert.deepEqual(
    agentPlatformPeerPermissions('acp'), [],
    'ACP 的模式名由对端定：空取值域 = 不预设，写入前按实时清单核对',
  );
});
