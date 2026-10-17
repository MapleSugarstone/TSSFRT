// Publishes the original characters (characters/_templates) and the examples (characters/_examples)
// for the mod maker's browser store, with an index of their files. A file identical to one of the
// game's own assets points at that asset instead of being published twice.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import * as nodeModule from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { CharacterPack } from '../../src/game/pack-format.ts';
import { INDEX_FILE, type SiteCharacter, type SiteIndex } from './pack-files.ts';

interface SiteFiles {
  index: SiteIndex;
  /** Published path to contents, for files that are not game assets. */
  files: Map<string, Buffer | string>;
}

type Strip = (code: string, options: { mode: 'strip' }) => string;

/** A TypeScript gimmick script as JavaScript. Node's type stripping keeps the layout and comments. */
async function toJavaScript(code: string): Promise<string> {
  const strip = (nodeModule as unknown as { stripTypeScriptTypes?: Strip }).stripTypeScriptTypes;
  if (strip) {
    const warn = process.emitWarning;
    // It warns on every build that the function is experimental.
    process.emitWarning = () => {};
    try {
      return strip(code, { mode: 'strip' })
        .replace(/[ \t]+;?$/gm, (m) => m.trim())
        .replace(/^\s+/, '');
    } catch {
      // Syntax that stripping cannot remove falls through to the compiler.
    } finally {
      process.emitWarning = warn;
    }
  }
  const { default: ts } = await import('typescript');
  return ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
}

async function gather(root: string): Promise<SiteFiles> {
  const files = new Map<string, Buffer | string>();
  const assets = path.join(root, 'public', 'assets');
  const group = async (kind: '_templates' | '_examples'): Promise<SiteCharacter[]> => {
    const base = path.join(root, 'characters', kind);
    if (!fs.existsSync(base)) return [];
    const slugs = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && fs.existsSync(path.join(base, d.name, 'character.json')))
      .map((d) => d.name)
      .sort();
    const out: SiteCharacter[] = [];
    for (const slug of slugs) {
      const dir = path.join(base, slug);
      const pack = JSON.parse(fs.readFileSync(path.join(dir, 'character.json'), 'utf8')) as CharacterPack;
      const urls: Record<string, string> = {};
      const publish = (rel: string, data: Buffer | string) => {
        // Some static hosts hide folders whose names start with an underscore.
        const to = `characters/${kind.slice(1)}/${slug}/${rel}`;
        files.set(to, data);
        urls[rel] = to;
      };
      const walk = (rel: string) => {
        for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
          const r = rel ? `${rel}/${d.name}` : d.name;
          if (d.isDirectory()) walk(r);
          else if (r !== 'character.json' && !/\.(ts|md)$/i.test(r)) {
            const data = fs.readFileSync(path.join(dir, r));
            const name = `${createHash('md5').update(data).digest('hex')}${path.extname(r).toLowerCase()}`;
            const asset = ['costumes', 'sounds'].map((a) => `${a}/${name}`).find((a) => fs.existsSync(path.join(assets, a)));
            if (asset) urls[r] = `assets/${asset}`;
            else publish(r, data);
          }
        }
      };
      walk('');
      if (pack.gimmick && /\.ts$/i.test(pack.gimmick) && fs.existsSync(path.join(dir, pack.gimmick))) {
        const js = pack.gimmick.replace(/\.ts$/i, '.js');
        publish(js, await toJavaScript(fs.readFileSync(path.join(dir, pack.gimmick), 'utf8')));
        pack.gimmick = js;
      }
      out.push({ slug, name: pack.name, pack, files: urls });
    }
    return out;
  };
  return { index: { templates: await group('_templates'), examples: await group('_examples') }, files };
}

export function siteCharacters(): Plugin {
  let root = process.cwd();
  let last: Promise<SiteFiles> | null = null;
  return {
    name: 'site-characters',
    configResolved(config) {
      root = config.root;
    },
    // The development server serves the same files, for the mod maker's browser store under ?browser.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]).replace(/^\//, '');
        if (url !== INDEX_FILE && !/^characters\/(templates|examples)\//.test(url)) return next();
        void (async () => {
          if (url === INDEX_FILE || !last) last = gather(root);
          const site = await last;
          const data = url === INDEX_FILE ? JSON.stringify(site.index) : site.files.get(url);
          if (data === undefined) return next();
          res.setHeader('Cache-Control', 'no-store');
          if (url.endsWith('.json')) res.setHeader('Content-Type', 'application/json');
          else if (url.endsWith('.js')) res.setHeader('Content-Type', 'text/javascript');
          res.end(data);
        })().catch(next);
      });
    },
    async generateBundle() {
      const site = await gather(root);
      for (const [fileName, source] of site.files) this.emitFile({ type: 'asset', fileName, source });
      this.emitFile({ type: 'asset', fileName: INDEX_FILE, source: JSON.stringify(site.index) });
    },
  };
}
