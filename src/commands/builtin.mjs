// 桥接内置命令（P7 第二步从 bridge.js 抽出的「壳」）。
//
// 这里只放三类东西：命令元数据、参数解析、对用户的回执文案。任何需要碰桥接内存态
// 的动作都走 deps 注入——`/reset` 那 30 个内存态与 4 个定时器仍是 bridge.js 自己的事，
// 由 `session.reset(key)` 承担。这样本模块不 import 桥接的任何东西，可以用假 deps 单测。
//
// 契约见 docs/COMMAND_REGISTRY.md；注册表见 ./registry.mjs。

/**
 * @param {{
 *   send: (key:string, text:string) => Promise<any>,
 *   session: { current:(key:string)=>string|null, reset:(key:string)=>Promise<{ok:boolean,note?:string}> },
 *   acl: { allowed:(kind:string,id:string,cfg:object)=>boolean },
 *   role: {
 *     read: () => object,
 *     writeFull: (next:object) => void,
 *     withKeyFor: (state:object, key:string, mode:string, name?:string) => object,
 *     nameFor: (state:object, key:string) => string|null,
 *     sourceFor: (state:object, key:string) => string,
 *     sanitize: (name:string) => string,
 *     exists: (name:string) => boolean,
 *     setGlobalMode: (mode:'silent'|'active') => void,
 *   },
 *   permission?: {
 *     describe: (key:string) => Promise<string>|string,
 *     set: (key:string, level:string) => Promise<{ok:boolean, text?:string, error?:string}>,
 *   },
 *   log?: (msg:string) => void,
 * }} deps
 */
async function commandPermission(ctx) {
  const { send, permission } = depsRef;
  if (!permission) { await send(ctx.key, '权限命令不可用：桥接没有注入权限模块'); return; }
  const arg = String(ctx.arg || '').trim();
  if (!arg || arg === 'show') { await send(ctx.key, await permission.describe(ctx.key)); return; }
  const result = await permission.set(ctx.key, arg);
  await send(ctx.key, result.ok ? result.text : `切换失败：${result.error ?? '未知原因'}`);
}

let depsRef = null;

export function createBuiltinCommands(deps) {
  depsRef = deps;
  const { send, session, acl, role, permission } = deps;
  depsRef = deps;
  const log = deps.log ?? (() => {});

  async function commandReset(ctx) {
    const result = await session.reset(ctx.key);
    return result ?? { ok: true };
  }

  async function commandStatus(ctx) {
    const rs = role.read();
    const source = role.sourceFor(rs, ctx.key);
    const name = role.nameFor(rs, ctx.key) ?? '无';
    const suffix = source === 'global' ? '' : '（本会话单独设置）';
    const whitelist = acl.allowed(ctx.kind, ctx.id, ctx.cfg) ? '通过' : '拦截';
    await send(ctx.key, `会话 ${session.current(ctx.key) ?? '未创建'}；白名单 ${whitelist}；角色 ${name}${suffix}；模式 ${rs.mode}`);
    return { ok: true };
  }

  // /role 只对当前所在的会话生效（在群里发切本群，私聊发切这个私聊）；全局默认人格在控制台改。
  //   /role 名字    本会话用这张卡
  //   /role off     本会话不挂角色卡（clear 同义）
  //   /role default 本会话回到全局默认
  //   /role         看本会话现在用哪张卡
  async function commandRole(ctx) {
    const { key } = ctx;
    const arg = String(ctx.arg ?? '').trim();
    const rs = role.read();
    const globalText = rs.role ? `全局默认是「${rs.role}」` : '全局默认不挂角色卡';
    if (!arg) {
      const src = role.sourceFor(rs, key);
      const now = role.nameFor(rs, key);
      const nowText = src === 'off' ? '本会话不挂角色卡（单独设置）' : src === 'key' ? `本会话单独用「${now}」` : `本会话跟随全局默认（${rs.role ? `「${rs.role}」` : '不挂角色卡'}）`;
      await send(key, `${nowText}。用法：/role 名字（本会话换卡）、/role off（本会话不挂卡）、/role default（回到全局默认）。全局默认在控制台改。`);
    } else if (arg === 'off' || arg === 'clear') {
      role.writeFull(role.withKeyFor(rs, key, 'off'));
      log(`管理员命令：${key} 不挂角色卡`);
      await send(key, `已关闭本会话的角色卡，只影响这里（${globalText}）。`);
    } else if (arg === 'default') {
      role.writeFull(role.withKeyFor(rs, key, 'default'));
      log(`管理员命令：${key} 回到全局默认人格`);
      await send(key, `本会话已回到全局默认（${globalText}）。`);
    } else {
      const name = role.sanitize(arg);
      if (!name || !role.exists(name)) {
        await send(key, `角色「${name || arg}」不存在。角色文件放 qq-bridge/roles/ 目录。`);
      } else {
        role.writeFull(role.withKeyFor(rs, key, 'role', name));
        log(`管理员命令：${key} 切换角色为 ${name}`);
        await send(key, `本会话已切换角色：${name}，只影响这里（${globalText}）。`);
      }
    }
    return { ok: true };
  }

  async function commandSilent(ctx) {
    role.setGlobalMode('silent');
    await send(ctx.key, '已进入静默模式：群友消息不再回复，仅管理员可对话。');
    return { ok: true };
  }

  async function commandActive(ctx) {
    role.setGlobalMode('active');
    await send(ctx.key, '已退出静默模式，恢复正常回复。');
    return { ok: true };
  }

  return [
    {
      id: 'reset', name: '/reset', aliases: ['/new'], scope: 'all', permission: 'owner',
      group: '会话', help: '重置本会话上下文，下次消息开新会话', handler: commandReset,
    },
    {
      id: 'status', name: '/status', scope: 'all', permission: 'owner',
      group: '会话', help: '查看本会话的会话、白名单、角色与模式', handler: commandStatus,
    },
    {
      id: 'role', name: '/role', scope: 'all', permission: 'owner',
      group: '人格', help: '查看/切换本会话的人格卡（off 不挂卡，default 回全局）', handler: commandRole,
    },
    {
      id: 'silent', name: '/silent', aliases: ['/quiet'], scope: 'all', permission: 'owner',
      group: '会话', help: '进入静默模式：群友消息不再回复', handler: commandSilent,
    },
    {
      id: 'active', name: '/active', aliases: ['/speak'], scope: 'all', permission: 'owner',
      group: '会话', help: '退出静默模式', handler: commandActive,
    },
    {
      id: 'perm', name: '/perm', scope: 'all', permission: 'owner',
      group: '会话', help: '查看/切换本会话的 DSH 权限级别（read-only|workspace-write|full-ask|full）', handler: commandPermission,
    },
  ];
}
