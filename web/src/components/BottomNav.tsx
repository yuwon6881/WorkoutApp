import { Play, Plus } from 'lucide-react';
import { Button } from './ui/Button';
import { SelectionIndicator } from './ui/Motion';
import { NAV, navCurrent, navSection, navView } from '../app/navigation';
import { prefetchView } from '../app/lazyViews';
import type { Tab } from '../app/useTabNavigation';

/** What the dock's centre button does now: reopen the open workout, preview the queued one, or pick one. */
export type DockAction = 'resume' | 'start' | 'choose';

export const DOCK_ACTION_LABEL: Record<DockAction, string> = {
  resume: 'Resume workout',
  start: 'Start next workout',
  choose: 'Choose a workout'
};

interface BottomNavProps {
  tab: Tab;
  onTab: (tab: Tab) => void;
  action: DockAction;
  actionBusy: boolean;
  onAction: () => void;
}

/** The phone dock: two destinations either side of a raised round workout action. */
export function BottomNav({ tab, onTab, action, actionBusy, onAction }: BottomNavProps) {
  const half = NAV.length / 2;
  const item = (entry: (typeof NAV)[number]) => (
    <Button
      key={entry.id}
      data-selection-key={entry.id}
      onPointerEnter={() => prefetchView(navView(entry.id))}
      onFocus={() => prefetchView(navView(entry.id))}
      variant="tertiary"
      className={`bottom-nav-item ${navSection(tab) === entry.id ? 'selected' : ''}`}
      aria-label={entry.label}
      aria-current={navCurrent(tab, entry.id)}
      onClick={() => onTab(entry.id)}
    >
      <span className="bottom-nav-icon-slot">
        <entry.icon size={20} />
      </span>
      <span className="bottom-nav-label">{entry.label}</span>
    </Button>
  );
  const ActionIcon = action === 'choose' ? Plus : Play;

  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      <SelectionIndicator active={navSection(tab)} className="bottom-nav-track">
        {NAV.slice(0, half).map(item)}
        <Button
          variant="primary"
          className="bottom-nav-action"
          aria-label={DOCK_ACTION_LABEL[action]}
          disabled={actionBusy}
          onPointerEnter={() => prefetchView(action === 'start' ? 'workoutPreview' : 'workout')}
          onClick={onAction}
        >
          <ActionIcon size={24} strokeWidth={2.4} aria-hidden="true" />
        </Button>
        {NAV.slice(half).map(item)}
      </SelectionIndicator>
    </nav>
  );
}
