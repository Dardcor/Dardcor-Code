/**
 * Dardcor Code - Feature Capabilities Flags
 */

export const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
export const hasWebWorkers = typeof Worker !== 'undefined';
export const hasResizeObserver = typeof ResizeObserver !== 'undefined';
export const hasIntersectionObserver = typeof IntersectionObserver !== 'undefined';
export const hasPointerEvents = typeof window !== 'undefined' && !!window.PointerEvent;
