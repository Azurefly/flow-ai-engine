import type { WorkflowOperationTarget } from "@shared/workflow-creation-form";
import { authorizationQueryPolicy } from "@shared/authorization-query-policy";
import { useAccountQueryIsolation } from "@/_core/hooks/useAccountQueryIsolation";
import { useClientVersionUpdate } from "@/hooks/useClientVersionUpdate";
import { useContextReveal } from "@/hooks/useContextReveal";
import { AuthorizationDetailRefresh } from "@/components/AuthorizationDetailRefresh";
import { AccessRelationshipOverview, focusAccessGroup } from "@/components/AccessRelationshipOverview";
import { CanvasNameDialog } from "@/components/CanvasNameDialog";
import { getFlowProfile } from "@shared/flow-profile-contract";
import { canApplyDataflowConfigConversion } from "@shared/dataflow-config-conversion-guard";
import { shouldResetRunRoute } from "@shared/run-route-guard";
import { roleExpiryInput } from "@shared/role-expiry";
import { runDetailRefreshInterval } from "@shared/run-detail-refresh";
import { Button } from "@/components/ui/button";
import { SearchableMultiSelect } from "@/components/SearchableMultiSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProjectRecord } from "@/components/ProjectWorkspace";
import { CreationDialog } from "@/components/CreationDialog";
import { ResourceDraftSession, ResourceDraftRecoveryNotice, useResourceDraftState, useResourceDraftPending, useResourceDraftSummary } from "@/components/ResourceDraftSession";
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
import { shouldConfirmWorkflowNavigation } from "../../../shared/workflow-navigation";
import { createGuardedConsoleHistory, type GuardedConsoleHistory, type ConsoleHistoryEntry } from "@shared/guarded-console-history";
import { requestConsoleNavigation } from "@/lib/console-navigation-guard";
import { resolveSelectedWorkflow } from "../../../shared/workflow-selection";
import { workflowPublicationGate } from "@shared/workflow-publication";
import {
  canPublishWorkflowVersion,
  isWorkflowDraftDirty,
  matchesWorkflowDefinitionSnapshot,
  acknowledgeWorkflowUnpublish,
} from "../../../shared/workflow-publish";
import type { Definition } from "../../../server/workflow-service";
import { readWorkflowDraftBaseVersion, workflowDraftBaseVersion } from "../../../shared/workflow-draft-base";
import { workflowLoopDraftError } from "../../../shared/workflow-loop-policy-draft";
import { workflowNumberDraftError } from "@shared/workflow-number-draft";
import ErrorBoundary from "@/components/ErrorBoundary";
import WorkflowSubflowSnapshots from "@/components/WorkflowSubflowSnapshots";
import WorkflowAccessNotice from "@/components/WorkflowAccessNotice";
import { workflowViewState } from "@shared/workflow-view-access";
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
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

const SystemRoleAssignmentDialog = lazy(() => import("@/components/SystemRoleAssignmentDialog"));
const DataflowConfigConversionDialog = lazy(() => import("@/components/DataflowConfigConversionDialog"));
const WorkflowRoleBindingsDialog = lazy(
  () => import("@/components/WorkflowRoleBindingsDialog")
);
const CustomRoleDialog = lazy(() => import("@/components/CustomRoleDialog"));
const WorkspaceCommandDialog = lazy(() => import("@/components/WorkspaceCommandDialog"));
const WorkflowCreateDialog = lazy(() => import("@/components/WorkflowCreateDialog"));
const WorkflowArchiveDialog = lazy(() => import("@/components/WorkflowArchiveDialog"));
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
  canManageIdentity: boolean;
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

function requestedConsoleRoute(entry: ConsoleHistoryEntry): RequestedConsoleRoute {
  const editorReturn = entry.state.aiflowEditorReturn;
  return {
    route: parseConsoleRoute(entry.url),
    ...((["center", "workspace", "detail", "warehouse"] as readonly unknown[]).includes(editorReturn)
      ? { editorReturn: editorReturn as FlowEditorReturn }
      : {}),
  };
}

function readConsoleHistory(): ConsoleHistoryEntry {
  return { url: window.location.hash, state: window.history.state ?? {} };
}

