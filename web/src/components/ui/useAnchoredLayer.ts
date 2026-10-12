import { useCallback, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

export type AnchoredLayerOptions = {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  layerRef: RefObject<HTMLElement | null>;
  align?: 'start' | 'end';
  matchTriggerWidth?: boolean;
  minWidth?: number;
  maxWidth?: number;
  maxHeight?: number;
  offset?: number;
  dependencies?: unknown[];
};

export type AnchoredLayerGeometry = {
  triggerRect: Pick<DOMRectReadOnly, 'top' | 'bottom' | 'left' | 'right' | 'width'>;
  originRect: Pick<DOMRectReadOnly, 'top' | 'left' | 'width' | 'height'>;
  offsetWidth: number;
  offsetHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  align?: 'start' | 'end';
  matchTriggerWidth?: boolean;
  minWidth?: number;
  maxWidth?: number;
  maxHeight?: number;
  offset?: number;
};

const HIDDEN_LAYER_STYLE: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  visibility: 'hidden',
  pointerEvents: 'none'
};

export function computeAnchoredLayerStyle({
  triggerRect,
  originRect,
  offsetWidth,
  offsetHeight,
  scrollWidth,
  scrollHeight,
  viewportWidth,
  viewportHeight,
  align = 'start',
  matchTriggerWidth = false,
  minWidth = 120,
  maxWidth = 260,
  maxHeight = 260,
  offset = 5
}: AnchoredLayerGeometry): CSSProperties {
  const viewportPadding = 8;
  const availableBelow = Math.max(0, viewportHeight - triggerRect.bottom - viewportPadding);
  const availableAbove = Math.max(0, triggerRect.top - viewportPadding);
  const resolvedMaxHeight = Math.min(maxHeight, Math.max(120, Math.max(availableBelow, availableAbove)));

  const desiredTriggerWidth = Math.max(minWidth, Math.min(maxWidth, Math.max(triggerRect.width, 140)));
  const fallbackWidth = matchTriggerWidth
    ? desiredTriggerWidth
    : Math.max(minWidth, Math.min(maxWidth, scrollWidth || triggerRect.width));
  const measuredWidth = originRect.width > 0 ? originRect.width : fallbackWidth;
  const measuredHeight = originRect.height > 0
    ? Math.min(originRect.height, resolvedMaxHeight)
    : Math.min(scrollHeight, resolvedMaxHeight);
  const opensAbove = availableBelow < measuredHeight && availableAbove > availableBelow;

  const alignedLeft = !matchTriggerWidth && align === 'end'
    ? triggerRect.right - measuredWidth
    : triggerRect.left;
  const viewportLeft = Math.min(
    Math.max(viewportPadding, alignedLeft),
    Math.max(viewportPadding, viewportWidth - measuredWidth - viewportPadding)
  );
  const viewportTop = opensAbove
    ? Math.max(viewportPadding, triggerRect.top - measuredHeight - offset)
    : Math.min(
        Math.max(viewportPadding, viewportHeight - measuredHeight - viewportPadding),
        triggerRect.bottom + offset
      );

  // An ancestor with a transform or active transform animation becomes the containing block for
  // position: fixed descendants, shifting (0, 0) from the viewport to that ancestor's box.
  const scaleX = offsetWidth > 0 && originRect.width > 0 ? originRect.width / offsetWidth : 1;
  const scaleY = offsetHeight > 0 && originRect.height > 0 ? originRect.height / offsetHeight : 1;
  const left = (viewportLeft - originRect.left) / scaleX;
  const top = (viewportTop - originRect.top) / scaleY;

  const widthStyle: CSSProperties = matchTriggerWidth
    ? {
        width: `${desiredTriggerWidth}px`,
        minWidth: `${minWidth}px`,
        maxWidth: 'calc(100vw - 16px)'
      }
    : {
        minWidth: `min(${minWidth}px, calc(100vw - 16px))`,
        maxWidth: `min(${maxWidth}px, calc(100vw - 16px))`
      };

  return {
    position: 'fixed',
    left: `${left}px`,
    right: 'auto',
    top: `${top}px`,
    ...widthStyle,
    maxHeight: `${resolvedMaxHeight}px`,
    zIndex: 1000
  };
}

