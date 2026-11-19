import { StrictMode, useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  BadgeCheck,
  Check,
  ClipboardList,
  GitBranch,
  RotateCcw,
  Send,
  UserCheck,
  Workflow,
} from "lucide-react";
import "@xyflow/react/dist/style.css";
import ApprovalCanvas from "./ApprovalCanvas";
import {
  advanceRun,
  nodesById,
  participantStatus,
  phases,
  readRun,
  reasonLimit,
  roles,
  saveRun,
  type DemoRun,
  type RoleId,
} from "./leave-demo";
import "./style.css";

const exampleReason = "参加职业技能培训";
const sourceUrl = "https://github.com/Azurefly/flow-ai-engine";
const stepIcons = [Send, UserCheck, BadgeCheck];
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "medium",
});

function ApprovalRecords({ run }: { run: DemoRun | null }) {
  return (
    <section className="panel records-panel" aria-labelledby="records-heading">
      <header className="panel-head">
        <h2 id="records-heading">审批记录</h2>
        {run && <span className="run-id">{run.id}</span>}
      </header>
      {run ? (
        <ol className="event-list">
          {run.events.map((at, index) => {
            const actor = roles[index];
            return (
              <li key={actor.id}>
                <span className="event-icon">
                  <Check size={15} aria-hidden="true" />
                </span>
                <div>
                  <strong>{actor.record}</strong>
                  <span>
                    {actor.name} · {actor.title}
                  </span>
                </div>
                <time dateTime={at}>{timeFormat.format(new Date(at))}</time>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="empty-records">
          <ClipboardList size={18} aria-hidden="true" />
          提交请假申请后，审批记录会显示在这里。
        </p>
      )}
    </section>
  );
}

function LeaveDemo() {
  const [run, setRun] = useState(readRun);
  const [roleId, setRoleId] = useState<RoleId>(
    () => (roles[run?.events.length ?? 0] ?? roles[0]).id
  );
  const [reason, setReason] = useState(exampleReason);
  const [reasonError, setReasonError] = useState(false);
  const [stored, setStored] = useState(true);
  const phaseIndex = run?.events.length ?? 0;
  const phase = phases[phaseIndex];
  const nextRole = roles[phaseIndex];

  useEffect(() => setStored(saveRun(run)), [run]);

  function recordAction() {
    const action = {
      role: roleId,
      reason,
      at: new Date().toISOString(),
      id: run?.id ?? "DEMO-" + crypto.randomUUID().slice(0, 8).toUpperCase(),
    };
    setRun(current => advanceRun(current, action));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) {
      setReasonError(true);
      return;
    }
    recordAction();
  }

  function reset() {
    if (run && !window.confirm("清除本次演示的申请和审批记录，重新开始？"))
      return;
    setRun(null);
    setRoleId("employee");
    setReason(exampleReason);
    setReasonError(false);
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-icon">
              <Workflow size={22} aria-hidden="true" />
            </span>
            <span>Flow AI Engine</span>
          </div>
          <div className="topbar-actions">
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="source-link"
            >
              <GitBranch size={16} aria-hidden="true" />
              源代码
            </a>
            <button
              type="button"
              className="button button-secondary"
              disabled={!run && reason === exampleReason}
              onClick={reset}
            >
              <RotateCcw size={16} aria-hidden="true" />
              重新开始
            </button>
          </div>
        </div>
      </header>
      <main className="shell">
        <div className="intro">
          <div>
            <span className="flow-kind">状态流程</span>
            <h1>员工请假审批</h1>
            <p>切换三种身份，体验从提交到两级审批的完整流转。</p>
          </div>
          <span className="demo-mode">浏览器模拟</span>
        </div>

        <ol className="steps" aria-label="审批进度">
          {roles.map((role, index) => {
            const Icon = index < phaseIndex ? Check : stepIcons[index];
            const current = index === phaseIndex;
            const done = index < phaseIndex;
            return (
              <li
                key={role.id}
                data-step={current ? "current" : done ? "done" : "future"}
                aria-current={current ? "step" : undefined}
              >
                <span className="step-icon">
                  <Icon size={19} aria-hidden="true" />
                </span>
                <span className="step-copy">
                  <strong>{role.action}</strong>
                  <small>
                    {done ? "已完成" : current ? "当前步骤" : "未开始"}
                  </small>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="workspace">
          <section
            className="panel workbench-panel"
            aria-labelledby="workbench-heading"
          >
            <header className="panel-head">
              <h2 id="workbench-heading">办理工作台</h2>
            </header>
            <div className="workbench-content">
              <div className="workbench-status">
                <span>申请状态</span>
                <strong
                  className="status"
                  data-complete={!nextRole}
                  role="status"
                >
                  <i />
                  {phase.title}
                </strong>
              </div>
              <div className="role-list" role="group" aria-label="切换演示身份">
                {roles.map((role, index) => {
                  const nodeId = phase.participantNodes[index];
                  const participant = nodeId
                    ? nodesById.get(nodeId)
                    : undefined;
                  return (
                    <button
                      className="role"
                      type="button"
                      key={role.id}
                      aria-pressed={roleId === role.id}
                      onClick={() => setRoleId(role.id)}
                    >
                      <span className="avatar" aria-hidden="true">
                        {role.name[0]}
                      </span>
                      <span className="role-person">
                        <strong>{role.title}</strong>
                        <small>{role.name}</small>
                      </span>
                      <span className="role-state">
                        {participantStatus(participant) ?? "尚未加入"}
                      </span>
                    </button>
                  );
                })}
              </div>

              {run && (
                <dl className="application">
                  <dt>请假原因</dt>
                  <dd>{run.reason}</dd>
                </dl>
              )}
              <div className="actions">
                {!nextRole ? (
                  <div className="result">
                    <BadgeCheck size={22} aria-hidden="true" />
                    <div>
                      <strong>审批完成</strong>
                      <p>直属上级和部门经理均已通过。</p>
                    </div>
                  </div>
                ) : roleId !== nextRole.id ? (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => setRoleId(nextRole.id)}
                  >
                    <UserCheck size={17} aria-hidden="true" />
                    切换至{nextRole.title}
                  </button>
                ) : run ? (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={recordAction}
                  >
                    <Check size={18} aria-hidden="true" />
                    {phaseIndex === 1 ? "通过并转交经理" : "批准请假"}
                  </button>
                ) : (
                  <form onSubmit={submit}>
                    <label htmlFor="leave-reason">请假原因</label>
                    <textarea
                      id="leave-reason"
                      rows={3}
                      value={reason}
                      maxLength={reasonLimit}
                      required
                      aria-invalid={reasonError}
                      aria-describedby={
                        reasonError ? "reason-error" : undefined
                      }
                      onChange={event => {
                        setReason(event.target.value);
                        setReasonError(false);
                      }}
                    />
                    {reasonError && (
                      <p className="field-error" id="reason-error">
                        请填写请假原因。
                      </p>
                    )}
                    <button className="button button-primary" type="submit">
                      <Send size={17} aria-hidden="true" />
                      提交请假申请
                    </button>
                  </form>
                )}
              </div>
            </div>
          </section>

          <ApprovalCanvas key={run?.id ?? "draft"} phaseIndex={phaseIndex} />
          <ApprovalRecords run={run} />
        </div>
        <footer className="footer">
          <span>
            {stored
              ? "示例进度保存在当前浏览器标签页。"
              : "当前浏览器无法保存进度，刷新将重新开始。"}
          </span>
          <a href="./LICENSE.txt" target="_blank" rel="noreferrer">
            非商业使用许可
          </a>
        </footer>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LeaveDemo />
  </StrictMode>
);
