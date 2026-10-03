import {WifiOff} from 'lucide-react';
import {Button} from './Button';
import {StartupScreen} from './StartupScreen';
import './CardFeedback.css';

export function ConnectionRecovery({message,onRetry}:{message:string;onRetry:()=>Promise<void>}){
  return <StartupScreen className="startup-recovery connection-recovery"><div role="status" className="startup-recovery-copy">
    <span className="recovery-error-icon" aria-hidden="true"><WifiOff size={24}/></span>
    <p className="eyebrow">CONNECTION</p>
    <h1 id="startup-heading">Connection paused</h1>
    <p>{message||'The service is temporarily unavailable. Please try again shortly.'}</p>
    </div>
    <div className="recovery-actions"><Button variant="primary" className="full-width" onClick={()=>void onRetry()}>Try again</Button></div>
  </StartupScreen>;
}
