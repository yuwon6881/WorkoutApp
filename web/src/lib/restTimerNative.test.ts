import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({claim:vi.fn(),sync:vi.fn(),sound:vi.fn(),vibrate:vi.fn()}));
vi.mock('./platform',async()=>({
  hasNativeWorkoutStore:()=>true,isNative:()=>true,nativeKeepAwake:vi.fn(),
  notificationPermission:vi.fn(),syncNativeWorkout:(context:import('./nativeWorkoutProjection').NativeWorkoutContext)=>native.sync(nativeWorkoutState(context)),
}));
import {nativeWorkoutState} from './nativeWorkoutProjection';
vi.mock('./alarm',()=>({cancelAlarm:vi.fn(),primeAlarm:vi.fn(),releaseAlarm:vi.fn(),
  scheduleAlarm:vi.fn(),soundNow:native.sound,testAlarmSound:vi.fn()}));
import {RestTimer,nativeRestActionsToApply} from './restTimer';

describe('Android rest alert ownership',()=>{
  beforeEach(()=>{
    vi.useFakeTimers();vi.clearAllMocks();native.claim.mockResolvedValue(true);
    vi.stubGlobal('document',{visibilityState:'visible',addEventListener:vi.fn(),removeEventListener:vi.fn()});
    vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()});
    vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()});
    vi.stubGlobal('navigator',{vibrate:native.vibrate});
  });
  afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

  it('leaves notification-enabled rest playback to the native channel in the foreground',async()=>{
    const timer=new RestTimer();
    timer.setScope('account','workout',{notifications:true,sound:true,vibration:true,keepAwake:false});
    let announced=false;
    const unsubscribe=timer.subscribe(state=>{announced=state.announced;});
    timer.start(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(native.sync).toHaveBeenCalledWith(expect.objectContaining({alert:true,sound:true,vibrate:true}));
    expect(native.claim).not.toHaveBeenCalled();
    expect(native.sound).not.toHaveBeenCalled();
    expect(native.vibrate).not.toHaveBeenCalled();
    expect(announced).toBe(true);
    unsubscribe();
  });
});

describe('Android workout notification detail',()=>{
  beforeEach(()=>{
    vi.useFakeTimers();vi.clearAllMocks();
    vi.stubGlobal('document',{visibilityState:'visible',addEventListener:vi.fn(),removeEventListener:vi.fn()});
    vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()});
    vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()});
    vi.stubGlobal('navigator',{vibrate:native.vibrate});
  });
  afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

  it('restores committed recovery after a crash before the local timer snapshot was written',()=>{
    const now=Date.now();
    vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({endsAt:now+30000,totalSeconds:90,announced:false,generation:'old',pausedRemainingMs:0}),setItem:vi.fn(),removeItem:vi.fn()});
    const timer=new RestTimer();
    timer.setScope('account','workout',{notifications:true,sound:true,vibration:false,keepAwake:false},{
      generation:'imported',status:'running',deadlineUtc:new Date(now+60000).toISOString(),durationMs:120000,pausedRemainingMs:null,originDeviceId:null
    });
    expect(timer.current).toMatchObject({endsAt:now+60000,generation:'imported',totalSeconds:120});
    expect(native.sync).toHaveBeenLastCalledWith(expect.objectContaining({deadlineMs:now+60000,generation:'imported'}));
  });

  it('sends the rest length for the progress bar and the next set for the scoped workout only',()=>{
    const timer=new RestTimer();
    // The workout screen can report before the shell scopes the timer.
    timer.setNextUp('workout','Bench press · set 2');
    timer.setNextUp('other','Squat · set 1');
    timer.setScope('account','workout',{notifications:true,sound:true,vibration:false,keepAwake:false});
    timer.start(90);
    expect(native.sync).toHaveBeenLastCalledWith(expect.objectContaining({totalMs:90000,nextUp:null}));
    timer.setNextUp('workout','Bench press · set 2');
    expect(native.sync).toHaveBeenLastCalledWith(expect.objectContaining({totalMs:90000,nextUp:'Bench press · set 2'}));
    timer.skip();
    expect(native.sync).toHaveBeenLastCalledWith(expect.objectContaining({status:'idle',totalMs:0}));
  });

  it('applies notification rest changes only to the rest they were made on',()=>{
    const action=(generation:string,sessionId='workout')=>({sessionId,generation,kind:'extend' as const,seconds:30,atMs:1});
    const both=[action('gen-1'),action('gen-1'),action('gen-1','other')];
    expect(nativeRestActionsToApply(both,'workout','gen-1')).toHaveLength(2);
    expect(nativeRestActionsToApply(both,'workout','gen-2')).toEqual([]);
    expect(nativeRestActionsToApply(both,'workout','')).toEqual([]);
    expect(nativeRestActionsToApply([],'workout','gen-1')).toEqual([]);
  });
});

describe('Android rest alert without notification permission',()=>{
  beforeEach(()=>{
    vi.useFakeTimers();vi.clearAllMocks();native.claim.mockResolvedValue(true);
    vi.stubGlobal('document',{visibilityState:'visible',addEventListener:vi.fn(),removeEventListener:vi.fn()});
    vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn()});
    vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()});
    vi.stubGlobal('navigator',{vibrate:native.vibrate});
  });
  afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

  // The native chime and vibration need no notification permission, so the visible page never
  // plays its own: its web-audio chime could stay silent and would have stood the native one down.
  it('leaves the chime and vibration to the native alarm even with the page visible',async()=>{
    const timer=new RestTimer();
    timer.setScope('account','workout',{notifications:false,sound:true,vibration:true,keepAwake:false});
    timer.start(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(native.sync).toHaveBeenCalledWith(expect.objectContaining({alert:false,sound:true,vibrate:true}));
    expect(native.claim).not.toHaveBeenCalled();
    expect(native.sound).not.toHaveBeenCalled();
    expect(native.vibrate).not.toHaveBeenCalled();
  });
});
