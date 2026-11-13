// QQ 桥接安全硬边界：只允许 QQ MCP 工具与少量无害模型侧工具。
//
// 本文件是 qq-agent-presets bundle 里的唯一权威实现，由 qq-chat / qq-chat-v2 两个 preset 的
// qq-tool-restrict 行共同引用；各 preset 目录下的同名文件只是 re-export 壳。
//
// 引用必须写成「包名/子路径」：preset 子行的 name 按声明它的 loader 上下文（profile 目录）
// 解析，'./x.mjs' 会落到 profile 根目录（不存在）。该包以 link: 依赖注册在 profile
// package.json，node_modules junction 由 scripts/setup-dsh.mjs 维护，仓库搬家后重建链接即可。
//
// 两层防御，缺一不可：
//  1) tools.restrict 在注册期把危险工具从工具清单（schema）里隐藏；
//  2) tools.guard 白名单兜底，执行期拒绝任何不在允许范围内的工具。
// 只有 guard 不够：工具名仍会出现在模型看到的 schema 里，既不满足「仿真会话不得拥有本地执行
// 能力」的登记期要求，也会诱使模型去调它。
//
// 名单维护：按能力分组（TOOL_GROUPS）后全部派生，不要手抄。
//     npm run scan:tool-names           # 双向求差：假名 + 未覆盖的危险名
//     npm run scan:tool-names -- --json # 机器可读，供基线文件生成
//
// 真假判定口径（别用「当前有没有注册」来判断）：
//   · 真实存在 = 工具包里能找到注册代码。被 composition 配置关掉不影响判定——例如
//     apply_patch 在 applyPatch:false 时不出现，但配置一打开它必须已经被挡住。
//   · 假名 = 源码里根本没有。留在名单里只会换来一条被 catch 吞掉的 restrict，边界静默少一层。

import { protectedFileReason } from './protected-paths.mjs'

export const name = 'qq-tool-restrict'

export const inject = ['tools']

/**
 * 危险工具按**能力**分组。
 *
 * 分组不是为了好看：`OPERATOR_DENY_TOOLS`、只读 Agent 白名单、以及将来的任何一个
 * profile，都从这些组**派生**，而不是各自再抄一份数组。手抄多份名单时，组里加一个
 * 名字要改三处，漏一处就漂移。
 *
 * 每条注明来源包（DSH 0.2.2-rc.2 实测）。
 */
export const TOOL_GROUPS = Object.freeze({
  /** 本机 shell：直接执行命令（含 persistent 变体，它们注册的名字不带后缀）。 */
  shell: Object.freeze(['pwsh', 'bash']),

  /** 本机文件读写与检索：能读凭据、能改工作区。dsh-tool-fs / -fs-search。 */
  filesystem: Object.freeze([
    'read', 'read_image', 'write', 'edit', 'str_replace_editor',
    'glob', 'grep',
    'apply_patch',      // dsh-tool-fs；全局层 applyPatch:false 时本机不注册，但仍是真名字
    'working_directory', // 设置后续文件操作的作用域目录
    'create_worktree',  // dsh-experimental-tool-worktree：在工作区外新建 git worktree
  ]),

  /** 终端会话：0.2.x 新增家族。能向用户终端发命令、读用户终端输出。 */
  terminal: Object.freeze([
    'terminal_open', 'terminal_list', 'terminal_read',
    'terminal_send', 'terminal_signal', 'terminal_close',
    'user_terminal_list', 'user_terminal_read', // dsh-terminal-panel：读**用户**的终端
  ]),

  /** 派生 agent 与团队编排：都能间接拿到 shell，也都能绕过本守卫的作用域。 */
  agents: Object.freeze([
    'subagent', 'subagent_fork', 'list_subagent_models',
    'send_message', 'interrupt_agent', 'list_agents', 'wait_agent',
    'team_task_create', 'team_task_get', 'team_task_list', 'team_task_update',
  ]),

  /** 宿主运行期自省与编排：能读宿主内部状态、跑长任务、注册 skill。 */
  introspection: Object.freeze([
    'cordis_inspect_list', 'cordis_inspect_query',
    'job_list', 'job_output', 'job_kill',
    'skill', 'present', 'workflow', 'ralph',
    'get_goal', 'create_goal', 'update_goal',
    // 会拉起包管理器 / 解析 workspace 依赖，属于本地执行（dsh-tool-workspace-dependencies）。
    'load_workspace_dependencies',
  ]),

  /** MCP 资源读取：`server` 参数可指向**任意**已配置的 MCP server（挂了 filesystem 就等于开洞）。 */
  mcpResources: Object.freeze([
    'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource',
  ]),

  /** 插件装载权 = 任意代码执行（内部会 spawn pnpm 改写 profile）。 */
  plugins: Object.freeze(['plugin_manager', 'plugin_market']),

  /** 无人值守的自我调度：QQ 会话不该拥有"过一会儿自己再跑一次"的能力。 */
  schedule: Object.freeze([
    'schedule_create', 'schedule_list', 'schedule_edit', 'schedule_view',
  ]),

  /** 跨会话数据面：能检索/读取**其它会话**的事件与轨迹（群友会话不该看到）。 */
  sessionQuery: Object.freeze([
    'session_search', 'session_trace',
    'session_event_read', 'session_event_search', 'session_event_trace',
  ]),

  /** 文档转换：起本地进程做转换/重算/渲染。 */
  office: Object.freeze(['office_convert', 'office_recalculate', 'office_render']),
})

