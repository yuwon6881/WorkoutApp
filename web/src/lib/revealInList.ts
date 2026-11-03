/**
 * Moves a list's own scroll position so one of its options is visible, and never the page.
 * `scrollIntoView` walks every scrollable ancestor; a menu reopened before it is positioned still
 * sits at the end of the document, so revealing its remembered option scrolled the whole page there.
 */
export function revealInList(list: HTMLElement, item: HTMLElement, block: 'nearest' | 'center' = 'nearest'): void {
  const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientTop + list.scrollTop;
  const bottom = top + item.offsetHeight;
  if (block === 'center') list.scrollTop = top - (list.clientHeight - item.offsetHeight) / 2;
  else if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}
