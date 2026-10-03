import type {ReactNode} from 'react';
import './StartupScreen.css';

/** Shared frame for sign-in and full-page recovery, before the training shell is available. */
export function StartupScreen({children, className = '', headingId = 'startup-heading'}: {children: ReactNode; className?: string; headingId?: string}) {
  return (
    <main className="startup-screen">
      <div className="startup-shell">
        <header className="startup-brand"><img src="/favicon.svg" alt="" />Workout</header>
        <section className={`panel startup-card ${className}`} aria-labelledby={headingId}>{children}</section>
      </div>
    </main>
  );
}
