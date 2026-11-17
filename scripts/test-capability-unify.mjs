// C1→C4 的红线：能力模型的「唯一源」不许回退。
//
// 这里守的是**方向**而不是某个字段：
//   - 服务端/前端都只能读 capabilities/<id>.yml，不许再有第二份能力定义；
//   - 能力档的元信息（tools/label/note/preset）不许混进平台话术（那是平台侧的职责）；
//   - 方案层已退役：能力档与行为档案分别由会话档案/平台条目直接引用，不得再长出中间层；
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
//    能力档只写意图（effects / behavior / runtime / audience / mcp / skills），
//    插件名、行序、人格正文与预设展示名都在平台的渲染层（render.yml）。
//    效果名与 label / note 描述的是「这个能力档要什么」，将来换平台还得能用，所以必须平台无关。
//    直通档是**跟 Agent 平台无关的一档**（profiles/capabilities/direct.yml）：任何 Agent 平台
//    都能选，跟 full / workspace 同类，不得在某个平台目录里再存一份，也不得用 audience 锁进私聊。
const capDirs = [
  path.join(ROOT, 'profiles/capabilities'),
  path.join(ROOT, 'profiles/agent-platforms/dsh/capabilities'),
];
const capabilityIds = [];
for (const capDir of capDirs) {
  for (const name of fs.readdirSync(capDir)) {
    if (!name.endsWith('.yml')) continue;
    const id = name.replace(/\.yml$/, '');
    capabilityIds.push(id);
    const doc = parseYaml(fs.readFileSync(path.join(capDir, name), 'utf8')) ?? {};
    const metaText = JSON.stringify({ label: doc.label, note: doc.note, effects: doc.effects });
    assert.ok(!/QQ|群聊|群友/.test(metaText), `${name} 的 label/note/effects 里混入平台话术（能力语义要跨平台可复用）`);
    // 旧形状（rows 预设正文、preset 展示名、tools 工具面）已分别归到平台的渲染层与平台声明：
    // 能力档里出现任何一段，都说明还有地方在写第二份定义，渲染层就不再是唯一出口。
    assert.equal(doc.rows, undefined, `${name} 仍带 rows 段（插件行由平台的渲染层生成）`);
    assert.equal(doc.preset, undefined, `${name} 仍带 preset 元信息（展示名归渲染层的 presets 段）`);
    assert.equal(doc.tools, undefined, `${name} 仍带 tools 段（工具面归平台声明）`);
    if ((doc.runtime?.apply ?? 'preset') === 'passthrough') {
      assert.deepEqual(doc.effects ?? {}, {}, `${name} 是直通档：不声明效果，工具面交给执行体自己`);
    }
  }
}
assert.ok(capabilityIds.includes('direct'), '缺少跨平台共用的直通档 profiles/capabilities/direct.yml');
assert.ok(
  !fs.existsSync(path.join(ROOT, 'profiles/agent-platforms/dsh/capabilities/direct.yml')),
  '直通档只能有共用目录一份，dsh 目录里不许再存',
);
const directDoc = parseYaml(fs.readFileSync(path.join(ROOT, 'profiles/capabilities/direct.yml'), 'utf8')) ?? {};
assert.equal(directDoc.runtime?.apply, 'passthrough', '直通档必须 apply: passthrough');
assert.equal(directDoc.audience, undefined, '直通档不设受众限制：和 full / workspace 一样由会话自己选');

// 5) 方案层已退役：不得再出现方案目录或方案仓库。
assert.ok(!fs.existsSync(path.join(ROOT, 'profiles/plans')), 'profiles/plans/ 仍存在（方案层已退役）');
assert.ok(!fs.existsSync(path.join(ROOT, 'src/runtime/plans.mjs')), 'src/runtime/plans.mjs 仍存在（方案层已退役）');

// 6) agents/ 目录已并入 capabilities/：任何残留都说明还有第二份正文在写。
assert.ok(
  !fs.existsSync(path.join(ROOT, 'profiles/agent-platforms/dsh/agents')),
  'profiles/agent-platforms/dsh/agents/ 仍存在（C4 起已并入 capabilities/）',
);

// 7) 工具面归平台声明：能力档不再按会话收紧平台工具（收紧只走会话权限级别）。
const bridgeSrc = read('src/bridge.js');
assert.ok(
  bridgeSrc.includes("readPlatformTools({ root: PLATFORMS_ROOT"),
  'bridge 未从平台声明取工具面（profiles/platforms/<id>/tools.yml）',
);
assert.ok(!bridgeSrc.includes('capabilityAllowsFlag'), 'bridge 仍在按能力档收紧平台工具');

console.log('capability unify red lines: passed');
