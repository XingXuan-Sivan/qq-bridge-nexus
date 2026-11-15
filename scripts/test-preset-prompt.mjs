// 仿真提示词改写（src/preset-prompt.js）的离线单测。
// 这些检查保证「控制台改仿真提示词」不会破坏 YAML、不会丢别的条目、不会改变提示词语义。
// 不连 DSH、不连 QQ、不写任何生产文件。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  PRESET_BLOCKING_SUBSTRINGS,
  PRESET_REQUIRED_MARKERS,
  extractPresetPrefix,
  locatePresetPromptBlock,
  presetBlockingSubstrings,
  presetPromptBlockers,
  presetPromptMarkers,
  presetPromptWarnings,
  renderPresetPromptYaml,
} from '../src/preset-prompt.js';

/**
 * 取一份能力档的「预设正文」文本。
 *
 * preset-prompt 的文本手术面对的是**行列表**（`- id: persona` 顶格），
 * 而 C4 起它的宿主是能力档的 rows 段（缩进两级）。桥接在调用前会把 rows 重新
 * stringify 成顶格数组，这里用同一个转换，保证测的是真实链路。
 */
function presetBodyOf(name) {
  const file = new URL(`../profiles/agent-platforms/dsh/capabilities/${name}.yml`, import.meta.url);
  const doc = parseYaml(fs.readFileSync(file, 'utf8'));
  return stringifyYaml(doc.rows, { lineWidth: 0, singleQuote: true });
}

const source = presetBodyOf('chat-v2');
const originalPrefix = extractPresetPrefix(source);

// 回归：内置预设必须满足**它自己那一代**的硬性不变量。
//
// 背景：保存/还原的校验曾经对两代预设用同一份清单（那份清单是照二代写的），
// 结果一代预设（chat）在控制台里 100% 存不进去、也还原不了 ——
// 报错还说它「缺少安全不变量」，而它从来就没打算有那些工具面表述。
// 这条测试同时钉住两件事：① 每代预设都能通过自己的清单；② 清单本身没写错字。
test('每代内置预设都满足自己那一代的安全不变量', () => {
  for (const [name, gen] of [['chat', 'v1'], ['chat-v2', 'v2']]) {
    const text = presetBodyOf(name);
    const prefix = extractPresetPrefix(text);
    assert.equal(typeof prefix, 'string', `${name} 应能抽出 persona.prefix`);
    const blockers = presetPromptBlockers(prefix, gen);
    assert.deepEqual(blockers, [], `${name}（${gen}）不应有阻断项，实际：${blockers.join('；')}`);
  }
});

test('一代与二代的硬性不变量清单只差在送达方式（不共成一份）', () => {
  assert.notDeepEqual(presetBlockingSubstrings('v1'), presetBlockingSubstrings('v2'));
  // 安全边界两代共享，无法用「某串只在一代」区分；差别必须落在送达方式上。
  assert.ok(presetBlockingSubstrings('v2').includes('送达方式：工具发送'));
  assert.ok(presetBlockingSubstrings('v1').includes('送达方式：自动转发'));
  assert.ok(!presetBlockingSubstrings('v1').includes('送达方式：工具发送'));
});

test('真实预设能定位到 persona 的 prefix 块', () => {
  const loc = locatePresetPromptBlock(source);
  assert.ok(loc, '应能定位 prefix 块');
  // 源文件已从折叠标量（>-）迁成字面块（|-）：保留原始换行，读写才不会被重排。
  assert.match(loc.lines[loc.keyLine].trim(), /^prefix: [|>]-$/);
  assert.ok(loc.blockEnd > loc.keyLine + 1, 'prefix 块应包含内容行');
  // 条目边界必须恰好停在下一个插件行：多一行会把后续行一起改掉，少一行会漏掉块尾内容。
  // （C4 起 persona 的 config.prefix 就是块里最后一键，后面紧接的就是下一条插件行而非空行）
  assert.ok(loc.entryEnd < loc.lines.length, 'persona 之后应还有别的插件行');
  assert.match(loc.lines[loc.entryEnd], /^- id: /, 'persona 条目边界应落在下一条插件行');
});

test('抽出的是 YAML 解析后的真实字符串（折叠标量已展开）', () => {
  assert.equal(typeof originalPrefix, 'string');
  assert.ok(originalPrefix.length > 400, `提示词应有实质内容，实际 ${originalPrefix.length} 字符`);
  for (const marker of PRESET_REQUIRED_MARKERS) {
    assert.ok(originalPrefix.includes(marker), `内置提示词应包含安全基线段落：${marker}`);
  }
  assert.ok(originalPrefix.includes('{{model}}'), '应保留模板变量');
});

