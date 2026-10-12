import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFeatureStyle } from './featureStyles';

interface StubElement {
  tagName: string;
  rel?: string;
  href?: string;
  dataset: Record<string, string | undefined>;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove: () => void;
}

function createStubDom(initialNodes: StubElement[] = []) {
  const headElements: StubElement[] = [...initialNodes];

  const head = {
    children: headElements,
    insertBefore(node: StubElement, referenceNode: StubElement | null): StubElement {
      const index = referenceNode ? headElements.indexOf(referenceNode) : -1;
      if (index === -1) {
        headElements.push(node);
      } else {
        headElements.splice(index, 0, node);
      }
      return node;
    }
  };

  const doc = {
    head,
    createElement(tagName: string): StubElement {
      const element: StubElement = {
        tagName: tagName.toUpperCase(),
        dataset: {},
        onload: null,
        onerror: null,
        remove() {
          const index = headElements.indexOf(element);
          if (index !== -1) {
            headElements.splice(index, 1);
          }
        }
      };
      return element;
    },
    querySelectorAll(selector: string): StubElement[] {
      if (selector === 'link[rel="stylesheet"], style[data-vite-dev-id]') {
        return headElements.filter(element =>
          (element.tagName === 'LINK' && element.rel === 'stylesheet') ||
          (element.tagName === 'STYLE' && Boolean(element.dataset.viteDevId))
        );
      }
      return [];
    }
  };

  return { doc, headElements };
}

function createDevStyleNode(devId: string): StubElement {
  return {
    tagName: 'STYLE',
    dataset: { viteDevId: devId },
    onload: null,
    onerror: null,
    remove() {}
  };
}

function createProdLinkNode(href: string): StubElement {
  return {
    tagName: 'LINK',
    rel: 'stylesheet',
    href,
    dataset: {},
    onload: null,
    onerror: null,
    remove() {}
  };
}

describe('loadFeatureStyle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('inserts optional feature links before Vite dev style nodes in development', async () => {
    const devStyle = createDevStyleNode('/src/index.css');
    const { doc, headElements } = createStubDom([devStyle]);
    vi.stubGlobal('document', doc);

    const loadPromise = loadFeatureStyle('/src/components/DevFeature.css?direct', 'DevFeature.css');
    const featureLink = headElements.find(node => node.dataset.featureStyle === 'DevFeature.css');
    expect(featureLink).toBeDefined();
    featureLink?.onload?.();
    await loadPromise;

    expect(headElements[0]).toBe(featureLink);
    expect(headElements[1]).toBe(devStyle);
    expect(featureLink?.rel).toBe('stylesheet');
    expect(featureLink?.href).toBe('/src/components/DevFeature.css?direct');
  });

  it('inserts optional feature links before shell stylesheet links in production', async () => {
    const prodLink = createProdLinkNode('/assets/index.css');
    const { doc, headElements } = createStubDom([prodLink]);
    vi.stubGlobal('document', doc);

    const loadPromise = loadFeatureStyle('/assets/ProdFeature.css', 'ProdFeature.css');
    const featureLink = headElements.find(node => node.dataset.featureStyle === 'ProdFeature.css');
    expect(featureLink).toBeDefined();
    featureLink?.onload?.();
    await loadPromise;

    expect(headElements[0]).toBe(featureLink);
    expect(headElements[1]).toBe(prodLink);
    expect(featureLink?.rel).toBe('stylesheet');
    expect(featureLink?.href).toBe('/assets/ProdFeature.css');
  });

  it('maintains alphabetical data-feature-style order across navigation before shell styles', async () => {
    const shellStyle = createDevStyleNode('/src/index.css');
    const { doc, headElements } = createStubDom([shellStyle]);
    vi.stubGlobal('document', doc);

    const loadZeta = loadFeatureStyle('/src/components/ZetaNav.css?direct', 'ZetaNav.css');
    headElements.find(node => node.dataset.featureStyle === 'ZetaNav.css')?.onload?.();
    await loadZeta;

    const loadAlpha = loadFeatureStyle('/src/components/AlphaNav.css?direct', 'AlphaNav.css');
    headElements.find(node => node.dataset.featureStyle === 'AlphaNav.css')?.onload?.();
    await loadAlpha;

    const loadMiddle = loadFeatureStyle('/src/components/MiddleNav.css?direct', 'MiddleNav.css');
    headElements.find(node => node.dataset.featureStyle === 'MiddleNav.css')?.onload?.();
    await loadMiddle;

    const featureOrder = headElements
      .filter(node => Boolean(node.dataset.featureStyle))
      .map(node => node.dataset.featureStyle);

    expect(featureOrder).toEqual(['AlphaNav.css', 'MiddleNav.css', 'ZetaNav.css']);
    expect(headElements[headElements.length - 1]).toBe(shellStyle);
  });

  it('removes failed link on error, rejects, and allows clean retry on subsequent load', async () => {
    const shellStyle = createDevStyleNode('/src/index.css');
    const { doc, headElements } = createStubDom([shellStyle]);
    vi.stubGlobal('document', doc);

    const firstAttempt = loadFeatureStyle('/broken.css', 'RetryFeature.css');
    const brokenLink = headElements.find(node => node.dataset.featureStyle === 'RetryFeature.css');
    expect(brokenLink).toBeDefined();

    brokenLink?.onerror?.();
    await expect(firstAttempt).rejects.toThrow('This view could not load its styles. Reconnect and retry.');
    expect(headElements.find(node => node.dataset.featureStyle === 'RetryFeature.css')).toBeUndefined();

    const retryAttempt = loadFeatureStyle('/fixed.css', 'RetryFeature.css');
    const retryLink = headElements.find(node => node.dataset.featureStyle === 'RetryFeature.css');
    expect(retryLink).toBeDefined();
    expect(retryLink?.href).toBe('/fixed.css');

    retryLink?.onload?.();
    await expect(retryAttempt).resolves.toBeUndefined();

    expect(headElements[0]).toBe(retryLink);
    expect(headElements[1]).toBe(shellStyle);
  });

  it('reuses existing in-flight and completed load promises without duplicate link insertion', async () => {
    const shellStyle = createDevStyleNode('/src/index.css');
    const { doc, headElements } = createStubDom([shellStyle]);
    vi.stubGlobal('document', doc);

    const firstPromise = loadFeatureStyle('/cached.css', 'CachedFeature.css');
    const secondPromise = loadFeatureStyle('/cached.css', 'CachedFeature.css');
    expect(secondPromise).toBe(firstPromise);

    const matchingLinks = headElements.filter(node => node.dataset.featureStyle === 'CachedFeature.css');
    expect(matchingLinks).toHaveLength(1);

    matchingLinks[0]?.onload?.();
    await firstPromise;

    const thirdPromise = loadFeatureStyle('/cached.css', 'CachedFeature.css');
    expect(thirdPromise).toBe(firstPromise);
    expect(headElements.filter(node => node.dataset.featureStyle === 'CachedFeature.css')).toHaveLength(1);
  });
});
