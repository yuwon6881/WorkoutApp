import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({claim:vi.fn(),sync:vi.fn(),sound:vi.fn(),vibrate:vi.fn()}));
vi.mock('./platform',()=>({
  hasNativeWorkoutStore:()=>true,isNative:()=>true,nativeKeepAwake:vi.fn(),
  notificationPermission:vi.fn(),syncNativeWorkout:native.sync,claimNativeRestAlert:native.claim,
}));
vi.mock('./alarm',()=>({cancelAlarm:vi.fn(),primeAlarm:vi.fn(),releaseAlarm:vi.fn(),
  scheduleAlarm:vi.fn(),soundNow:native.sound,testAlarmSound:vi.fn()}));
import {RestTimer} from './restTimer';

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
