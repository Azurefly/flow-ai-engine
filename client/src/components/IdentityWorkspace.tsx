import React, { useState, type ReactNode } from "react";
import {
  Building2,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  ClipboardList,
  UsersRound,
} from "lucide-react";
import {
  formatConsoleRoute,
  type ConsoleRoute,
  type IdentityTab,
} from "@shared/console-route";
import { shouldHandlePrimaryNavigationClick } from "@shared/primary-navigation";

const items = [
  { id: "users", label: "用户账号", icon: UsersRound },
  { id: "roles", label: "角色与权限", icon: KeyRound },
  { id: "organization", label: "组织架构", icon: Building2 },
  { id: "audit", label: "授权审计", icon: ClipboardList },
] as const;

export function IdentityWorkspace({
  active,
  onNavigate,
  children,
}: {
  active: IdentityTab | "organization";
  onNavigate: (route: ConsoleRoute) => void;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div
      data-aiflow-identity-page=""
      className="aiflow-page-frame bg-background"
    >
      <div
        data-navigation-collapsed={collapsed}
        className="aiflow-page-content aiflow-split-layout grid items-start gap-4"
      >
        <aside
          data-identity-navigation
          className="overflow-hidden rounded-lg border border-border bg-card p-2"
        >
          <div
            className={`flex items-center gap-2 border-b border-border px-3 py-3 ${collapsed ? "justify-center" : "justify-between"}`}
          >
            {!collapsed && (
              <h2 className="aiflow-type-section-title font-semibold">
                用户与权限
              </h2>
            )}
            <button
              type="button"
              className="grid h-9 w-9 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
              aria-label={
                collapsed ? "展开用户与权限导航" : "收起用户与权限导航"
              }
              title={collapsed ? "展开用户与权限导航" : "收起用户与权限导航"}
              onClick={() => setCollapsed(value => !value)}
            >
              {collapsed ? (
                <PanelLeftOpen size={17} />
              ) : (
                <PanelLeftClose size={17} />
              )}
            </button>
          </div>
          <nav aria-label="用户与权限分类" className="mt-2 grid gap-1">
            {items.map(item => {
              const route: ConsoleRoute =
                item.id === "organization"
                  ? { section: "system", view: "organization" }
                  : {
                      section: "system",
                      view: "identity",
                      ...(item.id === "users" ? {} : { identityTab: item.id }),
                    };
              return (
                <a
                  key={item.id}
                  href={formatConsoleRoute(route)}
                  aria-label={item.label}
                  title={collapsed ? item.label : undefined}
                  aria-current={active === item.id ? "page" : undefined}
                  className={`aiflow-module-link ${collapsed ? "justify-center" : ""}`}
                  onClick={event => {
                    if (shouldHandlePrimaryNavigationClick(event)) {
                      event.preventDefault();
                      onNavigate(route);
                    }
                  }}
                >
                  <item.icon size={16} className="shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </a>
              );
            })}
          </nav>
        </aside>
        <div data-identity-content className="min-w-0">
          {children}
        </div>
      </div>
    </div>
  );
}
