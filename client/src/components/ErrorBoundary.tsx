import { cn } from "@/lib/utils";
import { createErrorReference, getErrorBoundaryPresentation } from "@/lib/error-reference";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorReference: string | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorReference: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorReference: createErrorReference(error) };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const reference = this.state.errorReference ?? createErrorReference(error);
    // Keep the reference alongside the original error in logs so support can
    // correlate a production report without rendering implementation details.
    console.error(`[ErrorBoundary ${reference}]`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const presentation = getErrorBoundaryPresentation(this.state.error, import.meta.env.DEV);
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-8" role="alert">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="mb-2 text-xl" id="error-boundary-title">{presentation.title}</h2>
            <p className="mb-4 text-center text-sm text-muted-foreground">{presentation.description}</p>

            <div className="mb-6 w-full rounded bg-muted p-4 text-center">
              <p className="text-sm text-muted-foreground">
                错误标识：<code className="font-mono font-semibold text-foreground">{this.state.errorReference ?? presentation.reference}</code>
              </p>
            </div>

            {presentation.debugDetails && (
              <details className="mb-6 w-full rounded bg-muted p-4 text-left">
                <summary className="cursor-pointer text-sm font-medium">开发调试信息</summary>
                <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {presentation.debugDetails}
                </pre>
              </details>
            )}

            <button
              type="button"
              aria-label="重新加载页面"
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              重新加载页面
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
