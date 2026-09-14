/**
 * Screenshots of the tool, taken by the installed Chrome driven headless, on the fixture path.
 *
 *   npm run shots                         every tab, into app/shots/
 *   npm run shots -- artistes grille      only those steps
 *   APP_URL=http://localhost:5173/ npm run shots
 *
 * WHY THIS EXISTS. The screens are asserted by `screens.test.tsx` through static markup, which
 * says what is on the page and nothing about how it looks: a textarea 260 px wide, a summary
 * that does not line up, a fold that swallows its content are all invisible to it. This drives
 * the real browser through the real app and leaves PNGs a person (or Claude) can look at, in
 * both colour schemes. Nothing here is a test: it takes pictures, it asserts nothing.
 *
 * WHICH PLAN. The `balanced+phases` fixture (`npm run fixture -- --all` in tools/ writes it):
 * the balanced scenario with the montage, the démontage, the catering, twenty orgas and a full
 * artist's fiche switched on, so every screen has something to show. See `withPhases` in
 * tools/src/plan-fixtures.ts.
 *
 * HOW IT RUNS. It starts its own Vite dev server with the Supabase variables emptied, so the
 * app opens on the generated fixtures rather than on the real base and needs no login; it
 * closes it when done. `puppeteer-core` drives the Chrome already on the machine (see CHROME
 * below), so nothing is downloaded. Steps click through the tabs the way a régisseur would.
 */

