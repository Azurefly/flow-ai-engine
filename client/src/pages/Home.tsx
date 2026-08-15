import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import WorkflowCanvas from "@/components/WorkflowCanvas";
import { trpc } from "@/lib/trpc";
import type { Definition } from "../../../server/workflow-service";
import {
  Activity,
  ChevronRight,
  CirclePlay,
  Clock3,
  Copy,
  Download,
  FileJson,
  FolderKanban,
  Gauge,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  Play,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  UsersRound,
  Trash2,
  X,
} from "lucide-react";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type Section = "flows" | "runs" | "iam";
type UserIdentity = { id: number; username: string | null; name: string | null; role: "user" | "admin" };

function decodeJson(value: unknown) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function formatTime(value: unknown) {
  if (!value) return "—";
  return new Date(String(value)).toLocaleString("zh-CN", { hour12: false });
}

export default function Home() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const [credentials, setCredentials] = useState({ username: "", password: "" });
  const login = trpc.auth.login.useMutation({
    onSuccess: () => { void utils.auth.me.invalidate(); toast.success("登录成功，正在进入流程中心。"); },
    onError: error => toast.error(error.message),
  });
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => { void utils.auth.me.invalidate(); toast.success("已安全退出。"); } });

  if (me.isLoading) return <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-300"><div className="flex items-center gap-3"><Loader2 className="animate-spin" />正在连接 Flow AI Engine</div></main>;
  if (!me.data) return <LoginScreen credentials={credentials} setCredentials={setCredentials} pending={login.isPending} onSubmit={() => login.mutate(credentials)} />;
  return <FlowConsole user={me.data} onLogout={() => logout.mutate()} />;
}

function LoginScreen({ credentials, setCredentials, pending, onSubmit }: { credentials: { username: string; password: string }; setCredentials: (next: { username: string; password: string }) => void; pending: boolean; onSubmit: () => void }) {
  return <main className="relative grid min-h-screen place-items-center overflow-hidden bg-slate-950 p-5 text-slate-100">
    <div className="absolute inset-0 opacity-25 [background-image:radial-gradient(#3b82f6_1px,transparent_1px)] [background-size:22px_22px]" />
    <section className="relative w-full max-w-md overflow-hidden rounded-xl border border-slate-700 bg-slate-900/95 shadow-2xl shadow-blue-950/60">
      <div className="border-b border-slate-700 bg-slate-800 px-7 py-5"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded bg-blue-500 text-white"><Gauge size={21} /></div><div><p className="text-xs font-bold tracking-[.2em] text-blue-300">NEBULA INSPIRED · V3</p><h1 className="mt-0.5 text-lg font-semibold">Flow AI Engine 控制台</h1></div></div></div>
      <form className="grid gap-4 p-7" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
        <p className="text-sm leading-6 text-slate-400">内部账号认证已接入 IAM。流程、运行记录和协作授权均按资源级权限隔离。</p>
        <label className="grid gap-2 text-xs font-medium text-slate-300">用户名<Input className="border-slate-600 bg-slate-800 text-slate-100 placeholder:text-slate-500" autoComplete="username" value={credentials.username} onChange={event => setCredentials({ ...credentials, username: event.target.value })} required /></label>
        <label className="grid gap-2 text-xs font-medium text-slate-300">密码<Input className="border-slate-600 bg-slate-800 text-slate-100 placeholder:text-slate-500" type="password" autoComplete="current-password" minLength={12} value={credentials.password} onChange={event => setCredentials({ ...credentials, password: event.target.value })} required /></label>
        <Button className="mt-2 bg-blue-600 hover:bg-blue-500" disabled={pending}>{pending && <Loader2 className="animate-spin" />}登录流程引擎</Button>
      </form>
      <div className="border-t border-slate-800 px-7 py-4 text-xs text-slate-500">账号由管理员创建；系统不提供公开注册。</div>
    </section>
  </main>;
}

