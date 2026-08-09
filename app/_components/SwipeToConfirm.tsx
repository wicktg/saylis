"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "@/app/_components/Icon";

/**
 * Slide-to-confirm: a handle you drag from one end of a track to the other
 * to commit an action.
 *
 * Used for trades, where an accidental tap costs real money. A button fires
 * on a single click that a mis-tap or a double-tap can produce by accident;
 * a deliberate drag across most of the control's width essentially cannot
 * happen without intent.
 *
 * WHY POINTER EVENTS
 *
 * One code path covers mouse, touch and pen. The alternative is parallel
 * mouse* and touch* handlers that drift apart, plus their own logic for
 * which one to ignore when a device fires both. `setPointerCapture` also
 * means the drag keeps tracking after the pointer leaves the element, so
 * moving fast or sliding off the top edge does not silently abandon it.
 *
 * `touch-action: none` on the handle is what stops a phone treating the
 * horizontal drag as a page scroll.
 *
 * ACCESSIBILITY
 *
 * The handle is a real button. Enter and Space confirm directly, so this
 * never becomes an action reachable only by dragging — a keyboard or
 * switch user is not asked to perform a gesture they cannot make.
 */
export default function SwipeToConfirm({
  label,
  busyLabel,
  onConfirm,
  disabled = false,
  busy = false,
}: {
  label: string;
  busyLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const maxRef = useRef(0);

  const locked = disabled || busy;

  // Travel available to the handle: the track's inner width minus the
  // handle itself, both measured rather than assumed, so the control works
  // at any width its container gives it.
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 0;
    const max = track.clientWidth - HANDLE_PX - PAD_PX * 2;
    maxRef.current = Math.max(0, max);
    return maxRef.current;
  }, []);

  useEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      measure();
      setDragX((x) => Math.min(x, maxRef.current));
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [measure]);

  // Snap home whenever the control becomes unusable, so it never sits
  // half-dragged behind a disabled state.
  useEffect(() => {
    if (disabled) setDragX(0);
  }, [disabled]);

  // ...and again the moment a trade stops being in flight. The handle is
  // deliberately parked at the far end while the wallet prompt is up, so
  // without this a REJECTED or failed trade would leave it stranded there
  // with no travel left to swipe again.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) setDragX(0);
    wasBusy.current = busy;
  }, [busy]);

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (locked) return;
    measure();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!dragging || locked) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    // Position the handle's centre under the pointer, then clamp.
    const raw = event.clientX - rect.left - PAD_PX - HANDLE_PX / 2;
    setDragX(Math.min(Math.max(0, raw), maxRef.current));
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setDragging(false);

    const max = maxRef.current;
    if (max > 0 && dragX >= max * CONFIRM_AT) {
      // Park it at the end so the control reads as committed while the
      // wallet prompt is up, rather than snapping back under the dialog.
      setDragX(max);
      onConfirm();
    } else {
      setDragX(0);
    }
  }

  const progress = maxRef.current > 0 ? dragX / maxRef.current : 0;

  return (
    <div
      ref={trackRef}
      className={`swipe-track ${locked ? "is-locked" : ""}`}
    >
      <span className="swipe-fill" style={{ width: `${dragX + HANDLE_PX + PAD_PX}px` }} />

      <span className="swipe-label" style={{ opacity: busy ? 1 : 1 - progress * 1.4 }}>
        {busy ? busyLabel : label}
      </span>

      <button
        type="button"
        disabled={locked}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!locked) onConfirm();
          }
        }}
        aria-label={label}
        className="swipe-handle"
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragging ? "none" : "transform 0.22s var(--ease)",
        }}
      >
        <Icon icon={busy ? "pixelarticons:reload" : "pixelarticons:chevron-right"} className="text-base" />
      </button>
    </div>
  );
}

/** Handle diameter and the track's inner padding, in px. Mirrored in the
 *  `.swipe-*` rules; kept here because the drag maths needs the numbers. */
const HANDLE_PX = 40;
const PAD_PX = 4;

/** Fraction of the track that counts as a committed swipe. Short of 1 so
 *  the gesture does not require pixel-perfect travel to the very end. */
const CONFIRM_AT = 0.9;
