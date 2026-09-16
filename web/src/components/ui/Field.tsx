import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react';

type FieldChrome = {
  label: ReactNode;
  error?: string;
  className?: string;
};

function fieldIds(id: string | undefined, generated: string, error: string | undefined) {
  const controlId = id ?? generated;
  return { controlId, errorId: error ? `${controlId}-error` : undefined };
}

export function Field({ label, error, className = '', id, ...props }: FieldChrome & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId();
  const { controlId, errorId } = fieldIds(id, generated, error);
  return <label className={`field ${className}`.trim()} htmlFor={controlId}>
    <span>{label}</span>
    <input id={controlId} aria-invalid={error ? true : undefined} aria-describedby={errorId} {...props} />
    {error && <span id={errorId} className="field-error" role="alert">{error}</span>}
  </label>;
}

export function TextAreaField({ label, error, className = '', id, ...props }: FieldChrome & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generated = useId();
  const { controlId, errorId } = fieldIds(id, generated, error);
  return <label className={`field ${className}`.trim()} htmlFor={controlId}>
    <span>{label}</span>
    <textarea id={controlId} aria-invalid={error ? true : undefined} aria-describedby={errorId} {...props} />
    {error && <span id={errorId} className="field-error" role="alert">{error}</span>}
  </label>;
}

export function SelectField({ label, error, className = '', id, children, ...props }: FieldChrome & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId();
  const { controlId, errorId } = fieldIds(id, generated, error);
  return <label className={`field ${className}`.trim()} htmlFor={controlId}>
    <span>{label}</span>
    <select id={controlId} aria-invalid={error ? true : undefined} aria-describedby={errorId} {...props}>{children}</select>
    {error && <span id={errorId} className="field-error" role="alert">{error}</span>}
  </label>;
}