function FlowConsole({ user, onLogout }: { user: UserIdentity; onLogout: () => void }) {
  const utils = trpc.useUtils();
  const [section, setSection] = useState<Section>("flows");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [draftDefinition, setDraftDefinition] = useState<Definition | null>(null);
  const [draftName, setDraftName] = useState("");
  const [runInput, setRunInput] = useState('{\n  "id": 2,\n  "prompt": "请总结输入内容"\n}');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [newFlowName, setNewFlowName] = useState("");
  const [userForm, setUserForm] = useState({ username: "", name: "", password: "", email: "", role: "user" as "user" | "admin" });
  const importRef = useRef<HTMLInputElement>(null);

  const workflows = trpc.workflow.list.useQuery();
  const workflowItems = (workflows.data ?? []) as any[];
  const selectedWorkflow = workflowItems.find(workflow => workflow.id === selectedWorkflowId) ?? workflowItems[0] ?? null;
  const selectedId = selectedWorkflow?.id ?? null;
  const runQueryInput = useMemo(() => ({ workflowId: selectedId ?? "00000000" }), [selectedId]);
  const runs = trpc.workflow.runs.useQuery(runQueryInput, { enabled: Boolean(selectedId), refetchInterval: 5_000 });
  const detailInput = useMemo(() => ({ runId: selectedRunId ?? "00000000-0000-0000-0000-000000000000" }), [selectedRunId]);
  const runDetail = trpc.workflow.runDetail.useQuery(detailInput, { enabled: Boolean(selectedRunId) });
  const accessInput = useMemo(() => ({ id: selectedId ?? "00000000" }), [selectedId]);
  const access = trpc.workflow.access.useQuery(accessInput, { enabled: Boolean(selectedId) });
  const members = trpc.workflow.members.useQuery(useMemo(() => ({ workflowId: selectedId ?? "00000000" }), [selectedId]), { enabled: Boolean(selectedId), retry: false });
  const memberCandidates = trpc.workflow.memberCandidates.useQuery(useMemo(() => ({ workflowId: selectedId ?? "00000000" }), [selectedId]), { enabled: Boolean(selectedId && access.data?.permissions?.has("workflow:members:manage")), retry: false });
  const runtimeModels = trpc.workflow.runtimeModels.useQuery(undefined, { staleTime: 60_000, retry: false });
  const users = trpc.iam.users.useQuery(undefined, { enabled: user.role === "admin", retry: false });
  const roles = trpc.iam.roles.useQuery(undefined, { enabled: user.role === "admin", retry: false });
  const audit = trpc.iam.authorizationAudit.useQuery({ limit: 20 }, { enabled: user.role === "admin", retry: false });

  useEffect(() => {
    if (!selectedWorkflowId && workflowItems[0]) setSelectedWorkflowId(workflowItems[0].id);
  }, [selectedWorkflowId, workflowItems]);

  useEffect(() => {
    if (selectedWorkflow) {
      setDraftName(selectedWorkflow.name);
      setDraftDefinition(decodeJson(selectedWorkflow.definition) as Definition);
    }
  }, [selectedWorkflow?.id]);

  const createFlow = trpc.workflow.create.useMutation({
    onSuccess: (workflow: any) => { void utils.workflow.list.invalidate(); setSelectedWorkflowId(workflow?.id ?? null); setNewFlowName(""); toast.success("已新建草稿流程。"); },
    onError: error => toast.error(error.message),
  });
  const saveFlow = trpc.workflow.update.useMutation({
    onSuccess: (workflow: any) => { void utils.workflow.list.invalidate(); if (workflow) { setDraftDefinition(decodeJson(workflow.definition) as Definition); setDraftName(workflow.name); } toast.success("流程定义已保存。"); },
    onError: error => toast.error(error.message),
  });
  const publishFlow = trpc.workflow.publish.useMutation({ onSuccess: () => { void utils.workflow.list.invalidate(); toast.success("流程已发布。"); }, onError: error => toast.error(error.message) });
  const duplicateFlow = trpc.workflow.duplicate.useMutation({ onSuccess: (workflow: any) => { void utils.workflow.list.invalidate(); setSelectedWorkflowId(workflow?.id ?? null); toast.success("已创建流程副本。"); }, onError: error => toast.error(error.message) });
  const deleteFlow = trpc.workflow.delete.useMutation({ onSuccess: () => { void utils.workflow.list.invalidate(); setSelectedWorkflowId(null); setDraftDefinition(null); toast.success("流程及其运行记录已删除。"); }, onError: error => toast.error(error.message) });
  const grantMember = trpc.workflow.grantMember.useMutation({ onSuccess: () => { void utils.workflow.members.invalidate(); toast.success("流程成员授权已更新。"); }, onError: error => toast.error(error.message) });
  const revokeMember = trpc.workflow.revokeMember.useMutation({ onSuccess: () => { void utils.workflow.members.invalidate(); toast.success("流程成员授权已撤销。"); }, onError: error => toast.error(error.message) });
  const runFlow = trpc.workflow.run.useMutation({
    onSuccess: result => { void utils.workflow.runs.invalidate(); setSelectedRunId(result.runId); setSection("runs"); toast.success(`运行完成：${result.runId.slice(0, 8)}`); },
    onError: error => toast.error(error.message),
  });
  const createUser = trpc.iam.createUser.useMutation({
    onSuccess: () => { setUserForm({ username: "", name: "", password: "", email: "", role: "user" }); void utils.iam.users.invalidate(); void utils.iam.authorizationAudit.invalidate(); toast.success("内部账号已创建。"); },
    onError: error => toast.error(error.message),
  });
  const updateUserStatus = trpc.iam.updateUserStatus.useMutation({ onSuccess: () => { void utils.iam.users.invalidate(); void utils.iam.authorizationAudit.invalidate(); }, onError: error => toast.error(error.message) });

  const canEdit = Boolean(access.data?.permissions?.has("workflow:edit"));
  const canPublish = Boolean(access.data?.permissions?.has("workflow:publish"));
  const canRun = Boolean(access.data?.permissions?.has("workflow:run"));
  const canManageMembers = Boolean(access.data?.permissions?.has("workflow:members:manage"));
  const saveCurrent = useCallback(() => {
    if (!selectedId || !draftDefinition) return;
    saveFlow.mutate({ id: selectedId, name: draftName.trim() || "未命名流程", definition: draftDefinition });
  }, [draftDefinition, draftName, saveFlow, selectedId]);

  const exportCurrent = () => {
    if (!selectedWorkflow || !draftDefinition) return;
    const payload = { exportedAt: new Date().toISOString(), workflow: { name: draftName, description: selectedWorkflow.description, definition: draftDefinition } };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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
        const imported = (parsed.workflow?.definition ?? parsed.definition ?? parsed) as Definition;
        if (!Array.isArray(imported.nodes) || !Array.isArray(imported.edges)) throw new Error();
        setDraftDefinition(imported);
        if (parsed.workflow?.name) setDraftName(String(parsed.workflow.name));
        toast.success("JSON 已载入；请检查后保存。");
      } catch { toast.error("导入文件不是有效的流程定义 JSON。"); }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const startRun = () => {
    if (!selectedId) return;
    try { runFlow.mutate({ workflowId: selectedId, input: JSON.parse(runInput) as Record<string, unknown> }); } catch { toast.error("运行输入必须是合法 JSON 对象。"); }
  };

  const nav = [
    { id: "flows" as const, label: "业务流程", icon: FolderKanban },
    { id: "runs" as const, label: "运行中心", icon: Activity },
    ...(user.role === "admin" ? [{ id: "iam" as const, label: "身份与权限", icon: ShieldCheck }] : []),
  ];

  return <main className="min-h-screen bg-slate-100 text-slate-800">
    <header className="sticky top-0 z-30 border-b border-slate-700 bg-slate-900 text-slate-100 shadow-lg">
      <div className="flex h-14 items-center"><button className="grid h-14 w-16 place-items-center border-r border-slate-700 text-slate-300 hover:bg-slate-800" onClick={() => setSidebarOpen(value => !value)} aria-label="展开导航">{sidebarOpen ? <X size={19} /> : <Menu size={19} />}</button><div className="flex min-w-0 items-center gap-3 px-4"><div className="grid h-7 w-7 place-items-center rounded bg-blue-500"><Gauge size={16} /></div><div className="hidden sm:block"><p className="text-[10px] font-bold tracking-[.22em] text-blue-300">NEBULA BUSINESS ENGINE</p><p className="text-sm font-semibold">Flow AI Engine</p></div></div><div className="ml-4 hidden h-full items-end gap-1 md:flex">{nav.map(item => <button key={item.id} onClick={() => setSection(item.id)} className={`flex h-full items-center gap-2 border-b-2 px-4 text-sm transition-colors ${section === item.id ? "border-blue-400 bg-slate-800 text-white" : "border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100"}`}><item.icon size={15} />{item.label}</button>)}</div><div className="ml-auto flex h-full items-center gap-3 px-4 text-xs"><span className="hidden text-slate-400 lg:inline">{user.name || user.username || "内部用户"}</span><span className="rounded border border-slate-600 px-2 py-1 text-slate-300">{user.role === "admin" ? "系统管理员" : "成员"}</span><Button variant="ghost" size="sm" className="text-slate-300 hover:bg-slate-800 hover:text-white" onClick={onLogout}><LogOut size={15} />退出</Button></div></div>
    </header>
    <div className="flex min-h-[calc(100vh-56px)]">
      <aside className={`${sidebarOpen ? "w-72" : "w-0 overflow-hidden"} shrink-0 border-r border-slate-200 bg-white transition-[width] duration-200`}>
        <div className="border-b border-slate-100 p-4"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold tracking-[.18em] text-slate-400">PROJECT WORKBENCH</p><h2 className="mt-1 text-sm font-semibold">流程仓库</h2></div><Button size="icon" variant="ghost" onClick={() => setNewFlowName(value => value || "新流程")}><Plus size={17} /></Button></div>{newFlowName && <form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); createFlow.mutate({ name: newFlowName }); }}><Input className="h-8 text-xs" value={newFlowName} onChange={event => setNewFlowName(event.target.value)} autoFocus /><Button size="sm" className="h-8" disabled={createFlow.isPending}>新建</Button></form>}</div>
        <div className="max-h-[calc(100vh-196px)] overflow-y-auto p-2">{workflows.isLoading && <div className="p-4 text-sm text-slate-400">正在读取流程仓库…</div>}{workflowItems.map(workflow => { const definition = decodeJson(workflow.definition) as Definition; const selected = workflow.id === selectedId; return <button key={workflow.id} onClick={() => { setSelectedWorkflowId(workflow.id); setSection("flows"); }} className={`mb-1 w-full rounded-md border p-3 text-left transition-colors ${selected ? "border-blue-200 bg-blue-50" : "border-transparent hover:border-slate-200 hover:bg-slate-50"}`}><div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-medium text-slate-800">{workflow.name}</p><span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${workflow.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{workflow.status === "published" ? "已发布" : "草稿"}</span></div><div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400"><span>{definition?.nodes?.length ?? 0} 节点</span><span>v{workflow.definitionVersion}</span></div></button>; })}{!workflows.isLoading && !workflowItems.length && <div className="m-2 rounded border border-dashed border-slate-200 p-4 text-center text-xs leading-5 text-slate-400">暂无可查看流程。需要系统分配 <code>workflow:create</code> 后新建流程。</div>}</div>
      </aside>
      <section className="min-w-0 flex-1">{section === "flows" && <FlowDesigner
        workflow={selectedWorkflow} definition={draftDefinition} name={draftName} setName={setDraftName} canEdit={canEdit} canPublish={canPublish} canRun={canRun} canManage={canManageMembers} members={(members.data ?? []) as any[]} candidates={(memberCandidates.data ?? []) as any[]} savePending={saveFlow.isPending} publishPending={publishFlow.isPending} runPending={runFlow.isPending} runInput={runInput} setRunInput={setRunInput} models={runtimeModels.data ?? []} onDefinitionChange={setDraftDefinition} onSave={saveCurrent} onPublish={() => selectedId && publishFlow.mutate({ id: selectedId })} onRun={startRun} onExport={exportCurrent} onImport={() => importRef.current?.click()} onDuplicate={() => { if (selectedId) duplicateFlow.mutate({ id: selectedId, name: `${draftName} · 副本` }); }} onDelete={() => { if (selectedId && window.confirm(`确定删除“${draftName}”及其运行记录吗？`)) deleteFlow.mutate({ id: selectedId }); }} onGrant={(userId, role, hours) => { if (selectedId) grantMember.mutate({ workflowId: selectedId, userId, role, expiresAt: hours ? new Date(Date.now() + hours * 60 * 60 * 1000) : undefined }); }} onRevoke={(userId, role) => { if (selectedId) revokeMember.mutate({ workflowId: selectedId, userId, role }); }} />}
        {section === "runs" && <RunCenter runs={runs.data ?? []} selectedRun={runDetail.data ?? null} onSelect={setSelectedRunId} />}
        {section === "iam" && user.role === "admin" && <IamCenter users={users.data ?? []} roles={roles.data ?? []} audit={audit.data ?? []} form={userForm} setForm={setUserForm} onCreate={() => createUser.mutate({ ...userForm, email: userForm.email || undefined })} creating={createUser.isPending} onToggleStatus={(id, status) => updateUserStatus.mutate({ userId: id, status: status === "active" ? "disabled" : "active" })} />}
      </section>
    </div>
    <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={importDefinition} />
  </main>;
}