function readConsoleRoute(): RequestedConsoleRoute {
  if (typeof window === "undefined")
    return { route: { section: "flows", view: "center" } };
  return requestedConsoleRoute(readConsoleHistory());
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
  const me = trpc.auth.me.useQuery(undefined, { refetchInterval: query => query.state.data ? 30_000 : false });
  const accountQueriesReady = useAccountQueryIsolation(me.data?.id ?? null);
  const general = trpc.config.publicGeneral.useQuery();
  const [credentials, setCredentials] = useState({
    username: "",
    password: "",
  });
  const login = trpc.auth.login.useMutation({
    onSuccess: user => {
      setCredentials({ username: "", password: "" });
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
  if (me.isLoading || !accountQueriesReady)
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
    <ResourceDraftSession key={me.data.id}>
    <FlowConsole
      key={me.data.id}
      user={me.data}
      general={publicGeneral}
      onLogout={() => logout.mutate()}
    />
    </ResourceDraftSession>
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
    <main data-aiflow-login="" className="relative grid min-h-screen place-items-center overflow-hidden bg-background p-5 text-foreground">
      <section data-login-introduction="" aria-label="平台介绍">
        <p className="aiflow-type-control font-semibold tracking-widest">FLOW AI ENGINE</p>
        <h2>让流程清晰，<br />让协作顺畅。</h2>
        <p className="aiflow-type-body">从业务状态到自动化编排，再到数据处理，在一个工作空间中完成设计、协作与运行。</p>
        <div data-login-flow-types="">
          <span>状态流程</span><span>控制流程</span><span>数据流程</span>
        </div>
        <div data-login-flow-illustration="" aria-hidden="true">
          <span>设计</span><i /><span>协作</span><i /><span>运行</span>
        </div>
      </section>
      <section data-login-card="" className="relative w-full max-w-md overflow-hidden border border-border bg-card shadow-sm">
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
  const [commandOpen, setCommandOpen] = useState(false);
  useEffect(() => {
    const openCommand = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k" || event.isComposing) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open]')) return;
      event.preventDefault();
      setCommandOpen(true);
    };
    window.addEventListener("keydown", openCommand);
    return () => window.removeEventListener("keydown", openCommand);
  }, []);
  const utils = trpc.useUtils();
  const [initialRoute] = useState(readConsoleRoute);
  const resourceDrafts = useResourceDraftSummary();
  const canManageIdentity = user.canManageIdentity;
  const systemRootView = user.role === "admin" ? "config" : "identity";
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
  const [businessStatus, setBusinessStatus] = useState<"active" | "archived">("active");
  const [projectSearch, setProjectSearch] = useState("");
  const [projectSearchValue, setProjectSearchValue] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setProjectSearchValue(projectSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [projectSearch]);
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
  const liveDraft = useRef<{ workflowId: string | null; name: string; definition: Definition | null }>({ workflowId: null, name: "", definition: null });
  const consoleAlive = useRef(true);
  useEffect(() => { consoleAlive.current = true; return () => { consoleAlive.current = false; }; }, []);
  const matchesLiveDraft = useCallback((id: string, definition: Definition) =>
    liveDraft.current.workflowId === id && matchesWorkflowDefinitionSnapshot(JSON.stringify(definition), liveDraft.current.definition), []);
  const persistedDraftSnapshot = useRef<{
    workflowId: string;
    name: string;
    definitionJson: string;
    definitionVersion: number;
  } | null>(null);
  const pendingUnpublish = useRef<{ id: string; expectedDefinitionVersion: number } | null>(null);
  const [, setDraftBaseRevision] = useState(0);
  const [draftConflict, setDraftConflict] = useState<{ id: string; message: string } | null>(null);
  const [reloadDraftPending, setReloadDraftPending] = useState(false);
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
  const [workflowOperation,setWorkflowOperation]=useResourceDraftState<WorkflowOperationTarget|null>("workflow-operations","context","target",null,false);
  const operationOpening=useRef(Boolean(workflowOperation));
  operationOpening.current=Boolean(workflowOperation);
  const openWorkflowOperation=(target:WorkflowOperationTarget)=>{
    if(operationOpening.current || resourceDrafts.pending)return;
    operationOpening.current=true;setWorkflowOperation(structuredClone(target));
  };
  const closeWorkflowOperation=()=>{operationOpening.current=false;setWorkflowOperation(null);};
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
  const unsavedWorkflowId = useRef<string | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<{ proceed: () => void } | null>(null);
  const consoleHistory = useRef<GuardedConsoleHistory | null>(null);
  if (!consoleHistory.current && typeof window !== "undefined") {
    consoleHistory.current = createGuardedConsoleHistory({
      read: readConsoleHistory,
      push: entry => window.history.pushState(entry.state, "", entry.url),
      replace: entry => window.history.replaceState(entry.state, "", entry.url),
      go: delta => window.history.go(delta),
    }, (entry, proceed) => {
      if (!requestConsoleNavigation(proceed)) return false;
      const next = requestedConsoleRoute(entry);
      if (shouldConfirmWorkflowNavigation(unsavedWorkflowId.current, next.route)) {
        setPendingNavigation({ proceed });
        return false;
      }
      return true;
    }, (entry, reason) => {
      setRequestedRoute(requestedConsoleRoute(entry));
      if (reason !== "traverse") window.scrollTo(0, 0);
    });
  }
  const discardUnsavedDraft = useCallback(() => {
    const persisted = persistedDraftSnapshot.current;
    if (persisted) {
      setDraftName(persisted.name);
      setDraftDefinition(JSON.parse(persisted.definitionJson) as Definition);
    }
    unsavedWorkflowId.current = null;
  }, []);
  const detailActive = section === "flows" && flowView === "detail";
  const identityActive =
    section === "system" && systemView === "identity" && canManageIdentity;
  const navigateRoute = useCallback(
    (
      route: ConsoleRoute,
      options?: { replace?: boolean; editorReturn?: FlowEditorReturn }
    ) => {
      return consoleHistory.current?.navigate(
        formatConsoleRoute(route),
        { aiflowEditorReturn: options?.editorReturn ?? null },
        options?.replace
      ) ?? false;
    },
    []
  );
  const navigateSection = useCallback(
    (next: ConsoleSection) => {
      const permitted = next !== "system" || canManageIdentity;
      const resolved = permitted ? next : "flows";
      navigateRoute(
        resolved === "flows"
          ? { section: "flows", view: "center" }
          : resolved === "runs"
            ? { section: "runs", view: "workbench" }
            : resolved === "warehouse"
              ? { section: "warehouse" }
              : { section: "system", view: systemRootView }
      );
    },
    [navigateRoute, canManageIdentity, systemRootView]
  );

  const openFlowEditor = useCallback(
    (workflowId: string, returnTo: FlowEditorReturn) => {
      const navigated = navigateRoute(
        { section: "flows", view: "editor", workflowId },
        { editorReturn: returnTo }
      );
      if (navigated) setSelectedWorkflowId(workflowId);
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
    const restoreConsoleRoute = () => {
      consoleHistory.current?.reconcile();
    };
    window.addEventListener("popstate", restoreConsoleRoute);
    window.addEventListener("hashchange", restoreConsoleRoute);
    return () => {
      window.removeEventListener("popstate", restoreConsoleRoute);
      window.removeEventListener("hashchange", restoreConsoleRoute);
    };
  }, []);

  const [flowSearch, setFlowSearch] = useState("");
  const [flowSearchValue, setFlowSearchValue] = useState("");
  const [flowPager, setFlowPager] = useState({ scope: "", page: 0 });
  useEffect(() => {
    const timer = setTimeout(() => setFlowSearchValue(flowSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [flowSearch]);
  const flowScope = `${selectedProject?.id ?? "all"}:${flowSearchValue}`;
  const flowPage = flowPager.scope === flowScope ? flowPager.page : 0;
  const workflows = trpc.workflow.page.useQuery({
    limit: 10, cursor: flowPage * 10,
    search: flowSearchValue || undefined,
    projectId: selectedProject?.id,
  }, { enabled: section === "flows" && flowView === "editor" && flowListOpen });
  const projects = trpc.project.page.useQuery({ limit: 50, search: projectSearchValue }, { enabled: projectPickerOpen });
  const routeProjectId =
    requestedRoute.route.section === "flows" &&
    requestedRoute.route.view === "workspace"
      ? requestedRoute.route.projectId
      : null;
  const workflowItems = (workflows.data?.items ?? []) as any[];
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
  const projectLookupId = routeProjectId ?? (routeWorkflowId ? selectedWorkflow?.projectId : null);
  const routeProjectQuery = trpc.project.get.useQuery(
    { projectId: projectLookupId ?? "00000000" },
    { enabled: Boolean(projectLookupId), retry: false }
  );
  const routeProjectUnresolved = Boolean(routeProjectId && !routeProjectQuery.isSuccess);
  const selectedId = selectedWorkflow?.id ?? null;
  liveDraft.current = { workflowId: effectiveWorkflowId, name: draftName, definition: draftDefinition };
  const accessInput = useMemo(
    () => ({ id: effectiveWorkflowId ?? "00000000" }),
    [effectiveWorkflowId]
  );
  const access = trpc.workflow.access.useQuery(accessInput,
    authorizationQueryPolicy(Boolean(effectiveWorkflowId && (editorActive || detailActive || (section === "runs" && runView === "monitor"))))
  );
  const workflowAccessState = workflowViewState({ workflowId: effectiveWorkflowId, accessWorkflowId: accessInput.id,
    status: access.status, exists: access.data?.exists, permissions: access.data?.permissions });
  const canViewWorkflow = workflowAccessState === "granted";
  const mountedMonitorWorkflowId = useRef<string | null>(null);
  if (canViewWorkflow && section === "runs" && runView === "monitor") mountedMonitorWorkflowId.current = effectiveWorkflowId;
  const workflowContentState = canViewWorkflow && !selectedWorkflow && selectedWorkflowQuery.isError ? "unavailable" : workflowAccessState;
  const selectedWorkflowDefinition = canViewWorkflow && selectedWorkflow
    ? (decodeJson(selectedWorkflow.definition) as Definition) : null;
  const detailInput = useMemo(
    () => ({ runId: selectedRunId ?? "00000000-0000-0000-0000-000000000000" }),
    [selectedRunId]
  );
  const runDetail = trpc.workflow.runDetail.useQuery(detailInput, {
    enabled: Boolean(
      canViewWorkflow && selectedRunId && selectedWorkflow && selectedWorkflow.flowType !== "data"
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
  const templates = trpc.workflow.templates.useQuery(undefined, {
    enabled: editorActive && canViewWorkflow,
    retry: false,
  });
  const subflows = trpc.workflow.subflows.useQuery(undefined, {
    enabled: editorActive && canViewWorkflow,
    retry: false,
  });
  const roles = trpc.iam.roles.useQuery(undefined, authorizationQueryPolicy(identityActive));
  const audit = trpc.iam.authorizationAudit.useQuery(
    { limit: 20 },
    { enabled: identityActive, retry: false }
  );

  useEffect(() => {
    const route = requestedRoute.route;
    const replaceWith = (safeRoute: ConsoleRoute) => {
      setRequestedRoute({ route: safeRoute });
      consoleHistory.current?.replaceSilently(formatConsoleRoute(safeRoute), { aiflowEditorReturn: null });
    };
    const canonicalize = () => {
      const canonical = formatConsoleRoute(route);
      if (window.location.hash !== canonical)
        consoleHistory.current?.replaceSilently(canonical, { aiflowEditorReturn: requestedRoute.editorReturn ?? null });
    };
    if (route.section === "system") {
      if (!canManageIdentity) {
        replaceWith({ section: "flows", view: "center" });
        return;
      }
      if (route.view === "config" && systemRootView === "identity") {
        replaceWith({ section: "system", view: "identity" });
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
      if (!selectedWorkflowFromList && selectedWorkflowQuery.isPending) return;
      const workflow = selectedWorkflow;
      if (!workflow || workflow.id !== route.workflowId) {
        replaceWith({ section: "runs", view: "workbench" });
        return;
      }
      setSelectedWorkflowId(workflow.id);
      if (projectLookupId && routeProjectQuery.isPending) return;
      setSelectedProject((routeProjectQuery.data as ProjectRecord | null | undefined) ?? null);
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
      if (routeProjectUnresolved) return;
      const project = routeProjectQuery.data as ProjectRecord | null | undefined;
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
      (projectLookupId && routeProjectQuery.isPending) ||
      (!selectedWorkflowFromList && selectedWorkflowQuery.isPending)
    )
      return;
    const workflow = selectedWorkflow;
    if (!workflow || workflow.id !== route.workflowId) {
      replaceWith({ section: "flows", view: "center" });
      return;
    }
    const project = (routeProjectQuery.data as ProjectRecord | null | undefined) ?? null;
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
    routeProjectQuery.data,
    routeProjectQuery.isPending,
    projectLookupId,
    requestedRoute,
    selectedWorkflow,
    selectedWorkflowFromList,
    selectedWorkflowQuery.isPending,
    canManageIdentity,
    systemRootView,
  ]);

  useEffect(() => {
    if (selectedWorkflow && persistedDraftSnapshot.current?.workflowId !== selectedWorkflow.id) {
      const definition = decodeJson(selectedWorkflow.definition) as Definition;
      setDraftName(selectedWorkflow.name);
      setDraftDefinition(definition);
      persistedDraftSnapshot.current = {
        workflowId: selectedWorkflow.id,
        name: selectedWorkflow.name,
        definitionJson: JSON.stringify(definition),
        definitionVersion: Number(selectedWorkflow.definitionVersion),
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
        queryErrorCode: runDetail.error?.data?.code,
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
    runDetail.error?.data?.code,
  ]);

  const routeRestoring = Boolean(
    (routeWorkflowId &&
      (!selectedWorkflowFromList && selectedWorkflowQuery.isPending)) ||
      (requestedRoute.route.section === "flows" &&
        requestedRoute.route.view === "workspace" &&
        routeProjectUnresolved) ||
      (requestedRoute.route.section === "flows" &&
        (requestedRoute.route.view === "detail" ||
          requestedRoute.route.view === "editor") &&
        Boolean(projectLookupId && routeProjectQuery.isPending))
  );

  const globalCreationAccess=trpc.workflow.operationAccess.useQuery({},authorizationQueryPolicy(true));
  const operationAccess=trpc.workflow.operationAccess.useQuery({workflowId:selectedId || "00000000"},authorizationQueryPolicy(Boolean(selectedId && requestedRoute.route.section==="flows" && requestedRoute.route.view==="editor")));
  const operationReady=operationAccess.isSuccess && !operationAccess.isError && !operationAccess.isFetching;
  const saveFlow = trpc.workflow.update.useMutation({
    onSuccess: (workflow: any, submitted) => {
      if (!consoleAlive.current) return;
      if (workflow) utils.workflow.get.setData({ id: submitted.id }, workflow);
      void utils.workflow.access.invalidate({ id: submitted.id });
      void utils.workflow.page.invalidate();
      void utils.workflow.get.invalidate();
      if (workflow && liveDraft.current.workflowId === submitted.id) {
        const definition = decodeJson(workflow.definition) as Definition;
        if ((liveDraft.current.name.trim() || "未命名流程") === submitted.name &&
          matchesWorkflowDefinitionSnapshot(JSON.stringify(submitted.definition), liveDraft.current.definition)) {
          setDraftDefinition(definition);
          setDraftName(workflow.name);
        }
        persistedDraftSnapshot.current = {
          workflowId: String(workflow.id ?? selectedId ?? ""),
          name: String(workflow.name ?? ""),
          definitionJson: JSON.stringify(definition),
          definitionVersion: Number(workflow.definitionVersion),
        };
      }
      toast.success("流程定义已保存。");
    },
    onError: (error, submitted) => {
      if (!consoleAlive.current) return;
      void utils.workflow.access.invalidate({ id: submitted.id });
      if (error.data?.code === "CONFLICT" && liveDraft.current.workflowId === submitted.id)
        setDraftConflict({ id: submitted.id, message: error.message });
      toast.error(error.message);
    },
  });
  const publishFlow = trpc.workflow.publish.useMutation({
    onSuccess: (workflow: any, submitted) => {
      if (!consoleAlive.current) return;
      if (workflow) utils.workflow.get.setData({ id: submitted.id }, workflow);
      void utils.workflow.access.invalidate({ id: submitted.id });
      void utils.workflow.page.invalidate();
      void utils.workflow.get.invalidate();
      if (workflow && liveDraft.current.workflowId === submitted.id) {
        const definition = decodeJson(workflow.definition) as Definition;
        if ((liveDraft.current.name.trim() || "未命名流程") === submitted.name &&
          matchesWorkflowDefinitionSnapshot(JSON.stringify(submitted.definition), liveDraft.current.definition)) {
          setDraftDefinition(definition);
          setDraftName(workflow.name);
        }
        persistedDraftSnapshot.current = { workflowId: workflow.id, name: workflow.name,
          definitionJson: JSON.stringify(definition), definitionVersion: Number(workflow.definitionVersion) };
      }
      toast.success("流程已发布。");
    },
    onError: (error, submitted) => {
      if (!consoleAlive.current) return;
      void utils.workflow.access.invalidate({ id: submitted.id });
      if (error.data?.code === "CONFLICT" && liveDraft.current.workflowId === submitted.id)
        setDraftConflict({ id: submitted.id, message: error.message });
      toast.error(error.message);
    },
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
  }, [draftDefinition, draftName, selectedId]);
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
  const refreshUserQueries = () => { void utils.iam.invalidate(); };
  const createUser = trpc.iam.createUser.useMutation({
    onSuccess: () => {
      setUserForm({
        username: "",
        name: "",
        password: "",
        email: "",
        role: "user",
      });
      refreshUserQueries();
      toast.success("内部账号已创建。");
    },
    onError: error => toast.error(error.message),
  });
  const updateUserStatus = trpc.iam.updateUserStatus.useMutation({
    onSuccess: () => {
      refreshUserQueries();
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
      refreshUserQueries();
      toast[result.failed ? "warning" : "success"](
        `批量创建完成：成功 ${result.created}，失败 ${result.failed}`
      );
    },
    onError: error => toast.error(error.message),
  });

  const workflowArchived = Boolean(selectedWorkflow?.archivedAt) || selectedWorkflow?.projectStatus === "archived";
  const canEdit = canViewWorkflow && !workflowArchived && Boolean(access.data?.permissions?.has("workflow:edit"));
  const clientUpdateAvailable = useClientVersionUpdate(Boolean(user.id));
  const canPublish = canViewWorkflow && !workflowArchived && Boolean(access.data?.permissions?.has("workflow:publish"));
  const canRun = canViewWorkflow && !workflowArchived && Boolean(access.data?.permissions?.has("workflow:run"));
  const canManageMembers = canViewWorkflow && Boolean(
    access.data?.permissions?.has("workflow:members:manage")
  );
  const isDraftDirty = isWorkflowDraftDirty(effectiveWorkflowId, persistedDraftSnapshot.current, draftName, draftDefinition);
  const draftBaseVersion = readWorkflowDraftBaseVersion(selectedId, persistedDraftSnapshot.current);
  const definitionChanged = isDraftDirty && (persistedDraftSnapshot.current?.name === draftName ||
    !matchesWorkflowDefinitionSnapshot(persistedDraftSnapshot.current?.definitionJson, draftDefinition));
  const publicationGate = workflowPublicationGate({
    workflowId: selectedId ?? "",
    baseVersion: persistedDraftSnapshot.current?.workflowId === selectedId ? persistedDraftSnapshot.current?.definitionVersion : null,
    publication: access.isSuccess ? access.data?.publication : null,
    definitionChanged,
  });
  const onUnpublished = (workflow: any, submitted: { id: string; expectedDefinitionVersion: number }) => {
    if (!consoleAlive.current || !workflow) return;
    const cached = utils.workflow.get.getData({ id: submitted.id }) as any;
    const alreadyNewer = persistedDraftSnapshot.current?.workflowId === submitted.id && Number(persistedDraftSnapshot.current?.definitionVersion) > Number(workflow.definitionVersion);
    const candidate = !alreadyNewer && cached?.id === submitted.id && Number(cached.definitionVersion) >= Number(workflow.definitionVersion) ? cached : workflow;
    if (liveDraft.current.workflowId === submitted.id) {
      const previous = persistedDraftSnapshot.current;
      const acknowledged = acknowledgeWorkflowUnpublish(previous, submitted,
        { ...candidate, definition: decodeJson(candidate.definition) });
      if (acknowledged) {
        persistedDraftSnapshot.current = acknowledged;
        if (acknowledged.definitionVersion !== previous?.definitionVersion) setDraftBaseRevision(value => value + 1);
      } else setDraftConflict({ id: submitted.id, message: "取消发布状态已确认，但编辑基准或流程内容已变化。本地修改已保留，请对照最新版本处理。" });
    }
    if (pendingUnpublish.current?.id === submitted.id && pendingUnpublish.current.expectedDefinitionVersion === submitted.expectedDefinitionVersion)
      pendingUnpublish.current = null;
    utils.workflow.get.setData({ id: submitted.id }, (current: any) => current && Number(current.definitionVersion) >= Number(workflow.definitionVersion) ? current : workflow);
    void utils.workflow.access.invalidate({ id: submitted.id });
  };
  useEffect(() => {
    const pending = pendingUnpublish.current;
    if (!pending || !selectedWorkflow || selectedWorkflow.id !== pending.id || liveDraft.current.workflowId !== pending.id) return;
    const previous = persistedDraftSnapshot.current;
    const acknowledged = acknowledgeWorkflowUnpublish(previous, pending,
      { ...selectedWorkflow, definition: decodeJson(selectedWorkflow.definition) });
    if (acknowledged) {
      persistedDraftSnapshot.current = acknowledged;
      pendingUnpublish.current = null;
      if (acknowledged.definitionVersion !== previous?.definitionVersion) setDraftBaseRevision(value => value + 1);
    }
  }, [selectedWorkflow]);

  const draftError = useMemo(() => workflowLoopDraftError(draftDefinition) || workflowNumberDraftError(draftDefinition), [draftDefinition]);
  unsavedWorkflowId.current = editorActive && isDraftDirty ? persistedDraftSnapshot.current?.workflowId ?? null : null;
  useEffect(() => {
    if (!editorActive || !isDraftDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [editorActive, isDraftDirty]);

  const saveCurrent = useCallback(() => {
    if (!selectedId || !draftDefinition || !isDraftDirty) return;
    if (draftError) { toast.error(draftError); return; }
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
      expectedDefinitionVersion: workflowDraftBaseVersion(selectedId, persistedDraftSnapshot.current),
    });
  }, [
    draftDefinition,
    draftName,
    isDraftDirty,
    draftError,
    saveFlow,
    selectedId,
    selectedWorkflow?.status,
  ]);
  const saveDraftBeforeRun = useCallback(async () => {
    if (!selectedId || !draftDefinition)
      throw new Error("流程定义尚未就绪，无法保存运行版本。");
    if (draftError) throw new Error(draftError);
    if (selectedWorkflow?.status === "published")
      throw new Error("已发布流程不能保存为草稿运行版本。");
    if (!isDraftDirty) return;
    await saveFlow.mutateAsync({
      id: selectedId,
      name: draftName.trim() || "未命名流程",
      definition: draftDefinition,
      expectedDefinitionVersion: workflowDraftBaseVersion(selectedId, persistedDraftSnapshot.current),
    });
  }, [
    draftDefinition,
    draftName,
    isDraftDirty,
    draftError,
    saveFlow,
    selectedId,
    selectedWorkflow?.status,
  ]);

  const exportCurrent = () => {
    if (!canViewWorkflow) { toast.error("请先恢复当前流程的查看权限。"); return; }
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

  const reloadLatestDraft = async () => {
    if (!canViewWorkflow) { toast.error("请先恢复当前流程的查看权限。"); return; }
    const id = draftConflict?.id;
    if (!id || reloadDraftPending) return;
    setReloadDraftPending(true);
    try {
      const workflow = await utils.workflow.get.fetch({ id }, { staleTime: 0 }) as any;
      if (!workflow || liveDraft.current.workflowId !== id) throw new Error("流程已切换或不可访问，当前修改已保留。");
      const definition = decodeJson(workflow.definition) as Definition;
      persistedDraftSnapshot.current = { workflowId: id, name: workflow.name, definitionJson: JSON.stringify(definition), definitionVersion: Number(workflow.definitionVersion) };
      setDraftName(workflow.name);
      setDraftDefinition(definition);
      setDraftConflict(null);
      toast.success("已读取最新流程版本。");
    } catch (error) { toast.error(error instanceof Error ? error.message : "读取失败，当前修改已保留。"); }
    finally { setReloadDraftPending(false); }
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
    ...(canManageIdentity
      ? [{ id: "system" as const, label: "系统配置", icon: SlidersHorizontal }]
      : []),
  ];

  const workspaceWorkflows = selectedProject
    ? workflowItems.filter(
        workflow => workflow.projectId === selectedProject.id
      )
    : workflowItems;
  const workspaceReveal = useContextReveal<HTMLElement>(editorActive ? null : formatConsoleRoute(requestedRoute.route), false);
  const workflowAccessNotice = <WorkflowAccessNotice state={workflowContentState} workflowId={effectiveWorkflowId}
    retainedDraft={Boolean(isDraftDirty && persistedDraftSnapshot.current?.workflowId === effectiveWorkflowId)} refreshing={access.isFetching}
    onRetry={() => void (async () => {
      const latest = await access.refetch();
      if (consoleAlive.current && !latest.isError && latest.data?.exists && latest.data.permissions.has("workflow:view"))
        await selectedWorkflowQuery.refetch();
    })()}
    onBack={() => navigateRoute({ section: "flows", view: "center" })} />;

  return (
    <main
      data-aiflow-console=""
      data-editor-active={editorActive}
      className="aiflow-console relative min-h-screen bg-background text-foreground"
    >
      {commandOpen && <Suspense fallback={<p role="status" className="fixed right-4 top-20 z-50 rounded-xl border bg-card p-4">正在打开快捷查找…</p>}>
        <WorkspaceCommandDialog canManageIdentity={canManageIdentity} isAdmin={user.role === "admin"} onClose={() => setCommandOpen(false)} onNavigate={navigateRoute} />
      </Suspense>}
      <Dialog open={Boolean(draftConflict) && canViewWorkflow} onOpenChange={open => { if (!open && !reloadDraftPending) setDraftConflict(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>流程已被更新，当前修改已保留</DialogTitle>
            <DialogDescription>{draftConflict?.message} 可以先导出当前修改，再读取最新版本进行合并。读取最新版本会替换当前画布。</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" disabled={reloadDraftPending} onClick={exportCurrent}>导出我的修改</Button>
            <Button variant="outline" autoFocus disabled={reloadDraftPending} onClick={() => setDraftConflict(null)}>保留并继续编辑</Button>
            <Button disabled={reloadDraftPending} onClick={() => void reloadLatestDraft()}>{reloadDraftPending ? "正在读取…" : "读取最新版本并替换画布"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(pendingNavigation)} onOpenChange={open => { if (!open) setPendingNavigation(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>离开前保留流程修改</DialogTitle>
            <DialogDescription>当前流程有未保存的修改。继续编辑后可保存画布；丢弃修改会恢复最后保存的版本。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" autoFocus onClick={() => setPendingNavigation(null)}>继续编辑</Button>
            <Button variant="destructive" onClick={() => {
              if (!pendingNavigation) return;
              const target = pendingNavigation;
              discardUnsavedDraft();
              setPendingNavigation(null);
              target.proceed();
            }}>丢弃修改并离开</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <a className="aiflow-skip-link" href="#aiflow-console-panel" onClick={event => {
        event.preventDefault();
        document.getElementById("aiflow-console-panel")?.focus();
      }}>
        跳到主要工作区
      </a>
      {clientUpdateAvailable && (
        <aside role="status" className="fixed bottom-4 left-4 right-4 z-40 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-aiflow-info-border bg-card p-4 text-sm shadow-lg sm:left-auto sm:max-w-lg">
          <div>
            <p className="font-semibold">工作台已有新版本</p>
            <p className="mt-1 text-muted-foreground">{isDraftDirty ? "当前流程有未保存修改，请先保存或丢弃修改再刷新。" : "请先提交正在填写的表单，再刷新以使用最新功能。"}</p>
          </div>
          <Button variant="outline" disabled={isDraftDirty} onClick={() => window.location.reload()}>刷新工作台</Button>
        </aside>
      )}
      <header className="sticky top-0 z-30 border-b border-border/80 bg-card text-foreground shadow-2xs">
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
          {editorActive && canViewWorkflow && (
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
            onKeyDown={event => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
              buttons[next]?.focus();
            }}
          >
            <span data-workspace-nav-caption="" aria-hidden="true">工作空间</span>
            {nav.map(item => (
              <button
                id={`aiflow-console-tab-${item.id}`}
                role="tab"
                aria-label={item.label}
                title={editorActive ? item.label : undefined}
                aria-selected={section === item.id}
                tabIndex={section === item.id ? 0 : -1}
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
                <span data-workspace-nav-label="">{item.label}</span>
              </button>
            ))}
          </div>
          <div data-workspace-context="" className="hidden min-w-0 items-center gap-2 text-sm text-muted-foreground xl:flex">
            <span>{nav.find(item => item.id === section)?.label}</span>
            <ChevronRight size={14} aria-hidden="true" />
            <span className="truncate font-medium text-foreground">{section === "flows" ? (flowView === "editor" ? (canViewWorkflow ? selectedWorkflow?.name : null) || "流程设计器" : flowView === "workspace" ? selectedProject?.name || "业务工作区" : flowView === "detail" ? (canViewWorkflow ? selectedWorkflow?.name : null) || "流程详情" : "业务中心") : section === "system" ? (systemView === "identity" ? "人员与权限" : systemView === "organization" ? "组织管理" : "通用与业务配置") : section === "runs" ? "办理与运行" : "浏览与复用"}</span>
          </div>
          <Button data-workspace-search-trigger="" type="button" variant="outline" className="ml-auto h-10 min-w-10 gap-2 px-2 text-muted-foreground sm:px-3" onClick={() => setCommandOpen(true)} aria-label="快捷查找业务、流程或页面" aria-keyshortcuts="Control+k Meta+k">
            <Search size={16} /><span className="hidden lg:inline">快捷查找</span><kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 text-xs lg:inline">Ctrl K</kbd>
          </Button>
          <div
            data-aiflow-user-actions=""
            className="flex h-full items-center gap-1 px-2 text-xs min-[400px]:gap-2.5 min-[400px]:px-3.5"
          >
            <span data-workspace-account-name="" title={user.name || user.username || "内部用户"} className="hidden text-muted-foreground lg:inline">
              {user.name || user.username || "内部用户"}
            </span>
            <span data-workspace-account-role="" className="shrink-0 whitespace-nowrap rounded-full border border-border/80 bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground min-[400px]:px-2.5">
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
              onClick={() => {
                const proceed = () => {
                  if (unsavedWorkflowId.current) setPendingNavigation({ proceed: onLogout });
                  else onLogout();
                };
                if (requestConsoleNavigation(proceed)) proceed();
              }}
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
          {editorActive && canViewWorkflow && (
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
      <div data-workspace-body="" className="flex min-h-[calc(100vh-56px)] flex-col md:flex-row">
        {section === "flows" && flowView === "editor" && canViewWorkflow && (
          <aside
            id="aiflow-workflow-library"
            data-aiflow-workflow-library=""
            aria-hidden={!flowListOpen}
            inert={!flowListOpen}
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
                  {globalCreationAccess.isSuccess && !globalCreationAccess.isError && globalCreationAccess.data.canCreate && <Button size="icon" variant="ghost" aria-label="新建流程" disabled={Boolean(resourceDrafts.pending) || globalCreationAccess.isFetching} onClick={()=>openWorkflowOperation({kind:"global"})}><Plus size={17}/></Button>}
                </div>
              </div>
              <Input className="mt-3" aria-label="搜索流程名称或编号" placeholder="搜索流程名称或编号" value={flowSearch} onChange={event => setFlowSearch(event.target.value.slice(0, 100))} />
            </div>
            <div className="max-h-[calc(100vh-196px)] overflow-y-auto p-2">
              {workflows.isFetching && (
                <div className="p-4 text-sm text-muted-foreground">
                  正在读取项目流程…
                </div>
              )}
              {workflows.isError && <div role="alert" className="p-3 text-sm text-destructive">流程读取失败。<Button variant="outline" size="sm" onClick={() => void workflows.refetch()}>重试</Button></div>}
              {workflows.isSuccess && !workspaceWorkflows.length && <p className="p-3 text-sm text-muted-foreground">没有匹配的流程。</p>}
              {workflows.isSuccess && !workflows.isFetching && workspaceWorkflows.map(workflow => {
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
              <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
                <Button variant="outline" size="sm" disabled={flowPage === 0 || workflows.isFetching || flowSearch.trim() !== flowSearchValue} onClick={() => setFlowPager({ scope: flowScope, page: flowPage - 1 })}>上一页</Button>
                <span>第{flowPage + 1}页 · 每页10条</span>
                <Button variant="outline" size="sm" disabled={!workflows.data?.hasMore || workflows.isFetching || flowSearch.trim() !== flowSearchValue} onClick={() => setFlowPager({ scope: flowScope, page: flowPage + 1 })}>下一页</Button>
              </div>
            </div>
          </aside>
        )}
        <section
          id="aiflow-console-panel"
          ref={workspaceReveal}
          tabIndex={-1}
          role="tabpanel"
          aria-labelledby={`aiflow-console-tab-${section}`}
          className="min-w-0 w-full flex-1"
        >
          {routeRestoring && (
            <div
              data-aiflow-route-restoring
              role={routeProjectQuery.isError ? "alert" : "status"}
              aria-live="polite"
              className="grid min-h-[calc(100vh-56px)] place-items-center p-8 text-sm text-muted-foreground"
            >
              <div className="grid max-w-xl gap-4">
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
                {routeProjectQuery.isError && !routeProjectQuery.isFetching
                  ? <X className="text-aiflow-danger" size={16} aria-hidden="true" />
                  : <Loader2 className="animate-spin text-aiflow-info" size={16} />}
                {routeProjectUnresolved && routeProjectQuery.isError ? (
                  <>
                    <span>目标业务读取失败，请重试。</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={routeProjectQuery.isFetching}
                      onClick={() => void routeProjectQuery.refetch()}
                    >
                      重试读取业务
                    </Button>
                  </>
                ) : (
                  "正在恢复受权页面…"
                )}
              </div>
              <ResourceDraftRecoveryNotice />
              </div>
            </div>
          )}
          {section === "flows" &&
            flowView === "center" &&
            !routeRestoring &&
            (
                <><ResourceDraftRecoveryNotice onRetry={()=>void (async()=>{const account=await utils.auth.me.fetch();if(account?.canManageIdentity&&(resourceDrafts.systemAuthorization||resourceDrafts.organization)){const route:ConsoleRoute={section:"system",view:resourceDrafts.organization?"organization":"identity"};setRequestedRoute({route});consoleHistory.current?.replaceSilently(formatConsoleRoute(route),{aiflowEditorReturn:null});}})()}/>                <BusinessCenter
                  status={businessStatus} onStatusChange={setBusinessStatus}
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
                /></>
            )}
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
                          className="aiflow-type-control h-11 min-h-11 min-w-0 w-full max-w-[560px] flex-1 shrink justify-between gap-2 px-2 text-sm font-medium lg:w-auto lg:flex-initial min-[1280px]:h-8 min-[1280px]:min-h-8"
                          aria-label="切换当前受权业务"
                          aria-expanded={projectPickerOpen}
                        >
                          <span className="min-w-0 flex-1 truncate text-left">
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
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="搜索业务名称或代号…"
                            aria-label="搜索有权限的业务项目"
                            value={projectSearch}
                            onValueChange={setProjectSearch}
                          />
                          <CommandList className="max-h-[min(360px,60vh)]">
                            {projects.isFetching || projectSearch.trim() !== projectSearchValue ? (
                              <p role="status" className="p-3 text-sm text-muted-foreground">正在搜索业务项目…</p>
                            ) : projects.isError ? (
                              <div role="alert" className="p-3 text-sm text-aiflow-danger">搜索失败，请重试。<Button variant="outline" onClick={() => void projects.refetch()}>重试</Button></div>
                            ) : <CommandEmpty>没有匹配的业务项目</CommandEmpty>}
                            <CommandGroup>
                              {(!projects.isFetching && projectSearch.trim() === projectSearchValue ? (projects.data?.items ?? []) as ProjectRecord[] : []).map(
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
                          {projects.data?.hasMore && <p className="border-t p-3 text-sm text-muted-foreground">显示前 50 个匹配项目；输入名称或代号以缩小范围。</p>}
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <span className="aiflow-type-meta text-muted-foreground lg:text-right">
                    仅显示当前账号具备查看权限的业务项目
                  </span>
                </div>
                <ProjectWorkspace
                  onCreateWorkflow={project=>openWorkflowOperation({kind:"project",projectId:project.id,projectName:project.name})}
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
          {section === "flows" && !routeRestoring && (flowView === "detail" || flowView === "editor") && workflowContentState !== "granted" && workflowAccessNotice}
          {section === "flows" && !routeRestoring && flowView === "detail" && workflowContentState === "granted" && (
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
            workflowContentState === "granted" &&
            selectedWorkflow && draftDefinition &&
            (!access.data || draftBaseVersion === null ? (
              <div
                className="m-4 rounded-lg border border-border bg-card p-5"
                role={access.isError ? "alert" : "status"}
                aria-live="polite"
              >
                <p className="aiflow-type-body text-muted-foreground">
                  {access.isError
                    ? `读取流程权限失败：${access.error.message}`
                    : draftBaseVersion === null && access.data ? "正在准备流程草稿…" : "正在读取流程权限…"}
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
                draftError={draftError}
                definition={draftDefinition}
                name={draftName}
                setName={setDraftName}
                canEdit={canEdit}
                canPublish={canPublish}
                canRun={canRun}
                hasUnpublishedChanges={isDraftDirty}
                draftBaseVersion={draftBaseVersion}
                publicationGate={publicationGate}
                publicationRefreshing={access.isFetching}
                onRefreshPublication={() => void access.refetch()}
                onResolvePublicationVersion={() => { if (selectedId) setDraftConflict({ id: selectedId, message: publicationGate.reason ?? "流程版本已变化，请保留修改后重新核对。" }); }}
                onUnpublished={onUnpublished}
                onUnpublishRequested={submitted => { pendingUnpublish.current = submitted; }}

                canManage={canManageMembers}
                canCopy={operationReady && operationAccess.data?.canCopy === true}
                canArchive={operationReady && operationAccess.data?.canArchive === true}
                operationPending={Boolean(resourceDrafts.pending)}
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
                onRefreshSubflows={async () => {
                  if (!selectedId || !draftDefinition || !canEdit || !consoleAlive.current) throw new Error("当前流程不可编辑。");
                  if (selectedWorkflow?.status === "published") throw new Error("请先取消发布，再更新草稿快照。");
                  if (draftError) throw new Error(draftError);
                  await saveFlow.mutateAsync({ id: selectedId, name: draftName.trim() || "未命名流程", definition: draftDefinition,
                    expectedDefinitionVersion: workflowDraftBaseVersion(selectedId, persistedDraftSnapshot.current) });
                }}
                onResolveSubflowSave={() => { if (selectedId) setDraftConflict({ id: selectedId, message: "子流程快照保存结果尚未确认。请先导出当前修改，再核对已保存版本；读取最新版本会替换本页画布。" }); }}
                onSaveDraftBeforeRun={saveDraftBeforeRun}
                onValidate={() => {
                  if (!selectedId || !draftDefinition) return;
                  setCompileDiagnostics([]);
                  setCompileCheck({ status: "checking" });
                  compileFlow.mutate(
                    { id: selectedId, definition: draftDefinition },
                    {
                      onSuccess: result => {
                        if (!matchesLiveDraft(selectedId, draftDefinition)) return;
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
                      onError: error => {
                        if (!matchesLiveDraft(selectedId, draftDefinition)) return;
                        setCompileCheck({
                          status: "failed",
                          checkedAt: Date.now(),
                          message: `预检请求失败：${error.message}`,
                        });
                      },
                    }
                  );
                }}
                onPublish={() => {
                  if (!selectedId || !draftDefinition) return;
                  if (!canPublish) { toast.error("当前账号没有流程发布权限。"); return; }
                  if (!publicationGate.allowed) { toast.error(publicationGate.reason); return; }

                  if (draftError) { toast.error(draftError); return; }
                  const expectedDefinitionVersion = workflowDraftBaseVersion(selectedId, persistedDraftSnapshot.current);
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
                        if (!matchesLiveDraft(selectedId, draftDefinition) || liveDraft.current.name !== draftName) {
                          toast.info("流程已变化，请对当前内容重新检查并发布。");
                          return;
                        }
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
                            expectedDefinitionVersion,
                          },
                        );
                      },
                      onError: error => {
                        if (!matchesLiveDraft(selectedId, draftDefinition)) return;
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
                onDuplicate={()=>{if(operationReady && operationAccess.data.canCopy && operationAccess.data.source) openWorkflowOperation({kind:"copy",source:operationAccess.data.source});}}
                onDelete={()=>{if(operationReady && operationAccess.data.canArchive && operationAccess.data.source) openWorkflowOperation({kind:"archive",source:operationAccess.data.source,unsavedChanges:isDraftDirty});}}
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
              ) : workflowContentState !== "granted" && mountedMonitorWorkflowId.current !== effectiveWorkflowId ? workflowAccessNotice : (
                <RuntimeMonitor
                  viewAllowed={workflowContentState === "granted"}
                  blockedContent={workflowAccessNotice}
                  projectId={selectedWorkflow?.projectId}
                  workflowId={effectiveWorkflowId}
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
            canManageIdentity &&
            systemView === "organization" && (
              <OrganizationManagementPage
                onBack={() =>
                  navigateRoute({ section: "system", view: systemRootView })
                }
              />
            )}
          {section === "system" &&
            canManageIdentity &&
            systemView === "identity" && (
              <div data-aiflow-identity-page="" className="aiflow-page-frame bg-background">
                <div className="aiflow-page-content">
                  <button
                    className="aiflow-type-control aiflow-action-target mb-4 inline-flex items-center rounded px-3 text-aiflow-info hover:bg-accent hover:underline"
                    onClick={() =>
                      navigateRoute(user.role === "admin" ? { section: "system", view: "config" } : { section: "flows", view: "center" })
                    }
                  >
                    ← {user.role === "admin" ? "返回系统配置" : "返回工作区"}
                  </button>
                  <Button className="ml-2 mb-4 min-h-11" variant="outline" onClick={() => navigateRoute({ section: "system", view: "organization" })}>组织架构</Button>
                  {roles.isError ? <section role="alert" className="grid gap-3 rounded-xl border border-border bg-card p-4"><p>身份目录暂不可用，已隐藏缓存。请重新读取当前权限与目录。</p><ResourceDraftRecoveryNotice/><Button variant="outline" onClick={()=>void Promise.allSettled([roles.refetch(),utils.auth.me.invalidate()])}>重新读取权限与目录</Button></section> : (
                  <IamCenter
                    currentUserId={user.id}
                    changingStatus={updateUserStatus.isPending}
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
                    onToggleStatus={(id, status, version) =>
                      updateUserStatus.mutateAsync({
                        userId: id,
                        status: status === "active" ? "disabled" : "active",
                        expectedStatus: status, expectedVersion: version,
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
                  )}
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
      {workflowOperation && <Suspense fallback={<div role="status" className="fixed inset-0 z-50 grid place-items-center bg-background/90">正在读取流程操作窗口…</div>}>
        {workflowOperation.kind==="archive" ? <WorkflowArchiveDialog target={workflowOperation} onTargetChange={setWorkflowOperation} onClose={closeWorkflowOperation} onArchived={id=>{
          if(!consoleAlive.current)return;
          void Promise.allSettled([utils.workflow.page.invalidate(),utils.workflow.get.invalidate(),utils.workflow.operationAccess.invalidate(),utils.project.invalidate()]);
          if(liveDraft.current.workflowId===id){setSelectedWorkflowId(null);setDraftDefinition(null);returnFromFlowEditor();}
          toast.success("流程已归档，可在流程仓库恢复。");
        }}/> : <WorkflowCreateDialog target={workflowOperation} onTargetChange={setWorkflowOperation} onClose={closeWorkflowOperation} onCreated={workflow=>{
          if(!consoleAlive.current)return;
          void Promise.allSettled([utils.workflow.page.invalidate(),utils.workflow.get.invalidate(),utils.project.invalidate()]);
          toast.success("流程草稿已创建。");
          if(workflow?.id)openFlowEditor(workflow.id,workflow.projectId ? "workspace" : "center");
        }}/>}
      </Suspense>}
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
  draftError,
  definition,
  name,
  setName,
  canEdit,
  canPublish,
  canRun,
  hasUnpublishedChanges,
  draftBaseVersion,
  publicationGate,
  publicationRefreshing,
  onRefreshPublication,
  onResolvePublicationVersion,
  onUnpublished,
  onUnpublishRequested,
  canManage,
  canCopy,
  canArchive,
  operationPending,
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
  onRefreshSubflows,
  onResolveSubflowSave,
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
}: {
  workflow: any;
  draftError: string | null;
  definition: Definition | null;
  name: string;
  setName: (value: string) => void;
  canEdit: boolean;
  canPublish: boolean;
  canRun: boolean;
  hasUnpublishedChanges: boolean;
  draftBaseVersion: number;
  publicationGate: ReturnType<typeof workflowPublicationGate>;
  publicationRefreshing: boolean;
  onRefreshPublication: () => void;
  onResolvePublicationVersion: () => void;
  onUnpublished: (workflow: any, submitted: { id: string; expectedDefinitionVersion: number }) => void;
  onUnpublishRequested: (submitted: { id: string; expectedDefinitionVersion: number }) => void;
  canManage: boolean;
  canCopy: boolean;
  canArchive: boolean;
  operationPending: boolean;
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
  onRefreshSubflows: () => Promise<void>;
  onResolveSubflowSave: () => void;
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

}) {
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
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const [governanceDialogOpen, setGovernanceDialogOpen] = useState(false);
  const [subflowDialogOpen, setSubflowDialogOpen] = useState(false);
  const [conversionTarget, setConversionTarget] = useState<{
    id: string;
    name: string;
    version: number;
    definition: Definition;
  } | null>(null);
  const [conversionUndo, setConversionUndo] = useState<{
    id: string;
    before: Definition;
    after: Definition;
  } | null>(null);
  useEffect(() => {
    setConversionTarget(null);
    setConversionUndo(null);
  }, [workflow?.id, workflow?.definitionVersion]);
  const [unpublishTarget, setUnpublishTarget] = useState<{ id: string; name: string; definitionVersion: number } | null>(null);
  const [unpublishError, setUnpublishError] = useState("");
  const [unpublishChecking, setUnpublishChecking] = useState(false);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const unpublishOrigin = useRef<{ workflowId: string; element: HTMLElement | null } | null>(null);
  const unpublishCheckLock = useRef(false);
  const unpublishWorkflowId = useRef(workflow.id);
  unpublishWorkflowId.current = workflow.id;
  useEffect(() => { setUnpublishTarget(null); setUnpublishError(""); }, [workflow.id]);
  useEffect(() => setSubflowDialogOpen(false), [workflow.id]);
  const utils = trpc.useUtils();
  const unpublishFlow = trpc.workflow.unpublish.useMutation({
    onSuccess: (result, submitted) => {
      onUnpublished(result, submitted);
      void utils.workflow.page.invalidate();
      void utils.workflow.get.invalidate({ id: submitted.id });
      if (unpublishWorkflowId.current === submitted.id) {
        setUnpublishTarget(null);
        setUnpublishError("");
      }
      toast.success("流程已取消发布；当前编辑内容、历史版本与运行审计已保留。");
    },
    onError: (error, submitted) => {
      void utils.workflow.get.invalidate({ id: submitted.id });
      void utils.workflow.access.invalidate({ id: submitted.id });
      if (unpublishWorkflowId.current === submitted.id) setUnpublishError(error.message);
    },
  });
  const unpublishBusy = unpublishFlow.isPending || unpublishChecking;
  const onUnpublish = () => {
    if (!canPublish || workflow.status !== "published" || unpublishBusy) return;
    setUnpublishError("");
    unpublishOrigin.current = { workflowId: workflow.id, element: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    setUnpublishTarget({ id: workflow.id, name: workflow.name, definitionVersion: Number(workflow.definitionVersion) });
  };
  const reconcileUnpublish = async () => {
    const target = unpublishTarget;
    if (!target || unpublishFlow.isPending || unpublishCheckLock.current) return;
    unpublishCheckLock.current = true;
    setUnpublishChecking(true);
    try {
      const latest = await utils.workflow.get.fetch({ id: target.id }, { staleTime: 0 }) as any;
      if (unpublishWorkflowId.current !== target.id) return;
      if (!latest || latest.id !== target.id) throw new Error("当前流程不可访问，原编辑内容仍保留。");
      if (latest.archivedAt || latest.projectStatus === "archived") throw new Error("流程或业务已归档，原编辑内容仍保留。");
      if (latest.status === "draft") {
        onUnpublished(latest, { id: target.id, expectedDefinitionVersion: target.definitionVersion });
        setUnpublishTarget(null);
        setUnpublishError("");
        toast.success("已确认取消发布，当前编辑内容已保留。无需再次取消发布。");
      } else if (latest.status === "published") {
        setUnpublishTarget({ id: latest.id, name: latest.name, definitionVersion: Number(latest.definitionVersion) });
        setUnpublishError(`当前仍为已发布 v${latest.definitionVersion}，请复核后再次确认取消发布。`);
        void utils.workflow.access.invalidate({ id: target.id });
      } else throw new Error("当前流程状态无法确认，原编辑内容仍保留。");
    } catch (error) {
      if (unpublishWorkflowId.current === target.id) setUnpublishError(error instanceof Error ? error.message : "核对失败，原编辑内容仍保留。");
    } finally {
      unpublishCheckLock.current = false;
      setUnpublishChecking(false);
    }
  };

  // Keep the shortcut callback in sync with the committed editor UI so that a
  // rapid edit followed by Ctrl/Cmd+S cannot invoke the previous draft callback.
  useLayoutEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!unpublishTarget && !unpublishBusy && canEdit && !savePending && workflow?.status !== "published") {
          onSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, savePending, workflow?.status, onSave, unpublishTarget, unpublishBusy]);
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
  const firstLocatableDiagnostic = compileDiagnostics.find(item => item.location.nodeId || item.location.edgeId);
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
          <Button ref={saveButtonRef}
            type="button"
            variant="outline"
            size="sm"
            className="h-11 min-h-11 gap-1.5 px-2.5 text-xs text-foreground hover:bg-muted border-border shadow-2xs min-[1024px]:h-9 min-[1024px]:min-h-0"
            onClick={onSave}
            disabled={
              !canEdit ||
              !hasUnpublishedChanges ||
              Boolean(draftError) ||
              savePending ||
              workflow.status === "published"
            }
            title={
              draftError || (workflow.status === "published"
                ? "修改后使用“发布新版本”；需要保存草稿时，请先取消发布"
                : hasUnpublishedChanges
                  ? "保存当前画布草稿 (Ctrl+S / ⌘S)"
                  : "没有未保存修改")
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
              !publicationGate.allowed ||
              !publishVersionAllowed ||
              Boolean(draftError) ||
              publishPending ||
              compilePending
            }
            title={
              draftError || (!canPublish
                ? "当前账号没有发布权限"
                : !publicationGate.allowed ? publicationGate.reason ?? "发布条件尚未就绪"
                : !publishVersionAllowed
                  ? "当前已发布版本没有未发布修改；编辑流程后才能发布新版本"
                  : workflow.status === "published"
                    ? "发布前会自动检查拓扑与语法，并创建新版本"
                    : "发布前会自动检查拓扑与语法")
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
                disabled={Boolean(draftError) || (workflow.flowType !== "data" && !canRun)}
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
                <span>成员与权限</span>

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
              {workflow.flowType === "data" && (
                <DropdownMenuItem
                  className="aiflow-type-control"
                  disabled={
                    savePending ||
                    publishPending ||
                    compilePending ||
                    runPending ||
                    unpublishBusy ||
                    operationPending
                  }
                  onClick={() =>
                    setConversionTarget({
                      id: workflow.id,
                      name,
                      version: Number(workflow.definitionVersion),
                      definition: structuredClone(definition),
                    })
                  }
                >
                  <FileJson size={13} className="mr-2 text-muted-foreground" />
                  <span>检查存量数据配置</span>
                </DropdownMenuItem>
              )}
              {(canCopy || canArchive || canManage || canEdit) && <DropdownMenuSeparator />}
              {canCopy && (
                <DropdownMenuItem
                  disabled={operationPending}
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
              {canArchive && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={operationPending}
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
      {canPublish && !publicationGate.allowed && !(workflow.status === "published" && publicationGate.kind === "draft") && <section data-workflow-publication-gate="" role={publicationGate.kind === "unavailable" || publicationGate.kind === "version" ? "alert" : "status"}
        className="aiflow-type-body mb-3 grid gap-3 rounded-lg border border-aiflow-info-border bg-aiflow-info-surface p-3 text-foreground sm:flex sm:items-center sm:justify-between">
        <p className="min-w-0 break-words">{publicationGate.reason}</p>
        <div className="flex shrink-0 flex-wrap gap-2">
          {publicationGate.kind === "version" && <Button type="button" variant="outline" className="min-h-11" onClick={onResolvePublicationVersion}>处理版本变化</Button>}
          <Button type="button" variant="outline" className="min-h-11" disabled={publicationRefreshing || publishPending || savePending} onClick={onRefreshPublication}>
            {publicationRefreshing ? "正在读取…" : "重新读取权限与规则"}
          </Button>
        </div>
      </section>}
      <WorkflowSubflowSnapshots key={`subflow-snapshots:${workflow.id}`} workflowId={workflow.id} savedVersion={draftBaseVersion} definition={definition} published={workflow.status === "published"}
        canEdit={canEdit} busy={savePending || publishPending || compilePending || unpublishBusy || Boolean(draftError)}
        onSave={onRefreshSubflows} onResolve={onResolveSubflowSave} />
      {draftError && <p role="alert" data-workflow-draft-error="" className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{draftError}</p>}
      {workflow.status === "published" && (
        <section
          aria-label="已发布流程编辑说明"
          data-workflow-publication-gate={canPublish && publicationGate.kind === "draft" ? "" : undefined}
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-aiflow-info-border bg-aiflow-info-surface p-3"
        >
          <div className="min-w-0 flex-1">
            <p className="aiflow-type-control font-semibold text-aiflow-info">
              {canModifyDefinition ? "正在查看已发布版本" : "已发布版本只读"}
            </p>
            <p className="aiflow-type-control mt-1 leading-6 text-foreground">
              {canModifyDefinition
                ? publicationGate.kind === "draft" ? publicationGate.reason
                  : "此处修改仅保留在本页。请按发布提示提交新版本；取消发布后可保存为草稿，历史运行仍使用原版本定义。"
                : canEdit
                  ? "当前账号无法提交已发布版本的修改。请由有发布权限的人员取消发布后，再编辑并保存草稿。"
                  : "当前账号仅可查看流程配置；编辑或发布请联系流程负责人。"}
            </p>
          </div>
          {canEdit && canPublish && (
            <div className="flex flex-wrap gap-2"><Button
              type="button"
              variant="outline"
              className="aiflow-type-control"
              disabled={unpublishFlow.isPending}
              onClick={onUnpublish}
            >
              取消发布后编辑草稿
            </Button>
              {publicationGate.kind === "draft" && <Button type="button" variant="outline" className="aiflow-type-control min-h-11" disabled={publicationRefreshing || unpublishBusy} onClick={onRefreshPublication}>
                {publicationRefreshing ? "正在读取…" : "重新读取权限与规则"}
              </Button>}
            </div>
          )}
        </section>
      )}
      {conversionUndo && conversionUndo.id === workflow.id && (
        <section
          role="status"
          className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-aiflow-info-border bg-aiflow-info-surface p-3 text-sm"
        >
          <p>
            配置转换已应用到本页，尚未保存或发布。请预检并用样例核对结果。
            {JSON.stringify(definition) !==
              JSON.stringify(conversionUndo.after) &&
              " 后续已有修改，快速撤销已暂停，避免覆盖填写。"}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={
              !canModifyDefinition ||
              savePending ||
              publishPending ||
              compilePending ||
              runPending ||
              unpublishBusy ||
              operationPending ||
              JSON.stringify(definition) !== JSON.stringify(conversionUndo.after)
            }
            onClick={() => {
              if (
                !conversionUndo ||
                !canModifyDefinition ||
                savePending ||
                publishPending ||
                compilePending ||
                runPending ||
                unpublishBusy ||
                operationPending ||
                JSON.stringify(definition) !==
                  JSON.stringify(conversionUndo.after)
              )
                return;
              onDefinitionChange(conversionUndo.before);
              setConversionUndo(null);
            }}
          >
            撤销本次转换
          </Button>
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
            {firstLocatableDiagnostic && (
              <button
                type="button"
                className="text-xs text-red-700 underline"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("flow:focus-node", {
                      detail: {
                        nodeId: firstLocatableDiagnostic.location.nodeId,
                        edgeId: firstLocatableDiagnostic.location.edgeId,
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
                            detail: { nodeId: item.location.nodeId, edgeId: item.location.edgeId },
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

      {membersDialogOpen && (
        <ErrorBoundary><Suspense fallback={<p role="status">正在加载成员与权限…</p>}>
          <WorkflowRoleBindingsDialog key={workflow.id} workflowId={workflow.id} workflowName={workflow.name}
            projectId={workflow.projectId} initialTab="builtin"
            archived={Boolean(workflow.archivedAt || workflow.projectStatus === "archived")}
            onClose={() => setMembersDialogOpen(false)} />
        </Suspense></ErrorBoundary>
      )}

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

      <Dialog open={Boolean(unpublishTarget)} onOpenChange={open => { if (!open && !unpublishBusy) setUnpublishTarget(null); }}>
        <DialogContent showCloseButton={!unpublishBusy} onEscapeKeyDown={event => { if (unpublishBusy) event.preventDefault(); }} onCloseAutoFocus={event => {
          if (document.querySelector('[role="dialog"][data-state="open"]') || unpublishOrigin.current?.workflowId !== unpublishWorkflowId.current) { event.preventDefault(); return; }
          const save = saveButtonRef.current;
          if (workflow.status === "draft" && hasUnpublishedChanges && save?.isConnected && !save.disabled) { event.preventDefault(); save.focus({ preventScroll: true }); }
          else if (unpublishOrigin.current?.element?.isConnected) { event.preventDefault(); unpublishOrigin.current.element.focus({ preventScroll: true }); }
        }}>
          <DialogHeader>
            <DialogTitle>取消发布“{unpublishTarget?.name}”</DialogTitle>
            <DialogDescription>取消发布后无法发起新的运行，历史版本和运行记录会保留。当前未保存的修改仍保留在页面，可继续保存为草稿。</DialogDescription>
          </DialogHeader>
          <p className="aiflow-type-body">本次取消发布基于 v{unpublishTarget?.definitionVersion}。</p>
          {unpublishError && <div role="alert" className="aiflow-type-body grid gap-2 rounded-lg border border-aiflow-danger-border bg-aiflow-danger-surface p-3 text-aiflow-danger">
            <p className="break-words">{unpublishError}</p><p>可先核对取消发布结果；关闭窗口不会恢复已取消的发布，也不会丢弃本地修改。</p>
          </div>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" autoFocus disabled={unpublishBusy} onClick={() => setUnpublishTarget(null)}>{unpublishError ? "关闭并保留修改" : "保持发布"}</Button>
            {unpublishError && <Button variant="outline" disabled={unpublishBusy} onClick={() => void reconcileUnpublish()}>{unpublishChecking ? "正在核对…" : "核对取消发布结果"}</Button>}
            <Button variant="destructive" disabled={!canPublish || unpublishBusy || unpublishTarget?.id !== workflow.id || workflow.status !== "published"} onClick={() => {
              if (!unpublishTarget || !canPublish || unpublishBusy || unpublishTarget.id !== workflow.id || workflow.status !== "published") return;
              setUnpublishError("");
              const submitted = { id: unpublishTarget.id, expectedDefinitionVersion: unpublishTarget.definitionVersion };
              onUnpublishRequested(submitted);
              unpublishFlow.mutate(submitted);
            }}>{unpublishFlow.isPending ? "正在取消发布…" : "确认取消发布"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      {conversionTarget && (
        <ErrorBoundary
          fallback={
            <CreationDialog
              open
              title="配置检查未能加载"
                description="当前填写仍保留，可以关闭检查窗口继续编辑。若需刷新重试，请先导出备份。"
              submitLabel="关闭检查"
              pending={false}
              onOpenChange={(open) => {
                if (!open) setConversionTarget(null);
              }}
              onSubmit={() => setConversionTarget(null)}
            >
              <p role="alert" className="text-sm">
                请检查网络后重试，本次没有转换、保存或发布流程。
              </p>
            </CreationDialog>
          }
        >
          <Suspense
            fallback={
              <CreationDialog
                open
                title="正在读取配置检查"
                description="当前填写仍保留，可以关闭此窗口。"
                submitLabel="正在加载…"
                pending={false}
                submitDisabled
                onOpenChange={(open) => {
                  if (!open) setConversionTarget(null);
                }}
                onSubmit={() => {}}
              >
                <p role="status" className="text-sm">
                  正在加载检查规则…
                </p>
              </CreationDialog>
            }
          >
            <DataflowConfigConversionDialog
              target={conversionTarget}
              canApply={canApplyDataflowConfigConversion(
                {
                  id: workflow.id,
                  version: Number(workflow.definitionVersion),
                  definition,
                  canEdit: canModifyDefinition,
                  busy:
                    savePending ||
                    publishPending ||
                    compilePending ||
                    runPending ||
                    unpublishBusy ||
                    operationPending,
                },
                conversionTarget,
              )}
              onClose={() => setConversionTarget(null)}
              onApply={(candidate) => {
                if (
                  !canApplyDataflowConfigConversion(
                    {
                      id: workflow.id,
                      version: Number(workflow.definitionVersion),
                      definition,
                      canEdit: canModifyDefinition,
                      busy:
                        savePending ||
                        publishPending ||
                        compilePending ||
                        runPending ||
                        unpublishBusy ||
                        operationPending,
                    },
                    conversionTarget,
                  )
                )
                  throw new Error(
                    "流程、权限或填写已变化，本次转换未应用。请重新检查。",
                  );
                setConversionUndo({
                  id: workflow.id,
                  before: conversionTarget.definition,
                  after: candidate,
                });
                onDefinitionChange(candidate);
                setConversionTarget(null);
                toast.info("已转换当前填写；尚未保存或发布，请核对样例结果。");
              }}
            />
          </Suspense>
        </ErrorBoundary>
      )}
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

const internalAccountFields = [
  { key: "username", label: "用户名（3–64 位）", type: "text", placeholder: "字母开头，可含数字和 ._-", minLength: 3, maxLength: 64, pattern: "[A-Za-z][A-Za-z0-9._\\-]{2,63}" },
  { key: "name", label: "显示名称", type: "text", placeholder: "填写显示名称", maxLength: 160 },
  { key: "password", label: "初始密码（至少 12 位）", type: "password", placeholder: "包含字母和数字或符号", minLength: 12, maxLength: 256, pattern: "(?=.*[A-Za-z])(?=.*[0-9\\W_]).{12,256}" },
  { key: "email", label: "邮箱（可选）", type: "email", placeholder: "name@example.com" },
] as const;

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

type AuditCategory = "authentication" | "account" | "roles" | "projects";
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
  role_created: { label: "创建自定义角色", category: "roles" },
  project_archived: { label: "归档业务", category: "projects" },
  project_restored: { label: "恢复业务", category: "projects" },
  role_updated: { label: "修改自定义角色", category: "roles" },
  role_deleted: { label: "删除自定义角色", category: "roles" },
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
    projects: "业务归档",
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
  currentUserId,
  changingStatus,
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
  currentUserId: number;
  changingStatus: boolean;
  form: InternalUserForm;
  setForm: (next: InternalUserForm) => void;
  onCreate: () => Promise<unknown>;
  creating: boolean;
  onToggleStatus: (id: number, status: "active" | "disabled", version: number) => Promise<unknown>;
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
  const [roleEditor, setRoleEditor] = useState<{
    mode: "create" | "edit" | "delete";
    role?: any;
  } | null>(null);
  const userPageSize = 10;
  const rolePageSize = 10;
  const auditPageSize = 10;
  const [normalDialogOpen, setNormalDialogOpen] = useState(false);
  const [statusTarget, setStatusTarget] = useState<any>(null);
  const [statusError, setStatusError] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const statusAction = statusTarget?.status === "active" ? "停用" : "启用";
  const [normalError, setNormalError] = useState("");
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [tab, setTab] = useState<"users" | "roles" | "audit">("users");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userStatus, setUserStatus] = useState<"active" | "disabled" | "all">("active");
  const [userPage, setUserPage] = useState(0);
  const [rolePage, setRolePage] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const [roleSearch, setRoleSearch] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditCategory, setAuditCategory] = useState("all");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [mobileUserDetailsOpen, setMobileUserDetailsOpen] = useState(false);
  const [mobileRoleDetailsOpen, setMobileRoleDetailsOpen] = useState(false);
  const [revokeTarget,setRevokeTarget]=useState<{id:string;userId:number;userLabel:string;roleName:string;scopeLabel:string}|null>(null);
  const pendingRevokeRoleId=revokeTarget?.id??null;
  const [revokeError,setRevokeError]=useState("");
  const roleWriteLock=useRef(false);
  const beginRoleWrite=useResourceDraftPending("iam","system-authorization");
  const [assignmentTarget,setAssignmentTarget]=useResourceDraftState<import("@/components/SystemRoleAssignmentDialog").SystemRoleTarget|null>("iam","system-authorization","dialog",null,false);
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
      status: userStatus === "all" ? undefined : userStatus,
      offset: userPage * userPageSize,
      limit: userPageSize,
    },
    { enabled: tab === "users", retry: false }
  );
  const filteredUsers = userDirectory.data?.items ?? [];
  const userTotal = userDirectory.data?.total ?? 0;
  const userPageCount = Math.max(1, Math.ceil(userTotal / userPageSize));
  const utils = trpc.useUtils();
  const userDetails = trpc.iam.userAuthorizationDetails.useQuery(
    { userId: selectedUserId ?? 1 },
    authorizationQueryPolicy(tab === "users" && selectedUserId !== null)
  );
  const roleDetails = trpc.iam.roleAuthorizationDetails.useQuery(
    { roleId: selectedRoleId ?? 1 },
    authorizationQueryPolicy(tab === "roles" && selectedRoleId !== null)
  );
  const refreshRoleQueries = () => Promise.all([
    utils.iam.invalidate(), utils.auth.me.invalidate(),
    utils.workflow.invalidate(),
    utils.project.invalidate(),
  ]);
  const revokeRole = trpc.iam.revokeRoleAssignment.useMutation({
    onSuccess: () => { setRevokeTarget(null); setRevokeError(""); void refreshRoleQueries(); toast.success("直接角色授权已撤销。"); },
    onError: error => {setRevokeError(`${error.message} 请先读取列表核对结果。`);void utils.iam.roles.invalidate();},
  });
  const requestRoleRevoke = (id:string|null) => {
    if(roleWriteLock.current)return;
    if(!id){setRevokeTarget(null);return;}
    const role=userDetails.data?.directRoles.find((row:any)=>row.assignmentId===id);
    if(!role||!selectedUserId||!userDetails.data)return;
    setRevokeError("");setRevokeTarget({id,userId:selectedUserId,userLabel:userDetails.data.user.name||userDetails.data.user.username,roleName:role.roleName,scopeLabel:role.scopeType==="system"?"系统范围":role.scopeName||role.scopeId});
  };
  const confirmRoleRevoke = async () => {
    if(!revokeTarget||roleWriteLock.current)return;
    roleWriteLock.current=true;const finish=beginRoleWrite();setRevokeError("");
    try{await revokeRole.mutateAsync({assignmentId:revokeTarget.id});}catch{}finally{roleWriteLock.current=false;finish();}
  };

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
  const selectedRole = roles.find(role => Number(role.id) === selectedRoleId);

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
    ) {
      setMobileUserDetailsOpen(false);
      setSelectedUserId(Number(first.id));
    }
    if (!first && selectedUserId !== null) {
      setMobileUserDetailsOpen(false);
      setSelectedUserId(null);
    }
  }, [
    filteredUsers,
    selectedUserId,
    userDirectory.isSuccess,
    userPage,
    userPageCount,
  ]);

  useEffect(() => {
    if (!filteredRoles.length) {
      if (selectedRoleId !== null) setSelectedRoleId(null);
      return;
    }
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
    setNormalError("");
    try {
      await onCreate();
      setNormalDialogOpen(false);
    } catch (error) {
      setNormalError(error instanceof Error ? error.message : "创建账号失败，请重试。");
    }
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

  const openUserAssignment=()=>{if(!selectedUserId||!userDetails.data)return;setMobileUserDetailsOpen(false);setAssignmentTarget({mode:"user",userId:String(selectedUserId),userLabel:`${userDetails.data.user.name||userDetails.data.user.username}（${userDetails.data.user.username}）`});};
  const openRoleAssignment=()=>{if(!selectedRole||selectedRole.scope!=="system")return;setMobileRoleDetailsOpen(false);setAssignmentTarget({mode:"role",roleCode:selectedRole.code,roleName:selectedRole.name,configToken:selectedRole.configToken});};

  return (
    <div className="space-y-5 p-4 lg:p-6 [&_input]:h-11 [&_select]:h-11 [&_button]:min-h-11 min-[1024px]:[&_input]:h-10 min-[1024px]:[&_select]:h-10 min-[1024px]:[&_button]:min-h-10">
      {roleEditor && (
        <ErrorBoundary>
          <Suspense fallback={<p role="status">正在加载角色编辑器…</p>}>
            <CustomRoleDialog
              mode={roleEditor.mode}
              role={roleEditor.role}
              onClose={() => setRoleEditor(null)}
              onSaved={async code => {
                await Promise.all([
                  refreshRoleQueries(),
                  utils.workflow.customRoles.invalidate(),
                  utils.workflow.customRoleAssignments.invalidate(),
                ]);
                setRoleSearch(code ?? "");
                setRolePage(0);
                toast.success(
                  roleEditor.mode === "delete"
                    ? "自定义角色已删除。"
                    : "自定义角色已保存。"
                );
              }}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="aiflow-type-meta font-medium text-muted-foreground">
            系统管理
          </p>
          <h1
            data-aiflow-page-title=""
            className="aiflow-type-page-title mt-1 font-semibold"
          >
            内部账号与权限中心
          </h1>
          <p className="aiflow-type-body mt-1 text-muted-foreground">
            管理账号与角色，查看有效权限和授权来源。
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
              <DropdownMenuItem onClick={() => { setNormalError(""); setNormalDialogOpen(true); }}>
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

      <CreationDialog open={!!statusTarget} onOpenChange={open => { if (!open) setStatusTarget(null); }}
        title={`确认${statusAction}账号`}
        description={statusAction === "停用" ? "停用会退出所有会话，不能办理任务，授权与记录保留。" : "启用需重新登录，有效权限恢复。"}
        submitLabel={statusError ? "刷新并重新确认" : `确认${statusAction}`}
        pending={changingStatus || statusBusy} errorMessage={statusError}
        onSubmit={async () => {
          if (!statusTarget) return;
          setStatusBusy(true);
          try {
            if (statusError) {
              const fresh = (await utils.iam.userDirectory.fetch({ search: statusTarget.username, offset: 0, limit: 10 }, { staleTime: 0 })).items.find(account => Number(account.id) === Number(statusTarget.id));
              if (!fresh) throw new Error("账号已不存在，请返回目录。");
              setStatusTarget(fresh); setStatusError(""); return;
            }
            await onToggleStatus(statusTarget.id, statusTarget.status, statusTarget.statusVersion);
            setStatusTarget(null); toast.success("账号状态已更新。");
          } catch (error) { setStatusError(error instanceof Error ? error.message : "修改失败，请重试。"); }
          finally { setStatusBusy(false); }
        }}>
        <p className="break-words font-semibold">{statusTarget?.name || statusTarget?.username}（{statusTarget?.username}）</p>
      </CreationDialog>
      <CreationDialog
        open={normalDialogOpen}
        onOpenChange={setNormalDialogOpen}
        title="新增内部账号"
        description="填写账号信息和初始密码。"
        submitLabel="创建账号"
        pending={creating}
        errorMessage={normalError}
        onSubmit={submitNormalUser}
      >
        {internalAccountFields.map(({ key, label, ...props }) => (
          <label key={key} className="grid gap-1.5 text-sm font-medium text-foreground">
            {label}
            <Input {...props} className="h-11" autoFocus={key === "username"}
              autoComplete={key === "password" ? "new-password" : "off"}
              value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })}
              required={key !== "email"} />
          </label>
        ))}
        <label className="grid gap-1.5 text-sm font-medium text-foreground">
          账号类型
        <select
          className="h-11 rounded-md border border-border bg-card px-2 text-sm"
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
        </label>
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

      {assignmentTarget && <Suspense fallback={<p role="status">正在加载角色授权表单…</p>}><SystemRoleAssignmentDialog key={`${assignmentTarget.mode}:${assignmentTarget.userId||assignmentTarget.roleCode}`} target={assignmentTarget} onClose={()=>setAssignmentTarget(null)}/></Suspense>}


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
              <label className="mt-3 grid gap-1.5 text-sm text-muted-foreground">
                账号状态
                <select aria-label="账号状态" className="aiflow-type-control min-h-11 rounded-md border border-input bg-card px-3 text-foreground min-[1024px]:min-h-10" value={userStatus} onChange={event => {
                  setUserStatus(event.target.value as typeof userStatus);
                  setUserPage(0);
                  setSelectedUserId(null);
                  setMobileUserDetailsOpen(false);
                }}>
                  <option value="active">启用账号</option>
                  <option value="disabled">停用账号</option>
                  <option value="all">全部账号</option>
                </select>
              </label>
              <p className="mt-2 text-xs text-muted-foreground">默认显示启用账号；查看停用账号请切换状态。</p>
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
                        disabled={changingStatus || Number(account.id) === currentUserId || !account.statusVersion}
                        onClick={() => { setStatusError(""); setStatusTarget(account); }}
                      >
                        {Number(account.id) === currentUserId ? "当前登录账号" : account.status === "active" ? "停用账号" : "启用账号"}
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
              selectedUserId={selectedUserId}
              details={userDetails}
              onAssign={openUserAssignment}
              onRevoke={requestRoleRevoke}
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
                  selectedUserId={selectedUserId}
                  details={userDetails}
                  onAssign={openUserAssignment}
                  onRevoke={requestRoleRevoke}
                  revoking={revokeRole.isPending}
                  embedded
                />
              </div>
            </DialogContent>
          </Dialog>
          <Dialog
            open={pendingRevokeRoleId !== null}
            onOpenChange={open => {
              if (!open && !revokeRole.isPending) requestRoleRevoke(null);
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>撤销直接角色授权</DialogTitle>
                <DialogDescription>将从“{revokeTarget?.userLabel}”移除“{revokeTarget?.roleName}”在“{revokeTarget?.scopeLabel}”的直接授权；其他授权来源继续生效。</DialogDescription>
              </DialogHeader>
              {revokeError&&<p role="alert" className="aiflow-type-body text-destructive">{revokeError}</p>}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={revokeRole.isPending}
                  onClick={() => requestRoleRevoke(null)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!pendingRevokeRoleId || revokeRole.isPending}
                  onClick={() => void confirmRoleRevoke()}
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRoleEditor({ mode: "create" })}
                >
                  新增角色
                </Button>
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
                        className="aiflow-type-body min-w-0 break-words font-semibold text-foreground [overflow-wrap:anywhere]"
                        title={role.name}
                      >
                        {role.name}
                      </p>
                      <span className="aiflow-type-meta shrink-0 rounded-full bg-card px-1.5 py-0.5 text-muted-foreground">
                        {role.scope === "system"
                          ? "系统角色"
                          : role.scope === "workflow"
                            ? "流程角色"
                            : role.scope}
                      </span>
                    </div>
                    <p
                      className="aiflow-type-meta mt-0.5 break-words font-mono text-muted-foreground [overflow-wrap:anywhere]"
                      title={role.code}
                    >
                      {role.code}
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
              onManage={(mode, role) => {
                setMobileRoleDetailsOpen(false);
                setRoleEditor({ mode, role });
              }}
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
                  onManage={(mode, role) => {
                    setMobileRoleDetailsOpen(false);
                    setRoleEditor({ mode, role });
                  }}
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
              <option value="projects">业务归档</option>
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
  selectedUserId,
  onAssign,
  onRevoke,
  revoking,
  embedded = false,
}: {
  details: any;
  selectedUserId: number | null;
  onAssign: () => void;
  onRevoke: (assignmentId: string) => void;
  revoking: boolean;
  embedded?: boolean;
}) {
  const reveal = useContextReveal<HTMLDivElement>(selectedUserId);
  const groups = useRef<(HTMLDivElement | null)[]>([]);
  const data =
    selectedUserId && Number(details.data?.user?.id) === selectedUserId
      ? details.data
      : null;
  return (
    <>
      <div
        className={`flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border ${embedded ? "pb-3" : "px-4 py-3"}`}
      >
        <div className="min-w-0">
          <p className="font-semibold">用户权限详情</p>
        </div>
        <Button
          size="sm"
          className="aiflow-type-control h-11 shrink-0 bg-blue-600 text-white shadow-2xs hover:bg-blue-700 min-[1024px]:h-10"
          disabled={!data || details.isLoading || data.user.status !== "active"}
          onClick={onAssign}
        >
          <Plus size={13} />
          绑定角色
        </Button>
      </div>
      <AuthorizationDetailRefresh
        query={details}
        label="刷新用户权限详情"
        disabled={!selectedUserId}
        embedded={embedded}
      />
      <div
        ref={reveal}
        className={`${embedded ? "pt-4" : "max-h-[620px] overflow-y-auto p-4"} aiflow-type-body`}
      >
        {!selectedUserId && (
          <p className="text-muted-foreground">请从左侧选择用户。</p>
        )}
        {selectedUserId && details.isLoading && (
          <p className="text-muted-foreground">正在读取角色与权限…</p>
        )}
        {selectedUserId && details.error && (
          <p className="break-words text-aiflow-danger">
            {details.error.message}
          </p>
        )}
        {data && (
          <div className="space-y-4">
            <div>
              <p className="aiflow-type-body break-words font-semibold text-foreground">
                {data.user.name || data.user.username}
              </p>
              <p className="break-all font-mono text-muted-foreground">
                {data.user.username}
              </p>
            </div>
            {data.user.status !== "active" && (
              <p
                role="status"
                className="rounded-lg bg-aiflow-warning-surface p-3 text-aiflow-warning"
              >
                账号停用：不可登录、办理或接受新授权。已有角色保留。
              </p>
            )}
            <AccessRelationshipOverview identity={selectedUserId!} label={data.user.name || data.user.username} nodes={[{ label: "直接角色", count: data.directRoles.length }, { label: "组织继承角色", count: data.inheritedRoles.length }, { label: "有效权限", count: data.effectivePermissions.length }]} onSelect={index => focusAccessGroup(groups.current[index])} />
            <div ref={element => { groups.current[0] = element; }} tabIndex={-1} data-access-details-target="">
            <RoleDetailGroup
              title="直接角色"
              roles={data.directRoles}
              source="直接授权"
              onRevoke={onRevoke}
              revoking={revoking}
            />
            </div>
            <div ref={element => { groups.current[1] = element; }} tabIndex={-1} data-access-details-target="">
            <RoleDetailGroup
              title="组织继承角色"
              roles={data.inheritedRoles}
              source="组织继承"
            />
            </div>
            <div ref={element => { groups.current[2] = element; }} tabIndex={-1} data-access-details-target="">
              <p className="mb-2 font-semibold text-foreground">
                系统级有效权限（{data.effectivePermissions.length}）
              </p>
              <p className="mb-2 text-muted-foreground">
                {data.authorizationSummary}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {data.effectivePermissions.map((permission: any) => (
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
                    <p className="text-xs break-words text-muted-foreground">{permission.sourceLabels?.join("；")}</p>
                  </div>
                ))}
                {!data.effectivePermissions.length && (
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
  onManage,
  embedded = false,
}: {
  details: any;
  selectedRole: any;
  onAssign: () => void;
  onManage: (mode: "edit" | "delete", role: any) => void;
  embedded?: boolean;
}) {
  const reveal = useContextReveal<HTMLDivElement>(selectedRole?.id);
  const groups = useRef<(HTMLDivElement | null)[]>([]);
  const data =
    selectedRole?.id &&
    Number(details.data?.role?.id) === Number(selectedRole.id)
      ? details.data
      : null;
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
        {selectedRole && !Boolean(Number(selectedRole.isSystem)) && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!data || details.isFetching}
              onClick={() =>
                onManage("edit", {
                  ...data.role,
                  permissions: data.permissions.map(
                    (permission: any) => permission.code
                  ),
                })
              }
            >
              编辑角色
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!data || details.isFetching}
              onClick={() =>
                onManage("delete", {
                  ...data.role,
                  permissions: data.permissions.map(
                    (permission: any) => permission.code
                  ),
                })
              }
            >
              删除角色
            </Button>
          </div>
        )}
        <Button
          size="sm"
          className="aiflow-type-control h-11 min-h-11 shrink-0 bg-blue-600 text-white shadow-2xs hover:bg-blue-700 min-[1024px]:h-10 min-[1024px]:min-h-10"
          disabled={!data || details.isLoading || !assignable}
          onClick={onAssign}
        >
          <Plus size={13} />
          {selectedRole?.scope === "workflow" ? "流程内绑定" : "绑定用户"}
        </Button>
      </div>
      <AuthorizationDetailRefresh
        query={details}
        label="刷新角色权限详情"
        disabled={!selectedRole?.id}
        embedded={embedded}
      />
      <div
        ref={reveal}
        className={`${embedded ? "pt-4" : "max-h-[620px] overflow-y-auto p-4"} aiflow-type-body`}
      >
        {!selectedRole?.id && (
          <p className="text-muted-foreground">请从左侧选择角色。</p>
        )}
        {selectedRole?.id && details.isLoading && (
          <p className="text-muted-foreground">正在读取角色绑定…</p>
        )}
        {selectedRole?.id && details.error && (
          <p className="break-words text-aiflow-danger">
            {details.error.message}
          </p>
        )}
        {data && (
          <div className="space-y-5">
            <div>
              <p className="aiflow-type-section-title break-words font-semibold text-foreground">
                {data.role.name}
              </p>
              <p className="mt-1 break-all font-mono text-aiflow-info">
                {data.role.code}
              </p>
              <p className="mt-1 break-words leading-5 text-muted-foreground">
                {data.role.description || "未填写角色说明"}
              </p>
              {!assignable && (
                <p className="mt-2 rounded-md bg-aiflow-warning-surface px-3 py-2 leading-5 text-aiflow-warning">
                  流程范围角色需在对应流程的成员权限页绑定，避免跨流程误授权。
                </p>
              )}
            </div>
            <AccessRelationshipOverview identity={selectedRole.id} label={data.role.name} nodes={[{ label: "权限清单", count: data.permissions.length }, { label: "直接绑定记录", count: data.directUsers.length }, { label: "组织继承记录", count: data.inheritedUsers.length }]} onSelect={index => focusAccessGroup(groups.current[index])} />
            <div ref={element => { groups.current[0] = element; }} tabIndex={-1} data-access-details-target="">
              <p className="mb-2 font-semibold text-foreground">
                权限清单（{data.permissions.length}）
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.permissions.map((permission: any) => (
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
            <div ref={element => { groups.current[1] = element; }} tabIndex={-1} data-access-details-target="">
            <UserBindingGroup
              title="直接绑定用户"
              users={data.directUsers}
              source="直接授权"
            />
            </div>
            <div ref={element => { groups.current[2] = element; }} tabIndex={-1} data-access-details-target="">
            <UserBindingGroup
              title="组织继承用户"
              users={data.inheritedUsers}
              source="组织继承"
            />
            </div>
            {data.organizationUnits.length > 0 && (
              <div>
                <p className="mb-2 font-semibold text-foreground">绑定组织</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.organizationUnits.map((unit: any) => (
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
