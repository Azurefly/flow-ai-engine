import React from "react";
import type { LucideIcon } from "lucide-react";
import { Gauge, LogOut, Menu, Moon, Search, Sun, X } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { formatConsoleRoute } from "@shared/console-route";
import {
  primaryWorkspaceRoute,
  shouldHandlePrimaryNavigationClick,
} from "@shared/primary-navigation";
type WorkspaceSection = Parameters<typeof primaryWorkspaceRoute>[0];

export function WorkspaceHeader({
  platformName,
  user,
  nav,
  activeSection,
  systemRootView,
  theme,
  onTheme,
  onSearch,
  onNavigate,
  onLogout,
  mobileOpen,
  onOpenMobile,
}: {
  platformName: string;
  user: { name?: string | null; username?: string | null; role: string };
  nav: { id: WorkspaceSection; label: string; icon: LucideIcon }[];
  activeSection: WorkspaceSection;
  systemRootView: Parameters<typeof primaryWorkspaceRoute>[1];
  theme?: string;
  onTheme?: () => void;
  onSearch: () => void;
  onNavigate: (section: WorkspaceSection) => void;
  onLogout: () => void;
  mobileOpen: boolean;
  onOpenMobile: () => void;
}) {
  const name = user.name || user.username || "内部用户";
  const role = user.role === "admin" ? "系统管理员" : "成员";
  return (
    <header
      data-workspace-header
      className="sticky top-0 z-30 border-b border-border bg-card text-foreground"
    >
      <div className="flex h-16 min-w-0 items-center">
        <button
          type="button"
          data-aiflow-mobile-nav-trigger
          className="grid h-12 w-12 place-items-center md:hidden"
          onClick={onOpenMobile}
          aria-label={mobileOpen ? "关闭工作区导航" : "打开工作区导航"}
          aria-expanded={mobileOpen}
          aria-controls="aiflow-mobile-navigation"
        >
          {mobileOpen ? <X size={17} /> : <Menu size={17} />}
        </button>
        <div
          data-aiflow-brand
          className="flex min-w-0 items-center gap-2.5 px-4"
        >
          <span data-workspace-brand-mark>
            <Gauge size={17} />
          </span>
          <span
            data-aiflow-brand-name
            className="min-w-0 truncate text-sm font-semibold"
            title={platformName}
          >
            {platformName}
          </span>
        </div>
        <nav
          data-aiflow-primary-nav
          aria-label="工作空间主导航"
          className="hidden min-w-0 items-stretch md:flex"
        >
          {nav.map(item => (
            <a
              key={item.id}
              id={`aiflow-console-nav-${item.id}`}
              aria-label={item.label}
              href={formatConsoleRoute(
                primaryWorkspaceRoute(item.id, systemRootView)
              )}
              aria-current={activeSection === item.id ? "page" : undefined}
              onClick={event => {
                if (shouldHandlePrimaryNavigationClick(event)) {
                  event.preventDefault();
                  onNavigate(item.id);
                }
              }}
              className="aiflow-type-control"
            >
              <item.icon size={16} />
              <span data-workspace-nav-label>{item.label}</span>
            </a>
          ))}
        </nav>
        <div
          data-aiflow-user-actions
          className="ml-auto flex shrink-0 items-center gap-2 px-4"
        >
          <Button
            data-workspace-search-trigger
            variant="outline"
            onClick={onSearch}
            aria-label="快捷查找业务、流程或页面"
            aria-keyshortcuts="Control+k Meta+k"
          >
            <Search size={16} />
            <span>搜索</span>
            <kbd className="text-xs text-muted-foreground">Ctrl K</kbd>
          </Button>
          {onTheme && (
            <Button
              data-aiflow-theme-toggle
              variant="ghost"
              size="icon"
              onClick={onTheme}
              aria-label={
                theme === "dark" ? "切换至浅色模式" : "切换至暗黑模式"
              }
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-workspace-account-trigger
                variant="ghost"
                size="icon"
                aria-label={`账户菜单：${name}`}
              >
                <span data-workspace-avatar>
                  {Array.from(name)[0].toLocaleUpperCase()}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>
                <span className="block break-words font-semibold">{name}</span>
                <span
                  data-workspace-account-role
                  className="mt-1 block text-xs font-normal text-muted-foreground"
                >
                  {role}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-aiflow-logout onSelect={onLogout}>
                <LogOut size={16} />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
