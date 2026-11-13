import { CircleCheck, Info } from 'lucide-react';

/// The shell's short-lived message above the navigation. A confirmation ("… saved.") reads as done;
/// anything else (a blocked action, a notice) as information.
export function ShellToast({ message }: { message: string }) {
  return <div className="toast" role="status">{message.endsWith('saved.') ? <CircleCheck size={17} /> : <Info size={17} />}{message}</div>;
}
