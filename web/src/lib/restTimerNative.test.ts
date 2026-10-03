import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({claim:vi.fn(),sync:vi.fn(),sound:vi.fn(),vibrate:vi.fn()}));
vi.mock('./platform',()=>({
  hasNativeWorkoutStore:()=>true,isNative:()=>true,nativeKeepAwake:vi.fn(),
  notificationPermission:vi.fn(),syncNativeWorkout:native.sync,claimNativeRestAlert:native.claim,
}));
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