/** 全部危险工具（去重、冻结）。测试与其它 profile 都从这里取。 */
export const LOCAL_EXECUTION_TOOLS = Object.freeze([
  ...new Set(Object.values(TOOL_GROUPS).flat()),
])

/**
 * 运行时注入器的工具（dsh-super-injector 等）。
 *
 * 与上面不同：它们**不在工具包里**，注入时注册、卸载时消失，静态对账永远看不到。
 * 因此：
 *   · restrict 端只能"尽力而为"——名字不存在时 `tools.restrict` 抛错，被下面的
 *     收集器记进 skipped 日志（这是预期噪音，不是故障）；
 *   · 真正的边界是执行期白名单，它对 `dev_` 前缀**一律拒绝**（见 apply）。
 *
 * 2026-11-13：删除了 `dev_mode_set/_status/_subagent`。它们不是注入器前缀族，
 * 而是 dsh-mode-boost 的具体工具名，0.2.1 起已随插件移除——留在名单里等于三条
 * 静默失效。若该插件回来，`dev_` 前缀在执行期仍然挡得住。
 */
export const RUNTIME_INJECTOR_TOOLS = Object.freeze([
  'dev_build_plugin', 'dev_clear_routes', 'dev_fix_patch', 'dev_heal_links',
  'dev_inject_plugin', 'dev_injected_list', 'dev_install_package', 'dev_plugin_status',
  'dev_release_plugin', 'dev_reload_package', 'dev_scaffold_plugin', 'dev_self_test',
  'dev_stage_add', 'dev_stage_call', 'dev_stage_demote', 'dev_stage_list',
  'dev_stage_promote', 'dev_uninject_plugin',
])

/** 执行期一律拒绝的前缀（注入器族）。 */
const DENIED_PREFIXES = Object.freeze(['dev_'])

/** 注册期下发的完整 restrict 名单（测试从这里取，保证两边不可能漂移）。 */
export const RESTRICTED_TOOL_NAMES = Object.freeze([
  ...LOCAL_EXECUTION_TOOLS,
  ...RUNTIME_INJECTOR_TOOLS,
])

// 执行期白名单：不在这些范围内的工具一律拒绝。
// 前缀覆盖 DSH MCP client 暴露的命名空间工具。
const SAFE_PREFIXES = [
  'mcp__snowluma__',
  'mcp__snowluma-host__',
  'mcp__web-search-safe__',
  'mcp__bridge-ext__',
]

// 无害模型侧工具：ask_user_question 用于把问题转给管理员/用户，
// todo_write 仅维护任务列表，compress 只压缩当前会话上下文（不读写本地文件、
// 不派生 agent、不执行命令）。若后续 preset 不再挂载这些工具，保留无害。
const SAFE_EXACT = new Set([
  'ask_user_question',
  'todo_write',
  'compress',
])

/**
 * v0.3.0：L1「本地只读 Agent」（qq-agent-readonly preset）额外放行的只读工具。
 *
 * 为什么 L1 不能只靠 DSH 的 read-only 沙箱：rc.2 文档写明 Windows 上 read-only 是 partial
 * （ACL 只限制写、硬链接/NUL 等仍有缝隙），而且沙箱拒绝写入后模型可以申请「越权重试」，
 * owner 一旦误批就真的写了。L1 直接在**工具层**不给 shell 与写文件工具 —— 与操作系统无关。
 * 这里只放行：读文件、读图片、glob/grep 检索、DSH 内置联网搜索/抓取（只读）。
 */
export const READONLY_AGENT_TOOLS = Object.freeze(['read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch'])

/**
 * v0.3.0：L2/L3 运维 Agent（qq-agent-workspace / qq-agent-full）的 profile。
 *
 * 只拒绝「派生 / 编排 / 插件 / 调度 / 跨会话 / 宿主自省」这几类；shell 与文件写入
 * 是否放行由 qq-approval-gate.mjs 决定（守卫只能拒绝，不能要求审批）。
 *
 * 从分组**派生**，不手抄：加一个新工具到 `TOOL_GROUPS.agents` 或 `.plugins`，
 * 这里自动跟上。
 */
