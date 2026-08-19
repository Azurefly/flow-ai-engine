import { createUser } from "../server/internal-auth";

const username = "browser_audit";
const password = "FlowAudit#2026!";

try {
  const id = await createUser({ username, password, name: "浏览器验收管理员", role: "admin" });
  console.log(JSON.stringify({ id, username, password }));
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