function FlowDesigner({ workflow, definition, name, setName, canEdit, canPublish, canRun, canManage, members, candidates, savePending, publishPending, runPending, runInput, setRunInput, models, onDefinitionChange, onSave, onPublish, onRun, onExport, onImport, onDuplicate, onDelete, onGrant, onRevoke }: { workflow: any; definition: Definition | null; name: string; setName: (value: string) => void; canEdit: boolean; canPublish: boolean; canRun: boolean; canManage: boolean; members: any[]; candidates: any[]; savePending: boolean; publishPending: boolean; runPending: boolean; runInput: string; setRunInput: (value: string) => void; models: Array<{ id: string; ownedBy: string }>; onDefinitionChange: (definition: Definition) => void; onSave: () => void; onPublish: () => void; onRun: () => void; onExport: () => void; onImport: () => void; onDuplicate: () => void; onDelete: () => void; onGrant: (userId: number, role: "owner" | "editor" | "operator" | "viewer", hours?: number) => void; onRevoke: (userId: number, role: "owner" | "editor" | "operator" | "viewer") => void }) {
  const [candidateId, setCandidateId] = useState("");
  const [memberRole, setMemberRole] = useState<"owner" | "editor" | "operator" | "viewer">("viewer");
  const [hours, setHours] = useState("");
  if (!workflow || !definition) return <div className="grid min-h-[calc(100vh-56px)] place-items-center p-8"><div className="max-w-md text-center"><FolderKanban className="mx-auto text-slate-300" size={42} /><h2 className="mt-4 font-semibold text-slate-700">选择或创建一个流程</h2><p className="mt-2 text-sm leading-6 text-slate-500">流程仓库显示了你拥有或被授予查看权限的工作流。</p></div></div>;
  return <div className="p-4 lg:p-6"><div className="mb-4 flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-xs text-slate-400"><FolderKanban size={13} />业务流程<ChevronRight size={13} />设计器</div><Input className="mt-1 h-9 max-w-md border-transparent bg-transparent px-0 text-xl font-semibold shadow-none focus-visible:border-blue-300 focus-visible:ring-0 disabled:opacity-100" value={name} disabled={!canEdit} onChange={event => setName(event.target.value)} /></div><div className="flex flex-wrap items-center gap-2"><Button variant="outline" size="sm" onClick={onImport} disabled={!canEdit}><Upload size={14} />导入</Button><Button variant="outline" size="sm" onClick={onExport}><Download size={14} />导出</Button><Button size="sm" variant="outline" onClick={onSave} disabled={!canEdit || savePending}>{savePending ? <Loader2 className="animate-spin" size={14} /> : <FileJson size={14} />}保存</Button><Button size="sm" className="bg-emerald-600 hover:bg-emerald-500" onClick={onPublish} disabled={!canPublish || publishPending}>{publishPending && <Loader2 className="animate-spin" size={14} />}发布</Button>{canManage && <><Button variant="outline" size="sm" onClick={onDuplicate}><Copy size={14} />复制</Button><Button variant="outline" size="sm" className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={onDelete}><Trash2 size={14} />删除</Button></>}</div></div>
    <div className="mb-4 grid gap-4 xl:grid-cols-[1fr_320px]"><div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-950"><div className="flex items-center gap-2 font-semibold"><LockKeyhole size={15} />权限感知设计器</div><p className="mt-1 text-xs leading-5 text-blue-700">{canEdit ? "你可编辑画布并保存版本。" : "当前为只读授权；仍可查看定义与运行反馈。"} LLM 节点会使用服务端运行时模型目录，当前已发现 {models.length} 个可用模型。</p><details className="mt-3 rounded border border-blue-200 bg-white/80 p-2 text-[11px]"><summary className="cursor-pointer font-semibold text-blue-900">协作成员与有效期（{members.length}）</summary><div className="mt-2 grid gap-1.5">{members.map(member => <div key={member.id} className="grid grid-cols-[1fr_auto] items-center gap-2 rounded border border-blue-100 bg-white px-2 py-1.5"><div><span className="font-medium">{member.name || member.username || `用户 ${member.userId}`}</span><span className="ml-2 text-blue-600">{member.role}</span><p className="mt-0.5 text-[10px] text-slate-400">生效：{formatTime(member.effectiveFrom)} · 到期：{member.expiresAt ? formatTime(member.expiresAt) : "长期"}</p></div><div className="flex items-center gap-1"><span className={`rounded px-1.5 py-0.5 text-[10px] ${member.revokedAt ? "bg-slate-200 text-slate-600" : "bg-emerald-100 text-emerald-700"}`}>{member.revokedAt ? "已撤销" : "有效"}</span>{canManage && !member.revokedAt && <button type="button" className="text-[10px] text-red-600 hover:underline" onClick={() => onRevoke(member.userId, member.role)}>撤销</button>}</div></div>)}{!members.length && <span className="text-blue-500">暂无可见协作成员。</span>}</div></details>{canManage && <form className="mt-3 grid gap-2 rounded border border-dashed border-blue-300 bg-white p-2 text-[11px]" onSubmit={event => { event.preventDefault(); const userId = Number(candidateId); if (!userId) return; onGrant(userId, memberRole, hours ? Number(hours) : undefined); setCandidateId(""); setHours(""); }}><p className="font-semibold text-blue-900">授予流程成员</p><select className="h-8 rounded border border-slate-200 bg-white px-2" value={candidateId} onChange={event => setCandidateId(event.target.value)} required><option value="">选择内部账号</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.username}（{candidate.username}）</option>)}</select><div className="grid grid-cols-2 gap-2"><select className="h-8 rounded border border-slate-200 bg-white px-2" value={memberRole} onChange={event => setMemberRole(event.target.value as typeof memberRole)}><option value="viewer">查看者</option><option value="operator">运行者</option><option value="editor">编辑者</option><option value="owner">所有者</option></select><input className="h-8 rounded border border-slate-200 px-2" type="number" min="1" placeholder="有效期小时（可选）" value={hours} onChange={event => setHours(event.target.value)} /></div><Button className="h-8 bg-blue-600 text-xs hover:bg-blue-500" type="submit">授予成员</Button></form>}</div><div className="rounded-lg border border-slate-200 bg-white p-3"><div className="flex items-center gap-2 text-xs font-semibold text-slate-600"><CirclePlay size={14} className="text-emerald-600" />运行输入</div><textarea className="mt-2 h-20 w-full rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] outline-none focus:border-blue-400" value={runInput} onChange={event => setRunInput(event.target.value)} /><Button className="mt-2 w-full bg-blue-600 hover:bg-blue-500" size="sm" disabled={!canRun || runPending} onClick={onRun}>{runPending ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}后端运行</Button></div></div>
    <WorkflowCanvas workflowId={workflow.id} definition={definition} readOnly={!canEdit} onDefinitionChange={onDefinitionChange} />
  </div>;
}

