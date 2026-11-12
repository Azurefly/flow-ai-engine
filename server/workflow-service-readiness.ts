import type {
  WorkflowCompileDiagnostic,
  WorkflowDefinition,
} from "./workflow-compiler";
import { resolveProjectServiceEndpoint } from "./service-endpoint-service";
import { resolveExternalSecret } from "./external-secret";
import { assertAllowedHttpPort } from "./http-target-policy";

/** Validate declared service configuration only; never send a request or expose a secret. */
export async function inspectWorkflowServiceConfiguration(
  projectId: string | null | undefined,
  definition: WorkflowDefinition
) {
  const diagnostics: WorkflowCompileDiagnostic[] = [];
  const endpoints = new Map<
    string,
    ReturnType<typeof resolveProjectServiceEndpoint>
  >();
  for (const node of definition.nodes) {
    if (!["http", "rest", "method"].includes(node.type)) continue;
    let field = "endpointRef";
    try {
      const ref = String(node.config.endpointRef ?? "").trim();
      let secretRef = String(node.config.secretRef ?? "").trim();
      if (projectId) {
        if (!ref) throw new Error("请选择项目服务端点。");
        if (!endpoints.has(ref))
          endpoints.set(ref, resolveProjectServiceEndpoint(projectId, ref));
        const endpoint = await endpoints.get(ref)!;
        assertAllowedHttpPort(new URL(endpoint.baseUrl));
        if (secretRef && secretRef !== endpoint.secretRef)
          throw new Error("节点密钥引用与项目端点不一致，请重新选择服务端点以同步认证配置。");
        secretRef = endpoint.secretRef ?? "";
      }
      if (secretRef) {
        field = "secretRef";
        resolveExternalSecret(secretRef);
      }
    } catch (error) {
      diagnostics.push({
        code: "WF_SERVICE_CONFIGURATION",
        message: `“${node.name}”：${error instanceof Error ? error.message : "服务配置不可用。"} 请在项目“服务端点”核对配置；密钥由部署管理员注入运行环境或挂载密钥文件。`,
        location: { kind: "node", nodeId: node.id, field },
      });
    }
  }
  return diagnostics;
}
