import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_LINK_TABS, appLinkTab } from './appLinks';
import { TAB_PATHS } from '../app/useTabNavigation';

const origin = 'https://workout-one-mocha.vercel.app';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Android App Links', () => {
  it('maps only /open/ links on the app origin to tabs', () => {
    expect(appLinkTab(`${origin}/open`, origin)).toBe('overview');
    expect(appLinkTab(`${origin}/open/`, origin)).toBe('overview');
    expect(appLinkTab(`${origin}/open/workouts?from=mail#top`, origin)).toBe('program');
    expect(appLinkTab(`${origin}/open/muscles/`, origin)).toBe('body');
    expect(appLinkTab(`${origin}/open/exercises`, origin)).toBe('exercises');
    expect(appLinkTab(`${origin}/open/import`, origin)).toBe('import');
    expect(appLinkTab(`${origin}/open/settings`, origin)).toBe('settings');
  });

  it('rejects the browser sign-in and consent destinations, other hosts and unknown pages', () => {
    for (const url of [`${origin}/`, `${origin}/settings`, `${origin}/workouts`, `${origin}/api/auth/central/callback`,
      `${origin}/open/api`, `${origin}/openx`, `${origin}/open/settings/extra`, 'http://workout-one-mocha.vercel.app/open/settings',
      'https://other.test/open/settings', 'javascript:alert(1)', 'not a url'])
      expect(appLinkTab(url, origin)).toBeNull();
    expect(appLinkTab(undefined, origin)).toBeNull();
  });

  it('keeps the manifest, hosting redirects, service worker and asset links in agreement', () => {
    const manifest = read('../../android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:autoVerify="true"');
    expect(manifest).toContain('android:host="workout-one-mocha.vercel.app" android:path="/open"');
    expect(manifest).toContain('android:host="workout-one-mocha.vercel.app" android:pathPrefix="/open/"');
    const routes = JSON.parse(read('../../vercel.json')).routes as { src: string; status?: number; headers?: Record<string, string> }[];
    for (const [link, tab] of Object.entries(APP_LINK_TABS)) {
      const redirect = routes.find(item => item.status === 308 && new RegExp(`^${item.src}$`).test(link));
      const captured = redirect ? new RegExp(`^${redirect.src}$`).exec(link)?.[1] ?? '' : '';
      expect(redirect?.headers?.Location?.replace('$1', captured)).toBe(TAB_PATHS[tab]);
    }
    const viteConfig = read('../../vite.config.ts');
    expect(viteConfig).toContain('/^\\/open(?:\\/|$)/');
    expect(viteConfig).toContain('/^\\/\\.well-known\\//');
    const [statement] = JSON.parse(read('../../public/.well-known/assetlinks.json'));
    expect(statement.relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(statement.target.package_name).toBe('com.workoutapp.phone');
    expect(statement.target.sha256_cert_fingerprints.length).toBeGreaterThan(0);
    for (const print of statement.target.sha256_cert_fingerprints) expect(print).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
