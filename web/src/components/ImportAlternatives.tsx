import { Circle, CircleCheck, Wand2 } from 'lucide-react';
import type { ImportView } from '../types';
import { Button } from './ui/Button';
import './ImportAlternatives.css';

/// The PDF holds several programs, or one week printed in versions: the lifter picks one before
/// detailed extraction starts.
export function ImportAlternatives({ view, choice, busy, onChoose, onContinue }: {
  view: ImportView;
  choice: string | null;
  busy: boolean;
  onChoose: (id: string) => void;
  onContinue: () => void;
}) {
  const alternatives = view.alternatives ?? [];
  const isWeekVersion = alternatives.length > 0 && alternatives.every(alternative => alternative.kind === 'week');
  const chosenAlternative = alternatives.find(alternative => alternative.id === choice);

  return (
    <section className="panel import-reading-panel ialt-panel">
      <header className="ialt-header">
        <div className="ialt-header-icon" aria-hidden="true">
          <Wand2 size={22} />
        </div>
        <div className="ialt-header-text">
          <h3 className="ialt-title">
            {isWeekVersion ? 'Choose a week version' : 'Choose a program'}
          </h3>
          <p className="ialt-description">
            {isWeekVersion
              ? 'This program prints a week in versions and asks you to run only one. Choose the version to import; the program is kept in order around it.'
              : 'This PDF contains several programs. Choose one before detailed extraction; its consecutive phases will stay together.'}
          </p>
        </div>
      </header>

      <div
        className="ialt-grid"
        role="group"
        aria-label="Available program versions"
        data-count={Math.min(alternatives.length, 3)}
      >
        {alternatives.map(alternative => {
          const chosen = choice === alternative.id;
          const chooseLabel = chosen ? 'Selected' : 'Choose this version';
          return (
            <Button
              key={alternative.id}
              presentation="plain"
              disabled={busy}
              aria-pressed={chosen}
              aria-label={chooseLabel}
              aria-describedby={`ialt-title-${alternative.id}`}
              onClick={() => onChoose(alternative.id)}
              className={`ialt-card ${chosen ? 'ialt-card--selected' : ''}`}
            >
              <span className="ialt-card-main">
                <span className="ialt-card-indicator" aria-hidden="true">
                  {chosen ? (
                    <CircleCheck size={20} className="ialt-indicator-checked" />
                  ) : (
                    <Circle size={20} className="ialt-indicator-unchecked" />
                  )}
                </span>
                <span className="ialt-card-content">
                  <span className="ialt-card-title" id={`ialt-title-${alternative.id}`}>{alternative.name}</span>
                  {alternative.description && (
                    <span className="ialt-card-description">{alternative.description}</span>
                  )}
                </span>
              </span>

              <span className="ialt-card-meta">
                {alternative.weekCount != null && (
                  <span className="ialt-pill ialt-pill--accent">
                    {alternative.weekCount} week{alternative.weekCount === 1 ? '' : 's'}
                  </span>
                )}
                {alternative.sessionsPerWeek != null && (
                  <span className="ialt-pill">
                    {alternative.sessionsPerWeek} sessions / week
                  </span>
                )}
                <span className="ialt-pill ialt-pill--muted">
                  {alternative.kind === 'week'
                    ? `${alternative.dayCount} session${alternative.dayCount === 1 ? '' : 's'} in this version`
                    : `${alternative.dayCount} estimated sessions`}
                </span>
              </span>
            </Button>
          );
        })}
      </div>

      <footer className="ialt-footer">
        <div className="ialt-footer-status">
          {chosenAlternative && (
            <p className="ialt-selected-caption">
              Selected: <strong className="ialt-selected-name">{chosenAlternative.name}</strong>
            </p>
          )}
        </div>
        <Button
          variant="primary"
          disabled={busy || !choice}
          onClick={onContinue}
          className="ialt-continue-btn"
        >
          Continue with selected version
        </Button>
      </footer>
    </section>
  );
}
