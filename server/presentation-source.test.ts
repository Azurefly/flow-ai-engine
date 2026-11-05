import { expect, it } from "vitest";
import { inlinePresentationClasses } from "../tests/presentation-source";
it("源约束读取静态组合样式的实际值，仍检查原事件", () => {
  const result = inlinePresentationClasses('const mutedClass = "text-muted-foreground"; const surfaceClass1 = "text-sm " + mutedClass; const x = <p className={surfaceClass1} onClick={save}>内容</p>;');
  expect(result).toContain('const surfaceClass1 = "text-sm text-muted-foreground"');
  expect(result).toContain('<p className="text-sm text-muted-foreground" onClick={save}>内容</p>');
});
it("动态分支、事件、请求、状态和非样式表达式不被替换", () => {
  const source = 'const business = "a" + "b"; const x = <p className={active ? "on" : "off"} onClick={() => api.run(state)}>内容</p>;';
  expect(inlinePresentationClasses(source)).toBe(source);
});
it("不执行函数或循环引用", () => {
  const source = 'const unsafeClass = dangerous(); const cycleClass = cycleClass; const x = <p className={unsafeClass} />; const y = <p className={cycleClass} />;';
  expect(inlinePresentationClasses(source)).toBe(source);
});
