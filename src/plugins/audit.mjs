// 插件审计落盘（docs/PLUGIN_KERNEL.md §10）。
//
// 用同步追加而不是流：审计只在 activate / 出错 / 超时 / 停用时写，量很小；
// 同步能保证顺序确定，也不会在进程退出时丢最后几行。
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {object} options
 * @param {string} options.file      审计文件路径
 * @param {number} options.maxBytes  单文件上限
 * @param {number} options.keep      轮转保留份数
 * @param {boolean} options.enabled  false 时只写日志
 * @param {(message: string) => void} [options.log]
 */
export function createAuditLog({ file, maxBytes, keep, enabled, log }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    // 文件还不存在：size 保持 0
  }

  function rotate() {
    try {
      for (let index = keep; index >= 1; index -= 1) {
        const source = index === 1 ? file : `${file}.${index - 1}`;
        const target = `${file}.${index}`;
        if (!fs.existsSync(source)) continue;
        if (fs.existsSync(target)) fs.rmSync(target, { force: true });
        fs.renameSync(source, target);
      }
    } catch (error) {
      log?.(`[plugin-audit] 轮转失败: ${error?.message ?? error}`);
    }
    size = 0;
  }

  function append(event, fields = {}) {
    if (!enabled) return;
    const line = `${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`;
    const bytes = Buffer.byteLength(line, 'utf8');
    try {
      if (size + bytes > maxBytes) rotate();
      fs.appendFileSync(file, line);
      size += bytes;
    } catch (error) {
      log?.(`[plugin-audit] 写入失败: ${error?.message ?? error}`);
    }
  }

  return {
    append,
    file,
    get size() {
      return size;
    },
  };
}
