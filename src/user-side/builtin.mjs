// 仓库内置用户侧平台的装配点。
//
// 这是「src/ 里唯一允许出现具体用户平台目录」的地方（与 src/agent-side/builtin.mjs
// 对称）：新增平台在这里加一行 import 与一次注册，其余内核模块只认
// src/user-side/user-platform.mjs。
//
// 平台模块只导出常量与纯函数（能力声明、发送调用构造、后端称呼），没有副作用，
// 因此可以在 import 时直接注册；测试若需要空注册表，用 resetUserPlatforms() 清空。
import * as qq from './adapters/qq/index.mjs';
import { registerUserPlatform } from './runtime-registry.mjs';

/** 内置平台清单（顺序即控制台展示顺序）。 */
export const BUILTIN_USER_PLATFORMS = Object.freeze([qq]);

/** 幂等注册；重复调用只是覆盖同 id 的实现。 */
export function registerBuiltinUserPlatforms() {
  for (const impl of BUILTIN_USER_PLATFORMS) registerUserPlatform(impl);
  return BUILTIN_USER_PLATFORMS.map((impl) => impl.id);
}

/**
 * 注入内置平台的后端配置来源（bridge 启动时调一次）。
 *
 * 为什么这样绕一圈：bridge 不得 import adapters/（verify:repo 的不变式），
 * 而「httpUrl / token 从哪来」是适配器自己的事。装配点负责把两边接上，
 * 于是内核只看到一个中立函数，适配器只看到一个提供者函数。
 */
export function configureBuiltinUserPlatformBackend(provider) {
  qq.setOneBotBackend(provider);
}

registerBuiltinUserPlatforms();
