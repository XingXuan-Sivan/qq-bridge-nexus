/**
 * 运行态：当前平台用的是哪套运行方案。
 *
 * `state/runtime.json = { version: 1, active: { qq: 'social-v2' } }`
 * 只存指针，方案定义在 config.json 的 `runtime.plans`（见 src/runtime/plans.mjs）。
 */
import fs from 'node:fs';
import path from 'node:path';

export const RUNTIME_STATE_VERSION = 1;

function atomicWriteJson(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {{file:string, platform?:string, fallbackPlanId?:string, log?:(msg:string)=>void}} options
 */
export function createRuntimeState({ file, platform = 'qq', fallbackPlanId = 'social-v2', log = () => {} }) {
  let data = readJson(file);
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = { version: RUNTIME_STATE_VERSION, active: {} };
  if (!data.active || typeof data.active !== 'object') data.active = {};
  data.version = RUNTIME_STATE_VERSION;

  const save = () => atomicWriteJson(file, data);

  function get(name = platform) {
    const value = data.active?.[name];
    return typeof value === 'string' && value ? value : null;
  }

  function set(name = platform, planId) {
    if (typeof planId !== 'string' || !planId) {
      delete data.active[name];
    } else {
      data.active[name] = planId;
    }
    save();
  }

  function snapshot() {
    return { version: data.version, active: { ...data.active } };
  }

  /** 首次启动时把旧 mode.json / config.agentPreset 折算成方案指针并落盘（只做一次）。 */
  function migrateOnce(planId) {
    if (get()) return { migrated: false, planId: get() };
    const next = typeof planId === 'string' && planId ? planId : fallbackPlanId;
    set(platform, next);
    log(`运行方案已初始化：${platform} → ${next}`);
    return { migrated: true, planId: next };
  }

  return { file, platform, get, set, snapshot, migrateOnce, get fallbackPlanId() { return fallbackPlanId; } };
}