export const OPERATOR_DENY_TOOLS = Object.freeze([
  ...TOOL_GROUPS.agents,
  ...TOOL_GROUPS.plugins,
  ...TOOL_GROUPS.schedule,
  ...TOOL_GROUPS.sessionQuery,
  ...TOOL_GROUPS.mcpResources,
  // introspection 组里只拒「编排 / 宿主自省」这两类，job / skill / goal 仍放行。
  'workflow', 'ralph',
  'cordis_inspect_list', 'cordis_inspect_query',
  'load_workspace_dependencies',
])

/**
 * 最近一次 `apply()` 的下发结果。
 *
 * 为什么留这个出口：`tools.restrict` 对未知名字抛错，守卫逐个 catch ⇒ **坏名单是静默的**。
 * 把 skipped 记下来，至少：
 *   · 启动时打一条汇总日志（不是 18 行噪音）；
 *   · 测试可以断言"假名数量在没有版本豁免的情况下为 0"；
 *   · nexus 的 qq_status 可以把它读出来给 owner 看。
 */
let lastReport = null

export function restrictReport() {
  return lastReport
}

/** 逐个下发 restrict 并收集失败项（restrict 的未知校验是整批原子性的，必须逐条）。 */
function restrictEach(ctx, names, { skip = () => false } = {}) {
  const applied = []
  const skipped = []
  for (const tool of names) {
    if (skip(tool)) continue
    try {
      ctx.tools.restrict({ deny: [tool] })
      applied.push(tool)
    } catch (error) {
      skipped.push({ tool, error: String(error?.message ?? error) })
    }
  }
  return { applied, skipped }
}

function reportSkipped(profile, skipped) {
  if (skipped.length === 0) return
  // 一条汇总而不是 N 行：单个名字消失是版本演进的常态，N 行会训练人忽略日志。
  console.error(
    `[qq-tool-restrict] profile=${profile}: ${skipped.length} 个名字在本机 DSH 上不存在，已跳过 restrict（执行期白名单仍然拒绝它们）：`
    + skipped.map((s) => s.tool).join(', ')
  )
}

export function apply(ctx, config = {}) {
  // profile：默认（不配）= QQ 群友会话的最严白名单；'readonly-agent' = L1 只读 Agent；
  // 'operator' = L2/L3 运维 Agent（只拒绝派生/编排/插件类工具与凭据读取，其余交给审批闸门）。
  const readonlyAgent = config?.profile === 'readonly-agent'
  const operator = config?.profile === 'operator'

  if (operator) {
    const { applied, skipped } = restrictEach(ctx, OPERATOR_DENY_TOOLS)
    lastReport = { profile: 'operator', applied: applied.length, skipped }
    reportSkipped('operator', skipped)
    ctx.tools.guard((exec) => {
      const name = exec?.name
      if (typeof name !== 'string' || name.length === 0) return '工具名无效，已拒绝'
      if (OPERATOR_DENY_TOOLS.includes(name) || DENIED_PREFIXES.some((p) => name.startsWith(p))) {
        return `工具 "${name}" 不允许在运维 Agent 中使用（派生 agent / 编排 / 插件 / 调度类）`
      }
      if (['read', 'read_image', 'glob', 'grep', 'write', 'edit', 'str_replace_editor'].includes(name)) return protectedFileReason(exec)
      return undefined
    })
    return
  }

  const extraAllowed = new Set(readonlyAgent ? READONLY_AGENT_TOOLS : [])
  // 1) 把已知危险全局工具从 schema 隐藏（restrict 只影响继承的全局层，
  //    不会误删 preset 自己注册的 scoped 工具）。
  const { applied, skipped } = restrictEach(ctx, RESTRICTED_TOOL_NAMES, { skip: (t) => extraAllowed.has(t) })
  lastReport = { profile: readonlyAgent ? 'readonly-agent' : 'default', applied: applied.length, skipped }
  reportSkipped(lastReport.profile, skipped)

  // 2) 执行期白名单：任何不在允许范围内的工具调用都会被拒绝。
  ctx.tools.guard((exec) => {
    const name = exec?.name
    if (typeof name !== 'string' || name.length === 0) return '工具名无效，已拒绝'
    if (SAFE_EXACT.has(name)) return
    if (extraAllowed.has(name)) return protectedFileReason(exec)
    if (SAFE_PREFIXES.some((prefix) => name.startsWith(prefix))) return
    if (DENIED_PREFIXES.some((prefix) => name.startsWith(prefix))) return `工具 "${name}" 属于宿主注入器族，不允许在 QQ 会话中使用`
    if (readonlyAgent) return `工具 "${name}" 不在 L1 只读 Agent 白名单内，已拒绝（L1 只允许读文件/检索/联网只读；需要写入或执行命令请让 owner 在 QQ 私聊用 /level L2 申请提升）`
    return `工具 "${name}" 不在 QQ 桥接白名单内，已拒绝（仅允许 QQ MCP 工具与无害模型侧工具）`
  })
}
