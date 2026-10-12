import { BicepsFlexed, Dumbbell, LayoutDashboard, Library } from 'lucide-react';
import type { Tab } from './useTabNavigation';
import type { LazyView } from './lazyViews';

export interface NavItem {
  id: Tab;
  label: string;
  icon: typeof LayoutDashboard;
}

/** The four destinations shared by the sidebar, the medium rail, and the phone dock. */
export const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'program', label: 'Workouts', icon: Dumbbell },
  { id: 'body', label: 'Muscles', icon: BicepsFlexed },
  { id: 'exercises', label: 'Exercises', icon: Library }
];

/** The view code a destination needs, warmed when its navigation item is hovered or focused. */
export function navView(tab: Tab): LazyView {
  return tab === 'program' ? 'programs' : tab === 'body' ? 'muscles' : tab === 'exercises' ? 'exercises' : 'workout';
}
