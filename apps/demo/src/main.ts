import './style.css';
type View = 'exporter' | 'desk';
const views: View[] = ['exporter', 'desk'];
const states: Record<View, string> = { exporter: '', desk: '' };
let active: View | undefined;
let frame: HTMLIFrameElement | undefined;
const readURL = () => {
  const query = new URLSearchParams(location.search);
  states.exporter = query.get('exporter') ?? '';
  states.desk = query.get('desk') ?? '';
  return query.get('tab') === 'desk' ? 'desk' : 'exporter';
};
function saveURL(push = false) {
  const url = new URL(location.href);
  url.searchParams.set('tab', active!);
  for (const view of views) {
    if (states[view]) url.searchParams.set(view, states[view]); else url.searchParams.delete(view);
  }
  history[push ? 'pushState' : 'replaceState'](null, '', url);
}
function mount(view: View, push = false) {
  if (push && active === view) return;
  // Destroy the old document: its animation loops and GL context cannot run in a hidden tab.
  frame?.remove();
  active = view;
  for (const id of views) {
    const button = document.getElementById(`tab-${id}`)!;
    button.setAttribute('aria-selected', String(id === view)); button.tabIndex = id === view ? 0 : -1;
    document.getElementById(`panel-${id}`)!.hidden = id !== view;
  }
  frame = document.createElement('iframe');
  frame.title = view === 'desk' ? 'Interactive paper desk' : 'Paper texture exporter';
  frame.src = `./${view}/index.html${states[view]}`;
  document.getElementById(`panel-${view}`)!.append(frame);
  saveURL(push);
}
for (const view of views) {
  const button = document.getElementById(`tab-${view}`)!;
  button.addEventListener('click', () => mount(view, true));
  button.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 'exporter' : e.key === 'End' ? 'desk' : views[(views.indexOf(view) + 1) % 2];
    document.getElementById(`tab-${next}`)!.focus(); mount(next, true);
  });
}
addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== frame?.contentWindow || !active) return;
  if (e.data?.type === 'paper-demo-state' && typeof e.data.hash === 'string' && (!e.data.hash || e.data.hash.startsWith('#'))) {
    states[active] = e.data.hash; saveURL();
  }
});
addEventListener('popstate', () => mount(readURL()));
mount(readURL());
