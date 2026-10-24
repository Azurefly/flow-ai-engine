import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { availableEditorHeight } from "@shared/editor-viewport";

export function useEditorViewport(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  const [height, setHeight] = useState<number>();
  const previous = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      const element = ref.current;
      const next =
        enabled && element && window.matchMedia("(min-width: 1024px)").matches
          ? availableEditorHeight(
              window.visualViewport?.height ?? window.innerHeight,
              element.getBoundingClientRect().top + window.scrollY,
              Math.max(
                12,
                Number.parseFloat(
                  getComputedStyle(element.parentElement ?? element)
                    .paddingBottom
                ) || 0
              )
            )
          : undefined;
      if (next !== previous.current) {
        previous.current = next;
        setHeight(next);
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedule)
        : undefined;
    if (ref.current) {
      observer?.observe(ref.current);
      if (ref.current.parentElement)
        observer?.observe(ref.current.parentElement);
    }
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [enabled, ref]);
  return (
    height === undefined ? {} : { "--aiflow-editor-height": `${height}px` }
  ) as CSSProperties;
}
