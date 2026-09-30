import {useEffect,useState} from 'react';
import {isNative} from '../lib/platform';

export function NativeBuildInfo(){
  const [build,setBuild]=useState<string|null>(null);
  useEffect(()=>{
    if(!isNative())return;
    let active=true;
    void import('@capacitor/app').then(({App})=>App.getInfo()).then(info=>{
      if(active)setBuild(`${info.version} (build ${info.build})`);
    }).catch(()=>{});
    return()=>{active=false;};
  },[]);
  if(!build)return null;
  return <p className="app-version-meta">Android version {build}. Install a newer APK to update the native features.</p>;
}
