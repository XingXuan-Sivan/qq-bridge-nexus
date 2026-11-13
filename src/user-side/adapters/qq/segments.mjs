// 中立段 → OneBot v11 消息段。
//
// 这是 QQ 的**报文事实**：OneBot 用 `at` 表 @、`record` 表语音、引用是
// `{type:'reply', data:{id}}`。这些名字不该出现在内核里，所以映射只住在
// 适配器目录内（与 onebot.mjs 的分工：那边拼 action/params，这边拼 message 数组）。
//
// 只做「名字与字段」的搬运，不做能力判断：能不能发由内核按 capabilities 判，
// 降级也在内核做完了。走到这里的段一定是 QQ 声明支持的类型。
import { segmentError } from '../../segments.mjs';

/** 中立段数组 → OneBot v11 message 数组（保持顺序与字段值）。 */
export function toOneBotSegments(segments) {
  if (!Array.isArray(segments)) throw segmentError('invalid_segment', '消息段必须是数组');
  return segments.map((segment) => {
    const data = segment?.data ?? {};
    switch (segment?.type) {
      case 'text':
        return { type: 'text', data: { text: String(data.text ?? '') } };
      case 'mention': {
        // OneBot 的 @ 目标只能是数字 QQ 号；`all` 在 OneBot 里代表 @全体成员。
        // 内核只拦空值与 all（那是跨平台的滥用面），具体的 id 规则属于平台事实，所以校验住在这里。
        const target = String(data.target ?? '').trim();
        if (!/^[1-9]\d*$/.test(target)) {
          throw segmentError('invalid_segment', `QQ 的 @ 目标必须是正整数 QQ 号：${target || '(空)'}`);
        }
        return { type: 'at', data: { qq: target } };
      }
      case 'reply':
        return { type: 'reply', data: { id: String(data.messageId ?? '') } };
      case 'image':
      case 'video':
      case 'file':
        return { type: segment.type, data: { ...data } };
      case 'voice':
        // OneBot 的语音段叫 record；file 与 url 二选一，url 时按 QQ 的 http(s) 地址直传。
        return { type: 'record', data: data.file ? { file: String(data.file) } : { file: String(data.url ?? '') } };
      case 'sticker':
        // QQ 没有独立的贴纸段：贴纸就是图片。只有 id 没有图片地址时发不出去。
        if (!data.url) throw segmentError('unsupported_segment', 'QQ 发贴纸需要图片地址（url），只有 id 无法发送');
        return { type: 'image', data: { file: String(data.url) } };
      case 'forward':
        if (!data.id) throw segmentError('unsupported_segment', 'QQ 只能按 id 转发既有合并转发（messages 形态需 send_forward_msg）');
        return { type: 'forward', data: { id: String(data.id) } };
      case 'poke':
        // 拍一拍在 OneBot 里不是消息段而是独立动作，由调用方走 friend_poke / group_poke。
        throw segmentError('unsupported_segment', 'QQ 的拍一拍是独立动作（*_poke），不能混在消息段里');
      default:
        throw segmentError('unsupported_segment', `QQ 不支持的消息段：${segment?.type}`);
    }
  });
}
