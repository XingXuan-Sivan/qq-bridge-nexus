// 二代仿真配置的字段规格：条目即字段，渲染由 components/form 的 renderFields 统一负责。
// 由 page.html 的旧 .row 结构一次性抽取而来，后续改字段请改这里，不要再往 HTML 里手写控件。
export const V2_FIELDS = {
  "header": {
    "label": "顶部开关与预设",
    "fields": [
      {
        "name": "v2Enabled",
        "type": "switch",
        "label": "启用二代模式"
      },
      {
        "name": "v2AgentPreset",
        "type": "text",
        "label": "agentPreset",
        "placeholder": "qq-chat-v2"
      },
      {
        "name": "v2ProvideRecommendations",
        "type": "switch",
        "label": "提供推荐值给 AI",
        "hint": "关闭后 qq_get_prompt 不再返回推荐值，AI 完全自主判断。"
      }
    ]
  },
  "2": {
    "label": "唤醒推荐值（仅参考，AI 可不遵守）",
    "fields": [
      {
        "name": "v2WakeDefaultMode",
        "type": "select",
        "label": "默认模式",
        "options": [
          {
            "value": "diving",
            "label": "潜水"
          },
          {
            "value": "active",
            "label": "活跃"
          }
        ]
      },
      {
        "name": "v2RecDefaultInfinite",
        "type": "switch",
        "label": "默认下一次唤醒：无限期（永久）"
      },
      {
        "name": "v2RecSleepMin",
        "type": "number",
        "label": "推荐潜水时长（分）",
        "min": 1
      },
      {
        "name": "v2RecSleepMax",
        "type": "number",
        "label": "推荐潜水时长 · 上限（分）",
        "min": 1
      },
      {
        "name": "v2RecProb",
        "type": "number",
        "label": "推荐普通消息概率",
        "min": 0,
        "max": 1,
        "step": 0.05
      },
      {
        "name": "v2RecKeywords",
        "type": "text",
        "span": 2,
        "label": "推荐关键词（逗号分隔）",
        "placeholder": "小鲸鱼, DeepSeek"
      },
      {
        "name": "v2RecAt",
        "type": "switch",
        "label": "推荐 @ 唤醒"
      },
      {
        "name": "v2RecName",
        "type": "switch",
        "label": "推荐名字唤醒"
      },
      {
        "name": "v2RecQuestion",
        "type": "switch",
        "label": "推荐提问唤醒"
      },
      {
        "name": "v2RecPoke",
        "type": "switch",
        "label": "推荐拍一拍唤醒"
      }
    ]
  },
  "3": {
    "label": "唤醒硬限制",
    "fields": [
      {
        "name": "v2SleepMinMs",
        "type": "number",
        "label": "最小潜水（秒）",
        "min": 0
      },
      {
        "name": "v2SleepMaxMs",
        "type": "number",
        "label": "最大潜水（秒，0=不限）",
        "min": 0
      },
      {
        "name": "v2MaxWakeMin",
        "type": "number",
        "label": "每分钟最多唤醒",
        "min": 0
      },
      {
        "name": "v2MaxWakeHour",
        "type": "number",
        "label": "每小时最多唤醒",
        "min": 0
      },
      {
        "name": "v2BatchWindowMs",
        "type": "number",
        "label": "合并窗口（毫秒）",
        "min": 1000,
        "step": 500
      },
      {
        "name": "v2NoActionLimit",
        "type": "number",
        "label": "无行动兜底次数",
        "min": 1
      },
      {
        "name": "v2MaxWakeConfigReminders",
        "type": "number",
        "label": "唤醒收尾提醒次数",
        "min": 1
      },
      {
        "name": "v2PreSleepWaitEnabled",
        "type": "switch",
        "label": "启用沉睡前强制等待"
      },
      {
        "name": "v2PreSleepWaitMin",
        "type": "number",
        "label": "沉睡前强制等待（分）",
        "min": 0,
        "step": 1
      }
    ]
  },
  "4": {
    "label": "发送限制",
    "fields": [
      {
        "name": "v2BurstEnabled",
        "type": "switch",
        "label": "允许多条发送"
      },
      {
        "name": "v2BurstMax",
        "type": "number",
        "label": "单次最多条数",
        "min": 1
      },
      {
        "name": "v2BurstMin",
        "type": "number",
        "label": "条间间隔（毫秒）",
        "min": 0
      },
      {
        "name": "v2BurstMaxMs",
        "type": "number",
        "label": "连发窗口 · 上限（毫秒）",
        "min": 0
      },
      {
        "name": "v2LongGapProb",
        "type": "number",
        "label": "长间隔概率",
        "min": 0,
        "max": 1,
        "step": 0.05
      },
      {
        "name": "v2LongGapMin",
        "type": "number",
        "label": "长间隔范围（毫秒）",
        "min": 0
      },
      {
        "name": "v2LongGapMax",
        "type": "number",
        "label": "长间隔 · 上限（毫秒）",
        "min": 0
      },
      {
        "name": "v2MaxSendMin",
        "type": "number",
        "label": "每分钟最多发送",
        "min": 0
      },
      {
        "name": "v2MaxSendHour",
        "type": "number",
        "label": "每小时最多发送",
        "min": 0
      },
      {
        "name": "v2MaxMsgChars",
        "type": "number",
        "label": "单条最大字符",
        "min": 1
      },
      {
        "name": "v2MaxGapMs",
        "type": "number",
        "label": "最大条间隔（毫秒，防止过长）",
        "min": 100
      },
      {
        "name": "v2GapBaseMs",
        "type": "number",
        "label": "按字数基础间隔（毫秒）",
        "min": 0
      },
      {
        "name": "v2GapPerCharMs",
        "type": "number",
        "label": "每字追加（毫秒）",
        "min": 0
      }
    ]
  },
  "5": {
    "label": "等待工具参数（qq_wait_for_messages）",
    "fields": [
      {
        "name": "v2WaitDefaultMs",
        "type": "number",
        "label": "默认等待（毫秒）",
        "min": 100
      },
      {
        "name": "v2WaitMinMs",
        "type": "number",
        "label": "最小等待（毫秒）",
        "min": 100
      },
      {
        "name": "v2WaitMaxMs",
        "type": "number",
        "label": "最大等待（毫秒）",
        "min": 100
      },
      {
        "name": "v2WaitDefaultQuietMs",
        "type": "number",
        "label": "默认静默窗口（毫秒）",
        "min": 0
      },
      {
        "name": "v2MinQuietAfterNewMs",
        "type": "number",
        "label": "收到新消息后最小静默（毫秒）",
        "min": 0
      },
      {
        "name": "v2AutoReplyCheckSec",
        "type": "number",
        "label": "回复检查延迟（秒）",
        "min": 1
      }
    ]
  },
  "6": {
    "label": "主动机会参数（proactive：群安静时 AI 主动冒泡）",
    "fields": [
      {
        "name": "v2ProactiveEnabled",
        "type": "switch",
        "label": "启用主动机会"
      },
      {
        "name": "v2ProactiveIntervalMin",
        "type": "number",
        "label": "检查间隔（分）",
        "min": 1
      },
      {
        "name": "v2ProactiveIntervalMax",
        "type": "number",
        "label": "主动冒泡间隔 · 上限（分）",
        "min": 1
      },
      {
        "name": "v2ProactiveIdleThreshold",
        "type": "number",
        "label": "安静阈值（分）",
        "min": 1
      },
      {
        "name": "v2ProactiveProbability",
        "type": "number",
        "label": "触发概率",
        "min": 0,
        "max": 1,
        "step": 0.05
      }
    ]
  },
  "7": {
    "label": "表情包参数（sticker：QQ 收藏表情体系）",
    "fields": [
      {
        "name": "v2StickerEnabled",
        "type": "switch",
        "label": "启用表情包体系"
      },
      {
        "name": "v2StickerSyncTtlSec",
        "type": "number",
        "label": "同步缓存 TTL（秒）",
        "min": 1
      },
      {
        "name": "v2StickerMaxList",
        "type": "number",
        "label": "列表最大返回数",
        "min": 1,
        "max": 500
      },
      {
        "name": "v2StickerPromptMax",
        "type": "number",
        "label": "提示中列出常用表情数",
        "min": 1,
        "max": 30
      },
      {
        "name": "v2StickerIncludePrompt",
        "type": "switch",
        "label": "在 prompt/唤醒里附带表情摘要"
      },
      {
        "name": "v2StickerCollectEnabled",
        "type": "switch",
        "label": "AI 收藏表情"
      },
      {
        "name": "v2StickerCollectPerMin",
        "type": "number",
        "label": "每分钟最多收藏",
        "min": 0
      },
      {
        "name": "v2StickerCollectPerHour",
        "type": "number",
        "label": "每小时最多收藏",
        "min": 0
      },
      {
        "name": "v2StickerCollectRemarkMax",
        "type": "number",
        "label": "收藏备注最大字数",
        "min": 1,
        "max": 50
      }
    ]
  },
  "8": {
    "label": "上下文参数（recent / unread / contextWindow）",
    "fields": [
      {
        "name": "v2ContextRecentLimit",
        "type": "number",
        "label": "最近消息上限",
        "min": 1
      },
      {
        "name": "v2ContextUnreadLimit",
        "type": "number",
        "label": "未读上限",
        "min": 1
      },
      {
        "name": "v2ContextWindow",
        "type": "number",
        "label": "上下文窗口",
        "min": 1
      }
    ]
  },
  "9": {
    "label": "反馈工具参数（qq_report_feedback）",
    "fields": [
      {
        "name": "v2FeedbackMaxLength",
        "type": "number",
        "label": "反馈最大长度",
        "min": 1
      },
      {
        "name": "v2FeedbackNotifyOwner",
        "type": "switch",
        "label": "错误级通知 owner"
      }
    ]
  }
};
