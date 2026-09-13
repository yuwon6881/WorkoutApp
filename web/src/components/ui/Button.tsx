import type { ButtonHTMLAttributes } from 'react';
export function Button({className='',variant='secondary',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'tertiary'|'destructive'}) { return <button type="button" className={`button ${variant} ${className}`} {...props}/>; }
