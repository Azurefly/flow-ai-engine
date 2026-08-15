import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Loader2, LogOut, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import WorkflowCanvas from "@/components/WorkflowCanvas";

export default function Home() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const [credentials, setCredentials] = useState({ username: "", password: "" });
  const login = trpc.auth.login.useMutation({ onSuccess: () => { void utils.auth.me.invalidate(); toast.success("登录成功"); }, onError: error => toast.error(error.message) });
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => { void utils.auth.me.invalidate(); toast.success("已安全退出"); } });
  if (me.isLoading) return <main className="min-h-screen grid place-items-center bg-slate-50 text-slate-500"><Loader2 className="animate-spin" />正在加载 Flow AI Engine</main>;
  if (!me.data) return <main className="min-h-screen grid place-items-center bg-slate-50 p-5"><section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50"><div className="mb-7"><div className="mb-4 inline-flex rounded-xl bg-blue-600 p-2 text-white"><ShieldCheck size={22} /></div><p className="text-xs font-bold tracking-[.18em] text-blue-600">FLOW AI ENGINE</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">内部账号登录</h1><p className="mt-2 text-sm leading-6 text-slate-500">以内部 IAM 身份体系访问工作流、运行记录与协作权限。</p></div><form className="grid gap-4" onSubmit={event => { event.preventDefault(); login.mutate(credentials); }}><div className="grid gap-2"><Label htmlFor="signin-username">用户名</Label><Input id="signin-username" value={credentials.username} onChange={event => setCredentials({ ...credentials, username: event.target.value })} autoComplete="username" required /></div><div className="grid gap-2"><Label htmlFor="signin-password">密码</Label><Input id="signin-password" type="password" minLength={12} value={credentials.password} onChange={event => setCredentials({ ...credentials, password: event.target.value })} autoComplete="current-password" required /></div><Button type="submit" className="mt-2" disabled={login.isPending}>{login.isPending && <Loader2 className="animate-spin" />}登录并进入流程中心</Button></form><p className="mt-5 text-xs leading-5 text-slate-400">账号由管理员创建；系统不提供公开注册。</p></section></main>;
  return <Dashboard user={me.data} onLogout={() => logout.mutate()} />;
}

function Dashboard({ user, onLogout }: { user: { id: number; username: string | null; name: string | null; role: "user" | "admin" }; onLogout: () => void }) {
  const utils = trpc.useUtils();
  const users = trpc.iam.users.useQuery(undefined, { enabled: user.role === "admin", retry: false });
  const [form, setForm] = useState({ username: "", name: "", password: "", email: "", role: "user" as "user" | "admin" });
  const create = trpc.iam.createUser.useMutation({ onSuccess: () => { setForm({ username: "", name: "", password: "", email: "", role: "user" }); void utils.iam.users.invalidate(); toast.success("内部账号已创建"); }, onError: error => toast.error(error.message) });
  const updateStatus = trpc.iam.updateUserStatus.useMutation({ onSuccess: () => void utils.iam.users.invalidate(), onError: error => toast.error(error.message) });
  return <main className="min-h-screen bg-slate-50 text-slate-800"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4"><div><p className="text-xs font-bold tracking-[.16em] text-blue-600">FLOW AI ENGINE</p><h1 className="text-lg font-semibold">流程中心与身份权限</h1></div><Button variant="outline" size="sm" onClick={onLogout}><LogOut size={15} />退出</Button></div></header><div className="mx-auto max-w-6xl space-y-6 px-6 py-8"><WorkflowCanvas />{user.role === "admin" && <section className="rounded-xl border border-slate-200 bg-white p-6"><h2 className="font-semibold">内部账号管理</h2><form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); create.mutate({ ...form, email: form.email || undefined }); }}><Input aria-label="用户名" placeholder="用户名" value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} required /><Input aria-label="显示名称" placeholder="显示名称" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /><Input aria-label="初始密码" type="password" placeholder="至少 12 位密码" minLength={12} value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required /><Button type="submit" disabled={create.isPending}>创建账号</Button></form></section>}</div></main>;
}
