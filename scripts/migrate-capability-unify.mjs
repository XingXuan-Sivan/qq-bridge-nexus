#!/usr/bin/env node
// migrate-capability-unify.mjs — P10.3：把现有 5 个 QQ 预设收敛成 4 个平台无关能力。
//
// 做法：只**新增** dsh/agent-presets/<新 id>/capability.yml 并生成三份产物；
// 旧预设（qq-chat / qq-chat-v2 / qq-agent-*）原样保留，运行方案仍指向它们——
// 真正切换在 P10.5。这样迁移可随时回滚：删掉 4 个新目录即可。
//
// 平台话术（QQ 群聊协议、QQ 运维私聊规则）不写进能力：能力只留平台无关的
// 身份与边界，平台文本在 P10.4 交给行为档案的 prompt 段。
//
// 用法：
//   node scripts/migrate-capability-unify.mjs            # 生成缺失的 capability.yml 并刷新产物
//   node scripts/migrate-capability-unify.mjs --check     # 只校验（缺文件/产物漂移 exit 1）
//   node scripts/migrate-capability-unify.mjs --force     # 覆盖已有 capability.yml（谨慎）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveCapabilityFile } from '../src/capabilities/file.mjs';
import { writeArtifacts } from '../src/capabilities/build.mjs';
import { capabilityDirs } from './build-capability-artifacts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PRESET_ROOT = path.join(REPO_ROOT, 'dsh', 'agent-presets');

const COMMON_BASE = 'You are a coding agent powered by the {{model}} model.';

/** 四个能力的初始内容：工具面来自 SPEC §2.3，提示词只写平台无关部分。 */
export const CAPABILITIES = [
  {
    id: 'agent-chat',
    label: '聊天 Agent',
    note: '无本地工具，只做群聊与问答',
    order: 10,
    agent: ['tool-web', 'tool-ask-user', 'tool-todo'],
    local_tools: false,
    notes: '群友要求执行命令、读写文件或查看系统信息时，礼貌拒绝并说明需要管理员在管理端操作。',
    base: `${COMMON_BASE}\n\n你是一个在聊天平台里与人对话的助手：先理解对方在说什么，再决定回不回、怎么回；不确定就说不确定。`,
  },
  {
    id: 'agent-readonly',
    label: 'Agent · 只读',
    note: '只读文件与检索，不改任何东西',
    order: 20,
    agent: ['tool-fs', 'tool-fs-search', 'tool-web', 'tool-ask-user', 'tool-todo'],
    local_tools: true,
    notes: '你可以读取工作区文件与检索，但不能写入、不能执行命令；需要改动时说明要做什么，交给有写权限的角色。',
    base: `${COMMON_BASE}\n\n你是只读的运维助手：查清事实、给出结论与命令建议，但不替用户落盘或执行。`,
  },
  {
    id: 'agent-workspace',
    label: 'Agent · 工作区读写',
    note: '在工作区内读写与执行，越界触发审批',
    order: 30,
    agent: ['tool-fs', 'tool-fs-search', 'tool-pwsh', 'tool-jobs', 'tool-web', 'tool-ask-user', 'tool-todo'],
    local_tools: true,
    notes: '你可以在工作区内读写文件、执行命令、查看后台任务；越出工作区的操作会触发审批，请一次只做一件事并说明目的。',
    base: `${COMMON_BASE}\n\n你是工作区内的运维助手：能动手改，但每一步都要让用户看得懂；破坏性操作先确认。`,
  },
  {
    id: 'agent-full',
    label: 'Agent · 完全访问',
    note: '跨工作区与进程管理；仅在短时授权窗口内可钉',
    order: 40,
    agent: ['tool-fs', 'tool-fs-search', 'tool-pwsh', 'tool-jobs', 'tool-web', 'tool-ask-user', 'tool-todo'],
    local_tools: true,
    notes: '你拥有本机完全访问能力：可以读写任意路径、执行任意命令、管理进程。每次调用都会被记录；不要主动扩大影响面。',
    base: `${COMMON_BASE}\n\n你是拥有本机完全访问权限的运维助手：能力越大越要克制，先说明再执行，破坏性操作必须得到明确指令。`,
  },
];

function capabilityOf(spec) {
  const agent = {};
  for (const moduleId of spec.agent) agent[moduleId] = true;
  return {
    version: 1,
    id: spec.id,
    label: spec.label,
    note: spec.note,
    agent: 'dsh',
    risk: { max: spec.local_tools ? 'exec' : 'send' },
    prompt: { base: spec.base },
    tools: {
      platform: {},
      agent,
      mcp: [{ server: '*', tools: '*' }],
      skills: ['*'],
    },
    safety: {
      local_tools: spec.local_tools,
      secrets: 'deny',
      self_modify: 'deny',
      injection: 'strict',
      notes: spec.notes,
    },
  };
}

export function migrate({ check = false, force = false, log = () => {} } = {}) {
  const results = [];
  for (const spec of CAPABILITIES) {
    const dir = path.join(PRESET_ROOT, spec.id);
    const file = path.join(dir, 'capability.yml');
    const exists = fs.existsSync(file);
    if (!exists || force) {
      if (check) {
        results.push({ id: spec.id, changed: true, reason: '缺少 capability.yml' });
        continue;
      }
      saveCapabilityFile(dir, capabilityOf(spec));
      log(`${exists ? '✓ 已覆盖' : '✓ 已创建'} ${path.relative(REPO_ROOT, file)}`);
    }
    const files = writeArtifacts(dir, capabilityOf(spec), { check, order: spec.order });
    const changed = files.some((item) => item.changed);
    for (const item of files) {
      if (item.skipped) continue;
      log(`${item.changed ? (check ? '✗ 需重新生成' : '✓ 已生成') : '· 已是最新'} ${path.relative(REPO_ROOT, item.file)}`);
    }
    results.push({ id: spec.id, changed, reason: changed ? '产物漂移' : '' });
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const force = process.argv.includes('--force');
  const results = migrate({ check, force, log: (line) => console.log(`[migrate-capability] ${line}`) });
  const stale = results.filter((item) => item.changed);
  if (check && stale.length) {
    console.error(`[migrate-capability] ERROR: ${stale.length} 个能力不完整或产物不一致：${stale.map((item) => `${item.id}(${item.reason})`).join(', ')}`);
    process.exit(1);
  }
  console.log(`[migrate-capability] Done（${capabilityDirs().length} 个能力目录）`);
}