test('原样写回是幂等的，且不改变提示词语义', () => {
  const rewritten = renderPresetPromptYaml(source, originalPrefix);
  assert.equal(extractPresetPrefix(rewritten), originalPrefix, '读回应与原提示词逐字一致');
  // 再写一次仍稳定
  assert.equal(renderPresetPromptYaml(rewritten, originalPrefix), rewritten);
});

test('改写只动 prefix，其它条目与文件头注释原样保留', () => {
  const next = renderPresetPromptYaml(source, `${originalPrefix}\n\n【新增段落】测试内容。`);
  const before = parseYaml(source);
  const after = parseYaml(next);
  assert.deepEqual(after.map((row) => row.id), before.map((row) => row.id), '条目 id 顺序不变');
  for (const id of before.map((row) => row.id)) {
    if (id === 'persona') continue;
    assert.deepEqual(after.find((row) => row.id === id), before.find((row) => row.id === id), `条目 ${id} 不应被改动`);
  }
  assert.deepEqual(
    after.find((row) => row.id === 'persona').config.suffix,
    before.find((row) => row.id === 'persona').config.suffix,
    'persona 的 suffix 不应被改动',
  );
  // 文件头注释（前 6 行）必须原样保留
  assert.deepEqual(next.split('\n').slice(0, 6), source.split('\n').slice(0, 6), '文件头注释应保留');
  assert.ok(next.includes('prefix: |-'), '应使用字面量块写回');
});

test('特殊内容可安全往返（空行、缩进、Markdown、模板变量、CJK 标点）', () => {
  const tricky = [
    '# 标题',
    '',
    '- 列表项：含冒号: 和 # 井号',
    '    - 缩进 4 空格的子项',
    '',
    '```js',
    'const a = 1; // { 括号 } 也不能破坏 YAML',
    '```',
    '',
    '【中文段落】含全角标点：，。！？——以及 {{model}} / {{cwd}} 变量',
    '结尾不留多余空行',
  ].join('\n');
  // 必须在保留安全不变量的前提下追加特殊内容，否则会被阻断校验拦下
  const next = renderPresetPromptYaml(source, `${originalPrefix}\n\n${tricky}`);
  assert.equal(extractPresetPrefix(next), `${originalPrefix}\n\n${tricky}`);
  const rows = parseYaml(next);
  assert.equal(rows.length, parseYaml(source).length, '其它条目数量不变');
});

test('危险输入被拒绝，且不产生半截结果', () => {
  assert.throws(() => renderPresetPromptYaml(source, ''), /不能为空/);
  assert.throws(() => renderPresetPromptYaml(source, '   \n  \n'), /不能为空/);
  assert.throws(() => renderPresetPromptYaml(source, 'x'.repeat(200 * 1024)), /过长/);
  assert.throws(() => renderPresetPromptYaml('foo: bar\n', 'x'), /无法定位/);
  assert.throws(() => renderPresetPromptYaml('- id: other\n  config:\n    prefix: >-\n      x\n', 'x'), /无法定位/);
});

test('删掉安全不变量或正文过短时阻断保存（保护 AI 效果与自家测试）', () => {
  // 正文过短
  assert.throws(() => renderPresetPromptYaml(source, '太短了'), /过短/);
  // 逐条移除安全不变量，必须被拦住
  for (const needle of PRESET_BLOCKING_SUBSTRINGS) {
    const tampered = originalPrefix.replace(needle, '（已删除）');
    assert.throws(
      () => renderPresetPromptYaml(source, tampered),
      new RegExp(`缺少安全不变量「${needle}」`),
      `删除「${needle}」后仍被允许保存`,
    );
  }
  // 只做无损追加则应当通过
  assert.doesNotThrow(() => renderPresetPromptYaml(source, `${originalPrefix}\n\n【补充】一句新规则。`));
  const clean = presetPromptBlockers(originalPrefix);
  assert.deepEqual(clean, [], `内置提示词不应有阻断项，实际：${clean.join('；')}`);
});

