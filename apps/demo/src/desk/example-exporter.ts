import { createPaperComposition, type PaperComposition } from 'procedural-paper/composition';
import 'procedural-paper/composition.css';
import './example-exporter.css';
import { getRenderer } from './papers';
import { assetSource } from './composition-capture';
import { exampleFiles, collectExampleFiles, zipFiles } from './example-files';
export function openExampleExporter(composition: PaperComposition, initial: 'React'|'Vanilla'='React') {
  let flavor=initial;
  const dialog=document.createElement('dialog');dialog.className='example-exporter';
  dialog.innerHTML=`<header><div><h2 id="example-title">Export component</h2><p>Exact paper, content, photos and decorations</p></div><form method="dialog"><button autofocus aria-label="Close export">Close</button></form></header><div class="example-columns"><section class="example-preview" aria-label="Component preview"></section><section class="example-source"><label>Framework <select><option>React</option><option>Vanilla</option></select></label><label>File <select class="example-file"></select></label><pre><code></code></pre><p class="example-status" role="status">Rendering preview…</p><footer><button class="example-replay">Replay</button><button class="example-copy">Copy file</button><button class="example-download">Download ZIP</button></footer><p>The ZIP includes editable component code, content, local photos, fonts and licenses.</p></section></div>`;
  dialog.setAttribute('aria-labelledby','example-title');document.body.append(dialog);dialog.showModal();
  const select=dialog.querySelector('select')!, files=dialog.querySelector<HTMLSelectElement>('.example-file')!,code=dialog.querySelector('code')!,status=dialog.querySelector<HTMLElement>('.example-status')!;
  select.value=flavor;
  let source=exampleFiles(composition,flavor);
  const update=()=>{source=exampleFiles(composition,flavor);files.replaceChildren(...[flavor==='React'?'Example.tsx':'vanilla.ts','composition.json','assets.ts','README.md'].map(name=>new Option(name,name)));code.textContent=source[files.value as keyof typeof source];};update();
  select.onchange=()=>{flavor=select.value as typeof flavor;update();};files.onchange=()=>{code.textContent=source[files.value as keyof typeof source];};
  const component=createPaperComposition({composition,resolveAsset:assetSource,renderer:getRenderer(),fit:'contain',autoplay:false});dialog.querySelector('.example-preview')!.append(component.element);
  component.ready.then(()=>{status.textContent=component.rendered?'Ready to copy or download.':'WebGL2 is unavailable. This is a readable fallback; exact rendering needs WebGL2.';},error=>{status.textContent=`Preview failed: ${String(error)}`;});
  dialog.querySelector<HTMLButtonElement>('.example-replay')!.onclick=()=>component.replay();
  dialog.querySelector<HTMLButtonElement>('.example-copy')!.onclick=async()=>{try{await navigator.clipboard.writeText(code.textContent!);status.textContent=`${files.value} copied. Download ZIP for companion files and assets.`;}catch(error){status.textContent=`Copy failed: ${String(error)}`;}};
  const downloadButton=dialog.querySelector<HTMLButtonElement>('.example-download')!;
  downloadButton.onclick=async()=>{downloadButton.disabled=true;status.textContent='Collecting assets…';try{const blob=zipFiles(await collectExampleFiles(composition,flavor));const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`paper-${composition.kind.replace(/[^a-z0-9-]/gi,'-')}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);status.textContent='ZIP downloaded.';}catch(error){status.textContent=`Export failed: ${String(error)}`;}finally{downloadButton.disabled=false;}};
  dialog.addEventListener('close',()=>{component.dispose();dialog.remove();},{once:true});
}
