import {afterEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({active:false,open:vi.fn()}));
vi.mock('./platform',()=>({isNative:()=>native.active}));
vi.mock('@capacitor/browser',()=>({Browser:{open:native.open}}));
import {consumeGoogleHealthHandoff,openGoogleHealthSettingsInBrowser} from './googleHealthBrowser';

afterEach(()=>{consumeGoogleHealthHandoff();vi.unstubAllGlobals();vi.resetAllMocks();});
describe('Google Health browser handoff',()=>{
  it('opens app settings without forwarding the native session or OAuth URL',async()=>{
    native.active=true;
    vi.stubGlobal('window',{location:{origin:'https://workout.example',href:'https://workout.example/?code=private'}});
    expect(await openGoogleHealthSettingsInBrowser()).toBe(true);
    expect(native.open).toHaveBeenCalledWith({url:'https://workout.example/settings'});
    expect(consumeGoogleHealthHandoff()).toBe(true);
    expect(consumeGoogleHealthHandoff()).toBe(false);
  });
  it('preserves the normal browser consent flow',async()=>{
    native.active=false;
    expect(await openGoogleHealthSettingsInBrowser()).toBe(false);
    expect(native.open).not.toHaveBeenCalled();
    expect(consumeGoogleHealthHandoff()).toBe(false);
  });
  it('does not force a refresh when the browser failed to open',async()=>{
    native.active=true;
    vi.stubGlobal('window',{location:{origin:'https://workout.example'}});
    native.open.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(openGoogleHealthSettingsInBrowser()).rejects.toThrow('Unavailable');
    expect(consumeGoogleHealthHandoff()).toBe(false);
  });
});
