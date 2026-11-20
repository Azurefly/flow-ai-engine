import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

const Home = lazy(() => import("./pages/Home"));
const NotFound = lazy(() => import("@/pages/NotFound"));

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  // The root page handles workbench navigation using the hash.
  const Page = window.location.pathname === "/" ? Home : NotFound;
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable={true}>
        <TooltipProvider>
          <Toaster />
          <Suspense
            fallback={
              <main className="grid min-h-screen place-items-center bg-card text-muted-foreground">
                <div
                  role="status"
                  aria-live="polite"
                  className="border border-border bg-card px-4 py-3 text-sm shadow-sm"
                >
                  正在加载流程工作台…
                </div>
              </main>
            }
          >
            <Page />
          </Suspense>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
