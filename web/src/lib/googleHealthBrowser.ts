import {isNative} from './platform';

let handoffPending=false;

export function consumeGoogleHealthHandoff():boolean{
  const pending=handoffPending;
  handoffPending=false;
  return pending;
}

export async function openGoogleHealthSettingsInBrowser():Promise<boolean>{
  if(!isNative())return false;
  const {Browser}=await import('@capacitor/browser');
  // The callback requires the browser's own authenticated session, not the WebView's cookie.
  handoffPending=true;
  try{
    await Browser.open({url:new URL('/settings',window.location.origin).href});
  }catch(error){handoffPending=false;throw error;}
  return true;
}
