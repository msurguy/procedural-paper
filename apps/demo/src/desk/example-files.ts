import type { PaperComposition } from 'procedural-paper/composition';
import { assetSource, licenseSource } from './composition-capture';
import mit from '../../../../LICENSE?raw';
const json = (value: unknown) => JSON.stringify(value,null,2);
export function exampleFiles(composition: PaperComposition, flavor: 'React'|'Vanilla') {
  const entryFile = flavor === 'React' ? 'main.tsx' : 'main.ts';
  const mapping = composition.assets.map(a => `  ${json(a.id)}: new URL(${json('./'+a.file)}, import.meta.url).href,`).join('\n');
  const assets = `import type { CompositionAsset } from 'procedural-paper/composition';\n\nconst urls: Record<string, string> = {\n${mapping}\n};\nexport const resolveAsset = (asset: CompositionAsset) => {\n  const url = urls[asset.id];\n  if (!url) throw new Error('Missing asset: ' + asset.id);\n  return url;\n};\n`;
  const dataImport = `import data from './composition.json';\nimport type { PaperComposition as CompositionData } from 'procedural-paper/composition';\nimport { resolveAsset } from './assets';\nimport 'procedural-paper/composition.css';\n\nconst composition = data as unknown as CompositionData;\n`;
  const react = `import { PaperComposition } from 'procedural-paper/composition/react';\n${dataImport}\nexport default function Example() {\n  return <PaperComposition composition={composition} resolveAsset={resolveAsset} fit="contain" />;\n}\n`;
  const vanilla = `import { createPaperComposition } from 'procedural-paper/composition';\n${dataImport}\nexport function mountExample(host: HTMLElement) {\n  const paper = createPaperComposition({ composition, resolveAsset, fit: 'contain' });\n  host.append(paper.element);\n  // Await paper.ready to catch missing assets or rendering failures.\n  // Controls: paper.play(), pause(), replay(), seek(0..1).\n  return paper; // Call paper.dispose() when removing this component.\n}\n`;
  const peers = {'@chenglou/pretext':'0.0.9',brushmark:'0.1.2',tegaki:'1.1.0'};
  const readme = `# ${composition.info.kind}\n\nAn editable, procedural component exported from the paper desk.\n\n1. Install procedural-paper@0.1.0 and ${Object.entries(peers).map(([k,v])=>`${k}@${v}`).join(', ')}. React users also need React 18 or 19 and react-dom.\n2. Keep this folder together in your Vite (or compatible TypeScript bundler) application. Import Example.tsx for React, or call mountExample(host) from vanilla.ts for vanilla.\n3. For a standalone preview: npm install, then npm run dev. To build: npm run build.\n\nAll required photos, fonts, stroke data and licenses are included. Rendering makes no requests to external asset services. Dependencies must be installed before offline use. The library must be available from npm or installed from its GitHub checkout (build packages/paper first).\n\nEdit composition.json to change text, photo IDs/crops, paper parameters, attachments, or motion. IDs are stable animation targets. The setCompositionText helper returns an editable copy and refits text when changing a fitted node. Add new photos to assets.ts and composition.assets before referencing them. Keep font licenses when redistributing.\n\nThe captured dimensions are fixed; fit="contain" proportionally scales the complete composition. The export includes paper, decorations, photos and content motion. Desk dragging, peeling and selection outlines belong to the demo. Exact procedural rendering requires WebGL2; the runtime exposes rendered=false for its readable fallback.\n\nCode: MIT. Media and fonts: see CREDITS.md and accompanying license files.\n`;
  const packageJson = {private:true,type:'module',scripts:{dev:'vite',build:'vite build'},dependencies:{'procedural-paper':'0.1.0',...peers,...(flavor==='React'?{react:'^19.2.0','react-dom':'^19.2.0'}:{})},devDependencies:{vite:'^6.4.5',typescript:'^5.6.3',...(flavor==='React'?{'@types/react':'^19.2.0','@types/react-dom':'^19.2.0'}:{})}};
  return {'Example.tsx':react,'vanilla.ts':vanilla,'assets.ts':assets,'composition.json':json(composition),'README.md':readme,'LICENSE':mit,'CREDITS.md':composition.assets.map(a=>`- ${a.file}: ${a.credits} (${a.licenseFiles.join(', ')})`).join('\n'),'package.json':json(packageJson),'tsconfig.json':json({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',resolveJsonModule:true,esModuleInterop:true,skipLibCheck:true,strict:true,noEmit:true},include:flavor==='React'?['*.ts','*.tsx']:['*.ts']}),'index.html':'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Paper example</title><style>body{margin:24px;background:#e9e5de}#app{max-width:900px;margin:auto}</style><div id="app"></div><script type="module" src="./main.tsx"></script></html>'.replace('main.tsx',entryFile),[entryFile]:flavor==='React'?`import { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport Example from './Example';\ncreateRoot(document.querySelector('#app')!).render(<StrictMode><Example /></StrictMode>);\n`:`import { mountExample } from './vanilla';\nconst paper = mountExample(document.querySelector('#app')!);\npaper.ready.catch(error => { console.error(error); document.body.append(String(error)); });\n`};
}
export async function collectExampleFiles(composition: PaperComposition, flavor: 'React'|'Vanilla') {
  const encoder=new TextEncoder(); const files: Record<string,Uint8Array> = Object.fromEntries(Object.entries(exampleFiles(composition,flavor)).map(([key,value])=>[key,encoder.encode(value)]));
  const fetchFile=async(url:string) => { const response=await fetch(url); if(!response.ok) throw new Error(`Could not download ${url}`); return new Uint8Array(await response.arrayBuffer()); };
  for(const a of composition.assets) {
    files[a.file]=await fetchFile(assetSource(a));
    for(const file of a.licenseFiles) if(!files[file]) {
      const source=licenseSource(file); files[file]=source ? encoder.encode(source) : await fetchFile(`${new URL('../',location.href).pathname}${file}`);
    }
  }
  return files;
}
/** Standard ZIP, stored entries. No runtime dependency or external service. */
export function zipFiles(files: Record<string,Uint8Array>): Blob {
  const parts:Uint8Array[]=[], central:Uint8Array[]=[]; let offset=0;
  const crc=(data:Uint8Array) => { let n=0xffffffff; for(const byte of data) { n^=byte; for(let i=0;i<8;i++) n=(n>>>1)^((n&1)?0xedb88320:0); } return (n^0xffffffff)>>>0; };
  for(const [file,data] of Object.entries(files)) {
    const name=new TextEncoder().encode(file), checksum=crc(data), local=new Uint8Array(30+name.length), view=new DataView(local.buffer);
    view.setUint32(0,0x04034b50,true); view.setUint16(4,20,true); view.setUint16(6,0x800,true); view.setUint32(14,checksum,true); view.setUint32(18,data.length,true); view.setUint32(22,data.length,true); view.setUint16(26,name.length,true); local.set(name,30);
    const entry=new Uint8Array(46+name.length), v=new DataView(entry.buffer); v.setUint32(0,0x02014b50,true); v.setUint16(4,20,true); v.setUint16(6,20,true); v.setUint16(8,0x800,true); v.setUint32(16,checksum,true); v.setUint32(20,data.length,true); v.setUint32(24,data.length,true); v.setUint16(28,name.length,true); v.setUint32(42,offset,true); entry.set(name,46);
    parts.push(local,data);central.push(entry);offset+=local.length+data.length;
  }
  const end=new Uint8Array(22),v=new DataView(end.buffer); v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);v.setUint32(12,central.reduce((n,a)=>n+a.length,0),true);v.setUint32(16,offset,true);
  return new Blob([...parts,...central,end] as BlobPart[],{type:'application/zip'});
}
