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
    const measuredHeight = Math.min(layer.scrollHeight, resolvedMaxHeight);
    const opensAbove = availableBelow < measuredHeight && availableAbove > availableBelow;

    let left: number;
    let widthStyle: CSSProperties = {};

    if (matchTriggerWidth) {
      const desiredWidth = Math.max(minWidth, Math.min(maxWidth, Math.max(triggerRect.width, 140)));
      left = Math.min(
        Math.max(viewportPadding, triggerRect.left),
        window.innerWidth - desiredWidth - viewportPadding
      );
      widthStyle = {
        width: `${desiredWidth}px`,
        minWidth: `${minWidth}px`,
        maxWidth: 'calc(100vw - 16px)'
      };
    } else {
      const measuredWidth = Math.max(minWidth, Math.min(maxWidth, layer.scrollWidth || triggerRect.width));
      if (align === 'end') {
        const right = Math.max(viewportPadding, window.innerWidth - triggerRect.right);
        const maxAvailable = Math.max(minWidth, window.innerWidth - right - viewportPadding);
        const resolvedMaxWidth = Math.min(maxWidth, maxAvailable);
        left = 0; // Not used when right is specified
        widthStyle = {
          minWidth: `min(${minWidth}px, calc(100vw - 16px))`,
          maxWidth: `min(${resolvedMaxWidth}px, calc(100vw - 16px))`
        };
      } else {
        left = Math.min(
          Math.max(viewportPadding, triggerRect.left),
          window.innerWidth - measuredWidth - viewportPadding
        );
        widthStyle = {
          minWidth: `min(${minWidth}px, calc(100vw - 16px))`,
          maxWidth: `min(${maxWidth}px, calc(100vw - 16px))`
        };
      }
    }

    const top = opensAbove
      ? Math.max(viewportPadding, triggerRect.top - measuredHeight - offset)
      : Math.min(window.innerHeight - measuredHeight - viewportPadding, triggerRect.bottom + offset);

    const isEndAligned = !matchTriggerWidth && align === 'end';
    setStyle({
      position: 'fixed',
      left: isEndAligned ? 'auto' : `${left}px`,
      right: isEndAligned ? `${Math.max(viewportPadding, window.innerWidth - triggerRect.right)}px` : 'auto',
      top: `${top}px`,
      ...widthStyle,
      maxHeight: `${resolvedMaxHeight}px`,
      zIndex: 1000
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
    window.addEventListener('resize', handleScroll);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('resize', handleScroll);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [open, portalTarget, positionLayer, ...dependencies]);

  return { portalTarget, style, positionLayer };
}
