import {lazy,Suspense,useEffect,useState} from 'react';
import {isNative} from '../lib/platform';
const ApkUpdateSettings=lazy(()=>import('./ApkUpdateSettings').then(module=>({default:module.ApkUpdateSettings})));

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
  return <div><p className="app-version-meta">Android version {build}.</p><Suspense fallback={null}><ApkUpdateSettings/></Suspense></div>;
}
