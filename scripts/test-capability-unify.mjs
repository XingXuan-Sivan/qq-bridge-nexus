// P10.7 红线核查：能力归一后不该再出现的旧结构与耦合。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
assert.ok(
  !consoleFiles.filter((f) => !f.endsWith('demo.js')).some((f) => read(f).includes('Agent 预设')),
  '界面仍出现「Agent 预设」',
);

// 3) 前端不得自己拼装 capability 的旧字段。
for (const file of consoleFiles) {
  const text = read(file);
  assert.ok(!text.includes('tools.visible'), `${file} 仍用 tools.visible`);
  assert.ok(!text.includes('suggestedPermission'), `${file} 仍用 suggestedPermission`);
}

// 4) 平台提示词只在平台侧：能力文件里不得出现 QQ 专属话术。
const capDir = path.join(ROOT, 'dsh/agent-presets');
for (const id of fs.readdirSync(capDir)) {
  const file = path.join(capDir, id, 'capability.yml');
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!/QQ|群聊|群友/.test(text), `${id}/capability.yml 混入平台话术`);
}

// 5) 运行方案与执行侧都以 capability 为准。
assert.ok(read('src/bridge.js').includes('capabilityAllowsFlag'), 'bridge 未按 capability 收紧工具');
assert.ok(read('src/runtime/plans.mjs').includes('capabilityForTools'), 'plans 缺少 legacy 折算');

console.log('capability unify red lines: 12 checks passed');
