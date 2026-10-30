import type { PaperParams } from '../params';
import type { FitSpec } from './fit';
import type { PhotoSpec, PhotoMeta } from './photos';
import type { Attach, CardInfo, SheetLook } from './scene';
import type { MotionSpec } from './motion-spec';

export interface CompositionAsset {
  id: string;
  kind: 'photo' | 'font' | 'pen';
  file: string;
  family?: string;
  descriptors?: { weight?: string; style?: string; unicodeRange?: string };
  photo?: Pick<PhotoMeta, 'focus'>;
  /** Pen bundle family may differ from the name used by text. */
  matches?: string;
  credits: string;
  licenseFiles: string[];
}
export interface CompositionNode {
  id: string;
  tag?: string;
  namespace?: 'svg';
  text?: string;
  attributes?: Record<string, string>;
  children?: CompositionNode[];
  photo?: PhotoSpec;
  fit?: { spec: FitSpec; resolved?: string };
}
export type CompositionAttachment = Exclude<Attach, { type: 'html' }> | { type: 'html'; layer: 'front' | 'back'; node: CompositionNode; label?: string; binds?: boolean };
export interface PaperComposition {
  version: 1;
  kind: string;
  width: number;
  height: number;
  rotation: number;
  paper: string;
  params: PaperParams;
  sheet: SheetLook;
  environment: { grain: number; light: { azimuth: number; elevation: number }; pixelRatio: number };
  content: CompositionNode | null;
  attachments: CompositionAttachment[];
  assets: CompositionAsset[];
  info: CardInfo;
  motion?: MotionSpec;
  motionSeed: number;
  pen: boolean;
}
export type AssetResolver = (asset: CompositionAsset) => string | Promise<string>;
export function visitNodes(composition: PaperComposition, fn: (node: CompositionNode) => void) {
  const visit = (n: CompositionNode) => { fn(n); n.children?.forEach(visit); };
  if (composition.content) visit(composition.content);
  for (const a of composition.attachments) if (a.type === 'html') visit(a.node);
}
export function setCompositionText(composition: PaperComposition, nodeId: string, text: string): PaperComposition {
  const copy = structuredClone(composition); let found = false;
  visitNodes(copy, node => {
    if (node.id !== nodeId) return;
    found = true;
    const descendants = new Set<string>();
    const collect = (n: CompositionNode) => { descendants.add(n.id); n.children?.forEach(collect); };
    node.children?.forEach(collect);
    if (node.tag) for (const step of copy.motion?.steps ?? []) {
      if (typeof step.target === 'string') step.target = [...new Set(step.target.split(',').map(target => descendants.has(target.match(/"([\w-]+)"/)?.[1] ?? '') ? `[data-pc-node="${node.id}"]` : target))].join(',');
    }
    if (node.fit) {
      node.fit.spec.blocks = [{ text, keep: true }]; delete node.fit.resolved; node.children = [];
    } else if (!node.tag) node.text = text;
    else node.children = [{ id: `${node.id}-text`, text }];
  });
  if (!found) throw new Error(`Unknown content node ${nodeId}`);
  return copy;
}
export function validateComposition(value: PaperComposition) {
  if (value.version !== 1) throw new Error('Unsupported paper composition version');
  if (![value.width, value.height, value.environment.pixelRatio].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid composition dimensions');
  if (![value.rotation, value.environment.grain, value.environment.light.azimuth, value.environment.light.elevation, value.motionSeed].every(Number.isFinite)) throw new Error('Invalid composition environment');
  if (!Array.isArray(value.assets) || !Array.isArray(value.attachments)) throw new Error('Invalid composition assets or attachments');
  const ids = new Set<string>();
  visitNodes(value, n => { if (!/^[\w-]+$/.test(n.id) || ids.has(n.id)) throw new Error(`Invalid or duplicate node ID ${n.id}`); ids.add(n.id); });
  const assets = new Set<string>();
  for (const a of value.assets) {
    if (assets.has(a.id) || !a.file || a.file.includes('..') || a.file.includes('\\') || /^(?:[a-z]+:|\/)/i.test(a.file)) throw new Error(`Invalid asset ${a.id}`);
    assets.add(a.id);
  }
  visitNodes(value, n => { if (n.photo && !assets.has(n.photo.id)) throw new Error(`Missing photo ${n.photo.id}`); });
  for (const a of value.attachments) if (a.type === 'photo' && !assets.has(a.photo.id)) throw new Error(`Missing photo ${a.photo.id}`);
  for (const step of value.motion?.steps ?? []) {
    if (typeof step.target !== 'string' || !/^\[data-pc-node="[\w-]+"\](,\[data-pc-node="[\w-]+"\])*$/.test(step.target)) throw new Error('Motion targets must reference composition node IDs');
    for (const match of step.target.matchAll(/"([\w-]+)"/g)) if (!ids.has(match[1])) throw new Error(`Missing animation target ${match[1]}`);
  }
}
