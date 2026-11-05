#!/usr/bin/env node
// 会话 key 迁移：把 state/*.json 里的旧形态 `group:<id>` / `private:<id>`
// 换成平台化形态 `<platform>:<group|private>:<id>`。
//
// 为什么需要单独一步：桥接的 key 组装已经收敛到 `sessionKey()`，但配置项
// `platform.keyedFormat` 一旦打开，磁盘上已有的旧 key 就对不上了——映射表、
// 定时任务目标、黑话/记忆的分桶全都按 key 存。所以「改代码」和「改数据」分开：
// 先把代码准备好（默认仍产出旧形态），确认无误后再跑本脚本改数据。
//
// 用法：
//   node scripts/migrate-session-keys.mjs                 # 预演：只打印会改什么
//   node scripts/migrate-session-keys.mjs --apply         # 真正写盘（先备份 state/）
//   node scripts/migrate-session-keys.mjs --revert        # 回滚到最近一次备份
//   node scripts/migrate-session-keys.mjs --platform qq   # 指定平台（默认 qq）
//
// 约束：
//   - 只处理 `state/` 下的一级 `*.json`（wiki/verification 等纯聚合文件不动）。
//   - 只改「整串就是 key」的字符串值或对象键；不做子串替换。
//   - `--apply` 前把整个 `state/` 复制成 `state.bak-<时间戳>`，`--revert` 用它还原。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, 'state');
const LEGACY_KEY = /^(group|private):(\d+)$/;
const BACKUP_PREFIX = 'state.bak-';

/** 把单个 key 转成平台化形态；不是 key 就原样返回。 */
export function platformizeKey(value, platform) {
  const m = LEGACY_KEY.exec(String(value));
  return m ? `${platform}:${m[1]}:${m[2]}` : null;
}

/**
 * 递归迁移一个 JSON 值。
 * 返回 `{ value, changed }`，`changed` 是改动条数（键与值分开计数，便于报告）。
 */
export function platformizeTree(node, platform, stats = { keys: 0, values: 0 }) {
  if (Array.isArray(node)) {
    return { value: node.map((item) => platformizeTree(item, platform, stats).value), changed: stats.keys + stats.values };
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      const nextKey = platformizeKey(k, platform);
      if (nextKey) stats.keys += 1;
      out[nextKey ?? k] = platformizeTree(v, platform, stats).value;
    }
    return { value: out, changed: stats.keys + stats.values };
  }
  if (typeof node === 'string') {
    const next = platformizeKey(node, platform);
    if (next) {
      stats.values += 1;
      return { value: next, changed: stats.keys + stats.values };
    }
  }
  return { value: node, changed: stats.keys + stats.values };
}

function listJsonFiles() {
  return fs
    .readdirSync(STATE_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.json'))
    .map((d) => d.name)
    .sort();
}

function readJson(file) {
  const raw = fs.readFileSync(path.join(STATE_DIR, file), 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function writeJson(file, value) {
  fs.writeFileSync(path.join(STATE_DIR, file), `${JSON.stringify(value, null, 2)}\n`);
}

function backupState() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(ROOT, `${BACKUP_PREFIX}${stamp}`);
  fs.cpSync(STATE_DIR, dir, { recursive: true });
  return dir;
}

function latestBackup() {
  const dirs = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(BACKUP_PREFIX))
    .map((d) => d.name)
    .sort();
  return dirs.length ? path.join(ROOT, dirs[dirs.length - 1]) : null;
}

function main(argv) {
  const apply = argv.includes('--apply');
  const revert = argv.includes('--revert');
  const platformIdx = argv.indexOf('--platform');
  const platform = platformIdx >= 0 && argv[platformIdx + 1] ? argv[platformIdx + 1] : 'qq';
  if (!/^[a-z][a-z0-9-]{0,15}$/.test(platform)) {
    console.error(`平台名不合法：${platform}`);
    process.exit(2);
  }

  if (revert) {
    const dir = latestBackup();
    if (!dir) {
      console.error(`没有找到 ${BACKUP_PREFIX}* 备份，无从回滚`);
      process.exit(1);
    }
    fs.rmSync(STATE_DIR, { recursive: true, force: true });
    fs.cpSync(dir, STATE_DIR, { recursive: true });
    console.log(`已回滚：${path.basename(dir)} → state/`);
    return;
  }

  const report = [];
  let total = 0;
  for (const file of listJsonFiles()) {
    let before;
    try {
      before = readJson(file);
    } catch (error) {
      report.push({ file, skipped: `非法 JSON：${error.message}` });
      continue;
    }
    const stats = { keys: 0, values: 0 };
    const { value: after } = platformizeTree(before, platform, stats);
    const changed = stats.keys + stats.values;
    if (!changed) continue;
    total += changed;
    const sampleBefore = JSON.stringify(before).slice(0, 120);
    const sampleAfter = JSON.stringify(after).slice(0, 120);
    report.push({ file, keys: stats.keys, values: stats.values, sampleBefore, sampleAfter });
    if (apply) writeJson(file, after);
  }

  for (const row of report) {
    if (row.skipped) {
      console.log(`- ${row.file}：跳过（${row.skipped}）`);
      continue;
    }
    console.log(`- ${row.file}：键 ${row.keys} 处、值 ${row.values} 处`);
    console.log(`    前 ${row.sampleBefore}`);
    console.log(`    后 ${row.sampleAfter}`);
  }
  if (!report.length) {
    console.log(`state/ 下没有可迁移的旧 key（平台 ${platform}）。`);
    return;
  }
  if (!apply) {
    console.log(`\n预演结束：共 ${total} 处待改。加 --apply 才会写盘（写前自动备份 state/）。`);
    return;
  }
  const dir = backupState();
  console.log(`\n已写入 ${total} 处；备份：${path.basename(dir)}（回滚：--revert）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
