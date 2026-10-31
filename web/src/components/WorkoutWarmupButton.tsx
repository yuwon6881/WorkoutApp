import { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import type { SessionExercise, Unit } from '../types';
import { loadEntryFor, loadSign } from '../lib/resistanceVariant';
import { showExerciseWeight } from '../lib/weightBasis';
import type { WarmupStep } from '../lib/warmupPlan';
import type { WarmupOffer } from '../lib/workoutWarmups';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

const plural = (count: number) => `${count} warm-up ${count === 1 ? 'set' : 'sets'}`;

/**
 * Fills the plan's warm-ups, or adds a ramp when there are none, from the first working load.
 * When the plan has fewer warm-ups than that load calls for, the lifter chooses, seeing each ramp's
 * loads: the recommended ramp is the primary choice, and the plan's own count (its author may expect
 * a general warm-up first) stays one tap away.
 */
export function WorkoutWarmupButton({ exercise, offer, unit, catalogReady, loadCatalog, onApply }: {
  exercise: SessionExercise;
  offer: WarmupOffer;
  unit: Unit;
  /// The ramp depends on the catalog's equipment and muscle, which a workout loads on demand.
  catalogReady: boolean;
  loadCatalog?: () => Promise<void>;
  onApply: (steps: WarmupStep[]) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [notice, setNotice] = useState('');
  const sign = loadSign(loadEntryFor(exercise));
  const describe = (steps: WarmupStep[]) =>
    steps.map(step => `${sign}${showExerciseWeight(step.weightKg, unit, exercise)} × ${step.reps}`).join(' · ');
  const label = offer.existing > 0 ? 'Fill warm-ups' : 'Add warm-ups';
  const missingLoad = offer.workingKg === null;

  useEffect(() => {
    setNotice('');
  }, [exercise.id, offer.workingKg]);

  function apply(count: number) {
    const steps = offer.steps(count);
    setChoosing(false);
    if (!steps.length) { setNotice('This working weight is light enough to start without warm-ups.'); return; }
    setNotice('');
    onApply(steps);
  }

  function press() {
    if (offer.existing > 0 && offer.existing < offer.recommended) { setChoosing(true); return; }
    apply(offer.existing > 0 ? offer.existing : offer.recommended);
  }

  // A press made before the catalog arrived runs once it has, against the offer it now makes.
  useEffect(() => {
    if (!waiting || !catalogReady) return;
    setWaiting(false);
    press();
  }, [waiting, catalogReady]);

  function start() {
    if (missingLoad) {
      setNotice('Enter the first working weight to plan warm-ups.');
      return;
    }
    if (catalogReady || !loadCatalog) { press(); return; }
    setWaiting(true);
    // Offline, the ramp still follows the working load, without what the equipment would add.
    loadCatalog().catch(() => { setWaiting(false); press(); });
  }

  return <>
    <Button variant="secondary" className="add-set-btn warmup-btn" disabled={waiting} onClick={start}
      aria-describedby={notice ? `warmup-note-${exercise.id}` : undefined}>
      <Flame size={16} aria-hidden="true" />{waiting ? 'Planning…' : label}
    </Button>
    {notice && <p className="warmup-note" id={`warmup-note-${exercise.id}`} role="status">
      {notice}
    </p>}
    {choosing && <Modal title="Warm-up sets" onClose={() => setChoosing(false)}>
      <div className="modal-body warmup-choice">
        <p>This plan has {plural(offer.existing)}. For this working weight, {offer.recommended} are recommended.</p>
        <dl>
          <div><dt>Keep the plan's {offer.existing}</dt><dd>{describe(offer.steps(offer.existing)) || 'No ramp needed'}</dd></div>
          <div><dt>Use {offer.recommended}</dt><dd>{describe(offer.steps(offer.recommended)) || 'No ramp needed'}</dd></div>
        </dl>
        <div className="modal-actions">
          <Button variant="secondary" onClick={() => apply(offer.existing)}>Keep {offer.existing}</Button>
          <Button variant="primary" onClick={() => apply(offer.recommended)}>Use {offer.recommended}</Button>
        </div>
      </div>
    </Modal>}
  </>;
}
