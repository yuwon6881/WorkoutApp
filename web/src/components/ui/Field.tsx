import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type Ref,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react';

type FieldChrome = {
  label: ReactNode;
  error?: string;
  className?: string;
};

function fieldIds(id: string | undefined, generated: string, error: string | undefined, name: string | undefined, label: ReactNode) {
  const controlId = id ?? generated;
  const controlName = name ?? (typeof label === 'string' ? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : controlId);
  return { controlId, controlName, errorId: error ? `${controlId}-error` : undefined };
}

export function Field({ label, error, className = '', id, name, ...props }: FieldChrome & InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  const generated = useId();
  const { controlId, controlName, errorId } = fieldIds(id, generated, error, name, label);
  return <label className={`field ${className}`.trim()} htmlFor={controlId}>
    <span>{label}</span>
    <input id={controlId} name={controlName} aria-invalid={error ? true : undefined} aria-describedby={errorId} {...props} />
    {error && <span id={errorId} className="field-error" role="alert">{error}</span>}
  </label>;
}

export function TextAreaField({
  label,
  error,
  className = '',
  id,
  name,
  autoGrow = false,
  ref: forwardedRef,
  onInput,
  style,
  ...props
}: FieldChrome & TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>;
  autoGrow?: boolean;
}) {
  const generated = useId();
  const { controlId, controlName, errorId } = fieldIds(id, generated, error, name, label);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const userHeightRef = useRef<number | null>(null);

  useEffect(() => {
    userHeightRef.current = null;
  }, [controlId]);

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !autoGrow) return;
    textarea.style.height = 'auto';
    const computed = window.getComputedStyle(textarea);
    const borders = (Number.parseFloat(computed.borderTopWidth) || 0) + (Number.parseFloat(computed.borderBottomWidth) || 0);
    const contentHeight = textarea.scrollHeight + (Number.isFinite(borders) ? borders : 0);
    const targetHeight = userHeightRef.current != null
      ? Math.max(contentHeight, userHeightRef.current)
      : contentHeight;
    const heightStr = `${targetHeight}px`;
    if (textarea.style.height !== heightStr) textarea.style.height = heightStr;
  }, [autoGrow]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !autoGrow) return;
    const onPointerUp = () => {
      if (textarea.offsetHeight > 0) {
        userHeightRef.current = textarea.offsetHeight;
      }
    };
    textarea.addEventListener('pointerup', onPointerUp);
    return () => textarea.removeEventListener('pointerup', onPointerUp);
  }, [autoGrow]);

  useLayoutEffect(() => {
    resize();
  }, [resize, props.value, props.defaultValue]);

  useLayoutEffect(() => {
    if (!autoGrow) return;
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [autoGrow, resize]);

  const setRef = useCallback((node: HTMLTextAreaElement | null) => {
    textareaRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const handleInput: TextareaHTMLAttributes<HTMLTextAreaElement>['onInput'] = event => {
    onInput?.(event);
    resize();
  };

  return <label className={`field ${className}`.trim()} htmlFor={controlId}>
    <span>{label}</span>
    <textarea id={controlId} name={controlName} ref={setRef} className={autoGrow ? 'auto-grow-textarea' : undefined}
      aria-invalid={error ? true : undefined} aria-describedby={errorId} onInput={handleInput}
      style={style} {...props} />
    {error && <span id={errorId} className="field-error" role="alert">{error}</span>}
  </label>;
}

export function SelectField({ label, error, className = '', id, name, children, ...props }: FieldChrome & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const { controlId, controlName, errorId } = fieldIds(id, generated, error, name, label);
  return <label className={`field ${className}`.trim()} htmlFor={controlId}>
    <span>{label}</span>
    <select id={controlId} name={controlName} aria-invalid={error ? true : undefined} aria-describedby={errorId} {...props}>{children}</select>
    {error && <span id={errorId} className="field-error" role="alert">{error}</span>}
  </label>;
}
