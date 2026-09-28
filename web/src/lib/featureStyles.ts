const loads = new Map<string, Promise<void>>();

/** Native stylesheet loading preserves specificity and prevents late CSS from overriding
 * index/layout rules. Links retain alphabetical feature ordering on every navigation path. */
export function loadFeatureStyle(url: string, name: string): Promise<void> {
  const existing = loads.get(name);
  if (existing) return existing;
  const load = new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = url; link.dataset.featureStyle = name;
    link.onload = () => resolve();
    link.onerror = () => { link.remove(); loads.delete(name); reject(new Error('This view could not load its styles. Reconnect and retry.')); };
    const before = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
      .find(element => !element.dataset.featureStyle || element.dataset.featureStyle.localeCompare(name) > 0);
    document.head.insertBefore(link, before ?? null);
  });
  loads.set(name, load);
  return load;
}
