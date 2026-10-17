// Development server endpoints for the mod maker (tools/characters/editor). They read and
// write pack folders under characters/ and run the pack build. Only `vite` (serve) loads them.
// The published site has no server, and the mod maker keeps packs in the browser instead (editor/store.ts).
import { transform } from 'esbuild';
import JSZip from 'jszip';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { CHARACTER_FILE, type CharacterPack } from '../../src/game/pack-format.ts';
import { SLUG, STARTER_GIMMICK_TS, unusedFiles } from './pack-files.ts';
import { validatePack } from './validate.ts';

const BODY_MAX = 64 * 1024 * 1024;
const DIR = /^(_templates\/|_examples\/)?[a-z0-9][a-z0-9-]*$/;
const TYPES: Record<string, string> = { '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.json': 'application/json', '.ts': 'text/plain', '.js': 'text/plain' };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function characterEditor(): Plugin {
  let root = process.cwd();
  const packs = () => path.join(root, 'characters');

  const dirOf = (dir: string | null, write: boolean): string => {
    if (!dir || !DIR.test(dir)) throw new HttpError(400, `bad character folder "${dir}"`);
    if (write && dir.startsWith('_')) throw new HttpError(403, 'the original characters and examples are read-only');
    return path.join(packs(), dir);
  };
  const fileOf = (dir: string, rel: string | null): string => {
    if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new HttpError(400, `bad file path "${rel}"`);
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(dir + path.sep)) throw new HttpError(400, `bad file path "${rel}"`);
    return abs;
  };
  const readPack = (dir: string): CharacterPack => {
    const file = path.join(dir, 'character.json');
    if (!fs.existsSync(file)) throw new HttpError(404, 'no such character');
    return JSON.parse(fs.readFileSync(file, 'utf8')) as CharacterPack;
  };
  const folders = (base: string) =>
    fs.existsSync(base)
      ? fs
          .readdirSync(base, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.') && fs.existsSync(path.join(base, d.name, 'character.json')))
          .map((d) => d.name)
          .sort()
      : [];
  const examples = () => folders(path.join(packs(), '_examples')).map((slug) => ({ slug, name: readPack(path.join(packs(), '_examples', slug)).name }));
  const originals = () => folders(path.join(packs(), '_templates')).map((slug) => ({ slug, name: readPack(path.join(packs(), '_templates', slug)).name }));
  const check = (pack: CharacterPack, dir: string) =>
    validatePack(
      pack,
      dir,
      originals().map((o) => o.name),
    );

  const body = (req: IncomingMessage): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > BODY_MAX) reject(new HttpError(413, 'upload too large'));
        else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  const build = (): Promise<{ ok: boolean; output: string }> =>
    new Promise((resolve) => {
      const tsx = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      const child = spawn(process.execPath, [tsx, 'tools/characters/build.ts'], { cwd: root });
      let output = '';
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
      child.on('close', (code) => resolve({ ok: code === 0, output }));
    });

  const unused = (dir: string, pack: CharacterPack): string[] => {
    const all: string[] = [];
    const walk = (rel: string) => {
      for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) walk(r);
        else all.push(r);
      }
    };
    walk('');
    return unusedFiles(pack, all);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://editor');
    const q = (k: string) => url.searchParams.get(k);
    const json = (v: unknown) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(v));
    };
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /list') {
      return json({
        packs: folders(packs()).map((slug) => {
          const p = readPack(path.join(packs(), slug));
          return { slug, name: p.name, template: p.template };
        }),
        templates: originals(),
        examples: examples(),
      });
    }
    if (route === 'GET /pack') {
      const dir = dirOf(q('dir'), false);
      const pack = readPack(dir);
      return json({ pack, problems: check(pack, dir), readOnly: q('dir')!.startsWith('_') });
    }
    if (route === 'PUT /pack') {
      const dir = dirOf(q('dir'), true);
      readPack(dir);
      const pack = JSON.parse((await body(req)).toString('utf8')) as CharacterPack;
      fs.writeFileSync(path.join(dir, 'character.json'), `${JSON.stringify(pack, null, 2)}\n`);
      return json({ problems: check(pack, dir) });
    }
    if (route === 'POST /new') {
      const { name, slug, from } = JSON.parse((await body(req)).toString('utf8')) as { name: string; slug: string; from: string };
      const src = dirOf(from, false);
      const dest = dirOf(slug, true);
      if (fs.existsSync(dest)) throw new HttpError(409, `characters/${slug} already exists`);
      const pack = readPack(src);
      fs.cpSync(src, dest, { recursive: true });
      pack.name = name;
      if (from.startsWith('_templates/')) {
        // Moves start the same as the original's, so only the ones a user customizes get copies.
        pack.moves = {};
        for (const d of ['moves', 'sounds']) fs.rmSync(path.join(dest, d), { recursive: true, force: true });
      }
      fs.writeFileSync(path.join(dest, 'character.json'), `${JSON.stringify(pack, null, 2)}\n`);
      return json({ slug });
    }
    if (route === 'GET /file') {
      const file = fileOf(dirOf(q('dir'), false), q('path'));
      if (!fs.existsSync(file)) throw new HttpError(404, `no file ${q('path')}`);
      res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      return res.end(fs.readFileSync(file));
    }
    if (route === 'GET /exists') {
      return json({ exists: fs.existsSync(fileOf(dirOf(q('dir'), false), q('path'))) });
    }
    if (route === 'PUT /file') {
      const file = fileOf(dirOf(q('dir'), true), q('path'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, await body(req));
      return json({ ok: true });
    }
    if (route === 'POST /gimmick') {
      const dir = dirOf(q('dir'), true);
      const file = path.join(dir, 'gimmick.ts');
      if (!fs.existsSync(file)) fs.writeFileSync(file, STARTER_GIMMICK_TS);
      return json({ file: 'gimmick.ts', path: path.relative(root, file).replace(/\\/g, '/') });
    }
    if (route === 'GET /unused' || route === 'POST /unused') {
      const dir = dirOf(q('dir'), req.method === 'POST');
      const files = unused(dir, readPack(dir));
      if (req.method === 'POST') for (const f of files) fs.rmSync(path.join(dir, f));
      return json({ files });
    }
    if (route === 'GET /export') {
      const dir = dirOf(q('dir'), false);
      const slug = path.basename(dir);
      const zip = new JSZip();
      const add = (rel: string) => {
        for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
          const r = rel ? `${rel}/${d.name}` : d.name;
          if (d.isDirectory()) add(r);
          else zip.file(`${slug}/${r}`, fs.readFileSync(path.join(dir, r)));
        }
      };
      add('');
      // The page that loads mods cannot compile TypeScript, so the zip carries the script as JavaScript too.
      const pack = readPack(dir);
      if (pack.gimmick && /\.ts$/i.test(pack.gimmick) && fs.existsSync(path.join(dir, pack.gimmick))) {
        const { code } = await transform(fs.readFileSync(path.join(dir, pack.gimmick), 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022' });
        zip.file(`${slug}/${pack.gimmick.replace(/\.ts$/i, '.js')}`, code);
      }
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${slug}${CHARACTER_FILE}"`);
      return res.end(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    }
    if (route === 'POST /import') {
      const zip = await JSZip.loadAsync(await body(req));
      const found = Object.keys(zip.files).find((n) => /(^|\/)character\.json$/.test(n) && n.split('/').length <= 2);
      if (!found) throw new HttpError(400, 'the character file has no character.json');
      const prefix = found.slice(0, found.length - 'character.json'.length);
      const slug = q('slug') || prefix.replace(/\/$/, '') || 'imported';
      if (!SLUG.test(slug)) throw new HttpError(400, `bad folder name "${slug}"`);
      const dest = dirOf(slug, true);
      if (fs.existsSync(dest)) throw new HttpError(409, `characters/${slug} already exists`);
      for (const [name, entry] of Object.entries(zip.files)) {
        if (entry.dir || !name.startsWith(prefix)) continue;
        const file = fileOf(dest, name.slice(prefix.length));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, await entry.async('nodebuffer'));
      }
      return json({ slug });
    }
    if (route === 'POST /build') return json(await build());
    throw new HttpError(404, `no endpoint ${route}`);
  };

  return {
    name: 'character-editor',
    apply: 'serve',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use('/__characters', (req, res) => {
        handle(req, res).catch((e: unknown) => {
          res.statusCode = e instanceof HttpError ? e.status : 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        });
      });
    },
  };
}
