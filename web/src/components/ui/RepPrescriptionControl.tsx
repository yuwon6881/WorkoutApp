import { useId } from 'react';

export interface RepPrescriptionControlProps {
  repMin: number;
  repMax: number;
  /// Exact reps or a range. The mode belongs to the exercise, so the caller owns it and offers
  /// one RepModeToggle for all of its sets.
  range: boolean;
  onChange: (patch: { repMin: number; repMax: number }) => void;
  nameMin: string;
  nameMax: string;
  nameSingle: string;
  dataImportIndex?: number;
  disabled?: boolean;
  /// Names which set these inputs belong to, so each one is distinct to assistive technology.
  labelPrefix?: string;
  /// The source printed no rep count (an AMRAP set): no target is shown or editable.
  openReps?: boolean;
}

export function RepPrescriptionControl({
  repMin,
  repMax,
  range,
  onChange,
  nameMin,
  nameMax,
  nameSingle,
  dataImportIndex,
  disabled = false,
  openReps = false,
  labelPrefix
}: RepPrescriptionControlProps) {
  const uniqueId = useId();
  const label = (name: string) => labelPrefix ? `${labelPrefix} ${name.toLowerCase()}` : name;

  if (openReps) {
    return (
      <div className="field rep-prescription-field">
        <div className="rep-prescription-header">
          <span className="rep-prescription-label">Reps</span>
        </div>
        <output className="rep-open-value" data-import-field="repMin" data-import-set-index={dataImportIndex}
          aria-label="Reps: as many as possible">AMRAP</output>
      </div>
    );
  }

  return (
    <div className="field rep-prescription-field">
      <div className="rep-prescription-header">
        <span className="rep-prescription-label">{range ? 'Rep range' : 'Reps'}</span>
      </div>

      {range ? (
        <div className="rep-range-inputs">
          <input
            id={`${uniqueId}-min`}
            name={nameMin}
            aria-label={label('Min reps')}
            title="Min reps"
            placeholder="Min"
            type="number"
            inputMode="numeric"
            min="1"
            max="1000"
            value={repMin}
            data-import-field="repMin"
            data-import-set-index={dataImportIndex}
            disabled={disabled}
            onChange={e => {
              const val = Number(e.target.value);
              onChange({ repMin: val, repMax: Math.max(val, repMax) });
            }}
          />
          <span className="rep-range-sep" aria-hidden="true">–</span>
          <input
            id={`${uniqueId}-max`}
            name={nameMax}
            aria-label={label('Max reps')}
            title="Max reps"
            placeholder="Max"
            type="number"
            inputMode="numeric"
            min="1"
            max="1000"
            value={repMax}
            data-import-field="repMax"
            data-import-set-index={dataImportIndex}
            disabled={disabled}
            onChange={e => {
              const val = Number(e.target.value);
              onChange({ repMin, repMax: val });
            }}
          />
        </div>
      ) : (
        <div className="rep-single-input-wrap">
          <input
            id={`${uniqueId}-single`}
            name={nameSingle}
            aria-label={label('Reps')}
            title="Target reps"
            placeholder="Reps"
            type="number"
            inputMode="numeric"
            min="1"
            max="1000"
            value={repMin}
            data-import-field="repMin"
            data-import-set-index={dataImportIndex}
            disabled={disabled}
            onChange={e => {
              const val = Number(e.target.value);
              onChange({ repMin: val, repMax: val });
            }}
          />
          <input
            type="hidden"
            name={nameMax}
            value={repMax}
            data-import-field="repMax"
            data-import-set-index={dataImportIndex}
          />
        </div>
      )}
    </div>
  );
}

/// One segmented choice between exact reps and a rep range for every set of an exercise.
export function RepModeToggle({
  range,
  onChange,
  label,
  disabled = false
}: {
  range: boolean;
  onChange: (range: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="rep-mode-toggle" role="group" aria-label={label}>
      <button
        type="button"
        className={`rep-mode-btn ${!range ? 'active' : ''}`}
        aria-pressed={!range}
        disabled={disabled}
        onClick={() => { if (range) onChange(false); }}
      >
        Exact
      </button>
      <button
        type="button"
        className={`rep-mode-btn ${range ? 'active' : ''}`}
        aria-pressed={range}
        disabled={disabled}
        onClick={() => { if (!range) onChange(true); }}
      >
        Range
      </button>
    </div>
  );
}
