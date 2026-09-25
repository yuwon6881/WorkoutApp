import { useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from './ui/Button';
import { SelectionIndicator, useReducedMotion } from './ui/Motion';

export type SettingsSectionLink = { id: string; label: string; icon: LucideIcon };

/// A titled settings group. `card` wraps its rows in one panel; `plain` lets the group hold its own cards.
export function SettingsSection({ id, title, description, icon: Icon, layout = 'card', className = '', children }: {
  id: string;
  title: string;
  description?: ReactNode;
  icon: LucideIcon;
  layout?: 'card' | 'plain';
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={`settings-section ${className}`.trim()} aria-labelledby={`${id}-title`}>
      <header className="settings-section-header">
        <span className="settings-section-icon" aria-hidden="true"><Icon size={18} /></span>
        <div>
          <h2 id={`${id}-title`} tabIndex={-1}>{title}</h2>
          {description && <span className="settings-section-description">{description}</span>}
        </div>
      </header>
      {layout === 'card' ? <div className="panel settings-card">{children}</div> : <div className="settings-stack">{children}</div>}
    </section>
  );
}

/// Tracks the section nearest the top of the viewport. The observer band sits in the upper third so a
/// section becomes current once its heading is comfortably in view, not when its last pixel scrolls in.
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? '');
  const key = ids.join('|');

  useEffect(() => {
    const sections = key.split('|')
      .map(id => document.getElementById(id))
      .filter((node): node is HTMLElement => Boolean(node));
    if (!sections.length || typeof IntersectionObserver === 'undefined') return;

    const visible = new Set<string>();
    const pick = () => {
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const next = atBottom ? sections.at(-1)?.id : sections.find(section => visible.has(section.id))?.id;
      if (next) setActive(next);
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      pick();
    }, { rootMargin: '-15% 0px -60% 0px' });

    sections.forEach(section => observer.observe(section));
    window.addEventListener('scroll', pick, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', pick);
    };
  }, [key]);

  return [active, setActive] as const;
}

/// Jump links for the expanded layout. Compact and medium layouts hide it and read top to bottom.
export function SettingsNav({ links }: { links: SettingsSectionLink[] }) {
  const [active, setActive] = useActiveSection(links.map(link => link.id));
  const reduced = useReducedMotion();

  function go(id: string) {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    document.getElementById(`${id}-title`)?.focus({ preventScroll: true });
  }

  return (
    <nav className="settings-nav" aria-label="Settings sections">
      <SelectionIndicator active={active} className="settings-nav-list">
        {links.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant="tertiary"
            data-selection-key={id}
            className={active === id ? 'is-current' : undefined}
            aria-current={active === id ? 'true' : undefined}
            onClick={() => go(id)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
          </Button>
        ))}
      </SelectionIndicator>
    </nav>
  );
}
