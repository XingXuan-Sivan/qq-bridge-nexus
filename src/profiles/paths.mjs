// 四层模型（平台 / 代理平台 / 方案 / 会话权限）的目录常量。
// 所有「数据在哪」的判断只从这里来，别处不要自己拼 profiles 路径。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROFILES_ROOT = path.join(REPO_ROOT, 'profiles');
export const PLATFORMS_ROOT = path.join(PROFILES_ROOT, 'platforms');
export const AGENT_PLATFORMS_ROOT = path.join(PROFILES_ROOT, 'agent-platforms');
export const PLANS_ROOT = path.join(PROFILES_ROOT, 'plans');
export const SCHEMAS_ROOT = path.join(PROFILES_ROOT, 'schemas');

export function platformDir(platformId) {
  return path.join(PLATFORMS_ROOT, platformId);
}

export function agentPlatformDir(agentPlatformId) {
  return path.join(AGENT_PLATFORMS_ROOT, agentPlatformId);
}
