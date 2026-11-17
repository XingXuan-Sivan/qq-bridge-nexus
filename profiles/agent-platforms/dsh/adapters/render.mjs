// DSH 渲染层：把能力档的**意图**编译成 cordis 插件行。
//
// 本文件是纯函数（不读盘、不认 cwd）：同一份意图 + 同一份 render.yml 永远产出同一批行，
// 构建期（adapters/build.mjs）与运行期（`agentPlatformPresetRows`）共用它，
// 因此「装进去的 preset」与「控制台看到的那份」不会各算一套。
//
// 输入：
//   capability  已归一的能力档（src/capabilities/store.mjs 的 normalizeCapability 产出）
//               只用到 id / audience / behavior / effects / runtime.peerPermission
//   config      render.yml 解析结果（presets / effects / permissions / structure / compaction / order）
// 输出：
//   { rows, degraded }  rows 即 preset 行的 `config.plugins`；degraded 是「声明了但装不上」的效果。
//
// 降级不静默：装不上的效果进 degraded 由调用方写进控制台与审计（与 runtime.prompt: system
// 的 passthrough_degraded 同口径），绝不让「写了 fs.write 但实际没有写能力」变成无声的事实。

/** 整值占位符：字符串恰好是它时整体替换（保留原类型，数字不会被转成字符串）。 */
const WHOLE_PLACEHOLDER = /^\$\{([A-Za-z0-9_.]+)\}$/;
const INLINE_PLACEHOLDER = /\$\{([A-Za-z0-9_.]+)\}/g;

/** 结构行名（不是效果名），在 render.yml 的 structure 下定义。 */
export const STRUCTURE_SLOTS = Object.freeze(['persona', 'instructions', 'guard', 'compaction']);

