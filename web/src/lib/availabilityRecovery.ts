/** Repeat only explicitly safe status reads / idempotent sync passes, never ordinary writes. */
export async function fetchWithAvailabilityRecovery(url:string, options:RequestInit, safe:boolean, timeoutMs?:number):Promise<Response>{
  for(let attempt=0;;attempt++){
    options.signal?.throwIfAborted();
    const deadline=timeoutMs===undefined?undefined:AbortSignal.timeout(timeoutMs);
    const signal=deadline?(options.signal?AbortSignal.any([options.signal,deadline]):deadline):options.signal;
    const response=await fetch(url,{...options,signal});
    if(!safe||response.status!==429||attempt>=2)return response;
    const raw=response.headers.get('Retry-After');
    const seconds=raw!==null&&/^\d+$/.test(raw)?Number(raw):null;
    const date=raw!==null?Date.parse(raw):NaN;
    // Cloud Run's no-instance rejection has no Retry-After. Give scale-to-zero startup time.
    const delay=seconds!==null?seconds*1000:Number.isFinite(date)?Math.max(0,date-Date.now()):5000*(attempt+1);
    if(delay>60000)return response;
    await response.body?.cancel();
    await waitForRetry(Math.max(250,delay),options.signal);
  }
}

function waitForRetry(delay:number,signal?:AbortSignal|null):Promise<void>{
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal?.reason);};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},delay);
    signal?.addEventListener('abort',abort,{once:true});
  });
}