function RunCenter({ runs, selectedRun, onSelect }: { runs: any[]; selectedRun: any; onSelect: (id: string) => void }) {
  return <div className="p-4 lg:p-6"><div className="mb-5"><p className="text-xs font-bold tracking-[.18em] text-blue-600">RUNTIME OBSERVABILITY</p><h2 className="mt-1 text-xl font-semibold">执行历史与节点日志</h2></div><div className="grid gap-5 xl:grid-cols-[420px_1fr]"><section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">近期运行</div><div className="max-h-[650px] overflow-y-auto">{runs.map(run => <button key={run.id} onClick={() => onSelect(run.id)} className={`w-full border-b border-slate-100 p-4 text-left hover:bg-slate-50 ${selectedRun?.id === run.id ? "bg-blue-50" : ""}`}><div className="flex justify-between gap-2"><code className="text-xs text-slate-500">{run.id.slice(0, 8)}</code><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${run.status === "success" ? "bg-emerald-100 text-emerald-700" : run.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>{run.status}</span></div><div className="mt-2 flex gap-3 text-[11px] text-slate-400"><span>{formatTime(run.createdAt)}</span><span>{run.durationMs ?? "—"} ms</span></div></button>)}{!runs.length && <p className="p-6 text-center text-sm text-slate-400">尚无运行记录。</p>}</div></section><section className="min-h-80 rounded-lg border border-slate-200 bg-white p-5">{selectedRun ? <><div className="flex items-start justify-between"><div><p className="text-xs font-bold tracking-[.18em] text-slate-400">RUN {selectedRun.id.slice(0, 8)}</p><h3 className="mt-1 font-semibold">{selectedRun.status === "success" ? "运行成功" : "运行详情"}</h3></div><span className="text-xs text-slate-400">{selectedRun.durationMs ?? "—"} ms</span></div><div className="mt-5 grid gap-3">{selectedRun.nodeRuns?.map((node: any) => <details key={node.id} className="rounded border border-slate-200 bg-slate-50 p-3"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${node.status === "success" ? "bg-emerald-500" : node.status === "failed" ? "bg-red-500" : "bg-slate-400"}`} />{node.nodeName}<code className="text-[10px] text-slate-400">{node.nodeType}</code></span><span className="text-xs text-slate-400">{node.durationMs ?? "—"} ms</span></summary><div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 text-xs"><LogBlock title="输入" value={decodeJson(node.inputJson)} /><LogBlock title="输出" value={decodeJson(node.outputJson)} /><LogBlock title="错误" value={decodeJson(node.errorJson)} /></div></details>)}</div></> : <div className="grid h-full place-items-center text-center text-sm text-slate-400"><div><Clock3 className="mx-auto" size={28} /><p className="mt-3">从左侧选择一次运行以查看节点级日志。</p></div></div>}</section></div></div>;
}

