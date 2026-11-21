/// The rep counts worth showing a load for: the standard benchmarks 1, 3 and 5, plus 8 and 10 for the
/// hypertrophy range where most of this app's work lives. Past 12 the Epley estimate stops holding.
export const REP_MAX_TARGETS = [1, 3, 5, 8, 10] as const;

/// The load that is the heaviest for `reps`, from a one-rep max, by the same Epley relationship the
/// estimate itself uses (1RM = load × (1 + reps / 30)). A single is the max itself.
export const repMaxLoadKg = (oneRepMaxKg: number, reps: number): number =>
  reps <= 1 ? oneRepMaxKg : oneRepMaxKg / (1 + reps / 30);

/// What each rep count weighs, worked out from the estimated 1RM rather than picked from past sets, so
/// every row is filled and moves with the estimate. Laid out like the History tab's rows: the rep
/// count and how heavy it is relative to the max on the left, the load on the right.
export function ExerciseRepMaxes({ estimated1RmKg, formatEstimate }: {
  estimated1RmKg: number | null | undefined;
  formatEstimate: (kg: number) => string;
}) {
  if (estimated1RmKg == null || estimated1RmKg <= 0) return null;

  return <section aria-label="Estimated rep maxes" className="rep-max-section">
    <div className="section-heading"><h3>Estimated rep maxes</h3></div>
    <p className="muted detail-note">Worked out from your estimated 1RM of {formatEstimate(estimated1RmKg)}.</p>
    <ul className="exercise-history-list">
      {REP_MAX_TARGETS.map(reps => {
        const load = repMaxLoadKg(estimated1RmKg, reps);
        return <li className="exercise-history-entry rep-max-entry" key={reps}>
          <div className="rep-max-row">
            <span className="row-title">
              <strong>{reps === 1 ? '1 rep' : `${reps} reps`}</strong>
              <small>{Math.round((load / estimated1RmKg) * 100)}% of 1RM</small>
            </span>
            <strong className="rep-max-load">{formatEstimate(load)}</strong>
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
