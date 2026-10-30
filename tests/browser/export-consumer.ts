import { realpathSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { expect, type Page } from '@playwright/test';

/** Exercise the ZIP as a separate app using the packed package, with no demo aliases. */
export async function checkExportConsumer(page: Page, zip: string) {
  const temp=realpathSync(mkdtempSync(join(tmpdir(),'paper-export-consumer-'))), app=join(temp,'app');mkdirSync(app);
  const bytes=readFileSync(zip);let offset=0;const names:string[]=[];
  while(bytes.readUInt32LE(offset)===0x04034b50) {
    const size=bytes.readUInt32LE(offset+18), nameLength=bytes.readUInt16LE(offset+26), extra=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString();
    expect(name).not.toMatch(/\.\.|^\//);names.push(name);
    const start=offset+30+nameLength+extra,file=join(app,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,bytes.subarray(start,start+size));offset=start+size;
  }
  expect(names).toEqual(expect.arrayContaining(['composition.json','Example.tsx','assets.ts','LICENSE','CREDITS.md']));
  const data=JSON.parse(readFileSync(join(app,'composition.json'),'utf8'));
  for(const asset of data.assets) {expect(names).toContain(asset.file);for(const license of asset.licenseFiles) expect(names).toContain(license);}
  const packedResult=JSON.parse(execFileSync('npm',['pack','--json','--pack-destination',temp],{cwd:resolve('packages/paper'),encoding:'utf8'}));
  const packed=Array.isArray(packedResult)?packedResult[0]:packedResult.files?packedResult:packedResult['procedural-paper'];
  execFileSync('tar',['-xzf',join(temp,packed.filename),'-C',temp]);
  const modules=join(temp,'node_modules');mkdirSync(modules);symlinkSync(join(temp,'package'),join(modules,'procedural-paper'));
  for(const dep of ['react','react-dom','@types/react','@types/react-dom','@chenglou/pretext','brushmark','tegaki']) {
    mkdirSync(dirname(join(modules,dep)),{recursive:true});symlinkSync(resolve('packages/paper/node_modules',dep),join(modules,dep));
  }
  const vite=resolve('apps/demo/node_modules/vite/bin/vite.js');
  execFileSync(process.execPath,[resolve('packages/paper/node_modules/typescript/bin/tsc'),'--project',join(app,'tsconfig.json')],{cwd:app,encoding:'utf8'});
  execFileSync(process.execPath,[vite,'build',app],{cwd:app,encoding:'utf8'});
  const server=spawn(process.execPath,[vite,'preview',app,'--host','127.0.0.1','--port','4174','--strictPort'],{cwd:app,stdio:'pipe'});
  try {
    await expect.poll(async()=>{try{return(await fetch('http://127.0.0.1:4174')).status;}catch{return 0;}},{timeout:10000}).toBe(200);
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    const external:string[]=[];await page.route(/^https?:\/\/(?!127\.0\.0\.1)/,r=>{external.push(r.request().url());return r.abort();});
    await page.goto('http://127.0.0.1:4174');
    await expect(page.locator('.pc-composition')).toHaveAttribute('data-rendered','webgl2',{timeout:45000});
    await expect(page.locator('.pc-composition')).toHaveCount(1);
    expect(external).toEqual([]);expect(errors).toEqual([]);
    await page.screenshot({path:zip.replace('.zip','.png'),fullPage:true});
  } finally {server.kill();}
}
