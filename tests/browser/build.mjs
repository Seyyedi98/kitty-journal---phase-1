// Bundles the REAL App.js (and everything it imports) for a browser, replacing
// only the native modules with the stand-ins in ./stubs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const esbuild = createRequire('/opt/npm-tools/package.json')('esbuild');
const stub = (f) => path.join(here, 'stubs', f);

const exact = {
  'react-native': stub('rn.jsx'),
  'expo-sqlite': stub('sqlite.jsx'),
  'expo-file-system': stub('expo-fs.js'),
  'expo-file-system/legacy': stub('expo-fs.js'),
  'expo-image-manipulator': stub('expo-image-manipulator.js'),
  'expo-image-picker': stub('expo-image-picker.js'),
  'expo-location': stub('expo-location.js'),
  'react-native-webview': stub('webview.jsx'),
  'expo-sharing': stub('expo-sharing.js'),
};
const virtual = {
  'lucide-react-native': `import { iconProxy } from ${JSON.stringify(stub('misc.jsx'))}; module.exports = iconProxy;`,
  'react-native-reanimated': `import { reanimated } from ${JSON.stringify(stub('misc.jsx'))}; module.exports = reanimated;`,
  'react-native-safe-area-context': `import { safeArea } from ${JSON.stringify(stub('misc2.jsx'))}; module.exports = safeArea;`,
  'expo-status-bar': `import { statusBar } from ${JSON.stringify(stub('misc2.jsx'))}; module.exports = statusBar;`,
  'expo-font': `import { font } from ${JSON.stringify(stub('misc2.jsx'))}; module.exports = font;`,
  '@expo-google-fonts/dm-sans': `import { fontPack } from ${JSON.stringify(stub('misc2.jsx'))}; module.exports = fontPack;`,
  '@expo-google-fonts/vazirmatn': `import { fontPack } from ${JSON.stringify(stub('misc2.jsx'))}; module.exports = fontPack;`,
};

const plugin = {
  name: 'rn-stubs',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (exact[args.path]) return { path: exact[args.path] };
      if (virtual[args.path]) return { path: args.path, namespace: 'virtual' };
      if (/components\/CatIllustration$/.test(args.path)) return { path: 'cat', namespace: 'cat' };
      return null;
    });
    build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => ({ contents: virtual[args.path], loader: 'jsx', resolveDir: here }));
    build.onLoad({ filter: /.*/, namespace: 'cat' }, () => ({ contents: `export { default } from ${JSON.stringify(stub('misc2.jsx'))};`, loader: 'js', resolveDir: here }));
  },
};

export async function bundle(outfile) {
  await esbuild.build({
    entryPoints: [path.join(here, 'entry.jsx')],
    bundle: true,
    outfile,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    nodePaths: ['/home/claude/.npm-global/lib/node_modules', '/opt/npm-tools/node_modules'],
    define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true' },
    plugins: [plugin],
    logLevel: 'error',
    absWorkingDir: root,
  });
}
