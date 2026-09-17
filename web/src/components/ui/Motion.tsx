import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';

const fallbackEase = 'cubic-bezier(.2,.8,.2,1)';

function motionTiming(variable: string, fallback: number) {
  const styles = getComputedStyle(document.documentElement);
  const value = styles.getPropertyValue(variable).trim();
  const duration = value.endsWith('ms')
    ? Number.parseFloat(value)
    : value.endsWith('s')
      ? Number.parseFloat(value) * 1000
      : Number.NaN;
  return {
    duration: Number.isFinite(duration) ? duration : fallback,
    easing: styles.getPropertyValue('--motion-ease').trim() || fallbackEase,
    fill: 'both' as const
  };
}
type NavigationInput = 'keyboard' | 'pointer';
let lastNavigationInput: NavigationInput = 'pointer';
let modalityReset: ReturnType<typeof setTimeout> | undefined;

function useNavigationInput() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mark = (origin: NavigationInput) => {
      lastNavigationInput = origin;
      if (modalityReset !== undefined) window.clearTimeout(modalityReset);
      modalityReset = window.setTimeout(() => {
        lastNavigationInput = 'pointer';
        modalityReset = undefined;
      }, 0);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Tab' ||
        event.key === 'Enter' ||
        event.key === ' ' ||
        event.key.startsWith('Arrow') ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        mark('keyboard');
      }
    };

    const onPointerDown = () => mark('pointer');

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reduced;
}

export function MotionScene({
  sceneKey,
  children,
  className = ''
}: {
  sceneKey: string;
  children: ReactNode;
  className?: string;
}) {
  const scene = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const first = useRef(true);
  const previousSceneKey = useRef(sceneKey);
  
  useNavigationInput();

  useLayoutEffect(() => {
    const node = scene.current;
    if (!node) return;

    const heading = node.querySelector<HTMLElement>('[data-page-heading]');

    if (first.current) {
      first.current = false;
      previousSceneKey.current = sceneKey;
      return;
    }

    const transitioned = previousSceneKey.current !== sceneKey;
    previousSceneKey.current = sceneKey;

    if (!transitioned) return;

    let clearOrigin: () => void = () => {};

    if (heading) {
      const origin = lastNavigationInput === 'keyboard' ? 'keyboard' : 'programmatic';
      heading.dataset.focusOrigin = origin;
      clearOrigin = () => {
        if (heading.dataset.focusOrigin === origin) delete heading.dataset.focusOrigin;
      };
      heading.addEventListener('blur', clearOrigin, { once: true });
      heading.focus({ preventScroll: true });
    }

    if (reduced) {
      return () => {
        clearOrigin();
        heading?.removeEventListener('blur', clearOrigin);
      };
    }

    // Keep the destination visible while the scene settles. Fading the whole page to opacity
    // zero made ready server content look like it was still loading during tab navigation.
    const animation = node.animate(
      [{ transform: 'translateY(16px)' }, { transform: 'translateY(0)' }],
      motionTiming('--motion-panel', 240)
    );

    animation.onfinish = () => {
      animation.cancel();
      node.style.removeProperty('opacity');
      node.style.removeProperty('transform');
    };

    return () => {
      clearOrigin();
      heading?.removeEventListener('blur', clearOrigin);
      animation.cancel();
      node.style.removeProperty('opacity');
      node.style.removeProperty('transform');
    };
  }, [sceneKey, reduced]);

  return (
    <div ref={scene} className={`motion-scene ${className}`.trim()} data-motion-scene={sceneKey}>
      {children}
    </div>
  );
}

export function MotionPanel({
  motionKey,
  direction = 1,
  children,
  className = ''
}: {
  motionKey: string;
  direction?: 1 | -1;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const first = useRef(true);

  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;

    if (first.current) {
      first.current = false;
      return;
    }

    if (reduced) return;

    const animation = node.animate(
      [
        { opacity: 0, transform: `translateX(${direction * 20}px)` },
        { opacity: 1, transform: 'translateX(0)' }
      ],
      motionTiming('--motion-exit', 180)
    );

    animation.onfinish = () => {
      node.style.removeProperty('opacity');
      node.style.removeProperty('transform');
    };

    return () => {
      animation.cancel();
      node.style.removeProperty('opacity');
      node.style.removeProperty('transform');
    };
  }, [motionKey, direction, reduced]);

  return (
    <div ref={panel} className={`motion-panel ${className}`.trim()} data-motion-panel={motionKey}>
      {children}
    </div>
  );
}

export function SelectionIndicator({
  active,
  className = '',
  style,
  id,
  children
}: {
  active: string;
  className?: string;
  style?: CSSProperties;
  id?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const container = root.current;
    const indicator = marker.current;
    if (!container || !indicator) return;

    const measure = () => {
      const selected = [...container.querySelectorAll<HTMLElement>('[data-selection-key]')].find(
        (element) => element.dataset.selectionKey === active
      );

      indicator.hidden = !selected;
      if (!selected) return;

      indicator.style.width = `${selected.offsetWidth}px`;
      indicator.style.height = `${selected.offsetHeight}px`;
      indicator.style.transform = `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`;
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active]);

  return (
    <div
      ref={root}
      id={id}
      className={`selection-indicator ${className}`.trim()}
      data-motion-reduced={reduced || undefined}
      style={style}
    >
      <span ref={marker} className="selection-indicator-marker" aria-hidden="true" />
      {children}
    </div>
  );
}
