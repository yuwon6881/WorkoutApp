import { Dumbbell, Link2, Unlink } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { getSupersetGroup, isSuperset } from '../lib/supersets';
import './Superset.css';

export interface SupersetCandidate {
  id: string;
  name: string;
  sequenceGroup?: string | null;
  targetMuscle?: string;
}

export interface SupersetModalProps {
  open: boolean;
  onClose: () => void;
  currentExerciseId: string;
  currentExerciseName: string;
  currentSequenceGroup?: string | null;
  candidates: SupersetCandidate[];
  onPair: (targetExerciseId: string) => void;
  onUnlink: () => void;
}

export function SupersetModal({
  open,
  onClose,
  currentExerciseId,
  currentExerciseName,
  currentSequenceGroup,
  candidates,
  onPair,
  onUnlink
}: SupersetModalProps) {
  if (!open) return null;

  const currentGroup = getSupersetGroup(currentSequenceGroup);
  const isPaired = isSuperset(currentSequenceGroup);

  const partners = candidates.filter(
    c => c.id !== currentExerciseId && getSupersetGroup(c.sequenceGroup) === currentGroup
  );

  const availableCandidates = candidates.filter(c => c.id !== currentExerciseId);

  return (
    <Modal title={`Superset · ${currentExerciseName}`} onClose={onClose}>
      <div className="modal-body superset-modal-body">
        {isPaired && partners.length > 0 && (
          <div className="superset-current-card">
            <div className="superset-current-info">
              <span className="superset-badge">
                <Link2 size={13} />
                Superset Group {currentGroup}
              </span>
              <p className="superset-current-names">
                Paired with: <strong>{partners.map(p => p.name).join(', ')}</strong>
              </p>
            </div>
            <Button
              variant="destructive"
              className="superset-unlink-btn"
              onClick={() => {
                onUnlink();
                onClose();
              }}
            >
              <Unlink size={15} />
              Unlink superset
            </Button>
          </div>
        )}

        <div className="superset-picker-section">
          <p className="superset-picker-lead">
            {isPaired
              ? 'Choose another exercise to add or change superset pairing:'
              : 'Select an exercise in this workout to pair into a superset with this movement:'}
          </p>

          {availableCandidates.length === 0 ? (
            <div className="empty-message">
              <Dumbbell size={24} />
              <p>Add more exercises to this workout to create a superset.</p>
            </div>
          ) : (
            <div className="superset-picker-list" role="list" aria-label="Available exercises for superset">
              {availableCandidates.map(candidate => {
                const candGroup = getSupersetGroup(candidate.sequenceGroup);
                const isAlreadyPartner = candGroup === currentGroup && isPaired;

                return (
                  <Button
                    key={candidate.id}
                    variant="secondary"
                    className={`superset-picker-item ${isAlreadyPartner ? 'selected-partner' : ''}`}
                    onClick={() => {
                      onPair(candidate.id);
                      onClose();
                    }}
                  >
                    <span className="superset-picker-icon" aria-hidden="true">
                      <Dumbbell size={16} />
                    </span>
                    <span className="superset-picker-text">
                      <strong>{candidate.name}</strong>
                      {candidate.targetMuscle && (
                        <span className="superset-candidate-muscle">{candidate.targetMuscle}</span>
                      )}
                    </span>
                    <span className="superset-picker-badge">
                      {isAlreadyPartner ? (
                        <span className="pill pill-accent">Paired</span>
                      ) : candGroup ? (
                        <span className="pill">Group {candGroup}</span>
                      ) : (
                        <span className="pill">Pair</span>
                      )}
                    </span>
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
