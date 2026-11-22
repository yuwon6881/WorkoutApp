import { BicepsFlexed, Dumbbell, LayoutDashboard, Library } from 'lucide-react';
import type { Tab } from './useTabNavigation';
import type { LazyView } from './lazyViews';
import type { Tone } from '../lib/exerciseCategory';

export interface NavItem {
  id: Tab;
  label: string;
  icon: typeof LayoutDashboard;
  /** The data colour of the destination's icon, so each place in the app has its own. */
  tone: Tone;
}

/** The four destinations shared by the sidebar, the medium rail, and the phone dock. */
export const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, tone: 'accent' },
  { id: 'program', label: 'Workouts', icon: Dumbbell, tone: 'blue' },
  { id: 'body', label: 'Muscles', icon: BicepsFlexed, tone: 'teal' },
  { id: 'exercises', label: 'Exercises', icon: Library, tone: 'amber' }
];

/** The view code a destination needs, warmed when its navigation item is hovered or focused. */
export function navView(tab: Tab): LazyView {
  return tab === 'program' ? 'programs' : tab === 'body' ? 'muscles' : tab === 'exercises' ? 'exercises' : 'workout';
}

/** The destination a tab belongs to: Import is reached from, and returns to, Workouts. */
export function navSection(tab: Tab): Tab {
  return tab === 'import' ? 'program' : tab;
}

/** `page` for the destination itself, `true` for the section a sub-page (Import) sits in. */
export function navCurrent(tab: Tab, item: Tab): 'page' | 'true' | undefined {
  if (tab === item) return 'page';
  return navSection(tab) === item ? 'true' : undefined;
}
