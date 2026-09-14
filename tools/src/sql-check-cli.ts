/**
 * Parsing db/*.sql against the real Postgres 17 grammar, with no database anywhere.
 *
 * There is no Postgres, no Docker and no WSL on the machine this is built on, so the first paste
 * into the Supabase SQL editor used to be the first time anything checked the syntax. This runs
 * the actual Postgres parser, shipped as wasm, over every statement in the schema and the
 * migrations.
 *
 *   npm run sql-check                    every file under db/
 *   npm run sql-check -- ../db/schema.sql   just this one
 *
 * WHAT IT CATCHES: syntax, against the grammar the server will use.
 *
 * WHAT IT CANNOT CATCH, and this is where a first run against the database still fails if it
 * fails: column names, types and coercions. The parser knows the grammar, not the catalogue, so
 * a mistyped column or a numeric that will not cast is invisible to it. Nor does it know about
 * grants: a grant is not verified until the anonymous key has been pointed at it, which is
 * db/checks/anon_reachability.md.
 *
 * WHY IT LOOKS LIKE THIS. A dollar-quoted function body is a string literal to the outer parse,
 * so parsing the file top to bottom checks everything except the inside of the nine functions,
 * which is most of what there is to get wrong. The bodies are therefore split into their own
 * statements and parsed one by one, with the plpgsql-only spellings rewritten into something the
 * plain SQL grammar accepts. Control flow, declarations and `execute format(...)` are skipped
 * rather than mangled: they are reported in the count so the number is honest about its coverage.
 *
 * This script was written from scratch twice in the scratchpad, on 2026-09-08, before somebody
 * noticed it was being thrown away each time. Three traps cost most of that, and all three are
 * still live: the parser's `parse` is async; slicing the whole file per character to report a
 * line number makes the splitter quadratic on a 40 KB schema, which looks exactly like a wasm
 * deadlock; and a `declare` block splits on its own semicolons, so each declared variable
 * arrives as its own fragment and buries the real output unless it is filtered out.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

// CommonJS on purpose: the ESM build of @pgsql/parser has a broken directory import on Node 22.
const require = createRequire(import.meta.url);
const v17 = require('@pgsql/parser/v17') as {
  parse(sql: string): Promise<unknown>;
};

/** --verbose lists every statement actually checked, which is how the skip count is audited. */
const VERBOSE = process.argv.includes('--verbose');

interface ParseFailure {
  where: string;
  line: number;
  message: string;
  excerpt: string;
}

/** A statement pulled out of a function body, with its offset in the file for the line number. */
interface Fragment {
  text: string;
  offset: number;
}

/**
 * Line numbers, without slicing the file once per character.
 *
 * The obvious `sql.slice(0, i).split('\n').length` is O(n) per call and gets called once per
 * statement, which on a 40 KB schema stops looking like slowness and starts looking like a hang.
 */
