import { useLayoutEffect, useRef } from "react";
import { useMotionPreference } from "./useMotionPreference";

/** Animate a context change without remounting fields or taking their focus. */
export function useContextReveal<T extends HTMLElement>(
  identity: unknown,
  translate = true
) {
  const ref = useRef<T>(null);
  const { prefersReducedMotion } = useMotionPreference();
  useLayoutEffect(() => {
    if (!identity || prefersReducedMotion || !ref.current?.animate) return;
    const animation = ref.current.animate(
      translate
        ? [
            { opacity: 0.55, transform: "translateY(6px)" },
            { opacity: 1, transform: "translateY(0)" },
          ]
        : [{ opacity: 0.55 }, { opacity: 1 }],
      { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }
    );
    return () => animation.cancel();
  }, [identity, prefersReducedMotion, translate]);
  return ref;
}
