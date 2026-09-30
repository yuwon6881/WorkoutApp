import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {defaultDevicePreferences} from '../lib/workoutDevicePreferences';
const native=vi.hoisted(()=>({request:vi.fn(),change:undefined as undefined|((wanted:boolean)=>Promise<void>)}));
vi.mock('../lib/platform',()=>({hasNativeWorkoutStore:()=>true,isNative:()=>true,
  getAlertCapabilities:async()=>null,openNativeSettings:vi.fn(),testNativeAlert:vi.fn()}));
vi.mock('../lib/restTimer',()=>({requestRestAlerts:native.request,testAlarmSound:vi.fn()}));
vi.mock('../lib/push/firebaseMessaging',()=>({getWorkoutPushDeviceId:()=> 'device',
  deleteWorkoutPushToken:vi.fn(),registerWorkoutPushDevice:vi.fn()}));
vi.mock('./ui/Switch',()=>({Switch:(props:{label:string;onChange:(wanted:boolean)=>Promise<void>})=>{
  if(props.label==='Rest notifications')native.change=props.onChange;
  return null;
}}));
import {RestAlertSettings} from './RestAlertSettings';

describe('native notification preference',()=>{
  beforeEach(()=>vi.resetAllMocks());
  function render(){
    const save=vi.fn();
    const notify=vi.fn();
    renderToStaticMarkup(createElement(RestAlertSettings,{
      accountId:'account',preferences:{unit:'kg',theme:'dark',restAlerts:false},
      devicePreferences:defaultDevicePreferences,onPreferences:save,onDevicePreferences:vi.fn(),notify,
    }));
    return {save,notify};
  }

  it('keeps notifications disabled after Android denies permission',async()=>{
    native.request.mockResolvedValue('denied');
    const {save,notify}=render();
    await native.change!(true);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({restAlerts:false}));
    expect(notify).toHaveBeenCalled();
  });
  it('enables notifications only after permission is granted',async()=>{
    native.request.mockResolvedValue('granted');
    const {save}=render();
    await native.change!(true);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({restAlerts:true}));
  });
  it('turns notifications off without prompting',async()=>{
    const {save}=render();
    await native.change!(false);
    expect(native.request).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({restAlerts:false}));
  });
});
