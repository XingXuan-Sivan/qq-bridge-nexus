(() => {
  // ── 令牌：从地址片段 #t=… 取得（片段不会发给服务器），存进 sessionStorage 后从地址栏抹掉 ──
  //    界面偏好（选中的标签/实例）放 localStorage；令牌与凭据绝不放 localStorage。
  const m = /[#&]t=([a-f0-9]{48})/.exec(location.hash);
  if (m) { sessionStorage.setItem('ccToken', m[1]); history.replaceState(null, '', location.pathname); }
  let token = sessionStorage.getItem('ccToken') || '';
  const $ = (id) => document.getElementById(id);
  const pref = {
    get: (k, d) => { try { return localStorage.getItem(`cc.${k}`) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(`cc.${k}`, v); } catch {} },
  };
  let authFailed = false;
  function showTokenBox(reason) {
    authFailed = true;
    if ($('tokenBox')) return;
    const box = document.createElement('div');
    box.className = 'banner bad';
    box.id = 'tokenBox';
    box.append(`${reason}打开项目目录里的 state 文件夹，复制 control-center-token 文件的内容粘贴到这里（或重新双击 control-center.bat，它会带着令牌打开页面）。 `);
    const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = '粘贴令牌'; inp.className = 'token-input';
    const btn = document.createElement('button'); btn.className = 'primary'; btn.textContent = '确定';
    btn.onclick = () => { const v = inp.value.trim(); if (v) { sessionStorage.setItem('ccToken', v); location.reload(); } };
    box.append(inp, ' ', btn);
    $('banners').replaceChildren(box);
  }
  if (!token) showTokenBox('需要控制中心令牌：');

  async function api(path, body) {
    if (authFailed) throw new Error('需要控制中心令牌');
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-control-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) { sessionStorage.removeItem('ccToken'); showTokenBox('令牌无效或已更换：'); throw new Error('需要控制中心令牌'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    $('toast').appendChild(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 7000 : 3500);
  }
  function confirmBox(title, text, okText = '确定') {
    return new Promise((resolve) => {
      $('dlgTitle').textContent = title; $('dlgText').textContent = text; $('dlgOk').textContent = okText;
      const dlg = $('confirmDlg');
      const done = (v) => { dlg.close(); $('dlgOk').onclick = null; $('dlgCancel').onclick = null; resolve(v); };
      $('dlgOk').onclick = () => done(true);
      $('dlgCancel').onclick = () => done(false);
      dlg.onclose = () => resolve(false);
      dlg.showModal();
    });
  }
  const fmtDur = (ms) => { if (!ms) return '0 秒'; const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const mi = Math.floor((s % 3600) / 60); return h ? `${h} 小时 ${mi} 分` : mi ? `${mi} 分 ${s % 60} 秒` : `${s} 秒`; };
  const fmtAgo = (t) => { if (!t) return '—'; const s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s} 秒前` : s < 3600 ? `${Math.floor(s / 60)} 分钟前` : new Date(t).toLocaleString(); };
  const setDot = (el, kind) => { el.className = `dot ${kind || ''}`; };
  const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag); Object.assign(e, props); for (const k of kids) e.append(k); return e; };

  // ── 标签切换（只改变显示：不发请求、不建连接、不启停任何模块）──
  const alerts = { bridge: 0, platform: 0 };
  function makeTabs(tabIds, prefKey, onShow) {
    const tabs = tabIds.map((id) => $(id));
    function select(id, { focus = false } = {}) {
      for (const t of tabs) {
        const on = t.id === id;
        const panel = $(t.getAttribute('aria-controls'));
        if (!on && !panel.hidden) panel.dispatchEvent(new CustomEvent('cc-hide'));
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        panel.hidden = !on;
        if (on) { panel.dispatchEvent(new CustomEvent('cc-show')); if (focus) t.focus(); }
      }
      pref.set(prefKey, id);
      onShow?.(id);
    }
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t.id));
      t.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (dir) { e.preventDefault(); select(tabs[(i + dir + tabs.length) % tabs.length].id, { focus: true }); }
        if (e.key === 'Home') { e.preventDefault(); select(tabs[0].id, { focus: true }); }
        if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1].id, { focus: true }); }
      });
    });
    const saved = pref.get(prefKey, tabIds[0]);
    select(tabIds.includes(saved) ? saved : tabIds[0]);
    return { select, current: () => tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.id };
  }

  // ── 日志视图 ──
  // 隐藏时保留滚动位置；未显示的模块出错时只累计提示，不抢占当前页面。
  function makeLog(source, termId, { filterId, errorsId = null, pauseId, levelId = null, scopeId = null, structured = false, onError = null } = {}) {
    const lines = []; let after = 0; let base = 0; let savedScroll = null; let loaded = false;
    const term = $(termId);
    const parse = (l) => {
      if (!structured || l.parsed !== undefined) return l;
      try { const j = l.text.startsWith('{"pl":1') ? JSON.parse(l.text) : null; l.parsed = j; } catch { l.parsed = null; }
      return l;
    };
    const levelOf = (l) => (l.parsed ? l.parsed.level : (l.stream === 'stderr' ? 'error' : 'info'));
    const isError = (l) => (structured ? ['error', 'warn'].includes(levelOf(l)) : (l.stream === 'stderr' || /错误|失败|error|fail|⚠|⛔|🚨/i.test(l.text)));
    const LV = { debug: 10, info: 20, warn: 30, error: 40 };
    const visible = () => term.offsetParent !== null;
    const render = () => {
      if (!visible()) return;
      const q = $(filterId).value.trim().toLowerCase();
      const errs = errorsId ? $(errorsId).checked : false;
      const minLv = levelId ? (LV[$(levelId).value] ?? 0) : 0;
      const scope = scopeId ? $(scopeId).value : '';
      const frag = document.createDocumentFragment();
      const view = lines.filter((l) => {
        if (l.seq <= base || l.cleared) return false;
        if (errs && !isError(l)) return false;
        if (minLv && (LV[levelOf(l)] ?? 20) < minLv) return false;
        if (scope) {
          const p = l.parsed;
          if (!p) return false;
          const [k, v] = scope.split('=');
          if (k === 'scope' ? p.scope !== v : p[k] !== v) return false;
        }
        const txt = l.parsed ? l.parsed.msg : l.text;
        return !q || txt.toLowerCase().includes(q);
      });
      if (!view.length) frag.appendChild(el('span', { className: 'empty', textContent: q || errs || minLv || scope ? '（没有匹配的日志）' : '（暂无输出）' }));
      for (const l of view.slice(-2500)) {
        if (l.kind === 'img') {
          // 页面自己插入的图片条目（目前只有 NapCat 登录二维码）：小图 + 一行说明；过期后变灰
          const row = el('span', { className: `l img${l.expired ? ' expired' : ''}` });
          row.appendChild(el('span', { className: 't', textContent: new Date(l.time).toLocaleTimeString() }));
          row.appendChild(el('span', { className: 'tag', textContent: '[控制中心]' }));
          row.appendChild(document.createTextNode(l.expired ? `${l.text}（${l.expired}）` : l.text));
          row.appendChild(el('img', { src: l.src, alt: l.text, width: 132, height: 132 }));
          frag.appendChild(row);
          continue;
        }
        const p = l.parsed;
        const row = el('span', { className: `l ${p ? p.level : l.stream}${l.text.startsWith('> ') ? ' cmd' : ''}` });
        row.appendChild(el('span', { className: 't', textContent: new Date(p?.time ?? l.time).toLocaleTimeString() }));
        if (p) row.appendChild(el('span', { className: 'tag', textContent: `[${p.instance ?? p.scope}${p.account ? ` ${p.account}` : ''}]` }));
        row.appendChild(document.createTextNode(p ? p.msg : l.text));
        frag.appendChild(row);
      }
      term.replaceChildren(frag);
      if (!$(pauseId).checked) term.scrollTop = term.scrollHeight;
    };
    async function poll() {
      if (authFailed) return;
      try {
        const r = await api(`/api/logs?source=${source}&after=${after}`);
        if (r.lines.length) {
          const fresh = r.lines.map(parse);
          lines.push(...fresh);
          if (lines.length > 4000) lines.splice(0, lines.length - 4000);
          after = r.lastSeq;
          // 首次拉取的是历史日志，不算「新异常」
          if (onError && loaded) { const n = fresh.filter(isError).length; if (n) onError(n, fresh); }
          render();
        }
        loaded = true;
      } catch {}
    }
    for (const id of [filterId, errorsId, levelId, scopeId].filter(Boolean)) $(id).addEventListener('input', render);
    return {
      poll, render, lines,
      saveScroll() { savedScroll = term.scrollTop; },
      restoreScroll() { render(); if ($(pauseId).checked && savedScroll !== null) term.scrollTop = savedScroll; },
      clear() { base = after; for (const l of lines) if (l.kind === 'img') l.cleared = true; render(); },
      // 插入一条图片条目：排在当前最后一行之后（seq 取半格，「清屏」照常生效）；最多保留 5 张
      addImage({ key, src, text }) {
        if (lines.some((l) => l.kind === 'img' && l.key === key)) return;
        lines.push({ kind: 'img', key, src, text, seq: after + 0.5, time: Date.now(), stream: 'stdout', expired: null });
        const imgs = lines.filter((l) => l.kind === 'img');
        for (const old of imgs.slice(0, Math.max(0, imgs.length - 5))) lines.splice(lines.indexOf(old), 1);
        render();
      },
      // 把图片条目标成过期（除了 keepKey 那张）
      expireImages(reason, keepKey = null) {
        let changed = false;
        for (const l of lines) if (l.kind === 'img' && l.key !== keepKey && !l.expired) { l.expired = reason; changed = true; }
        if (changed) render();
      },
      download() {
        const blob = new Blob([lines.map((l) => (l.kind === 'img' ? `[${new Date(l.time).toISOString()}] [控制中心] ${l.text}${l.expired ? `（${l.expired}）` : ''}（图片不写入日志文件）` : l.parsed ? `[${new Date(l.parsed.time).toISOString()}] ${l.parsed.level.toUpperCase()} [${l.parsed.instance ?? l.parsed.scope}${l.parsed.account ? ` ${l.parsed.account}` : ''}] ${l.parsed.msg}` : `[${new Date(l.time).toISOString()}] ${l.stream === 'stderr' ? 'ERR ' : ''}${l.text}`)).join('\n')], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${source}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`; a.click(); URL.revokeObjectURL(a.href);
      },
    };
  }

  let mainTabs = null;
  let platformTabs = null;
  const tabVisible = (panelId) => !$(panelId).hidden;
  function bump(tab, n) {
    if (tab === 'bridge' && tabVisible('panel-bridge')) return;
    if (tab === 'platform' && tabVisible('panel-platform')) return;
    alerts[tab] += n;
    renderAlerts();
  }
  let plLogUnseen = 0;
  function renderAlerts() {
    $('tabBridgeAlert').hidden = !alerts.bridge; $('tabBridgeAlert').textContent = `⚠ ${alerts.bridge}`;
    $('tabPlatformAlert').hidden = !alerts.platform; $('tabPlatformAlert').textContent = `⚠ ${alerts.platform}`;
    $('plLogAlert').hidden = !plLogUnseen; $('plLogAlert').textContent = String(plLogUnseen);
  }

  const bridgeLog = makeLog('bridge', 'bridgeTerm', { filterId: 'bridgeFilter', errorsId: 'bridgeErrors', pauseId: 'bridgePause', onError: (n) => bump('bridge', n) });
  const snowLog = makeLog('snowluma', 'snowTerm', { filterId: 'snowFilter', errorsId: 'snowErrors', pauseId: 'snowPause', onError: (n) => bump('platform', n) });
  const napLog = makeLog('napcat', 'napTerm', { filterId: 'napFilter', errorsId: 'napErrors', pauseId: 'napPause' });
  $('napClear').onclick = () => napLog.clear();
  $('napDownload').onclick = () => napLog.download();
  const plLog = makeLog('platform', 'plTerm', { filterId: 'plFilter', pauseId: 'plPause', levelId: 'plLevel', scopeId: 'plScope', structured: true, onError: (n, fresh) => {
    const errs = fresh.filter((l) => l.parsed?.level === 'error' || l.stream === 'stderr').length;
    if (!errs) return;
    bump('platform', errs);
    if (!tabVisible('pview-logs')) { plLogUnseen += errs; renderAlerts(); }
  } });
  $('bridgeClear').onclick = () => bridgeLog.clear();
  $('snowClear').onclick = () => snowLog.clear();
  $('plClear').onclick = () => plLog.clear();
  $('bridgeDownload').onclick = () => bridgeLog.download();
  $('snowDownload').onclick = () => snowLog.download();
  $('plDownload').onclick = () => plLog.download();
  for (const [panel, logs] of [['panel-bridge', [bridgeLog]], ['panel-platform', [snowLog, plLog]], ['pview-logs', [plLog]], ['pview-instances', [snowLog, napLog]]]) {
    $(panel).addEventListener('cc-hide', () => logs.forEach((l) => l.saveScroll()));
    $(panel).addEventListener('cc-show', () => requestAnimationFrame(() => logs.forEach((l) => l.restoreScroll())));
  }
  mainTabs = makeTabs(['tab-bridge', 'tab-platform', 'tab-services'], 'tab', (id) => {
    const key = { 'tab-bridge': 'bridge', 'tab-platform': 'platform' }[id];
    if (key) { alerts[key] = 0; renderAlerts(); }
    if (id === 'tab-services') { void refreshServiceLogs(); }
  });
  platformTabs = makeTabs(['ptab-overview', 'ptab-instances', 'ptab-accounts', 'ptab-logs', 'ptab-settings'], 'ptab', (id) => { if (id === 'ptab-logs') { plLogUnseen = 0; renderAlerts(); } });

  // ── 状态 ──
  let S = null;
  let selectedInst = pref.get('inst', '');
  let renderedInst = null;
  const reasonText = {
    connecting: '连接中', reconnecting: '重连中', connect_failed: '连不上上游', connect_failed_no_token: '连不上上游（没有令牌，也没有目录可发现）',
    disconnected_by_user: '已手动断开', awaiting_login: '等待登录 / 账号离线', receive_unhealthy: '接收异常', receive_stale: '上游心跳超时',
    awaiting_heartbeat: '等待首个心跳', identifying: '识别账号中', no_route: '没有承接的实例', upstream_closed: '上游已断开',
  };
  const rt = (r) => (r ? (reasonText[r] ?? r) : '正常');

  async function refresh() {
    if (authFailed) return;
    try { S = await api('/api/state'); } catch { return; }
    renderBridge();
    renderPlatform();
    renderSnow();
    renderNapcat();
    renderBackends();
    renderServices();
    renderFooter();
    if (tabVisible('panel-services')) void refreshServiceLogs();
  }

  function renderBridge() {
    const b = S.bridge; const h = S.health; const st = h.bridgeApi; const sl = S.snowluma; const pl = S.platform;
    $('verBadge').textContent = `v${S.version}`;
    const banners = [];
    if (!h.config.valid) banners.push({ bad: h.config.exists, text: h.config.error });
    if (h.bridgeExternal) banners.push({ bad: false, text: '检测到桥接已经在别处运行（例如你双击了 start.bat）。控制中心不会接管它；要在这里管理，请先关掉那个窗口再点「启动桥接」。' });
    if (sl.info?.ok && !sl.running && h.snowlumaPort) banners.push({ bad: false, text: `SnowLuma 的 WebUI 端口 ${sl.info.webui.port} 正在被使用：SnowLuma 可能已经在别处运行（不是由控制中心启动的，这里无法停止它）。` });
    if (pl.external) banners.push({ bad: false, text: `接口平台已经在别处运行（端口 ${pl.port}），不是由控制中心启动的，这里不会接管它的进程。${pl.overviewError ? `控制中心无法管理它：${pl.overviewError}。要在这里管理，启动它时把环境变量 INTERFACE_PLATFORM_ADMIN_TOKEN 设为桥接 state\\platform-admin-token 的内容，或改由控制中心启动。` : ''}` });
    if (!pl.installed && !pl.running) banners.push({ bad: false, text: `找不到接口平台（${pl.dir}）。它应放在桥接目录的同级 interface-platform/；也可以在 state/control-center.json 里设 "platformDir"。` });
    if (pl.link.viaPlatform && !pl.reachable) banners.push({ bad: true, text: '桥接已设为经接口平台连接，但接口平台没有运行：机器人收不到也发不出消息。请启动接口平台，或在「接口平台 → 设置」恢复直连。' });
    if (st?.level && st.level !== 'L0') banners.push({ bad: true, text: `当前处于 ${st.level} 高权限（运维 Agent）。不用时请点「紧急关闭」，或在 QQ 私聊发 /panic。` });
    if (!$('tokenBox')) $('banners').replaceChildren(...banners.map((x) => el('div', { className: `banner ${x.bad ? 'bad' : ''}`, textContent: x.text })));
    const bRun = b.running;
    setDot($('bridgeDot'), bRun ? (st ? 'on' : 'warn') : (h.bridgeExternal ? 'warn' : ''));
    const bText = bRun ? `运行中 · PID ${b.pid} · ${fmtDur(b.uptimeMs)}${b.restarts ? ` · 已自动重启 ${b.restarts} 次` : ''}` : (b.restartPending ? '等待自动重启…' : (h.bridgeExternal ? '外部运行中' : (b.lastExit ? `已停止（退出码 ${b.lastExit.code ?? '—'}）` : '未启动')));
    $('bridgeState').textContent = bText;
    $('bridgeRoute').textContent = pl.link.viaPlatform ? '路径：经接口平台' : '路径：直连 SnowLuma';
    $('bridgeStart').disabled = bRun || h.bridgeExternal;
    $('bridgeStop').disabled = !bRun && !b.restartPending;
    $('bridgeRestart').disabled = !bRun;
    $('bridgeAuto').checked = !!b.autoRestart;
    setDot($('tabBridgeDot'), bRun ? (st ? 'on' : 'warn') : (h.bridgeExternal ? 'warn' : 'off'));
    $('tabBridgeSt').textContent = bRun ? (st ? '运行中' : '启动中') : (h.bridgeExternal ? '外部运行' : '未运行');
    const level = st?.level || 'L0';
    $('modeBadge').textContent = st ? `模式 ${st.mode} · ${level}` : '模式 —（桥接未运行）';
    $('modeBadge').className = `badge level-${st ? level : ''}`;
    $('pendingBadge').textContent = `待审批 ${st?.pendingApprovals ?? 0} · 待确认 ${st?.adminPendingRequests ?? 0}`;
    $('panicBtn').disabled = !st;
    $('consoleManual').href = `http://127.0.0.1:${h.consolePort || 3100}/?manual=1`;
  }

  // 平台没运行时，控制中心读不到平台的实例（它不读平台的文件），只列出本机 SnowLuma 程序，保证仍能亲手启停 SnowLuma
  const LOCAL_SNOW = { id: '本机 SnowLuma 程序', provider: 'snowluma', providerName: 'SnowLuma（本机程序）', management: 'hosted', local: true, upstream: {}, links: [] };
  const LOCAL_NAP = { id: '本机 NapCat 程序', provider: 'napcat', providerName: 'NapCat（本机程序）', management: 'hosted', local: true, upstream: {}, links: [] };
  // SnowLuma 有 Windows 与 Linux 版（2.0 起正式支持 Linux）：macOS 不列本机 SnowLuma 占位项。
  const SNOW_OS = ['win32', 'linux'];
  // NapCat 程序区要始终找得到：平台没运行、或平台里还没有 NapCat 实例时，列一个「本机 NapCat 程序」占位项。
  function instancesOf(pl) {
    const list = [...(pl.overview?.instances ?? (SNOW_OS.includes(S?.os) ? [LOCAL_SNOW] : []))];
    if ((S?.os === 'darwin' || S?.napcat?.info?.ok || S?.napcat?.running) && !list.some((i) => i.provider === 'napcat')) list.push(LOCAL_NAP);
    return list;
  }
  // 从任何地方跳到 NapCat 程序区（接口平台 → 接入实例 → NapCat 实例）
  function goToNapcat() {
    mainTabs.select('tab-platform');
    platformTabs.select('ptab-instances');
    const inst = instancesOf(S.platform).find((i) => i.provider === 'napcat');
    if (inst) { selectedInst = inst.id; pref.set('inst', inst.id); }
    renderPlatform(); renderSnow();
    requestAnimationFrame(() => $('napSection').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function renderPlatform() {
    const pl = S.platform; const ov = pl.overview;
    const run = pl.running; const up = pl.reachable;
    setDot($('plDot'), up ? 'on' : run ? 'warn' : '');
    $('plState').textContent = run ? `运行中 · PID ${pl.pid} · ${fmtDur(pl.uptimeMs)}${pl.restarts ? ` · 已自动重启 ${pl.restarts} 次` : ''}${up ? '' : ' · 接口未就绪'}` : (pl.restartPending ? '等待自动重启…' : pl.external ? '外部运行中' : (pl.lastExit ? `已停止（退出码 ${pl.lastExit.code ?? '—'}）` : '未启动'));
    $('plStart').disabled = run || pl.external;
    $('plStop').disabled = !run && !pl.restartPending;
    $('plRestart').disabled = !run;
    $('plAuto').checked = !!pl.autoRestart;
    const ready = ov?.counts.accountsReady ?? 0;
    const faulty = ov?.counts.instancesFaulty ?? 0;
    setDot($('tabPlatformDot'), !up ? (run ? 'warn' : 'off') : faulty ? 'warn' : ready ? 'on' : 'warn');
    $('tabPlatformSt').textContent = !up ? (run ? '启动中' : pl.external ? '外部运行' : '未运行') : `${ready} 账号就绪${faulty ? ` · ${faulty} 实例异常` : ''}`;
    $('tCore').textContent = up ? `运行中（v${ov?.version ?? '?'}）` : run ? '启动中' : '未运行';
    $('tReady').textContent = up ? `${ready} / ${ov.counts.accounts}` : '—';
    $('tFaulty').textContent = up ? String(faulty) : '—';
    $('tRecv').textContent = up ? fmtAgo(ov.lastReceiveAt) : '—';
    $('tSend').textContent = up ? fmtAgo(ov.lastSendAt) : '—';
    $('tLink').textContent = pl.link.viaPlatform ? '经接口平台' : '直连 SnowLuma（未接入）';
    $('plSupport').textContent = ov?.support?.note ?? 'M1：QQ 经 SnowLuma（Windows / Linux）或 NapCat（macOS / Windows / Linux）接入。自研 Mac 原生 QQ（M3）与其他平台尚未提供。';

    // 实例列表
    const insts = instancesOf(pl);
    if (!insts.find((i) => i.id === selectedInst)) selectedInst = insts[0]?.id ?? '';
    const list = $('instList');
    const items = insts.map((i) => {
      const okLinks = (i.links ?? []).filter((l) => l.state === 'open').length;
      const btn = el('button', { type: 'button' });
      btn.setAttribute('aria-current', String(i.id === selectedInst));
      const dot = el('span', { className: 'dot' });
      setDot(dot, !up ? '' : !i.connected ? '' : (i.links ?? []).length && okLinks === i.links.length ? 'on' : 'warn');
      btn.append(dot, el('span', { textContent: i.id }), el('span', { className: 'meta', textContent: `${i.provider}${up ? ` · ${okLinks}/${(i.links ?? []).length}` : ''}` }));
      btn.onclick = () => { selectedInst = i.id; pref.set('inst', i.id); renderPlatform(); renderSnow(); };
      return el('li', {}, btn);
    });
    list.replaceChildren(...items);
    if (!insts.length) list.replaceChildren(el('li', { className: 'note', textContent: up ? '还没有实例' : (SNOW_OS.includes(S.os) ? '接口平台未运行' : '接口平台未运行。macOS 上 QQ 经 NapCat 接入：先自己安装并启动 NapCat（开启 WebSocket 服务端），再启动接口平台。') }));
    $('instProvidersNote').textContent = '可用：SnowLuma（Windows / Linux）、NapCat（macOS / Windows / Linux）。尚未提供：macOS 原生 QQ 接入、Discord、KOOK、WeChat。';
    renderInstDetail(insts.find((i) => i.id === selectedInst), up);
    renderAccounts(ov, up);
    renderSettings(pl, ov);
  }

  function renderInstDetail(inst, up) {
    $('instEmpty').hidden = !!inst;
    $('instDetail').hidden = !inst;
    if (!inst) return;
    // 本机 SnowLuma 占位项：只显示 SnowLuma 程序区，不显示平台实例的配置与链路
    for (const id of ['idConnect', 'idDisconnect', 'idSave']) $(id).hidden = !!inst.local;
    for (const n of document.querySelectorAll('#instDetail .platform-only')) n.hidden = !!inst.local;
    $('idLocalNote').hidden = !inst.local;
    $('idTitle').textContent = inst.id;
    $('idProvider').textContent = inst.providerName ?? inst.provider;
    $('idMgmt').textContent = inst.local ? '由你亲手启停' : ({ external: '外部运行', hosted: '平台托管', remote: '远程连接' }[inst.management] ?? inst.management);
    const links = inst.links ?? [];
    setDot($('idDot'), !up || !inst.connected ? '' : links.length && links.every((l) => l.state === 'open') ? 'on' : 'warn');
    $('idConnect').disabled = !up || inst.connected;
    $('idDisconnect').disabled = !up || !inst.connected;
    $('idSave').disabled = false;
    // 只在切换实例时填表，避免覆盖正在编辑、尚未提交的输入
    if (renderedInst !== inst.id) {
      renderedInst = inst.id;
      $('idWs').value = inst.upstream.wsUrl ?? '';
      $('idHome').value = inst.upstream.homeDir ?? '';
      $('idToken').value = '';
    }
    $('idToken').placeholder = inst.upstream.hasToken ? '已设置（留空 = 不修改）' : '未设置';
    const rows = links.map((l) => el('tr', {},
      el('td', { textContent: l.key }),
      el('td', { textContent: l.account ? `${l.account}${l.nickname ? `（${l.nickname}）` : ''}` : '—' }),
      el('td', { textContent: l.state === 'open' ? '已连接' : l.state === 'connecting' ? '连接中' : '未连接' }),
      el('td', { textContent: rt(l.reason ?? (l.online === false ? 'awaiting_login' : l.good === false ? 'receive_unhealthy' : l.stale ? 'receive_stale' : null)) }),
      el('td', { textContent: fmtAgo(l.lastPacketAt) })));
    $('idLinks').replaceChildren(...(rows.length ? rows : [el('tr', {}, el('td', { colSpan: 5, className: 'note', textContent: up ? (inst.connected ? '没有链路：如果填了 SnowLuma 目录，说明目录里还没有账号配置（先在 SnowLuma WebUI 扫码登录）' : '实例已断开') : '接口平台未运行' }))]));
    $('snowSection').hidden = inst.provider !== 'snowluma';
    $('napSection').hidden = inst.provider !== 'napcat';
  }

  function renderAccounts(ov, up) {
    const accs = ov?.accounts ?? [];
    $('acctEmpty').textContent = !up ? '接口平台未运行。' : accs.length ? '' : '还没有账号。SnowLuma 登录后，实例连上即会出现。';
    const L = ['coreRunning', 'backendReachable', 'loggedIn', 'ioReady', 'bridgeEnabled'];
    const names = { coreRunning: '核心运行', backendReachable: '后端可连接', loggedIn: '账号已登录', ioReady: '收发就绪', bridgeEnabled: '桥接已启用' };
    $('acctRows').replaceChildren(...accs.map((a) => {
      const ladder = el('span', { className: 'ladder' });
      for (const k of L) { const d = el('span', { className: 'dot', title: `${names[k]}：${a.health[k] ? '是' : '否'}` }); setDot(d, a.health[k] ? 'on' : 'off'); ladder.append(d); }
      const box = el('input', { type: 'checkbox', checked: a.bridge.enabled, title: '停用后账号仍在线，但消息不再进入 AI 处理' });
      box.setAttribute('aria-label', `${a.account} 桥接开关`);
      box.onchange = async () => {
        if (!box.checked && !await confirmBox('停用桥接', `停用后 ${a.account} 仍然在线，但它的消息不再进入 AI 处理，AI 也不能用它发消息。`, '停用')) { box.checked = true; return; }
        act(() => api(`/api/platform/accounts/${encodeURIComponent(a.account)}/bridge`, { enabled: box.checked }), box.checked ? '已启用桥接' : '已停用桥接');
      };
      return el('tr', {},
        el('td', { textContent: a.account }),
        el('td', { textContent: a.nickname ?? '—' }),
        el('td', { textContent: a.instance ?? '—' }),
        el('td', {}, ladder),
        el('td', { textContent: rt(a.health.reason) }),
        el('td', {}, el('label', { className: 'check' }, box, a.bridge.attached ? ` 已接入 ${a.bridge.attached}` : ' 未接入')),
        el('td', { textContent: `${a.received} / ${a.sent}` }),
        el('td', { textContent: `${fmtAgo(a.lastReceiveAt)} / ${fmtAgo(a.lastSendAt)}` }));
    }));
    // 日志来源选项：实例/账号随状态更新，但不打断当前选择
    const sel = $('plScope'); const cur = sel.value;
    const want = [['', '全部来源'], ['scope=core', '核心'], ['scope=compat', '兼容入口'], ...instancesOf(S.platform).map((i) => [`instance=${i.id}`, `实例 ${i.id}`]), ...accs.map((a) => [`account=${a.account}`, `账号 ${a.account}`])];
    if (sel.options.length !== want.length || want.some(([v], i) => sel.options[i]?.value !== v)) {
      sel.replaceChildren(...want.map(([v, t]) => el('option', { value: v, textContent: t })));
      sel.value = want.some(([v]) => v === cur) ? cur : '';
    }
  }

  function renderSettings(pl, ov) {
    const link = pl.link;
    $('linkState').textContent = link.viaPlatform ? '已接入（经接口平台）' : '未接入（直连 SnowLuma）';
    $('linkOn').disabled = link.viaPlatform || !S.health.config.valid;
    $('linkOff').disabled = !link.viaPlatform;
    $('sVer').textContent = ov ? `v${ov.version}` : '—（未运行）';
    $('sData').textContent = `${pl.dir}${pl.installed ? '' : '（找不到：接口平台应放在桥接目录的同级 interface-platform/，或在 state/control-center.json 设 platformDir）'}`;
    $('sPort').textContent = String(pl.port);
    $('sCompat').textContent = `ws://127.0.0.1:${pl.port}/onebot/v11/ws ，http://127.0.0.1:${pl.port}/onebot/v11`;
    const c = ov?.compat?.onebot;
    $('sCompatAcct').textContent = c ? `${c.account}${c.account === 'auto' ? (c.resolved.account ? ` → ${c.resolved.account}` : `（${c.resolved.reason}）`) : ''}` : '—';
    $('sEnv').textContent = ov ? `${ov.platform}/${ov.arch} · Node ${ov.node}` : '—';
    $('sSupport').textContent = ov?.support?.note ?? '—';
  }

  function renderSnow() {
    const sl = S.snowluma; const h = S.health;
    const hasDir = !!sl.info?.ok;
    $('snowPick').hidden = hasDir && !$('snowPick').dataset.forceShow;
    $('snowReady').hidden = !hasDir || !!$('snowPick').dataset.forceShow;
    if (!hasDir && sl.dir) $('snowPickMsg').textContent = `之前选择的目录不可用：${sl.info?.error || ''}`;
    const sRun = sl.running;
    setDot($('snowDot'), sRun ? (h.snowlumaPort ? 'on' : 'warn') : (h.snowlumaPort ? 'warn' : ''));
    $('snowState').textContent = !hasDir ? '未选择目录' : sRun ? `运行中 · PID ${sl.pid} · ${fmtDur(sl.uptimeMs)}` : (h.snowlumaPort ? '外部运行中' : (sl.lastExit ? `已停止（退出码 ${sl.lastExit.code ?? '—'}）` : '未启动'));
    $('snowStart').disabled = !hasDir || sRun || h.snowlumaPort;
    $('snowStop').disabled = !sRun;
    if (hasDir) {
      const i = sl.info;
      $('snowVer').textContent = i.version + (sl.update?.latest ? (sl.update.updateAvailable ? `（有新版本 ${sl.update.latest}）` : '（已是最新）') : '');
      // Node 要求按发行包的 engines.node 显示（2.0 起是 >=24）；平台不符、本机 Node 不够时直接写出原因
      $('snowEdition').textContent = (i.edition === 'full' ? '完整版（自带 Node 运行时）' : `Lite 版（使用本机 Node，需要 ${i.nodeRequirement ?? '22.13+'}${i.nodeOk === false ? `，本机是 ${S.node}，不够` : ''}）`)
        + (i.targetOk === false ? ` · ⚠️ 这是 ${i.target} 版发行包，本机需要 ${i.expectedTarget} 版` : '');
      $('snowDirText').textContent = i.dir;
      $('snowAccounts').textContent = i.accounts?.length ? i.accounts.join('、') : '还没有（首次在 SnowLuma WebUI 里扫码登录后生成）';
      $('snowWebui').textContent = i.webui.url;
    }
  }

  function renderNapcat() {
    const n = S.napcat;
    setDot($('napDot'), n.running ? 'on' : n.external ? 'warn' : '');
    $('napState').textContent = n.running ? `运行中 · PID ${n.pid} · ${fmtDur(n.uptimeMs)}` : n.external ? '外部运行中' : (n.lastExit ? `已停止（退出码 ${n.lastExit.code ?? '—'}）` : '未启动');
    $('napStart').disabled = n.running || n.external || !n.info.ok;
    $('napStop').disabled = !n.running;
    const mac = S.os === 'darwin';
    const ver = n.version?.runtime || n.version?.file;
    $('napVer').textContent = !ver ? (n.running ? '启动中，登录后显示' : '启动并登录后显示（由 NapCat 自报）')
      : ver + (n.version?.runtime ? '' : '（来自安装文件）') + (n.update?.latest ? (n.update.updateAvailable ? `（有新版本 ${n.update.latest}）` : '（已是最新）') : '');
    $('napProgLabel').textContent = mac ? 'QQ 程序' : '启动文件';
    $('napProgText').textContent = mac ? (n.settings?.qqApp || '/Applications/QQ.app（默认）') : (n.settings?.command || '未设置（点「NapCat 设置」选择）');
    $('napHomeText').textContent = n.home ? n.home + (n.settings?.home ? '' : '（默认）') : '未设置';
    $('napQQAppRow').hidden = !mac; $('napCmdRow').hidden = mac;
    renderNapQr(n.qr);
    if (!$('napSetPanel').classList.contains('show')) $('napHomeInput').placeholder = n.home || 'NapCat 目录';
    $('napCmdInput').placeholder = S.os === 'linux' ? 'NapCat 的 .sh 启动脚本或可执行文件' : 'NapCat.Shell 里的 .bat / .exe';
    if (S.os === 'linux' && !n.home) $('napHomeText').textContent = '未设置（Linux 没有默认位置：在「NapCat 设置」里选 NapCat 目录，接口平台才能自动发现账号和令牌）';
    $('napNote').textContent = !n.info.ok ? n.info.error : n.external ? 'NapCat（QQ）已在别处运行，控制中心不会接管它；要在这里启停，先完全退出那个 QQ。' : (n.info.quickLogin ? '已设置自动登录（NapCat 的 autoLoginAccount 或 napcatQuickLogin）：启动时用保存的登录态，不用扫码；登录态失效时仍会要求扫码，二维码在 NapCat 的 cache/qrcode.png。' : '首次启动或登录过期时需要扫码：二维码保存在 NapCat 的 cache/qrcode.png（网页日志里的字符二维码可能扫不出来）。要免扫码，在「NapCat 设置」里填快速登录 QQ 号，或在 NapCat 里开启自动登录。');
  }

  // 接入后端开启卡：平台报什么提供方就画什么卡；内置的 SnowLuma / NapCat 另有程序层信息
  const BUILTIN_BACKENDS = {
    snowluma: { name: 'SnowLuma', os: 'Windows / Linux' },
    napcat: { name: 'NapCat', os: 'macOS / Windows / Linux' },
  };
  const OS_LABELS = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  function providerOs(p) {
    const list = Array.isArray(p?.os) ? p.os : p?.os ? [p.os] : [];
    const label = list.map((x) => OS_LABELS[x] ?? x).join(' / ');
    return label || (p?.available === false ? '尚未提供' : '外部接入');
  }
  function backendDefs() {
    const providers = Array.isArray(S?.platform?.providers) ? S.platform.providers : [];
    const insts = S?.platform?.overview?.instances ?? [];
    const list = providers
      // 尚未提供的连接器不摆成可用卡片；但用户已经建了它的实例时要显示出来
      .filter((p) => p?.id && (p.available !== false || insts.some((i) => i.provider === p.id)))
      .map((p) => {
        const builtin = BUILTIN_BACKENDS[p.id];
        return { id: String(p.id), name: builtin?.name ?? p.name ?? String(p.id), os: builtin?.os ?? providerOs(p), note: p.note || '' };
      });
    // 实例存在、平台却还没登记这个 provider：也给一张通用卡，别让它从概览消失
    for (const i of insts) {
      if (i?.provider && !list.some((b) => b.id === i.provider)) list.push({ id: i.provider, name: i.provider, os: '外部接入', note: '' });
    }
    // 平台没报（没运行 / 旧版本）时仍给内置两个，保证页面不空
    for (const [id, meta] of Object.entries(BUILTIN_BACKENDS)) if (!list.some((b) => b.id === id)) list.push({ id, ...meta });
    return list;
  }
  function renderBackends() {
    const pl = S.platform; const insts = pl.overview?.instances ?? []; const accs = pl.overview?.accounts ?? [];
    const cards = backendDefs().map((b) => {
      const inst = insts.find((i) => i.provider === b.id);
      const links = inst?.links ?? [];
      const okLinks = links.filter((l) => l.state === 'open' && l.reason !== 'auth_failed').length;
      const ready = accs.filter((a) => inst && a.instance === inst.id && a.health.ioReady);
      let prog; let progKind = ''; let unavailable = null;
      if (b.id === 'snowluma') {
        const sl = S.snowluma;
        if (!SNOW_OS.includes(S.os)) { prog = 'SnowLuma 只有 Windows / Linux 版，本机不能运行（可以连接别处运行的 SnowLuma）'; unavailable = true; }
        else if (sl.running) { prog = '运行中（控制中心启动）'; progKind = 'on'; }
        else if (S.health.snowlumaPort) { prog = '外部运行中'; progKind = 'warn'; }
        else prog = sl.info?.ok ? '未运行' : '未选择目录';
      } else if (b.id === 'napcat') {
        const n = S.napcat;
        if (n.running) { prog = '运行中（控制中心启动）'; progKind = 'on'; }
        else if (n.external) { prog = '外部运行中'; progKind = 'warn'; }
        else prog = n.info.ok ? '未运行' : `不能启动：${n.info.error}`;
      } else {
        // 平台新接入的提供方：控制中心不知道它的程序细节，只显示平台侧连接状态
        prog = inst ? `由接口平台连接（${inst.management ?? 'external'}）` : '由接口平台接入：先到「接入实例」添加并填地址';
        progKind = inst?.connected ? 'on' : '';
        unavailable = true;
      }
      const managed = b.id === 'snowluma' || b.id === 'napcat';
      const on = managed ? (!!inst?.connected || (b.id === 'napcat' ? S.napcat.running : S.snowluma.running)) : !!inst?.connected;
      const card = el('div', { className: `bcard${on ? ' on' : ''}` });
      const d = el('span', { className: 'dot' }); setDot(d, ready.length ? 'on' : on ? 'warn' : '');
      card.append(el('div', { className: 'bhead' }, d, el('h3', { textContent: b.name }), el('span', { className: 'badge', textContent: b.os })));
      const dl = el('dl');
      const row = (k, v) => dl.append(el('dt', { textContent: k }), el('dd', { textContent: v }));
      row('程序', prog);
      row('平台实例', !pl.reachable ? '接口平台未运行' : !inst ? '还没有（点开启自动建立）' : !inst.connected ? `${inst.id}：已断开` : `${inst.id}：${okLinks}/${links.length} 条链路在线${links.some((l) => l.reason === 'auth_failed') ? '（令牌被拒）' : ''}`);
      row('账号', ready.length ? ready.map((a) => `${a.account}${a.nickname ? `（${a.nickname}）` : ''}`).join('、') + ' 收发就绪' : (links.find((l) => l.account) ? `${links.filter((l) => l.account).map((l) => l.account).join('、')}：${rt(links[0].reason)}` : '—'));
      if (inst?.discoveryError) row('目录', `${inst.discoveryError} —— 已连上的账号不受影响；macOS 上多半是「访问其他 App 的数据」被拒：在 系统设置 › 隐私与安全性 › App 管理/其他 App 的数据 里允许启动控制中心的程序（终端）`);
      card.append(dl);
      const rowEl = el('div', { className: 'row' });
      if (!managed) {
        // 未知提供方：控制中心不碰它的进程，只把人带到「接入实例」
        const go = el('button', { className: 'bbtn primary', textContent: inst ? '查看接入实例 →' : '去接入实例添加 →' });
        go.onclick = () => { mainTabs.select('tab-platform'); platformTabs.select('ptab-instances'); };
        rowEl.append(go);
        card.append(rowEl);
        return card;
      }
      const btn = el('button', { className: `bbtn ${on ? 'danger' : 'primary'}`, textContent: on ? `关闭 ${b.name}` : `开启 ${b.name}` });
      // 本机不能运行的后端不提供一键开启（默认端口会撞上本机其他后端）；要连别处的实例，到「接入实例」里添加并填地址
      if (unavailable && !on) { btn.disabled = true; btn.title = '要连接别处运行的 SnowLuma：在「接入实例」里添加实例并填写 WS 地址和令牌'; }
      btn.onclick = async () => {
        if (on && !await confirmBox(`关闭 ${b.name}`, `断开接口平台里 ${b.name} 的实例${(b.id === 'napcat' ? S.napcat.running : S.snowluma.running) ? `，并停止由控制中心启动的 ${b.name}（机器人 QQ 会下线）` : ''}。其他后端不受影响。`, '关闭')) return;
        const r = await act(() => api(`/api/backends/${b.id}/${on ? 'off' : 'on'}`, {}));
        if (r?.steps) toast(r.steps.join('；'), 'ok');
      };
      rowEl.append(btn);
      if (b.id === 'napcat') {
        // NapCat 等扫码时在卡片上直接提示；任何时候都能一键跳到 NapCat 程序区
        if (S.napcat.qr?.waiting) card.append(el('div', { className: 'qr-alert', textContent: '📱 NapCat 正在等你扫码登录' }));
        const go = el('button', { className: 'bbtn', textContent: S.napcat.qr?.waiting ? '查看登录二维码 →' : '管理 NapCat 程序 →' });
        go.onclick = goToNapcat;
        rowEl.append(go);
      }
      card.append(rowEl);
      return card;
    });
    $('backendCards').replaceChildren(...cards);
  }

  // ─── 服务：内置四项（桥接 / 接口平台 / SnowLuma / NapCat）+ 自定义进程 ───
  let svcSel = '';
  let svcLogSeq = 0;
  let svcFormMode = null; // 'add' | 'edit'
  const svcById = (id) => (S?.services ?? []).find((s) => s.id === id) ?? null;

  function renderServices() {
    const list = S?.services ?? [];
    const running = list.filter((s) => s.running).length;
    setDot($('tabServicesDot'), running ? 'on' : '');
    $('tabServicesSt').textContent = list.length ? `${running}/${list.length} 运行` : '—';

    if (!list.some((s) => s.id === svcSel)) svcSel = list[0]?.id ?? '';
    $('svcList').replaceChildren(...list.map((s) => {
      const btn = el('button', { type: 'button' });
      btn.setAttribute('aria-current', String(s.id === svcSel));
      const d = el('span', { className: 'dot' });
      setDot(d, s.health && s.health.ok === false ? 'warn' : s.running ? 'on' : '');
      btn.append(d, el('span', { textContent: s.name }), el('span', { className: 'meta', textContent: s.id }));
      btn.onclick = () => { svcSel = s.id; closeSvcForm(); svcLogSeq = 0; $('svcTerm').replaceChildren(); renderServices(); void refreshServiceLogs(); };
      return el('li', {}, btn);
    }));

    const svc = svcById(svcSel);
    $('svcEmpty').hidden = !!svc;
    $('svcDetail').hidden = !svc;
    if (svc) renderServiceDetail(svc);
  }

  function renderServiceDetail(s) {
    setDot($('svcDot'), s.health && s.health.ok === false ? 'warn' : s.running ? 'on' : '');
    $('svcTitle').textContent = s.name;
    $('svcKind').textContent = `${s.kindLabel}${s.builtin ? ' · 内置' : ''}`;
    $('svcStart').disabled = !!s.running;
    $('svcStop').disabled = !s.running;
    $('svcRestart').disabled = !s.running;
    $('svcDelete').hidden = !!s.builtin;
    $('svcLogNote').textContent = s.builtin ? '控制中心托管进程的日志（最近 800 行）' : '这个服务的标准输出与错误（最近 800 行）';
    const rows = [['类型', s.kindLabel]];
    if (!s.builtin) rows.push(['启动命令', [s.command, ...(s.args ?? [])].join(' ')]);
    rows.push(
      ['状态', s.running ? `运行中 · PID ${s.pid} · ${fmtDur(s.uptimeMs)}` : s.lastExit ? `已停止（退出码 ${s.lastExit.code ?? '—'}）` : '未启动'],
      ['自动重启', s.autoRestart ? '开' : '关'],
      ['端口', s.port ? `${s.port}${s.reachable === false ? '（没有监听）' : '（在线）'}` : '—'],
      ['目录', s.dir || (s.cwd && s.cwd !== '.' ? s.cwd : s.builtin ? '—' : '项目根目录')],
      ['健康检查', s.healthUrl ? `${s.healthUrl}${s.health ? (s.health.ok ? '（正常）' : `（失败：${s.health.error ?? `HTTP ${s.health.status}`}）`) : ''}` : '—'],
      ['重启次数', String(s.restarts ?? 0)],
    );
    $('svcInfo').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));
  }

  function renderServiceLogs(lines) {
    const term = $('svcTerm');
    for (const l of lines) {
      const row = el('span', { className: 'l' });
      row.append(el('span', { className: 't', textContent: new Date(l.time).toLocaleTimeString() }), el('span', { textContent: l.text }));
      term.append(row);
    }
    while (term.childElementCount > 800) term.firstElementChild.remove();
    term.scrollTop = term.scrollHeight;
  }

  async function refreshServiceLogs() {
    const svc = svcById(svcSel);
    if (!svc || !tabVisible('panel-services')) return;
    const id = svc.id;
    try {
      const r = await api(`/api/services/${encodeURIComponent(id)}/logs?after=${svcLogSeq}`);
      if (id !== svcSel) return; // 期间切了服务
      const lines = r?.lines ?? [];
      if (lines.length) renderServiceLogs(lines);
      svcLogSeq = r?.lastSeq ?? svcLogSeq;
    } catch { /* 服务刚被删、或控制中心正忙：下一轮再试 */ }
  }

  function openSvcForm(mode, s) {
    svcFormMode = mode;
    const builtin = !!s?.builtin;
    $('svcFormTitle').textContent = mode === 'add' ? '添加服务' : `编辑「${s?.name ?? ''}」`;
    $('svcId').value = s?.id ?? '';
    $('svcId').disabled = mode === 'edit';
    $('svcName').value = s?.name ?? '';
    $('svcCommand').value = s?.command ?? '';
    $('svcArgs').value = (s?.args ?? []).join('\n');
    $('svcCwd').value = s?.cwd ?? '';
    $('svcEnv').value = Object.entries(s?.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
    $('svcPort').value = s?.port ? String(s.port) : '';
    $('svcHealth').value = s?.healthUrl ?? '';
    $('svcAuto').checked = s ? s.autoRestart !== false : true;
    for (const id of ['svcCommand', 'svcArgs', 'svcCwd', 'svcEnv', 'svcPort', 'svcHealth']) $(id).disabled = builtin;
    $('svcFormNote').hidden = !builtin;
    $('svcFormPanel').classList.add('show');
    $('svcId').focus();
  }
  function closeSvcForm() { svcFormMode = null; $('svcFormPanel').classList.remove('show'); }

  function readSvcForm() {
    const env = {};
    for (const line of $('svcEnv').value.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1);
    }
    return {
      id: $('svcId').value.trim(),
      name: $('svcName').value.trim(),
      command: $('svcCommand').value.trim(),
      args: $('svcArgs').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
      cwd: $('svcCwd').value.trim(),
      env,
      port: Number($('svcPort').value) || 0,
      healthUrl: $('svcHealth').value.trim(),
      autoRestart: $('svcAuto').checked,
    };
  }

  async function saveSvcForm() {
    const body = readSvcForm();
    const path = svcFormMode === 'edit' ? `/api/services/${encodeURIComponent(svcSel)}/save` : '/api/services';
    const r = await act(() => api(path, body), svcFormMode === 'edit' ? '服务已保存' : '服务已添加');
    if (r) closeSvcForm();
  }

  $('svcAddBtn').onclick = () => openSvcForm('add', null);
  $('svcEdit').onclick = () => { const s = svcById(svcSel); if (s) openSvcForm('edit', s); };
  $('svcFormCancel').onclick = () => closeSvcForm();
  $('svcFormSave').onclick = () => { void saveSvcForm(); };
  $('svcStart').onclick = () => act(() => api(`/api/services/${encodeURIComponent(svcSel)}/start`, {}), '已启动');
  $('svcStop').onclick = async () => {
    const s = svcById(svcSel);
    if (!s || !await confirmBox('停止服务', `停止「${s.name}」：控制中心不再托管它运行${s.autoRestart ? '（崩溃自动重启也会一并停止）' : ''}。其他服务不受影响。`, '停止')) return;
    act(() => api(`/api/services/${encodeURIComponent(s.id)}/stop`, {}), '已停止');
  };
  $('svcRestart').onclick = async () => {
    const s = svcById(svcSel);
    if (!s || !await confirmBox('重启服务', `重启「${s.name}」会短暂中断它的运行。`, '重启')) return;
    act(() => api(`/api/services/${encodeURIComponent(s.id)}/restart`, {}), '已重启');
  };
  $('svcDelete').onclick = async () => {
    const s = svcById(svcSel);
    if (!s || !await confirmBox('删除服务', `删除「${s.name}」：只从控制中心的列表里移除，不删除它的文件。`, '删除')) return;
    const r = await act(() => api(`/api/services/${encodeURIComponent(s.id)}/delete`, {}), '已删除');
    if (r) { svcSel = ''; $('svcTerm').replaceChildren(); svcLogSeq = 0; }
  };
  $('svcLogClear').onclick = () => { $('svcTerm').replaceChildren(); };

  function renderFooter() {
    const b = S.bridge; const h = S.health; const st = h.bridgeApi; const sl = S.snowluma; const pl = S.platform;
    const bRun = b.running; const sRun = sl.running; const hasDir = !!sl.info?.ok;
    setDot($('sbBridgeDot'), bRun ? 'on' : (h.bridgeExternal ? 'warn' : 'off'));
    $('sbBridge').textContent = bRun ? `运行 ${fmtDur(b.uptimeMs)}` : (h.bridgeExternal ? '外部运行' : '未运行');
    setDot($('sbPlDot'), pl.reachable ? ((pl.overview?.counts.accountsReady ?? 0) ? 'on' : 'warn') : 'off');
    $('sbPl').textContent = pl.reachable ? `${pl.overview?.counts.accountsReady ?? 0} 账号就绪${pl.link.viaPlatform ? ' · 桥接已接入' : ''}` : (pl.running ? '启动中' : '未运行');
    // 接入后端：桥接走接口平台时，看平台里各实例的连接情况（与具体后端无关）；直连时才看 SnowLuma 程序本身
    if (pl.link.viaPlatform) {
      const inst = (pl.overview?.instances ?? []).filter((i) => i.enabled !== false);
      const name = (i) => String(i.providerName || i.provider || i.id).split('（')[0];
      // 实例的 connected 只表示「已开启」；真正连上看链路是否 open
      const linked = (i) => (i.links ?? []).some((l) => l.state === 'open');
      const up = inst.filter(linked);
      setDot($('sbBackDot'), !pl.reachable || !inst.length ? 'off' : up.length === inst.length && !inst.some((i) => i.discoveryError) ? 'on' : up.length ? 'warn' : 'off');
      $('sbBack').textContent = !pl.reachable ? '平台未运行' : !inst.length ? '未添加实例'
        : inst.map((i) => `${name(i)} ${linked(i) ? '已连接' : i.discoveryError ? '读不到账号目录' : i.connected ? '未连上' : '未开启'}`).join('、');
    } else {
      setDot($('sbBackDot'), sRun || h.snowlumaPort ? (st?.snowluma?.connected ? 'on' : 'warn') : 'off');
      $('sbBack').textContent = !hasDir ? 'SnowLuma 直连 · 未选择' : (sRun || h.snowlumaPort) ? (st?.snowluma?.connected ? 'SnowLuma 直连 · 已连接' : 'SnowLuma 直连 · 运行中（桥接未连上）') : 'SnowLuma 直连 · 未运行';
    }
    const sh = st?.snowluma;
    const qqOk = sh && sh.accountOnline !== false && sh.good !== false && sh.connected;
    setDot($('sbQQDot'), !st ? '' : qqOk ? 'on' : (sh?.connected ? 'warn' : 'off'));
    const acct = st?.botAccount ? `${st.botAccount.nickname || ''}（${st.botAccount.userId || '?'}）` : '';
    $('sbQQ').textContent = !st ? '—' : !sh?.connected ? '未连接' : sh.good === false ? `接收异常 ${acct}` : sh.accountOnline === false ? `账号离线 ${acct}` : `在线 ${acct}`;
    // DSH：以桥接自己的连通结论为准（它跟随 DSH 的随机端口）；桥接不在时才看控制中心的端口探测
    const dshOk = st ? !!st.dshReady : !!h.dsh?.reachable;
    setDot($('sbDshDot'), dshOk ? 'on' : h.dsh?.reachable ? 'warn' : 'off');
    $('sbDsh').textContent = st ? (st.dshReady ? '已就绪' : h.dsh?.reachable ? '可达，桥接未就绪' : '不可达') : (h.dsh?.reachable ? '可达' : '不可达');
    const level = st?.level || 'L0';
    $('sbMode').textContent = st ? `${st.mode} / ${level}` : '—';
    $('sbVers').textContent = `控制中心 ${S.version} · 桥接 ${st?.version ?? '—'} · 接口平台 ${pl.overview?.version ?? '—'}${hasDir ? ` · SnowLuma ${sl.info.version}` : ''} · DSH ${h.dsh?.version ?? '—'} · Node ${S.node}`;
    // 总体状态：只汇总，不替代各模块的状态
    const issues = [];
    if (!bRun && !h.bridgeExternal) issues.push('桥接未运行');
    if (pl.link.viaPlatform && !pl.reachable) issues.push('平台未运行');
    if (st && !qqOk) issues.push('QQ 异常');
    if (!dshOk) issues.push(st && h.dsh?.reachable ? 'DSH 桥接未就绪' : 'DSH 不可达');
    $('overallBadge').textContent = issues.length ? `总体：${issues.join(' · ')}` : '总体：正常';
    $('overallBadge').style.color = issues.length ? 'var(--warn)' : 'var(--ok)';
  }

  async function act(fn, okMsg) {
    if (authFailed) return null;
    try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); await refresh(); return r; }
    catch (e) { toast(e.message, 'bad'); await refresh(); return null; }
  }

  // ── 桥接按钮 ──
  // 先同步开出空白窗口（Safari 只放行点击当下的弹窗），拿到带令牌的地址后再跳过去；令牌不写进本页任何存储
  $('consoleOpen').onclick = async () => {
    const w = window.open('about:blank', '_blank');
    try {
      const r = await api('/api/bridge/console-link', {});
      if (!r.auto && r.note) toast(r.note);
      if (w) { w.opener = null; w.location.replace(r.url); } else location.assign(r.url);
    } catch (e) { if (w) w.close(); toast(e.message, 'bad'); }
  };
  $('bridgeStart').onclick = () => act(() => api('/api/bridge/start', {}), '桥接已启动');
  $('bridgeRestart').onclick = async () => { if (await confirmBox('重启桥接', '重启期间群里不会有回复，正在进行的 AI 回合会被中断。', '重启')) act(() => api('/api/bridge/restart', {}), '已重启'); };
  $('bridgeStop').onclick = async () => { if (await confirmBox('停止桥接', '停止后机器人在群里和私聊里都不会再回复（QQ 和接口平台仍然在线）。', '停止桥接')) act(() => api('/api/bridge/stop', {}), '桥接已停止'); };
  $('bridgeAuto').onchange = (e) => act(() => api('/api/bridge/auto-restart', { enabled: e.target.checked }));
  $('panicBtn').onclick = async () => { if (await confirmBox('紧急关闭', '立即回到安全模式（L0 群友模式），停止运维 Agent，作废所有待审批与待确认申请。', '紧急关闭')) act(() => api('/api/command', { text: 'panic' })); };
  $('exitBtn').onclick = async () => {
    const pl = S?.platform;
    const extra = pl?.external ? '\n外部运行的接口平台不受影响。' : '';
    if (!await confirmBox('退出控制中心', `会先停止由控制中心启动的桥接、接口平台和 SnowLuma（机器人将离线），然后关闭控制中心。不是由控制中心启动的进程不会被停止。${extra}`, '全部退出')) return;
    try { await api('/api/exit', {}); } catch {}
    document.body.innerHTML = '<div class="exit-screen">控制中心已退出，可以关闭这个页面。</div>';
  };

  // ── 命令行（固定命令集）──
  const cmdHistory = []; let hi = 0;
  $('cmdForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('cmdInput').value.trim(); if (!text) return;
    cmdHistory.push(text); hi = cmdHistory.length; $('cmdInput').value = '';
    if (/^(bridge|snowluma|platform)\s+stop$|^panic$/i.test(text) && !await confirmBox('确认命令', `确定执行「${text}」？`, '执行')) return;
    try { const r = await api('/api/command', { text }); if (r.result?.clear) bridgeLog.clear(); } catch (err) { toast(err.message, 'bad'); }
    setTimeout(() => { bridgeLog.poll(); refresh(); }, 300);
  };
  $('cmdInput').onkeydown = (e) => {
    if (e.key === 'ArrowUp' && hi > 0) { hi -= 1; $('cmdInput').value = cmdHistory[hi]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { hi = Math.min(cmdHistory.length, hi + 1); $('cmdInput').value = cmdHistory[hi] ?? ''; e.preventDefault(); }
  };

  // ── 接口平台按钮 ──
  // NapCat 登录二维码：图片要带令牌请求，取回后转成 data: 地址显示（页面的 CSP 只允许 data: 图片）
  let napQrShown = null;
  async function renderNapQr(q) {
    $('napQrPanel').hidden = !q?.waiting;
    if (!q?.waiting) {
      if (napQrShown !== null) napLog.expireImages(S?.napcat?.running ? '已登录或已失效' : 'NapCat 已停止');
      napQrShown = null;
      return;
    }
    $('napQrTime').textContent = q.updatedAt ? `二维码生成于 ${new Date(q.updatedAt).toLocaleTimeString()}` : '';
    if (napQrShown === q.updatedAt) return;
    napQrShown = q.updatedAt;
    try {
      const res = await fetch('/api/napcat/qrcode', { headers: { 'x-control-token': token } });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(blob); });
      if (napQrShown === q.updatedAt) {
        $('napQrImg').src = url;
        // 日志里也插一张小图（只有最新这张能扫，旧的标成已过期）
        napLog.addImage({ key: q.updatedAt, src: url, text: '已生成登录二维码（约 2 分钟有效）：用手机 QQ 扫码登录。日志上方的字符二维码可能扫不出来，扫这张' });
        napLog.expireImages('已过期，已换新二维码', q.updatedAt);
      }
    } catch { napQrShown = null; }
  }

  // NapCat：检查更新 / 下载页 / 设置
  function showNapUpdate(u) {
    $('napUpdatePanel').classList.add('show');
    $('napUpdTitle').textContent = !u ? '更新' : !u.current ? `最新版本 ${u.latest}（当前版本未知：启动并登录 NapCat 后再检查可比较）` : u.updateAvailable ? `有新版本：${u.current} → ${u.latest}` : `当前 ${u.current}，最新 ${u.latest}`;
    $('napUpdSummary').textContent = u ? `${u.publishedAt ? `发布时间：${new Date(u.publishedAt).toLocaleString()}。` : ''}${u.suggestedAsset ? `建议下载：${u.suggestedAsset}。` : ''}${u.howTo || ''}` : '';
    $('napUpdNotesWrap').hidden = !u?.notes; $('napUpdNotes').textContent = u?.notes || '';
  }
  $('napCheck').onclick = async () => {
    const r = await act(() => api('/api/napcat/check-update', {}));
    if (r?.update) { showNapUpdate(r.update); toast(!r.update.current ? `最新版本 ${r.update.latest}` : r.update.updateAvailable ? `有新版本 ${r.update.latest}` : `已是最新（${r.update.latest}）`, r.update.updateAvailable ? '' : 'ok'); }
  };
  $('napOpenDownload').onclick = () => act(() => api('/api/napcat/open-download', {}));
  function fillNapSettings() {
    const st = S?.napcat?.settings || {};
    $('napQQAppInput').value = st.qqApp || ''; $('napCmdInput').value = st.command || '';
    $('napHomeInput').value = st.home || ''; $('napQuickInput').value = st.quickLogin || '';
    $('napSetMsg').textContent = '';
  }
  $('napSetToggle').onclick = () => { const p = $('napSetPanel'); if (p.classList.toggle('show')) fillNapSettings(); };
  $('napSetCancel').onclick = () => $('napSetPanel').classList.remove('show');
  async function pickInto(purpose, inputId) {
    toast('已打开选择窗口（可能在浏览器后面）');
    const r = await act(() => api('/api/pick', { purpose }));
    if (r?.path) $(inputId).value = r.path;
  }
  $('napQQAppBrowse').onclick = () => pickInto('napcat-qqapp', 'napQQAppInput');
  $('napCmdBrowse').onclick = () => pickInto('napcat-command', 'napCmdInput');
  $('napHomeBrowse').onclick = () => pickInto('napcat-home', 'napHomeInput');
  $('napSetSave').onclick = async () => {
    const mac = S?.os === 'darwin';
    const body = { home: $('napHomeInput').value.trim(), quickLogin: $('napQuickInput').value.trim(), ...(mac ? { qqApp: $('napQQAppInput').value.trim() } : { command: $('napCmdInput').value.trim() }) };
    try {
      const r = await api('/api/napcat/settings', body);
      $('napSetMsg').textContent = r.steps?.length ? r.steps.join('；') : '';
      toast('NapCat 设置已保存', 'ok');
      if (!r.steps?.length) $('napSetPanel').classList.remove('show');
      refresh();
    } catch (e) { $('napSetMsg').textContent = e.message; toast(e.message, 'bad'); }
  };
  $('napStart').onclick = () => act(() => api('/api/napcat/start', {}), 'NapCat 已启动。需要扫码时二维码在 NapCat 日志里');
  $('napStop').onclick = async () => { if (await confirmBox('停止 NapCat', '停止后机器人 QQ 会立刻下线，收不到也发不出消息。', '停止 NapCat')) act(() => api('/api/napcat/stop', {}), 'NapCat 已停止'); };
  $('plStart').onclick = () => act(() => api('/api/platform/start', {}), '接口平台已启动');
  $('plRestart').onclick = async () => { if (await confirmBox('重启接口平台', S?.platform?.link?.viaPlatform ? '桥接经接口平台收发，重启期间机器人收不到也发不出消息。' : '重启期间平台接口不可用（桥接当前直连 SnowLuma，不受影响）。', '重启')) act(() => api('/api/platform/restart', {}), '已重启'); };
  $('plStop').onclick = async () => { if (await confirmBox('停止接口平台', `${S?.platform?.link?.viaPlatform ? '桥接经接口平台收发，停止后机器人收不到也发不出消息。' : '桥接当前直连 SnowLuma，不受影响。'}\n外部运行的 SnowLuma 不会被停止。`, '停止')) act(() => api('/api/platform/stop', {}), '接口平台已停止'); };
  $('plAuto').onchange = (e) => act(() => api('/api/platform/auto-restart', { enabled: e.target.checked }));
  $('idConnect').onclick = () => act(() => api(`/api/platform/instances/${selectedInst}/connect`, {}), '已连接');
  $('idDisconnect').onclick = async () => { if (await confirmBox('断开实例', `只断开 ${selectedInst} 及其账号的通信连接，其他实例不受影响；不会停止 SnowLuma 进程。`, '断开')) act(() => api(`/api/platform/instances/${selectedInst}/disconnect`, {}), '已断开'); };
  $('idSave').onclick = async () => {
    const up = { wsUrl: $('idWs').value.trim(), homeDir: $('idHome').value.trim() };
    if ($('idToken').value) up.accessToken = $('idToken').value;
    if (!S?.platform?.reachable) { toast('接口平台未运行：请先启动接口平台再修改实例配置', 'bad'); return; }
    const r = await act(() => api(`/api/platform/instances/${selectedInst}`, { upstream: up }), '已保存，实例已按新配置重连');
    if (r) { $('idToken').value = ''; renderedInst = null; }
  };
  $('instAddBtn').onclick = async () => {
    const panel = $('instAddPanel');
    panel.classList.toggle('show');
    if (!panel.classList.contains('show')) return;
    try {
      const r = await api('/api/platform/providers');
      $('addProvider').replaceChildren(...r.providers.map((p) => el('option', { value: p.id, disabled: !p.available, textContent: `${p.name}${p.available ? '' : '（尚未提供）'}` })));
    } catch (e) { $('addProvider').replaceChildren(el('option', { value: 'snowluma', textContent: 'SnowLuma（OneBot v11）' })); toast(e.message, 'bad'); }
  };
  $('addCancel').onclick = () => $('instAddPanel').classList.remove('show');
  $('addGo').onclick = async () => {
    const body = { id: $('addId').value.trim(), provider: $('addProvider').value, management: $('addMgmt').value, upstream: { wsUrl: $('addWs').value.trim() || 'ws://127.0.0.1:3001', accessToken: $('addToken').value, homeDir: $('addHome').value.trim() } };
    const r = await act(() => api('/api/platform/instances', body), `已添加实例 ${body.id}`);
    if (r) { $('instAddPanel').classList.remove('show'); for (const id of ['addId', 'addWs', 'addToken', 'addHome']) $(id).value = ''; selectedInst = body.id; pref.set('inst', body.id); }
  };
  $('linkOn').onclick = async () => {
    if (!await confirmBox('接入桥接', '把桥接 config.json 的 SnowLuma 端点改为接口平台的兼容入口（原值会备份）。\n重启桥接后生效；之后接口平台必须保持运行，机器人才能收发。', '接入')) return;
    const r = await act(() => api('/api/platform/link-bridge', { enabled: true }), '已接入。重启桥接后生效');
    if (r?.restartNeeded && await confirmBox('现在重启桥接？', '配置要在桥接重启后才生效。', '重启桥接')) act(() => api('/api/bridge/restart', {}), '已重启桥接');
  };
  $('linkOff').onclick = async () => {
    if (!await confirmBox('恢复直连', '按备份还原桥接直连 SnowLuma 的配置，重启桥接后生效。', '恢复')) return;
    const r = await act(() => api('/api/platform/link-bridge', { enabled: false }), '已恢复直连。重启桥接后生效');
    if (r?.restartNeeded && await confirmBox('现在重启桥接？', '配置要在桥接重启后才生效。', '重启桥接')) act(() => api('/api/bridge/restart', {}), '已重启桥接');
  };

  // ── SnowLuma 按钮（只由用户亲手点击）──
  async function browse(targetId) {
    toast('已打开文件夹选择窗口（可能在浏览器后面）');
    const r = await act(() => api('/api/snowluma/pick', {}));
    if (r?.dir) $(targetId).value = r.dir;
  }
  $('snowBrowse').onclick = () => browse('snowDirInput');
  $('migrateBrowse').onclick = () => browse('migrateDir');
  $('snowDirInput').oninput = async () => {
    const dir = $('snowDirInput').value.trim(); if (!dir) { $('snowPickMsg').textContent = ''; return; }
    try { const r = await api('/api/snowluma/inspect', { dir }); $('snowPickMsg').textContent = r.info.ok ? `✓ SnowLuma ${r.info.version}（${r.info.edition === 'full' ? '完整版' : 'Lite 版'}）` : r.info.error; } catch {}
  };
  $('snowUse').onclick = async () => {
    const dir = $('snowDirInput').value.trim(); if (!dir) { toast('请先填写或浏览选择目录', 'bad'); return; }
    let r = await act(() => api('/api/snowluma/select', { dir }));
    // 新目录缺账号配置和 WebUI 密码、旧目录有：先建议用「更新助手」迁移；不迁移的话再确认一次才切换
    if (r?.needMigrate) {
      if (await confirmBox('新目录还没有你的数据', `${r.warning}\n\n旧目录：${r.oldDir}\n新目录：${r.newDir}`, '去迁移（推荐）')) {
        delete $('snowPick').dataset.forceShow;
        showUpdate(S?.snowluma?.update);
        $('migrateDir').value = r.newDir;
        refresh();
        requestAnimationFrame(() => $('updatePanel').scrollIntoView({ behavior: 'smooth', block: 'start' }));
        toast('已填好新目录：先停止 SnowLuma，再点「迁移数据并切换」');
        return;
      }
      if (!await confirmBox('仍然直接切换？', '不迁移就切换：SnowLuma 会生成新的随机 WebUI 密码（旧密码失效），需要重新扫码登录、重新开启 OneBot WebSocket。旧目录的数据不会被删除，之后仍然可以迁移。', '仍然切换')) return;
      r = await act(() => api('/api/snowluma/select', { dir, force: true }));
    }
    if (r?.ok && r.switched !== false) { delete $('snowPick').dataset.forceShow; renderedInst = null; toast(`已选择 SnowLuma ${r.info.version}${r.platformSynced ? '，并同步给接口平台' : (S?.platform?.reachable ? '' : '（接口平台没运行，未同步；启动后在实例详情里填 SnowLuma 目录）')}${r.homeDirSynced ? '，并同步了 config.json 的 snowluma.homeDir' : ''}`, 'ok'); refresh(); }
  };
  $('snowChange').onclick = () => { $('snowPick').dataset.forceShow = '1'; $('snowDirInput').value = S?.snowluma?.dir || ''; refresh(); };
  $('snowStart').onclick = () => act(() => api('/api/snowluma/start', {}), 'SnowLuma 已启动。首次使用请打开它的 WebUI 扫码登录机器人 QQ');
  $('snowStop').onclick = async () => { if (await confirmBox('停止 SnowLuma', '停止后机器人 QQ 会立刻收不到、也发不出消息。', '停止 SnowLuma')) act(() => api('/api/snowluma/stop', {}), 'SnowLuma 已停止'); };
  $('snowOpenWebui').onclick = () => act(() => api('/api/snowluma/open-webui', {}));
  $('snowCheck').onclick = async () => {
    const r = await act(() => api('/api/snowluma/check-update', {}));
    if (r?.update) { showUpdate(r.update); toast(r.update.updateAvailable ? `有新版本 ${r.update.latest}` : `已是最新（${r.update.latest}）`, r.update.updateAvailable ? '' : 'ok'); }
  };
  function showUpdate(u) {
    $('updatePanel').classList.add('show');
    $('updTitle').textContent = u ? (u.updateAvailable ? `有新版本：${u.current} → ${u.latest}` : `当前 ${u.current}，最新 ${u.latest}`) : '更新助手';
    $('updSummary').textContent = u?.publishedAt ? `发布时间：${new Date(u.publishedAt).toLocaleString()}` : '可以先点「检查更新」。';
    $('updAsset').textContent = u?.suggestedAsset || (S?.os === 'linux' ? 'SnowLuma-v<版本>-linux-x64.tar.gz（arm64 机器选 linux-arm64；完整版，不要选 Lite）' : 'SnowLuma-v<版本>-win-x64.zip（完整版，不要选 Lite）');
    $('updNotesWrap').hidden = !u?.notes; $('updNotes').textContent = u?.notes || '';
  }
  $('snowUpdateHelper').onclick = () => { if ($('updatePanel').classList.contains('show')) $('updatePanel').classList.remove('show'); else showUpdate(S?.snowluma?.update); };
  $('updDownload').onclick = () => act(() => api('/api/snowluma/open-download', {}));
  $('migrateGo').onclick = async () => {
    const toDir = $('migrateDir').value.trim(); if (!toDir) { toast('请选择新版本解压后的目录', 'bad'); return; }
    if (!await confirmBox('迁移数据并切换', `把当前目录的 config/、data/${$('migrateLogs').checked ? '、logs/' : ''} 备份后复制到：\n${toDir}\n并把控制中心切换到新目录。旧目录不会被删除。`, '开始迁移')) return;
    try {
      const r = await api('/api/snowluma/migrate', { toDir, includeLogs: $('migrateLogs').checked });
      $('migrateResult').textContent = `✓ 已从 ${r.from} 迁移到 ${r.to}；备份在 ${r.backupDir}。现在可以点「启动 SnowLuma」试一下，确认账号正常后再删除旧目录。`;
      toast('迁移完成', 'ok');
    } catch (e) { $('migrateResult').textContent = `✗ ${e.message}`; toast(e.message, 'bad'); }
    refresh();
  };

  // ── 轮询：全页只有这一组定时器，切换标签不会新增请求或连接 ──
  refresh(); bridgeLog.poll(); snowLog.poll(); plLog.poll(); napLog.poll();
  setInterval(refresh, 2500);
  setInterval(() => { bridgeLog.poll(); snowLog.poll(); plLog.poll(); napLog.poll(); }, 1000);
})();