function lineIndex(sql: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < sql.length; i++) if (sql[i] === '\n') starts.push(i + 1);
  return (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

/** Every `$fn$ ... $fn$` and `$policies$ ... $policies$` body, with what declared it. */
function bodiesOf(sql: string): Array<{ name: string; plpgsql: boolean } & Fragment> {
  const bodies: Array<{ name: string; plpgsql: boolean } & Fragment> = [];
  const re = /\$(fn|policies|rename)\$([\s\S]*?)\$\1\$/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    const head = sql.slice(Math.max(0, match.index - 900), match.index);
    const declared = /function\s+([a-z_.]+)\s*\(/g;
    const names = [...head.matchAll(declared)];
    const named = names[names.length - 1];
    bodies.push({
      name: named ? named[1]! : 'do-block',
      // A do-block is always plpgsql; a function says so, and the ones that do not are `language
      // sql` and parse whole.
      plpgsql: !named || /language\s+plpgsql/.test(head.slice(head.lastIndexOf('function'))),
      text: match[2]!,
      offset: match.index + match[0].indexOf(match[2]!),
    });
  }
  return bodies;
}

/**
 * Splitting a body on the semicolons that end a statement.
 *
 * Parentheses, single-quoted strings and line comments all hold semicolons that end nothing.
 */
function split(body: string): Fragment[] {
  const out: Fragment[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '-' && body[i + 1] === '-') {
      const nl = body.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (c === "'") {
      i++;
      while (i < body.length) {
        if (body[i] === "'" && body[i + 1] === "'") i += 2;
        else if (body[i] === "'") break;
        else i++;
      }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) {
      out.push({ text: body.slice(start, i), offset: start });
      start = i + 1;
    }
  }
  if (body.slice(start).trim() !== '') out.push({ text: body.slice(start), offset: start });
  return out;
}

/** What the plain SQL grammar can be asked about, or null for a line it cannot judge. */
function asPlainSql(statement: string): string | null {
  let text = statement.replace(/^\s*(?:--[^\n]*\n\s*)*/, '').replace(/^\s*begin\b/i, '');
  text = text.replace(/^\s*(?:--[^\n]*\n\s*)*/, '').trim();

  // An assignment or a declaration. `keep_max constant int := 50` is not a statement.
  if (text.includes(':=')) return null;

  if (/^perform\b/i.test(text)) text = text.replace(/^perform\b/i, 'select');
  else if (/^return\b/i.test(text)) text = text.replace(/^return\b/i, 'select');

  // `select a, b into x, y from t` and `update ... returning a into x`.
  text = text.replace(/\binto\s+[a-z_]\w*(\s*,\s*[a-z_]\w*)*\s+from\b/i, ' from ');
  text = text.replace(
    /\breturning\s+([^;]*?)\s+into\s+[a-z_]\w*(\s*,\s*[a-z_]\w*)*\s*$/i,
    ' returning $1',
  );

  // Control flow, declarations, `execute format(...)`, and a bare `return`. Anything that is not
  // a statement the grammar knows on its own is skipped rather than mangled into a false alarm.
  if (!/^(insert|update|delete|select|with|create|alter|drop|grant|revoke)\b/i.test(text)) {
    return null;
  }
  return text;
}

async function parseOne(
  sql: string,
  where: string,
  offset: number,
  lineAt: (offset: number) => number,
  failures: ParseFailure[],
): Promise<void> {
  try {
    await v17.parse(sql.trimEnd().replace(/;+$/, '') + ';');
  } catch (cause) {
    const error = cause as { message?: string; cursorPosition?: number };
    const position = Math.max(0, (error.cursorPosition ?? 1) - 1);
    failures.push({
      where,
      line: lineAt(offset + position),
      message: error.message ?? String(cause),
      excerpt: sql
        .slice(Math.max(0, position - 120), position + 120)
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }
}

async function checkFile(path: string): Promise<{ checked: number; skipped: number; failures: ParseFailure[] }> {
  const sql = readFileSync(path, 'utf8');
  const lineAt = lineIndex(sql);
  const failures: ParseFailure[] = [];
  let checked = 0;
  let skipped = 0;

  // The whole file first. Function bodies are string literals to this pass, so what it proves is
  // everything between them: the tables, the indexes, the policies, the grants.
  checked++;
  await parseOne(sql, 'fichier entier', 0, lineAt, failures);

  for (const body of bodiesOf(sql)) {
    const fragments = body.plpgsql
      ? split(body.text)
      : [{ text: body.text, offset: 0 } satisfies Fragment];
    for (const fragment of fragments) {
      const plain = body.plpgsql ? asPlainSql(fragment.text) : fragment.text;
      if (plain === null || plain.trim() === '') {
        skipped++;
        continue;
      }
      checked++;
      if (VERBOSE) console.log(`     · [${body.name}] ${plain.replace(/\s+/g, ' ').slice(0, 90)}`);
      await parseOne(plain, body.name, body.offset + fragment.offset, lineAt, failures);
    }
  }

  return { checked, skipped, failures };
}

async function main(): Promise<void> {
  const here = new URL('..', import.meta.url).pathname;
  const db = join(here.startsWith('/') && here[2] === ':' ? here.slice(1) : here, '..', 'db');
  const given = process.argv.slice(2);
  const files =
    given.length > 0
      ? given.filter((arg) => arg !== '--verbose')
      : [
          join(db, 'schema.sql'),
          ...readdirSync(join(db, 'migrations'))
            .filter((name) => name.endsWith('.sql'))
            .sort()
            .map((name) => join(db, 'migrations', name)),
        ];

  let total = 0;
  let bad = 0;
  for (const file of files) {
    const { checked, skipped, failures } = await checkFile(file);
    total += checked;
    bad += failures.length;
    const label = relative(process.cwd(), file).replace(/\\/g, '/');
    console.log(
      `${failures.length === 0 ? 'OK  ' : 'FAIL'} ${label}: ${checked} instructions analysées, ${skipped} ignorées`,
    );
    for (const failure of failures) {
      console.log(`     ${failure.where}, ligne ${failure.line}: ${failure.message}`);
      console.log(`       ...${failure.excerpt}...`);
    }
  }

  console.log(`\n${total} instructions, ${bad} en échec`);
  if (bad > 0) process.exitCode = 1;
}

void main();
