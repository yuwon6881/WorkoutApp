import { useEffect, useState } from 'react';

/** Display clock only: rest deadlines and alarms continue in RestTimer while hidden. */
export function useVisibleClock(active = true) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      setNow(Date.now());
      if (active && document.visibilityState === 'visible') timer = setInterval(() => setNow(Date.now()), 1000);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => { if (timer !== undefined) clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [active]);
  return now;
}
