import { integrationGeneration, resetIntegrationDispatch } from './integrationDispatch';

export function resetGoogleHealthState() {
  resetIntegrationDispatch();
  window.dispatchEvent(new Event('workout:google-health-reset'));
}

window.addEventListener('fitness:integration-pending', () => {
  const generation = integrationGeneration();
  void import('./googleHealth').then(module => {
    if (generation === integrationGeneration()) module.dispatchCommittedGoogleHealthWork();
  }).catch(() => undefined);
});
