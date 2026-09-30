import { useEffect, useState } from 'react';
import type { Unit } from '../types';
import { api, ApiError } from '../lib/api';
import { describeLoad, describeSource, type ExerciseLoadSettings as Settings, type LoadRule, type LoadStack } from '../lib/exerciseLoads';
import { equipmentGroupInfo } from '../lib/equipmentGroups';
import { Button } from './ui/Button';
import { LoadRuleEditor } from './LoadRuleEditor';
import './ExerciseLoadSettings.css';

/// One exercise's own weight rule. Without one it follows the account's rule for its equipment,
/// then the app default, and the panel always says which of those is in use.
export function ExerciseLoadSettings({ exerciseId, unit, onChanged }: {
  exerciseId: string;
  unit: Unit;
  onChanged?: () => void | Promise<void>;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stacks, setStacks] = useState<LoadStack[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setSettings(null);
    setError('');
    setEditing(false);
    api.exerciseLoadSettings(exerciseId, controller.signal).then(setSettings).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load weight settings.');
    });
    return () => controller.abort();
  }, [exerciseId, reload]);

  // An account unit switch changes the display, never the saved equipment values.
  useEffect(() => { setEditing(false); }, [unit]);

  async function startEditing() {
    setEditing(true);
    if (stacks) return;
    // Stacks are optional here: without them the editor still offers a step or a list.
    try { setStacks((await api.loadSettings()).stacks); } catch { setStacks([]); }
  }

  async function save(rule: LoadRule) {
    if (!settings || busy) return;
    setBusy(true);
    setError('');
    try {
      setSettings(await api.saveExerciseLoadSettings(exerciseId, { ...rule, revision: settings.revision }));
      setEditing(false);
      await onChanged?.();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save weight settings. Please retry.');
    } finally { setBusy(false); }
  }

  const inherited = settings?.inherited;
  const group = inherited?.equipmentGroup ?? null;
  const own: LoadRule = {
    loadStepKg: settings?.ownStepKg ?? null,
    availableLoadsKg: settings?.ownAvailableLoadsKg ?? null,
    stackId: settings?.stackId ?? null
  };

  return <section className="exercise-load-settings" aria-label="Exercise weight settings">
    <div className="section-heading">
      <h3>Weight settings</h3>
      {settings && !editing && <Button variant="secondary" disabled={busy} onClick={() => void startEditing()}>Edit weights</Button>}
    </div>
    {error && <div className="error-banner" role="alert">{error} <Button variant="secondary" disabled={busy} onClick={() => setReload(current => current + 1)}>Reload settings</Button></div>}
    {!settings && !error && <p className="muted" role="status">Loading weight settings…</p>}
    {settings && !editing && <p className="muted">
      {describeLoad(settings.loadStepKg, settings.availableLoadsKg, unit)} · {describeSource(settings.source, group, settings.stackName)}
    </p>}
    {settings && editing && <>
      <p className="muted">For this exercise in every program, such as one machine whose weights differ. Use the weight you log: per dumbbell, or the total bar or machine load. Suggestions use it from the next workout or exercise swap.</p>
      {stacks === null
        ? <p className="muted" role="status">Loading weight stacks…</p>
        : <LoadRuleEditor unit={unit} rule={own} name="exercise-load" busy={busy} stacks={stacks}
            perSide={group ? equipmentGroupInfo(group).perSide : false}
            preferList={group ? equipmentGroupInfo(group).preferList : false}
            inheritText={inherited
              ? `Follows ${describeSource(inherited.source, inherited.equipmentGroup, inherited.stackName)}: ${describeLoad(inherited.stepKg, inherited.availableLoadsKg, unit)}.`
              : undefined}
            onSubmit={rule => void save(rule)} onCancel={() => setEditing(false)} />}
    </>}
  </section>;
}
