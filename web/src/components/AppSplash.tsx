/// The first frame on a device with no sign-in behind it: the mark alone, centred, until the session
/// check answers with the sign-in screen (or the app). It appears only after a short delay, so a
/// fast answer goes straight to the next screen without a flash. Its styles live in layout.css,
/// which the built page links before any script, as the boot shell (scripts/boot-shell.ts) needs.
export function AppSplash() {
  return (
    <main className="app-splash" role="status" aria-busy="true">
      <img src="/favicon.svg" alt="" />
      <span aria-hidden="true">Workout</span>
      <span className="sr-only">Opening Workout</span>
    </main>
  );
}
