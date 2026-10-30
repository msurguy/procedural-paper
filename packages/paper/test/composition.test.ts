// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createElement, StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { renderToString } from 'react-dom/server';
import { stockParams } from '../src';
import { createPaperComposition, setCompositionText, validateComposition, type PaperComposition } from '../src/composition';
import { PaperComposition as ReactComposition } from '../src/composition/react';
import { describeNode, materializeNode } from '../src/composition/nodes';
const fixture = (): PaperComposition => ({version:1,kind:'album',width:200,height:300,rotation:0,paper:'kraft',params:stockParams('kraft'),sheet:{seed:42},environment:{grain:1,light:{azimuth:225,elevation:48},pixelRatio:1},content:{id:'root',tag:'div',children:[{id:'caption',tag:'p',children:[{id:'text',text:'Hello'}]}]},attachments:[],assets:[],info:{kind:'Album',paper:'kraft',fonts:[],attachments:[]},motionSeed:42,pen:false});
it('validates versions, targets, dimensions and local asset paths',()=>{
  expect(()=>validateComposition(fixture())).not.toThrow();
  for(const file of ['../secret.png','https://example.com/a.png','/private/a.png','..\\a']) {
    const value=fixture();value.assets=[{id:'a',kind:'photo',file,credits:'test',licenseFiles:[]}];expect(()=>validateComposition(value)).toThrow();
  }
  const value=fixture();value.motion={steps:[{kind:'fade',target:'body'}]};expect(()=>validateComposition(value)).toThrow(/targets/);
  value.motion.steps[0].target='[data-pc-node="missing"]';expect(()=>validateComposition(value)).toThrow(/Missing animation/);
  value.width=NaN;expect(()=>validateComposition(value)).toThrow(/dimensions/);
});
it('round-trips editable DOM and localizes SVG IDs without executable attributes',()=>{
  const el=document.createElement('div');el.innerHTML='<p onclick="alert(1)">Caption <b>bold</b></p><svg><filter id="ink"></filter><path style="filter:url(#ink)" d="M0 0L2 3" /></svg>';
  const model=describeNode(el);const output=materializeNode(model,'first') as HTMLElement;
  expect(output.textContent).toBe('Caption bold');expect(output.querySelector('p')!.hasAttribute('onclick')).toBe(false);expect(output.querySelector('filter')!.id).toBe('first-ink');expect(output.querySelector('path')!.getAttribute('style')).toContain('#first-ink');
});
it('text edits retain the original and retarget affected animation steps',()=>{
  const value=fixture();value.motion={steps:[{kind:'write',target:'[data-pc-node="text"]'}]};
  const edited=setCompositionText(value,'caption','New caption');validateComposition(edited);
  expect(edited.motion!.steps[0].target).toBe('[data-pc-node="caption"]');expect(value.content!.children![0].children![0].text).toBe('Hello');
  expect(()=>setCompositionText(value,'missing','Oops')).toThrow(/Unknown/);
});
it('React entry can render on the server without touching browser globals',()=>{
  expect(renderToString(createElement(ReactComposition,{composition:fixture(),resolveAsset:a=>a.file}))).toContain('aria-label="Album"');
});
it('dispose during asynchronous asset resolution releases the pending instance',async()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  const value=fixture();value.assets=[{id:'unused',kind:'photo',file:'photo.webp',credits:'test',licenseFiles:[]}];
  let finish!: (url:string)=>void;const pending=new Promise<string>(resolve=>{finish=resolve;});
  const handle=createPaperComposition({composition:value,resolveAsset:()=>pending});document.body.append(handle.element);
  await Promise.resolve();handle.dispose();finish('photo.webp');await handle.ready;expect(handle.element.isConnected).toBe(false);expect(handle.rendered).toBe(false);
  await expect(handle.update({autoplay:false})).rejects.toThrow(/disposed/);vi.restoreAllMocks();
});

it('Strict Mode leaves one mounted component and cleans it up on unmount',async()=>{
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  await act(async()=>{root.render(createElement(StrictMode,null,createElement(ReactComposition,{composition:fixture(),resolveAsset:a=>a.file})));});
  expect(host.querySelectorAll('.pc-composition')).toHaveLength(1);
  await act(async()=>root.unmount());expect(host.querySelectorAll('.pc-composition')).toHaveLength(0);host.remove();vi.restoreAllMocks();
});

it('reports missing assets explicitly without substituting content',async()=>{
  const value=fixture();value.assets=[{id:'photo',kind:'photo',file:'missing.webp',credits:'test',licenseFiles:[]}];
  const handle=createPaperComposition({composition:value,resolveAsset:()=>Promise.reject(new Error('Asset unavailable'))});
  await expect(handle.ready).rejects.toThrow('Asset unavailable');expect(handle.element.dataset.rendered).toBe('error');expect(handle.rendered).toBe(false);handle.dispose();
});
