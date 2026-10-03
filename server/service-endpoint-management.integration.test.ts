import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { createIntegrationAdmin } from "./integration-user-test-support";
import { resolveProjectServiceEndpoint } from "./service-endpoint-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
let pool: mysql.Pool | undefined;
let projectId: string | undefined;
const userIds: number[] = [];

function caller(user: TrpcContext["user"]) {
  return appRouter.createCaller({
    user,
    req: { headers: {}, protocol: "http" },
    res: {},
  } as unknown as TrpcContext);
}

describe("项目服务端点目录与选择权限", () => {
  afterAll(async () => {
    if (!pool) return;
    if (projectId) {
      await pool.query(
        "DELETE FROM project_service_endpoint WHERE projectId=?",
        [projectId]
      );
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [
        projectId,
      ]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    if (userIds.length) {
      await pool.query(
        "DELETE FROM authorization_audit_log WHERE actorUserId IN (?) OR targetUserId IN (?)",
        [userIds, userIds]
      );
      await pool.query("DELETE FROM users WHERE id IN (?)", [userIds]);
    }
    await pool.end();
  });

  runIntegration(
    "管理员可维护端点，查看者可选择本项目端点，未授权人员无法读取",
    async () => {
      pool = mysql.createPool(process.env.DATABASE_URL!);
      const identities = [];
      for (const prefix of [
        "endpoint_owner",
        "endpoint_viewer",
        "endpoint_outsider",
      ]) {
        const identity = await createIntegrationAdmin(pool, prefix);
        userIds.push(identity.id);
        identities.push(identity);
      }
      const [owner, viewer, outsider] = identities;
      for (const identity of [viewer, outsider]) {
        await pool.query("UPDATE users SET role='user' WHERE id=?", [
          identity.id,
        ]);
        identity.role = "user";
      }
      const manager = caller(owner);
      projectId = (
        await manager.project.create({
          code: `EP${owner.id}`,
          name: "服务端点独立验收",
        })
      ).id;
      await manager.project.grantMember({
        projectId,
        userId: viewer.id,
        role: "viewer",
      });
      const endpointId = (
        await manager.project.createServiceEndpoint({
          projectId,
          refCode: "ORDERS_TEST",
          name: "订单服务测试环境",
          baseUrl: "https://api.example.invalid/v1/",
          targetEnvironment: "test",
          secretRef: "env:FLOW_SECRET_ENDPOINT_ACCEPTANCE",
          authHeaderName: "Authorization",
          authScheme: "Bearer",
        })
      ).id;
      const visible = await caller(viewer).project.serviceEndpoints({
        projectId,
      });
      expect(visible).toHaveLength(1);
      expect(visible[0]).toMatchObject({
        refCode: "ORDERS_TEST",
        name: "订单服务测试环境",
        status: "active",
        targetEnvironment: "test",
        secretRef: "env:FLOW_SECRET_ENDPOINT_ACCEPTANCE",
      });
      expect(visible[0]).not.toHaveProperty("secretValue");
      await expect(
        caller(outsider).project.serviceEndpoints({ projectId })
      ).rejects.toThrow("无权");
      await expect(
        caller(viewer).project.setServiceEndpointStatus({
          projectId,
          id: endpointId,
          status: "disabled",
        })
      ).rejects.toThrow("无权");
      await manager.project.setServiceEndpointStatus({
        projectId,
        id: endpointId,
        status: "disabled",
      });
      expect(
        (await caller(viewer).project.serviceEndpoints({ projectId }))[0].status
      ).toBe("disabled");
      await expect(
        resolveProjectServiceEndpoint(projectId, "ORDERS_TEST")
      ).rejects.toThrow();
      await manager.project.setServiceEndpointEnvironment({
        projectId,
        id: endpointId,
        targetEnvironment: "staging",
      });
      await manager.project.setServiceEndpointStatus({
        projectId,
        id: endpointId,
        status: "active",
      });
      expect(
        (await caller(viewer).project.serviceEndpoints({ projectId }))[0]
      ).toMatchObject({ targetEnvironment: "staging", status: "active" });
      await expect(
        resolveProjectServiceEndpoint(projectId, "ORDERS_TEST")
      ).resolves.toMatchObject({
        refCode: "ORDERS_TEST",
        targetEnvironment: "staging",
      });
    },
    30_000
  );
});
