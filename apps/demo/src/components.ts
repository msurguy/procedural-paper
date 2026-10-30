import { PaperRenderer, cardPresets } from 'procedural-paper';
import { createPaperCard } from 'procedural-paper/dom';
import '../../../packages/paper/src/styles.css';
const css = document.createElement('style');
css.textContent = 'body{margin:32px;background:#e1dcd2;font:15px/1.5 system-ui;color:#252423}main{display:flex;flex-wrap:wrap;gap:48px;align-items:start}section{padding:10px}h2{font-size:13px}.art{height:100%;background:linear-gradient(155deg,#8da7a0 40%,#637969 40% 58%,#cbbda3 58%)}';
document.head.append(css);
const renderer = new PaperRenderer();
const cards = cardPresets.map(preset => {
  const card = createPaperCard({ preset: preset.id, renderer, seed: 7 });
  card.element.dataset.preset = preset.id;
  card.slots.content.textContent = preset.label;
  if (['booth', 'film'].includes(preset.id)) card.slots.content.style.fontSize = '10px';
  if (card.slots.title) card.slots.title.textContent = 'A note on paper';
  for (const [name, slot] of Object.entries(card.slots)) if (name.startsWith('photo')) {
    const art = document.createElement('div'); art.className = 'art'; art.setAttribute('role', 'img'); art.setAttribute('aria-label', 'Abstract landscape'); slot.append(art);
  }
  const section = document.createElement('section');
  const label = document.createElement('h2'); label.textContent = preset.id;
  section.append(label, card.element); document.getElementById('gallery')!.append(section);
  return card;
});
addEventListener('pagehide', () => { cards.forEach(c => c.dispose()); renderer.dispose(); });
