// 终端/日志块组件：控制台（MCP 日志、插件日志）与控制中心共用一套外观。
// 纯展示组件，不轮询、不排序——数据由调用方给；DOM 结构尽量扁，长日志也能扛。
// 类名同时接受简写（.l/.t/.tag，控制中心在用）与语义名（.terminal-line/…），见 terminal.css。
import { esc } from '../../js/ui.js';

const TONES = new Set(['err', 'error', 'warn', 'system', 'cmd', 'ok']);

/**
 * 终端容器。调用方拿到元素后自己填内容，或用 renderTerminalLines()。
 * @param {{id?:string, height?:number|string, label?:string, placeholder?:string}} [options]
 */
export function terminalHtml({ id = '', height = 320, label = '日志输出', placeholder = '' } = {}) {
  const style = height ? ` data-height="${Number(height) || ''}"` : '';
  return `<div class="terminal"${id ? ` id="${esc(id)}"` : ''}${style} role="log" aria-label="${esc(label)}" tabindex="0">`
    + (placeholder ? `<span class="terminal-empty">${esc(placeholder)}</span>` : '')
    + '</div>';
}

/**
 * 一行 HTML。line 可以是字符串，或 {time, tag, text, tone}。
 * @param {string|{time?:string, tag?:string, text:string, tone?:string}} line
 */
export function terminalLineHtml(line) {
  if (typeof line === 'string' || typeof line === 'number') {
    return `<span class="terminal-line"><span class="terminal-text">${esc(String(line))}</span></span>`;
  }
  const tone = TONES.has(line.tone) ? ` ${line.tone}` : '';
  const time = line.time ? `<span class="terminal-time">${esc(line.time)}</span>` : '';
  const tag = line.tag ? `<span class="terminal-tag">${esc(line.tag)}</span>` : '';
  return `<span class="terminal-line${tone}">${time}${tag}<span class="terminal-text">${esc(line.text ?? '')}</span></span>`;
}

/**
 * 用行数组重填终端；空数组时显示 placeholder。
 * @param {HTMLElement|null} root
 * @param {Array<string|{time?:string,tag?:string,text:string,tone?:string}>} lines
 * @param {{placeholder?:string, scroll?:boolean}} [options]
 */
export function renderTerminalLines(root, lines = [], { placeholder = '', scroll = true } = {}) {
  if (!root) return;
  const list = Array.isArray(lines) ? lines : [];
  root.innerHTML = list.length
    ? list.map(terminalLineHtml).join('')
    : `<span class="terminal-empty">${esc(placeholder)}</span>`;
  if (scroll) root.scrollTop = root.scrollHeight;
}

/** 纯文本 → 行数组（多行日志直接喂给 renderTerminalLines）。 */
export function textToLines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n').filter((line, index, all) => line !== '' || index < all.length - 1);
}

/** 追加一行，并滚到底部（轮询式日志用）。 */
export function appendTerminalLine(root, line) {
  if (!root) return;
  const empty = root.querySelector('.terminal-empty');
  if (empty) empty.remove();
  root.insertAdjacentHTML('beforeend', terminalLineHtml(line));
  root.scrollTop = root.scrollHeight;
}
