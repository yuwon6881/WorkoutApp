import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { gymAvailabilityText, useGymAvailability } from '../lib/gymAvailability';
import { Button } from './ui/Button';
import './GymAvailabilityBadge.css';

/// Status for an exercise the active gym cannot host. Roomy cards spell out what is missing. A
/// compact badge names only the gym and opens in place on a tap or click, since a tooltip never
/// reaches a touch screen. Inside a card that is itself a button it stays passive, and
/// the card's details say the rest.
export function GymAvailabilityBadge({ exerciseId, compact = false, passive = false }: {
  exerciseId: string | null | undefined;
  compact?: boolean;
  passive?: boolean;
}) {
  const availability = useGymAvailability(exerciseId);
  const [expanded, setExpanded] = useState(false);
  if (availability.available) return null;
  const text = gymAvailabilityText(availability);
  const icon = <AlertTriangle size={12} aria-hidden="true" />;
  if (!compact) return <span className="gym-availability-badge">{icon}<span>{text}</span></span>;
  const short = <><span aria-hidden="true">Not at {availability.gymName}</span><span className="sr-only">{text}</span></>;
  if (passive) return <span className="gym-availability-badge compact" title={text}>{icon}{short}</span>;
  return <Button presentation="plain" className={`gym-availability-badge compact interactive${expanded ? ' expanded' : ''}`}
    title={text} aria-expanded={expanded}
    onClick={event => { event.stopPropagation(); setExpanded(value => !value); }}>
    {icon}{expanded ? <span>{text}</span> : short}
  </Button>;
}
