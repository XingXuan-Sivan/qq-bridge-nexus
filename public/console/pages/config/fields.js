// 全局配置页只复用总览页的字段规格，不复制一份：字段定义保留在 overview/fields.js，
// 避免同一组 id 在两个页面源码里各写一遍，也避免两页同时加载时 id 冲突。
import { OVERVIEW_FIELDS } from '../overview/fields.js';

export const CONFIG_FIELDS = {
  mode: OVERVIEW_FIELDS.mode,
  sendLimit: OVERVIEW_FIELDS.sendLimit,
  silence: OVERVIEW_FIELDS.silence,
  dsh: OVERVIEW_FIELDS.dsh,
};
