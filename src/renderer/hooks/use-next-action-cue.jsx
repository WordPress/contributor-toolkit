import { useEffect } from 'react';

// Brings the block the contributor should act on next into view when it changes,
// so their one hint is never left below the fold (#252). The mark itself is
// drawn by React — the `.next-action-cue` class the render binds to this same id
// — because a className survives re-render where an imperative one would be
// reconciled away; this handles only the movement, which no className can do.
//
// Gated on `isActive` because every SiteRow stays mounted at once: without it a
// background site could yank the viewport the moment its own state changed. It
// fires on a *change* of the id (or on becoming active), not on every render, so
// a contributor reading one block is not dragged off it by an unrelated update.
export function useNextActionCue(nextActionId, isActive, containerRef) {
  useEffect(() => {
    if (!isActive || !nextActionId) return;
    const root = containerRef.current;
    if (!root) return;
    const el = root.querySelector(`[data-next-action="${nextActionId}"]`);
    if (!el) return;
    // `center` brings the block clearly into view rather than just nudging it to
    // the nearest edge — the cue only fires when the target *changes*, so this
    // moves the viewport to whatever is newly worth looking at (a step that just
    // became current, an operation that just started) without fighting a
    // contributor mid-read. Reduced motion drops the smooth glide to an instant
    // jump.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [nextActionId, isActive, containerRef]);
}
