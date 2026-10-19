import { useEffect, useState } from 'react';
import { isNative } from '../lib/platform';

/// The installed versions, at the foot of Settings: the web bundle everywhere, and in the Android
/// app the APK version and build that the bundle is running inside.
export function AppVersionInfo({ version }: { version: string }) {
  const [android, setAndroid] = useState<{ version: string; build: string } | null>(null);

  useEffect(() => {
    if (!isNative()) return;
    let active = true;
    void import('@capacitor/app')
      .then(({ App }) => App.getInfo())
      .then(info => { if (active) setAndroid({ version: info.version, build: info.build }); })
      // Without the native answer the row stays out rather than showing a guessed version.
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  return (
    <section className="app-about" aria-labelledby="app-about-title">
      <img className="app-about-mark" src="/favicon.svg" alt="" />
      <div className="app-about-copy">
        <h2 id="app-about-title">Workout</h2>
        <dl className="app-about-versions">
          <div>
            <dt>Version</dt>
            <dd>{version}</dd>
          </div>
          {android && (
            <div>
              <dt>Android app</dt>
              <dd>{android.version} <span className="app-about-build">build {android.build}</span></dd>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
}
