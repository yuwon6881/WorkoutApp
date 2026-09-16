import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  presentation?: 'control' | 'plain';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  className = '',
  variant = 'secondary',
  presentation = 'control',
  type = 'button',
  ...props
}, ref) {
  const controlClass = presentation === 'control' ? `button ${variant}` : '';
  return <button ref={ref} type={type} className={`${controlClass} ${className}`.trim()} {...props} />;
});
