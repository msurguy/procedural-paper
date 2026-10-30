import { fitLater, fitSpecs, type FitSpec } from './fit';
import { photoSpecs } from './photos';
import type { CompositionNode } from './model';
const tags = new Set('div span b i em strong s u small sub sup br p h1 h2 h3 ul ol li img canvas svg g path rect circle ellipse line polyline polygon text tspan defs clipPath mask pattern linearGradient radialGradient stop filter feTurbulence feDisplacementMap feColorMatrix feComposite title'.split(' '));
const allowedAttributes = new Set('class style id width height viewBox d fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity transform x y x1 y1 x2 y2 cx cy r rx ry points offset stop-color stop-opacity gradientUnits gradientTransform patternUnits patternTransform preserveAspectRatio xmlns filter clip-path mask font-size font-family text-anchor dominant-baseline type baseFrequency numOctaves seed result in in2 scale xChannelSelector yChannelSelector values operator aria-hidden aria-label role'.split(' '));
export function safeAttributes(attributes: Record<string, string> = {}) {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (!allowedAttributes.has(name) || /(?:javascript:|expression\s*\(|@import|behavior\s*:)/i.test(value)) continue;
    if ([...value.matchAll(/url\(([^)]*)\)/gi)].some(m => !/^['"]?#[\w-]+['"]?$/.test(m[1].trim()))) continue;
    result[name] = value;
  }
  return result;
}
/** Capture generator output before motion; not a snapshot of an animated card. */
export function describeNode(node: Node, prefix = 'n', counter = { n: 0 }): CompositionNode {
  const id = `${prefix}-${counter.n++}`;
  if (node.nodeType === Node.TEXT_NODE) return { id, text: node.textContent ?? '' };
  if (!(node instanceof Element) || !tags.has(node.localName)) throw new Error(`Unsupported composition element ${node.nodeName}`);
  node.setAttribute('data-pc-node', id);
  const attributes = safeAttributes(Object.fromEntries([...node.attributes].filter(a => a.name !== 'data-pc-node').map(a => [a.name, a.value])));
  const fit = fitSpecs.get(node as HTMLElement);
  const photo = photoSpecs.get(node as HTMLCanvasElement);
  return { id, tag: node.localName, ...(node.namespaceURI?.includes('svg') ? { namespace: 'svg' as const } : {}), attributes,
    children: [...node.childNodes].filter(n => n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE).map(n => describeNode(n, prefix, counter)),
    ...(fit ? { fit: { spec: structuredClone(fit), ...(node.hasAttribute('data-fit') ? { resolved: JSON.stringify(fit) } : {}) } } : {}),
    ...(photo ? { photo: structuredClone(photo) } : {}),
  };
}
function safeFit(spec: FitSpec): FitSpec {
  const result = structuredClone(spec);
  for (const block of result.blocks) if (block.html) {
    const template = document.createElement('template'); template.innerHTML = block.html;
    const clean = document.createElement('div');
    for (const node of template.content.childNodes) {
      if (node.nodeType === Node.TEXT_NODE || (node instanceof Element && tags.has(node.localName))) clean.append(materializeNode(describeNode(node), 'fit'));
    }
    block.html = clean.innerHTML;
  }
  return result;
}
export function materializeNode(node: CompositionNode, scope: string): Node {
  if (!node.tag) return document.createTextNode(node.text ?? '');
  const prefix = scope ? `${scope}-` : '';
  if (!tags.has(node.tag)) throw new Error(`Unsupported composition tag ${node.tag}`);
  const el = node.namespace === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', node.tag) : document.createElement(node.tag);
  for (const [name, value] of Object.entries(safeAttributes(node.attributes))) {
    el.setAttribute(name, name === 'id' ? `${prefix}${value}` : value.replace(/url\(['"]?#([\w-]+)['"]?\)/g, `url(#${prefix}$1)`));
  }
  el.setAttribute('data-pc-node', node.id);
  for (const child of node.children ?? []) el.appendChild(materializeNode(child, scope));
  if (node.photo) photoSpecs.set(el as HTMLCanvasElement, structuredClone(node.photo));
  if (node.fit) {
    const spec = safeFit(node.fit.spec);
    fitSpecs.set(el as HTMLElement, spec);
    if (node.fit.resolved !== JSON.stringify(node.fit.spec)) fitLater(el as HTMLElement, spec);
  }
  return el;
}
