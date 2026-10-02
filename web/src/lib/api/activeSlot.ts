import type { Program, Template } from '../../types';
import { call } from '../api';

/// Active-slot requests load with the Workouts page rather than the launch bundle.
export const activeSlotApi = {
  setTemplateActive: (id: string, active: boolean, revision: number) => call<Template>(`/api/templates/${id}/active`, 'POST', { active, revision }),
  restartTemplate: (id: string, revision: number) => call<Template>(`/api/templates/${id}/restart`, 'POST', { revision }),
  restartProgram: (id: string, revision: number) => call<Program>(`/api/programs/${id}/restart`, 'POST', { revision })
};
