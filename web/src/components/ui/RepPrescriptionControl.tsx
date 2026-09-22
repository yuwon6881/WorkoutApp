import { useEffect, useState } from 'react';

export interface RepPrescriptionControlProps {
  repMin: number;
  repMax: number;
  onChange: (patch: { repMin: number; repMax: number }) => void;
  nameMin: string;
  nameMax: string;
  nameSingle: string;
  dataImportIndex?: number;
  disabled?: boolean;
}

export function RepPrescriptionControl({
  repMin,
  repMax,
  onChange,
  nameMin,
  nameMax,
  nameSingle,
  dataImportIndex,
  disabled = false
}: RepPrescriptionControlProps) {
  const [isRange, setIsRange] = useState(() => repMin !== repMax);

  useEffect(() => {
    if (repMin !== repMax && !isRange) {
      setIsRange(true);
    }
  }, [repMin, repMax, isRange]);

  const handleToggle = (nextIsRange: boolean) => {
    if (nextIsRange === isRange) return;
    setIsRange(nextIsRange);
    if (!nextIsRange) {
      // Switching from range to exact rep target: unify repMax to repMin
      onChange({ repMin, repMax: repMin });
    } else {
      // Switching from exact rep target to range: if equal, expand slightly
      if (repMin === repMax) {
        onChange({ repMin, repMax: Math.max(repMin, repMin + 2) });
      }
    }
  };

  return (
    <div className="field rep-prescription-field">
      <div className="rep-prescription-header">
        <span className="rep-prescription-label">{isRange ? 'Rep range' : 'Reps'}</span>
        <div className="rep-mode-toggle" role="group" aria-label="Rep prescription mode">
          <button
            type="button"
            className={`rep-mode-btn ${!isRange ? 'active' : ''}`}
            aria-pressed={!isRange}
            disabled={disabled}
            onClick={() => handleToggle(false)}
          >
            Rep
          </button>
          <button
            type="button"
            className={`rep-mode-btn ${isRange ? 'active' : ''}`}
            aria-pressed={isRange}
            disabled={disabled}
            onClick={() => handleToggle(true)}
          >
            Range
          </button>
        </div>
      </div>

      {isRange ? (
        <div className="rep-range-inputs">
          <input
            id={nameMin}
            name={nameMin}
            aria-label="Min reps"
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
            id={nameMax}
            name={nameMax}
            aria-label="Max reps"
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
            id={nameSingle}
            name={nameSingle}
            aria-label="Reps"
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
