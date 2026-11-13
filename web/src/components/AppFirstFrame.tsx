import { AppLoading } from './AppLoading';
import { AppSplash } from './AppSplash';
import { deviceWasSignedIn } from '../lib/signedInDevice';

/// What the app draws while the session check is out: the Overview skeleton for a device that was
/// signed in when it last loaded, the neutral mark for any other (lib/signedInDevice.ts).
export function AppFirstFrame() {
  return deviceWasSignedIn() ? <AppLoading /> : <AppSplash />;
}
