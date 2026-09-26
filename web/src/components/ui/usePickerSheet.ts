import { useEffect, useRef } from 'react';
import { useWindowTier } from '../../lib/breakpoints';
import { backStack } from '../../lib/backStack';

/// On a phone an option list opens as a bottom sheet in the thumb zone instead of a small
/// popover beside its trigger, and Back closes it like any other sheet. Wider layouts keep the
/// anchored popover. Returns whether the list should render as a sheet.
export function usePickerSheet(open: boolean, close: () => void): boolean {
  const sheet = useWindowTier() === 'compact';
  const latestClose = useRef(close);
  latestClose.current = close;

  useEffect(() => {
    if (!open || !sheet) return;
    return backStack()?.openOverlay(() => latestClose.current());
  }, [open, sheet]);

  return sheet;
}
