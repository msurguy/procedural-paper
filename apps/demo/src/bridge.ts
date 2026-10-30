/** Publish each isolated view's settings to the two-tab shell. */
export function publishState() {
  if (parent !== window) parent.postMessage({ type: 'paper-demo-state', hash: location.hash }, location.origin);
}
export function shareURL() {
  if (parent === window || parent.location.origin !== location.origin) return location.href;
  const url = new URL(parent.location.href);
  const view = location.pathname.includes('/exporter/') ? 'exporter' : 'desk';
  url.searchParams.set('tab', view); url.searchParams.set(view, location.hash);
  return url.href;
}
