import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message ?? "";
      const assetLoadFailure =
        /failed to fetch dynamically imported module|importing a module script failed|loading chunk [^\s]* failed/i.test(
          message
        );

      return (
        <main
          role="alert"
          className="flex min-h-screen items-center justify-center bg-background p-5 sm:p-8"
        >
          <section className="flex w-full max-w-xl flex-col items-center px-2 py-8 text-center sm:px-8">
            <AlertTriangle
              size={36}
              aria-hidden="true"
              className="mb-5 shrink-0 text-destructive"
            />

            <h1 className="aiflow-type-page-title font-semibold text-foreground">
              {assetLoadFailure ? "页面内容未能加载" : "页面暂时无法显示"}
            </h1>

            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
              {assetLoadFailure
                ? "页面资源可能刚刚更新，或网络暂时中断。请刷新后加载当前版本；尚未保存的内容可能不会保留。"
                : "页面加载时遇到问题。请刷新页面后重试；如果问题仍然出现，请联系管理员。"}
            </p>

            {!assetLoadFailure && message && (
              <details className="mt-5 w-full rounded-lg border border-border bg-muted/50 text-left">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground">
                  查看错误详情
                </summary>
                <p className="break-words border-t border-border px-4 py-3 font-mono text-xs text-muted-foreground">
                  {message}
                </p>
              </details>
            )}

            <button
              type="button"
              onClick={() => window.location.reload()}
              className={cn(
                "mt-6 flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              )}
            >
              <RotateCcw size={16} aria-hidden="true" />
              刷新页面
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
