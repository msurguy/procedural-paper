import { checkExportConsumer } from './export-consumer';
import { test, expect } from '@playwright/test';

test('all 25 desk compositions export with identical procedural canvases and content', async ({page},testInfo) => {
  test.setTimeout(360_000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>r.abort());
  await page.goto('./desk/index.html#n=25&l=grid&p=0&mo=0&a=1');
  await expect(page.locator('#desk-area > .card.ready')).toHaveCount(25,{timeout:90_000});
  for(let i=0;i<25;i++) {
    const card=page.locator('#desk-area > .card').nth(i);
    await card.evaluate(el => { const r=el.getBoundingClientRect(); for(const type of ['pointerdown','pointerup']) el.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerId:1,clientX:r.left+r.width/2,clientY:r.top+r.height/2})); });
    await expect(card).toHaveClass(/selected/);
    await page.locator('#iReact').click();
    const dialog=page.locator('dialog');
    await expect(dialog.locator('.pc-composition')).toHaveAttribute('data-rendered','webgl2',{timeout:30_000});
    const difference=await page.evaluate((i)=>{
      const source=document.querySelectorAll('#desk-area > .card')[i];
      const output=document.querySelector('dialog .pc-card')!;
      const canvases=(el:Element)=>[...el.querySelectorAll<HTMLCanvasElement>('canvas')].filter(c=>!c.classList.contains('lifted'));
      const a=canvases(source),b=canvases(output);
      const mismatches=a.flatMap((v,j)=>{
        const other=b[j];if(!other || v.className!==other.className || v.width!==other.width || v.height!==other.height) return [v.className];
        const left=v.getContext('2d')!.getImageData(0,0,v.width,v.height).data,right=other.getContext('2d')!.getImageData(0,0,other.width,other.height).data;
        return left.some((value,k)=>value!==right[k])?[v.className]:[];
      });
      return {source:a.length,output:b.length, mismatches,text:source.querySelector('.layer')?.textContent===output.querySelector('.layer')?.textContent};
    },i);
    expect(difference,`card ${i}`).toEqual({source:difference.source,output:difference.source,mismatches:[],text:true});
    if(i===0) await page.screenshot({path:testInfo.outputPath('export-preview.png')});
    await dialog.getByRole('button',{name:'Close export'}).click();
    await expect(dialog).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('album ZIP contains local editable assets and a runnable example', async ({page},testInfo)=>{
  test.setTimeout(120000);
  await page.goto('./desk/index.html#n=4&l=grid&p=0&mo=0&a=1&k=album');
  await expect(page.locator('#desk-area > .card.ready')).toHaveCount(4,{timeout:60000});
  await page.locator('#desk-area > .card').first().click({force:true});await page.locator('#iReact').click();
  await expect(page.locator('.pc-composition')).toHaveAttribute('data-rendered','webgl2',{timeout:30000});
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP'}).click();
  const download=await downloaded;await download.saveAs(testInfo.outputPath('album-example.zip'));
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  await page.keyboard.press('Escape');await expect(page.locator('dialog')).toHaveCount(0);
  await checkExportConsumer(page,testInfo.outputPath('album-example.zip'));
});

test('motion and pen settings are captured and replay independently',async({page},testInfo)=>{
  test.setTimeout(120_000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('./desk/index.html#n=4&l=grid&p=0&k=sticky&hw=1&pf=hershey-script&s=42');
  await expect(page.locator('#desk-area > .card.ready')).toHaveCount(4,{timeout:60000});
  const index=await page.evaluate(()=> (window as any).desk.items.findIndex((i:any)=>i.card?.motion));expect(index).toBeGreaterThanOrEqual(0);
  const card=page.locator('#desk-area > .card').nth(index);await card.click({force:true});await page.locator('#iVanilla').click();
  await expect(page.locator('.pc-composition')).toHaveAttribute('data-rendered','webgl2',{timeout:30000});
  await page.locator('.example-file').selectOption('composition.json');
  const value=JSON.parse(await page.locator('dialog code').innerText());expect(value.pen).toBe(true);expect(value.assets.some((a:any)=>a.kind==='pen')).toBe(true);expect(value.motion.steps.length).toBeGreaterThan(0);
  expect(value.motion.steps.every((s:any)=>s.target.startsWith('[data-pc-node='))).toBe(true);
  await page.getByRole('button',{name:'Replay',exact:true}).last().click();
  await expect(page.locator('dialog .pc-card')).toHaveClass(/motion/);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download ZIP'}).click();await (await download).saveAs(testInfo.outputPath('pen-example.zip'));
  await page.getByRole('button',{name:'Close export'}).click();expect(errors).toEqual([]);
  await checkExportConsumer(page,testInfo.outputPath('pen-example.zip'));
});
