import type { HTMLAttributes } from 'react';

/** A placeholder shimmer block that mirrors the shape of the content it replaces. */
export function Skeleton({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`skeleton ${className}`} {...props} />;
}