export function useAnchoredLayer({
  open,
  triggerRef,
  layerRef,
  align = 'start',
  matchTriggerWidth = false,
  minWidth = 120,
  maxWidth = 260,
  maxHeight = 260,
  offset = 5,
  dependencies = []
}: AnchoredLayerOptions) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  const positionLayer = useCallback(() => {
    const trigger = triggerRef.current;
    const layer = layerRef.current;
    if (!trigger || !layer) return;

    const triggerRect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const availableBelow = Math.max(0, window.innerHeight - triggerRect.bottom - viewportPadding);
    const availableAbove = Math.max(0, triggerRect.top - viewportPadding);
    const resolvedMaxHeight = Math.min(maxHeight, Math.max(120, Math.max(availableBelow, availableAbove)));
    const desiredTriggerWidth = Math.max(minWidth, Math.min(maxWidth, Math.max(triggerRect.width, 140)));

    const prevCssText = layer.style.cssText;
    layer.style.position = 'fixed';
    layer.style.top = '0px';
    layer.style.left = '0px';
    layer.style.right = 'auto';
    layer.style.bottom = 'auto';
    layer.style.transform = 'none';
    layer.style.width = matchTriggerWidth ? `${desiredTriggerWidth}px` : '';
    layer.style.minWidth = matchTriggerWidth ? `${minWidth}px` : `min(${minWidth}px, calc(100vw - 16px))`;
    layer.style.maxWidth = matchTriggerWidth ? 'calc(100vw - 16px)' : `min(${maxWidth}px, calc(100vw - 16px))`;
    layer.style.maxHeight = `${resolvedMaxHeight}px`;

    const originRect = layer.getBoundingClientRect();
    const offsetWidth = layer.offsetWidth;
    const offsetHeight = layer.offsetHeight;
    const scrollWidth = layer.scrollWidth;
    const scrollHeight = layer.scrollHeight;
    layer.style.cssText = prevCssText;

    const nextStyle = computeAnchoredLayerStyle({
      triggerRect,
      originRect,
      offsetWidth,
      offsetHeight,
      scrollWidth,
      scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      align,
      matchTriggerWidth,
      minWidth,
      maxWidth,
      maxHeight,
      offset
    });

    setStyle(prev => {
      if (
        prev &&
        prev.position === nextStyle.position &&
        prev.left === nextStyle.left &&
        prev.right === nextStyle.right &&
        prev.top === nextStyle.top &&
        prev.width === nextStyle.width &&
        prev.minWidth === nextStyle.minWidth &&
        prev.maxWidth === nextStyle.maxWidth &&
        prev.maxHeight === nextStyle.maxHeight
      ) {
        return prev;
      }
      return nextStyle;
    });
  }, [align, matchTriggerWidth, minWidth, maxWidth, maxHeight, offset, triggerRef, layerRef]);

  // Portaling the anchored layer keeps it above scrollers, clipped cards, drawers, and modal backdrops.
  useLayoutEffect(() => {
    if (!open) {
      setPortalTarget(null);
      setStyle(null);
      return;
    }
    const dialog = triggerRef.current?.closest('dialog')
      ?? [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].at(-1);
    setPortalTarget((dialog as HTMLElement | null) ?? document.body);
  }, [open, triggerRef]);

  useLayoutEffect(() => {
    if (!open || !portalTarget) return;
    positionLayer();
    const handleScroll = () => positionLayer();
    const handleMotionEnd = (event: Event) => {
      if (event.target !== layerRef.current) positionLayer();
    };
    window.addEventListener('resize', handleScroll);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('animationend', handleMotionEnd, true);
    document.addEventListener('transitionend', handleMotionEnd, true);
    return () => {
      window.removeEventListener('resize', handleScroll);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('animationend', handleMotionEnd, true);
      document.removeEventListener('transitionend', handleMotionEnd, true);
    };
  }, [open, portalTarget, positionLayer, layerRef, ...dependencies]);

  return { portalTarget, style: open ? (style ?? HIDDEN_LAYER_STYLE) : null, positionLayer };
}
