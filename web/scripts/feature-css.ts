import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { transformWithEsbuild, type Plugin } from 'vite';

// These styles participate in the first screen. Optional feature links are inserted before
// the shell stylesheet, preserving the existing feature-before-index/layout cascade.
const critical = new Set(['BottomNav.css', 'Dashboard.css', 'History.css', 'ProgressPanels.css',
  'TrainingCalendar.css', 'TrainingCalendarLayout.css']);

export function featureCss(): Plugin {
  let production = false;
  const prefix = '\0workout-feature-css:';
  return {
    name: 'workout-ordered-feature-css',
    enforce: 'pre',
    configResolved(config) { production = config.command === 'build'; },
    resolveId(source, importer) {
      if (!importer || !source.endsWith('.css')) return;
      const path = resolve(importer.split('?')[0], '..', source).replaceAll('\\', '/');
      if (!path.includes('/src/components/') || path.includes('/ui/') || critical.has(basename(path))) return;
      return prefix + path + '.js';
    },
    async load(id) {
      if (!id.startsWith(prefix)) return;
      const path = id.slice(prefix.length, -3);
      const name = basename(path);
      let url: string;
      if (production) {
        const css = await transformWithEsbuild(readFileSync(path, 'utf8'), path, { loader: 'css', minify: true });
        const reference = this.emitFile({ type: 'asset', name, source: css.code });
        url = `import.meta.ROLLUP_FILE_URL_${reference}`;
      } else url = JSON.stringify(`/src/components/${name}?direct`);
      return `import { loadFeatureStyle } from '/src/lib/featureStyles.ts'; await loadFeatureStyle(${url}, ${JSON.stringify(name)});`;
    }
  };
}
