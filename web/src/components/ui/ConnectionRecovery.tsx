import {WifiOff} from 'lucide-react';
import {Button} from './Button';
import './CardFeedback.css';

export function ConnectionRecovery({message,onRetry}:{message:string;onRetry:()=>Promise<void>}){
  return <main className="auth-screen"><section className="panel recovery-card connection-recovery" role="status">
    <span className="recovery-error-icon" aria-hidden="true"><WifiOff size={24}/></span>
    <p className="eyebrow">WORKOUT</p>
    <h1>Connection paused</h1>
    <p>{message||'The service is temporarily unavailable. Please try again shortly.'}</p>
    <div className="recovery-actions"><Button variant="primary" className="full-width" onClick={()=>void onRetry()}>Try again</Button></div>
  </section></main>;
}
