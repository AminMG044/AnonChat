import { chromium } from '/tmp/browser-tools/node_modules/playwright/index.mjs';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const app = spawn('npm', ['run', 'start'], { env: { ...process.env, PORT: '3000' }, stdio: 'inherit' });
let browser;
try {
  for (let i=0;i<100;i++) { try { if ((await fetch('http://localhost:3000/review-bulk')).ok) break; } catch {} await new Promise(r=>setTimeout(r,500)); }
  browser = await chromium.launch(); await mkdir('screenshots',{recursive:true});
  const report=[];
  for (const [device,width] of [['desktop',1280],['tablet',768],['mobile',375]]) {
    const page=await browser.newPage({viewport:{width,height:900},colorScheme:'dark',permissions:['clipboard-read','clipboard-write'],reducedMotion:'reduce'});
    await page.route('**/api/messages/bulk*',route=>route.fulfill({json:{canDeleteOwnMessages:true}}));
    await page.goto('http://localhost:3000/review-bulk',{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Select messages',exact:true}).click();
    const boxes=page.getByRole('checkbox');await boxes.first().focus();await page.keyboard.press('Space');
    await page.getByRole('button',{name:'Copy selected',exact:true}).click();
    await page.getByText('Copied 1 message.',{exact:true}).waitFor();
    const copied=await page.evaluate(()=>navigator.clipboard.readText());
    if(copied!=='Here is the project update.\nThe meeting is confirmed for tomorrow.')throw Error('Clipboard content changed');
    await page.getByRole('button',{name:'Delete selected',exact:true}).click();
    await page.getByRole('alertdialog').waitFor();
    const dialog=await page.getByRole('alertdialog').boundingBox();
    if(!dialog||dialog.x<0||dialog.x+dialog.width>width+1)throw Error('Dialog overflow');
    await page.screenshot({path:`screenshots/${device}-confirm.png`,fullPage:true});
    await page.getByRole('button',{name:'Keep messages',exact:true}).click();
    await page.waitForFunction(()=>document.activeElement?.textContent==='Delete selected', null, { timeout: 5000 });
    await boxes.nth(1).check();
    if(!await page.getByRole('button',{name:'Delete selected',exact:true}).isDisabled())throw Error('Other owner deletion allowed');
    await page.screenshot({path:`screenshots/${device}-mixed-selection.png`,fullPage:true});
    await page.evaluate(()=>document.documentElement.style.fontSize='200%');
    const scrollWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
    if(scrollWidth>width)throw Error('200% text zoom overflow');
    await page.screenshot({path:`screenshots/${device}-zoom.png`,fullPage:true});
    report.push({device,width,clipboard:true,confirmationBounds:true,focusRestored:true,mixedOwnerProtected:true,reducedMotion:true,textZoom:'200%',scrollWidth});
    await page.close();
  }
  await writeFile('screenshots/report.json',JSON.stringify(report,null,2));console.log('Browser bulk actions checks passed');
} finally { await browser?.close();app.kill('SIGTERM'); }