function resolvePath(scope, dotted) {
  let current = scope;
  for (const part of dotted.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

/** 递归替换占位符：整值替换保留类型，句中替换只做文本插值。 */
export function substitute(value, scope, where = '') {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_PLACEHOLDER);
    if (whole) {
      const got = resolvePath(scope, whole[1]);
      if (got === undefined) throw new Error(`${where}：占位符 \${${whole[1]}} 没有值`);
      return got;
    }
    return value.replace(INLINE_PLACEHOLDER, (_, path) => {
      const got = resolvePath(scope, path);
      return got === undefined ? '' : String(got);
    });
  }
  if (Array.isArray(value)) return value.map((item, index) => substitute(item, scope, `${where}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitute(item, scope, `${where}.${key}`)]));
  }
  return value;
}

/**
 * 人格正文：头句 + 权限边界段 + 送达方式段。
 * guard 按 runtime.peerPermission 取（空串 = 群聊档），delivery 先按 behavior 取、
 * 没有绑定行为档案时按 peerPermission 取（运维三档的送达文案各自成文）。
 */
export function personaText(capability, config) {
  const persona = config?.persona;
  if (!persona?.header) throw new Error('render.yml 缺 persona.header');
  const peer = String(capability?.runtime?.peerPermission ?? '');
  const guard = persona.guard?.[peer];
  if (guard === undefined) {
    throw new Error(`render.yml 的 persona.guard 没有 peerPermission=${JSON.stringify(peer)} 这一段`);
  }
  const behavior = String(capability?.behavior ?? '');
  const delivery = persona.delivery?.[behavior || peer || 'access'] ?? persona.delivery?.default;
  if (delivery === undefined) {
    throw new Error(`render.yml 的 persona.delivery 没有 ${JSON.stringify(behavior || peer || 'access')} 这一段`);
  }
  return `${persona.header}\n\n${guard}\n\n${delivery}`;
}

/** `when` 条件：目前只有受众与权限档两个维度，都不写就是恒真。 */
export function whenHolds(when, capability) {
  if (!when) return true;
  if (when.audience !== undefined) {
    const allowed = Array.isArray(when.audience) ? when.audience.map(String) : [String(when.audience)];
    if (!allowed.includes(String(capability.audience ?? ''))) return false;
  }
  if (when.peerPermission !== undefined) {
    const allowed = Array.isArray(when.peerPermission) ? when.peerPermission.map(String) : [String(when.peerPermission)];
    if (!allowed.includes(String(capability.runtime?.peerPermission ?? ''))) return false;
  }
  return true;
}

function buildRow(spec, scope, where) {
  if (!spec || typeof spec !== 'object') throw new Error(`${where}：行模板必须是映射`);
  if (!spec.id) throw new Error(`${where}：行模板缺 id`);
  if (!spec.module) throw new Error(`${where}：行模板缺 module`);
  const row = { id: String(spec.id), name: String(spec.module) };
  for (const [key, value] of Object.entries(spec)) {
    if (key === 'id' || key === 'module' || key === 'when' || key === 'plugins') continue;
    row[key] = substitute(value, scope, `${where}.${key}`);
  }
  if (spec.plugins !== undefined) {
    if (!Array.isArray(spec.plugins)) throw new Error(`${where}.plugins 必须是子行列表`);
    row.config = spec.plugins.map((sub, index) => buildRow(sub, scope, `${where}.plugins[${index}]`));
  }
  return row;
}

/** 能力档声明的效果：`{ 'web.access': 'mcp', 'user.ask': true }` → 校验后的 `[[效果, 变体]]`。 */
function declaredEffects(capability) {
  const raw = capability?.effects;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw).map(([effect, value]) => {
    if (value === true) return [effect, 'default'];
    if (value === false) return null;
    if (typeof value === 'string' && value.trim()) return [effect, value.trim()];
    throw new Error(`能力档 ${capability.id}：effects.${effect} 只能是 true / false / 变体名（现在 ${JSON.stringify(value)}）`);
  }).filter(Boolean);
}

/**
 * 渲染一份能力档的插件行。
 *
 * @param {object} capability 归一后的能力档
 * @param {object} config     render.yml 解析结果
 * @returns {{rows: object[], degraded: {effect: string, reason: string}[], persona: string}}
 */
export function renderPresetRows(capability, config) {
  if (!Array.isArray(config?.order) || config.order.length === 0) throw new Error('render.yml 缺 order（行序是装配顺序）');
  const peer = String(capability?.runtime?.peerPermission ?? '');
  const permission = config.permissions?.[peer];
  if (!permission) throw new Error(`render.yml 的 permissions 没有 peerPermission=${JSON.stringify(peer)} 这一档`);

  const audience = String(capability.audience ?? 'access');
  const compaction = config.compaction?.[audience] ?? config.compaction?.access;
  if (!compaction) throw new Error(`render.yml 的 compaction 没有 audience=${audience} 这一档`);

  const persona = personaText(capability, config);
  const scope = { permission, compaction, persona };

  const declared = new Map(declaredEffects(capability));
  const rows = [];
  const seen = new Set();
  const placed = new Set();
  const degraded = [];

  for (const slot of config.order) {
    const structure = config.structure?.[slot];
    if (structure) {
      if (!whenHolds(structure.when, capability)) continue;
      const row = buildRow(structure, scope, `structure.${slot}`);
      if (seen.has(row.id)) throw new Error(`render.yml：行 id ${row.id} 出现两次`);
      seen.add(row.id);
      rows.push(row);
      placed.add(slot);
      continue;
    }
    if (!declared.has(slot)) continue;
    placed.add(slot);
    const variant = declared.get(slot);
    const template = config.effects?.[slot]?.[variant];
    if (!template) {
      degraded.push({
        effect: slot,
        reason: variant === 'default' ? '这台执行体不渲染这个效果' : `这台执行体没有 ${slot} 的 ${variant} 变体`,
      });
      continue;
    }
    try {
      const row = buildRow(template, scope, `effects.${slot}.${variant}`);
      // 多个效果可以落在同一行（fs.read 与 fs.write 都是 tool-fs）：只装一次。
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    } catch (error) {
      degraded.push({ effect: slot, reason: error?.message ?? String(error) });
    }
  }

  for (const [effect] of declared) {
    if (placed.has(effect)) continue;
    degraded.push({ effect, reason: '这台执行体的渲染层不认识这个效果' });
  }

  return { rows, degraded, persona };
}

/** 预设元信息（DSH 预设列表读它）：render.yml 的 presets 段按能力档 id 取。 */
export function renderPresetMeta(id, config) {
  const meta = config?.presets?.[String(id ?? '')];
  if (!meta) throw new Error(`render.yml 的 presets 没有 ${id}：这台执行体不提供这个预设`);
  for (const field of ['name', 'description', 'order']) {
    if (meta[field] === undefined) throw new Error(`render.yml 的 presets.${id} 缺 ${field}`);
  }
  return meta;
}
