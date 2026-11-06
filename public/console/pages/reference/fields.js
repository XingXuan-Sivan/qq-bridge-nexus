// 工具参考：纯静态文档表。表体复用 tableHtml（这里是「只需要表格本身」的场景，
// 不加工具栏与分页），外层用 .table-wrap 与其它页保持同一套边框/表头样式。
import { tableHtml } from '../../components/table/table.js';

const TOOLS = [
  ['qq_status', '登录状态（只读）'],
  ['qq_list_groups', '群列表（只返回白名单群）'],
  ['qq_get_group_members', '群成员（只读，群号必须白名单）'],
  ['qq_get_group_history', '群历史（只读，含 message_id，可作引用目标）'],
  ['qq_send_group_message', '发群消息；可选 <code>replyToMessageId</code> 引用/回复'],
  ['qq_reply', '专用「引用/回复」：在群里引用某条消息并发送文本'],
  ['qq_send_private_message', '发私聊；可选 <code>replyToMessageId</code> 引用/回复'],
  ['qq_slang_query', '查询已确认黑话/梗/网络表达（只读）'],
  ['qq_slang_submit', 'AI 提交陌生词/黑话给管理员筛选'],
];

const TABLE_HTML = `<div class="table-wrap" id="referenceTools">${tableHtml(
  [{ label: '工具', width: '260px' }, { label: '说明' }],
  TOOLS.map(([name, note]) => [`<code>${name}</code>`, note]),
)}</div>`;

export const REFERENCE_FIELDS = {
  main: {
    fields: [{ name: 'referenceTools', type: 'custom', span: 2, html: TABLE_HTML }],
  },
};
