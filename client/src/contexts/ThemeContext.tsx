import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: (origin?: { clientX: number; clientY: number }) => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (switchable) {
      try {
        const stored = localStorage.getItem("theme");
        if (stored === "light" || stored === "dark") return stored;
      } catch {
        /* A blocked storage area must not prevent using the app. */
      }
    }
    return defaultTheme;
  });
  const transitioning = useRef(false);
  const wash = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    if (switchable) {
      try {
        localStorage.setItem("theme", theme);
      } catch {
        /* Keep the session theme. */
      }
    }
  }, [theme, switchable]);

  const toggleTheme = switchable
    ? (origin?: { clientX: number; clientY: number }) => {
        if (transitioning.current) return;
        const apply = () => {
          const next = theme === "light" ? "dark" : "light";
          document.documentElement.classList.toggle("dark", next === "dark");
          flushSync(() => setTheme(next));
        };
        // UX：先更新真实界面；装饰光晕不捕获快照，也不接管导航、输入或弹窗。
        apply();
        const layer = wash.current;
        if (
          !layer?.animate ||
          window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          return;
        }
        transitioning.current = true;
        const x = origin?.clientX || window.innerWidth - 40;
        const y = origin?.clientY || 28;
        const radius = Math.hypot(
          Math.max(x, innerWidth - x),
          Math.max(y, innerHeight - y)
        );
        try {
          const feedback = layer.animate(
            [
              { clipPath: `circle(0px at ${x}px ${y}px)`, opacity: 0.12 },
              { clipPath: `circle(${radius}px at ${x}px ${y}px)`, opacity: 0 },
            ],
            { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" }
          );
          void feedback.finished
            .catch(() => {})
            .finally(() => {
              transitioning.current = false;
            });
        } catch {
          transitioning.current = false;
        }
      }
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, switchable }}>
      {children}
      {switchable && <div ref={wash} data-theme-wash="" aria-hidden="true" />}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