const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const PORT = 5181;
const URL = process.env.APP_URL || `http://localhost:${PORT}/`;
const OUT = path.join(__dirname, '..', 'shots');
const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : '/usr/bin/google-chrome');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The dev server, unless APP_URL points at one already running. */
async function startServer() {
  if (process.env.APP_URL) return null;
  const child = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(PORT), '--strictPort'],
    {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
      stdio: 'ignore',
      shell: process.platform === 'win32',
    },
  );
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const res = await fetch(URL);
      if (res.ok) return child;
    } catch {
      // not up yet
    }
  }
  child.kill();
  throw new Error(`le serveur de développement ne répond pas sur ${URL}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const steps = process.argv.slice(2);
  const want = (s) => steps.length === 0 || steps.includes(s);
  const server = await startServer();

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-first-run', '--disable-gpu'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  const problems = [];

  try {
    for (const scheme of ['dark', 'light']) {
      // A context of its own per scheme: the fixture store saves to localStorage, and the
      // clicks of the first pass must not be the starting point of the second.
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      page.on('console', (m) => {
        if (['error', 'warning'].includes(m.type()) && !/404/.test(m.text())) {
          problems.push(`${scheme} console ${m.type()}: ${m.text()}`);
        }
      });
      page.on('pageerror', (e) => problems.push(`${scheme} pageerror: ${e.message}`));
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      await page.goto(URL, { waitUntil: 'networkidle0' });

      const shot = async (name) => page.screenshot({ path: `${OUT}/${scheme}-${name}.png` });
      const tall = async (name) => {
        await page.setViewport({ width: 1600, height: 2600 });
        await sleep(300);
        await shot(name);
        await page.setViewport({ width: 1600, height: 1000 });
      };
      const clickButton = async (pattern) => {
        const handle = await page.evaluateHandle(
          (source) => {
            const re = new RegExp(source);
            return [...document.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim())) || null;
          },
          pattern.source,
        );
        const el = handle.asElement();
        if (!el) throw new Error(`bouton introuvable: ${pattern}`);
        await el.click();
        await sleep(400);
      };
      const tab = (label) => clickButton(new RegExp(`^${label}`));

      await shot('00-picker');
      await clickButton(/^Équilibré [(]montage/);
      await sleep(1200);
      await shot('01-grille');

      if (want('montage')) {
        await clickButton(/^Montage$/);
        await sleep(800);
        await shot('30-montage');
        // The first orga's box: click selects and fills the info pane.
        await page.evaluate(() => document.querySelector('.phase-bar')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await sleep(400);
        await shot('31-montage-selection');
        await clickButton(/^Démontage$/);
        await sleep(800);
        await shot('35-demontage');
        await clickButton(/^Exploit$/);
        await sleep(500);
      }

      if (want('artistes')) {
        await tab('Artistes');
        await shot('10-artistes-folded');
        await page.evaluate(() => document.querySelector('.artist-toggle')?.click());
        await sleep(300);
        await clickButton(/^Ajouter une personne$/);
        await clickButton(/^Ajouter une personne$/);
        await clickButton(/^Ajouter un trajet$/);
        // Tick the balances on if they are off; never off, the fixture draws them on the montage.
        const soundcheck = await page.$('input[name^="artist-sc-"]:not(:checked)');
        if (soundcheck) await soundcheck.click();
        await sleep(300);
        await tall('11-artistes-fiche');
      }
      if (want('grille')) {
        await tab('Grille');
        await page.select('select[aria-label="Filtrer par pôle demandé"]', await page.evaluate(() => document.querySelector('select[aria-label="Filtrer par pôle demandé"]').options[2].value));
        await sleep(400);
        await shot('20-grille-pole-filter');
      }
      if (want('tableau')) {
        await tab('Tableau de bord');
        await tall('40-tableau');
      }
      if (want('import')) {
        await tab('Import/Export');
        await shot('50-import');
      }
      if (want('historique')) {
        await tab('Historique');
        await page.evaluate(() => [...document.querySelectorAll('.stack-head button')].forEach((b) => b.click()));
        await sleep(600);
        await shot('60-historique-open');
      }
      if (want('reglages')) {
        await tab('Réglages');
        await shot('70-reglages');
      }
      if (want('evenement')) {
        await tab('Réglages');
        await clickButton(/^▸L'événement/);
        await tall('74-reglages-evenement');
      }
      if (want('correspondance')) {
        await tab('Import/Export');
        const input = await page.$('input[type="file"][accept=".csv,text/csv"]');
        await input.uploadFile(path.join(__dirname, '..', '..', 'tools', 'out', 'formulaire-test.csv'));
        await sleep(1500);
        await clickButton(/^▸Correspondance du formulaire/);
        await tall('52-import-correspondance');
      }
      if (want('avances')) {
        await tab('Réglages');
        await clickButton(/^▸Réglages avancés/);
        // Two changes, so the green of a by-hand mode and a by-hand weight are both on the shot.
        // One click per tick: two edits dispatched in the same tick would build on the same plan.
        const pick = (label, mode) => page.evaluate((label, mode) => {
          const row = [...document.querySelectorAll('.advanced-row')].find((r) => r.querySelector('.rule-label')?.textContent === label);
          [...(row?.querySelectorAll('.mode-choice') ?? [])].find((b) => b.textContent === mode)?.click();
        }, label, mode);
        await pick('Sur un pôle refusé', 'Poids');
        await sleep(300);
        await pick('Trop de blocs de travail', 'Ignoré');
        await sleep(400);
        await page.evaluate(() => document.querySelector('.setup-advanced')?.scrollIntoView());
        await sleep(300);
        await shot('71-reglages-avances');
        await page.evaluate(() => document.querySelector('.setup-advanced')?.scrollIntoView());
        await tall('72-reglages-avances-tall');
      }
      if (want('billetterie')) {
        await tab('Billetterie');
        await shot('85-billetterie');
        await page.type('input[name="ticketing-search"]', 'mar');
        await sleep(400);
        await shot('86-billetterie-search');
      }
      if (want('catering')) {
        await tab('Catering');
        await shot('80-catering');
        await page.evaluate(() => document.querySelector('.screen-body')?.scrollTo(0, 99999));
        await sleep(300);
        await shot('81-catering-bottom');
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server?.kill();
  }

  console.log(problems.length ? problems.join('\n') : 'console propre');
  console.log(`captures dans ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
