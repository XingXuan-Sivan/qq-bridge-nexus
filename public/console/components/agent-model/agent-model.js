// 模型与思考强度：提供方 / 模型 / 思考强度 / 看图能力。
//
// 平台详情与全局配置两处共用同一套逻辑，控件 id 是 `${prefix}Model*`（平台详情传 `platform`，
// 全局配置传 `agent`）：两处页面片段可能同时驻留在 DOM 里，都叫 platformModel* 会撞 id。
// 平台由调用方传入，组件只问目录。
//
// 选项来自平台自己的两处声明，分工不同：
//   · `view`（从实时目录整理）给出提供方 → 模型 → 各模型支持的思考档位，优先；
//   · `declared`（agent-platform.yml 的 modelCatalog）在读不到实时目录时兜底：
//     模型按 `declared.models` 铺，档位按模型的 `efforts` → `declared.efforts` → `declared.effortFallback` 依次回落。
// 提供方是实时目录的概念（声明面没有这一维），读不到时保持原值并置灰。
// 写口是 PATCH /api/platforms/registry/agent/<id>/config：目录不可用时照常保存、回 warning，
// 由提示条如实说明。
import { api } from '../../js/api.js';
import { esc, showConsoleToast } from '../../js/ui.js';
import { declaredModelCatalog, loadModelCatalog } from '../../js/registry.js';
import { renderFields, setSelectOptions } from '../../components/form/form.js';
import { mountAlert } from '../../components/alert/alert.js';
import { confirmBox } from '../../components/message-box/message-box.js';

/**
 * 在 host 里挂载模型设置（控件 + 可选动作条 + 提示条）。
 * @param {HTMLElement} host 挂载点（组件自己铺控件）
 * @param {{agentId: string, config?: object, prefix?: string, actions?: boolean, toast?: boolean,
 *   noticesHost?: HTMLElement, onStatus?: (text: string) => void, onSaved?: () => void}} options
 *   config 是注册表条目里的那一份（provider / model / reasoningEffort / vision）；
 *   prefix 是控件 id 的命名空间（平台详情用 `platform`，全局配置用 `agent`，最终 id 为 `${prefix}Model*`）；
 *   actions 为 false 时不画「刷新 / 保存」动作条，由调用方在卡片级动作条里调 save() / refresh()；
 *   noticesHost 是提示条的空位：不传就铺在控件最前面，传了就提到调用方指定的位置
 *   （全局配置把「默认平台」排在控件之前，提示条需要停在整张卡的最上面）；
 *   onStatus 是状态文字的出口：不传就写组件自己的状态位，传了由调用方决定写到哪；
 *   onSaved 是写成功后的刷新回调（重拉注册表 / 重画宿主由调用方决定）。
 * @returns {{reload: () => Promise<void>, refresh: (options?: object) => Promise<void>,
 *   save: () => Promise<{ok: boolean, message?: string, canceled?: boolean}>, destroy: () => void} | null}
 */