test('写回沿用文件主导行尾，且不吞掉块尾空行', () => {
  // v0.3.0：不再依赖检出时的行尾（GitHub 源码 zip / Linux 检出是 LF，Windows autocrlf 检出是 CRLF），
  // 而是把样本显式转成 CRLF 再测「CRLF 文件写回仍是 CRLF」；LF 文件的往返由下一条断言覆盖。
  const source = presetBodyOf('chat-v2').replace(/\r?\n/g, '\r\n');
  const lfNext = renderPresetPromptYaml(source.replace(/\r\n/g, '\n'), originalPrefix);
  assert.equal((lfNext.match(/\r\n/g) ?? []).length, 0, 'LF 文件写回后不应引入 CRLF');
  const next = renderPresetPromptYaml(source, originalPrefix);
  const crlf = (next.match(/\r\n/g) ?? []).length;
  const lfOnly = (next.match(/\n/g) ?? []).length - crlf;
  assert.ok(crlf > 0, 'CRLF 文件写回后应仍使用 CRLF');
  assert.equal(lfOnly, 0, '写回后不应残留/新增 LF-only 行');
  assert.ok(next.includes('prefix: |-\r\n'), '新增行应使用 CRLF');
  // 块之后的内容（空行、注释、后续条目）必须逐字保留
  const before = locatePresetPromptBlock(source);
  const after = locatePresetPromptBlock(next);
  assert.deepEqual(
    next.split('\n').slice(after.blockEnd),
    source.split('\n').slice(before.blockEnd),
    'prefix 块之后的内容应逐字不变（含块尾空行与注释）',
  );
  assert.ok(source.split('\n').slice(before.blockEnd).some((l) => l.trim() === ''), '样本应确实包含块尾空行，否则该断言无意义');
});

test('只含空格/Tab 的行也能安全往返（不会被当成空行读丢）', () => {
  // 用完整原文（安全不变量齐全）再追加空白行样本；前缀分段格式变化不影响该用例。
  const spaced = [
    originalPrefix,
    '   ',
    '\t',
    ' 带前后空格的正文 ',
    '正常一行',
  ].join('\n');
  const next = renderPresetPromptYaml(source, spaced);
  assert.equal(extractPresetPrefix(next), spaced, '空白行必须原样保留');
});

test('缺少安全基线段落时给出警告（但不阻断保存）', () => {
  assert.deepEqual(presetPromptWarnings(originalPrefix), [], '内置提示词不应有警告');
  const stripped = originalPrefix.replace(/【送达方式：工具发送】[^\n]*\n/, '');
  const warnings = presetPromptWarnings(stripped);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /送达方式/);
  assert.ok(presetPromptWarnings('').some((w) => /内容为空/.test(w)));
});

// 软校验（warnings）与硬校验一样按代次取清单：两代共享安全边界，只差送达方式。
test('提示词软校验按代次取清单：一代不该被要求二代的送达方式', () => {
  const v1 = '【安全边界（最高优先级，不可违反）】\n【送达方式：自动转发】';
  const v2 = '【安全边界（最高优先级，不可违反）】\n【送达方式：工具发送】';
  assert.deepEqual(presetPromptWarnings(v1, 'v1'), [], '一代内容按一代校验不应报缺段');
  assert.deepEqual(presetPromptWarnings(v2, 'v2'), [], '二代内容按二代校验不应报缺段');
  assert.equal(presetPromptWarnings(v1, 'v2').length, 1, '一代内容按二代校验应报送达方式缺失');
});

// 回归：qq-agent-* 与自建预设的 persona.prefix 可能缺省或为空。
// 以前这两种文件会直接抛「无法定位 prefix 块」，控制台里整块提示词打不开也存不了。
const NO_PREFIX_YAML = [
  '- id: persona',
  "  name: '@deepseek-ai/dsh-persona'",
  '- id: qq-tool-restrict',
  "  name: './qq-tool-restrict.mjs'",
  '',
].join('\n');

test('persona 没有 prefix 时能补出 config: 与 prefix 块', () => {
  assert.ok(locatePresetPromptBlock(NO_PREFIX_YAML), '缺 prefix 也要能定位到 persona 条目');
  const next = renderPresetPromptYaml(NO_PREFIX_YAML, '补出来的提示词', 'generic');
  assert.equal(extractPresetPrefix(next), '补出来的提示词');
  const rows = parseYaml(next);
  assert.deepEqual(rows[0], { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: '补出来的提示词' } });
  assert.deepEqual(rows[1], { id: 'qq-tool-restrict', name: './qq-tool-restrict.mjs' });
});

test('prefix: "" 这种行内空值能替换成块标量', () => {
  const inline = [
    '- id: persona',
    "  name: '@deepseek-ai/dsh-persona'",
    '  config:',
    '    prefix: ""',
    '- id: qq-tool-restrict',
    "  name: './qq-tool-restrict.mjs'",
    '',
  ].join('\n');
  const next = renderPresetPromptYaml(inline, '行内空值也能写', 'generic');
  assert.equal(extractPresetPrefix(next), '行内空值也能写');
});

test('非仿真预设（generic）不做工具面不变量校验', () => {
  assert.deepEqual(presetBlockingSubstrings('generic'), []);
  assert.deepEqual(presetPromptMarkers('generic'), []);
  assert.deepEqual(presetPromptBlockers('随便一段提示词', 'generic'), []);
  assert.equal(presetPromptBlockers('   ', 'generic').length, 1, '空内容仍要拦住');
});
