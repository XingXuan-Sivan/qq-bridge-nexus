import { api } from '../../js/api.js';
import { onPageRefresh } from '../../js/router.js';
import { setMsg } from '../../components/message/message.js';
import { bindSwitches, getSwitch, renderFields, setSwitch } from '../../components/form/form.js';
import { modalHtml, openModal, closeModal, wireModal } from '../../components/modal/modal.js';
import { ACCESS_FIELDS } from './access-fields.js';

const $ = (id) => document.getElementById(id);

// 静态控件按字段规格渲染：页面只留卡片与宿主，渲染之后再取 id。
function renderAccessFieldGroups() {
  document.querySelectorAll('[data-access-fields]').forEach((host) => {
    const spec = ACCESS_FIELDS[host.dataset.accessFields];
    if (spec) renderFields(host, spec.fields, { columns: 1 });
  });
}

// 白名单 / 黑名单现在按会话存在档案里，这里不再编辑；保存管理员时把现值原样带回。
let adminsDraft = [];
const ADMIN_CAPS = [['approve', '审批'], ['sessions', '会话'], ['scheduler', '定时任务'], ['memory', '记忆']];

/** 权限格只放一行摘要：权限项以后还会增加，逐项摆复选会把整行撑高，所以编辑收进弹窗。 */
function capsSummary(caps) {
  const labels = ADMIN_CAPS.filter(([value]) => (caps ?? []).includes(value)).map(([, label]) => label);
  return labels.length ? labels.join(' · ') : '未设置';
}

let capsEditor = null;
let capsEditIndex = -1;

function ensureCapsEditor() {
  if (capsEditor) return capsEditor;
  const host = document.createElement('div');
  host.innerHTML = modalHtml({
    id: 'adminCapsModal',
    title: '编辑管理员权限',
    body: '<div class="form-stack" id="adminCapsBody"></div>'
      + '<div class="meta u-mt-8">权限决定该管理员在自己的私聊里能做什么；点「应用」后还要保存管理员才会写进 config.json。</div>',
    footer: '<button class="btn" type="button" data-modal-close>取消</button>'
      + '<button class="btn primary" type="button" id="adminCapsApply">应用</button>',
  });
  capsEditor = host.firstElementChild;
  document.body.appendChild(capsEditor);
  wireModal(capsEditor);
  capsEditor.querySelector('#adminCapsApply')?.addEventListener('click', () => {
    const admin = adminsDraft[capsEditIndex];
    if (admin) {
      admin.caps = [...capsEditor.querySelectorAll('#adminCapsBody input[type="checkbox"]:checked')].map((el) => el.value);
      renderAdminRows();
    }
    closeModal(capsEditor);
  });
  return capsEditor;
}

function openCapsEditor(index) {
  const admin = adminsDraft[index];
  if (!admin) return;
  capsEditIndex = index;
  const overlay = ensureCapsEditor();
  const chosen = new Set(Array.isArray(admin.caps) ? admin.caps : []);
  const body = overlay.querySelector('#adminCapsBody');
  body.innerHTML = ADMIN_CAPS.map(([value, label]) => `<label class="field-check-item">`
    + `<input type="checkbox" value="${value}"${chosen.has(value) ? ' checked' : ''}> ${label}</label>`).join('');
  openModal(overlay);
}

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
    const capsBtn = document.createElement('button');
    capsBtn.type = 'button';
    capsBtn.className = 'btn small';
    capsBtn.textContent = capsSummary(admin.caps);
    capsBtn.title = '编辑权限';
    capsBtn.dataset.adminCaps = String(index);
    caps.appendChild(capsBtn);
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
    return {
      ...admin,
      qq: String(valueOf('qq')?.value ?? '').trim(),
      name: String(valueOf('name')?.value ?? '').trim(),
      // 权限在弹窗里改，直接取草稿；不再从 DOM 里数复选。
      caps: Array.isArray(admin.caps) ? [...admin.caps] : [],
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
  return api('/api/security').then((r) => {
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

// ── 页面级保存分区 ────────────────────────────────────────────────────────
// 安全开关与令牌是「一改就该立刻落盘」的整页配置，注册进 save-bar 后不再各带按钮；
// 令牌放在最后保存：它换掉的是后续请求要用的凭据，改完必须让当前页先切过去。
export const securitySection = {
  id: 'security',
  label: '安全拦截',
  read: () => ({ interceptNotify: getSwitch($('secInterceptNotify')) }),
  save: async (value) => {
    const r = await api('/api/security', 'POST', { interceptNotify: !!value?.interceptNotify });
    if (!r.ok) return { ok: false, message: r.error || '保存失败' };
    await loadSecurity();
    return { ok: true, message: '已保存，立即生效' };
  },
};

export const tokenSection = {
  id: 'consoleToken',
  label: '控制台令牌',
  read: () => ({ token: String($('consoleTokenInput')?.value ?? '').trim() }),
  save: async (value) => {
    const token = String(value?.token ?? '').trim();
    if (token && token.length < 16) return { ok: false, message: '令牌至少需要 16 位' };
    const r = await api('/api/console/token', 'POST', { token });
    if (!r.ok) return { ok: false, message: r.error || '修改失败' };
    localStorage.setItem('consoleToken', r.token);
    $('consoleTokenInput').value = r.token;
    setMsg($('consoleTokenMsg'), r.generated ? '已生成随机令牌，当前页面已自动使用' : '已保存新令牌，当前页面已自动使用', 'ok');
    return { ok: true, message: r.generated ? '已生成随机令牌，当前页已切换' : '已保存，当前页已切换' };
  },
};

export function init() {
  // 先渲染字段规格，下面所有 $('…') 才取得到节点；开关的点击委托也要在这个范围内显式绑。
  renderAccessFieldGroups();
  bindSwitches(document.getElementById('section-config'));
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
    const capsButton = event.target.closest('[data-admin-caps]');
    if (capsButton) {
      adminsDraft = readAdminsFromDom();
      openCapsEditor(Number(capsButton.dataset.adminCaps));
      return;
    }
    const button = event.target.closest('[data-admin-remove]');
    if (!button) return;
    adminsDraft = readAdminsFromDom();
    adminsDraft.splice(Number(button.dataset.adminRemove), 1);
    renderAdminRows();
  });

  $('stateDirReharden').addEventListener('click', async () => {
    const msg = $('stateDirMsg');
    msg.textContent = '检测中…';
    const r = await api('/api/security', 'POST', { rehardenStateDir: true });
    msg.textContent = r.hardened === true ? '✅ 权限已收紧' : '❌ 仍未收紧（改 ACL 需要管理员权限；请按上面两种做法之一操作后复检）';
    msg.className = r.hardened === true ? 'meta ok' : 'meta err';
    loadSecurity();
  });

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
  onPageRefresh('config', () => loadSecurity());
}
