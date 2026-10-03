import type { ReactNode } from 'react';
import { ChevronDown, GripVertical } from 'lucide-react';
import { Button } from './ui/Button';
import { MenuButton } from './ui/MenuButton';

/// The top row every workout card shares: a grip to drag it between the active slot and the
/// library, the name and a one-line summary, an optional collapse toggle, and the card menu.
/// The grip is pointer-only; the menu offers the same moves to keyboard and screen readers.
export function SlotCardHeader({ title, meta, badge, expanded, onToggle, menuLabel, menu }: {
  title: string;
  meta?: ReactNode;
  badge?: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  menuLabel: string;
  menu: ReactNode;
}) {
  const handleHeaderClick = (e: React.MouseEvent) => {
    if (!onToggle) return;
    const target = e.target as HTMLElement;
    if (target.closest('.slot-card-grip, button, a, [role="button"], [role="menu"], input, select')) {
      return;
    }
    onToggle();
  };

  return <div className={`slot-card-header ${onToggle ? 'is-clickable' : ''}`} onClick={handleHeaderClick}>
    <span className="slot-card-grip" data-slot-grip aria-hidden="true"><GripVertical size={16} /></span>
    <div className="slot-card-title">
      <h3>{title}</h3>
      {meta && <p className="slot-card-meta">{meta}</p>}
    </div>
    {badge}
    <div className="slot-card-controls">
      {onToggle && <Button variant="tertiary" className="slot-card-toggle" aria-expanded={expanded}
        aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`} onClick={e => { e.stopPropagation(); onToggle(); }}>
        <ChevronDown size={18} />
      </Button>}
      <MenuButton label={menuLabel} triggerClassName="slot-card-menu-trigger" portal>{menu}</MenuButton>
    </div>
  </div>;
}
