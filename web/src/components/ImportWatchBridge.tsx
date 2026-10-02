import type { ImportView } from '../types';
import { ImportProgressPill } from './ImportProgressPill';
import { useImportWatch } from './useImportWatch';

export function ImportWatchBridge({ imports, active, training, withResume, onFinished, onLocalFailure, onOpen }: {
  imports: ImportView[];
  active: boolean;
  training: boolean;
  withResume: boolean;
  onFinished: () => void;
  onLocalFailure: (message: string) => void;
  onOpen: () => void;
}) {
  const watch = useImportWatch({ imports, active, onFinished, onLocalFailure });
  return watch && !training ? <ImportProgressPill progress={watch.progress} finished={watch.finished} withResume={withResume} onOpen={onOpen} /> : null;
}
