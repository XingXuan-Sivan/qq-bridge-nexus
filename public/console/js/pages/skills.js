// 技能页：只读列出 DSH_HOME/skills 与仓库 skills/ 下的 SKILL.md。
// 启停与安装由 DSH 自己管，这里不提供写操作。
import { api } from '../api.js';
import { esc, simpleTable } from '../ui.js';
import { getCurrentPage, onPageRefresh } from '../router.js';

async function refreshSkills() {
  const meta = document.getElementById('skillsMeta');
  const list = document.getElementById('skillsList');
  try {
    const data = await api('/api/extensions');
    const skills = data.skills ?? [];
    meta.textContent = skills.length ? `共 ${skills.length} 个技能包` : '没有找到 SKILL.md（DSH_HOME/skills 或仓库 skills/ 下）';
    list.innerHTML = skills.length
      ? `<div class="tool-log-table">${simpleTable([{ label: '技能', width: '200px' }, { label: '说明' }, { label: '路径', width: '340px' }],
        skills.map(skill => [`<strong>${esc(skill.name)}</strong>`, esc(skill.description || '（没有 description）'), `<code>${esc(skill.path)}</code>`]))}</div>`
      : '<div class="meta">把技能包放到 DSH 的 skills 目录，或仓库 skills/ 下，刷新即可看到。</div>';
  } catch (error) {
    meta.textContent = `读取失败：${error.message}`;
  }
}

export function initSkillsPage() {
  document.getElementById('skillsRefresh')?.addEventListener('click', () => { refreshSkills().catch(() => {}); });
  onPageRefresh('skills', () => { refreshSkills().catch(() => {}); });
  setInterval(() => { if (getCurrentPage() === 'skills' && !document.hidden) refreshSkills().catch(() => {}); }, 30_000);
  refreshSkills().catch(() => {});
}
