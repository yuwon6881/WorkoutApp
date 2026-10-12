import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { signIn } from './signIn';
import type { Page } from '@playwright/test';

async function waitForCapture(page: Page) {
  await expect(page.locator('.skeleton:visible')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

const outputDir = process.env.WORKOUT_TEST_SCREENSHOTS || join(process.cwd(), 'artifacts', 'visual-review');
mkdirSync(outputDir, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone', width: 390, height: 844 },
];

const THEMES = ['dark', 'light'] as const;

test.describe('Visual Redesign Capture', () => {
  test('capture all main screens and dialogs in dark and light themes across viewports', async ({ page }) => {
    test.setTimeout(240000);
    await signIn(page);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const theme of THEMES) {
        await page.getByRole('button', { name: 'Settings', exact: true }).filter({ visible: true }).first().click();
        await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
        await page.getByRole('group', { name: 'Appearance' })
          .getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

        // 1. Overview
        await page.getByRole('button', { name: 'Overview' }).filter({ visible: true }).first().click();
        await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
        await waitForCapture(page);
        await page.screenshot({
          path: join(outputDir, `overview-${vp.name}-${theme}.png`),
          fullPage: false,
        });

        // 2. Workouts
        await page.getByRole('button', { name: 'Workouts' }).filter({ visible: true }).first().click();
        await expect(page.getByRole('heading', { name: 'Workouts' })).toBeVisible();
        await waitForCapture(page);
        await page.screenshot({
          path: join(outputDir, `workouts-${vp.name}-${theme}.png`),
          fullPage: false,
        });

        // 3. Muscles
        await page.getByRole('button', { name: 'Muscles' }).filter({ visible: true }).first().click();
        await expect(page.getByRole('heading', { name: 'Muscle coverage' })).toBeVisible();
        await waitForCapture(page);
        await page.screenshot({
          path: join(outputDir, `muscles-${vp.name}-${theme}.png`),
          fullPage: false,
        });

        // 4. Exercises
        await page.getByRole('button', { name: 'Exercises' }).filter({ visible: true }).first().click();
        await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible();
        await waitForCapture(page);
        await page.screenshot({
          path: join(outputDir, `exercises-${vp.name}-${theme}.png`),
          fullPage: false,
        });

        // 5. Settings
        const settingsBtn = vp.width >= 640
          ? page.locator('.sidebar button').filter({ hasText: 'Settings' })
          : page.locator('.topbar-actions button[aria-label="Settings"]');
        await expect(settingsBtn).toBeVisible();
        {
          await settingsBtn.click();
          await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
          await waitForCapture(page);
          await page.screenshot({
            path: join(outputDir, `settings-${vp.name}-${theme}.png`),
            fullPage: false,
          });
        }

        // 6. Exercise Detail (Progress and History tabs) on desktop and phone
        if (vp.name !== 'tablet') {
          await page.getByRole('button', { name: 'Exercises' }).filter({ visible: true }).first().click();
          await expect(page.getByRole('heading', { name: 'Exercises' })).toBeVisible();
          const firstExercise = page.locator('.exercise-card').first();
          await expect(firstExercise).toBeVisible();
          {
            await firstExercise.click();
            await expect(page.locator('.exercise-detail-modal')).toBeVisible();
            await waitForCapture(page);
            await page.screenshot({
              path: join(outputDir, `exercise-detail-progress-${vp.name}-${theme}.png`),
              fullPage: false,
            });

            // History tab
            const histBtn = page.locator('.segmented button').filter({ hasText: 'History' });
            await expect(histBtn).toBeVisible();
            {
              await histBtn.click();
              await waitForCapture(page);
              await page.screenshot({
                path: join(outputDir, `exercise-detail-history-${vp.name}-${theme}.png`),
                fullPage: false,
              });
            }

            // Close modal
            await page.getByRole('button', { name: 'Done' }).click();
            await expect(page.locator('.exercise-detail-modal')).not.toBeVisible();
          }
        }
      }
    }
  });

  test('capture active workout logger in dark and light themes', async ({ page }) => {
    test.setTimeout(120000);
    await signIn(page);
    const headers = { 'X-Workout-Request': '1', Origin: new URL(page.url()).origin };

    // Discard any existing active workout first
    const activeResponse = await page.request.get('/api/workouts/active');
    expect(activeResponse.ok(), await activeResponse.text()).toBeTruthy();
    const existing = await activeResponse.json();
    if (existing) {
      const discardRes = await page.request.post(`/api/workouts/${existing.id}/discard`, { headers });
      expect(discardRes.ok(), await discardRes.text()).toBeTruthy();
    }

    const catalogResponse = await page.request.get('/api/exercises');
    expect(catalogResponse.ok(), await catalogResponse.text()).toBeTruthy();
    const catalog = await catalogResponse.json();
    const bench = catalog.find((exercise: { name: string }) => exercise.name === 'Barbell bench press') ?? catalog[0];
    expect(bench).toBeDefined();
    const exercise = {
      exerciseId: bench.id,
      sourceName: bench.name,
      sets: [
        { repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90 },
        { repMin: 8, repMax: 10, targetRpe: 8, restSeconds: 90 }
      ]
    };
    const created = await page.request.post('/api/programs', {
      headers,
      data: {
        name: `Active review ${Date.now()}`,
        workouts: [{ week: 1, name: 'Upper Body A', exercises: [exercise] }]
      }
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const program = await created.json();
    let programId: string | undefined = program.id;
    let sessionId: string | undefined;

    try {
      if (!program.active) {
        const activated = await page.request.post(`/api/programs/${program.id}/active`, {
          headers,
          data: { active: true, revision: program.revision }
        });
        expect(activated.ok(), await activated.text()).toBeTruthy();
      }

      const started = await page.request.post('/api/workouts', {
        headers,
        data: { templateId: program.workouts[0].id }
      });
      expect(started.ok(), await started.text()).toBeTruthy();
      const session = await started.json();
      sessionId = session.id;

      // Log the first set so we see both a completed set and a current set
      const logged = await page.request.patch(`/api/workouts/${session.id}/sets/${session.exercises[0].sets[0].id}`, {
        headers,
        data: {
          revision: session.revision,
          mutationId: crypto.randomUUID(),
          weightKg: 80,
          reps: 10,
          rpe: 8,
          done: true
        }
      });
      expect(logged.ok(), await logged.text()).toBeTruthy();

      // On reload, the app contract deterministically auto-opens the active workout sheet
      await page.goto('/');
      const sheet = page.getByRole('dialog', { name: 'Upper Body A', exact: true });
      await expect(sheet).toBeVisible();
      const activeExercise = page.locator('.workout-active-exercise');
      await expect(activeExercise).toBeVisible();

      // Capture desktop and phone in dark and light themes
      for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844 }]) {
        await page.setViewportSize({ width: vp.width, height: vp.height });

        for (const theme of THEMES) {
          await page.evaluate(t => {
            document.documentElement.dataset.theme = t;
            document.documentElement.style.colorScheme = t;
          }, theme);

          await waitForCapture(page);
          await page.screenshot({
            path: join(outputDir, `workout-active-${vp.name}-${theme}.png`),
            fullPage: false,
          });
        }
      }
    } finally {
      if (!page.isClosed()) {
        try {
          if (sessionId) {
            const check = await page.request.get(`/api/workouts/${sessionId}`);
            if (check.ok()) {
              const latest = await check.json();
              if (latest?.active) {
                const res = await page.request.post(`/api/workouts/${sessionId}/discard`, { headers });
                expect(res.ok(), await res.text()).toBeTruthy();
              } else {
                const res = await page.request.delete(`/api/workouts/${sessionId}`, { headers });
                expect(res.ok(), await res.text()).toBeTruthy();
              }
            } else {
              expect(check.ok(), await check.text()).toBeTruthy();
            }
          }
        } finally {
          if (programId) {
            const res = await page.request.delete(`/api/programs/${programId}`, { headers });
            expect(res.ok(), await res.text()).toBeTruthy();
          }
        }
      }
    }
  });
});
