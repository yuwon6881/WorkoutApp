import {afterEach, describe, expect, it, vi} from 'vitest';
import {fetchWithAvailabilityRecovery} from './availabilityRecovery';

afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

describe('temporary service availability',()=>{
  it('accepts empty success responses even when the browser exposes a body stream',async()=>{
    const response=new Response(null,{status:204});
    Object.defineProperty(response,'body',{value:{}});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
    expect((await fetchWithAvailabilityRecovery('/api/photos/delete',{method:'POST'},false,20000)).status).toBe(204);
  });
  it('uses one deadline across attempts rather than restarting the clock',async()=>{
    vi.useFakeTimers();
    const fetch=vi.fn().mockImplementation((_url:string,options:RequestInit)=>new Promise<Response>((resolve,reject)=>{
      const timer=setTimeout(()=>resolve(new Response('',{status:429})),4000);
      options.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal?.reason);},{once:true});
    }));
    vi.stubGlobal('fetch',fetch);
    const result=fetchWithAvailabilityRecovery('/api/auth/me',{},true,12000);
    const rejected=expect(result).rejects.toMatchObject({name:'TimeoutError'});
    await vi.advanceTimersByTimeAsync(12000);
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('returns a cooldown immediately when Retry-After cannot fit the deadline',async()=>{
    vi.useFakeTimers();
    const fetch=vi.fn().mockResolvedValue(new Response('',{status:429,headers:{'Retry-After':'60'}}));
    vi.stubGlobal('fetch',fetch);
    expect((await fetchWithAvailabilityRecovery('/api/auth/me',{},true,15000)).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retries gateway 429s on explicitly safe reads and sync passes',async()=>{
    vi.useFakeTimers();
    const fetch=vi.fn().mockResolvedValueOnce(new Response('No available instance',{status:429}))
      .mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch',fetch);
    const result=fetchWithAvailabilityRecovery('/api/integrations/google-health/sync',{method:'POST'},true);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).status).toBe(200);
  });
  it('honors Retry-After and stops after two retries',async()=>{
    vi.useFakeTimers();
    const fetch=vi.fn().mockImplementation(()=>Promise.resolve(new Response('{}',{status:429,headers:{'Retry-After':'10'}})));
    vi.stubGlobal('fetch',fetch);
    const result=fetchWithAvailabilityRecovery('/api/auth/me',{},true);
    await vi.advanceTimersByTimeAsync(9999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10001);
    expect((await result).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('never repeats an ordinary mutation',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('{}',{status:429}));
    vi.stubGlobal('fetch',fetch);
    expect((await fetchWithAvailabilityRecovery('/api/sync',{method:'POST'},false)).status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('cancels a pending retry when the caller is aborted',async()=>{
    vi.useFakeTimers();
    const controller=new AbortController();
    const fetch=vi.fn().mockResolvedValue(new Response('{}',{status:429}));
    vi.stubGlobal('fetch',fetch);
    const result=fetchWithAvailabilityRecovery('/api/auth/me',{signal:controller.signal},true);
    const rejected=expect(result).rejects.toMatchObject({name:'AbortError'});
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
