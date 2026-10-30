import { mergeParams, stockParams } from 'procedural-paper';
import { describeNode, materializeNode } from '../../../../packages/paper/src/composition/nodes';
import { visitNodes, type PaperComposition, type CompositionAsset } from '../../../../packages/paper/src/composition/model';
import type { CardPlan } from './cards';
import type { BuiltCard } from './render';
import type { MotionSpec } from './motion-spec';
import { textureScale } from './papers';
import { LIGHT } from './render';
import { photoMeta } from './photos';
import fontAssets from './font-assets.json';
import { activePenBundles, PEN_FONTS } from './handwriting';
const snapshots = new WeakMap<BuiltCard, PaperComposition>();
const sources = new Map<string, string>();
const licenseTexts = import.meta.glob('./pen-fonts/*/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string,string>;
export const assetSource = (asset: CompositionAsset) => sources.get(asset.id) ?? `${new URL('../', location.href).pathname}${asset.file}`;
export function licenseSource(file: string): string | undefined {
  return licenseTexts[`./${file}`];
}
export function capturePrepared(plan: CardPlan, built: BuiltCard, angle: number, grain: number, light: {azimuth:number;elevation:number}) {
  const value: PaperComposition = {
    version: 1, kind: plan.preset ?? plan.info.kind, width: plan.w, height: plan.h, rotation: angle,
    paper: plan.paper, params: mergeParams(stockParams(plan.paper), plan.params ?? {}), sheet: structuredClone(plan.look),
    environment: { grain, light: {...light}, pixelRatio: Math.min(2, devicePixelRatio || 1) },
    content: plan.ink ? describeNode(plan.ink) : null,
    attachments: plan.attach.map((a,i) => a.type === 'html' ? { type: 'html', layer:a.layer, label:a.label, binds:a.binds, node:describeNode(a.el,`a${i}`) } : structuredClone(a)),
    info: structuredClone(plan.info), assets: [], motionSeed: 1, pen:false,
  };
  const photos = new Set<string>();
  let text = '0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  visitNodes(value, n => { text += n.text ?? ''; });
  const families = new Set(plan.info.fonts);
  visitNodes(value, n => { if(n.photo) { photos.add(n.photo.id); if(n.photo.stamp) families.add('VT323'); } const family = n.attributes?.style?.match(/font-family:\s*([^;]+)/)?.[1]; if(family) families.add(family.split(',')[0].trim().replace(/^['"]|['"]$/g,'')); if(n.fit) families.add(n.fit.spec.font.family); });
  value.attachments.forEach(a=> { if(a.type === 'photo') { photos.add(a.photo.id); if(a.photo.stamp) families.add('VT323'); } });
  // Default UI font used by otherwise unstyled content.
  families.add('Inter');
  for (const id of photos) value.assets.push({ id, kind:'photo', file:`photos/${id}.webp`, photo:{focus:photoMeta(id).focus}, credits:`${id}.webp — CC0; author and original URL in photos/README.md`, licenseFiles:['photos/README.md'] });
  value.assets.push(...fontAssets.filter(a=>families.has(a.family) && a.descriptors.unicodeRange.split(',').some(range=>{ const [start,end] = range.trim().replace(/^U\+/, '').split('-').map(n=>parseInt(n,16)); return [...text].some(c=>c.codePointAt(0)! >= start && c.codePointAt(0)! <= (end ?? start)); })) as CompositionAsset[]);
  for(const [id,bundle] of activePenBundles()) {
    const pf = PEN_FONTS.find(f=>f.id===id)!;
    if(!families.has(bundle.family) && !(pf.matches && families.has(pf.matches))) continue;
    const licenses = id === 'caveat' ? ['fonts/caveat-LICENSE.txt'] : Object.keys(licenseTexts).filter(f=>f.startsWith(`./pen-fonts/${id}/`)).map(f=>f.slice(2));
    const dataId=`pen-${id}`; const fontId=`pen-font-${id}`;
    // Immutable blob URLs are retained for the lifetime of this desk document.
    if(!sources.has(dataId)) sources.set(dataId,URL.createObjectURL(new Blob([JSON.stringify({...bundle,fontUrl:undefined,fontFaceCSS:undefined})],{type:'application/json'})));
    sources.set(fontId,bundle.fontUrl);
    value.assets.push({id:dataId,kind:'pen',file:`pen/${id}.json`,family:bundle.family,matches:pf.matches,credits:`${pf.label} stroke data and font; see accompanying licenses.`,licenseFiles:licenses}, {id:fontId,kind:'font',file:`pen/${id}.otf`,family:bundle.family,credits:pf.label,licenseFiles:licenses});
    value.pen=true;
  }
  snapshots.set(built,value);
  // The desk and exports both render the captured definition, before motion.
  plan.ink = value.content ? materializeNode(value.content, '') as HTMLElement : null;
  plan.attach = value.attachments.map(a => a.type === 'html' ? { ...a, el: materializeNode(a.node, '') as HTMLElement } : structuredClone(a));
}
export function captureMotion(built: BuiltCard, spec: MotionSpec, ink: HTMLElement | null) {
  const value=snapshots.get(built); if(!value || !ink) return;
  value.motion = { ...spec, steps:spec.steps.flatMap(step=>{
    const nodes=typeof step.target==='string' ? [...ink.querySelectorAll(step.target)] : [step.target];
    const ids=nodes.map(n=>n.getAttribute('data-pc-node')).filter(Boolean);
    return ids.length ? [{...step,target:ids.map(id=>`[data-pc-node="${id}"]`).join(',')}] : [];
  }) };
}
export function compositionFor(built:BuiltCard, seed:number, rotation:number):PaperComposition {
  const value=snapshots.get(built); if(!value) throw new Error('Wait for the paper to finish rendering.');
  return structuredClone({...value,motionSeed:seed ^ 0x9e3779b9,rotation,environment:{...value.environment,grain:textureScale,light:{...LIGHT}}});
}
