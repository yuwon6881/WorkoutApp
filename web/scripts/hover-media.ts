import type { Container, Plugin, Rule } from 'postcss';

const HOVER_QUERY = '(hover: hover)';

/// A touch screen keeps `:hover` applied to whatever was last tapped, so a tab, card or button
/// stays lit after the finger lifts. Every `:hover` selector is therefore moved into a
/// `@media (hover: hover)` block placed straight after its rule, which keeps the cascade order
/// while phones and the Android WebView never match it. Selectors written inside a hover query
/// already are left alone, and a rule mixing hover and non-hover selectors is split in two.
export function hoverMedia(): Plugin {
  return {
    postcssPlugin: 'workout-hover-media',
    Rule(rule, { AtRule }) {
      if (!rule.selector.includes(':hover') || insideHoverQuery(rule) || insideKeyframes(rule)) return;
      const hovering = rule.selectors.filter(selector => selector.includes(':hover'));
      const others = rule.selectors.filter(selector => !selector.includes(':hover'));
      const query = new AtRule({ name: 'media', params: HOVER_QUERY });
      query.append(rule.clone({ selectors: hovering }));
      rule.after(query);
      if (others.length) rule.selectors = others;
      else rule.remove();
    }
  };
}
hoverMedia.postcss = true;

function insideHoverQuery(rule: Rule): boolean {
  for (let parent: Container | undefined = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && 'name' in parent && parent.name === 'media'
      && /hover:\s*hover/.test(String((parent as { params?: string }).params))) return true;
  }
  return false;
}

function insideKeyframes(rule: Rule): boolean {
  const parent = rule.parent;
  return Boolean(parent && parent.type === 'atrule' && 'name' in parent && String(parent.name).endsWith('keyframes'));
}
