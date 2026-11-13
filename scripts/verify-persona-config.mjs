// 用 DSH 自身的 dsh-persona 配置 schema 校验 preset 的 persona 配置。
//
// 两层能力，按环境降级：能拿到磁盘上的 @deepseek-ai 模块就用 DSH 自己的 schema（证明「DSH
// 收得下」）；拿不到就只做结构断言并显式打印降级原因，不让「配置坏了」和「脚本跑不起来」
// 混成同一件事。要启用 schema 层：设 DSH_INSTALL_MODULES=<含 @deepseek-ai 的 node_modules>。

import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';
import { directoryModulesDir } from './dsh-package-source.mjs';

let persona = null;
let degradeReason = '';
try {
  const mods = directoryModulesDir();
  if (!mods) {
    degradeReason = '磁盘上没有 @deepseek-ai/*（0.2.2 已内联进 app.asar）；设 DSH_INSTALL_MODULES 可启用 schema 校验';
  } else {
    const file = path.join(mods, '@deepseek-ai/dsh-persona/lib/index.js');
    if (fs.existsSync(file)) persona = await import(pathToFileURL(file).href);
    else degradeReason = `${path.relative(process.cwd(), file)} 不存在`;
  }
} catch (error) {
  degradeReason = `加载 dsh-persona 失败：${error?.message ?? error}`;
}

let failed = 0;
let skipped = 0;
function check(label, fn) {
  try { fn(); console.log(`  ✅ ${label}`); }
  catch (e) { console.log(`  ❌ ${label}: ${e?.message ?? e}`); failed += 1; }
}
function skip(label, why) {
  skipped += 1;
  console.log(`  ⏭ ${label} — ${why}`);
}

console.log('persona Config schema 校验：\n');
if (persona) {
  console.log('（使用 DSH 自带的 dsh-persona schema）');
} else {
  console.log(`（降级：仅结构断言。${degradeReason}）`);
}

// ── schema 层（需要 DSH 模块）────────────────────────────────────────────────
if (persona) {
  check('旧配置 {text} 被拒绝（复现原故障）', () => {
    let threw = false;
    try { persona.Config({ text: 'hello' }); } catch { threw = true; }
    if (!threw) throw new Error('旧配置竟然通过了校验，说明本次改动前提不成立');
  });

  check('新配置 {prefix} 通过（个人前缀）', () => {
    const v = persona.Config({ prefix: 'You are a coding agent powered by the {{model}} model.' });
    if (v.prefix.length === 0) throw new Error('prefix 为空');
  });

  // 0.2.1 起提示词变量只剩 provider / model；`{{cwd}}` 会在运行期报
  // unknown prompt variable。但**schema 层不会拒绝它**（它只校验结构），
  // 所以这条只是"schema 不设限"的记录，真正的防线是下面针对仓库配置的反向断言。
  check('新配置 {prefix, suffix} 通过（schema 不限制模板变量）', () => {
    const v = persona.Config({
      prefix: 'You are a coding agent powered by the {{model}} model.',
      suffix: 'Your working directory is {{cwd}}.',
    });
    if (v.suffix !== 'Your working directory is {{cwd}}.') throw new Error('suffix 未保留');
    if (v.complete !== false) throw new Error('complete 默认值异常');
    if (v.includeRuntimeContext !== true) throw new Error('includeRuntimeContext 默认值异常');
  });
} else {
  for (const label of ['旧配置 {text} 被拒绝（复现原故障）', '新配置 {prefix} 通过（个人前缀）', '新配置 {prefix, suffix} 通过（schema 不限制模板变量）']) {
    skip(label, '需要 DSH 的 dsh-persona 模块');
  }
}

// ── 仓库配置（始终执行）──────────────────────────────────────────────────────
for (const preset of ['qq-chat', 'qq-chat-v2']) {
  const file = path.resolve(process.cwd(), 'profiles/agent-platforms/dsh/agents', preset, 'agent.cordis.yml');
  console.log(`\n${preset} (${path.relative(process.cwd(), file)}):`);
  const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
  const row = doc.find((r) => r.id === 'persona');

  check('存在 persona 行', () => { if (!row) throw new Error('缺少 persona 行'); });
  if (!row) continue;

  check('persona 行名正确', () => {
    if (row.name !== '@deepseek-ai/dsh-persona') throw new Error(`name=${row.name}`);
  });
  if (persona) {
    check('persona.config 通过 DSH schema', () => { persona.Config(row.config); });
  } else {
    skip('persona.config 通过 DSH schema', '需要 DSH 的 dsh-persona 模块');
  }
  check('保留了 {{model}} 变量', () => {
    if (!/\{\{model\}\}/.test(row.config.prefix ?? '')) throw new Error('prefix 缺少 {{model}}');
  });
  // 2026-11-13 方向反转：0.2.1 起 `{{cwd}}` **不是**合法提示词变量，出现它会让每一轮
  // 直接报 `unknown prompt variable "cwd"`。上一版断言的是"必须保留 {{cwd}}"，
  // 与实际行为相反，而且一直红着没人发现（运行期错误被桥接重试吞掉了）。
  check('不含 {{cwd}} 变量（0.2.1 起非法）', () => {
    const hit = /\{\{cwd\}\}/.test(String(row.config.suffix ?? ''))
      || /\{\{cwd\}\}/.test(String(row.config.prefix ?? ''));
    if (hit) throw new Error('出现 {{cwd}}：DSH 会报 unknown prompt variable，导致每一轮失败');
  });
  check('不再包含已废弃的 text 字段', () => {
    if (Object.hasOwn(row.config, 'text')) throw new Error('仍有 text 字段');
  });
  check('persona 正文（除头句）完整保留', () => {
    const body = String(row.config.prefix ?? '').split('\n').slice(1).join('\n');
    if (body.length < 500) throw new Error(`正文疑似丢失，仅 ${body.length} 字符`);
  });
}

console.log(
  failed === 0
    ? `\n✅ 全部通过${skipped ? `（${skipped} 项因环境降级跳过）` : ''}`
    : `\n❌ ${failed} 项失败${skipped ? `，${skipped} 项跳过` : ''}`,
);
process.exit(failed === 0 ? 0 : 1);
