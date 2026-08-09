"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders its children into `document.body` instead of wherever the
 * component happens to be mounted in the tree.
 *
 * WHY THIS EXISTS
 *
 * `position: fixed` is supposed to anchor to the viewport, but the CSS spec
 * carves out an exception: if ANY ancestor has a `transform`, `filter`, or
 * `backdrop-filter`, that ancestor becomes the fixed element's containing
 * block instead of the viewport. The header pill has
 * `backdrop-filter: blur(...)` for its frosted-glass look, so any
 * `fixed inset-0` modal opened from inside it — My Tokens, Notifications,
 * Connect X, all triggered from the profile dropdown in that pill — was
 * being pinned to the ~62px pill instead of the screen, which is what
 * produced the "opens in a odd place near the top" bug.
 *
 * A portal sidesteps the whole class of bug rather than working around
 * this one instance: the modal's DOM position becomes independent of
 * wherever the component that opens it happens to render.
 *
 * Guarded by a mount check because `document` does not exist during SSR;
 * the modal already renders nothing until `open` is true, so this adds no
 * visible delay.
 */
export default function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
