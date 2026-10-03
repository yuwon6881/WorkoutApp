import {expect, test} from '@playwright/test';

test('signed-out Workout follows the OS theme and clears the previous account theme', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('workout-theme', 'light'));
  for (const width of [320, 390, 640, 768, 1024, 1440, 1920]) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({width, height: 900});
      await page.emulateMedia({colorScheme: theme});
      await page.goto('/');
      await expect(page.getByRole('heading', {name: 'Sign in to Workout'})).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => localStorage.getItem('workout-theme'))).toBeNull();
      await expect(page.getByRole('button', {name: 'Sign in with Fitness Account'})).toBeVisible();
      const signIn = page.getByRole('button', {name: 'Sign in with Fitness Account'});
      await signIn.scrollIntoViewIfNeeded();
      expect((await signIn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await signIn.evaluate(node => {
        const box = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      })).toBeTruthy();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({path: test.info().outputPath(`workout-login-${width}-${theme}.png`), fullPage: true, animations: 'disabled'});
    }
  }
});

test('cancelled and failed sign-in wrap and keep keyboard access across themes and short screens', async ({page}) => {
  await page.route('**/api/bootstrap/launch', route => route.fulfill({status: 401, body: 'Unauthorized'}));
  for (const code of ['access_denied', 'provider_internal_code']) {
    for (const width of [320, 390, 768, 828, 1440]) {
      for (const theme of ['light', 'dark'] as const) {
        await page.setViewportSize({width, height: width < 640 ? 480 : width === 828 ? 615 : 900});
        await page.emulateMedia({colorScheme: theme});
        await page.goto(`/?central_error=${code}`);
        const feedback = page.getByRole(code === 'access_denied' ? 'status' : 'alert');
        await expect(feedback).toContainText(code === 'access_denied' ? 'Sign-in cancelled' : 'We could not complete sign-in');
        await expect(page.getByText('provider_internal_code', {exact: true})).toHaveCount(0);
        const signIn = page.getByRole('button', {name: 'Sign in with Fitness Account'});
        await page.keyboard.press('Tab');
        await expect(signIn).toBeFocused();
        expect(await signIn.evaluate(node => getComputedStyle(node).outlineStyle)).not.toBe('none');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
        await page.screenshot({path: test.info().outputPath(`workout-${code}-${width}-${theme}.png`), fullPage: true});
      }
    }
  }
});

for (const failure of ['connection', 'render'] as const) {
  test(`full-page ${failure} recovery has a substantial card across themes and widths`, async ({page}) => {
    if (failure === 'connection') {
      await page.route('**/api/bootstrap/launch', route => route.fulfill({status: 500, body: 'Service unavailable'}));
    } else {
      // Throw inside the first React render, so the real ErrorBoundary owns the recovery view.
      await page.addInitScript(() => {
        const OriginalParams = window.URLSearchParams;
        window.URLSearchParams = class extends OriginalParams {
          get(name: string) {
            if (name === 'central_error') throw new Error('Test render failure');
            return super.get(name);
          }
        };
      });
    }
    for (const width of [320, 390, 768, 828, 1440]) {
      for (const theme of ['light', 'dark'] as const) {
        await page.setViewportSize({width, height: width < 640 ? 480 : width === 828 ? 615 : 900});
        await page.emulateMedia({colorScheme: theme});
        await page.goto('/');
        await expect(page.getByRole('heading', {name: failure === 'connection' ? 'Connection paused' : 'This view needs a reload'})).toBeVisible();
        const card = await page.locator('.startup-card').boundingBox();
        expect(card!.width).toBe(width < 640 ? width - 32 : 640);
        expect(card!.height).toBeGreaterThanOrEqual(360);
        const action = page.getByRole('button', {name: failure === 'connection' ? 'Try again' : 'Reload workout app', exact: true});
        await action.scrollIntoViewIfNeeded();
        expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        expect(await action.evaluate(node => {
          const box = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        })).toBeTruthy();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
        await page.screenshot({path: test.info().outputPath(`workout-${failure}-${width}-${theme}.png`), fullPage: true});
      }
    }
  });
}

test('Workout leaves Fitness Account to choose its own OS theme', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('workout-theme', 'light'));
  let requestedUrl = '';
  await page.route('**/api/auth/central/start*', async route => {
    requestedUrl = route.request().url();
    await route.fulfill({status: 200, contentType: 'text/html', body: '<main>Fitness Account preview</main>'});
  });
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'Sign in to Workout'})).toBeVisible();
  await page.getByRole('button', {name: 'Sign in with Fitness Account'}).click();
  await expect(page.getByText('Fitness Account preview')).toBeVisible();
  expect(new URL(requestedUrl).searchParams.has('theme')).toBe(false);
});

test('cancelled consent shows sign-in immediately while session validation is pending', async ({page}) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.assign(window, {startupViews: seen});
    new MutationObserver(() => {
      if (document.querySelector('.app-loading-shell, .app-shell')) seen.push('training');
    }).observe(document, {childList: true, subtree: true});
  });
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/api/bootstrap/launch', async route => {
    await pending;
    await route.fulfill({status: 401, body: 'Unauthorized'});
  });
  try {
    await page.goto('/?central_error=access_denied');
    await expect(page.getByRole('heading', {name: 'Sign in to Workout'})).toBeVisible();
    await expect(page.getByRole('status')).toContainText('Sign-in cancelled');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.app-loading-shell')).toHaveCount(0);
    release();
    await expect(page.getByRole('button', {name: 'Sign in with Fitness Account'})).toBeEnabled();
    expect(await page.evaluate(() => Reflect.get(window, 'startupViews'))).toEqual([]);
  } finally {release();}
});

test('a delayed sign-in bundle uses its own placeholder after cancellation', async ({page}) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;});
  await page.route(/\/assets\/Auth-[^/]+\.js(?:\?.*)?$/, async route => {
    await pending;
    await route.continue();
  });
  await page.route('**/api/bootstrap/launch', route => route.fulfill({status: 401, body: 'Unauthorized'}));
  try {
    await page.goto('/?central_error=access_denied');
    await expect(page.locator('.auth-loading')).toBeVisible();
    await expect(page.getByRole('heading', {name: 'Opening sign-in…'})).toBeVisible();
    await expect(page.locator('.app-loading-shell, .app-shell')).toHaveCount(0);
    release();
    await expect(page.getByRole('status')).toContainText('Sign-in cancelled');
    await expect(page.locator('.auth-loading')).toHaveCount(0);
  } finally {release();}
});