function LogBlock({ title, value }: { title: string; value: unknown }) { if (value === null || value === undefined) return null; return <div><p className="mb-1 font-semibold text-slate-500">{title}</p><pre className="max-h-48 overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-5 text-emerald-200">{JSON.stringify(value, null, 2)}</pre></div>; }

function IamCenter({ users, roles, audit, form, setForm, onCreate, creating, onToggleStatus }: { users: any[]; roles: any[]; audit: any[]; form: { username: string; name: string; password: string; email: string; role: "user" | "admin" }; setForm: (next: any) => void; onCreate: () => void; creating: boolean; onToggleStatus: (id: number, status: "active" | "disabled") => void }) {
  return <div className="space-y-5 p-4 lg:p-6"><div><p className="text-xs font-bold tracking-[.18em] text-blue-600">IDENTITY & AUTHORIZATION</p><h2 className="mt-1 text-xl font-semibold">内部账号与权限中心</h2></div><section className="rounded-lg border border-slate-200 bg-white p-5"><h3 className="font-semibold">创建内部账号</h3><form className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5" onSubmit={event => { event.preventDefault(); onCreate(); }}><Input placeholder="用户名" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} required /><Input placeholder="显示名称" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /><Input type="password" minLength={12} placeholder="至少 12 位密码" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required /><Input type="email" placeholder="邮箱（可选）" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /><Button disabled={creating}>{creating && <Loader2 className="animate-spin" size={14} />}创建账号</Button></form></section><div className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]"><section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="border-b border-slate-100 px-5 py-3 font-semibold">用户目录</div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3">账号</th><th className="px-5 py-3">系统角色</th><th className="px-5 py-3">状态</th><th className="px-5 py-3">最后登录</th><th className="px-5 py-3" /></tr></thead><tbody>{users.map(account => <tr key={account.id} className="border-t border-slate-100"><td className="px-5 py-3"><p className="font-medium">{account.name || account.username}</p><p className="text-xs text-slate-400">{account.username}</p></td><td className="px-5 py-3">{account.role}</td><td className="px-5 py-3"><span className={`rounded px-2 py-1 text-xs ${account.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{account.status}</span></td><td className="px-5 py-3 text-xs text-slate-500">{formatTime(account.lastSignedIn)}</td><td className="px-5 py-3"><Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onToggleStatus(account.id, account.status)}>{account.status === "active" ? "停用" : "启用"}</Button></td></tr>)}</tbody></table></div></section><section className="rounded-lg border border-slate-200 bg-white"><div className="border-b border-slate-100 px-5 py-3 font-semibold">角色目录</div><div className="max-h-80 overflow-y-auto p-4">{roles.map(role => <div key={role.id} className="mb-3 rounded border border-slate-100 bg-slate-50 p-3"><div className="flex items-center justify-between"><p className="font-mono text-xs font-semibold text-indigo-700">{role.code}</p><span className="text-[10px] text-slate-400">{role.scope}</span></div><p className="mt-1 text-xs text-slate-500">{role.name}</p></div>)}</div></section></div><section className="rounded-lg border border-slate-200 bg-white"><div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 font-semibold"><SlidersHorizontal size={15} />近期授权审计</div><div className="max-h-64 overflow-y-auto">{audit.map(item => <div key={item.id} className="flex items-center justify-between gap-4 border-b border-slate-50 px-5 py-3 text-xs"><div><span className="font-mono text-slate-500">{item.action}</span><span className="ml-3 text-slate-700">{item.actorUsername || "系统"} → {item.targetUsername || "—"}</span></div><span className="text-slate-400">{formatTime(item.createdAt)}</span></div>)}{!audit.length && <p className="p-5 text-sm text-slate-400">暂未记录授权事件。</p>}</div></section></div>;
}
