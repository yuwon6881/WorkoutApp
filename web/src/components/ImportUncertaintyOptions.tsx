import type { Exercise, ImportOption } from '../types';
import { optionLabel } from '../lib/importOptions';
import { Button } from './ui/Button';

/// The answers the assistant offered for one flagged detail. Choosing one applies it; the row's Inspect action stays
/// for anyone who would rather change it by hand.
export function ImportUncertaintyOptions({ options, library, busy, onChoose }: {
  options: ImportOption[]; library: readonly Exercise[]; busy?: boolean; onChoose: (option: ImportOption) => void;
}) {
  return (
    <div className="irev-uncertainty-options" role="group" aria-label="Suggested answers">
      <span className="irev-uncertainty-options-hint">Pick the answer that fits, or inspect it to change it yourself.</span>
      <div className="irev-uncertainty-option-list">
        {options.map((option, index) => (
          <Button key={`${option.label}-${index}`} variant="secondary" className="irev-uncertainty-option" disabled={busy}
            onClick={() => onChoose(option)}>
            {optionLabel(option, library)}
          </Button>
        ))}
      </div>
    </div>
  );
}
