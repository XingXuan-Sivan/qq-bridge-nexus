// 全局配置页只复用总览页的字段规格，不复制一份：字段定义保留在 overview/fields.js，
// 避免同一组 id 在两个页面源码里各写一遍，也避免两页同时加载时 id 冲突。
// 「Agent 平台」卡只属于全局配置（总览页不装配），所以它的字段写在这里。
import { OVERVIEW_FIELDS } from '../overview/fields.js';

// 默认 Agent 平台 + 模型设置：配置面与运行期是两个事实 —— 换默认只落盘，本进程仍装配原来那个，
// 所以选择框的提示直接写明这一点；运行期状态不在这张卡里重复一遍，「探活」按钮给出
// 当下的连通结论。
const AGENT_FIELDS = {
  fields: [
    {
      name: 'agentDefaultSelect',
      type: 'select',
      label: '默认 Agent 平台',
      options: [],
      hint: '下次启动桥接时装配它，改这里不影响本进程；模型设置写下去后下一条消息生效。',
    },
  ],
};

// 动作条排在模型控件之后：卡里先选平台、看它的模型，最后才是「刷新」「探活」「保存」。
const AGENT_ACTIONS = {
  fields: [
    {
      type: 'action',
      id: 'agentActions',
      items: [
        { id: 'agentRefresh', label: '刷新' },
        { id: 'agentProbe', label: '探活' },
        { id: 'agentSave', label: '保存', variant: 'primary' },
      ],
      status: 'agentMsg',
    },
  ],
};

export const CONFIG_FIELDS = {
  mode: OVERVIEW_FIELDS.mode,
  agent: AGENT_FIELDS,
  agentActions: AGENT_ACTIONS,
  roleDefault: OVERVIEW_FIELDS.roleDefault,
  personaSettings: OVERVIEW_FIELDS.personaSettings,
  permission: OVERVIEW_FIELDS.permission,
  sendLimit: OVERVIEW_FIELDS.sendLimit,
  silence: OVERVIEW_FIELDS.silence,
};
