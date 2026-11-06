import { api } from '../../js/api.js';
import { onPageRefresh } from '../../js/router.js';
import { setMsg } from '../../components/message/message.js';

const $ = (id) => document.getElementById(id);

// 数据都是「读一次填表单」：进入本页时拉一次，保存后再拉一次。
export async function refreshWhitelist() {
  try {
    const w = await api('/api/whitelist');
    $('wlGroups').value = (w.allow.groups || []).join(', ');
    $('wlPrivate').value = (w.allow.private || []).join(', ');
    $('ownerQQ').value = w.ownerQQ != null ? String(w.ownerQQ) : '';
    $('dnGroups').value = (w.deny.groups || []).join(', ');
    $('dnPrivate').value = (w.deny.private || []).join(', ');
  } catch {}
}

export function loadSecurity() {
  api('/api/security').then((r) => {
    $('secInterceptNotify').checked = r.security?.interceptNotify !== false;
    // state/ 的 ACL 是否收紧（Windows 上需要管理员权限，未提权时会失败）。
    // 明确警示 + 给出可复制的命令，而不是让用户以为已经安全。
    const warn = $('stateDirWarn');
    if (r.stateDir?.hardened === false) {
      $('stateDirPath').textContent = r.stateDir?.path || 'state/';
      $('stateDirCmd').textContent = r.stateDir?.manualCommand || '';
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
  }).catch(() => {});
}

async function changeConsoleToken(generate) {
  const input = $('consoleTokenInput');
  const msg = $('consoleTokenMsg');
  const token = generate ? '' : input.value.trim();
  if (!generate && token && token.length < 16) {
    setMsg(msg, '❌ 令牌至少需要 16 位', 'err');
    return;
  }
  const r = await api('/api/console/token', 'POST', { token });
  if (!r.ok) {
    setMsg(msg, '❌ ' + (r.error || '修改失败'), 'err');
    return;
  }
  // 保存到 localStorage，当前页面继续使用新令牌
  localStorage.setItem('consoleToken', r.token);
  input.value = r.token;
  setMsg(msg, r.generated ? '已生成随机令牌，当前页面已自动使用。可点击显示后复制。' : '已保存新令牌', 'ok');
}

export function init() {
  $('wlSave').addEventListener('click', async () => {
    const parse = (s) => s.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean).map(Number).filter(Number.isFinite);
    const r = await api('/api/whitelist', 'POST', {
      allow: { private: parse($('wlPrivate').value), groups: parse($('wlGroups').value) },
      deny: { private: parse($('dnPrivate').value), groups: parse($('dnGroups').value) },
      ownerQQ: $('ownerQQ').value.trim(),
    });
    if (r.ok) { refreshWhitelist(); alert('白名单已保存并生效'); }
    else alert(r.error || '保存失败');
  });

  $('secSave').addEventListener('click', async () => {
    const r = await api('/api/security', 'POST', { interceptNotify: $('secInterceptNotify').checked });
    const msg = $('secMsg');
    msg.textContent = r.ok ? '✅ 已保存' : ('❌ ' + (r.error || '失败'));
    msg.className = r.ok ? 'meta ok' : 'meta err';
    if (r.ok) loadSecurity();
  });

  $('stateDirReharden').addEventListener('click', async () => {
    const msg = $('stateDirMsg');
    msg.textContent = '检测中…';
    const r = await api('/api/security', 'POST', { rehardenStateDir: true });
    msg.textContent = r.hardened === true ? '✅ 权限已收紧' : '❌ 仍未收紧（改 ACL 需要管理员权限；请按上面两种做法之一操作后复检）';
    msg.className = r.hardened === true ? 'meta ok' : 'meta err';
    loadSecurity();
  });

  $('consoleTokenSave').addEventListener('click', () => changeConsoleToken(false));
  $('consoleTokenRandom').addEventListener('click', () => changeConsoleToken(true));

  // 「显示令牌」按钮：挂在输入框后面，避免在输入框里直接显示明文。
  const toggle = document.createElement('button');
  toggle.id = 'consoleTokenToggle';
  toggle.className = 'small';
  toggle.type = 'button';
  toggle.textContent = '显示令牌';
  toggle.setAttribute('aria-pressed', 'false');
  toggle.addEventListener('click', () => {
    const input = $('consoleTokenInput');
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    toggle.textContent = visible ? '隐藏令牌' : '显示令牌';
    toggle.setAttribute('aria-pressed', String(visible));
  });
  $('consoleTokenInput').after(toggle);

  refreshWhitelist().catch(() => {});
  loadSecurity();
  // 重新进入本页时再读一次安全状态（state/ 权限可能刚被外部命令修好）。
  onPageRefresh('access', () => loadSecurity());
}
