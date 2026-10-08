import { CanvasNameDialog } from "@/components/CanvasNameDialog";
import { getFlowProfile } from "@shared/flow-profile-contract";
import { shouldResetRunRoute } from "@shared/run-route-guard";
import { roleExpiryInput } from "@shared/role-expiry";
import { runDetailRefreshInterval } from "@shared/run-detail-refresh";
import { Button } from "@/components/ui/button";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectRecord } from "@/components/ProjectWorkspace";
import { CreationDialog } from "@/components/CreationDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { trpc } from "@/lib/trpc";
import {
  formatConsoleRoute,
  parseConsoleRoute,
  type ConsoleRoute,
  type ConsoleSection,
} from "../../../shared/console-route";
import { resolveSelectedWorkflow } from "../../../shared/workflow-selection";
import {
  canPublishWorkflowVersion,
  matchesWorkflowDefinitionSnapshot,
} from "../../../shared/workflow-publish";
import type { Definition } from "../../../server/workflow-service";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useTheme } from "@/contexts/ThemeContext";
import {
  Activity,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  Clock3,
  Compass,
  Copy,
  Download,
  FileJson,
  FolderKanban,
  FolderTree,
  Gauge,
  Eye,
  KeyRound,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Play,
  Plus,
  Save,
  ShieldCheck,
  Search,
  SlidersHorizontal,
  Sun,
  Table2,
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
const DataflowRunMonitor = lazy(() =>
  import("@/components/DataResourceCenter").then(module => ({
    default: module.DataflowRunMonitor,
  }))
);
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
const WorkflowTestRunModal = lazy(
  () => import("@/components/WorkflowTestRunModal")
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
  location: {
    kind: "definition" | "node" | "edge";
    nodeId?: string;
    edgeId?: string;
    field?: string;
  };
};
type CompileCheckState = {
  status: "idle" | "checking" | "passed" | "failed";
  checkedAt?: number;
  message?: string;
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
    onSuccess: user => {
      if (user) utils.auth.me.setData(undefined, user);
      void utils.auth.me.invalidate();
      toast.success("登录成功，正在进入流程中心。");
    },
    onError: error => toast.error(error.message),
  });
  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
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
      <main className="grid min-h-screen place-items-center bg-card text-muted-foreground">
        <div className="flex items-center gap-3 border border-border bg-card px-4 py-3 text-sm shadow-sm">
          <Loader2 className="animate-spin text-aiflow-info" size={16} />
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
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background p-5 text-foreground">
      <div className="absolute inset-x-0 top-0 h-1 bg-blue-600" />
      <section className="relative w-full max-w-md overflow-hidden border border-border bg-card shadow-sm">
        <div className="border-b border-border px-7 py-5">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="grid h-10 w-10 place-items-center rounded-lg bg-blue-600 text-white shadow-sm"
            >
              <Gauge size={21} />
            </div>
            <div>
              <p className="text-[11px] font-bold tracking-[.16em] text-muted-foreground">
                AI FLOW GRAPH
              </p>
              <h1 className="aiflow-type-page-title mt-0.5 font-semibold text-foreground">
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
          <p className="text-sm leading-6 text-muted-foreground">
            使用内部账号登录。流程、运行记录和协作授权均按资源级权限隔离。
          </p>
          {errorMessage && (
            <div
              role="alert"
              aria-live="assertive"
              className="border border-aiflow-danger-border bg-aiflow-danger-surface px-3 py-2 text-sm text-aiflow-danger"
            >
              登录失败：{errorMessage}
            </div>
          )}
          <label className="grid gap-2 text-xs font-medium text-muted-foreground">
            用户名
            <Input
              className="h-11 border-input bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-[#2d6bea]"
              autoComplete="username"
              value={credentials.username}
              onChange={event =>
                setCredentials({ ...credentials, username: event.target.value })
              }
              required
            />
          </label>
          <label className="grid gap-2 text-xs font-medium text-muted-foreground">
            密码
            <Input
              className="h-11 border-input bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-[#2d6bea]"
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
            className="mt-2 min-h-11 bg-blue-600 hover:bg-blue-700 text-white shadow-2xs font-medium"
            disabled={pending}
          >
            {pending && <Loader2 className="animate-spin" />}登录流程引擎
          </Button>
        </form>
        <div className="aiflow-type-body border-t border-border bg-muted px-7 py-4 text-muted-foreground">
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
  const { theme, toggleTheme } = useTheme();
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
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [flowListOpen, setFlowListOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = mobileNavDialogRef.current;
    if (!dialog) return;
    if (mobileNavOpen && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (!mobileNavOpen && dialog.open) {
      dialog.close();
    }
  }, [mobileNavOpen]);
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
  const persistedDraftSnapshot = useRef<{
    workflowId: string;
    name: string;
    definitionJson: string;
  } | null>(null);
  // Do not seed production runs with demo data. The designer input panel lets
  // users add only the fields required by the selected workflow.
  const [runInput, setRunInput] = useState<Record<string, unknown>>({});
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
      if (typeof window !== "undefined") window.scrollTo(0, 0);
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
  const routeProjectId =
    requestedRoute.route.section === "flows" &&
    requestedRoute.route.view === "workspace"
      ? requestedRoute.route.projectId
      : null;
  const routeProjectFromList = ((projects.data ?? []) as ProjectRecord[]).find(
    item => item.id === routeProjectId
  );
  const routeProjectQuery = trpc.project.get.useQuery(
    { projectId: routeProjectId ?? "00000000" },
    {
      enabled: Boolean(
        routeProjectId && projects.isSuccess && !routeProjectFromList
      ),
      retry: false,
    }
  );
  const routeProjectUnresolved = Boolean(
    routeProjectId &&
      !routeProjectFromList &&
      (!routeProjectQuery.isSuccess || routeProjectQuery.isFetching)
  );
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
    enabled: Boolean(
      selectedRunId && selectedWorkflow && selectedWorkflow.flowType !== "data"
    ),
    retry: false,
    refetchInterval: query =>
      runDetailRefreshInterval(
        query.state.data?.status,
        Boolean(query.state.error)
      ),
    refetchIntervalInBackground: false,
  });
  const RuntimeMonitor =
    selectedWorkflow?.flowType === "data" ? DataflowRunMonitor : RunCenter;
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
  const templates = trpc.workflow.templates.useQuery(undefined, {
    enabled: editorActive,
    retry: false,
  });
  const subflows = trpc.workflow.subflows.useQuery(undefined, {
    enabled: editorActive,
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
      if (routeProjectUnresolved) return;
      const project =
        routeProjectFromList ??
        (routeProjectQuery.data as ProjectRecord | null | undefined);
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
    routeProjectUnresolved,
    routeProjectFromList,
    routeProjectQuery.data,
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
    if (selectedWorkflow) {
      const definition = decodeJson(selectedWorkflow.definition) as Definition;
      setDraftName(selectedWorkflow.name);
      setDraftDefinition(definition);
      persistedDraftSnapshot.current = {
        workflowId: selectedWorkflow.id,
        name: selectedWorkflow.name,
        definitionJson: JSON.stringify(definition),
      };
      // Runtime input belongs to a specific workflow. Never carry fields from a
      // previously selected workflow into the next execution context.
      setRunInput({});
    }
  }, [selectedWorkflow?.id]);

  useEffect(() => {
    const route = requestedRoute.route;
    if (!selectedWorkflow || selectedWorkflow.flowType === "data") return;
    const detail = runDetail.data as any;
    if (
      route.section === "runs" &&
      route.view === "monitor" &&
      route.runId &&
      shouldResetRunRoute({
        requestedRunId: route.runId,
        queriedRunId: detailInput.runId,
        workflowId: route.workflowId,
        queryFailed: runDetail.isError,
        detail,
      })
    )
      navigateRoute(
        { section: "runs", view: "monitor", workflowId: route.workflowId },
        { replace: true }
      );
  }, [
    navigateRoute,
    requestedRoute.route,
    selectedWorkflow?.flowType,
    detailInput.runId,
    runDetail.data,
    runDetail.isError,
  ]);

  const routeRestoring = Boolean(
    (routeWorkflowId &&
      (!workflows.isSuccess ||
        (!selectedWorkflowFromList && selectedWorkflowQuery.isPending))) ||
      (requestedRoute.route.section === "flows" &&
        requestedRoute.route.view === "workspace" &&
        (!projects.isSuccess || routeProjectUnresolved)) ||
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
        const definition = decodeJson(workflow.definition) as Definition;
        setDraftDefinition(definition);
        setDraftName(workflow.name);
        persistedDraftSnapshot.current = {
          workflowId: String(workflow.id ?? selectedId ?? ""),
          name: String(workflow.name ?? ""),
          definitionJson: JSON.stringify(definition),
        };
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
  const [compileDiagnostics, setCompileDiagnostics] = useState<
    CompileDiagnostic[]
  >([]);
  const [compileCheck, setCompileCheck] = useState<CompileCheckState>({
    status: "idle",
  });
  useEffect(() => {
    setCompileDiagnostics([]);
    setCompileCheck({ status: "idle" });
  }, [draftDefinition, selectedId]);
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
      void utils.task.list.invalidate();
      void utils.task.dashboard.invalidate();
      const inEditor =
        requestedRoute.route.section === "flows" &&
        requestedRoute.route.view === "editor";
      if (selectedId && !inEditor)
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
      if (selectedWorkflow?.projectId) {
        void utils.data.runs.invalidate({
          projectId: selectedWorkflow.projectId,
        });
        void utils.data.runDetail.invalidate();
      }
      toast.success(
        `${result.status === "success" ? "数据流运行完成" : "数据流已进入持久化执行队列"}：${result.runId.slice(0, 8)}`
      );
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
      void utils.iam.userDirectory.invalidate();
      void utils.iam.roleAssignableUsers.invalidate();
      void utils.iam.authorizationAudit.invalidate();
      toast.success("内部账号已创建。");
    },
    onError: error => toast.error(error.message),
  });
  const updateUserStatus = trpc.iam.updateUserStatus.useMutation({
    onSuccess: () => {
      void utils.iam.userAuthorizationDetails.invalidate();
      void utils.iam.users.invalidate();
      void utils.iam.userDirectory.invalidate();
      void utils.iam.roleAssignableUsers.invalidate();
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
      void utils.iam.userDirectory.invalidate();
      void utils.iam.roleAssignableUsers.invalidate();
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
  const isDraftDirty = Boolean(
    selectedWorkflow &&
      draftDefinition &&
      (() => {
        const persisted = persistedDraftSnapshot.current;
        return (
          !persisted ||
          persisted.workflowId !== selectedWorkflow.id ||
          persisted.name !== draftName ||
          !matchesWorkflowDefinitionSnapshot(
            persisted.definitionJson,
            draftDefinition
          )
        );
      })()
  );
  const saveCurrent = useCallback(() => {
    if (!selectedId || !draftDefinition || !isDraftDirty) return;
    if (selectedWorkflow?.status === "published") {
      toast.error(
        "已发布流程请使用“发布”提交新版本，或先取消发布后再保存草稿。"
      );
      return;
    }
    saveFlow.mutate({
      id: selectedId,
      name: draftName.trim() || "未命名流程",
      definition: draftDefinition,
    });
  }, [
    draftDefinition,
    draftName,
    isDraftDirty,
    saveFlow,
    selectedId,
    selectedWorkflow?.status,
  ]);
  const saveDraftBeforeRun = useCallback(async () => {
    if (!selectedId || !draftDefinition)
      throw new Error("流程定义尚未就绪，无法保存运行版本。");
    if (selectedWorkflow?.status === "published")
      throw new Error("已发布流程不能保存为草稿运行版本。");
    if (!isDraftDirty) return;
    await saveFlow.mutateAsync({
      id: selectedId,
      name: draftName.trim() || "未命名流程",
      definition: draftDefinition,
    });
  }, [
    draftDefinition,
    draftName,
    isDraftDirty,
    saveFlow,
    selectedId,
    selectedWorkflow?.status,
  ]);

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

  const startRun = async (): Promise<boolean> => {
    if (!selectedId || runFlow.isPending || runDataflow.isPending) return false;
    try {
      if (selectedWorkflow?.flowType === "data") {
        if (!selectedWorkflow.projectId) {
          toast.error("数据流缺少项目归属，无法运行。");
          return false;
        }
        await runDataflow.mutateAsync({
          projectId: selectedWorkflow.projectId,
          workflowId: selectedId,
          data: runInput,
        });
      } else
        await runFlow.mutateAsync({
          workflowId: selectedId,
          input: runInput,
          idempotencyKey: Array.from(
            crypto.getRandomValues(new Uint8Array(16)),
            byte => byte.toString(16).padStart(2, "0")
          ).join(""),
        });
      return true;
    } catch {
      return false;
    }
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
      className="aiflow-console relative min-h-screen bg-background text-foreground"
    >
      <a className="aiflow-skip-link" href="#aiflow-console-panel">
        跳到主要工作区
      </a>
      <header className="sticky top-0 z-30 border-b border-border/80 bg-card/95 backdrop-blur-sm text-foreground shadow-2xs">
        <div className="flex h-12 items-center">
          <button
            type="button"
            data-aiflow-mobile-nav-trigger=""
            className="grid h-12 w-12 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label={mobileNavOpen ? "关闭工作区导航" : "打开工作区导航"}
            aria-expanded={mobileNavOpen}
            aria-controls="aiflow-mobile-navigation"
          >
            {mobileNavOpen ? <X size={17} /> : <Menu size={17} />}
          </button>
          {editorActive && (
            <button
              type="button"
              data-aiflow-flow-list-trigger=""
              className="hidden h-12 w-12 place-items-center border-r border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:grid"
              onClick={() => setFlowListOpen(value => !value)}
              aria-label={flowListOpen ? "收起流程列表" : "展开流程列表"}
              aria-expanded={flowListOpen}
              aria-controls="aiflow-workflow-library"
            >
              {flowListOpen ? <X size={17} /> : <Menu size={17} />}
            </button>
          )}
          <div
            data-aiflow-brand=""
            className="hidden min-w-0 items-center gap-2.5 px-3.5 min-[360px]:flex"
          >
            <div className="grid h-7 w-7 place-items-center rounded-md bg-slate-900 text-white shadow-2xs">
              <Gauge size={15} />
            </div>
            <div
              data-aiflow-brand-name=""
              className="hidden sm:flex items-baseline gap-1.5"
            >
              <span className="text-sm font-semibold tracking-tight text-foreground">
                {general.platformName}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">
                Studio
              </span>
            </div>
          </div>
          <div
            data-aiflow-primary-nav=""
            role="tablist"
            aria-label="流程工作台主导航"
            className="ml-3 hidden h-full items-end gap-0.5 md:flex"
          >
            {nav.map(item => (
              <button
                id={`aiflow-console-tab-${item.id}`}
                role="tab"
                aria-selected={section === item.id}
                aria-controls="aiflow-console-panel"
                key={item.id}
                onClick={() => navigateSection(item.id)}
                className={`flex h-full items-center gap-1.5 border-b-2 px-3 text-xs font-medium transition-all ${section === item.id ? "border-slate-900 text-foreground font-semibold bg-muted/80" : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                <item.icon
                  size={14}
                  className={
                    section === item.id
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }
                />
                {item.label}
              </button>
            ))}
          </div>
          <div
            data-aiflow-user-actions=""
            className="ml-auto flex h-full items-center gap-1 px-2 text-xs min-[400px]:gap-2.5 min-[400px]:px-3.5"
          >
            <span className="hidden text-muted-foreground lg:inline">
              {user.name || user.username || "内部用户"}
            </span>
            <span className="shrink-0 whitespace-nowrap rounded-full border border-border/80 bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground min-[400px]:px-2.5">
              {user.role === "admin" ? "系统管理员" : "成员"}
            </span>
            {toggleTheme && (
              <Button
                data-aiflow-theme-toggle=""
                variant="ghost"
                size="sm"
                className="aiflow-type-control aiflow-action-target text-muted-foreground hover:bg-accent hover:text-aiflow-info"
                onClick={toggleTheme}
                title={theme === "dark" ? "切换至浅色模式" : "切换至暗黑模式"}
              >
                {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
                <span className="sr-only">切换主题</span>
              </Button>
            )}
            <Button
              data-aiflow-logout=""
              variant="ghost"
              size="sm"
              className="aiflow-type-control aiflow-action-target text-muted-foreground hover:bg-accent hover:text-aiflow-info"
              onClick={onLogout}
            >
              <LogOut size={15} />
              退出
            </Button>
          </div>
        </div>
      </header>
      <dialog
        ref={mobileNavDialogRef}
        id="aiflow-mobile-navigation"
        aria-labelledby="aiflow-mobile-navigation-title"
        aria-describedby="aiflow-mobile-navigation-description"
        onClose={() => setMobileNavOpen(false)}
        onClick={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX > bounds.right || event.clientX < bounds.left)
            setMobileNavOpen(false);
        }}
        className="m-0 h-dvh max-h-dvh w-[min(20rem,85vw)] max-w-[calc(100vw-2rem)] flex-col border-r border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50 open:flex"
      >
        <div className="relative border-b border-border px-4 py-5 pr-16 text-left">
          <h2
            id="aiflow-mobile-navigation-title"
            className="text-base font-semibold text-foreground"
          >
            工作区导航
          </h2>
          <p
            id="aiflow-mobile-navigation-description"
            className="text-xs text-muted-foreground"
          >
            选择要打开的工作区
          </p>
          <button
            type="button"
            aria-label="关闭工作区导航"
            onClick={() => setMobileNavOpen(false)}
            className="absolute top-3 right-3 grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <X size={18} />
          </button>
        </div>
        <nav
          aria-label="工作区导航"
          className="min-h-0 flex-1 overflow-y-auto p-3"
        >
          <ul className="space-y-1">
            {nav.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => {
                    navigateSection(item.id);
                    setMobileNavOpen(false);
                  }}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors ${section === item.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  <item.icon
                    size={17}
                    className={
                      section === item.id
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }
                  />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
          {editorActive && (
            <div className="mt-3 border-t border-border pt-3">
              <button
                type="button"
                onClick={() => {
                  setFlowListOpen(true);
                  setMobileNavOpen(false);
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <FolderKanban size={17} className="text-muted-foreground" />
                流程列表
              </button>
            </div>
          )}
        </nav>
        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {user.name || user.username || "内部用户"}
          </span>
          <span className="ml-2">
            {user.role === "admin" ? "系统管理员" : "成员"}
          </span>
        </div>
      </dialog>
      <div className="flex min-h-[calc(100vh-56px)] flex-col md:flex-row">
        {section === "flows" && flowView === "editor" && (
          <aside
            id="aiflow-workflow-library"
            data-aiflow-workflow-library=""
            className={`${flowListOpen ? "w-full md:w-72" : "h-0 w-full overflow-hidden md:h-auto md:w-0"} shrink-0 border-b border-border bg-card transition-[width,height] duration-200 md:border-b-0 md:border-r`}
          >
            <div className="border-b border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold tracking-[.18em] text-muted-foreground">
                    PROJECT WORKBENCH
                  </p>
                  <h2 className="mt-1 text-sm font-semibold">流程仓库</h2>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    className="md:hidden"
                    size="icon"
                    variant="ghost"
                    aria-label="关闭流程列表"
                    onClick={() => setFlowListOpen(false)}
                  >
                    <X size={17} />
                  </Button>
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
            </div>
            <div className="max-h-[calc(100vh-196px)] overflow-y-auto p-2">
              {workflows.isLoading && (
                <div className="p-4 text-sm text-muted-foreground">
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
                    className={`mb-1 w-full rounded-md border p-3 text-left transition-colors ${selected ? "border-aiflow-info-border bg-aiflow-info-surface" : "border-transparent hover:border-border hover:bg-muted"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {workflow.name}
                      </p>
                      <span
                        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${workflow.status === "published" ? "bg-aiflow-success-surface text-aiflow-success" : "bg-aiflow-warning-surface text-aiflow-warning"}`}
                      >
                        {workflow.status === "published" ? "已发布" : "草稿"}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
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
              className="grid min-h-[calc(100vh-56px)] place-items-center p-8 text-sm text-muted-foreground"
            >
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
                <Loader2 className="animate-spin text-aiflow-info" size={16} />
                {routeProjectUnresolved && routeProjectQuery.isError ? (
                  <>
                    <span>目标业务读取失败，请重试。</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void routeProjectQuery.refetch()}
                    >
                      重试读取业务
                    </Button>
                  </>
                ) : (
                  "正在恢复受权页面…"
                )}
              </div>
            </div>
          )}
          {section === "flows" &&
            flowView === "center" &&
            !routeRestoring &&
            (projects.isLoading && projects.data === undefined ? (
              <div
                data-business-list-loading=""
                role="status"
                aria-live="polite"
                className="grid min-h-[calc(100dvh-48px)] place-items-center bg-background p-6"
              >
                <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-2xs">
                  <Loader2 className="animate-spin text-foreground" size={18} />
                  正在读取当前账号可见的业务项目…
                </div>
              </div>
            ) : projects.isError && projects.data === undefined ? (
              <div
                data-business-list-error=""
                role="alert"
                className="grid min-h-[calc(100dvh-48px)] place-items-center bg-background p-6"
              >
                <div className="w-full max-w-md rounded-lg border border-aiflow-danger-border bg-card p-5 text-center shadow-2xs">
                  <h2 className="aiflow-type-section-title font-semibold text-foreground">
                    业务列表暂时无法加载
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    这不代表当前没有可访问的业务项目。请检查连接后重试。
                  </p>
                  <Button
                    type="button"
                    className="mt-4"
                    onClick={() => void projects.refetch()}
                  >
                    重试
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {projects.isError && projects.data !== undefined && (
                  <div
                    data-business-list-stale=""
                    role="status"
                    className="aiflow-type-body flex flex-wrap items-center justify-between gap-2 border-b border-aiflow-warning-border bg-aiflow-warning-surface px-4 py-2 text-amber-900"
                  >
                    <span>刷新失败，当前显示上次成功读取的业务列表。</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 border-amber-300 bg-card text-xs text-amber-900"
                      onClick={() => void projects.refetch()}
                    >
                      重试
                    </Button>
                  </div>
                )}
                <BusinessCenter
                  projects={projects.data as ProjectRecord[]}
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
              </>
            ))}
          {section === "flows" &&
            !routeRestoring &&
            flowView === "workspace" &&
            selectedProject && (
              <div>
                <div
                  data-aiflow-business-selector
                  className="flex flex-col gap-1.5 border-b border-border bg-card px-4 py-2 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span className="shrink-0">当前业务</span>
                    <Popover
                      open={projectPickerOpen}
                      onOpenChange={setProjectPickerOpen}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="aiflow-type-control h-11 min-h-11 min-w-0 w-full max-w-[min(560px,calc(100vw-110px))] justify-between gap-2 px-2 text-sm font-medium lg:w-auto min-[1280px]:h-8 min-[1280px]:min-h-8"
                          aria-label="切换当前受权业务"
                          aria-expanded={projectPickerOpen}
                        >
                          <span className="truncate text-left">
                            <span className="font-semibold text-foreground">
                              {selectedProject.code}
                            </span>
                            <span className="px-1 text-muted-foreground">
                              ·
                            </span>
                            <span className="text-muted-foreground">
                              {selectedProject.name}
                            </span>
                          </span>
                          <ChevronDown
                            size={14}
                            className="shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-[min(360px,calc(100vw-24px))] p-0"
                      >
                        <Command>
                          <CommandInput
                            placeholder="搜索业务名称或代号…"
                            aria-label="搜索有权限的业务项目"
                          />
                          <CommandList className="max-h-[min(360px,60vh)]">
                            <CommandEmpty>没有匹配的业务项目</CommandEmpty>
                            <CommandGroup>
                              {((projects.data ?? []) as ProjectRecord[]).map(
                                project => (
                                  <CommandItem
                                    key={project.id}
                                    value={`${project.code} ${project.name}`}
                                    onSelect={() => {
                                      setProjectPickerOpen(false);
                                      if (project.id === selectedProject.id)
                                        return;
                                      navigateRoute({
                                        section: "flows",
                                        view: "workspace",
                                        projectId: project.id,
                                      });
                                    }}
                                    className="min-h-10"
                                  >
                                    <span className="min-w-0 flex-1 truncate">
                                      <span className="font-medium">
                                        {project.code}
                                      </span>
                                      <span className="px-1 text-muted-foreground">
                                        ·
                                      </span>
                                      <span>{project.name}</span>
                                    </span>
                                    {project.id === selectedProject.id && (
                                      <Check
                                        size={15}
                                        className="shrink-0 text-aiflow-info"
                                        aria-hidden="true"
                                      />
                                    )}
                                  </CommandItem>
                                )
                              )}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <span className="aiflow-type-meta text-muted-foreground lg:text-right">
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
          {section === "flows" &&
            !routeRestoring &&
            flowView === "editor" &&
            (selectedId && !access.data ? (
              <div
                className="m-4 rounded-lg border border-border bg-card p-5"
                role={access.isError ? "alert" : "status"}
                aria-live="polite"
              >
                <p className="aiflow-type-body text-muted-foreground">
                  {access.isError
                    ? `读取流程权限失败：${access.error.message}`
                    : "正在读取流程权限…"}
                </p>
                {access.isError && (
                  <Button
                    className="mt-3"
                    variant="outline"
                    disabled={access.isFetching}
                    onClick={() => void access.refetch()}
                  >
                    重新读取流程权限
                  </Button>
                )}
              </div>
            ) : (
              <FlowDesigner
                workflow={selectedWorkflow}
                definition={draftDefinition}
                name={draftName}
                setName={setDraftName}
                canEdit={canEdit}
                canPublish={canPublish}
                canRun={canRun}
                hasUnpublishedChanges={isDraftDirty}
                canManage={canManageMembers}
                members={(members.data ?? []) as any[]}
                savePending={saveFlow.isPending}
                publishPending={publishFlow.isPending}
                compilePending={compileFlow.isPending}
                compileDiagnostics={compileDiagnostics}
                compileCheck={compileCheck}
                runPending={runFlow.isPending}
                runInput={runInput}
                setRunInput={setRunInput}
                templates={(templates.data ?? []) as any[]}
                subflows={(subflows.data ?? []) as any[]}
                onDefinitionChange={setDraftDefinition}
                backLabel={flowEditorReturnLabel}
                onBackToDesignCenter={returnFromFlowEditor}
                onSave={saveCurrent}
                onSaveDraftBeforeRun={saveDraftBeforeRun}
                onValidate={() => {
                  if (!selectedId || !draftDefinition) return;
                  setCompileDiagnostics([]);
                  setCompileCheck({ status: "checking" });
                  compileFlow.mutate(
                    { id: selectedId, definition: draftDefinition },
                    {
                      onSuccess: result => {
                        setCompileDiagnostics(
                          result.ok ? [] : result.diagnostics
                        );
                        setCompileCheck({
                          status: result.ok ? "passed" : "failed",
                          checkedAt: Date.now(),
                          message: result.ok
                            ? undefined
                            : `预检发现 ${result.diagnostics.length} 项问题。`,
                        });
                      },
                      onError: error =>
                        setCompileCheck({
                          status: "failed",
                          checkedAt: Date.now(),
                          message: `预检请求失败：${error.message}`,
                        }),
                    }
                  );
                }}
                onPublish={() => {
                  if (!selectedId || !draftDefinition) return;
                  if (
                    !canPublishWorkflowVersion(
                      selectedWorkflow?.status,
                      isDraftDirty
                    )
                  ) {
                    toast.info(
                      "当前已发布版本没有未发布修改；编辑流程后才能发布新版本。"
                    );
                    return;
                  }
                  setCompileDiagnostics([]);
                  setCompileCheck({ status: "checking" });
                  compileFlow.mutate(
                    { id: selectedId, definition: draftDefinition },
                    {
                      onSuccess: result => {
                        if (!result.ok) {
                          setCompileDiagnostics(result.diagnostics);
                          setCompileCheck({
                            status: "failed",
                            checkedAt: Date.now(),
                            message: `编译发现 ${result.diagnostics.length} 项问题。`,
                          });
                          toast.error(
                            `编译未通过：${result.diagnostics.length} 项错误`
                          );
                          return;
                        }
                        setCompileDiagnostics([]);
                        setCompileCheck({
                          status: "passed",
                          checkedAt: Date.now(),
                        });
                        publishFlow.mutate(
                          {
                            id: selectedId,
                            name: draftName.trim() || "未命名流程",
                            definition: draftDefinition,
                          },
                          {
                            onSuccess: () => {
                              persistedDraftSnapshot.current = {
                                workflowId: selectedId,
                                name: draftName.trim() || "未命名流程",
                                definitionJson: JSON.stringify(draftDefinition),
                              };
                            },
                          }
                        );
                      },
                      onError: error => {
                        setCompileCheck({
                          status: "failed",
                          checkedAt: Date.now(),
                          message: `预检请求失败：${error.message}`,
                        });
                        toast.error(error.message);
                      },
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
                onSaveAsSubflow={async subflowName => {
                  if (!draftDefinition || createSubflow.isPending) return false;
                  const subflowFlowType = selectedWorkflow?.flowType ?? "state";
                  if (subflowFlowType === "data")
                    throw new Error(
                      "数据流程请保存节点模板；当前不支持另存为子流程。"
                    );
                  await createSubflow.mutateAsync({
                    name: subflowName,
                    flowType: subflowFlowType,
                    definition: draftDefinition,
                  });
                  return true;
                }}
                onCreateTemplate={input => createTemplate.mutateAsync(input)}
                onUpdateTemplate={(template, updates) =>
                  updateTemplate.mutateAsync({ id: template.id, ...updates })
                }
                onDeleteTemplate={id => deleteTemplate.mutate({ id })}
                onToggleSubflow={(subflow, isEnabled) =>
                  updateSubflow.mutate({ id: subflow.id, isEnabled })
                }
                onDeleteSubflow={id => deleteSubflow.mutate({ id })}
                onGrant={async (userId, role, hours) => {
                  if (selectedId)
                    await grantMember.mutateAsync({
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
                    revokeMember.mutate({
                      workflowId: selectedId,
                      userId,
                      role,
                    });
                }}
              />
            ))}
          {section === "runs" && !routeRestoring && (
            <div>
              <div
                data-aiflow-run-view-tabs
                role="tablist"
                aria-label="已启动流程视图"
                className="grid min-h-12 min-w-0 grid-cols-2 gap-1 border-b border-border bg-card px-2 sm:flex sm:flex-wrap sm:px-4"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={runView === "workbench"}
                  className={`aiflow-type-control h-12 min-w-0 border-b-2 px-2 sm:px-4 ${runView === "workbench" ? "border-aiflow-info bg-aiflow-info-surface text-aiflow-info" : "border-transparent text-muted-foreground hover:bg-muted"}`}
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
                  className={`aiflow-type-control h-12 min-w-0 border-b-2 px-2 sm:px-4 ${runView === "monitor" ? "border-aiflow-info bg-aiflow-info-surface text-aiflow-info" : "border-transparent text-muted-foreground hover:bg-muted"}`}
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
                <RuntimeMonitor
                  projectId={selectedWorkflow?.projectId}
                  workflowId={selectedId}
                  workflowName={selectedWorkflow?.name}
                  selectedRunId={selectedRunId}
                  selectedRun={runDetail.data ?? null}
                  selectedRunLoading={runDetail.isLoading}
                  selectedRunError={runDetail.isError}
                  onSelect={runId =>
                    selectedId &&
                    navigateRoute({
                      section: "runs",
                      view: "monitor",
                      workflowId: selectedId,
                      runId,
                    })
                  }
                  onClearSelection={() =>
                    selectedId &&
                    navigateRoute({
                      section: "runs",
                      view: "monitor",
                      workflowId: selectedId,
                    })
                  }
                  onRetrySelection={() => void runDetail.refetch()}
                />
              )}
            </div>
          )}
          {section === "warehouse" && (
            <WorkflowWarehouse
              projects={(projects.data ?? []) as ProjectRecord[]}
              projectsLoading={
                projects.isLoading && projects.data === undefined
              }
              projectsError={projects.isError}
              onRetryProjects={() => void projects.refetch()}
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
              <div className="min-h-[calc(100vh-56px)] bg-background p-4 sm:p-6">
                <div>
                  <button
                    className="aiflow-type-control aiflow-action-target mb-4 inline-flex items-center rounded px-3 text-aiflow-info hover:bg-accent hover:underline"
                    onClick={() =>
                      navigateRoute({ section: "system", view: "config" })
                    }
                  >
                    ← 返回系统配置
                  </button>
                  <IamCenter
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
          className="pointer-events-none fixed inset-0 z-20 grid grid-cols-2 content-around gap-24 overflow-hidden px-12 text-center text-3xl font-bold tracking-[.18em] text-muted-foreground/15 [transform:rotate(-24deg)_scale(1.25)] sm:grid-cols-3"
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
  hasUnpublishedChanges,
  canManage,
  members,
  savePending,
  publishPending,
  compilePending,
  compileDiagnostics,
  compileCheck,
  runPending,
  runInput,
  setRunInput,
  templates,
  subflows,
  onDefinitionChange,
  backLabel,
  onBackToDesignCenter,
  onSave,
  onSaveDraftBeforeRun,
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
  hasUnpublishedChanges: boolean;
  canManage: boolean;
  members: any[];
  savePending: boolean;
  publishPending: boolean;
  compilePending: boolean;
  compileDiagnostics: CompileDiagnostic[];
  compileCheck: CompileCheckState;
  runPending: boolean;
  runInput: Record<string, unknown>;
  setRunInput: (value: Record<string, unknown>) => void;
  templates: any[];
  subflows: any[];
  onDefinitionChange: (definition: Definition) => void;
  backLabel: string;
  onBackToDesignCenter: () => void;
  onSave: () => void;
  onSaveDraftBeforeRun: () => Promise<void>;
  onPublish: () => void;
  onValidate: () => void;
  onRun: () => Promise<boolean>;
  onExport: () => void;
  onImport: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSaveAsSubflow: (name: string) => Promise<boolean>;
  onCreateTemplate: (input: any) => Promise<unknown>;
  onUpdateTemplate: (template: any, updates: any) => Promise<unknown>;
  onDeleteTemplate: (id: string) => void;
  onToggleSubflow: (subflow: any, isEnabled: boolean) => void;
  onDeleteSubflow: (id: string) => void;
  onGrant: (
    userId: number,
    role: "owner" | "editor" | "operator" | "viewer",
    hours?: number
  ) => Promise<void>;
  onRevoke: (
    userId: number,
    role: "owner" | "editor" | "operator" | "viewer"
  ) => void;
}) {
  const [candidateId, setCandidateId] = useState("");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [grantPending, setGrantPending] = useState(false);
  useEffect(() => {
    const timer = setTimeout(
      () => setCandidateSearch(candidateQuery.trim().slice(0, 100)),
      250
    );
    return () => clearTimeout(timer);
  }, [candidateQuery]);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = titleRef.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "auto";
      field.style.height = `${Math.min(field.scrollHeight, 96)}px`;
    };
    resize();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth;
      resize();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [name]);
  const [memberRole, setMemberRole] = useState<
    "owner" | "editor" | "operator" | "viewer"
  >("viewer");
  const [hours, setHours] = useState("");
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const candidateDirectory = trpc.workflow.memberCandidates.useQuery(
    {
      workflowId: workflow?.id ?? "00000000",
      query: candidateSearch,
      selectedIds: candidateId ? [Number(candidateId)] : [],
    },
    {
      enabled: Boolean(membersDialogOpen && canManage && workflow?.id),
      retry: false,
      refetchInterval: membersDialogOpen ? 30_000 : false,
      refetchIntervalInBackground: false,
    }
  );
  const liveMembers = trpc.workflow.members.useQuery(
    { workflowId: workflow?.id ?? "00000000" },
    {
      enabled: Boolean(membersDialogOpen && workflow?.id),
      refetchInterval: membersDialogOpen ? 30_000 : false,
      refetchIntervalInBackground: false,
      retry: false,
    }
  );
  const displayedMembers = liveMembers.data ?? members;
  const [governanceDialogOpen, setGovernanceDialogOpen] = useState(false);
  const [subflowDialogOpen, setSubflowDialogOpen] = useState(false);
  useEffect(() => setSubflowDialogOpen(false), [workflow.id]);
  const utils = trpc.useUtils();
  const unpublishFlow = trpc.workflow.unpublish.useMutation({
    onSuccess: () => {
      void utils.workflow.list.invalidate();
      void utils.workflow.get.invalidate({ id: workflow.id });
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canEdit && !savePending && workflow?.status !== "published") {
          onSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, savePending, workflow?.status, onSave]);
  if (!workflow || !definition)
    return (
      <div className="grid min-h-[calc(100vh-56px)] place-items-center p-8">
        <div className="max-w-md text-center">
          <FolderKanban className="mx-auto text-slate-300" size={42} />
          <h2 className="mt-4 font-semibold text-foreground">
            选择或创建一个流程
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            流程仓库显示了你拥有或被授予查看权限的工作流。
          </p>
        </div>
      </div>
    );
  const flowProfile = getFlowProfile(workflow.flowType ?? "state");
  const publishVersionAllowed = canPublishWorkflowVersion(
    workflow.status,
    hasUnpublishedChanges
  );
  const canModifyDefinition =
    canEdit && (workflow.status !== "published" || canPublish);
  return (
    <div
      data-aiflow-designer=""
      className="min-w-0 max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5"
    >
      <div
        data-aiflow-context-header
        className="mb-4 flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              className="aiflow-action-target inline-flex items-center gap-1 rounded px-2 font-medium text-aiflow-info hover:underline min-[1024px]:px-0"
              aria-label={backLabel}
              title={backLabel}
              onClick={onBackToDesignCenter}
            >
              <ChevronLeft size={14} />
              {backLabel}
            </button>
            <span className="text-slate-300">/</span>
            <span
              className="inline-flex items-center gap-1 text-muted-foreground"
              aria-label={`当前流程类型：${flowProfile.label}`}
              title={flowProfile.description}
            >
              {flowProfile.type === "data" ? (
                <Table2 size={13} aria-hidden="true" />
              ) : flowProfile.type === "state" ? (
                <Activity size={13} aria-hidden="true" />
              ) : (
                <FolderKanban size={13} aria-hidden="true" />
              )}
              {flowProfile.label}
              <ChevronRight size={13} />
              设计器
            </span>
            <span
              className={`ml-1 aiflow-type-meta rounded px-2 py-0.5 font-semibold border ${
                workflow.status === "published"
                  ? "bg-aiflow-success-surface text-aiflow-success border-aiflow-success-border"
                  : "bg-aiflow-warning-surface text-aiflow-warning border-aiflow-warning-border"
              }`}
            >
              {workflow.status === "published"
                ? `● 已发布 v${workflow.definitionVersion || 1}`
                : "● 草稿状态"}
            </span>
          </div>
          <div className="mt-1.5 flex w-full min-w-0 items-center gap-1">
            <textarea
              aria-label="流程名称"
              data-aiflow-page-title=""
              className="aiflow-type-page-title min-h-11 max-h-24 w-full min-w-0 resize-none overflow-y-auto whitespace-pre-wrap rounded border border-transparent px-1.5 py-1 font-bold text-foreground shadow-none transition-colors hover:border-border hover:bg-muted/70 focus-visible:border-blue-400 focus-visible:bg-card focus-visible:outline-none focus-visible:ring-0 disabled:opacity-100 [overflow-wrap:anywhere] min-[1024px]:min-h-9"
              rows={1}
              value={name}
              disabled={!canModifyDefinition}
              onChange={event => {
                setName(event.currentTarget.value.replace(/[\r\n]+/g, " "));
              }}
              onKeyDown={event => {
                if (event.key === "Enter") event.preventDefault();
              }}
              ref={titleRef}
              title={name || "双击或聚焦以编辑流程名称"}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 1. 存盘草稿 (支持 ⌘S) */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 min-h-11 gap-1.5 px-2.5 text-xs text-foreground hover:bg-muted border-border shadow-2xs min-[1024px]:h-9 min-[1024px]:min-h-0"
            onClick={onSave}
            disabled={
              !canEdit ||
              !hasUnpublishedChanges ||
              savePending ||
              workflow.status === "published"
            }
            title={
              workflow.status === "published"
                ? "修改后使用“发布新版本”；需要保存草稿时，请先取消发布"
                : hasUnpublishedChanges
                  ? "保存当前画布草稿 (Ctrl+S / ⌘S)"
                  : "没有未保存修改"
            }
          >
            {savePending ? (
              <Loader2 className="animate-spin text-aiflow-info" size={13} />
            ) : (
              <Save size={13} className="text-muted-foreground" />
            )}
            <span>保存画布</span>
            <kbd className="aiflow-type-meta hidden rounded bg-muted px-1 font-mono text-muted-foreground sm:inline-block">
              Ctrl/⌘+S
            </kbd>
          </Button>

          {/* 发布前自动预检，避免在紧凑工具栏重复放置检查按钮 */}
          <Button
            size="sm"
            className="h-11 min-h-11 px-3 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs min-[1024px]:h-9 min-[1024px]:min-h-0"
            onClick={onPublish}
            disabled={
              !canPublish ||
              !publishVersionAllowed ||
              publishPending ||
              compilePending
            }
            title={
              !canPublish
                ? "当前账号没有发布权限"
                : !publishVersionAllowed
                  ? "当前已发布版本没有未发布修改；编辑流程后才能发布新版本"
                  : workflow.status === "published"
                    ? "发布前会自动检查拓扑与语法，并创建新版本"
                    : "发布前会自动检查拓扑与语法"
            }
          >
            {publishPending && (
              <Loader2 className="animate-spin mr-1" size={12} />
            )}
            {workflow.status === "published" ? "发布新版本" : "发布"}
          </Button>

          {/* 3. 更多操作与低频流程命令收纳菜单 (···) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-11 min-h-11 min-w-11 p-0 text-foreground hover:bg-muted border-border min-[1024px]:h-9 min-[1024px]:min-h-0 min-[1024px]:min-w-0"
                title="更多操作"
              >
                <MoreHorizontal size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56 max-w-[calc(100vw-2rem)]"
            >
              <DropdownMenuLabel className="aiflow-type-control text-muted-foreground">
                流程操作
              </DropdownMenuLabel>
              <DropdownMenuItem
                className="aiflow-type-control"
                onClick={() => setRunDialogOpen(true)}
                disabled={!canRun}
                title={
                  workflow.flowType === "state"
                    ? "会推进流程状态或创建待办；提交前可查看运行影响。"
                    : workflow.flowType === "data"
                      ? "会读取已配置数据，并可能写入输出目标。"
                      : "可能调用外部服务并产生业务影响；当前入口不提供沙箱隔离。"
                }
              >
                {workflow.flowType === "state" ? (
                  <Compass size={14} />
                ) : workflow.flowType === "data" ? (
                  <Table2 size={14} />
                ) : (
                  <Play size={14} />
                )}
                <span>
                  {workflow.flowType === "state"
                    ? "运行状态流程"
                    : workflow.flowType === "data"
                      ? "执行数据流程"
                      : "运行控制流程"}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="aiflow-type-control"
                onClick={onValidate}
                disabled={!canPublish || compilePending}
                title="仅检查拓扑与语法，不会发布流程"
              >
                {compilePending ? (
                  <Loader2 className="animate-spin" size={14} />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                <span>仅执行预检</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="aiflow-type-control text-muted-foreground">
                其他操作
              </DropdownMenuLabel>
              <DropdownMenuItem
                className="aiflow-type-control"
                onClick={() => setMembersDialogOpen(true)}
              >
                <UsersRound size={13} className="mr-2 text-muted-foreground" />
                <span>协作成员</span>
                <span className="aiflow-type-meta ml-auto rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
                  {members.length}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="aiflow-type-control"
                onClick={() => setGovernanceDialogOpen(true)}
              >
                <ShieldCheck size={13} className="mr-2 text-muted-foreground" />
                <span>版本治理与快照</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="aiflow-type-control"
                onClick={onImport}
                disabled={!canModifyDefinition}
              >
                <Upload size={13} className="mr-2 text-muted-foreground" />
                <span>导入定义 (JSON)</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="aiflow-type-control"
                onClick={onExport}
              >
                <Download size={13} className="mr-2 text-muted-foreground" />
                <span>导出备份 (JSON)</span>
              </DropdownMenuItem>
              {(canManage || canEdit) && <DropdownMenuSeparator />}
              {canManage && (
                <DropdownMenuItem
                  className="aiflow-type-control"
                  onClick={onDuplicate}
                >
                  <Copy size={13} className="mr-2 text-muted-foreground" />
                  <span>创建副本</span>
                </DropdownMenuItem>
              )}
              {canEdit &&
                getFlowProfile(
                  workflow.flowType ?? "state"
                ).allowedNodeTypes.includes("subflow") && (
                  <DropdownMenuItem
                    className="aiflow-type-control"
                    onClick={() => setSubflowDialogOpen(true)}
                  >
                    <FolderTree
                      size={13}
                      className="mr-2 text-muted-foreground"
                    />
                    <span>另存为私有子流程</span>
                  </DropdownMenuItem>
                )}
              {workflow.status === "published" && canPublish && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onUnpublish}
                    className="aiflow-type-control text-aiflow-warning focus:text-aiflow-warning"
                  >
                    <Clock3 size={13} className="mr-2" />
                    <span>取消发布</span>
                  </DropdownMenuItem>
                </>
              )}
              {canManage && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="aiflow-type-control text-red-600 focus:text-red-600"
                  >
                    <ArchiveRestore size={13} className="mr-2" />
                    <span>归档至流程仓库</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {workflow.status === "published" && (
        <section
          aria-label="已发布流程编辑说明"
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-aiflow-info-border bg-aiflow-info-surface p-3"
        >
          <div className="min-w-0 flex-1">
            <p className="aiflow-type-control font-semibold text-aiflow-info">
              {canModifyDefinition ? "正在查看已发布版本" : "已发布版本只读"}
            </p>
            <p className="aiflow-type-control mt-1 leading-6 text-foreground">
              {canModifyDefinition
                ? "修改暂存在当前页面，需通过“发布新版本”提交。若项目要求审核，请先取消发布、保存草稿，再返回流程中心提交审核。"
                : canEdit
                  ? "当前账号无法提交已发布版本的修改。请由有发布权限的人员取消发布后，再编辑并保存草稿。"
                  : "当前账号仅可查看流程配置；编辑或发布请联系流程负责人。"}
            </p>
          </div>
          {canEdit && canPublish && (
            <Button
              type="button"
              variant="outline"
              className="aiflow-type-control"
              disabled={unpublishFlow.isPending}
              onClick={onUnpublish}
            >
              取消发布后编辑草稿
            </Button>
          )}
        </section>
      )}
      {compileCheck.status !== "idle" && (
        <section
          role={compileCheck.status === "failed" ? "alert" : "status"}
          aria-live={compileCheck.status === "failed" ? "assertive" : "polite"}
          className={`mb-3 rounded-xl border p-3 ${
            compileCheck.status === "failed"
              ? "border-red-200 bg-red-50"
              : compileCheck.status === "passed"
                ? "border-aiflow-success-border bg-aiflow-success-surface"
                : "border-aiflow-info-border bg-aiflow-info-surface"
          }`}
          aria-label="流程预检结果"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p
                className={`text-sm font-semibold ${
                  compileCheck.status === "failed"
                    ? "text-red-900"
                    : compileCheck.status === "passed"
                      ? "text-emerald-900"
                      : "text-blue-900"
                }`}
              >
                {compileCheck.status === "checking"
                  ? "正在检查流程定义…"
                  : compileCheck.status === "passed"
                    ? "流程预检通过"
                    : compileDiagnostics.length > 0
                      ? "流程预检未通过"
                      : "流程预检请求失败"}
              </p>
              <p
                className={`aiflow-type-body mt-1 ${
                  compileCheck.status === "failed"
                    ? "text-red-700"
                    : compileCheck.status === "passed"
                      ? "text-aiflow-success"
                      : "text-aiflow-info"
                }`}
              >
                {compileCheck.status === "checking"
                  ? "正在校验拓扑、节点配置与语法。"
                  : compileCheck.status === "passed"
                    ? `拓扑与语法检查通过 · ${
                        compileCheck.checkedAt
                          ? new Date(compileCheck.checkedAt).toLocaleTimeString(
                              "zh-CN",
                              {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                hour12: false,
                              }
                            )
                          : "刚刚"
                      }`
                    : compileDiagnostics.length > 0
                      ? `共 ${compileDiagnostics.length} 项问题；修复后重新执行预检。`
                      : compileCheck.message || "编译服务未能完成本次检查。"}
              </p>
            </div>
            {compileDiagnostics.length > 0 && (
              <button
                type="button"
                className="text-xs text-red-700 underline"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("flow:focus-node", {
                      detail: {
                        nodeId: compileDiagnostics[0]?.location.nodeId,
                      },
                    })
                  )
                }
              >
                定位第一项
              </button>
            )}
          </div>
          {compileDiagnostics.length > 0 && (
            <ul className="mt-2 grid gap-1.5 text-xs text-red-900">
              {compileDiagnostics.map((item, index) => (
                <li
                  key={`${item.code}-${item.location.nodeId ?? item.location.edgeId ?? index}`}
                  className="flex min-w-0 flex-wrap items-baseline gap-2 rounded border border-red-100 bg-card/70 px-2 py-1.5"
                >
                  <code className="font-semibold">{item.code}</code>
                  <span className="min-w-0 flex-1">{item.message}</span>
                  {(item.location.nodeId || item.location.edgeId) && (
                    <button
                      type="button"
                      className="text-red-700 underline"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent("flow:focus-node", {
                            detail: { nodeId: item.location.nodeId },
                          })
                        )
                      }
                    >
                      {item.location.nodeId
                        ? `节点 ${item.location.nodeId}`
                        : `连线 ${item.location.edgeId}`}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <ErrorBoundary>
        <WorkflowCanvas
          key={workflow.id}
          workflowId={workflow.id}
          projectId={workflow.projectId ?? undefined}
          flowType={workflow.flowType ?? "state"}
          definition={definition}
          readOnly={!canModifyDefinition}
          onDefinitionChange={onDefinitionChange}
          templates={templates}
          subflows={subflows}
          onSaveTemplate={onCreateTemplate}
          onUpdateTemplate={onUpdateTemplate}
          onDeleteTemplate={onDeleteTemplate}
          onToggleSubflow={onToggleSubflow}
          onDeleteSubflow={onDeleteSubflow}
        />
      </ErrorBoundary>

      <WorkflowTestRunModal
        key={workflow.id}
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        workflow={workflow}
        definition={definition}
        runInput={runInput}
        onChangeRunInput={setRunInput}
        canRun={canRun}
        hasUnpublishedChanges={hasUnpublishedChanges}
        onSaveDraft={
          canEdit && workflow?.status !== "published"
            ? onSaveDraftBeforeRun
            : undefined
        }
      />

      <Dialog open={membersDialogOpen} onOpenChange={setMembersDialogOpen}>
        <DialogContent className="max-w-2xl sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>流程权限与协作成员</DialogTitle>
            <DialogDescription>
              管理流程有效协作人员、到期时间与角色授权。
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 rounded-lg border border-aiflow-info-border bg-aiflow-info-surface px-4 py-3 text-sm text-blue-950">
            <div className="flex items-center gap-2 font-semibold">
              <LockKeyhole size={15} />
              权限感知设计器
            </div>
            <p className="aiflow-type-body mt-1 text-aiflow-info">
              {canEdit
                ? "你可编辑画布并保存版本。"
                : "当前为只读授权；仍可查看定义与运行反馈。"}
            </p>
            <div className="aiflow-type-body mt-3 min-w-0 rounded border border-aiflow-info-border bg-card/80 p-2">
              <p className="aiflow-type-section-title mb-1.5 font-semibold text-blue-900">
                协作成员与有效期（{displayedMembers.length}）
              </p>
              <div className="mt-2 grid min-w-0 gap-1.5">
                {displayedMembers.map(member => (
                  <div
                    key={member.id}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-aiflow-info-border bg-card px-2 py-1.5"
                  >
                    <div className="min-w-0">
                      <span className="break-words font-medium">
                        {member.name ||
                          member.username ||
                          `用户 ${member.userId}`}
                      </span>
                      <span className="aiflow-type-control ml-2 text-aiflow-info">
                        {(
                          {
                            owner: "所有者",
                            editor: "编辑者",
                            operator: "运行者",
                            viewer: "查看者",
                          } as Record<string, string>
                        )[member.role] ?? member.role}
                      </span>
                      <p className="aiflow-type-meta mt-0.5 text-muted-foreground">
                        生效：{formatTime(member.effectiveFrom)} · 到期：
                        {member.expiresAt
                          ? formatTime(member.expiresAt)
                          : "长期"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span
                        className={`aiflow-type-meta rounded px-1.5 py-0.5 ${member.authorizationStatus === "active" ? "bg-aiflow-success-surface text-aiflow-success" : "bg-slate-200 text-muted-foreground"}`}
                      >
                        {(
                          {
                            active: "有效",
                            revoked: "已撤销",
                            disabled: "账号已停用",
                            pending: "尚未生效",
                            expired: "已到期",
                          } as Record<string, string>
                        )[member.authorizationStatus] ?? "状态待确认"}
                      </span>
                      {canManage && !member.revokedAt && (
                        <button
                          type="button"
                          className="aiflow-type-control min-h-9 px-2 text-red-600 hover:underline"
                          onClick={() => onRevoke(member.userId, member.role)}
                        >
                          撤销
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {!displayedMembers.length && (
                  <span className="text-blue-500">暂无可见协作成员。</span>
                )}
              </div>
              {liveMembers.isError && (
                <p role="alert" className="aiflow-type-body mt-2 text-red-600">
                  成员状态刷新失败，当前显示可能已过期。
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => void liveMembers.refetch()}
                  >
                    重试
                  </button>
                </p>
              )}
            </div>
            {canManage && (
              <form
                className="aiflow-type-body mt-3 grid min-w-0 gap-2 rounded border border-dashed border-blue-300 bg-card p-2"
                onSubmit={async event => {
                  event.preventDefault();
                  const userId = Number(candidateId);
                  if (!userId || grantPending) return;
                  const validity = roleExpiryInput(hours);
                  if (validity.error) {
                    toast.error(validity.error);
                    return;
                  }
                  setGrantPending(true);
                  try {
                    await onGrant(
                      userId,
                      memberRole,
                      hours ? Number(hours) : undefined
                    );
                    setCandidateId("");
                    setHours("");
                  } catch {
                    // The mutation reports its error; retain the user's form values.
                    void candidateDirectory.refetch();
                  } finally {
                    setGrantPending(false);
                  }
                }}
              >
                <p className="aiflow-type-section-title font-semibold text-blue-900">
                  授予流程成员
                </p>
                <SearchableMultiSelect
                  ariaLabel="待授权内部账号"
                  value={candidateId ? [candidateId] : []}
                  options={(candidateDirectory.data ?? []).map(candidate => ({
                    value: String(candidate.id),
                    label: `${candidate.name || candidate.username}（${candidate.username}）`,
                  }))}
                  query={candidateQuery}
                  onQueryChange={value =>
                    setCandidateQuery(value.slice(0, 100))
                  }
                  onChange={ids => setCandidateId(ids[0] ?? "")}
                  placeholder="请选择待授权账号"
                  searchPlaceholder="搜索姓名或账号"
                  emptyMessage="没有可用账号。"
                  requireSearch
                  maxSelected={1}
                  loading={
                    candidateDirectory.isFetching ||
                    candidateQuery.trim() !== candidateSearch
                  }
                  error={candidateDirectory.isError}
                  disabled={grantPending}
                />
                {candidateDirectory.isError && (
                  <button
                    type="button"
                    className="aiflow-type-control text-aiflow-info underline"
                    onClick={() => void candidateDirectory.refetch()}
                  >
                    重新搜索
                  </button>
                )}
                {candidateId &&
                  candidateDirectory.isSuccess &&
                  !candidateDirectory.data.some(
                    row => String(row.id) === candidateId
                  ) && (
                    <p role="alert" className="aiflow-type-body text-red-600">
                      所选账号已停用或不可用，请重新选择。
                    </p>
                  )}
                <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                  <select
                    className="h-8 min-w-0 rounded border border-border bg-card px-2"
                    value={memberRole}
                    aria-label="协作角色"
                    disabled={grantPending}
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
                    className="h-8 min-w-0 rounded border border-border px-2"
                    type="number"
                    min="1"
                    placeholder="有效期小时（可选）"
                    aria-label="授权有效期（小时）"
                    disabled={grantPending}
                    value={hours}
                    onChange={event => setHours(event.target.value)}
                  />
                </div>
                <Button
                  className="h-8 bg-blue-600 text-xs hover:bg-blue-500"
                  type="submit"
                  disabled={
                    grantPending ||
                    candidateDirectory.isFetching ||
                    !candidateDirectory.data?.some(
                      row => String(row.id) === candidateId
                    )
                  }
                >
                  {grantPending ? "正在授权…" : "授予成员"}
                </Button>
              </form>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={governanceDialogOpen}
        onOpenChange={setGovernanceDialogOpen}
      >
        <DialogContent className="max-w-5xl sm:max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>流程版本治理与生命周期</DialogTitle>
            <DialogDescription>
              版本快照差异比对、安全回滚与发布治理；每项状态均来自当前流程真实数据。
            </DialogDescription>
          </DialogHeader>
          {workflow.status === "published" && (
            <div className="mb-4 flex flex-col gap-3 rounded-lg border border-aiflow-warning-border bg-aiflow-warning-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-950">发布治理</p>
                <p className="aiflow-type-body mt-1 text-amber-900">
                  取消发布会阻止后续发起，历史版本与运行审计已保留。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-amber-300 text-amber-900 hover:bg-aiflow-warning-surface"
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
          <WorkflowGovernance
            workflowId={workflow.id}
            canEdit={canEdit}
            canPublish={canPublish}
          />
        </DialogContent>
      </Dialog>

      {subflowDialogOpen && (
        <CanvasNameDialog
          title="保存当前定义为子流程"
          initialName={`${name || "未命名流程"} · 子流程`.slice(0, 160)}
          onClose={() => setSubflowDialogOpen(false)}
          onSave={async subflowName => {
            if (!(await onSaveAsSubflow(subflowName)))
              throw new Error("当前定义尚未就绪，请稍后重试。");
          }}
        />
      )}
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
  const isInternalUpdate = useRef(false);

  useEffect(() => {
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    setRows(toRows(value));
  }, [value]);
  const update = (next: Array<{ key: string; value: string }>) => {
    setRows(next);
    isInternalUpdate.current = true;
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
      className="mb-3 min-w-0 rounded-lg border border-border bg-card p-3"
    >
      <div>
        <p className="aiflow-type-section-title flex items-center gap-2 font-semibold text-foreground">
          <CirclePlay size={14} className="text-aiflow-success" />
          运行字段
        </p>
        <p className="aiflow-type-body mt-1 text-muted-foreground">
          当前流程未提供可读取的入口字段
          schema；请按业务约定填写字段名和值。数值与 true/false
          会自动保留类型，无需编辑 JSON。
        </p>
      </div>
      <div className="mt-3 grid min-w-0 gap-2">
        {!rows.length && (
          <div
            role="status"
            className="aiflow-type-body rounded border border-dashed border-border bg-muted px-3 py-2 text-muted-foreground"
          >
            当前未填写运行字段；如该流程不需要输入，可直接运行，否则请先按业务约定添加字段。
          </div>
        )}
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
              className="rounded px-2 text-muted-foreground hover:text-red-600"
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
          className="w-fit text-xs font-medium text-aiflow-info hover:underline"
          onClick={() => update([...rows, { key: "", value: "" }])}
        >
          + 添加运行字段
        </button>
      </div>
      <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
        <Button
          className="bg-blue-600 text-white hover:bg-blue-700 shadow-2xs"
          size="sm"
          disabled={!canRun || runPending}
          onClick={onRun}
        >
          {runPending ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <Play size={14} />
          )}
          立即运行测试
        </Button>
      </div>
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
        <p className="text-xs font-bold tracking-[.18em] text-aiflow-info">
          RUNTIME OBSERVABILITY
        </p>
        <h2
          data-aiflow-page-title=""
          className="aiflow-type-page-title mt-1 font-semibold"
        >
          执行历史与节点日志
        </h2>
      </div>
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">
            近期运行
          </div>
          <div className="max-h-[650px] overflow-y-auto">
            {runs.map(run => (
              <button
                key={run.id}
                onClick={() => onSelect(run.id)}
                className={`w-full border-b border-border p-4 text-left hover:bg-muted ${selectedRun?.id === run.id ? "bg-aiflow-info-surface" : ""}`}
              >
                <div className="flex justify-between gap-2">
                  <code className="text-xs text-muted-foreground">
                    {run.id.slice(0, 8)}
                  </code>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${run.status === "success" ? "bg-aiflow-success-surface text-aiflow-success" : run.status === "failed" ? "bg-red-100 text-red-700" : "bg-aiflow-warning-surface text-aiflow-warning"}`}
                  >
                    {run.status}
                  </span>
                </div>
                <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
                  <span>{formatTime(run.createdAt)}</span>
                  <span>{run.durationMs ?? "—"} ms</span>
                </div>
              </button>
            ))}
            {!runs.length && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                尚无运行记录。
              </p>
            )}
          </div>
        </section>
        <section className="min-h-80 rounded-lg border border-border bg-card p-5">
          {selectedRun ? (
            <>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold tracking-[.18em] text-muted-foreground">
                    RUN {selectedRun.id.slice(0, 8)}
                  </p>
                  <h3 className="mt-1 font-semibold">
                    {selectedRun.status === "success" ? "运行成功" : "运行详情"}
                  </h3>
                </div>
                <span className="text-xs text-muted-foreground">
                  {selectedRun.durationMs ?? "—"} ms
                </span>
              </div>
              <div className="mt-5 grid gap-3">
                {selectedRun.nodeRuns?.map((node: any) => (
                  <details
                    key={node.id}
                    className="rounded border border-border bg-muted p-3"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${node.status === "success" ? "bg-emerald-500" : node.status === "failed" ? "bg-red-500" : "bg-slate-400"}`}
                        />
                        {node.nodeName}
                        <code className="text-[10px] text-muted-foreground">
                          {node.nodeType}
                        </code>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {node.durationMs ?? "—"} ms
                      </span>
                    </summary>
                    <div className="mt-3 grid gap-3 border-t border-border pt-3 text-xs">
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
            <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
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
      <p className="aiflow-type-control mb-1 font-semibold text-muted-foreground">
        {title}
      </p>
      <pre className="aiflow-type-code max-h-48 overflow-auto rounded bg-slate-950 p-3 font-mono text-emerald-200">
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

type AuditCategory = "authentication" | "account" | "roles";
const authorizationAuditActions: Record<
  string,
  { label: string; category: AuditCategory }
> = {
  login_success: { label: "登录成功", category: "authentication" },
  login_failed: { label: "登录失败", category: "authentication" },
  logout: { label: "退出登录", category: "authentication" },
  user_created: { label: "创建账号", category: "account" },
  user_updated: { label: "更新账号或成员关系", category: "account" },
  user_disabled: { label: "停用账号", category: "account" },
  role_assigned: { label: "授予角色", category: "roles" },
  role_revoked: { label: "撤销角色", category: "roles" },
  temporary_role_assigned: { label: "授予临时角色", category: "roles" },
  temporary_role_revoked: { label: "撤销临时角色", category: "roles" },
};

function auditActionLabel(action: string) {
  return authorizationAuditActions[action]?.label ?? "未识别操作";
}

function auditCategoryLabel(category: string) {
  const labels: Record<string, string> = {
    authentication: "认证",
    account: "账号管理",
    roles: "角色授权",
    other: "其他",
  };
  return labels[category] ?? "其他";
}

function auditDetailsText(value: unknown) {
  if (value === null || value === undefined || value === "")
    return "无附加详情";
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

async function copyAuditActionCode(value: string) {
  try {
    if (!navigator.clipboard?.writeText)
      throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(value);
    toast.success("原始操作码已复制。");
  } catch {
    toast.error("浏览器无法访问剪贴板；可选择操作码后手动复制。");
  }
}

function IamCenter({
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
  const userPageSize = 10;
  const rolePageSize = 10;
  const auditPageSize = 10;
  const [normalDialogOpen, setNormalDialogOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [tab, setTab] = useState<"users" | "roles" | "audit">("users");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(0);
  const [rolePage, setRolePage] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const [roleCandidateSearch, setRoleCandidateSearch] = useState("");
  const [roleCandidatePage, setRoleCandidatePage] = useState(0);
  const [roleSearch, setRoleSearch] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditCategory, setAuditCategory] = useState("all");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [mobileUserDetailsOpen, setMobileUserDetailsOpen] = useState(false);
  const [mobileRoleDetailsOpen, setMobileRoleDetailsOpen] = useState(false);
  const [pendingRevokeRoleId, setPendingRevokeRoleId] = useState<string | null>(
    null
  );
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
  const userDirectory = trpc.iam.userDirectory.useQuery(
    {
      search: userSearch.trim(),
      offset: userPage * userPageSize,
      limit: userPageSize,
    },
    { retry: false }
  );
  const roleAssignmentUsers = trpc.iam.roleAssignableUsers.useQuery(
    {
      roleId: selectedRoleId ?? 1,
      search: roleCandidateSearch.trim(),
      offset: roleCandidatePage * userPageSize,
      limit: userPageSize,
    },
    {
      enabled: assignmentDialog?.mode === "role" && selectedRoleId !== null,
      retry: false,
    }
  );
  const roleCandidateTotal = roleAssignmentUsers.data?.total ?? 0;
  const roleCandidatePageCount = Math.max(
    1,
    Math.ceil(roleCandidateTotal / userPageSize)
  );
  const filteredUsers = userDirectory.data?.items ?? [];
  const userTotal = userDirectory.data?.total ?? 0;
  const userPageCount = Math.max(1, Math.ceil(userTotal / userPageSize));
  const utils = trpc.useUtils();
  const userDetails = trpc.iam.userAuthorizationDetails.useQuery(
    { userId: selectedUserId ?? 1 },
    { enabled: selectedUserId !== null, retry: false }
  );
  const roleDetails = trpc.iam.roleAuthorizationDetails.useQuery(
    { roleId: selectedRoleId ?? 1 },
    { enabled: selectedRoleId !== null, retry: false }
  );
  const roleCandidateUsers = roleAssignmentUsers.data?.items ?? [];
  const assignSystemRole = trpc.iam.assignSystemRole.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.iam.userAuthorizationDetails.invalidate(),
        utils.iam.roleAuthorizationDetails.invalidate(),
        utils.iam.roleAssignableUsers.invalidate(),
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
        utils.iam.roleAssignableUsers.invalidate(),
        utils.iam.authorizationAudit.invalidate(),
      ]);
      setPendingRevokeRoleId(null);
      toast.success("直接角色授权已撤销。");
    },
    onError: error => toast.error(error.message),
  });

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
  const filteredAudit = useMemo(() => {
    const keyword = auditSearch.trim().toLowerCase();
    const startTime = auditFrom
      ? new Date(`${auditFrom}T00:00:00`).getTime()
      : null;
    const endTime = auditTo
      ? new Date(`${auditTo}T23:59:59.999`).getTime()
      : null;
    return audit.filter(item => {
      const action = authorizationAuditActions[item.action];
      const category = action?.category ?? "other";
      if (auditCategory !== "all" && auditCategory !== category) return false;
      if (keyword) {
        const searchable = [
          item.action,
          action?.label,
          item.actorUsername,
          item.targetUsername,
          item.resourceType,
          item.resourceId,
          item.requestId,
        ]
          .map(value => String(value ?? "").toLowerCase())
          .join(" ");
        if (!searchable.includes(keyword)) return false;
      }
      if (startTime !== null || endTime !== null) {
        const createdAt = new Date(item.createdAt).getTime();
        if (!Number.isFinite(createdAt)) return false;
        if (startTime !== null && createdAt < startTime) return false;
        if (endTime !== null && createdAt > endTime) return false;
      }
      return true;
    });
  }, [audit, auditCategory, auditFrom, auditSearch, auditTo]);
  const rolePageCount = Math.max(
    1,
    Math.ceil(filteredRoles.length / rolePageSize)
  );
  const visibleRoles = filteredRoles.slice(
    rolePage * rolePageSize,
    (rolePage + 1) * rolePageSize
  );
  const auditPageCount = Math.max(
    1,
    Math.ceil(filteredAudit.length / auditPageSize)
  );
  const visibleAudit = filteredAudit.slice(
    auditPage * auditPageSize,
    (auditPage + 1) * auditPageSize
  );
  const systemRoles = useMemo(
    () => roles.filter(role => role.scope === "system"),
    [roles]
  );
  const selectedRole = roles.find(role => Number(role.id) === selectedRoleId);
  const pendingRevokeRole = userDetails.data?.directRoles.find(
    (role: any) => role.assignmentId === pendingRevokeRoleId
  );

  useEffect(() => {
    if (!userDirectory.isSuccess) return;
    if (userPage >= userPageCount) {
      setUserPage(userPageCount - 1);
      return;
    }
    const first = filteredUsers[0];
    if (
      first &&
      !filteredUsers.some(account => Number(account.id) === selectedUserId)
    )
      setSelectedUserId(Number(first.id));
    if (!first && selectedUserId !== null) setSelectedUserId(null);
  }, [
    filteredUsers,
    selectedUserId,
    userDirectory.isSuccess,
    userPage,
    userPageCount,
  ]);
  useEffect(() => {
    if (selectedRoleId === null && roles[0])
      setSelectedRoleId(Number(roles[0].id));
  }, [roles, selectedRoleId]);
  useEffect(() => {
    if (
      assignmentDialog?.mode === "role" &&
      roleAssignmentUsers.isSuccess &&
      roleCandidatePage >= roleCandidatePageCount
    )
      setRoleCandidatePage(roleCandidatePageCount - 1);
  }, [
    assignmentDialog?.mode,
    roleAssignmentUsers.isSuccess,
    roleCandidatePage,
    roleCandidatePageCount,
  ]);
  useEffect(() => {
    if (
      filteredRoles.length &&
      !filteredRoles.some(role => Number(role.id) === selectedRoleId)
    )
      setSelectedRoleId(Number(filteredRoles[0].id));
  }, [filteredRoles, selectedRoleId]);
  useEffect(() => {
    if (rolePage >= rolePageCount) setRolePage(rolePageCount - 1);
  }, [rolePage, rolePageCount]);
  useEffect(() => {
    if (auditPage >= auditPageCount) setAuditPage(auditPageCount - 1);
  }, [auditPage, auditPageCount]);
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
    setMobileRoleDetailsOpen(false);
    setRoleCandidateSearch("");
    setRoleCandidatePage(0);
    setAssignmentDialog({
      mode: "role",
      userId: "",
      roleCode: selectedRole.code,
    });
  };

  const submitRoleAssignment = () => {
    if (!assignmentDialog?.userId || !assignmentDialog.roleCode) return;
    const expiry = roleExpiryInput(assignmentHours);
    if (expiry.error) {
      toast.error(expiry.error);
      return;
    }
    assignSystemRole.mutate({
      userId: Number(assignmentDialog.userId),
      roleCode: assignmentDialog.roleCode,
      expiresAt: expiry.expiresAt,
      note: assignmentNote.trim() || undefined,
    });
  };

  return (
    <div className="space-y-5 p-4 lg:p-6 [&_input]:h-11 [&_select]:h-11 [&_button]:min-h-11 min-[1024px]:[&_input]:h-10 min-[1024px]:[&_select]:h-10 min-[1024px]:[&_button]:min-h-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold tracking-[.18em] text-aiflow-info">
            IDENTITY & AUTHORIZATION
          </p>
          <h1
            data-aiflow-page-title=""
            className="aiflow-type-page-title mt-1 font-semibold"
          >
            内部账号与权限中心
          </h1>
          <p className="aiflow-type-body mt-1 text-muted-foreground">
            管理内部账号、角色和有效权限；直接授权与组织继承分别展示。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                aria-label="新增账号"
                className="min-h-11 bg-blue-600 text-white shadow-2xs hover:bg-blue-700 min-[1024px]:min-h-0"
                data-iam-account-create-menu
              >
                <Plus size={15} />
                新增账号
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setNormalDialogOpen(true)}>
                <Plus size={14} />
                新增单个账号
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setAiPreview(null);
                  setBatchResult(null);
                  setAiDialogOpen(true);
                }}
              >
                <WandSparkles size={14} />
                AI 辅助批量创建
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <CreationDialog
        open={normalDialogOpen}
        onOpenChange={setNormalDialogOpen}
        title="新增内部账号"
        description="填写账号信息并确认创建；取消保留现有账号。"
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
          className="h-9 rounded-md border border-border bg-card px-2 text-sm"
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
        description="模型生成非敏感账号预览；密码不会发送给模型，确认后才创建。"
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
            className="min-h-24 w-full rounded-md border border-border bg-card p-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 md:row-span-2"
            placeholder="例如：创建 5 名财务审核专员，使用 example.com 测试邮箱。"
            value={aiForm.goal}
            onChange={event =>
              resetPreview({ ...aiForm, goal: event.target.value })
            }
            required
          />
          <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
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
          <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
            账号角色
            <select
              className="h-9 min-w-0 rounded-md border border-border bg-card px-2 text-sm"
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
          <p className="aiflow-type-body self-end break-words text-muted-foreground md:col-span-2">
            模型不能提升指定角色；预览不创建账号。
          </p>
        </div>
        {aiPreview && (
          <div className="min-w-0 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 aiflow-type-control text-foreground">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="aiflow-type-body font-semibold text-indigo-950">
                即将创建的用户（{aiPreview.users.length}）
              </p>
              <span className="rounded-full bg-card px-2 py-1 text-[10px] text-aiflow-info">
                {aiPreview.generatedBy === "ai" ? "AI 生成" : "安全回退"}
              </span>
            </div>
            <div className="max-h-[360px] overflow-auto rounded-md border border-indigo-100 bg-card">
              <table className="w-full min-w-[880px] table-fixed text-left">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
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
                      className="border-t border-border align-top"
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
                      <td className="break-all p-2 font-mono text-aiflow-info">
                        {account.username}
                      </td>
                      <td className="break-words p-2 font-medium">
                        {account.displayName}
                      </td>
                      <td className="break-all p-2 text-muted-foreground">
                        {account.email || "—"}
                      </td>
                      <td className="p-2">
                        {account.role === "admin" ? "管理员" : "普通用户"}
                      </td>
                      <td className="break-words p-2 text-muted-foreground">
                        {account.organizationSuggestion || "—"}
                        <br />
                        {account.managerSuggestion || ""}
                      </td>
                      <td className="break-words p-2 text-muted-foreground">
                        {account.rationale}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="mt-3 grid gap-1 text-xs font-medium text-muted-foreground sm:max-w-md">
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
          <div className="aiflow-type-body rounded-md border border-aiflow-warning-border bg-aiflow-warning-surface p-3">
            <p className="font-semibold text-amber-900">
              部分账号创建失败，请修正目标后重新生成
            </p>
            {batchResult
              .filter(item => !item.success)
              .map(item => (
                <p
                  key={item.username}
                  className="mt-1 break-all text-aiflow-warning"
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
        submitDisabled={
          !assignmentDialog?.userId ||
          !assignmentDialog.roleCode ||
          Boolean(roleExpiryInput(assignmentHours).error)
        }
        onSubmit={submitRoleAssignment}
      >
        {assignmentDialog?.mode === "user" ? (
          <>
            <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
              当前用户
              <Input
                className="aiflow-type-control h-11 min-h-11 min-w-0 min-[1024px]:h-10 min-[1024px]:min-h-0"
                value={
                  userDetails.data?.user.name ||
                  userDetails.data?.user.username ||
                  ""
                }
                disabled
              />
            </label>
            <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
              系统角色
              <select
                className="aiflow-type-control h-11 min-h-11 min-w-0 rounded-md border border-border bg-card px-2 min-[1024px]:h-10 min-[1024px]:min-h-0"
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
            <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
              当前角色
              <Input
                className="aiflow-type-control h-11 min-h-11 min-w-0 min-[1024px]:h-10 min-[1024px]:min-h-0"
                value={
                  selectedRole
                    ? `${selectedRole.name}（${selectedRole.code}）`
                    : ""
                }
                disabled
              />
            </label>
            <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
              搜索内部用户
              <Input
                className="aiflow-type-control h-11 min-h-11 min-w-0 min-[1024px]:h-10 min-[1024px]:min-h-0"
                value={roleCandidateSearch}
                maxLength={160}
                placeholder="按姓名、用户名或邮箱搜索"
                onChange={event => {
                  setRoleCandidateSearch(event.target.value);
                  setRoleCandidatePage(0);
                  setAssignmentDialog(current =>
                    current?.mode === "role"
                      ? { ...current, userId: "" }
                      : current
                  );
                }}
              />
            </label>
            <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
              选择内部用户
              <select
                className="aiflow-type-control h-11 min-h-11 min-w-0 rounded-md border border-border bg-card px-2 min-[1024px]:h-10 min-[1024px]:min-h-0"
                value={assignmentDialog?.userId ?? ""}
                disabled={
                  roleAssignmentUsers.isPending || roleAssignmentUsers.isError
                }
                onChange={event =>
                  assignmentDialog &&
                  setAssignmentDialog({
                    ...assignmentDialog,
                    userId: event.target.value,
                  })
                }
                required
              >
                <option value="">
                  {roleAssignmentUsers.isPending
                    ? "正在读取用户…"
                    : roleCandidateUsers.length
                      ? "请选择用户"
                      : "当前页无可绑定用户"}
                </option>
                {roleCandidateUsers.map(account => (
                  <option key={account.id} value={account.id}>
                    {account.name || account.username}（{account.username}）
                  </option>
                ))}
              </select>
              {roleAssignmentUsers.isSuccess && (
                <span className="aiflow-type-body font-normal text-muted-foreground">
                  可绑定用户 {roleCandidateTotal} 条，当前页{" "}
                  {roleCandidateUsers.length}{" "}
                  条；已停用或已绑定账号已从结果中排除。
                </span>
              )}
              {roleAssignmentUsers.isError && (
                <span className="aiflow-type-body text-aiflow-danger">
                  用户候选读取失败：{roleAssignmentUsers.error.message}
                  <button
                    type="button"
                    className="aiflow-type-control ml-2 inline-flex min-h-11 items-center px-1 underline min-[1024px]:min-h-0"
                    onClick={() => void roleAssignmentUsers.refetch()}
                  >
                    重试
                  </button>
                </span>
              )}
            </label>
            {roleAssignmentUsers.isSuccess &&
              roleCandidateTotal > userPageSize && (
                <div className="aiflow-type-body flex items-center justify-between gap-2 text-muted-foreground">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 min-[1024px]:h-10"
                    disabled={roleCandidatePage === 0}
                    onClick={() => {
                      setRoleCandidatePage(page => page - 1);
                      setAssignmentDialog(current =>
                        current?.mode === "role"
                          ? { ...current, userId: "" }
                          : current
                      );
                    }}
                  >
                    上一页
                  </Button>
                  <span aria-live="polite">
                    {roleCandidatePage + 1} / {roleCandidatePageCount}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 min-[1024px]:h-10"
                    disabled={roleCandidatePage + 1 >= roleCandidatePageCount}
                    onClick={() => {
                      setRoleCandidatePage(page => page + 1);
                      setAssignmentDialog(current =>
                        current?.mode === "role"
                          ? { ...current, userId: "" }
                          : current
                      );
                    }}
                  >
                    下一页
                  </Button>
                </div>
              )}
          </>
        )}
        <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
          有效期小时（可选）
          <Input
            className="aiflow-type-control h-11 min-h-11 min-w-0 min-[1024px]:h-10 min-[1024px]:min-h-0"
            type="number"
            min={1}
            step={1}
            aria-invalid={Boolean(roleExpiryInput(assignmentHours).error)}
            aria-describedby="role-expiry-description"
            placeholder="留空表示长期有效"
            value={assignmentHours}
            onChange={event => setAssignmentHours(event.target.value)}
          />
        </label>
        <p
          id="role-expiry-description"
          role="status"
          className={`text-sm ${roleExpiryInput(assignmentHours).error ? "text-aiflow-danger" : "text-muted-foreground"}`}
        >
          {roleExpiryInput(assignmentHours).error ||
            (assignmentHours.trim()
              ? "临时授权将在指定小时数后自动失效。"
              : "长期授权持续有效，直到主动撤销。")}
        </p>
        <label className="aiflow-type-control grid min-w-0 gap-1.5 font-medium text-foreground">
          授权备注（可选）
          <Input
            className="aiflow-type-control h-11 min-h-11 min-w-0 min-[1024px]:h-10 min-[1024px]:min-h-0"
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
        className="grid min-w-0 grid-cols-3 gap-1 border-b border-border bg-card px-2 sm:flex sm:flex-wrap"
      >
        {(
          [
            {
              id: "users",
              label: "用户账号",
              shortLabel: "用户",
              icon: UsersRound,
            },
            {
              id: "roles",
              label: "角色与权限",
              shortLabel: "角色",
              icon: KeyRound,
            },
            {
              id: "audit",
              label: "授权审计",
              shortLabel: "审计",
              icon: SlidersHorizontal,
            },
          ] as const
        ).map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-label={item.label}
            aria-selected={tab === item.id}
            className={`aiflow-type-control flex h-11 min-w-0 items-center justify-center gap-1 border-b-2 px-1 text-center min-[640px]:gap-2 min-[640px]:px-3 min-[1024px]:h-10 ${tab === item.id ? "border-aiflow-info bg-aiflow-info-surface text-aiflow-info" : "border-transparent text-muted-foreground hover:bg-muted"}`}
            onClick={() => setTab(item.id)}
          >
            <span
              className={`grid h-7 w-7 place-items-center rounded-full ${tab === item.id ? "bg-aiflow-info-surface text-aiflow-info" : "bg-muted text-muted-foreground"}`}
            >
              <item.icon size={14} />
            </span>
            <span className="min-[640px]:hidden">{item.shortLabel}</span>
            <span className="hidden min-[640px]:inline">{item.label}</span>
          </button>
        ))}
      </div>

      {tab === "users" && (
        <div
          data-iam-user-workbench
          className="grid min-w-0 gap-5 min-[1024px]:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]"
        >
          <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">用户目录</p>
                <span className="text-xs text-muted-foreground">
                  {userDirectory.isPending
                    ? "正在读取…"
                    : userTotal
                      ? `${userPage * userPageSize + 1}–${Math.min((userPage + 1) * userPageSize, userTotal)} / ${userTotal}`
                      : "0 / 0"}
                </span>
              </div>
              <label className="relative mt-3 block min-w-0">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  size={14}
                />
                <Input
                  aria-label="搜索用户"
                  className="min-h-11 min-w-0 pl-9 min-[1024px]:min-h-0"
                  placeholder="搜索名称、账号或邮箱"
                  value={userSearch}
                  onChange={event => {
                    setUserSearch(event.target.value);
                    setUserPage(0);
                  }}
                />
              </label>
            </div>
            <div className="p-2">
              {userDirectory.isPending && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  正在读取用户目录…
                </p>
              )}
              {userDirectory.isError && (
                <div className="p-6 text-center text-sm text-aiflow-danger">
                  <p>用户目录读取失败：{userDirectory.error.message}</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3"
                    onClick={() => void userDirectory.refetch()}
                  >
                    重试
                  </Button>
                </div>
              )}
              {filteredUsers.map(account => (
                <div
                  key={account.id}
                  data-iam-user-row=""
                  className={`mb-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border px-2 py-1.5 ${selectedUserId === Number(account.id) ? "border-aiflow-info-border bg-aiflow-info-surface" : "border-transparent bg-muted hover:border-border"}`}
                >
                  <button
                    type="button"
                    aria-pressed={selectedUserId === Number(account.id)}
                    className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 text-left"
                    onClick={() => setSelectedUserId(Number(account.id))}
                  >
                    <span
                      aria-hidden="true"
                      className={`grid h-8 w-8 place-items-center rounded-full text-xs font-semibold ${account.status === "active" ? "bg-aiflow-info-surface text-aiflow-info" : "bg-slate-200 text-muted-foreground"}`}
                    >
                      {(account.name || account.username || "?").slice(0, 1)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="aiflow-type-body min-w-0 break-words font-medium text-foreground [overflow-wrap:anywhere]"
                          title={account.name || account.username}
                        >
                          {account.name || account.username}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none ${account.status === "active" ? "bg-aiflow-success-surface text-aiflow-success" : "bg-slate-200 text-muted-foreground"}`}
                        >
                          {account.status === "active" ? "启用" : "停用"}
                        </span>
                      </span>
                      <span
                        className="mt-0.5 block break-words font-mono text-[10px] leading-4 text-muted-foreground [overflow-wrap:anywhere]"
                        title={account.username}
                      >
                        {account.username}
                      </span>
                      <span
                        className="mt-0.5 block break-words text-[10px] leading-4 text-muted-foreground [overflow-wrap:anywhere]"
                        title={formatTime(account.lastSignedIn)}
                      >
                        {account.role === "admin" ? "系统管理员" : "普通用户"}
                        <span aria-hidden="true"> · </span>
                        最近登录 {formatTime(account.lastSignedIn)}
                      </span>
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`更多账号操作：${account.name || account.username || "内部账号"}`}
                        className="h-11 w-11 shrink-0 text-muted-foreground min-[1024px]:h-10 min-[1024px]:w-10"
                        data-iam-user-more-actions
                      >
                        <MoreHorizontal size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="min-[1024px]:hidden"
                        onClick={() => {
                          setSelectedUserId(Number(account.id));
                          setMobileUserDetailsOpen(true);
                        }}
                      >
                        <Eye size={14} />
                        查看权限与角色
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="min-[1024px]:hidden" />
                      <DropdownMenuItem
                        data-iam-account-status-action=""
                        className={
                          account.status === "active"
                            ? "text-aiflow-danger focus:text-aiflow-danger"
                            : "text-aiflow-success focus:text-aiflow-success"
                        }
                        onClick={() =>
                          onToggleStatus(account.id, account.status)
                        }
                      >
                        {account.status === "active" ? "停用账号" : "启用账号"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
              {userDirectory.isSuccess && !filteredUsers.length && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  没有匹配的内部用户。
                </p>
              )}
            </div>
            {userDirectory.isSuccess && userTotal > userPageSize && (
              <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={userPage === 0}
                  className="h-11 min-[1024px]:h-10"
                  onClick={() => setUserPage(page => page - 1)}
                >
                  上一页
                </Button>
                <span aria-live="polite" className="text-muted-foreground">
                  {userPage + 1} / {userPageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={userPage + 1 >= userPageCount}
                  className="h-11 min-[1024px]:h-10"
                  onClick={() => setUserPage(page => page + 1)}
                >
                  下一页
                </Button>
              </div>
            )}
          </section>
          <section className="sticky top-4 hidden min-w-0 self-start overflow-hidden rounded-lg border border-border bg-card min-[1024px]:block">
            <UserAuthorizationPanel
              details={userDetails}
              onAssign={openUserAssignment}
              onRevoke={setPendingRevokeRoleId}
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
                  onRevoke={setPendingRevokeRoleId}
                  revoking={revokeRole.isPending}
                  embedded
                />
              </div>
            </DialogContent>
          </Dialog>
          <Dialog
            open={pendingRevokeRoleId !== null}
            onOpenChange={open => {
              if (!open && !revokeRole.isPending) setPendingRevokeRoleId(null);
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>撤销直接角色授权</DialogTitle>
                <DialogDescription>
                  将从“
                  {userDetails.data?.user.name ||
                    userDetails.data?.user.username ||
                    "当前用户"}
                  ”移除“{pendingRevokeRole?.roleName || "所选角色"}
                  ”的直接授权。依赖此角色的权限会立即失效，组织继承角色不受影响。
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={revokeRole.isPending}
                  onClick={() => setPendingRevokeRoleId(null)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!pendingRevokeRoleId || revokeRole.isPending}
                  onClick={() =>
                    pendingRevokeRoleId &&
                    revokeRole.mutate({ assignmentId: pendingRevokeRoleId })
                  }
                >
                  {revokeRole.isPending ? "正在撤销…" : "确认撤销"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {tab === "roles" && (
        <div
          data-iam-role-workbench
          className="grid min-w-0 gap-5 min-[1024px]:grid-cols-[280px_minmax(0,1fr)]"
        >
          <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
            <div className="border-b border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">角色列表</p>
                <span className="text-xs text-muted-foreground">
                  {filteredRoles.length} / {roles.length}
                </span>
              </div>
              <label className="relative mt-3 block min-w-0">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  size={14}
                />
                <Input
                  aria-label="搜索角色"
                  className="min-h-11 min-w-0 pl-9 min-[1024px]:min-h-0"
                  placeholder="搜索角色名称或编码"
                  value={roleSearch}
                  onChange={event => {
                    setRoleSearch(event.target.value);
                    setRolePage(0);
                  }}
                />
              </label>
            </div>
            <div className="p-2">
              {visibleRoles.map(role => (
                <div
                  key={role.id}
                  data-iam-role-row=""
                  className="mb-1 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md border border-transparent bg-muted p-1.5 hover:border-border"
                >
                  <button
                    type="button"
                    aria-pressed={selectedRoleId === Number(role.id)}
                    className={`min-w-0 rounded border px-2 py-1.5 text-left ${selectedRoleId === Number(role.id) ? "border-aiflow-info-border bg-aiflow-info-surface" : "border-transparent hover:bg-card"}`}
                    onClick={() => setSelectedRoleId(Number(role.id))}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <p
                        className="aiflow-type-meta min-w-0 break-words font-mono font-semibold text-aiflow-info [overflow-wrap:anywhere]"
                        title={role.code}
                      >
                        {role.code}
                      </p>
                      <span className="aiflow-type-meta shrink-0 rounded-full bg-card px-1.5 py-0.5 text-muted-foreground">
                        {role.scope}
                      </span>
                    </div>
                    <p
                      className="aiflow-type-body mt-0.5 break-words font-medium text-foreground [overflow-wrap:anywhere]"
                      title={role.name}
                    >
                      {role.name}
                    </p>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`查看角色详情：${role.name}（${role.code}）`}
                    className="aiflow-type-control h-11 min-w-11 px-2 min-[1024px]:hidden"
                    onClick={() => {
                      setSelectedRoleId(Number(role.id));
                      setMobileRoleDetailsOpen(true);
                    }}
                  >
                    <Eye size={13} />
                  </Button>
                </div>
              ))}
              {!filteredRoles.length && (
                <p className="p-8 text-center text-sm text-muted-foreground">
                  没有匹配的角色。
                </p>
              )}
            </div>
            {filteredRoles.length > rolePageSize && (
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 min-[1024px]:h-10"
                  disabled={rolePage === 0}
                  onClick={() => {
                    const nextPage = Math.max(0, rolePage - 1);
                    setRolePage(nextPage);
                    setSelectedRoleId(
                      Number(filteredRoles[nextPage * rolePageSize]?.id)
                    );
                  }}
                >
                  上一页
                </Button>
                <span
                  aria-live="polite"
                  className="text-xs text-muted-foreground"
                >
                  {rolePage + 1} / {rolePageCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 min-[1024px]:h-10"
                  disabled={rolePage + 1 >= rolePageCount}
                  onClick={() => {
                    const nextPage = Math.min(rolePageCount - 1, rolePage + 1);
                    setRolePage(nextPage);
                    setSelectedRoleId(
                      Number(filteredRoles[nextPage * rolePageSize]?.id)
                    );
                  }}
                >
                  下一页
                </Button>
              </div>
            )}
          </section>
          <section className="sticky top-4 hidden min-w-0 self-start overflow-hidden rounded-lg border border-border bg-card min-[1024px]:block">
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
                <DialogTitle>角色详情</DialogTitle>
                <DialogDescription className="aiflow-type-body leading-6">
                  查看角色权限、直接绑定用户及组织继承用户。
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
        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="aiflow-type-section-title flex items-center gap-2 font-semibold">
              <SlidersHorizontal size={15} />
              授权审计
            </div>
            <span className="aiflow-type-meta text-muted-foreground">
              显示 {filteredAudit.length} / {audit.length} 条已加载记录
            </span>
          </div>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border bg-muted/60 p-3 min-[1024px]:grid-cols-[minmax(180px,1fr)_140px_auto_auto] min-[1024px]:items-start">
            <Input
              aria-label="搜索授权审计"
              className="col-span-2 min-h-11 min-w-0 bg-card min-[1024px]:col-span-1 min-[1024px]:min-h-0"
              placeholder="搜索操作、操作者、对象或请求 ID"
              value={auditSearch}
              onChange={event => {
                setAuditSearch(event.target.value);
                setAuditPage(0);
              }}
            />
            <select
              aria-label="授权审计类别"
              className="col-span-2 h-11 min-w-0 rounded-md border border-border bg-card px-2 min-[1024px]:col-span-1 min-[1024px]:h-10"
              value={auditCategory}
              onChange={event => {
                setAuditCategory(event.target.value);
                setAuditPage(0);
              }}
            >
              <option value="all">全部类别</option>
              <option value="authentication">认证</option>
              <option value="account">账号管理</option>
              <option value="roles">角色授权</option>
              <option value="other">其他 / 未识别</option>
            </select>
            <details
              data-iam-audit-date-filter
              className="group relative min-w-0"
            >
              <summary
                aria-label={`日期筛选，已应用 ${Number(Boolean(auditFrom)) + Number(Boolean(auditTo))} 项`}
                className="flex h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-sm text-foreground hover:bg-muted min-[1024px]:h-10"
              >
                日期范围
                {(auditFrom || auditTo) && (
                  <span className="aiflow-type-meta rounded-full bg-aiflow-info-surface px-1.5 py-0.5 text-aiflow-info">
                    {Number(Boolean(auditFrom)) + Number(Boolean(auditTo))}
                  </span>
                )}
              </summary>
              <div className="absolute left-0 z-20 mt-1 grid w-[min(23rem,calc(100vw-4rem))] min-w-0 gap-3 rounded-lg border border-border bg-card p-3 shadow-xl min-[1024px]:left-auto min-[1024px]:right-0 sm:grid-cols-2">
                <label className="grid min-w-0 gap-1 text-sm text-muted-foreground">
                  起始日期
                  <Input
                    aria-label="审计起始日期"
                    type="date"
                    className="min-h-11 min-w-0 bg-card min-[1024px]:min-h-10"
                    value={auditFrom}
                    onChange={event => {
                      setAuditFrom(event.target.value);
                      setAuditPage(0);
                    }}
                  />
                </label>
                <label className="grid min-w-0 gap-1 text-sm text-muted-foreground">
                  结束日期
                  <Input
                    aria-label="审计结束日期"
                    type="date"
                    className="min-h-11 min-w-0 bg-card min-[1024px]:min-h-10"
                    value={auditTo}
                    onChange={event => {
                      setAuditTo(event.target.value);
                      setAuditPage(0);
                    }}
                  />
                </label>
              </div>
            </details>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 min-[1024px]:h-10"
              onClick={() => {
                setAuditSearch("");
                setAuditCategory("all");
                setAuditFrom("");
                setAuditTo("");
                setAuditPage(0);
              }}
            >
              重置
            </Button>
          </div>
          <div className="hidden grid-cols-[150px_minmax(130px,1fr)_minmax(150px,1fr)_minmax(150px,1.1fr)_80px_90px] gap-3 border-b border-border bg-muted px-4 py-2 text-[10px] font-medium text-muted-foreground min-[1024px]:grid">
            <span>时间</span>
            <span>操作者 → 对象</span>
            <span>操作</span>
            <span>资源</span>
            <span>记录</span>
            <span>详情</span>
          </div>
          <div>
            {visibleAudit.map(item => {
              const action = authorizationAuditActions[item.action];
              const category = action?.category ?? "other";
              const outcome =
                item.action === "login_failed" ? "失败" : "已记录";
              const expanded = expandedAuditId === String(item.id);
              return (
                <div
                  key={item.id}
                  data-iam-audit-row=""
                  className="border-b border-border last:border-b-0"
                >
                  <div className="aiflow-type-body grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 min-[1024px]:grid-cols-[150px_minmax(130px,1fr)_minmax(150px,1fr)_minmax(150px,1.1fr)_80px_90px] min-[1024px]:items-center min-[1024px]:gap-3">
                    <div className="min-w-0">
                      <span className="mb-1 block text-[10px] text-muted-foreground min-[1024px]:hidden">
                        时间
                      </span>
                      <span className="aiflow-type-meta text-muted-foreground">
                        {formatTime(item.createdAt)}
                      </span>
                    </div>
                    <div
                      aria-label={`记录状态：${outcome}`}
                      className="min-w-0 justify-self-end min-[1024px]:col-start-5 min-[1024px]:justify-self-start"
                      role="group"
                    >
                      <span
                        className={`aiflow-type-meta inline-flex rounded-full px-2 py-0.5 ${outcome === "失败" ? "bg-aiflow-danger-surface text-aiflow-danger" : "bg-muted text-muted-foreground"}`}
                      >
                        {outcome}
                      </span>
                    </div>
                    <div className="col-span-2 min-w-0 min-[1024px]:col-span-1 min-[1024px]:col-start-2">
                      <span className="mb-1 block text-[10px] text-muted-foreground min-[1024px]:hidden">
                        操作者 → 对象
                      </span>
                      <span
                        className="block break-words text-foreground [overflow-wrap:anywhere]"
                        title={`${item.actorUsername || "系统"} → ${item.targetUsername || "—"}`}
                      >
                        {item.actorUsername || "系统"} →{" "}
                        {item.targetUsername || "—"}
                      </span>
                    </div>
                    <div className="min-w-0 min-[1024px]:col-start-3">
                      <span className="mb-1 block text-[10px] text-muted-foreground min-[1024px]:hidden">
                        操作
                      </span>
                      <span
                        className="block truncate font-medium text-foreground"
                        title={item.action}
                      >
                        {auditActionLabel(item.action)}
                      </span>
                      {!action && (
                        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                          <code
                            className="min-w-0 truncate font-mono text-[10px] text-muted-foreground"
                            title={item.action}
                          >
                            {item.action}
                          </code>
                          <button
                            type="button"
                            className="aiflow-type-control inline-flex min-h-11 shrink-0 items-center px-2 text-aiflow-info hover:underline min-[1024px]:min-h-0 min-[1024px]:px-0"
                            onClick={() =>
                              void copyAuditActionCode(item.action)
                            }
                          >
                            复制原码
                          </button>
                        </div>
                      )}
                      <span className="mt-0.5 inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {auditCategoryLabel(category)}
                      </span>
                    </div>
                    <div className="min-w-0 min-[1024px]:col-start-4">
                      <span className="mb-1 block text-[10px] text-muted-foreground min-[1024px]:hidden">
                        资源
                      </span>
                      <span
                        className="block truncate text-muted-foreground"
                        title={item.resourceType || item.targetUsername || "—"}
                      >
                        {item.resourceType || item.targetUsername || "—"}
                      </span>
                      {item.resourceId && (
                        <code
                          className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground"
                          title={item.resourceId}
                        >
                          {item.resourceId}
                        </code>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "收起" : "查看"}授权审计事件：${auditActionLabel(item.action)}；${item.actorUsername || "系统"} → ${item.targetUsername || "—"}；记录 ${item.id}`}
                      className="aiflow-type-control col-span-2 h-11 justify-self-start px-3 text-aiflow-info min-[1024px]:col-span-1 min-[1024px]:col-start-6 min-[1024px]:h-10 min-[1024px]:px-2"
                      onClick={() =>
                        setExpandedAuditId(expanded ? null : String(item.id))
                      }
                    >
                      {expanded ? "收起事件" : "查看事件"}
                    </Button>
                  </div>
                  {expanded && (
                    <div
                      data-iam-audit-detail=""
                      className="border-t border-border bg-muted px-4 py-3"
                    >
                      <dl className="aiflow-type-meta grid gap-2 sm:grid-cols-3">
                        <div>
                          <dt className="text-muted-foreground">原始操作码</dt>
                          <dd className="aiflow-type-meta mt-0.5 break-all font-mono text-foreground">
                            {item.action}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">
                            资源类型 / ID
                          </dt>
                          <dd className="aiflow-type-body mt-0.5 break-words text-foreground">
                            {item.resourceType || "—"} ·{" "}
                            <code className="aiflow-type-meta break-all font-mono">
                              {item.resourceId || "—"}
                            </code>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">请求 ID</dt>
                          <dd className="aiflow-type-meta mt-0.5 break-all font-mono text-foreground">
                            {item.requestId || "—"}
                          </dd>
                        </div>
                      </dl>
                      <pre className="aiflow-type-code mt-3 whitespace-pre-wrap break-words rounded bg-card p-3 text-muted-foreground min-[1024px]:max-h-40 min-[1024px]:overflow-auto">
                        {auditDetailsText(item.detailsJson)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
            {!filteredAudit.length && (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {audit.length
                  ? "没有符合当前筛选条件的审计记录。"
                  : "暂未记录授权事件。"}
              </p>
            )}
          </div>
          {filteredAudit.length > auditPageSize && (
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 min-[1024px]:h-10"
                disabled={auditPage === 0}
                onClick={() => setAuditPage(page => Math.max(0, page - 1))}
              >
                上一页
              </Button>
              <span
                aria-live="polite"
                className="text-xs text-muted-foreground"
              >
                {auditPage + 1} / {auditPageCount} · 每页 {auditPageSize} 条
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 min-[1024px]:h-10"
                disabled={auditPage + 1 >= auditPageCount}
                onClick={() =>
                  setAuditPage(page => Math.min(auditPageCount - 1, page + 1))
                }
              >
                下一页
              </Button>
            </div>
          )}
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
        className={`flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border ${embedded ? "pb-3" : "px-4 py-3"}`}
      >
        <div className="min-w-0">
          <p className="font-semibold">用户权限详情</p>
          <p className="aiflow-type-body mt-0.5 text-muted-foreground">
            直接授权可在此维护，组织继承保持只读。
          </p>
        </div>
        <Button
          size="sm"
          className="aiflow-type-control h-11 shrink-0 bg-blue-600 text-white shadow-2xs hover:bg-blue-700 min-[1024px]:h-10"
          disabled={
            !details.data ||
            details.isLoading ||
            details.data.user.status !== "active"
          }
          onClick={onAssign}
        >
          <Plus size={13} />
          绑定角色
        </Button>
      </div>
      <div
        className={`${embedded ? "pt-4" : "max-h-[620px] overflow-y-auto p-4"} aiflow-type-body`}
      >
        {details.isLoading && (
          <p className="text-muted-foreground">正在读取角色与权限…</p>
        )}
        {details.error && (
          <p className="break-words text-aiflow-danger">
            {details.error.message}
          </p>
        )}
        {details.data && (
          <div className="space-y-4">
            <div>
              <p className="aiflow-type-body break-words font-semibold text-foreground">
                {details.data.user.name || details.data.user.username}
              </p>
              <p className="break-all font-mono text-muted-foreground">
                {details.data.user.username}
              </p>
            </div>
            {details.data.user.status !== "active" && (
              <p
                role="status"
                className="rounded-lg bg-aiflow-warning-surface p-3 text-aiflow-warning"
              >
                账号已停用，当前不能登录、办理流程或接受新授权。已有角色保留，重新启用后按授权有效期计算。
              </p>
            )}
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
              <p className="mb-2 font-semibold text-foreground">
                系统级有效权限（{details.data.effectivePermissions.length}）
              </p>
              <p className="mb-2 text-muted-foreground">
                仅列出系统范围内的有效权限。具体流程还需结合该业务的项目成员与流程成员授权。
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {details.data.effectivePermissions.map((permission: any) => (
                  <div
                    key={permission.code}
                    className="min-w-0 rounded-md bg-muted p-2"
                  >
                    <p className="break-all font-mono text-aiflow-info">
                      {permission.code}
                    </p>
                    <p className="mt-0.5 break-words text-muted-foreground">
                      {permission.name}
                    </p>
                  </div>
                ))}
                {!details.data.effectivePermissions.length && (
                  <p className="text-muted-foreground">无</p>
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
        className={`flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border ${embedded ? "pb-3" : "px-4 py-3"}`}
      >
        {!embedded && (
          <div className="min-w-0">
            <p className="aiflow-type-section-title font-semibold">
              角色权限与绑定用户
            </p>
            <p className="aiflow-type-body mt-0.5 text-muted-foreground">
              查看此角色的权限与绑定用户。
            </p>
          </div>
        )}
        <Button
          size="sm"
          className="aiflow-type-control h-11 min-h-11 shrink-0 bg-blue-600 text-white shadow-2xs hover:bg-blue-700 min-[1024px]:h-10 min-[1024px]:min-h-10"
          disabled={!details.data || details.isLoading || !assignable}
          onClick={onAssign}
        >
          <Plus size={13} />
          {assignable ? "绑定用户" : "流程内绑定"}
        </Button>
      </div>
      <div
        className={`${embedded ? "pt-4" : "max-h-[620px] overflow-y-auto p-4"} aiflow-type-body`}
      >
        {details.isLoading && (
          <p className="text-muted-foreground">正在读取角色绑定…</p>
        )}
        {details.error && (
          <p className="break-words text-aiflow-danger">
            {details.error.message}
          </p>
        )}
        {details.data && (
          <div className="space-y-5">
            <div>
              <p className="aiflow-type-section-title break-words font-semibold text-foreground">
                {details.data.role.name}
              </p>
              <p className="mt-1 break-all font-mono text-aiflow-info">
                {details.data.role.code}
              </p>
              <p className="mt-1 break-words leading-5 text-muted-foreground">
                {details.data.role.description || "未填写角色说明"}
              </p>
              {!assignable && (
                <p className="mt-2 rounded-md bg-aiflow-warning-surface px-3 py-2 leading-5 text-aiflow-warning">
                  流程范围角色需在对应流程的成员权限页绑定，避免跨流程误授权。
                </p>
              )}
            </div>
            <div>
              <p className="mb-2 font-semibold text-foreground">
                权限清单（{details.data.permissions.length}）
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {details.data.permissions.map((permission: any) => (
                  <div
                    key={permission.code}
                    className="min-w-0 rounded-md border border-border bg-muted p-2"
                  >
                    <p className="break-all font-mono text-aiflow-info">
                      {permission.code}
                    </p>
                    <p className="mt-0.5 break-words text-muted-foreground">
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
                <p className="mb-2 font-semibold text-foreground">绑定组织</p>
                <div className="flex flex-wrap gap-1.5">
                  {details.data.organizationUnits.map((unit: any) => (
                    <span
                      key={unit.id}
                      className="max-w-full break-words rounded-full bg-aiflow-special-surface px-2.5 py-1 text-aiflow-special"
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
      <p className="mb-2 font-semibold text-foreground">
        {title}（{roles.length}）
      </p>
      <div className="grid gap-1.5">
        {roles.map((role, index) => (
          <div
            key={`${role.roleId}-${role.assignmentId || role.unitId || index}`}
            className="min-w-0 rounded-md border border-border p-2"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-1">
              <p className="break-words font-medium text-foreground">
                {role.roleName}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <span className="rounded-full bg-aiflow-info-surface px-2 py-0.5 text-[10px] text-aiflow-info">
                  {source}
                </span>
                {onRevoke && role.assignmentId && (
                  <button
                    type="button"
                    className="aiflow-type-control min-h-11 rounded px-3 min-[1024px]:min-h-10 text-aiflow-danger hover:bg-aiflow-danger-surface disabled:opacity-50"
                    disabled={revoking}
                    onClick={() => onRevoke(role.assignmentId)}
                  >
                    撤销
                  </button>
                )}
              </div>
            </div>
            <p className="mt-0.5 break-all font-mono text-aiflow-info">
              {role.roleCode}
            </p>
            <p className="mt-1 break-words text-muted-foreground">
              {role.unitName
                ? `来源组织：${role.unitName}`
                : role.scopeType === "system"
                  ? "范围：系统全局"
                  : `范围：指定流程 ${role.scopeName || role.scopeId || ""}`}
            </p>
            <p className="mt-1 text-muted-foreground">
              {role.expiresAt
                ? `有效至 ${formatTime(role.expiresAt)}`
                : "长期有效"}
            </p>
            {role.note && (
              <p className="mt-1 break-words text-muted-foreground">
                授权备注：{role.note}
              </p>
            )}
          </div>
        ))}
        {!roles.length && <p className="text-muted-foreground">无</p>}
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
      <p className="mb-2 font-semibold text-foreground">
        {title}（{users.length}）
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {users.map((account, index) => (
          <div
            key={`${account.userId}-${account.assignmentId || account.unitId || index}`}
            className="min-w-0 rounded-md border border-border p-2"
          >
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words font-medium text-foreground">
                  {account.name || account.username}
                </p>
                <p className="break-all font-mono text-muted-foreground">
                  {account.username}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-aiflow-special-surface px-2 py-0.5 text-[10px] text-aiflow-special">
                {source}
              </span>
            </div>
            <p className="mt-1 break-words text-muted-foreground">
              {account.unitName
                ? `组织：${account.unitName}`
                : account.scopeType === "system"
                  ? "范围：系统全局"
                  : `范围：指定流程 ${account.scopeId || ""}`}
            </p>
            <p className="mt-1 text-muted-foreground">
              {account.expiresAt
                ? `有效至 ${formatTime(account.expiresAt)}`
                : "长期有效"}
            </p>
            {account.note && (
              <p className="mt-1 break-words text-muted-foreground">
                授权备注：{account.note}
              </p>
            )}
          </div>
        ))}
        {!users.length && <p className="text-muted-foreground">无</p>}
      </div>
    </div>
  );
}
