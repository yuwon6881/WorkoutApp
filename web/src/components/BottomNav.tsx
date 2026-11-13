import { ChevronUp, Play, Plus } from 'lucide-react';
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
  /** The open workout's share of working sets logged, drawn along the action's bottom edge. */
  actionProgress?: number | null;
}

/** The phone dock: two destinations either side of a raised round workout action. */
export function BottomNav({ tab, onTab, action, actionBusy, onAction, actionProgress = null }: BottomNavProps) {
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
  // An open workout reads differently from one waiting to start: the action opens it back up, and
  // its logged sets fill a line along the bottom edge, as the minimized bar's does.
  const ActionIcon = action === 'choose' ? Plus : action === 'resume' ? ChevronUp : Play;
  const resuming = action === 'resume' && actionProgress !== null;

  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      <SelectionIndicator active={navSection(tab)} className="bottom-nav-track">
        {NAV.slice(0, half).map(item)}
        <Button
          variant="primary"
          className={`bottom-nav-action ${resuming ? 'resuming' : ''}`.trim()}
          aria-label={DOCK_ACTION_LABEL[action]}
          disabled={actionBusy}
          onPointerEnter={() => prefetchView(action === 'start' ? 'workoutPreview' : 'workout')}
          onClick={onAction}
        >
          <ActionIcon size={24} strokeWidth={2.4} aria-hidden="true" />
          {resuming && <span className="bottom-nav-action-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, actionProgress ?? 0))})` }} />
          </span>}
        </Button>
        {NAV.slice(half).map(item)}
      </SelectionIndicator>
    </nav>
  );
}
