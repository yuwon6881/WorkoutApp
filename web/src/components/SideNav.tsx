import { Play, Plus, Settings, Sparkles } from 'lucide-react';
import { Button } from './ui/Button';
import { SelectionIndicator } from './ui/Motion';
import { NAV, navView } from '../app/navigation';
import { prefetchView } from '../app/lazyViews';
import { DOCK_ACTION_LABEL, type DockAction } from './BottomNav';
import type { Tab } from '../app/useTabNavigation';
import './SideNav.css';

export interface SideNavProps {
  tab: Tab;
  onTab: (tab: Tab) => void;
  action: DockAction;
  actionBusy: boolean;
  onAction: () => void;
  aiOpen: boolean;
  onAskAi: () => void;
  onSettings: () => void;
  displayName: string;
}

/** Two letters for an avatar: first letters of first two words, else first two chars. */
function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length > 1) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || 'W';
}

/** Side navigation for expanded (>=1024px) column and medium (640-1023px) rail. */
export function SideNav({
  tab,
  onTab,
  action,
  actionBusy,
  onAction,
  aiOpen,
  onAskAi,
  onSettings,
  displayName
}: SideNavProps) {
  const ActionIcon = action === 'choose' ? Plus : Play;

  return (
    <aside className="sidebar">
      <a
        className="brand"
        href="#"
        onClick={e => {
          e.preventDefault();
          onTab('overview');
        }}
      >
        <img src="/favicon.svg" alt="" />
        <span>Workout</span>
      </a>

      <div className="sidebar-action-wrap">
        <Button
          variant="primary"
          className="sidebar-action"
          aria-label={DOCK_ACTION_LABEL[action]}
          disabled={actionBusy}
          onPointerEnter={() => prefetchView(action === 'start' ? 'workoutPreview' : 'workout')}
          onClick={onAction}
        >
          <ActionIcon size={20} className="sidebar-action-icon" aria-hidden="true" />
          <span className="sidebar-action-label">{DOCK_ACTION_LABEL[action]}</span>
        </Button>
      </div>

      <nav aria-label="Main navigation">
        <SelectionIndicator active={tab} className="sidebar-nav-track">
          {NAV.map(item => (
            <Button
              key={item.id}
              data-selection-key={item.id}
              onPointerEnter={() => prefetchView(navView(item.id))}
              onFocus={() => prefetchView(navView(item.id))}
              variant="tertiary"
              className={`nav-item ${tab === item.id ? 'selected' : ''}`.trim()}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => onTab(item.id)}
            >
              <item.icon size={20} className="nav-icon" aria-hidden="true" />
              <span className="nav-label-text">{item.label}</span>
            </Button>
          ))}
        </SelectionIndicator>
      </nav>

      <div className="sidebar-bottom">
        <Button
          variant="tertiary"
          className={`nav-item ${aiOpen ? 'selected' : ''}`.trim()}
          aria-expanded={aiOpen}
          onClick={onAskAi}
        >
          <Sparkles size={20} className="nav-icon" aria-hidden="true" />
          <span className="nav-label-text">Ask AI</span>
        </Button>
        <Button
          variant="tertiary"
          className={`nav-item ${tab === 'settings' ? 'selected' : ''}`.trim()}
          aria-current={tab === 'settings' ? 'page' : undefined}
          onClick={onSettings}
        >
          <Settings size={20} className="nav-icon" aria-hidden="true" />
          <span className="nav-label-text">Settings</span>
        </Button>
        <Button
          variant="tertiary"
          className="sidebar-account-card"
          aria-label={`Account settings for ${displayName}`}
          onClick={onSettings}
        >
          <span className="sidebar-avatar" aria-hidden="true">
            {initials(displayName)}
          </span>
          <span className="sidebar-account-info">
            <span className="sidebar-account-name">{displayName}</span>
            <span className="sidebar-account-desc">Fitness Account</span>
          </span>
        </Button>
      </div>
    </aside>
  );
}
