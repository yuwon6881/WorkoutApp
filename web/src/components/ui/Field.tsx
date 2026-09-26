import {
  useId,
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

export function TextAreaField({ label, error, className = '', id, name, ...props }: FieldChrome & TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  const generated = useId();
  const { controlId, controlName, errorId } = fieldIds(id, generated, error, name, label);
  return <label className={`field ${className}`.trim()} htmlFor={controlId}>
    <span>{label}</span>
    <textarea id={controlId} name={controlName} aria-invalid={error ? true : undefined} aria-describedby={errorId} {...props} />
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
