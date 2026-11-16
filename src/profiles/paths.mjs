// 四层模型（平台 / 代理平台 / 能力档 / 会话）的目录常量。
// 所有「数据在哪」的判断只从这里来，别处不要自己拼 profiles 路径。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROFILES_ROOT = path.join(REPO_ROOT, 'profiles');
export const PLATFORMS_ROOT = path.join(PROFILES_ROOT, 'platforms');
export const AGENT_PLATFORMS_ROOT = path.join(PROFILES_ROOT, 'agent-platforms');
export const BEHAVIOR_ENGINES_ROOT = path.join(PROFILES_ROOT, 'behavior-engines');
export const SCHEMAS_ROOT = path.join(PROFILES_ROOT, 'schemas');
/** 与 Agent 平台无关的能力档（直通档等）：所有 Agent 平台都能取到，平台目录里的同名档优先。 */
export const SHARED_CAPABILITIES_DIR = path.join(PROFILES_ROOT, 'capabilities');

export function platformDir(platformId) {
  return path.join(PLATFORMS_ROOT, platformId);
}

export function agentPlatformDir(agentPlatformId) {
  return path.join(AGENT_PLATFORMS_ROOT, agentPlatformId);
}

/** 某个 Agent 平台自己的能力档目录（capabilities/<id>.yml）。 */
export function agentCapabilitiesDir(agentPlatformId) {
  return path.join(agentPlatformDir(agentPlatformId), 'capabilities');
}
