// 模式持久化（P3）：把「切模式怎么存」从 bridge.js 的主流程里抽出来。
//
// 为什么抽这一层：
//   原来「切模式」= 写 state/mode.json + 写 DSH settings，两个 action 写死在
//   bridge.js 的 applyModeChange() 里，读侧同样写死在 refreshMode() 里：
//   `settings.describe` 的调用形状、命名空间名 `qq-mode`、「user 层优先」这条
//   DSH 0.2.0-rc.2 的坑（上游 issue #22）—— 全是 DSH 知识，却漏进了桥接主流程。
//   接第二个 Agent 平台时，这些都得再抄一遍，而抄错任何一条的表现都是
//   「控制台显示已切换、实际还在跑旧模式」，且没有任何日志。
//
// 边界（重要）：
//   本模块只管「模式值怎么存、怎么取」，**不知道模式是什么意思**：
//   不校验级别、不判定提权、不做 fail-closed。那些留在 bridge.js —— 它们才是安全边界，
//   不该被一个存储抽象顺手牵走。
//
// 两个后端：
//   local-file     state/mode.json，平台无关，**始终**写（远端挂了也要能降级生效）
//   dsh-settings   DSH 的 qq-mode 命名空间，平台特有，best-effort
// 新增 Agent 平台 = 提供一个同样形状的远端后端，bridge.js 三处调用点不用改。

/**
 * 本地文件后端：state/mode.json。
 *
 * 这个文件是**兜底**而不是缓存：DSH 没起来、命名空间没注册、写入被拒时，
 * 桥接仍然要能读到「上次生效的模式」，否则重启后会静默回到 chat（一代仿真，
 * preset 与工具面都不同）。所以它在读侧是回退，在写侧是必做项。
 */
export function createLocalModeFileBackend({ file, readJson, writeJson }) {
  return {
    id: 'local-file',
    file,
    /** @returns {object|null} 解析失败/缺失时返回 null（不抛错：这是兜底路径）。 */
    read() {
      const data = readJson(file, null);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    },
    /** 合并写：保留调用方没提到的键（如 closedAgentPreset 由别处维护）。 */
    write(patch) {
      const next = { ...(this.read() ?? {}), ...patch };
      writeJson(file, next);
      return next;
    },
  };
}

export const DSH_MODE_NAMESPACE = 'qq-mode';

/**
 * DSH settings 后端（qq-mode 命名空间）。
 *
 * 读取侧刻意只吃 `settings.describe` 的快照对象，而不是自己去调 API：
 * bridge.js 那次 describe 还要顺带取 `agent-presets.default`，不该为了模式再打一次。
 *
 * @param {{namespace?: string, readSetting: (ns: object, key: string) => unknown, normalizeMode: (v: unknown) => string|null}} options
 */
export function createDshModeBackend({ namespace = DSH_MODE_NAMESPACE, readSetting, normalizeMode }) {
  return {
    id: 'dsh-settings',
    namespace,
    /**
     * 从 describe 快照里取模式（user 层优先，见 readSetting 的实现说明）。
     * 命名空间缺失、值不可识别 ⇒ null，由调用方回退本地文件。
     * @returns {{mode: string, ownerQQ: unknown}|null}
     */
    read(snapshot) {
      const namespaces = Array.isArray(snapshot?.namespaces) ? snapshot.namespaces : [];
      const ns = namespaces.find((n) => n?.ns === namespace);
      if (!ns) return null;
      const mode = normalizeMode(readSetting(ns, 'mode'));
      if (!mode) return null;
      // ownerQQ 原样返回：留空表示「不覆盖 config.json」，这个判定属于调用方。
      return { mode, ownerQQ: readSetting(ns, 'ownerQQ') };
    },
    /**
     * 写穿远端。`update` 由调用方注入（已 unwrap 的 settings.update），
     * 这样本模块不需要知道 DSH 客户端的长相。
     */
    async write({ update, mode }) {
      await update({ ns: namespace, patch: { mode } });
    },
  };
}

/**
 * 组合两个后端。
 *
 * 读：远端优先（它是「权威」），拿不到回退本地。
 * 写：本地必做，远端 best-effort —— 结果交给调用方判定（升级时远端失败要中止，
 * 降级时远端失败仍然算成功，因为紧急关闭不能被 DSH 挂掉拖住）。
 */
export function createModeStore({ local, remote = null, log = () => {} }) {
  if (!local) throw new Error('createModeStore: local 后端必填');
  return {
    /** 本地文件路径（诊断/日志用）。 */
    get file() { return local.file; },
    /** 当前生效的远端后端 id；没有远端时返回 null（调用方据此决定日志措辞）。 */
    get remoteId() { return remote?.id ?? null; },

    readLocal() {
      return local.read();
    },

    writeLocal(patch) {
      return local.write(patch);
    },

    /** @returns {{mode: string, ownerQQ: unknown}|null} */
    readRemote(snapshot) {
      if (!remote) return null;
      try {
        return remote.read(snapshot);
      } catch (error) {
        log(`读取 ${remote.id} 模式失败（按本地文件兜底）：${error?.message ?? error}`);
        return null;
      }
    },

    /**
     * @param {{mode: string, update: (payload: {ns: string, patch: {mode: string}}) => Promise<unknown>}} options
     * @returns {Promise<{synced: boolean, skipped?: boolean, error?: unknown}>}
     *   skipped=true 表示没有远端后端（不是失败）；synced=false 且无 skipped 才是真的写失败。
     */
    async writeRemote({ mode, update }) {
      if (!remote) return { synced: false, skipped: true };
      try {
        await remote.write({ update, mode });
        return { synced: true };
      } catch (error) {
        return { synced: false, error };
      }
    },
  };
}