export function mountAgentModel(host, {
  agentId, config = {}, prefix = 'agent', actions = true, toast = true, noticesHost = null,
  onStatus = null, onSaved = null,
} = {}) {
  const id = String(agentId ?? '').trim().toLowerCase();
  if (!host || !id) return null;
  let saved = { ...config };
  let catalog = { declared: declaredModelCatalog(id), live: null, view: null, error: '', unsupported: false };

  const control = (name) => host.querySelector(`#${prefix}Model${name}`);
  const modelSelect = () => control('');
  // destroyed 之后不再往外写：换平台时旧句柄的异步回调可能晚于新卡片的提示。
  let destroyed = false;
  let lastStatus = '';
  const setStatus = (text, kind = '') => {
    if (destroyed) return;
    lastStatus = text;
    if (onStatus) { onStatus(text, kind); return; }
    const el = control('Msg');
    if (el) el.textContent = text;
  };

  const FIELDS = [
    {
      name: `${prefix}ModelProvider`,
      type: 'select',
      label: '提供方',
      options: [],
      hint: '模型凭据方式：要与 Agent 平台里的登录方式一致，不一致会报缺少凭据。',
    },
    { name: `${prefix}Model`, type: 'select', label: '模型', options: [] },
    { name: `${prefix}ModelEffort`, type: 'select', label: '思考强度', options: [] },
    {
      name: `${prefix}ModelVision`,
      type: 'select',
      label: '看图能力',
      value: 'auto',
      options: [
        { value: 'auto', label: '自动（按目录判断）' },
        { value: 'yes', label: '能看图' },
        { value: 'no', label: '不能看图' },
      ],
      hint: '自动 = 只有目录里标明能看图的模型才把图片交给它，其余改成文字占位，不去下载。',
    },
  ];
  // 动作条由调用方决定画不画：全局配置把「刷新 / 保存」放到卡片级动作条里，
  // 与默认 Agent 平台的保存合成一个按钮，不再一卡两套按钮。
  if (actions) {
    FIELDS.push({
      type: 'action',
      id: `${prefix}ModelActions`,
      items: [
        { id: `${prefix}ModelRefresh`, label: '刷新' },
        { id: `${prefix}ModelSave`, label: '保存', variant: 'primary' },
      ],
      status: `${prefix}ModelMsg`,
    });
  }
  // 提示条放在表单上方：这些都是「选之前就该知道」的事实（目录状态、第三方、关思考、看图降级），
  // 跟在字段后面时会被四行下拉挤到卡片底部。默认铺在字段表首位；调用方另给位置时先占住那里。
  const noticesMarkup = `<div id="${prefix}ModelNotices"></div>`;
  let noticesEl = null;
  if (noticesHost) {
    noticesHost.innerHTML = noticesMarkup;
    noticesEl = noticesHost.firstElementChild;
  } else {
    FIELDS.unshift({ name: `${prefix}ModelNotices`, type: 'custom', span: 2, html: noticesMarkup });
  }

  /** 声明面里的模型清单：不用对端在线，目录读不到时它是唯一的选项来源。 */
  const declaredModels = () => (catalog?.declared?.models ?? []).filter((item) => item?.id);

  /** 当前选中的提供方 / 模型：实时目录与声明清单只共用一个 id，取到哪边用哪边。 */
  function selected() {
    const providers = catalog?.view?.providers ?? [];
    const provider = providers.find((p) => p.id === control('Provider')?.value) ?? null;
    const modelId = String(modelSelect()?.value ?? '');
    return {
      provider,
      model: provider?.models?.find((item) => item.id === modelId) ?? null,
      declared: modelId ? declaredModels().find((item) => item.id === modelId) ?? null : null,
    };
  }

  /** 模型下拉：有实时目录就跟着提供方走；读不到就按声明清单铺（可编辑）。 */
  function fillModelOptions(preferred = '') {
    const select = modelSelect();
    if (!select) return;
    const live = (catalog?.view?.providers ?? []).length > 0;
    const { provider } = selected();
    const items = live
      ? (provider?.models ?? []).map((m) => ({
        value: m.id,
        label: `${m.name}${m.name !== m.id ? `（${m.id}）` : ''}${m.vision === 'yes' ? ' · 能看图' : ''}`,
      }))
      : declaredModels().map((m) => ({
        value: m.id,
        label: `${m.label || m.id}${m.label && m.label !== m.id ? `（${m.id}）` : ''}${m.vision === true ? ' · 能看图' : ''}`,
      }));
    if (!items.length) {
      // 既没有实时目录、平台也没声明模型清单：只能保留原值（保存照旧可用，写口不拦）。
      const keep = String(preferred || select.value || '');
      setSelectOptions(select, [{ value: keep, label: keep || '（未设置）' }], keep);
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const want = [preferred, select.value, items[0]?.value].find((v) => v && items.some((x) => x.value === v)) ?? '';
    setSelectOptions(select, items, want);
  }

  /** 把声明面的档位清单（`{id,label}` 或纯 id）拍成 `{id,name}`。 */
  function effortEntries(list) {
    return (list ?? [])
      .map((item) => (typeof item === 'string' ? { id: item, name: '' } : { id: item?.id, name: item?.label ?? item?.name ?? '' }))
      .filter((item) => item.id);
  }

  /** 档位下拉：档位是模型的属性 —— 实时目录逐模型给，读不到时按声明面回落。 */
  function fillEffortOptions(preferred = '') {
    const select = control('Effort');
    if (!select) return;
    const { model, declared } = selected();
    const declaredCatalog = catalog?.declared ?? null;
    let efforts = [];
    if (model) efforts = effortEntries(model.efforts);
    else if (effortEntries(declared?.efforts).length) efforts = effortEntries(declared.efforts);
    else if (effortEntries(declaredCatalog?.efforts).length) efforts = effortEntries(declaredCatalog.efforts);
    else efforts = effortEntries(declaredCatalog?.effortFallback);
    if (!efforts.length) {
      setSelectOptions(select, [{ value: '', label: model ? '该模型没有思考档位' : '目录不可用' }], '');
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const labels = new Map(effortEntries(declaredCatalog?.efforts).map((item) => [item.id, item.name]));
    const items = efforts.map((effort) => ({
      value: effort.id,
      label: `${labels.get(effort.id) || effort.name || effort.id}${effort.id === model?.defaultEffort ? '（默认）' : ''}${effort.id === 'off' ? ' · 关闭思考' : ''}`,
    }));
    const want = [preferred, select.value, model?.defaultEffort, items[0]?.value].find((v) => v && items.some((x) => x.value === v)) ?? '';
    setSelectOptions(select, items, want);
  }

  /** 提示条：目录状态、第三方提供方、关思考、看图降级——都是「改之前该知道」的事实。 */
  function renderNotices() {
    // 没传 noticesHost 时，空位是字段表画出来的，画完才拿得到。
    noticesEl ??= control('Notices');
    if (!noticesEl) return;
    noticesEl.replaceChildren();
    const { provider, model } = selected();
    const vision = control('Vision')?.value ?? 'auto';
    const effort = control('Effort')?.value ?? '';
    if (catalog?.error) {
      mountAlert(noticesEl, {
        boxed: true,
        type: 'warning',
        title: '实时目录不可用',
        description: declaredModels().length
          ? `${catalog.error}。模型与档位按平台的声明清单铺，保存时不校验；连上执行体后刷新一次即可看到实际可用的提供方。`
          : `${catalog.error}。这个平台没有声明模型清单，只能保留当前设置；连上执行体后刷新一次即可看到实际可用的模型。`,
      });
    }
    if ((catalog?.view?.failures ?? []).length) {
      mountAlert(noticesEl, {
        boxed: true,
        type: 'info',
        title: '有提供方没读到',
        description: catalog.view.failures.map((item) => `${item.name || item.id}（${item.message || '未说明'}）`).join('、'),
      });
    }
    if (provider?.thirdParty) {
      mountAlert(noticesEl, {
        boxed: true,
        type: 'warning',
        title: '第三方提供方',
        description: `${provider.name || provider.id} 不是平台自己的提供方：会话内容（群友消息、图片、人格卡、记忆）会发给它处理，切换前先确认它的隐私政策。`,
      });
    }
    if (effort === 'off') {
      mountAlert(noticesEl, { boxed: true, type: 'warning', title: '思考已关闭', description: '回复更快，但工具调用、读群判断和人格一致性可能变差。' });
    }
    // 看图能力：实时目录优先，读不到时用声明面的 `vision: true/false`。
    const selectedId = model?.id ?? String(saved.model ?? '');
    const declaredVision = declaredModels().find((item) => item.id === selectedId)?.vision === true;
    const sees = vision === 'yes' || (vision === 'auto' && (model?.vision === 'yes' || (!model && declaredVision)));
    if (!sees) {
      mountAlert(noticesEl, {
        boxed: true,
        type: 'info',
        title: '图片会变成文字占位',
        description: vision === 'no'
          ? '已设为不能看图：会话里的图片、表情会改成文字占位。'
          : '这个模型能不能看图未知，按不能看图处理：图片、表情会改成文字占位；确认它能看图就选「能看图」。',
      });
    }
  }

  /** 用目录重新铺一遍四个控件；目录读不到时模型与档位按声明清单铺，提供方保持原值。 */
  function fillFields(next, config) {
    const providerSelect = control('Provider');
    const model = modelSelect();
    const visionSelect = control('Vision');
    if (!providerSelect || !model || !visionSelect) return;
    const providers = next?.view?.providers ?? [];
    const wantProvider = String(config.provider ?? '');
    providerSelect.disabled = !providers.length;
    if (!providers.length) {
      setSelectOptions(providerSelect, [{ value: wantProvider, label: wantProvider || '（未设置）' }], wantProvider);
    } else {
      setSelectOptions(providerSelect, providers.map((p) => ({
        value: p.id,
        label: `${p.name}${p.name !== p.id ? `（${p.id}）` : ''}${p.thirdParty ? ' · 第三方' : ''}`,
      })), providers.some((p) => p.id === wantProvider) ? wantProvider : providers[0].id);
    }
    fillModelOptions(String(config.model ?? ''));
    fillEffortOptions(String(config.reasoningEffort ?? ''));
    const vision = String(config.vision ?? 'auto');
    visionSelect.value = ['yes', 'no', 'auto'].includes(vision) ? vision : 'auto';
    renderNotices();
  }

  /** 拉（或强制刷新）模型目录：读不到也是结论，靠提示条说明原因。 */
  async function refresh({ announce = true } = {}) {
    if (announce) setStatus('读取目录中…');
    try {
      catalog = await loadModelCatalog(id, { force: announce });
    } catch (error) {
      catalog = { declared: declaredModelCatalog(id), live: null, view: null, error: String(error?.message ?? error), unsupported: false };
    }
    // 等网络回来时宿主可能已经被重画：那时不再改 DOM。
    if (!host.isConnected || !control('Provider')) return;
    fillFields(catalog, saved);
    if (announce) setStatus(catalog.live ? '目录已刷新' : '目录不可用');
  }

  /**
   * 保存模型选项：与平台的「配置」同一个写口，服务端按实时目录再校验一次。
   * 返回结论而不是抛出：调用方可能还要紧接着做别的（卡片级保存），得知道这一半成没成。
   */
  async function save() {
    const provider = control('Provider');
    const model = modelSelect();
    const effort = control('Effort');
    const vision = control('Vision');
    const patch = {
      provider: provider?.value ?? '',
      model: model?.value ?? '',
      // 无档位的模型不带 reasoningEffort：空值就是「用模型默认」。
      reasoningEffort: effort?.disabled ? '' : (effort?.value ?? ''),
      vision: vision?.value ?? 'auto',
    };
    // 换到第三方提供方：保存前再确认一次（会话内容会发给它处理）。
    const thirdParty = (catalog?.view?.providers ?? []).find((p) => p.id === patch.provider)?.thirdParty === true;
    if (thirdParty && patch.provider !== String(saved.provider ?? '')
      && !(await confirmBox({
        title: '切换第三方提供方',
        message: `${patch.provider} 不是平台自己的提供方。保存后，会话里的聊天内容（群友消息、图片、人格卡、记忆）会发给它处理。确定要切换吗？`,
        confirmText: '切换',
      }))) {
      const message = '已取消（未切换提供方）';
      setStatus(message);
      return { ok: false, canceled: true, message };
    }
    setStatus('保存中…');
    let message = '';
    try {
      const r = await api(`/api/platforms/registry/agent/${encodeURIComponent(id)}/config`, 'PATCH', patch);
      if (!r?.ok) throw new Error(r?.error || '未知错误');
      const note = (r.warnings ?? []).filter(Boolean).join('；');
      saved = { ...patch };
      message = `已设为 ${patch.provider}/${patch.model}（${patch.reasoningEffort || '模型默认强度'}）${note ? ` · ${note}` : ''}`;
      setStatus(`${message}，下一条消息生效`);
      if (toast) showConsoleToast('模型设置已保存');
    } catch (error) {
      message = `模型设置保存失败：${error?.message ?? error}`;
      setStatus(message, 'err');
      return { ok: false, message };
    }
    onSaved?.();
    return { ok: true, message };
  }

  // 监听挂在宿主机上：同一个宿主可能反复挂载（换平台），必须能解绑，否则一次点击会重复保存。
  const abort = new AbortController();
  host.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(`#${prefix}ModelRefresh`)) { void refresh({ announce: true }); return; }
    if (event.target.closest(`#${prefix}ModelSave`)) void save();
  }, { signal: abort.signal });
  host.addEventListener('change', (event) => {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!select) return;
    if (select.id === `${prefix}ModelProvider`) { fillModelOptions(); fillEffortOptions(); renderNotices(); }
    else if (select.id === `${prefix}Model`) { fillEffortOptions(); renderNotices(); }
    else if (select.id === `${prefix}ModelEffort` || select.id === `${prefix}ModelVision`) renderNotices();
  }, { signal: abort.signal });

  renderFields(host, FIELDS, { columns: 1 });
  // 声明面先画（档位中文名、看图声明立即有），实时目录回来再补提供方与模型。
  fillFields(catalog, saved);
  if (onStatus) {
    // 卡片级状态位归调用方：初次静默读目录不占它，否则会盖掉保存结论。
    void refresh({ announce: false });
  } else {
    setStatus('读取目录中…');
    // 只清自己写的那一句：期间外层可能已经把状态改成「保存中…」之类。
    void refresh({ announce: false }).then(() => { if (lastStatus === '读取目录中…') setStatus(''); });
  }
  return {
    reload: () => refresh({ announce: true }),
    refresh: (options) => refresh(options),
    save,
    destroy: () => { destroyed = true; abort.abort(); noticesEl?.replaceChildren(); },
  };
}
