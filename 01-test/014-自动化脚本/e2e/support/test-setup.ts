import { test as base } from '@playwright/test';

// 自定义 fixtures 在此扩展；页面对象由生成技能按需注入。
export const test = base.extend({});
export { expect } from '@playwright/test';
