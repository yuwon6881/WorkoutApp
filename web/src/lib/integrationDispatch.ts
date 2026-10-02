let generation = 0;
let bursts = 0;
let pending = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function integrationGeneration() { return generation; }

export function resetIntegrationDispatch() {
  generation++;
  bursts = 0;
  pending = false;
  clearTimeout(timer);
  timer = undefined;
}

export function beginIntegrationBurst(): () => void {
  const epoch = generation;
  bursts++;
  clearTimeout(timer);
  timer = undefined;
  return () => {
    if (epoch !== generation) return;
    bursts = Math.max(0, bursts - 1);
    schedule();
  };
}

export function signalIntegrationPending(epoch: number) {
  if (epoch !== generation) return;
  pending = true;
  schedule();
}

function schedule() {
  if (!pending || bursts || timer !== undefined || typeof window === 'undefined') return;
  timer = setTimeout(() => {
    timer = undefined;
    pending = false;
    window.dispatchEvent(new Event('fitness:integration-pending'));
  }, 250);
}
