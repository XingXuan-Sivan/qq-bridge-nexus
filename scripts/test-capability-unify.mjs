// C1→C4 的红线：能力模型的「唯一源」不许回退。
//
// 这里守的是**方向**而不是某个字段：
//   - 服务端/前端都只能读 capabilities/<id>.yml，不许再有第二份能力定义；
//   - 能力档的元信息（tools/label/note/preset）不许混进平台话术（那是平台侧的职责）；
//   - plan 只说「用哪个能力档」，不许再叠加 agent 字段（C4 起两者是同一个 id）；
//   - agents/ 目录已并入 capabilities/，任何残留都说明有地方还在写第二份正文。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve('.');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const walk = (dir, exts = ['.js', '.mjs', '.html', '.css', '.json']) => {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel, exts));
    else if (exts.includes(path.extname(entry.name))) out.push(rel);
  }
  return out;
};

const srcFiles = walk('src');
const consoleFiles = walk('public/console');

// 1) 服务端只剩 capability.yml 一个源：不得再读 config.capabilities。
for (const file of srcFiles) {
  const text = read(file);
  assert.ok(!text.includes('config.capabilities'), `${file} 仍引用 config.capabilities`);
  assert.ok(!text.includes('createCapabilityRegistry'), `${file} 仍引用旧注册表`);
  assert.ok(!text.includes("capabilities[id].sandbox"), `${file} 仍读 sandbox 补丁字段`);
}

// 2) 旧预设页已删除，导航/路由/静态文件不得残留。
assert.ok(!fs.existsSync(path.join(ROOT, 'public/console/pages/presets')), 'pages/presets 仍存在');
assert.ok(!read('public/console/index.html').includes('data-view="presets"'), '导航仍指向 presets');
assert.ok(!read('public/console/js/router.js').includes("'presets'"), '路由仍登记 presets');
assert.ok(!/预设<\/a>/.test(read('public/console/index.html')), '导航里仍有独立的「预设」入口');

// 3) 前端不得自己拼装 capability 的旧字段。
for (const file of consoleFiles) {
  const text = read(file);
  assert.ok(!text.includes('tools.visible'), `${file} 仍用 tools.visible`);
  assert.ok(!text.includes('suggestedPermission'), `${file} 仍用 suggestedPermission`);
}

// 4) 能力语义不含平台话术。
//    C4 起 rows（预设正文）与 preset.name/description（DSH 预设列表的展示名）都随平台走，
//    它们含「QQ」是产品文案，不算漂移；但 tools / label / note 描述的是「这个能力档能做什么」，
//    将来换平台还得能用，所以这三处必须平台无关。
const capDir = path.join(ROOT, 'profiles/agent-platforms/dsh/capabilities');
const capabilityIds = [];
for (const name of fs.readdirSync(capDir)) {
  if (!name.endsWith('.yml')) continue;
  const id = name.replace(/\.yml$/, '');
  capabilityIds.push(id);
  const doc = parseYaml(fs.readFileSync(path.join(capDir, name), 'utf8')) ?? {};
  const metaText = JSON.stringify({ label: doc.label, note: doc.note, tools: doc.tools });
  assert.ok(!/QQ|群聊|群友/.test(metaText), `${name} 的 tools/label/note 里混入平台话术（能力语义要跨平台可复用）`);
  assert.ok(Array.isArray(doc.rows) && doc.rows.length > 0, `${name} 必须带非空 rows 段（预设正文跟着能力档走）`);
}

// 5) plan 只说能力档：不得再有 agent 字段。
const planDir = path.join(ROOT, 'profiles/plans');
for (const name of fs.readdirSync(planDir)) {
  if (!name.endsWith('.yml')) continue;
  const doc = parseYaml(fs.readFileSync(path.join(planDir, name), 'utf8')) ?? {};
  assert.equal(doc.agent, undefined, `plans/${name} 仍带 agent 字段（C4 起与 capability 合一）`);
  assert.ok(capabilityIds.includes(doc.capability), `plans/${name} 的 capability「${doc.capability}」不是已存在的能力档`);
}

// 6) agents/ 目录已并入 capabilities/：任何残留都说明还有第二份正文在写。
assert.ok(
  !fs.existsSync(path.join(ROOT, 'profiles/agent-platforms/dsh/agents')),
  'profiles/agent-platforms/dsh/agents/ 仍存在（C4 起已并入 capabilities/）',
);

// 7) 运行方案与执行侧都以 capability 为准。
assert.ok(read('src/bridge.js').includes('capabilityAllowsFlag'), 'bridge 未按 capability 收紧工具');
assert.ok(read('src/runtime/plans.mjs').includes('capability'), 'plans 未接 capability');

console.log('capability unify red lines: 17 checks passed');
