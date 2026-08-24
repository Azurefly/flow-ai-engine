import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectRecord } from "@/components/ProjectWorkspace";
import { CreationDialog } from "@/components/CreationDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import {
  formatConsoleRoute,
  parseConsoleRoute,
  type ConsoleRoute,
  type ConsoleSection,
} from "../../../shared/console-route";
import { resolveSelectedWorkflow } from "../../../shared/workflow-selection";
import type { Definition } from "../../../server/workflow-service";
import {
  Activity,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  Clock3,
  Copy,
  Download,
  FileJson,
  FolderKanban,
  Gauge,
  Eye,
  KeyRound,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  Play,
  Plus,
  ShieldCheck,
  Search,
  SlidersHorizontal,
  Upload,
  UsersRound,
  WandSparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  ChangeEvent,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

const WorkflowCanvas = lazy(() => import("@/components/WorkflowCanvas"));
const WorkflowGovernance = lazy(
  () => import("@/components/WorkflowGovernance")
);
const WorkflowDetailPage = lazy(() =>
  import("@/components/WorkflowDetailPage").then(module => ({
    default: module.WorkflowDetailPage,
  }))
);
const RunCenter = lazy(() => import("@/components/RunCenter"));
const ProcessWorkbench = lazy(() => import("@/components/ProcessWorkbench"));
const BusinessCenter = lazy(() =>
  import("@/components/ProjectWorkspace").then(module => ({
    default: module.BusinessCenter,
  }))
);
const ProjectWorkspace = lazy(() =>
  import("@/components/ProjectWorkspace").then(module => ({
    default: module.ProjectWorkspace,
  }))
);
const WorkflowWarehouse = lazy(() => import("@/components/WorkflowWarehouse"));
const SystemConfigShell = lazy(() => import("@/components/SystemConfigShell"));
const OrganizationManagementPage = lazy(
  () => import("@/components/OrganizationManagementPage")
);

type FlowEditorReturn = "center" | "workspace" | "detail" | "warehouse";
type UserIdentity = {
  id: number;
  username: string | null;
  name: string | null;
  role: "user" | "admin";
};
type PublicGeneral = {
  platformName: string;
  watermarkEnabled: boolean;
  watermarkText: string;
};
type RequestedConsoleRoute = {
  route: ConsoleRoute;
  editorReturn?: FlowEditorReturn;
};
type CompileDiagnostic = {
  code: string;
  message: string;
  location: { kind: "definition" | "node" | "edge"; nodeId?: string; edgeId?: string; field?: string };
};

function readConsoleRoute(): RequestedConsoleRoute {
  if (typeof window === "undefined")
    return { route: { section: "flows", view: "center" } };
  const editorReturn = window.history.state?.aiflowEditorReturn;
  return {
    route: parseConsoleRoute(window.location.hash),
    ...(["center", "workspace", "detail", "warehouse"].includes(editorReturn)
      ? { editorReturn }
      : {}),
  };
}

function decodeJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatTime(value: unknown) {
  if (!value) return "—";
  return new Date(String(value)).toLocaleString("zh-CN", { hour12: false });
}

export default function Home() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const general = trpc.config.publicGeneral.useQuery();
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
  });
  const login = trpc.auth.login.useMutation({
    onSuccess: () => {
      void utils.auth.me.invalidate();
      toast.success("登录成功，正在进入流程中心。");
    },
    onError: error => toast.error(error.message),
  });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      void utils.auth.me.invalidate();
      toast.success("已安全退出。");
    },
  });

  const publicGeneral: PublicGeneral = general.data ?? {
    platformName: "Flow AI Engine",
    watermarkEnabled: false,
    watermarkText: "",
  };
  if (me.isLoading)
    return (
      <main className="grid min-h-screen place-items-center bg-white text-slate-600">
        <div className="flex items-center gap-3 border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
          <Loader2 className="animate-spin text-[#2d6bea]" size={16} />
          正在读取流程工作台…
        </div>
      </main>
    );
  if (!me.data)
    return (
      <LoginScreen
        platformName={publicGeneral.platformName}
        credentials={credentials}
        setCredentials={setCredentials}
        pending={login.isPending}
        errorMessage={login.error?.message}
        onSubmit={() => login.mutate(credentials)}
      />
    );
  return (
    <FlowConsole
      user={me.data}
      general={publicGeneral}
      onLogout={() => logout.mutate()}
    />
  );
}

function LoginScreen({
  platformName,
  credentials,
  setCredentials,
  pending,
  errorMessage,
  onSubmit,
}: {
  platformName: string;
  credentials: { username: string; password: string };
  setCredentials: (next: { username: string; password: string }) => void;
  pending: boolean;
  errorMessage?: string;
  onSubmit: () => void;
}) {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f4f6f9] p-5 text-slate-800">
    <div className="absolute inset-x-0 top-0 h-1 bg-[#2d6bea]" />
    <section className="relative w-full max-w-md overflow-hidden border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-7 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center bg-[#2d6bea] text-white">
              <Gauge size={21} />
            </div>
            <div>
              <p className="text-[11px] font-bold tracking-[.16em] text-[#5b72a8]">
                AI FLOW GRAPH
              </p>
              <h1 className="mt-0.5 text-lg font-semibold text-slate-800">
                {platformName} 控制台
              </h1>
            </div>
          </div>
        </div>
        <form
          className="grid gap-4 p-7"
          onSubmit={event => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <p className="text-sm leading-6 text-slate-500">
            使用内部账号登录。流程、运行记录和协作授权均按资源级权限隔离。
          </p>
          {errorMessage && (
            <div
              role="alert"
              aria-live="assertive"
              className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              登录失败：{errorMessage}
            </div>
          )}
          <label className="grid gap-2 text-xs font-medium text-slate-600">
            用户名
            <Input
              className="border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus-visible:ring-[#2d6bea]"
              autoComplete="username"
              value={credentials.username}
              onChange={event =>
                setCredentials({ ...credentials, username: event.target.value })
              }
              required
            />
          </label>
          <label className="grid gap-2 text-xs font-medium text-slate-600">
            密码
            <Input
              className="border-slate-300 bg-white text-slate-800 placeholder:text-slate-400 focus-visible:ring-[#2d6bea]"
              type="password"
              autoComplete="current-password"
              minLength={12}
              value={credentials.password}
              onChange={event =>
                setCredentials({ ...credentials, password: event.target.value })
              }
              required
            />
          </label>
          <Button
            className="mt-2 bg-[#2d6bea] hover:bg-[#245fc8]"
            disabled={pending}
          >
            {pending && <Loader2 className="animate-spin" />}登录流程引擎
          </Button>
      </form>
        <div className="border-t border-slate-200 bg-slate-50 px-7 py-4 text-xs text-slate-500">
          账号由管理员创建；系统不提供公开注册。
        </div>
    </section>
    </main>
  );
}

