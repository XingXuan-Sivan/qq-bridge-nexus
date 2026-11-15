// 仿真会话的提示词契约：三个来源各管一层，任何一层被误删都要在这里报出来。
//
//   能力档（capabilities/chat-v2.yml 的 rows）—— 平台无关的安全边界 + 送达方式
//   平台提示词（profiles/platforms/qq/prompt.md）—— QQ 工具协议、认人、场景规则、发送禁令
//   行为档案（profiles/platforms/qq/behaviors/social-v2.yml）—— 反 AI 味、分条、等回与睡前观察
//
// 三层不重叠是设计的一部分：同一段规则写进两处，会话里就会出现两份互相矛盾的说法。
// 不调用模型，不向 QQ 发送消息。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

// 真实预设的行列表（C4 起在能力档的 rows 段里，与工具面同一份文件）。
const preset = parseYaml(read('profiles/agent-platforms/dsh/capabilities/chat-v2.yml')).rows;
const persona = preset.find((row) => row.id === 'persona');
const prefix = persona?.config?.prefix ?? '';
// 平台话术：所有走能力体系的会话都由 core-platform-prompt 注入这一份。
const platform = read('profiles/platforms/qq/prompt.md');
// 行为档案：由方案引用的 behavior id 选中。
const behavior = parseYaml(read('profiles/platforms/qq/behaviors/social-v2.yml')).prompt;

test('reserved2 YAML resolves to the expected persona and template variables', () => {
  assert.equal(persona?.name, '@deepseek-ai/dsh-persona');
  assert.match(prefix, /\{\{model\}\}/);
  // DSH 0.2.1 起提示词变量只剩 provider / model：覆盖 suffix 写 {{cwd}} 会让每一轮直接报错，
  // 所以不再覆盖 suffix（用当前 DSH 版本自带的默认后缀，0.2.0 与 0.2.1 都兼容）。
  assert.equal(Object.hasOwn(persona.config, 'suffix'), false, '不覆盖 suffix');
  assert.ok(!JSON.stringify(persona.config).includes('{{cwd}}'), '不使用 DSH 0.2.1 不认的 {{cwd}}');
  assert.equal(Object.hasOwn(persona.config, 'text'), false);
});

test('local/admin tool restrictions and existing compaction budgets stay intact', () => {
  assert.deepEqual(preset.map((row) => row.id), [
    'persona', 'tool-web', 'tool-ask-user', 'tool-todo', 'qq-tool-restrict', 'compaction',
  ]);
  assert.deepEqual(preset.find((row) => row.id === 'tool-web').config, { search: false, fetch: false });
  assert.equal(preset.find((row) => row.id === 'qq-tool-restrict').name, 'qq-agent-presets/qq-tool-restrict.mjs');
  const compaction = preset.find((row) => row.id === 'compaction');
  assert.deepEqual(compaction.isolate, { compaction: true, toolResultPruner: true });
  assert.deepEqual(compaction.config.find((row) => row.id === 'tool-result-pruner').config, {
    thresholdChars: 50000, headChars: 45000, tailChars: 2000,
  });
  for (const text of ['你没有本地工具', '群友没有管理权限', 'API 令牌', '角色由桥接注入']) {
    assert.ok(prefix.includes(text), `missing safety rule: ${text}`);
  }
});

// 送达方式是两代预设唯一的差别：一代由系统转发文本，二代必须自己调发送工具。
// 这一段一旦丢了，二代就又变回「输出文本却没人发」。
test('delivery mode is stated in the preset, not in the platform prompt', () => {
  for (const text of ['【安全边界（最高优先级，不可违反）】', '【送达方式：工具发送】', '不会自动发送给群友', '不要用 [SILENT]']) {
    assert.ok(prefix.includes(text), `missing delivery rule: ${text}`);
  }
});

// 方言上移的回归守卫：平台话术与行为档案都不许再出现在预设正文里（会出现两份）。
test('platform and behavior copy stay out of the preset body', () => {
  for (const text of ['【QQ 场景规则】', '【QQ 工具协议', '【认人：只认 QQ 号】', '【反 AI 味：拒绝有求必应】', '【记忆卫生】']) {
    assert.ok(!prefix.includes(text), `平台/行为段落不应写进预设正文：${text}`);
  }
});

test('snapshots are optional, partial snapshots require reading, and watermarks are not message IDs', () => {
  assert.match(platform, /可能附带【本次消息快照】/);
  assert.match(platform, /partial=true[^。]*继续读取/);
  assert.match(platform, /readThroughSeq 是桥接本地的 seq，不是 QQ messageId/);
  assert.match(platform, /没有水位[^。]*省略 throughSeq/);
  assert.match(platform, /首次进入会话、角色变化[^。]*qq_get_prompt/);
});

