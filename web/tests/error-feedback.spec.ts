import {test,expect} from '@playwright/test';

test('Google Health status appears while uploads are still pending',async({page})=>{
  let releaseUploads!:()=>void;
  const uploads=new Promise<void>(resolve=>{releaseUploads=resolve;});
  let passes=0;
  const status={status:'connected',connectedAt:'2026-09-20T10:00:00Z',freshness:'fresh',days:[],
    workoutSync:{enabled:true,permissionGranted:true,state:'pending',pendingCount:1,revision:1,lastSuccessfulSyncAt:null}};
  await page.route('**/api/integrations/google-health',async route=>{await route.fulfill({json:status});});
  await page.route('**/api/integrations/google-health/sync-data',async route=>{
    passes++;
    await uploads;
    await route.fulfill({json:{...status,workoutSync:{...status.workoutSync,state:'idle',pendingCount:0}}});
  });
  try{
    await page.goto('/settings');
    await expect(page.getByText(/Connected since/)).toBeVisible();
    await expect.poll(()=>passes).toBe(1);
    await page.evaluate(()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));});
    await expect(page.getByText(/Connected since/)).toBeVisible();
    expect(passes).toBe(1);
  }finally{releaseUploads();}
});

for(const theme of ['light','dark']){
  test(`startup connection recovery is readable in ${theme}`,async({page},testInfo)=>{
    let available=false;
    let reads=0;
    await page.route('**/api/bootstrap/shell',async route=>{
      reads++;
      if(available)await route.continue();
      else await route.fulfill({status:503,body:'Service unavailable'});
    });
    await page.goto('/');
    await expect(page.getByRole('heading',{name:'Connection paused'})).toBeVisible();
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    const retry=page.getByRole('button',{name:'Try again',exact:true});
    const box=(await retry.boundingBox())!;
    if(page.viewportSize()!.width<1024)expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await retry.evaluate(node=>{const box=node.getBoundingClientRect();return node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));})).toBeTruthy();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
    await page.screenshot({path:testInfo.outputPath(`connection-${theme}.png`),fullPage:true});
    const before=reads;
    available=true;
    await retry.click();
    await expect(page.locator('.app-shell')).toBeVisible();
    expect(reads).toBeGreaterThan(before);
  });
}

test('Google Health retries temporary availability and offers recovery from cold errors',async({page},testInfo)=>{
  let requests=0;
  let failing=false;
  await page.route('**/api/integrations/google-health',async route=>{
    requests++;
    if(requests===1){await route.fulfill({status:429,body:'No available instance'});return;}
    if(failing){await route.fulfill({status:503,body:'Service unavailable'});return;}
    await route.fulfill({json:{status:'connected',connectedAt:'2026-09-20T10:00:00Z',freshness:'fresh',days:[],
      workoutSync:{enabled:true,permissionGranted:true,state:'idle',pendingCount:0,revision:1,lastSuccessfulSyncAt:null}}});
  });
  await page.goto('/settings');
  await expect(page.getByText(/Connected since/)).toBeVisible({timeout:15000});
  expect(requests).toBe(2);
  failing=true;
  await page.reload();
  const feedback=page.locator('.card-feedback').filter({hasText:'Google Health sync paused'});
  await expect(feedback).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await expect(page.getByRole('button',{name:'Connect Google Health',exact:true})).toHaveCount(0);
  await page.locator('.integration-card').filter({hasText:'Google Health'}).screenshot({path:testInfo.outputPath('google-health-error.png')});
  failing=false;
  const retry=feedback.getByRole('button',{name:'Retry sync'});
  await retry.click();
  await expect(feedback).toHaveCount(0);
  await expect(page.getByText(/Connected since/)).toBeVisible();
});