function FlowConsole({
  user,
  general,
  onLogout,
}: {
  user: UserIdentity;
  general: PublicGeneral;
  onLogout: () => void;
}) {
  const utils = trpc.useUtils();
  const [initialRoute] = useState(readConsoleRoute);
  const [requestedRoute, setRequestedRoute] =
    useState<RequestedConsoleRoute>(initialRoute);
  const [section, setSection] = useState<ConsoleSection>(
    initialRoute.route.section
  );
  const [systemView, setSystemView] = useState<
    "config" | "identity" | "organization"
  >(
    initialRoute.route.section === "system" ? initialRoute.route.view : "config"
  );
  const [flowView, setFlowView] = useState<
    "center" | "workspace" | "detail" | "editor"
  >(
    initialRoute.route.section === "flows" ? initialRoute.route.view : "center"
  );
  const [flowEditorReturn, setFlowEditorReturn] = useState<FlowEditorReturn>(
    initialRoute.editorReturn ?? "center"
  );
  const [selectedProject, setSelectedProject] = useState<ProjectRecord | null>(
    null
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    () => {
      const route = initialRoute.route;
      return route.section === "flows" &&
        (route.view === "detail" || route.view === "editor")
        ? route.workflowId
        : route.section === "runs" && route.view === "monitor"
          ? route.workflowId
          : null;
    }
  );
  const [draftDefinition, setDraftDefinition] = useState<Definition | null>(
    null
  );
  const [draftName, setDraftName] = useState("");
  const [runInput, setRunInput] = useState<Record<string, unknown>>({
    id: 2,
    prompt: "请总结输入内容",
  });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(
    initialRoute.route.section === "runs" &&
      initialRoute.route.view === "monitor"
      ? (initialRoute.route.runId ?? null)
      : null
  );
  const [runView, setRunView] = useState<"workbench" | "monitor">(
    initialRoute.route.section === "runs"
      ? initialRoute.route.view
      : "workbench"
  );
  const [newFlowName, setNewFlowName] = useState("");
  const [createFlowOpen, setCreateFlowOpen] = useState(false);
  const [userForm, setUserForm] = useState({
    username: "",
    name: "",
    password: "",
    email: "",
    role: "user" as "user" | "admin",
  });
  const [aiUserForm, setAiUserForm] = useState({
    goal: "",
    maxUsers: "10",
    password: "",
    defaultRole: "user" as "user" | "admin",
  });
  const [aiPreview, setAiPreview] = useState<any>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const editorActive = section === "flows" && flowView === "editor";
  const detailActive = section === "flows" && flowView === "detail";
  const identityActive =
    section === "system" && systemView === "identity" && user.role === "admin";
  const navigateRoute = useCallback(
    (
      route: ConsoleRoute,
      options?: { replace?: boolean; editorReturn?: FlowEditorReturn }
    ) => {
      setRequestedRoute({
        route,
        ...(options?.editorReturn
          ? { editorReturn: options.editorReturn }
          : {}),
      });
      if (typeof window !== "undefined")
        window.history[options?.replace ? "replaceState" : "pushState"](
          { aiflowEditorReturn: options?.editorReturn ?? null },
          "",
          formatConsoleRoute(route)
        );
    },
    []
  );
  const navigateSection = useCallback(
    (next: ConsoleSection) => {
    const permitted = next !== "system" || user.role === "admin";
    const resolved = permitted ? next : "flows";
      navigateRoute(
        resolved === "flows"
          ? { section: "flows", view: "center" }
          : resolved === "runs"
            ? { section: "runs", view: "workbench" }
            : resolved === "warehouse"
              ? { section: "warehouse" }
              : { section: "system", view: "config" }
      );
    },
    [navigateRoute, user.role]
  );

  const openFlowEditor = useCallback(
    (workflowId: string, returnTo: FlowEditorReturn) => {
    setSelectedWorkflowId(workflowId);
      navigateRoute(
        { section: "flows", view: "editor", workflowId },
        { editorReturn: returnTo }
      );
    },
    [navigateRoute]
  );

  const returnFromFlowEditor = useCallback(() => {
    if (flowEditorReturn === "warehouse") {
      navigateRoute({ section: "warehouse" });
      return;
    }
    if (flowEditorReturn === "detail" && selectedWorkflowId) {
      navigateRoute({
        section: "flows",
        view: "detail",
        workflowId: selectedWorkflowId,
      });
      return;
    }
    if (flowEditorReturn === "workspace" && selectedProject) {
      navigateRoute({
        section: "flows",
        view: "workspace",
        projectId: selectedProject.id,
      });
      return;
    }
    navigateRoute({ section: "flows", view: "center" });
  }, [flowEditorReturn, navigateRoute, selectedProject, selectedWorkflowId]);

  const flowEditorReturnLabel =
    flowEditorReturn === "warehouse"
    ? "返回流程仓库"
    : flowEditorReturn === "detail"
      ? "返回流程详情"
      : flowEditorReturn === "workspace"
        ? "返回项目流程中心"
        : "返回业务中心";

  useEffect(() => {
    const restoreConsoleRoute = () => setRequestedRoute(readConsoleRoute());
    window.addEventListener("popstate", restoreConsoleRoute);
    window.addEventListener("hashchange", restoreConsoleRoute);
    return () => {
      window.removeEventListener("popstate", restoreConsoleRoute);
      window.removeEventListener("hashchange", restoreConsoleRoute);
    };
  }, []);

  const workflows = trpc.workflow.list.useQuery();
  const projects = trpc.project.list.useQuery();
  const workflowItems = (workflows.data ?? []) as any[];
  const routeWorkflowId =
    requestedRoute.route.section === "flows" &&
    (requestedRoute.route.view === "detail" ||
      requestedRoute.route.view === "editor")
      ? requestedRoute.route.workflowId
      : requestedRoute.route.section === "runs" &&
          requestedRoute.route.view === "monitor"
        ? requestedRoute.route.workflowId
        : null;
  const effectiveWorkflowId = routeWorkflowId ?? selectedWorkflowId;
  const selectedWorkflowFromList =
    workflowItems.find(workflow => workflow.id === effectiveWorkflowId) ?? null;
  const selectedWorkflowInput = useMemo(
    () => ({ id: effectiveWorkflowId ?? "00000000" }),
    [effectiveWorkflowId]
  );
  const selectedWorkflowQuery = trpc.workflow.get.useQuery(
    selectedWorkflowInput,
    {
      enabled: Boolean(routeWorkflowId && !selectedWorkflowFromList),
      retry: false,
    }
  );
  const selectedWorkflow = resolveSelectedWorkflow(
    workflowItems,
    effectiveWorkflowId,
    selectedWorkflowQuery.data as any
  );
  const selectedWorkflowDefinition = selectedWorkflow
    ? (decodeJson(selectedWorkflow.definition) as Definition)
    : null;
  const selectedId = selectedWorkflow?.id ?? null;
  const detailInput = useMemo(
    () => ({ runId: selectedRunId ?? "00000000-0000-0000-0000-000000000000" }),
    [selectedRunId]
  );
  const runDetail = trpc.workflow.runDetail.useQuery(detailInput, {
    enabled: Boolean(selectedRunId && selectedWorkflow),
    retry: false,
  });
  const accessInput = useMemo(
    () => ({ id: selectedId ?? "00000000" }),
    [selectedId]
  );
  const access = trpc.workflow.access.useQuery(accessInput, {
    enabled: Boolean(selectedId),
  });
  const members = trpc.workflow.members.useQuery(
    useMemo(() => ({ workflowId: selectedId ?? "00000000" }), [selectedId]),
    { enabled: Boolean(editorActive && selectedId), retry: false }
  );
  const memberCandidates = trpc.workflow.memberCandidates.useQuery(
    useMemo(() => ({ workflowId: selectedId ?? "00000000" }), [selectedId]),
    {
      enabled: Boolean(
        editorActive &&
          selectedId &&
          access.data?.permissions?.has("workflow:members:manage")
      ),
      retry: false,
    }
  );
  const runtimeModels = trpc.workflow.runtimeModels.useQuery(undefined, {
    enabled: editorActive,
    staleTime: 60_000,
    retry: false,
  });
  const templates = trpc.workflow.templates.useQuery(undefined, {
    enabled: editorActive,
    retry: false,
  });
  const subflows = trpc.workflow.subflows.useQuery(undefined, {
    enabled: editorActive,
    retry: false,
  });
  const users = trpc.iam.users.useQuery(undefined, {
    enabled: identityActive,
    retry: false,
  });
  const roles = trpc.iam.roles.useQuery(undefined, {
    enabled: identityActive,
    retry: false,
  });
  const audit = trpc.iam.authorizationAudit.useQuery(
    { limit: 20 },
    { enabled: identityActive, retry: false }
  );

  useEffect(() => {
    const route = requestedRoute.route;
    const replaceWith = (safeRoute: ConsoleRoute) => {
      setRequestedRoute({ route: safeRoute });
      window.history.replaceState(
        { aiflowEditorReturn: null },
        "",
        formatConsoleRoute(safeRoute)
      );
    };
    const canonicalize = () => {
      const canonical = formatConsoleRoute(route);
      if (window.location.hash !== canonical)
        window.history.replaceState(
          { aiflowEditorReturn: requestedRoute.editorReturn ?? null },
          "",
          canonical
        );
    };
    if (route.section === "system") {
      if (user.role !== "admin") {
        replaceWith({ section: "flows", view: "center" });
        return;
      }
      setSection("system");
      setSystemView(route.view);
      canonicalize();
      return;
    }
    if (route.section === "warehouse") {
      setSection("warehouse");
      canonicalize();
      return;
    }
    if (route.section === "runs") {
      if (route.view === "workbench") {
        setSection("runs");
        setRunView("workbench");
        setSelectedRunId(null);
        canonicalize();
        return;
      }
      setSection("runs");
      setRunView("monitor");
      if (!workflows.isSuccess) return;
      if (!selectedWorkflowFromList && selectedWorkflowQuery.isPending) return;
      const workflow = selectedWorkflow;
      if (!workflow || workflow.id !== route.workflowId) {
        replaceWith({ section: "runs", view: "workbench" });
        return;
      }
      setSelectedWorkflowId(workflow.id);
      if (projects.isSuccess)
        setSelectedProject(
          ((projects.data ?? []) as ProjectRecord[]).find(
            project => project.id === workflow.projectId
          ) ?? null
        );
      setSelectedRunId(route.runId ?? null);
      setSection("runs");
      setRunView("monitor");
      canonicalize();
      return;
    }
    if (route.view === "center") {
      setSection("flows");
      setFlowView("center");
      canonicalize();
      return;
    }
    if (route.view === "workspace") {
      setSection("flows");
      setFlowView("workspace");
      if (!projects.isSuccess) return;
      const project = ((projects.data ?? []) as ProjectRecord[]).find(
        item => item.id === route.projectId
      );
      if (!project) {
        replaceWith({ section: "flows", view: "center" });
        return;
      }
      setSelectedProject(project);
      setSelectedWorkflowId(null);
      setSection("flows");
      setFlowView("workspace");
      canonicalize();
      return;
    }
    setSection("flows");
    setFlowView(route.view);
    if (
      !workflows.isSuccess ||
      !projects.isSuccess ||
      (!selectedWorkflowFromList && selectedWorkflowQuery.isPending)
    )
      return;
    const workflow = selectedWorkflow;
    if (!workflow || workflow.id !== route.workflowId) {
      replaceWith({ section: "flows", view: "center" });
      return;
    }
    const project =
      ((projects.data ?? []) as ProjectRecord[]).find(
        item => item.id === workflow.projectId
      ) ?? null;
    setSelectedWorkflowId(workflow.id);
    setSelectedProject(project);
    setSection("flows");
    setFlowView(route.view);
    if (route.view === "editor")
      setFlowEditorReturn(
        requestedRoute.editorReturn ?? (project ? "workspace" : "center")
      );
    canonicalize();
  }, [
    projects.data,
    projects.isSuccess,
    requestedRoute,
    selectedWorkflow,
    selectedWorkflowFromList,
    selectedWorkflowQuery.isPending,
    user.role,
    workflows.isSuccess,
  ]);

  useEffect(() => {
    if (!selectedWorkflowId && workflowItems[0])
      setSelectedWorkflowId(workflowItems[0].id);
  }, [selectedWorkflowId, workflowItems]);

  useEffect(() => {
    if (selectedWorkflow) {
      setDraftName(selectedWorkflow.name);
      setDraftDefinition(decodeJson(selectedWorkflow.definition) as Definition);
    }
  }, [selectedWorkflow?.id]);

  useEffect(() => {
    const route = requestedRoute.route;
    const detail = runDetail.data as any;
    if (
      route.section === "runs" &&
      route.view === "monitor" &&
      route.runId &&
      (runDetail.isError || (detail && detail.workflowId !== route.workflowId))
    )
      navigateRoute(
        { section: "runs", view: "monitor", workflowId: route.workflowId },
        { replace: true }
      );
  }, [navigateRoute, requestedRoute.route, runDetail.data, runDetail.isError]);

  const routeRestoring = Boolean(
    (routeWorkflowId &&
      (!workflows.isSuccess ||
        (!selectedWorkflowFromList && selectedWorkflowQuery.isPending))) ||
      (requestedRoute.route.section === "flows" &&
        requestedRoute.route.view === "workspace" &&
        !projects.isSuccess) ||
      (requestedRoute.route.section === "flows" &&
        (requestedRoute.route.view === "detail" ||
          requestedRoute.route.view === "editor") &&
        !projects.isSuccess)
  );

  const createFlow = trpc.workflow.create.useMutation({
    onSuccess: (workflow: any) => {
      void utils.workflow.list.invalidate();
      setCreateFlowOpen(false);
      if (workflow?.id)
        openFlowEditor(workflow.id, selectedProject ? "workspace" : "center");
      setNewFlowName("");
      toast.success("已新建草稿流程。");
    },
    onError: error => toast.error(error.message),
  });
  const saveFlow = trpc.workflow.update.useMutation({
    onSuccess: (workflow: any) => {
      void utils.workflow.list.invalidate();
      if (workflow) {
        setDraftDefinition(decodeJson(workflow.definition) as Definition);
        setDraftName(workflow.name);
      }
      toast.success("流程定义已保存。");
    },
    onError: error => toast.error(error.message),
  });
  const publishFlow = trpc.workflow.publish.useMutation({
    onSuccess: () => {
      void utils.workflow.list.invalidate();
      toast.success("流程已发布。");
    },
    onError: error => toast.error(error.message),
  });
  const compileFlow = trpc.workflow.compile.useMutation();
  const [compileDiagnostics, setCompileDiagnostics] = useState<CompileDiagnostic[]>([]);
  const duplicateFlow = trpc.workflow.duplicate.useMutation({
    onSuccess: (workflow: any) => {
      void utils.workflow.list.invalidate();
      if (workflow?.id) openFlowEditor(workflow.id, flowEditorReturn);
      toast.success("已创建流程副本。");
    },
    onError: error => toast.error(error.message),
  });
  const deleteFlow = trpc.workflow.delete.useMutation({
    onSuccess: () => {
      void utils.workflow.list.invalidate();
      void utils.project.list.invalidate();
      setSelectedWorkflowId(null);
      setDraftDefinition(null);
      returnFromFlowEditor();
      toast.success("流程已归档，可在流程仓库恢复。");
    },
    onError: error => toast.error(error.message),
  });
  const grantMember = trpc.workflow.grantMember.useMutation({
    onSuccess: () => {
      void utils.workflow.members.invalidate();
      toast.success("流程成员授权已更新。");
    },
    onError: error => toast.error(error.message),
  });
  const revokeMember = trpc.workflow.revokeMember.useMutation({
    onSuccess: () => {
      void utils.workflow.members.invalidate();
      toast.success("流程成员授权已撤销。");
    },
    onError: error => toast.error(error.message),
  });
  const runFlow = trpc.workflow.run.useMutation({
    onSuccess: result => {
      void utils.workflow.runs.invalidate();
      void utils.workflow.runMetrics.invalidate();
      if (selectedId)
        navigateRoute({
          section: "runs",
          view: "monitor",
          workflowId: selectedId,
          runId: result.runId,
        });
      toast.success(`已进入持久化执行队列：${result.runId.slice(0, 8)}`);
    },
    onError: error => toast.error(error.message),
  });
  const runDataflow = trpc.data.run.useMutation({
    onSuccess: result => {
      if (selectedWorkflow?.projectId)
        void utils.data.runs.invalidate({
          projectId: selectedWorkflow.projectId,
        });
      toast.success(`数据流运行完成：${result.runId.slice(0, 8)}`);
    },
    onError: error => toast.error(error.message),
  });
  const createTemplate = trpc.workflow.createTemplate.useMutation({
    onSuccess: () => {
      void utils.workflow.templates.invalidate();
      toast.success("节点模板已保存到个人库。");
    },
    onError: error => toast.error(error.message),
  });
  const updateTemplate = trpc.workflow.updateTemplate.useMutation({
    onSuccess: () => void utils.workflow.templates.invalidate(),
    onError: error => toast.error(error.message),
  });
  const deleteTemplate = trpc.workflow.deleteTemplate.useMutation({
    onSuccess: () => {
      void utils.workflow.templates.invalidate();
      toast.success("节点模板已删除。");
    },
    onError: error => toast.error(error.message),
  });
  const createSubflow = trpc.workflow.createSubflow.useMutation({
    onSuccess: () => {
      void utils.workflow.subflows.invalidate();
      toast.success("当前定义已保存为私有子流程。");
    },
    onError: error => toast.error(error.message),
  });
  const updateSubflow = trpc.workflow.updateSubflow.useMutation({
    onSuccess: () => void utils.workflow.subflows.invalidate(),
    onError: error => toast.error(error.message),
  });
  const deleteSubflow = trpc.workflow.deleteSubflow.useMutation({
    onSuccess: () => {
      void utils.workflow.subflows.invalidate();
      toast.success("子流程已删除。");
    },
    onError: error => toast.error(error.message),
  });
  const createUser = trpc.iam.createUser.useMutation({
    onSuccess: () => {
      setUserForm({
        username: "",
        name: "",
        password: "",
        email: "",
        role: "user",
      });
      void utils.iam.users.invalidate();
      void utils.iam.authorizationAudit.invalidate();
      toast.success("内部账号已创建。");
    },
    onError: error => toast.error(error.message),
  });
  const updateUserStatus = trpc.iam.updateUserStatus.useMutation({
    onSuccess: () => {
      void utils.iam.users.invalidate();
      void utils.iam.authorizationAudit.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const aiPreviewMutation = trpc.iam.previewUserBatch.useMutation({
    onSuccess: preview => {
      setAiPreview(preview);
      toast.success(`已生成 ${preview.users.length} 条用户预览，请确认后创建`);
    },
    onError: error => toast.error(error.message),
  });
  const createUsersBatch = trpc.iam.createUsersBatch.useMutation({
    onSuccess: result => {
      void utils.iam.users.invalidate();
      void utils.iam.authorizationAudit.invalidate();
      toast[result.failed ? "warning" : "success"](
        `批量创建完成：成功 ${result.created}，失败 ${result.failed}`
      );
    },
    onError: error => toast.error(error.message),
  });

  const canEdit = Boolean(access.data?.permissions?.has("workflow:edit"));
  const canPublish = Boolean(access.data?.permissions?.has("workflow:publish"));
  const canRun = Boolean(access.data?.permissions?.has("workflow:run"));
  const canManageMembers = Boolean(
    access.data?.permissions?.has("workflow:members:manage")
  );
  const saveCurrent = useCallback(() => {
    if (!selectedId || !draftDefinition) return;
    if (selectedWorkflow?.status === "published") {
      toast.error("已发布流程请使用“发布”提交新版本，或先取消发布后再保存草稿。");
      return;
    }
    saveFlow.mutate({
      id: selectedId,
      name: draftName.trim() || "未命名流程",
      definition: draftDefinition,
    });
  }, [draftDefinition, draftName, saveFlow, selectedId, selectedWorkflow?.status]);

  const exportCurrent = () => {
    if (!selectedWorkflow || !draftDefinition) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      workflow: {
        name: draftName,
        description: selectedWorkflow.description,
        definition: draftDefinition,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${draftName || "workflow"}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };

  const importDefinition = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const imported = (parsed.workflow?.definition ??
          parsed.definition ??
          parsed) as Definition;
        if (!Array.isArray(imported.nodes) || !Array.isArray(imported.edges))
          throw new Error();
        setDraftDefinition(imported);
        if (parsed.workflow?.name) setDraftName(String(parsed.workflow.name));
        toast.success("JSON 已载入；请检查后保存。");
      } catch {
        toast.error("导入文件不是有效的流程定义 JSON。");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const startRun = () => {
    if (!selectedId) return;
    if (selectedWorkflow?.flowType === "data") {
      if (!selectedWorkflow.projectId) {
        toast.error("数据流缺少项目归属，无法运行。");
        return;
      }
      runDataflow.mutate({
        projectId: selectedWorkflow.projectId,
        workflowId: selectedId,
        data: runInput,
      });
    } else
      runFlow.mutate({
        workflowId: selectedId,
        input: runInput,
        idempotencyKey: crypto.randomUUID(),
      });
  };

  const nav = [
    { id: "flows" as const, label: "流程设计", icon: FolderKanban },
    { id: "runs" as const, label: "已启动流程", icon: Activity },
    { id: "warehouse" as const, label: "流程仓库", icon: FolderKanban },
    ...(user.role === "admin"
      ? [{ id: "system" as const, label: "系统配置", icon: SlidersHorizontal }]
      : []),
  ];

  const workspaceWorkflows = selectedProject
    ? workflowItems.filter(
        workflow => workflow.projectId === selectedProject.id
      )
    : workflowItems;

  return (
    <main
      data-aiflow-console=""
      className="aiflow-console relative min-h-screen bg-[#f4f6f9] text-slate-700"
    >
      <a className="aiflow-skip-link" href="#aiflow-console-panel">
        跳到主要工作区
      </a>
    <header className="sticky top-0 z-30 border-b border-[#d9e0e9] bg-white text-[#354052] shadow-sm">
        <div className="flex h-14 items-center">
          <button
            className="grid h-14 w-16 place-items-center border-r border-[#e0e6ee] text-slate-500 hover:bg-[#f2f6fc] hover:text-[#2469c7]"
            onClick={() => setSidebarOpen(value => !value)}
            aria-label="展开导航"
          >
            {sidebarOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="flex min-w-0 items-center gap-3 px-4">
            <div className="grid h-7 w-7 place-items-center rounded-sm bg-[#2d72cf] text-white">
              <Gauge size={16} />
    </div>
            <div className="hidden sm:block">
              <p className="text-[10px] font-bold tracking-[.16em] text-[#2d72cf]">
                AI FLOW GRAPH
              </p>
              <p className="text-sm font-semibold text-slate-700">
                {general.platformName}
              </p>
            </div>
          </div>
          <div
            role="tablist"
            aria-label="流程工作台主导航"
            className="ml-4 hidden h-full items-end gap-1 md:flex"
          >
            {nav.map(item => (
              <button
                id={`aiflow-console-tab-${item.id}`}
                role="tab"
                aria-selected={section === item.id}
                aria-controls="aiflow-console-panel"
                key={item.id}
                onClick={() => navigateSection(item.id)}
                className={`flex h-full items-center gap-2 border-b-2 px-4 text-sm transition-colors ${section === item.id ? "border-[#3a82e4] bg-[#edf4ff] text-[#2469c7]" : "border-transparent text-slate-500 hover:bg-[#f2f6fc] hover:text-[#2469c7]"}`}
              >
                <item.icon size={15} />
                {item.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex h-full items-center gap-3 px-4 text-xs">
            <span className="hidden text-slate-500 lg:inline">
              {user.name || user.username || "内部用户"}
            </span>
            <span className="rounded-sm border border-[#e0e6ee] px-2 py-1 text-slate-600">
              {user.role === "admin" ? "系统管理员" : "成员"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-slate-600 hover:bg-[#f2f6fc] hover:text-[#2469c7]"
              onClick={onLogout}
            >
              <LogOut size={15} />
              退出
            </Button>
          </div>
        </div>
      </header>
      <div
        data-aiflow-mobile-workspace-nav
        className="border-b border-slate-200 bg-white px-3 py-2 md:hidden"
      >
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <span className="shrink-0">当前工作区</span>
          <select
            className="h-8 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400"
            value={section}
            aria-label="切换流程工作区"
            onChange={event =>
              navigateSection(event.target.value as ConsoleSection)
            }
          >
            {nav.map(item => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex min-h-[calc(100vh-56px)] flex-col md:flex-row">
        {section === "flows" && flowView === "editor" && (
          <aside
            className={`${sidebarOpen ? "w-full md:w-72" : "h-0 w-full overflow-hidden md:h-auto md:w-0"} shrink-0 border-b border-slate-200 bg-white transition-[width,height] duration-200 md:border-b-0 md:border-r`}
          >
            <div className="border-b border-slate-100 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold tracking-[.18em] text-slate-400">
                    PROJECT WORKBENCH
                  </p>
                  <h2 className="mt-1 text-sm font-semibold">流程仓库</h2>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="新建流程"
                  onClick={() => {
                    setNewFlowName("新流程");
                    setCreateFlowOpen(true);
                  }}
                >
                  <Plus size={17} />
                </Button>
              </div>
            </div>
            <div className="max-h-[calc(100vh-196px)] overflow-y-auto p-2">
              {workflows.isLoading && (
                <div className="p-4 text-sm text-slate-400">
                  正在读取项目流程…
                </div>
              )}
              {workspaceWorkflows.map(workflow => {
                const definition = decodeJson(
                  workflow.definition
                ) as Definition;
                const selected = workflow.id === selectedId;
                return (
                  <button
                    key={workflow.id}
                    onClick={() =>
                      openFlowEditor(workflow.id, flowEditorReturn)
                    }
                    className={`mb-1 w-full rounded-md border p-3 text-left transition-colors ${selected ? "border-blue-200 bg-blue-50" : "border-transparent hover:border-slate-200 hover:bg-slate-50"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {workflow.name}
                      </p>
                      <span
                        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${workflow.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                      >
                        {workflow.status === "published" ? "已发布" : "草稿"}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
                      <span>{definition?.nodes?.length ?? 0} 节点</span>
                      <span>v{workflow.definitionVersion}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>
        )}
        <section
          id="aiflow-console-panel"
          tabIndex={-1}
          role="tabpanel"
          aria-labelledby={`aiflow-console-tab-${section}`}
          className="min-w-0 w-full flex-1"
        >
          {routeRestoring && (
            <div
              data-aiflow-route-restoring
              role="status"
              aria-live="polite"
              className="grid min-h-[calc(100vh-56px)] place-items-center p-8 text-sm text-slate-500"
            >
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <Loader2 className="animate-spin text-[#2d6bea]" size={16} />
                正在恢复受权页面…
              </div>
            </div>
          )}
          {section === "flows" && flowView === "center" && (
            <BusinessCenter
              projects={(projects.data ?? []) as ProjectRecord[]}
              canCreate={
                user.role === "admin" ||
                Boolean(access.data?.permissions?.has("workflow:create"))
              }
              onOpenProject={project =>
                navigateRoute({
                  section: "flows",
                  view: "workspace",
                  projectId: project.id,
                })
              }
            />
          )}
          {section === "flows" &&
            !routeRestoring &&
            flowView === "workspace" &&
            selectedProject && (
              <div>
                <div
                  data-aiflow-business-selector
                  className="flex flex-col gap-2 border-b border-slate-200 bg-white px-4 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-600">
                    <span className="shrink-0">当前业务</span>
                    <select
                      className="h-8 min-w-0 max-w-[320px] rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400"
                      value={selectedProject.id}
                      aria-label="切换当前受权业务"
                      onChange={event =>
                        navigateRoute({
                          section: "flows",
                          view: "workspace",
                          projectId: event.target.value,
                        })
                      }
                    >
                      {((projects.data ?? []) as ProjectRecord[]).map(
                        project => (
                          <option key={project.id} value={project.id}>
                            {project.code} · {project.name}
                          </option>
                        )
                      )}
                    </select>
                  </label>
                  <span className="text-[11px] text-slate-400">
                    仅显示当前账号具备查看权限的业务项目
                  </span>
                </div>
                <ProjectWorkspace
                  project={selectedProject}
                  onBack={() =>
                    navigateRoute({ section: "flows", view: "center" })
                  }
                  onOpenWorkflow={workflowId =>
                    openFlowEditor(workflowId, "workspace")
                  }
                  onOpenDetail={workflowId =>
                    navigateRoute({
                      section: "flows",
                      view: "detail",
                      workflowId,
                    })
                  }
                  onOpenWarehouse={() =>
                    navigateRoute({ section: "warehouse" })
                  }
                />
              </div>
            )}
          {section === "flows" && !routeRestoring && flowView === "detail" && (
            <WorkflowDetailPage
              workflow={selectedWorkflow}
              definition={selectedWorkflowDefinition}
              canEdit={canEdit}
              canPublish={canPublish}
              onClose={() =>
                navigateRoute(
                  selectedProject
                    ? {
                        section: "flows",
                        view: "workspace",
                        projectId: selectedProject.id,
                      }
                    : { section: "flows", view: "center" }
                )
              }
              onOpen={() => selectedId && openFlowEditor(selectedId, "detail")}
            />
          )}
          {section === "flows" && !routeRestoring && flowView === "editor" && (
            <FlowDesigner
              workflow={selectedWorkflow}
              definition={draftDefinition}
              name={draftName}
              setName={setDraftName}
              canEdit={canEdit}
              canPublish={canPublish}
              canRun={canRun}
              canManage={canManageMembers}
              members={(members.data ?? []) as any[]}
              candidates={(memberCandidates.data ?? []) as any[]}
              savePending={saveFlow.isPending}
              publishPending={publishFlow.isPending}
              compilePending={compileFlow.isPending}
              compileDiagnostics={compileDiagnostics}
              runPending={runFlow.isPending}
              runInput={runInput}
              setRunInput={setRunInput}
              models={runtimeModels.data ?? []}
              templates={(templates.data ?? []) as any[]}
              subflows={(subflows.data ?? []) as any[]}
              onDefinitionChange={setDraftDefinition}
              backLabel={flowEditorReturnLabel}
              onBackToDesignCenter={returnFromFlowEditor}
              onSave={saveCurrent}
              onValidate={() => {
                if (!selectedId || !draftDefinition) return;
                compileFlow.mutate(
                  { id: selectedId, definition: draftDefinition },
                  { onSuccess: result => setCompileDiagnostics(result.ok ? [] : result.diagnostics) }
                );
              }}
              onPublish={() => {
                if (!selectedId || !draftDefinition) return;
                compileFlow.mutate(
                  { id: selectedId, definition: draftDefinition },
                  {
                    onSuccess: result => {
                      if (!result.ok) {
                        setCompileDiagnostics(result.diagnostics);
                        toast.error(`编译未通过：${result.diagnostics.length} 项错误`);
                        return;
                      }
                      setCompileDiagnostics([]);
                      publishFlow.mutate({ id: selectedId, name: draftName.trim() || "未命名流程", definition: draftDefinition });
                    },
                    onError: error => toast.error(error.message),
                  }
                );
              }}
              onRun={startRun}
              onExport={exportCurrent}
              onImport={() => importRef.current?.click()}
              onDuplicate={() => {
                if (selectedId)
                  duplicateFlow.mutate({
                    id: selectedId,
                    name: `${draftName} · 副本`,
                  });
              }}
              onDelete={() => {
                if (
                  selectedId &&
                  window.confirm(
                    `确认归档“${draftName}”吗？版本、运行、任务、成员授权和审计记录均会保留，之后可在流程仓库恢复。`
                  )
                )
                  deleteFlow.mutate({ id: selectedId });
              }}
              onSaveAsSubflow={() => {
                if (draftDefinition)
                  createSubflow.mutate({
                    name: `${draftName || "未命名流程"} · 子流程`,
                    definition: draftDefinition,
                  });
              }}
              onCreateTemplate={input => createTemplate.mutate(input)}
              onUpdateTemplate={(template, updates) =>
                updateTemplate.mutate({ id: template.id, ...updates })
              }
              onDeleteTemplate={id => deleteTemplate.mutate({ id })}
              onToggleSubflow={(subflow, isEnabled) =>
                updateSubflow.mutate({ id: subflow.id, isEnabled })
              }
              onDeleteSubflow={id => deleteSubflow.mutate({ id })}
              onGrant={(userId, role, hours) => {
                if (selectedId)
                  grantMember.mutate({
                    workflowId: selectedId,
                    userId,
                    role,
                    expiresAt: hours
                      ? new Date(Date.now() + hours * 60 * 60 * 1000)
                      : undefined,
                  });
              }}
              onRevoke={(userId, role) => {
                if (selectedId)
                  revokeMember.mutate({ workflowId: selectedId, userId, role });
              }}
            />
          )}
          {section === "runs" && !routeRestoring && (
            <div>
              <div
                data-aiflow-run-view-tabs
                role="tablist"
                aria-label="已启动流程视图"
                className="flex min-h-12 items-end gap-1 overflow-x-auto border-b border-slate-200 bg-white px-4"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={runView === "workbench"}
                  className={`h-12 shrink-0 border-b-2 px-4 text-sm ${runView === "workbench" ? "border-[#2d6bea] bg-blue-50 text-[#245fc8]" : "border-transparent text-slate-500 hover:bg-slate-50"}`}
                  onClick={() =>
                    navigateRoute({ section: "runs", view: "workbench" })
                  }
                >
                  流程工作台
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={runView === "monitor"}
                  className={`h-12 shrink-0 border-b-2 px-4 text-sm ${runView === "monitor" ? "border-[#2d6bea] bg-blue-50 text-[#245fc8]" : "border-transparent text-slate-500 hover:bg-slate-50"}`}
                  onClick={() =>
                    selectedId &&
                    navigateRoute({
                      section: "runs",
                      view: "monitor",
                      workflowId: selectedId,
                    })
                  }
                >
                  运行监控
                </button>
              </div>
              {runView === "workbench" ? (
                <ProcessWorkbench />
              ) : (
                <RunCenter
                  workflowId={selectedId}
                  workflowName={selectedWorkflow?.name}
                  selectedRun={runDetail.data ?? null}
                  onSelect={runId =>
                    selectedId &&
                    navigateRoute({
                      section: "runs",
                      view: "monitor",
                      workflowId: selectedId,
                      runId,
                    })
                  }
                />
              )}
            </div>
          )}
          {section === "warehouse" && (
            <WorkflowWarehouse
              projects={(projects.data ?? []) as ProjectRecord[]}
              onOpenWorkflow={(project, workflowId) => {
                setSelectedProject(project);
                openFlowEditor(workflowId, "warehouse");
              }}
            />
          )}
          {section === "system" &&
            user.role === "admin" &&
            systemView === "config" && (
              <SystemConfigShell
                onOpenIdentity={() =>
                  navigateRoute({ section: "system", view: "identity" })
                }
                onOpenOrganization={() =>
                  navigateRoute({ section: "system", view: "organization" })
                }
              />
            )}
          {section === "system" &&
            user.role === "admin" &&
            systemView === "organization" && (
              <OrganizationManagementPage
                onBack={() =>
                  navigateRoute({ section: "system", view: "config" })
                }
              />
            )}
          {section === "system" &&
            user.role === "admin" &&
            systemView === "identity" && (
              <div className="min-h-[calc(100vh-56px)] bg-[#f5f7fb] p-4 sm:p-6">
                <div className="mx-auto max-w-6xl">
                  <button
                    className="mb-4 text-sm text-[#2d6bea] hover:underline"
                    onClick={() =>
                      navigateRoute({ section: "system", view: "config" })
                    }
                  >
                    ← 返回系统配置
                  </button>
                  <IamCenter
                    users={users.data ?? []}
                    roles={roles.data ?? []}
                    audit={audit.data ?? []}
                    form={userForm}
                    setForm={setUserForm}
                    onCreate={() =>
                      createUser.mutateAsync({
                        ...userForm,
                        email: userForm.email || undefined,
                      })
                    }
                    creating={
                      createUser.isPending || createUsersBatch.isPending
                    }
                    onToggleStatus={(id, status) =>
                      updateUserStatus.mutate({
                        userId: id,
                        status: status === "active" ? "disabled" : "active",
                      })
                    }
                    aiForm={aiUserForm}
                    setAiForm={setAiUserForm}
                    aiPreview={aiPreview}
                    setAiPreview={setAiPreview}
                    onPreview={() =>
                      aiPreviewMutation.mutate({
                        goal: aiUserForm.goal,
                        maxUsers: Number(aiUserForm.maxUsers),
                        defaultRole: aiUserForm.defaultRole,
                      })
                    }
                    previewing={aiPreviewMutation.isPending}
                    onConfirmPreview={selectedUsers => {
                      if (aiUserForm.password.length < 12) {
                        toast.error("请先填写至少 12 位初始密码");
                        return Promise.reject(new Error("初始密码尚未完成"));
                      }
                      return createUsersBatch.mutateAsync({
                        users: selectedUsers.map(account => ({
                          username: account.username,
                          name: account.displayName,
                          password: aiUserForm.password,
                          email: account.email || undefined,
                          role: account.role,
                        })),
                      });
                    }}
                  />
                </div>
              </div>
            )}
        </section>
      </div>
      <input
        ref={importRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={importDefinition}
      />
      <CreationDialog
        open={createFlowOpen}
        onOpenChange={setCreateFlowOpen}
        title="新建流程"
        description="填写流程名称后调用真实创建接口；取消不会创建草稿。"
        submitLabel="新建并打开"
        pending={createFlow.isPending}
        onSubmit={() => createFlow.mutate({ name: newFlowName })}
      >
        <Input
          autoFocus
          value={newFlowName}
          onChange={event => setNewFlowName(event.target.value)}
          placeholder="流程名称"
          required
        />
      </CreationDialog>
      {general.watermarkEnabled && general.watermarkText && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-20 grid grid-cols-2 content-around gap-24 overflow-hidden px-12 text-center text-3xl font-bold tracking-[.18em] text-slate-400/15 [transform:rotate(-24deg)_scale(1.25)] sm:grid-cols-3"
        >
          {Array.from({ length: 15 }, (_, index) => (
            <span key={index}>{general.watermarkText}</span>
          ))}
        </div>
      )}
    </main>
  );
}

function FlowDesigner({
  workflow,
  definition,
  name,
  setName,
  canEdit,
  canPublish,
  canRun,
  canManage,
  members,
  candidates,
  savePending,
  publishPending,
  compilePending,
  compileDiagnostics,
  runPending,
  runInput,
  setRunInput,
  models,
  templates,
  subflows,
  onDefinitionChange,
  backLabel,
  onBackToDesignCenter,
  onSave,
  onPublish,
  onValidate,
  onRun,
  onExport,
  onImport,
  onDuplicate,
  onDelete,
  onSaveAsSubflow,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  onToggleSubflow,
  onDeleteSubflow,
  onGrant,
  onRevoke,
}: {
  workflow: any;
  definition: Definition | null;
  name: string;
  setName: (value: string) => void;
  canEdit: boolean;
  canPublish: boolean;
  canRun: boolean;
  canManage: boolean;
  members: any[];
  candidates: any[];
  savePending: boolean;
  publishPending: boolean;
  compilePending: boolean;
  compileDiagnostics: CompileDiagnostic[];
  runPending: boolean;
  runInput: Record<string, unknown>;
  setRunInput: (value: Record<string, unknown>) => void;
  models: Array<{ id: string; ownedBy: string }>;
  templates: any[];
  subflows: any[];
  onDefinitionChange: (definition: Definition) => void;
  backLabel: string;
  onBackToDesignCenter: () => void;
  onSave: () => void;
  onPublish: () => void;
  onValidate: () => void;
  onRun: () => void;
  onExport: () => void;
  onImport: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSaveAsSubflow: () => void;
  onCreateTemplate: (input: any) => void;
  onUpdateTemplate: (template: any, updates: any) => void;
  onDeleteTemplate: (id: string) => void;
  onToggleSubflow: (subflow: any, isEnabled: boolean) => void;
  onDeleteSubflow: (id: string) => void;
  onGrant: (
    userId: number,
    role: "owner" | "editor" | "operator" | "viewer",
    hours?: number
  ) => void;
  onRevoke: (
    userId: number,
    role: "owner" | "editor" | "operator" | "viewer"
  ) => void;
}) {
  const [candidateId, setCandidateId] = useState("");
  const [memberRole, setMemberRole] = useState<
    "owner" | "editor" | "operator" | "viewer"
  >("viewer");
  const [hours, setHours] = useState("");
  const runtimeModels = trpc.workflow.runtimeModels.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
  });
  const utils = trpc.useUtils();
  const unpublishFlow = trpc.workflow.unpublish.useMutation({
    onSuccess: () => {
      void utils.workflow.list.invalidate();
      toast.success("流程已取消发布；历史版本与运行审计已保留。");
    },
    onError: error => toast.error(error.message),
  });
  const onUnpublish = () => {
    if (
      window.confirm(
        "确定取消发布当前流程吗？流程将无法继续发起，但历史版本和运行记录会保留。"
      )
    )
      unpublishFlow.mutate({ id: workflow.id });
  };
  if (!workflow || !definition)
    return (
      <div className="grid min-h-[calc(100vh-56px)] place-items-center p-8">
        <div className="max-w-md text-center">
          <FolderKanban className="mx-auto text-slate-300" size={42} />
          <h2 className="mt-4 font-semibold text-slate-700">
            选择或创建一个流程
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            流程仓库显示了你拥有或被授予查看权限的工作流。
          </p>
        </div>
      </div>
    );
  return (
    <div
      data-aiflow-designer=""
      className="min-w-0 max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5"
    >
      <div
        data-aiflow-context-header
        className="mb-4 flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-center"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              className="inline-flex items-center gap-1 font-medium text-[#2d6bea] hover:underline"
              aria-label={backLabel}
              title={backLabel}
              onClick={onBackToDesignCenter}
            >
              <ChevronLeft size={14} />
              {backLabel}
            </button>
            <span className="text-slate-300">/</span>
            <span className="inline-flex items-center gap-1 text-slate-400">
              <FolderKanban size={13} />
              业务流程
              <ChevronRight size={13} />
              设计器
            </span>
          </div>
          <div className="mt-2 flex max-w-md items-center gap-1">
            <Input
              aria-label="流程名称"
              className="h-9 min-w-0 flex-1 border-transparent bg-transparent px-0 text-xl font-semibold shadow-none focus-visible:border-blue-300 focus-visible:ring-0 disabled:opacity-100"
              value={name}
              disabled={!canEdit}
              onChange={event => setName(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onImport}
            disabled={!canEdit}
          >
            <Upload size={14} />
            导入
          </Button>
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download size={14} />
            导出
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onSave}
            disabled={!canEdit || savePending || workflow.status === "published"}
            title={
              workflow.status === "published"
                ? "已发布流程请使用发布操作提交新版本，或先取消发布"
                : "保存草稿画布"
            }
          >
            {savePending ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <FileJson size={14} />
            )}
            {workflow.status === "published" ? "已发布" : "保存画布"}
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-500"
            onClick={onPublish}
            disabled={!canPublish || publishPending || compilePending}
          >
            {publishPending && <Loader2 className="animate-spin" size={14} />}
            发布
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-violet-200 text-violet-700 hover:bg-violet-50"
            onClick={onValidate}
            disabled={!canPublish || compilePending}
          >
            {compilePending && <Loader2 className="animate-spin" size={14} />}
            编译检查
          </Button>
          {canManage && (
            <>
              <Button variant="outline" size="sm" onClick={onDuplicate}>
                <Copy size={14} />
                复制
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-amber-200 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                onClick={onDelete}
              >
                <ArchiveRestore size={14} />
                归档
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="mb-4 min-w-0 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-950">
        <div className="flex items-center gap-2 font-semibold">
          <LockKeyhole size={15} />
          权限感知设计器
        </div>
        <p
          className={`mt-1 text-xs leading-5 ${runtimeModels.isError ? "text-amber-700" : "text-blue-700"}`}
        >
          {canEdit
            ? "你可编辑画布并保存版本。"
            : "当前为只读授权；仍可查看定义与运行反馈。"}{" "}
          {runtimeModels.isPending
            ? "正在读取 LLM 模型目录…"
            : runtimeModels.isError
              ? "LLM 运行时当前不可用，请管理员配置 OpenAI 兼容模型提供方后重试。"
              : `LLM 节点会使用服务端运行时模型目录，当前已发现 ${models.length} 个可用模型。`}
        </p>
        <details className="mt-3 min-w-0 rounded border border-blue-200 bg-white/80 p-2 text-[11px]">
          <summary className="cursor-pointer font-semibold text-blue-900">
            协作成员与有效期（{members.length}）
          </summary>
          <div className="mt-2 grid min-w-0 gap-1.5">
            {members.map(member => (
              <div
                key={member.id}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-blue-100 bg-white px-2 py-1.5"
              >
                <div className="min-w-0">
                  <span className="break-words font-medium">
                    {member.name || member.username || `用户 ${member.userId}`}
                  </span>
                  <span className="ml-2 text-blue-600">{member.role}</span>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    生效：{formatTime(member.effectiveFrom)} · 到期：
                    {member.expiresAt ? formatTime(member.expiresAt) : "长期"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${member.revokedAt ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}
                  >
                    {member.revokedAt ? "已撤销" : "有效"}
                  </span>
                  {canManage && !member.revokedAt && (
                    <button
                      type="button"
                      className="text-[10px] text-red-600 hover:underline"
                      onClick={() => onRevoke(member.userId, member.role)}
                    >
                      撤销
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!members.length && (
              <span className="text-blue-500">暂无可见协作成员。</span>
            )}
          </div>
        </details>
        {canManage && (
          <form
            className="mt-3 grid min-w-0 gap-2 rounded border border-dashed border-blue-300 bg-white p-2 text-[11px]"
            onSubmit={event => {
              event.preventDefault();
              const userId = Number(candidateId);
              if (!userId) return;
              onGrant(userId, memberRole, hours ? Number(hours) : undefined);
              setCandidateId("");
              setHours("");
            }}
          >
            <p className="font-semibold text-blue-900">授予流程成员</p>
            <select
              className="h-8 min-w-0 max-w-full rounded border border-slate-200 bg-white px-2"
              value={candidateId}
              onChange={event => setCandidateId(event.target.value)}
              required
            >
              <option value="">选择内部账号</option>
              {candidates.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name || candidate.username}（{candidate.username}）
                </option>
              ))}
            </select>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              <select
                className="h-8 min-w-0 rounded border border-slate-200 bg-white px-2"
                value={memberRole}
                onChange={event =>
                  setMemberRole(event.target.value as typeof memberRole)
                }
              >
                <option value="viewer">查看者</option>
                <option value="operator">运行者</option>
                <option value="editor">编辑者</option>
                <option value="owner">所有者</option>
              </select>
              <input
                className="h-8 min-w-0 rounded border border-slate-200 px-2"
                type="number"
                min="1"
                placeholder="有效期小时（可选）"
                value={hours}
                onChange={event => setHours(event.target.value)}
              />
            </div>
            <Button
              className="h-8 bg-blue-600 text-xs hover:bg-blue-500"
              type="submit"
            >
              授予成员
            </Button>
          </form>
        )}
      </div>
      {compileDiagnostics.length > 0 && (
        <section className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3" aria-label="流程编译诊断">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-red-900">发布前检查未通过</p>
              <p className="mt-1 text-xs text-red-700">共 {compileDiagnostics.length} 项问题；修复后重新执行编译检查。</p>
            </div>
            <button type="button" className="text-xs text-red-700 underline" onClick={() => window.dispatchEvent(new CustomEvent("flow:focus-node", { detail: { nodeId: compileDiagnostics[0]?.location.nodeId } }))}>定位第一项</button>
          </div>
          <ul className="mt-2 grid gap-1.5 text-xs text-red-900">
            {compileDiagnostics.map((item, index) => (
              <li key={`${item.code}-${item.location.nodeId ?? item.location.edgeId ?? index}`} className="flex min-w-0 flex-wrap items-baseline gap-2 rounded border border-red-100 bg-white/70 px-2 py-1.5">
                <code className="font-semibold">{item.code}</code>
                <span className="min-w-0 flex-1">{item.message}</span>
                {(item.location.nodeId || item.location.edgeId) && <button type="button" className="text-red-700 underline" onClick={() => window.dispatchEvent(new CustomEvent("flow:focus-node", { detail: { nodeId: item.location.nodeId } }))}>{item.location.nodeId ? `节点 ${item.location.nodeId}` : `连线 ${item.location.edgeId}`}</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <StructuredRunInput
        value={runInput}
        onChange={setRunInput}
        canRun={canRun}
        runPending={runPending}
        onRun={onRun}
      />
      <WorkflowCanvas
        key={`${workflow.id}:${workflow.definitionVersion}`}
        workflowId={workflow.id}
        flowType={workflow.flowType ?? "state"}
        definition={definition}
        readOnly={!canEdit}
        onDefinitionChange={onDefinitionChange}
        templates={templates}
        subflows={subflows}
        onSaveTemplate={onCreateTemplate}
        onUpdateTemplate={onUpdateTemplate}
        onDeleteTemplate={onDeleteTemplate}
        onToggleSubflow={onToggleSubflow}
        onDeleteSubflow={onDeleteSubflow}
      />
      {workflow.status === "published" && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-amber-950">发布治理</p>
            <p className="mt-1 text-xs leading-5 text-amber-900">
              取消发布会阻止后续发起，不会删除已有版本、运行实例或节点日志。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-amber-300 text-amber-900 hover:bg-amber-100"
            disabled={!canPublish || unpublishFlow.isPending}
            onClick={onUnpublish}
          >
            {unpublishFlow.isPending && (
              <Loader2 className="animate-spin" size={14} />
            )}
            取消发布
          </Button>
        </div>
      )}
      {canEdit && (
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-violet-200 text-violet-700 hover:bg-violet-50"
            onClick={onSaveAsSubflow}
          >
            保存当前定义为子流程
          </Button>
        </div>
      )}
      <WorkflowGovernance
        workflowId={workflow.id}
        canEdit={canEdit}
        canPublish={canPublish}
      />
    </div>
  );
}

function valueFromField(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function StructuredRunInput({
  value,
  onChange,
  canRun,
  runPending,
  onRun,
}: {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  canRun: boolean;
  runPending: boolean;
  onRun: () => void;
}) {
  const toRows = (input: Record<string, unknown>) =>
    Object.entries(input).map(([key, item]) => ({
      key,
      value: String(item ?? ""),
    }));
  const [rows, setRows] = useState(() => toRows(value));
  useEffect(() => {
    setRows(toRows(value));
  }, [value]);
  const update = (next: Array<{ key: string; value: string }>) => {
    setRows(next);
    onChange(
      Object.fromEntries(
        next
          .filter(row => row.key.trim())
          .map(row => [row.key, valueFromField(row.value)])
      )
    );
  };
  return (
    <section
      data-structured-run-input
      className="mb-3 min-w-0 rounded-lg border border-slate-200 bg-white p-3"
    >
      <div>
        <p className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <CirclePlay size={14} className="text-emerald-600" />
          运行字段
        </p>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          按字段填写本次运行输入；数值与 true/false 会自动保留类型，无需编辑
          JSON。
        </p>
      </div>
      <div className="mt-3 grid min-w-0 gap-2">
        {rows.map((row, index) => (
          <div
            key={index}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(100px,.8fr)_minmax(0,1.2fr)_auto]"
          >
            <Input
              aria-label="运行字段名称"
              className="col-span-2 min-w-0 sm:col-span-1"
              placeholder="字段名"
              value={row.key}
              onChange={event =>
                update(
                  rows.map((current, rowIndex) =>
                    rowIndex === index
                      ? { ...current, key: event.target.value }
                      : current
                  )
                )
              }
            />
            <Input
              aria-label="运行字段值"
              className="min-w-0"
              placeholder="字段值"
              value={row.value}
              onChange={event =>
                update(
                  rows.map((current, rowIndex) =>
                    rowIndex === index
                      ? { ...current, value: event.target.value }
                      : current
                  )
                )
              }
            />
            <button
              type="button"
              className="rounded px-2 text-slate-400 hover:text-red-600"
              onClick={() =>
                update(rows.filter((_, rowIndex) => rowIndex !== index))
              }
              aria-label="删除运行字段"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="w-fit text-xs font-medium text-[#245fc8] hover:underline"
          onClick={() => update([...rows, { key: "", value: "" }])}
        >
          + 添加运行字段
        </button>
      </div>
      <Button
        className="mt-3 w-full bg-blue-600 hover:bg-blue-500"
        size="sm"
        disabled={!canRun || runPending}
        onClick={onRun}
      >
        {runPending ? (
          <Loader2 className="animate-spin" size={14} />
        ) : (
          <Play size={14} />
        )}
        后端运行
      </Button>
    </section>
  );
}

function LegacyRunCenter({
  runs,
  selectedRun,
  onSelect,
}: {
  runs: any[];
  selectedRun: any;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="p-4 lg:p-6">
      <div className="mb-5">
        <p className="text-xs font-bold tracking-[.18em] text-blue-600">
          RUNTIME OBSERVABILITY
        </p>
        <h2 className="mt-1 text-xl font-semibold">执行历史与节点日志</h2>
      </div>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
            近期运行
          </div>
          <div className="max-h-[650px] overflow-y-auto">
            {runs.map(run => (
              <button
                key={run.id}
                onClick={() => onSelect(run.id)}
                className={`w-full border-b border-slate-100 p-4 text-left hover:bg-slate-50 ${selectedRun?.id === run.id ? "bg-blue-50" : ""}`}
              >
                <div className="flex justify-between gap-2">
                  <code className="text-xs text-slate-500">
                    {run.id.slice(0, 8)}
                  </code>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${run.status === "success" ? "bg-emerald-100 text-emerald-700" : run.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
                  >
                    {run.status}
                  </span>
                </div>
                <div className="mt-2 flex gap-3 text-[11px] text-slate-400">
                  <span>{formatTime(run.createdAt)}</span>
                  <span>{run.durationMs ?? "—"} ms</span>
                </div>
              </button>
            ))}
            {!runs.length && (
              <p className="p-6 text-center text-sm text-slate-400">
                尚无运行记录。
              </p>
            )}
          </div>
        </section>
        <section className="min-h-80 rounded-lg border border-slate-200 bg-white p-5">
          {selectedRun ? (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold tracking-[.18em] text-slate-400">
                    RUN {selectedRun.id.slice(0, 8)}
                  </p>
                  <h3 className="mt-1 font-semibold">
                    {selectedRun.status === "success" ? "运行成功" : "运行详情"}
                  </h3>
                </div>
                <span className="text-xs text-slate-400">
                  {selectedRun.durationMs ?? "—"} ms
                </span>
              </div>
              <div className="mt-5 grid gap-3">
                {selectedRun.nodeRuns?.map((node: any) => (
                  <details
                    key={node.id}
                    className="rounded border border-slate-200 bg-slate-50 p-3"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${node.status === "success" ? "bg-emerald-500" : node.status === "failed" ? "bg-red-500" : "bg-slate-400"}`}
                        />
                        {node.nodeName}
                        <code className="text-[10px] text-slate-400">
                          {node.nodeType}
                        </code>
                      </span>
                      <span className="text-xs text-slate-400">
                        {node.durationMs ?? "—"} ms
                      </span>
                    </summary>
                    <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 text-xs">
                      <LogBlock
                        title="输入"
                        value={decodeJson(node.inputJson)}
                      />
                      <LogBlock
                        title="输出"
                        value={decodeJson(node.outputJson)}
                      />
                      <LogBlock
                        title="错误"
                        value={decodeJson(node.errorJson)}
                      />
                    </div>
                  </details>
                ))}
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-slate-400">
              <div>
                <Clock3 className="mx-auto" size={28} />
                <p className="mt-3">从左侧选择一次运行以查看节点级日志。</p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function LogBlock({ title, value }: { title: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <p className="mb-1 font-semibold text-slate-500">{title}</p>
      <pre className="max-h-48 overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-5 text-emerald-200">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

type InternalUserForm = {
  username: string;
  name: string;
  password: string;
  email: string;
  role: "user" | "admin";
};

type AiInternalUserForm = {
  goal: string;
  maxUsers: string;
  password: string;
  defaultRole: "user" | "admin";
};

type AiUserPreview = {
  username: string;
  displayName: string;
  email?: string;
  role: "user" | "admin";
  organizationSuggestion?: string;
  managerSuggestion?: string;
  rationale: string;
};

function IamCenter({
  users,
  roles,
  audit,
  form,
  setForm,
  onCreate,
  creating,
  onToggleStatus,
  aiForm,
  setAiForm,
  aiPreview,
  setAiPreview,
  onPreview,
  previewing,
  onConfirmPreview,
}: {
  users: any[];
  roles: any[];
  audit: any[];
  form: InternalUserForm;
  setForm: (next: InternalUserForm) => void;
  onCreate: () => Promise<unknown>;
  creating: boolean;
  onToggleStatus: (id: number, status: "active" | "disabled") => void;
  aiForm: AiInternalUserForm;
  setAiForm: (next: AiInternalUserForm) => void;
  aiPreview: { users: AiUserPreview[]; generatedBy: "ai" | "fallback" } | null;
  setAiPreview: (
    next: { users: AiUserPreview[]; generatedBy: "ai" | "fallback" } | null
  ) => void;
  onPreview: () => void;
  previewing: boolean;
  onConfirmPreview: (users: AiUserPreview[]) => Promise<{
    results: Array<{ username: string; success: boolean; error?: string }>;
    created: number;
    failed: number;
  }>;
}) {
  const [normalDialogOpen, setNormalDialogOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [tab, setTab] = useState<"users" | "roles" | "audit">("users");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [roleSearch, setRoleSearch] = useState("");
  const [mobileUserDetailsOpen, setMobileUserDetailsOpen] = useState(false);
  const [mobileRoleDetailsOpen, setMobileRoleDetailsOpen] = useState(false);
  const [assignmentDialog, setAssignmentDialog] = useState<{
    mode: "user" | "role";
    userId: string;
    roleCode: string;
  } | null>(null);
  const [assignmentHours, setAssignmentHours] = useState("");
  const [assignmentNote, setAssignmentNote] = useState("");
  const [selectedPreviewUsers, setSelectedPreviewUsers] = useState<Set<string>>(
    new Set()
  );
  const [batchResult, setBatchResult] = useState<Array<{
    username: string;
    success: boolean;
    error?: string;
  }> | null>(null);
  const utils = trpc.useUtils();
  const userDetails = trpc.iam.userAuthorizationDetails.useQuery(
    { userId: selectedUserId ?? 1 },
    { enabled: selectedUserId !== null, retry: false }
  );
  const roleDetails = trpc.iam.roleAuthorizationDetails.useQuery(
    { roleId: selectedRoleId ?? 1 },
    { enabled: selectedRoleId !== null, retry: false }
  );
  const assignSystemRole = trpc.iam.assignSystemRole.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.iam.userAuthorizationDetails.invalidate(),
        utils.iam.roleAuthorizationDetails.invalidate(),
        utils.iam.authorizationAudit.invalidate(),
      ]);
      setAssignmentDialog(null);
      setAssignmentHours("");
      setAssignmentNote("");
      toast.success("角色绑定已生效。");
    },
    onError: error => toast.error(error.message),
  });
  const revokeRole = trpc.iam.revokeRoleAssignment.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.iam.userAuthorizationDetails.invalidate(),
        utils.iam.roleAuthorizationDetails.invalidate(),
        utils.iam.authorizationAudit.invalidate(),
      ]);
      toast.success("直接角色授权已撤销。");
    },
    onError: error => toast.error(error.message),
  });

  const filteredUsers = useMemo(() => {
    const keyword = userSearch.trim().toLowerCase();
    if (!keyword) return users;
    return users.filter(account =>
      [account.name, account.username, account.email].some(value =>
        String(value ?? "")
          .toLowerCase()
          .includes(keyword)
      )
    );
  }, [userSearch, users]);
  const filteredRoles = useMemo(() => {
    const keyword = roleSearch.trim().toLowerCase();
    if (!keyword) return roles;
    return roles.filter(role =>
      [role.code, role.name, role.description].some(value =>
        String(value ?? "")
          .toLowerCase()
          .includes(keyword)
      )
    );
  }, [roleSearch, roles]);
  const systemRoles = useMemo(
    () => roles.filter(role => role.scope === "system"),
    [roles]
  );
  const selectedRole = roles.find(role => Number(role.id) === selectedRoleId);

  useEffect(() => {
    if (selectedUserId === null && users[0])
      setSelectedUserId(Number(users[0].id));
  }, [selectedUserId, users]);
  useEffect(() => {
    if (selectedRoleId === null && roles[0])
      setSelectedRoleId(Number(roles[0].id));
  }, [roles, selectedRoleId]);
  useEffect(() => {
    if (
      filteredUsers.length &&
      !filteredUsers.some(account => Number(account.id) === selectedUserId)
    )
      setSelectedUserId(Number(filteredUsers[0].id));
  }, [filteredUsers, selectedUserId]);
  useEffect(() => {
    if (
      filteredRoles.length &&
      !filteredRoles.some(role => Number(role.id) === selectedRoleId)
    )
      setSelectedRoleId(Number(filteredRoles[0].id));
  }, [filteredRoles, selectedRoleId]);
  useEffect(() => {
    setSelectedPreviewUsers(
      new Set((aiPreview?.users ?? []).map(account => account.username))
    );
    setBatchResult(null);
  }, [aiPreview]);

  const submitNormalUser = async () => {
    await onCreate();
    setNormalDialogOpen(false);
  };

  const submitAiUser = async () => {
    if (!aiPreview) {
      onPreview();
      return;
    }
    const selected = aiPreview.users.filter(account =>
      selectedPreviewUsers.has(account.username)
    );
    if (!selected.length) {
      toast.error("请至少选择一条用户建议。");
      return;
    }
    const result = await onConfirmPreview(selected);
    setBatchResult(result.results);
    if (!result.failed) {
      setAiDialogOpen(false);
      setAiForm({
        goal: "",
        maxUsers: "10",
        password: "",
        defaultRole: "user",
      });
      setAiPreview(null);
    }
  };

  const resetPreview = (next: AiInternalUserForm) => {
    setAiForm(next);
    setAiPreview(null);
  };

  const openUserAssignment = () => {
    if (!selectedUserId) return;
    const assignedCodes = new Set(
      (userDetails.data?.directRoles ?? []).map((role: any) => role.roleCode)
    );
    const firstAvailableRole = systemRoles.find(
      role => !assignedCodes.has(role.code)
    );
    setMobileUserDetailsOpen(false);
    setAssignmentDialog({
      mode: "user",
      userId: String(selectedUserId),
      roleCode: firstAvailableRole?.code ?? "",
    });
  };

  const openRoleAssignment = () => {
    if (!selectedRole || selectedRole.scope !== "system") return;
    const assignedUserIds = new Set(
      (roleDetails.data?.directUsers ?? []).map((account: any) =>
        Number(account.userId)
      )
    );
    const firstAvailableUser = users.find(
      account =>
        account.status === "active" && !assignedUserIds.has(Number(account.id))
    );
    setMobileRoleDetailsOpen(false);
    setAssignmentDialog({
      mode: "role",
      userId: firstAvailableUser ? String(firstAvailableUser.id) : "",
      roleCode: selectedRole.code,
    });
  };

  const submitRoleAssignment = () => {
    if (!assignmentDialog?.userId || !assignmentDialog.roleCode) return;
    const hours = assignmentHours ? Number(assignmentHours) : undefined;
    assignSystemRole.mutate({
      userId: Number(assignmentDialog.userId),
      roleCode: assignmentDialog.roleCode,
      expiresAt: hours ? new Date(Date.now() + hours * 3600_000) : undefined,
      note: assignmentNote.trim() || undefined,
    });
  };

  return (
    <div className="space-y-5 p-4 lg:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold tracking-[.18em] text-blue-600">
            IDENTITY & AUTHORIZATION
          </p>
          <h2 className="mt-1 text-xl font-semibold">内部账号与权限中心</h2>
          <p className="mt-1 text-xs text-slate-500">
            参考 BDP
            的角色、权限、用户主从结构，账号创建仅通过弹窗提交真实接口。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setAiPreview(null);
              setBatchResult(null);
              setAiDialogOpen(true);
            }}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-100 text-violet-700">
              <WandSparkles size={13} />
            </span>
            AI 辅助批量创建
          </Button>
          <Button
            type="button"
            className="bg-[#2d6bea] hover:bg-[#255bc8]"
            onClick={() => setNormalDialogOpen(true)}
          >
            <Plus size={15} />
            新增内部账号
          </Button>
        </div>
      </div>

      <CreationDialog
        open={normalDialogOpen}
        onOpenChange={setNormalDialogOpen}
        title="新增内部账号"
        description="填写账号信息后调用内部账号创建接口；取消不会写入用户表。"
        submitLabel="创建账号"
        pending={creating}
        onSubmit={submitNormalUser}
      >
        <Input
          autoFocus
          placeholder="用户名"
          value={form.username}
          onChange={event => setForm({ ...form, username: event.target.value })}
          required
        />
        <Input
          placeholder="显示名称"
          value={form.name}
          onChange={event => setForm({ ...form, name: event.target.value })}
          required
        />
        <Input
          type="password"
          minLength={12}
          placeholder="至少 12 位密码"
          value={form.password}
          onChange={event => setForm({ ...form, password: event.target.value })}
          required
        />
        <Input
          type="email"
          placeholder="邮箱（可选）"
          value={form.email}
          onChange={event => setForm({ ...form, email: event.target.value })}
        />
        <select
          className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
          value={form.role}
          onChange={event =>
            setForm({
              ...form,
              role: event.target.value as InternalUserForm["role"],
            })
          }
        >
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
      </CreationDialog>

      <CreationDialog
        open={aiDialogOpen}
        onOpenChange={setAiDialogOpen}
        title="AI 辅助创建用户"
        description="输入目标后由模型生成非敏感用户列表；密码不会发送给模型，确认后才调用真实批量创建接口。"
        submitLabel={
          aiPreview
            ? `创建选中的 ${selectedPreviewUsers.size} 个用户`
            : "生成用户预览"
        }
        pending={previewing || creating}
        onSubmit={submitAiUser}
        className="max-w-5xl"
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_160px]">
          <textarea
            autoFocus
            className="min-h-24 w-full rounded-md border border-slate-200 bg-white p-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 md:row-span-2"
            placeholder="例如：为财务部创建 5 名报销审核专员，显示名按一至五组命名，邮箱使用 example.com 域名。"
            value={aiForm.goal}
            onChange={event =>
              resetPreview({ ...aiForm, goal: event.target.value })
            }
            required
          />
          <label className="grid min-w-0 gap-1 text-xs text-slate-500">
            最多生成
            <Input
              type="number"
              min={1}
              max={30}
              value={aiForm.maxUsers}
              onChange={event =>
                resetPreview({ ...aiForm, maxUsers: event.target.value })
              }
              required
            />
          </label>
          <label className="grid min-w-0 gap-1 text-xs text-slate-500">
            账号角色
            <select
              className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm"
              value={aiForm.defaultRole}
              onChange={event =>
                resetPreview({
                  ...aiForm,
                  defaultRole: event.target
                    .value as AiInternalUserForm["defaultRole"],
                })
              }
            >
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
            </select>
          </label>
          <p className="self-end break-words text-[11px] leading-5 text-slate-400 md:col-span-2">
            模型不能提升此处指定角色；生成预览不会写数据库。
          </p>
        </div>
        {aiPreview && (
          <div className="min-w-0 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 text-xs text-slate-700">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-indigo-950">
                即将创建的用户（{aiPreview.users.length}）
              </p>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] text-indigo-700">
                {aiPreview.generatedBy === "ai" ? "AI 生成" : "安全回退"}
              </span>
            </div>
            <div className="max-h-[360px] overflow-auto rounded-md border border-indigo-100 bg-white">
              <table className="w-full min-w-[880px] table-fixed text-left">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="w-10 p-2">
                      <input
                        aria-label="选择全部预览用户"
                        type="checkbox"
                        checked={
                          selectedPreviewUsers.size === aiPreview.users.length
                        }
                        onChange={event =>
                          setSelectedPreviewUsers(
                            event.target.checked
                              ? new Set(
                                  aiPreview.users.map(
                                    account => account.username
                                  )
                                )
                              : new Set()
                          )
                        }
                      />
                    </th>
                    <th className="w-36 p-2">用户名</th>
                    <th className="w-32 p-2">显示名</th>
                    <th className="w-44 p-2">邮箱</th>
                    <th className="w-24 p-2">角色</th>
                    <th className="w-36 p-2">组织/上级建议</th>
                    <th className="p-2">生成依据</th>
                  </tr>
                </thead>
                <tbody>
                  {aiPreview.users.map(account => (
                    <tr
                      key={account.username}
                      className="border-t border-slate-100 align-top"
                    >
                      <td className="p-2">
                        <input
                          aria-label={`选择 ${account.username}`}
                          type="checkbox"
                          checked={selectedPreviewUsers.has(account.username)}
                          onChange={event =>
                            setSelectedPreviewUsers(current => {
                              const next = new Set(current);
                              if (event.target.checked)
                                next.add(account.username);
                              else next.delete(account.username);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="break-all p-2 font-mono text-indigo-700">
                        {account.username}
                      </td>
                      <td className="break-words p-2 font-medium">
                        {account.displayName}
                      </td>
                      <td className="break-all p-2 text-slate-500">
                        {account.email || "—"}
                      </td>
                      <td className="p-2">
                        {account.role === "admin" ? "管理员" : "普通用户"}
                      </td>
                      <td className="break-words p-2 text-slate-500">
                        {account.organizationSuggestion || "—"}
                        <br />
                        {account.managerSuggestion || ""}
                      </td>
                      <td className="break-words p-2 text-slate-500">
                        {account.rationale}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="mt-3 grid gap-1 text-xs font-medium text-slate-600 sm:max-w-md">
              统一初始密码（不会发送给大模型）
              <Input
                type="password"
                minLength={12}
                placeholder="至少 12 位；仅用于本次确认创建"
                value={aiForm.password}
                onChange={event =>
                  setAiForm({ ...aiForm, password: event.target.value })
                }
                required
              />
            </label>
          </div>
        )}
        {batchResult && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs">
            <p className="font-semibold text-amber-900">
              部分账号创建失败，请修正目标后重新生成
            </p>
            {batchResult
              .filter(item => !item.success)
              .map(item => (
                <p
                  key={item.username}
                  className="mt-1 break-all text-amber-800"
                >
                  {item.username}：{item.error || "创建失败"}
                </p>
              ))}
          </div>
        )}
      </CreationDialog>

      <CreationDialog
        open={assignmentDialog !== null}
        onOpenChange={open => {
          if (!open) setAssignmentDialog(null);
        }}
        title={
          assignmentDialog?.mode === "role"
            ? "为角色绑定用户"
            : "为用户绑定角色"
        }
        description="在当前主从工作台中完成直接系统角色授权；组织继承角色仍在组织架构中维护。"
        submitLabel="确认绑定"
        pending={assignSystemRole.isPending}
        submitDisabled={!assignmentDialog?.userId || !assignmentDialog.roleCode}
        onSubmit={submitRoleAssignment}
      >
        {assignmentDialog?.mode === "user" ? (
          <>
            <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
              当前用户
              <Input
                value={
                  userDetails.data?.user.name ||
                  userDetails.data?.user.username ||
                  ""
                }
                disabled
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
              系统角色
              <select
                className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm"
                value={assignmentDialog.roleCode}
                onChange={event =>
                  setAssignmentDialog({
                    ...assignmentDialog,
                    roleCode: event.target.value,
                  })
                }
                required
              >
                <option value="">暂无可绑定角色</option>
                {systemRoles
                  .filter(
                    role =>
                      !(userDetails.data?.directRoles ?? []).some(
                        (assigned: any) => assigned.roleCode === role.code
                      )
                  )
                  .map(role => (
                    <option key={role.id} value={role.code}>
                      {role.name}（{role.code}）
                    </option>
                  ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
              当前角色
              <Input
                value={
                  selectedRole
                    ? `${selectedRole.name}（${selectedRole.code}）`
                    : ""
                }
                disabled
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
              内部用户
              <select
                className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm"
                value={assignmentDialog?.userId ?? ""}
                onChange={event =>
                  assignmentDialog &&
                  setAssignmentDialog({
                    ...assignmentDialog,
                    userId: event.target.value,
                  })
                }
                required
              >
                <option value="">暂无可绑定用户</option>
                {users
                  .filter(
                    account =>
                      account.status === "active" &&
                      !(roleDetails.data?.directUsers ?? []).some(
                        (assigned: any) =>
                          Number(assigned.userId) === Number(account.id)
                      )
                  )
                  .map(account => (
                    <option key={account.id} value={account.id}>
                      {account.name || account.username}（{account.username}）
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
          有效期小时（可选）
          <Input
            type="number"
            min={1}
            placeholder="留空表示长期有效"
            value={assignmentHours}
            onChange={event => setAssignmentHours(event.target.value)}
          />
        </label>
        <label className="grid min-w-0 gap-1.5 text-sm font-medium text-slate-700">
          授权备注（可选）
          <Input
            maxLength={320}
            placeholder="记录授权原因，最多 320 字"
            value={assignmentNote}
            onChange={event => setAssignmentNote(event.target.value)}
          />
        </label>
      </CreationDialog>

      <div
        role="tablist"
        aria-label="内部账号与权限中心"
        className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-2"
      >
        {(
          [
            { id: "users", label: "用户账号", icon: UsersRound },
            { id: "roles", label: "角色与权限", icon: KeyRound },
            { id: "audit", label: "授权审计", icon: SlidersHorizontal },
          ] as const
        ).map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`flex h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm ${tab === item.id ? "border-[#2d6bea] bg-blue-50 text-[#245fc8]" : "border-transparent text-slate-500 hover:bg-slate-50"}`}
            onClick={() => setTab(item.id)}
          >
            <span
              className={`grid h-7 w-7 place-items-center rounded-full ${tab === item.id ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}
            >
              <item.icon size={14} />
            </span>
            {item.label}
          </button>
        ))}
      </div>

      {tab === "users" && (
        <div
          data-iam-user-workbench
          className="grid min-w-0 gap-5 min-[760px]:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]"
        >
          <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">用户目录</p>
                <span className="text-xs text-slate-400">
                  {filteredUsers.length} / {users.length}
                </span>
              </div>
              <label className="relative mt-3 block min-w-0">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={14}
                />
                <Input
                  aria-label="搜索用户"
                  className="min-w-0 pl-9"
                  placeholder="搜索名称、账号或邮箱"
                  value={userSearch}
                  onChange={event => setUserSearch(event.target.value)}
                />
              </label>
            </div>
            <div className="max-h-[620px] overflow-y-auto p-2">
              {filteredUsers.map(account => (
                <div
                  key={account.id}
                  className={`mb-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border p-2.5 ${selectedUserId === Number(account.id) ? "border-blue-200 bg-blue-50" : "border-transparent bg-slate-50 hover:border-slate-200"}`}
                >
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => setSelectedUserId(Number(account.id))}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <p className="min-w-0 break-words text-sm font-medium text-slate-800">
                        {account.name || account.username}
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${account.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}
                      >
                        {account.status === "active" ? "启用" : "停用"}
                      </span>
                    </div>
                    <p className="mt-0.5 break-all font-mono text-[11px] text-slate-400">
                      {account.username}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {account.role === "admin" ? "系统管理员" : "普通用户"} ·
                      最后登录 {formatTime(account.lastSignedIn)}
                    </p>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px] min-[760px]:hidden"
                      onClick={() => {
                        setSelectedUserId(Number(account.id));
                        setMobileUserDetailsOpen(true);
                      }}
                    >
                      <Eye size={13} />
                      权限与角色
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => onToggleStatus(account.id, account.status)}
                    >
                      {account.status === "active" ? "停用" : "启用"}
                    </Button>
                  </div>
                </div>
              ))}
              {!filteredUsers.length && (
                <p className="p-8 text-center text-sm text-slate-400">
                  没有匹配的内部用户。
                </p>
              )}
            </div>
          </section>
          <section className="sticky top-4 hidden min-w-0 self-start overflow-hidden rounded-lg border border-slate-200 bg-white min-[760px]:block">
            <UserAuthorizationPanel
              details={userDetails}
              onAssign={openUserAssignment}
              onRevoke={assignmentId => {
                if (window.confirm("确定撤销这条直接角色授权吗？"))
                  revokeRole.mutate({ assignmentId });
              }}
              revoking={revokeRole.isPending}
            />
          </section>
          <Dialog
            open={mobileUserDetailsOpen}
            onOpenChange={setMobileUserDetailsOpen}
          >
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>用户权限与角色</DialogTitle>
                <DialogDescription>
                  在当前用户上下文中查看有效权限、绑定或撤销直接角色。
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto pr-1">
                <UserAuthorizationPanel
                  details={userDetails}
                  onAssign={openUserAssignment}
                  onRevoke={assignmentId => {
                    if (window.confirm("确定撤销这条直接角色授权吗？"))
                      revokeRole.mutate({ assignmentId });
                  }}
                  revoking={revokeRole.isPending}
                  embedded
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {tab === "roles" && (
        <div
          data-iam-role-workbench
          className="grid min-w-0 gap-5 min-[760px]:grid-cols-[280px_minmax(0,1fr)]"
        >
          <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">角色列表</p>
                <span className="text-xs text-slate-400">
                  {filteredRoles.length} / {roles.length}
                </span>
              </div>
              <label className="relative mt-3 block min-w-0">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={14}
                />
                <Input
                  aria-label="搜索角色"
                  className="min-w-0 pl-9"
                  placeholder="搜索角色名称或编码"
                  value={roleSearch}
                  onChange={event => setRoleSearch(event.target.value)}
                />
              </label>
            </div>
            <div className="max-h-[620px] overflow-y-auto p-2">
              {filteredRoles.map(role => (
                <div
                  key={role.id}
                  className="mb-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1"
                >
                  <button
                    type="button"
                    className={`min-w-0 rounded-lg border p-3 text-left ${selectedRoleId === Number(role.id) ? "border-blue-200 bg-blue-50" : "border-transparent bg-slate-50 hover:border-slate-200"}`}
                    onClick={() => setSelectedRoleId(Number(role.id))}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="min-w-0 break-all font-mono text-xs font-semibold text-indigo-700">
                        {role.code}
                      </p>
                      <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-400">
                        {role.scope}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-xs text-slate-600">
                      {role.name}
                    </p>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2 text-[11px] min-[760px]:hidden"
                    onClick={() => {
                      setSelectedRoleId(Number(role.id));
                      setMobileRoleDetailsOpen(true);
                    }}
                  >
                    <Eye size={13} />
                    <span className="sr-only">查看角色详情</span>
                  </Button>
                </div>
              ))}
              {!filteredRoles.length && (
                <p className="p-8 text-center text-sm text-slate-400">
                  没有匹配的角色。
                </p>
              )}
            </div>
          </section>
          <section className="sticky top-4 hidden min-w-0 self-start overflow-hidden rounded-lg border border-slate-200 bg-white min-[760px]:block">
            <RoleAuthorizationPanel
              details={roleDetails}
              selectedRole={selectedRole}
              onAssign={openRoleAssignment}
            />
          </section>
          <Dialog
            open={mobileRoleDetailsOpen}
            onOpenChange={setMobileRoleDetailsOpen}
          >
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>角色权限与绑定用户</DialogTitle>
                <DialogDescription>
                  查看角色权限、直接用户、组织继承用户，并为系统角色直接绑定用户。
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[70vh] overflow-y-auto pr-1">
                <RoleAuthorizationPanel
                  details={roleDetails}
                  selectedRole={selectedRole}
                  onAssign={openRoleAssignment}
                  embedded
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {tab === "audit" && (
        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 font-semibold">
            <SlidersHorizontal size={15} />
            近期授权审计
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            {audit.map(item => (
              <div
                key={item.id}
                className="flex flex-col gap-1 border-b border-slate-50 px-5 py-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <span className="break-all font-mono text-slate-500">
                    {item.action}
                  </span>
                  <span className="ml-3 break-words text-slate-700">
                    {item.actorUsername || "系统"} →{" "}
                    {item.targetUsername || "—"}
                  </span>
                </div>
                <span className="shrink-0 text-slate-400">
                  {formatTime(item.createdAt)}
                </span>
              </div>
            ))}
            {!audit.length && (
              <p className="p-5 text-sm text-slate-400">暂未记录授权事件。</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function UserAuthorizationPanel({
  details,
  onAssign,
  onRevoke,
  revoking,
  embedded = false,
}: {
  details: any;
  onAssign: () => void;
  onRevoke: (assignmentId: string) => void;
  revoking: boolean;
  embedded?: boolean;
}) {
  return (
    <>
      <div
        className={`flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 ${embedded ? "pb-3" : "px-4 py-3"}`}
      >
        <div className="min-w-0">
          <p className="font-semibold">用户权限详情</p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            直接授权可在此维护，组织继承保持只读。
          </p>
        </div>
        <Button
          size="sm"
          className="h-8 shrink-0 bg-[#2d6bea] text-xs hover:bg-[#255bc8]"
          disabled={!details.data || details.isLoading}
          onClick={onAssign}
        >
          <Plus size={13} />
          绑定角色
        </Button>
      </div>
      <div
        className={`${embedded ? "pt-4" : "max-h-[620px] overflow-y-auto p-4"} text-xs`}
      >
        {details.isLoading && (
          <p className="text-slate-400">正在读取角色与权限…</p>
        )}
        {details.error && (
          <p className="break-words text-rose-600">{details.error.message}</p>
        )}
        {details.data && (
          <div className="space-y-4">
            <div>
              <p className="break-words text-sm font-semibold text-slate-800">
                {details.data.user.name || details.data.user.username}
              </p>
              <p className="break-all font-mono text-slate-400">
                {details.data.user.username}
              </p>
            </div>
            <RoleDetailGroup
              title="直接角色"
              roles={details.data.directRoles}
              source="直接授权"
              onRevoke={onRevoke}
              revoking={revoking}
            />
            <RoleDetailGroup
              title="组织继承角色"
              roles={details.data.inheritedRoles}
              source="组织继承"
            />
            <div>
              <p className="mb-2 font-semibold text-slate-700">
                最终有效权限（{details.data.effectivePermissions.length}）
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {details.data.effectivePermissions.map((permission: any) => (
                  <div
                    key={permission.code}
                    className="min-w-0 rounded-md bg-slate-50 p-2"
                  >
                    <p className="break-all font-mono text-indigo-700">
                      {permission.code}
                    </p>
                    <p className="mt-0.5 break-words text-slate-500">
                      {permission.name}
                    </p>
                  </div>
                ))}
                {!details.data.effectivePermissions.length && (
                  <p className="text-slate-400">无</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function RoleAuthorizationPanel({
  details,
  selectedRole,
  onAssign,
  embedded = false,
}: {
  details: any;
  selectedRole: any;
  onAssign: () => void;
  embedded?: boolean;
}) {
  const assignable = selectedRole?.scope === "system";
  return (
    <>
      <div
        className={`flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 ${embedded ? "pb-3" : "px-4 py-3"}`}
      >
        <div className="min-w-0">
          <p className="font-semibold">角色权限与绑定用户</p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            角色、权限和用户保持同一主从上下文。
          </p>
        </div>
        <Button
          size="sm"
          className="h-8 shrink-0 bg-[#2d6bea] text-xs hover:bg-[#255bc8]"
          disabled={!details.data || details.isLoading || !assignable}
          onClick={onAssign}
        >
          <Plus size={13} />
          {assignable ? "绑定用户" : "流程内绑定"}
        </Button>
      </div>
      <div
        className={`${embedded ? "pt-4" : "max-h-[620px] overflow-y-auto p-4"} text-xs`}
      >
        {details.isLoading && (
          <p className="text-slate-400">正在读取角色绑定…</p>
        )}
        {details.error && (
          <p className="break-words text-rose-600">{details.error.message}</p>
        )}
        {details.data && (
          <div className="space-y-5">
            <div>
              <p className="break-words text-base font-semibold text-slate-800">
                {details.data.role.name}
              </p>
              <p className="mt-1 break-all font-mono text-indigo-700">
                {details.data.role.code}
              </p>
              <p className="mt-1 break-words leading-5 text-slate-500">
                {details.data.role.description || "未填写角色说明"}
              </p>
              {!assignable && (
                <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 leading-5 text-amber-800">
                  流程范围角色需在对应流程的成员权限页绑定，避免跨流程误授权。
                </p>
              )}
            </div>
            <div>
              <p className="mb-2 font-semibold text-slate-700">
                权限清单（{details.data.permissions.length}）
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {details.data.permissions.map((permission: any) => (
                  <div
                    key={permission.code}
                    className="min-w-0 rounded-md border border-slate-100 bg-slate-50 p-2"
                  >
                    <p className="break-all font-mono text-indigo-700">
                      {permission.code}
                    </p>
                    <p className="mt-0.5 break-words text-slate-500">
                      {permission.name}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <UserBindingGroup
              title="直接绑定用户"
              users={details.data.directUsers}
              source="直接授权"
            />
            <UserBindingGroup
              title="组织继承用户"
              users={details.data.inheritedUsers}
              source="组织继承"
            />
            {details.data.organizationUnits.length > 0 && (
              <div>
                <p className="mb-2 font-semibold text-slate-700">绑定组织</p>
                <div className="flex flex-wrap gap-1.5">
                  {details.data.organizationUnits.map((unit: any) => (
                    <span
                      key={unit.id}
                      className="max-w-full break-words rounded-full bg-violet-50 px-2.5 py-1 text-violet-700"
                    >
                      {unit.name} · {unit.code}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function RoleDetailGroup({
  title,
  roles,
  source,
  onRevoke,
  revoking = false,
}: {
  title: string;
  roles: any[];
  source: string;
  onRevoke?: (assignmentId: string) => void;
  revoking?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 font-semibold text-slate-700">
        {title}（{roles.length}）
      </p>
      <div className="grid gap-1.5">
        {roles.map((role, index) => (
          <div
            key={`${role.roleId}-${role.assignmentId || role.unitId || index}`}
            className="min-w-0 rounded-md border border-slate-100 p-2"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-1">
              <p className="break-words font-medium text-slate-700">
                {role.roleName}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">
                  {source}
                </span>
                {onRevoke && role.assignmentId && (
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[10px] text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    disabled={revoking}
                    onClick={() => onRevoke(role.assignmentId)}
                  >
                    撤销
                  </button>
                )}
              </div>
            </div>
            <p className="mt-0.5 break-all font-mono text-indigo-700">
              {role.roleCode}
            </p>
            <p className="mt-1 break-words text-slate-400">
              {role.unitName
                ? `来源组织：${role.unitName}`
                : `作用域：${role.scopeType}${role.scopeId ? ` / ${role.scopeId}` : ""}`}
            </p>
          </div>
        ))}
        {!roles.length && <p className="text-slate-400">无</p>}
      </div>
    </div>
  );
}

function UserBindingGroup({
  title,
  users,
  source,
}: {
  title: string;
  users: any[];
  source: string;
}) {
  return (
    <div>
      <p className="mb-2 font-semibold text-slate-700">
        {title}（{users.length}）
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {users.map((account, index) => (
          <div
            key={`${account.userId}-${account.assignmentId || account.unitId || index}`}
            className="min-w-0 rounded-md border border-slate-100 p-2"
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words font-medium text-slate-700">
                  {account.name || account.username}
                </p>
                <p className="break-all font-mono text-slate-400">
                  {account.username}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] text-violet-700">
                {source}
              </span>
            </div>
            <p className="mt-1 break-words text-slate-400">
              {account.unitName
                ? `组织：${account.unitName}`
                : `作用域：${account.scopeType}${account.scopeId ? ` / ${account.scopeId}` : ""}`}
            </p>
          </div>
        ))}
        {!users.length && <p className="text-slate-400">无</p>}
      </div>
    </div>
  );
}
