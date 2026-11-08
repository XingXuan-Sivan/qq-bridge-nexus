import { api } from '../../js/api.js';
import { onPageRefresh } from '../../js/router.js';
import { setMsg } from '../../components/message/message.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { ACCESS_FIELDS } from './fields.js';

const $ = (id) => document.getElementById(id);

// 静态控件按字段规格渲染：页面只留卡片与宿主，渲染之后再取 id。
function renderAccessFieldGroups() {
  document.querySelectorAll('[data-access-fields]').forEach((host) => {
    const spec = ACCESS_FIELDS[host.dataset.accessFields];
    if (spec) renderFields(host, spec.fields, { columns: 2 });
  });
}

// 白名单 / 黑名单现在按会话存在档案里，这里不再编辑；保存管理员时把现值原样带回。
let adminsDraft = [];
const ADMIN_CAPS = [['approve', '审批'], ['sessions', '会话'], ['scheduler', '定时任务'], ['memory', '记忆']];

function adminCell(row, text) {
  const td = document.createElement('td');
  if (text != null) td.textContent = text;
  row.appendChild(td);
  return td;
}

function renderAdminRows() {
  const tbody = $('adminRows');
  if (!tbody) return;
  tbody.textContent = '';
  if (!adminsDraft.length) {
    const tr = document.createElement('tr');
    const td = adminCell(tr, '还没有管理员。点「添加管理员」新增。');
    td.colSpan = 7;
    tbody.appendChild(tr);
    return;
  }
  adminsDraft.forEach((admin, index) => {
    const tr = document.createElement('tr');
    const qq = document.createElement('input');
    qq.type = 'text';
    qq.value = admin.qq ?? '';
    qq.placeholder = 'QQ 号';
    qq.dataset.adminField = 'qq';
    qq.dataset.adminIndex = String(index);
    adminCell(tr).appendChild(qq);
    const name = document.createElement('input');
    name.type = 'text';
    name.value = admin.name ?? '';
    name.placeholder = '可留空';
    name.dataset.adminField = 'name';
    name.dataset.adminIndex = String(index);
    adminCell(tr).appendChild(name);
    const caps = adminCell(tr);
    for (const [value, label] of ADMIN_CAPS) {
      const wrap = document.createElement('label');
      wrap.className = 'field-check-item';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = value;
      box.checked = (admin.caps ?? []).includes(value);
      box.dataset.adminField = 'caps';
      box.dataset.adminIndex = String(index);
      wrap.appendChild(box);
      wrap.append(` ${label}`);
      caps.appendChild(wrap);
    }
    const level = document.createElement('select');
    level.dataset.adminField = 'maxLevel';
    level.dataset.adminIndex = String(index);
    for (const value of ['L1', 'L2', 'L3']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = (admin.maxLevel ?? 'L2') === value;
      level.appendChild(option);
    }
    adminCell(tr).appendChild(level);
    for (const field of ['notify', 'exemptPassive']) {
      const cell = adminCell(tr);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = admin[field] !== false;
      box.dataset.adminField = field;
      box.dataset.adminIndex = String(index);
      cell.appendChild(box);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn small danger';
    remove.textContent = '移除';
    remove.dataset.adminRemove = String(index);
    adminCell(tr).appendChild(remove);
    tbody.appendChild(tr);
  });
}

function readAdminsFromDom() {
  return adminsDraft.map((admin, index) => {
    const rows = [...document.querySelectorAll('[data-admin-index]')];
    const valueOf = (field) => rows.find((el) => el.dataset.adminField === field && Number(el.dataset.adminIndex) === index);
    const caps = rows.filter((el) => el.dataset.adminField === 'caps' && Number(el.dataset.adminIndex) === index && el.checked).map((el) => el.value);
    return {
      ...admin,
      qq: String(valueOf('qq')?.value ?? '').trim(),
      name: String(valueOf('name')?.value ?? '').trim(),
      caps,
      maxLevel: String(valueOf('maxLevel')?.value ?? 'L2'),
      notify: valueOf('notify')?.checked !== false,
      exemptPassive: valueOf('exemptPassive')?.checked !== false,
    };
  });
}

export async function refreshWhitelist() {
  try {
    const w = await api('/api/whitelist');
    $('ownerQQ').value = w.ownerQQ != null ? String(w.ownerQQ) : '';
    adminsDraft = Array.isArray(w.admins) ? w.admins : [];
    renderAdminRows();
  } catch {}
}

export function loadSecurity() {
  api('/api/security').then((r) => {
    setSwitch($('secInterceptNotify'), r.security?.interceptNotify !== false);
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
  // 先渲染字段规格，下面所有 $('…') 才取得到节点；开关的点击委托也要在这个范围内显式绑。
  renderAccessFieldGroups();
  bindSwitches(document.getElementById('section-access'));
  $('wlSave').addEventListener('click', async () => {
    const r = await api('/api/whitelist', 'POST', {
      ownerQQ: $('ownerQQ').value.trim(),
      admins: readAdminsFromDom(),
    });
    if (r.ok) { refreshWhitelist(); alert('管理员已保存并生效'); }
    else alert(r.error || '保存失败');
  });
  $('adminAdd').addEventListener('click', () => {
    adminsDraft = readAdminsFromDom();
    adminsDraft.push({ qq: '', name: '', caps: [], maxLevel: 'L2', notify: true, exemptPassive: true });
    renderAdminRows();
  });
  $('adminRows').addEventListener('click', (event) => {
    const button = event.target.closest('[data-admin-remove]');
    if (!button) return;
    adminsDraft = readAdminsFromDom();
    adminsDraft.splice(Number(button.dataset.adminRemove), 1);
    renderAdminRows();
  });

  $('secSave').addEventListener('click', async () => {
    const r = await api('/api/security', 'POST', { interceptNotify: getSwitch($('secInterceptNotify')) });
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
  toggle.className = 'btn small';
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