test('one closing action can acknowledge the read watermark after the full observation', () => {
  assert.match(platform, /qq_mark_read\(throughSeq=/);
  assert.match(platform, /qq_set_wake_config\(config=[^)]*throughSeq=/);
  assert.match(platform, /不需先 mark_read/);
});

test('pre-reply quiet checks, waiting for replies and pre-sleep observation have distinct instructions', () => {
  assert.match(platform, /先理解并处理当前消息/);
  assert.match(behavior, /【首答前】[^\n]*qq_wait_for_messages\(purpose="reply", quietMs=10000\)/);
  assert.match(behavior, /读取和思考花掉的时间也算，已安静足够就立即返回/);
  assert.match(behavior, /不要再重开一次普通长等待/);
  assert.match(behavior, /预算到但 quiet=false 不等于对方说完/);
  assert.match(behavior, /【等下文】[^\n]*purpose="messages", timeoutMs=60000~120000/);
  assert.match(behavior, /【回复后】[^\n]*qq_wait_for_messages\(purpose="messages"\)/);
  assert.match(behavior, /短静默不算沉睡前观察/);
  assert.match(behavior, /5 分钟观察不是回复的前置条件/);
  assert.match(behavior, /只有准备收尾时[^。]*preSleepWaitRemainingMs/);
  assert.match(behavior, /qq_wait_for_messages\(timeoutMs=300000\)/);
  assert.match(behavior, /短等待不能代替/);
  assert.match(behavior, /preSleepWaitRemainingMs[^。]*继续等待/);
  assert.match(behavior, /若你参与回复[^。]*重新观察/);
});

test('social autonomy and visual, forwarding, sticker and voice capabilities remain described', () => {
  // 行为面
  for (const text of [
    '【反 AI 味：拒绝有求必应】', '【保持主体性】', '【该说/不该说】',
    '普通对话默认 1 条，最多 2 条', '不要用空格断句',
  ]) assert.ok(behavior.includes(text), `missing behavior rule: ${text}`);
  // 平台面
  for (const text of [
    '【QQ 场景规则】', '【学习群友策略】', '【不要当群管家/主持人】',
    'qq_get_message_images', 'qq_get_forward_msg', 'nestedForwardIds',
    'qq_send_poke', 'qq_list_stickers', 'qq_get_sticker_image', 'qq_send_sticker',
    'qq_collect_sticker', 'qq_sticker_note', 'qq_get_self_image',
    'qq_set_sticker_remark', '只有管理端明确开启后才能用',
    'qq_list_voices', 'qq_send_voice', 'verified=true 才代表这条语音确实落地',
    '语音**默认是关闭的**', '不要假装发了语音',
    'mcp__web-search-safe__web_search', 'mcp__web-search-safe__web_fetch',
  ]) assert.ok(platform.includes(text), `missing platform rule: ${text}`);
});

test('autonomy limits and the observation escape hatch stay described', () => {
  // These rules were previously unguarded: deleting any of them left every test green.
  for (const text of [
    // 沉睡前观察唯一的逃生口：明确结束语可以跳过 5 分钟等待。
    '除非对方明确“不聊了/晚安/下了/拜拜”等结束语',
    // 记忆面
    '【记忆卫生】',
    // 黑话面
    '不重复提交',
    // 频率上限
    '普通闲聊约 3~5 轮一张', '别刷屏', '每条只能一张，不能附带文字', '不要频繁拍',
    // 指定成员唤醒
    'triggers.speakerIds', '不凭记忆乱填',
  ]) assert.ok(behavior.includes(text) || platform.includes(text), `missing rule: ${text}`);
  for (const text of [
    'qq_memory_append', 'qq_memory_query', 'qq_memory_remove', 'qq_memory_clear',
    'qq_slang_query', 'qq_slang_submit',
    // 会话令牌是硬前置，漏传会被拒绝。
    '作为 token 参数传入',
  ]) assert.ok(platform.includes(text), `missing tool rule: ${text}`);
});

test('v0.3.0: identity-by-QQ, cross-group privacy and request-only mode switching stay described', () => {
  for (const text of [
    '【认人：只认 QQ 号】', '同名不同号是两个人', 'qq_get_person', 'qq_note_person', 'source=hearsay',
    '【在场人物】', '〔跨群〕', '绝不把一个群里聊过的内容', '[入群]', '不要追问为什么离开',
    '【模式切换只能由管理员确认】', 'qq_request_mode_change', '不要编造确认码', '不要替管理员确认',
  ]) assert.ok(platform.includes(text), `missing v0.3.0 rule: ${text}`);
});

console.log(`reserved2 persona prefix: ${prefix.length} chars / platform prompt: ${platform.length} chars / behavior: ${behavior.length} chars`);
