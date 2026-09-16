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
      // Since 2026-09-16 the screens sit in groups: open the group, then its sub-tab when it has some.
      const GROUP_OF = {
        Grille: 'Planning', Propositions: 'Planning', Personnes: 'Personnes',
        Artistes: 'Logistique', Catering: 'Logistique', Magasin: 'Logistique', 'Équipes': 'Logistique', 'Activités annexes': 'Logistique',
        'Tableau de bord': 'Suivi', Historique: 'Suivi', 'Réglages': 'Réglages', 'Import/Export': 'Réglages',
      };
      const tab = async (label) => {
        const group = GROUP_OF[label];
        if (!group) return clickButton(new RegExp(`^${label}`));
        await page.evaluate((name) => {
          [...document.querySelectorAll('.topbar .tabs .tab')].find((b) => (b.textContent || '').trim().startsWith(name))?.click();
        }, group);
        await sleep(300);
        await page.evaluate((name) => {
          [...document.querySelectorAll('.subtabs .tab')].find((b) => (b.textContent || '').trim().startsWith(name))?.click();
        }, label);
        await sleep(400);
      };

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
        // The info pane folded, then unfolded again so the later shots keep it open.
        await page.evaluate(() => document.querySelector('[aria-label="Replier le volet Info sélection"]')?.click());
        await sleep(400);
        await shot('21-grille-info-repliee');
        await page.evaluate(() => document.querySelector('.panel-unfold')?.click());
        await sleep(300);
      }
      if (want('edition')) {
        // Mode édition (2026-09-16): in, a place added, an edge pulled, a créneau created in the
        // void, Échap out; then the same on the montage, and leaving by changing tab. Each check
        // is printed, since this script asserts nothing.
        await tab('Grille');
        const state = () =>
          page.evaluate(() => ({
            editing: !!document.querySelector('.grid-scroll.is-editing'),
            button: document.querySelector('.btn-emoji.is-framed')?.textContent,
            corner: document.querySelector('.grid-corner-text')?.textContent,
          }));
        const laneTitles = () =>
          page.evaluate(() => [...document.querySelectorAll('.lane-track')[0].querySelectorAll('.shift')].slice(0, 2).map((el) => el.title.split('\n').slice(1, 3).join(' | ')));
        await page.click('.btn-emoji.is-framed');
        await sleep(400);
        console.log('edition entrée', JSON.stringify(await state()));
        await shot('23-grille-edition');

        const before = await laneTitles();
        await page.evaluate(() => document.querySelector('.lane-track .box.is-add')?.click());
        await sleep(300);
        console.log('edition plus', JSON.stringify(before[0]), '->', JSON.stringify((await laneTitles())[0]));

        // « − » on the same créneau, which is full: the last person leaves with the place.
        // Twice: the first takes the empty place the « + » made, the second the last person.
        await page.evaluate(() => document.querySelector('.lane-track .box.is-remove')?.click());
        await sleep(300);
        await page.evaluate(() => document.querySelector('.lane-track .box.is-remove')?.click());
        await sleep(300);
        console.log('edition moins', JSON.stringify((await laneTitles())[0]),
          await page.evaluate(() => document.querySelector('.toolbar-note')?.textContent));
        await shot('23b-grille-edition-moins');
        await page.click('button[title^="Annuler"]');
        await sleep(300);
        await page.click('button[title^="Annuler"]');
        await sleep(300);

        const grip = await page.$('.lane-track .shift .shift-grip.is-end');
        const gb = await grip.boundingBox();
        await page.mouse.move(gb.x + 3, gb.y + gb.height / 2);
        await page.mouse.down();
        await page.mouse.move(gb.x + 45, gb.y + gb.height / 2, { steps: 6 });
        await sleep(250);
        await shot('24-grille-edition-etirer');
        await page.mouse.up();
        await sleep(400);
        console.log('edition étirer', JSON.stringify(before), '->', JSON.stringify(await laneTitles()));

        // Walk the lanes until an empty stretch offers a créneau.
        let ghost = false;
        const tracks = await page.$$('.lane-track');
        for (const track of tracks) {
          const tb = await track.boundingBox();
          if (!tb || tb.y < 0 || tb.y > 950) continue;
          for (let x = tb.x + 5; x < Math.min(tb.x + tb.width, 1000) && !ghost; x += 12) {
            await page.mouse.move(x, tb.y + 10);
            ghost = !!(await page.$('.shift-ghost'));
          }
          if (ghost) break;
        }
        if (ghost) {
          await sleep(200);
          await shot('25-grille-edition-fantome');
          const count = (await state()).corner;
          await page.click('.shift-ghost');
          await sleep(400);
          console.log('edition créer', count, '->', (await state()).corner);
        } else {
          console.log('edition créer: aucun vide trouvé à l’écran');
        }
        await page.keyboard.press('Escape');
        await sleep(300);
        console.log('edition échap', JSON.stringify(await state()));

        // Leaving by changing tab.
        await page.click('.btn-emoji.is-framed');
        await sleep(200);
        await tab('Personnes');
        await tab('Grille');
        console.log('edition onglet', JSON.stringify(await state()));

        // The montage: événements.
        await clickButton(/^Montage$/);
        await sleep(800);
        await page.click('.btn-emoji.is-framed');
        await sleep(400);
        await shot('26-montage-edition');
        const events = await page.$('.lane.is-events .lane-track');
        const eb = await events.boundingBox();
        let eventGhost = false;
        for (let x = eb.x + 5; x < Math.min(eb.x + eb.width, 1000) && !eventGhost; x += 10) {
          await page.mouse.move(x, eb.y + 10);
          eventGhost = !!(await page.$('.shift-ghost'));
        }
        if (eventGhost) {
          await shot('27-montage-edition-fantome');
          const n = await page.$$eval('.phase-event-block', (els) => els.length);
          await page.click('.shift-ghost');
          await sleep(500);
          console.log('edition événement', n, '->', await page.$$eval('.phase-event-block', (els) => els.length),
            await page.evaluate(() => document.querySelector('input[name^="evenement-label-"]')?.value));
          await shot('28-montage-edition-cree');
        } else {
          console.log('edition événement: aucun vide trouvé à l’écran');
        }
        await page.keyboard.press('Escape');
        await sleep(300);
        console.log('edition montage échap', JSON.stringify(await state()));
        await clickButton(/^Exploit$/);
        await sleep(500);
      }
      if (want('durees')) {
        // The event's default length of a créneau, a pole set by hand in green, and the grid's
        // ghost following the pole's value.
        await tab('Réglages');
        await page.evaluate(() => document.querySelector('.setup-event .setup-group-toggle')?.click());
        await sleep(300);
        const field = await page.$('input[name="event-default-shift-hours"]');
        await field.click({ clickCount: 3 });
        await field.type('3');
        await sleep(300);
        await page.evaluate(() => document.querySelector('input[name="event-default-shift-hours"]')?.scrollIntoView({ block: 'center' }));
        await shot('60-reglages-duree-evenement');
        // Open the first pole group and set its length by hand.
        await page.evaluate(() => document.querySelector('button[aria-label^="Déplier le pôle"]')?.click());
        await sleep(400);
        await page.evaluate(() => document.querySelector('.setup-pole-head')?.click());
        await sleep(400);
        const poleInputs = 'input[type="number"][step="0.25"]:not([name="event-default-shift-hours"])';
        const values = await page.$$eval(poleInputs, (els) => els.filter((el) => el.offsetParent).map((el) => el.value + (el.className ? ' ' + el.className : '')));
        console.log('durees pôles suivent', JSON.stringify(values.slice(0, 4)));
        const poleField = (await page.$$(poleInputs)).find(Boolean);
        if (poleField) {
          await poleField.click({ clickCount: 3 });
          await poleField.type('4');
          await sleep(300);
          await page.evaluate(() => document.querySelector('input.is-manual')?.scrollIntoView({ block: 'center' }));
          await shot('61-reglages-duree-pole-main');
          console.log('durees pôle main', await page.$$eval(poleInputs, (els) => els.filter((el) => el.offsetParent).slice(0, 3).map((el) => el.value + ' ' + el.className).join(' | ')));
        }
      }
      if (want('tableau')) {
        await tab('Tableau de bord');
        await tall('40-tableau');
      }
      if (want('import')) {
        await tab('Import/Export');
        await shot('50-import');
      }
      if (want('preparer')) {
        // A festival-shaped export, invented answers, loaded as a file: the setup the form proposes.
        await tab('Import/Export');
        const q = (v) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
        const rows = [
          ['Horodateur', 'Adresse e-mail', 'Nom', 'Prénom', 'Peux-tu faire des shifts de nuit ? (entre 3h et 7h)', 'Quels jours es-tu dispo sur le montage ?', 'Est-ce que tu serais dispo pour le pré-montage aussi ?', 'A quelle heure peux-tu arriver vendredi 18 Septembre ?', 'A quelle heure dois-tu repartir dimanche 20 Septembre ?', "Où es-tu le plus à l'aise ? Ton premier choix.", "Où es-tu le plus à l'aise ? Ton deuxième choix."],
          ['01/06/2026 10:00:00', 'a@exemple.org', 'Alpha', 'Ana', 'Oui', 'Mardi 15 septembre (montage)', 'Oui', 'Avant 14h', 'Après 18h', 'Bar', 'Maraude (Réduction des risques)'],
          ['02/06/2026 10:00:00', 'b@exemple.org', 'Beta', 'Ben', 'Non je ne peux pas', 'Mercredi 16 septembre (montage)', 'Non', 'Entre 16h et 18h', 'Entre 14h et 16h', 'Maraude', 'Brigade verte (nettoyage site, toilettes sèches)'],
          ['03/06/2026 10:00:00', 'c@exemple.org', 'Gamma', 'Cléo', 'Oui mais je préfère ne pas', '', 'Oui', 'Avant 14h', 'Après 18h', 'Bar', 'Brigade verte (nettoyage site, toilettes sèches)'],
        ];
        const file = path.join(require('node:os').tmpdir(), 'aya-regie-formulaire-exemple.csv');
        require('node:fs').writeFileSync(file, rows.map((r) => r.map(q).join(',')).join('\n'));
        const input = await page.$('input[type="file"][accept=".csv,text/csv"]');
        await input.uploadFile(file);
        await sleep(800);
        await page.evaluate(() => {
          const card = document.querySelector('.setup-from-form');
          card?.querySelector('button')?.click();
          card?.scrollIntoView();
        });
        await sleep(300);
        await tall('105-import-preparer');
        await clickButton(/^Appliquer ces réglages$/);
        await sleep(800);
        await shot('106-import-reglages-appliques');
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
      if (want('personnes') || want('billetterie')) {
        await tab('Personnes');
        await shot('85-personnes');
        // A click on a bénévole's row opens the fiche beside the list; the arrow walks to the next.
        await page.evaluate(() => document.querySelector('tr[data-person^="benevole|"] td:nth-child(2)')?.click());
        await sleep(400);
        await shot('86-personnes-fiche-benevole');
        await page.keyboard.press('ArrowDown');
        await sleep(400);
        await clickButton(/^Modifier la fiche$/).catch(() => {});
        await tall('87-personnes-fiche-edition');
        await page.evaluate(() => document.querySelector('tr[data-person^="orga|"] td:nth-child(2)')?.click());
        await sleep(400);
        await tall('88-personnes-fiche-orga');
        // Bénévole ↔ orga: the proposal, then the fiche it lands on, then back with Ctrl+Z.
        await clickButton(/^Passer en bénévole…$/);
        await page.evaluate(() => document.querySelector('.convert-box')?.scrollIntoView());
        await sleep(300);
        await shot('93-personnes-passage-proposition');
        await clickButton(/^Confirmer le passage en bénévole$/);
        await sleep(500);
        await shot('94-personnes-passage-fait');
        await clickButton(/^↶$/);
        await sleep(500);
        await page.select('select[aria-label="Colonnes affichées"]', 'contact');
        await sleep(300);
        await shot('89-personnes-contact');
        await page.select('select[aria-label="Colonnes affichées"]', 'repas');
        await page.type('input[name="people-search"]', 'mar');
        await sleep(400);
        await shot('90-personnes-repas-search');
        // The way in from the grid: a bénévole's box, then « Ouvrir dans Personnes ».
        await tab('Grille');
        await page.evaluate(() => document.querySelector('.box:not(.is-empty)')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await sleep(400);
        await shot('91-grille-ouvrir-dans-personnes');
        await clickButton(/^Ouvrir dans Personnes$/);
        await sleep(400);
        await shot('92-personnes-depuis-grille');
        // The reserve, listed apart under everybody else: put the open bénévole in it, then undo.
        await page.$eval('input[name="people-search"]', (el) => { el.value = ''; });
        await clickButton(/^Mettre en liste d'attente$/).catch(() => {});
        await sleep(400);
        await page.evaluate(() => document.querySelector('.people-reserve')?.scrollIntoView());
        await sleep(300);
        await shot('95-personnes-reserve');
        // The same person in the grid's « Liste d'attente » tab, ready to drag onto a créneau.
        await tab('Grille');
        await clickButton(/^Liste d'attente/);
        await shot('95b-grille-liste-attente');
        await clickButton(/^Disponibles/);
        await tab('Personnes');
        await clickButton(/^↶$/);
        await sleep(400);
      }
      if (want('candidature')) {
        // Le suivi des candidatures: the Candidature columns, a fiche cancelled while still placed,
        // then the steps card in Réglages. Everything undone after.
        await tab('Personnes');
        await page.select('select[aria-label="Colonnes affichées"]', 'candidature');
        await sleep(300);
        await shot('96-personnes-candidature');
        await page.evaluate(() => document.querySelector('tr[data-person^="benevole|"] td:nth-child(2)')?.click());
        await sleep(400);
        await page.select('select[name="fiche-status"]', 'annule');
        await sleep(400);
        await shot('97-personnes-fiche-annulee');
        await clickButton(/^↶$/);
        await sleep(400);
        // Availability day by day, and the montage days ticked, lower on the same fiche.
        await page.evaluate(() => document.querySelector('.availability-day')?.scrollIntoView({ block: 'start' }));
        await sleep(300);
        await shot('99-personnes-fiche-jours');
        await tab('Réglages');
        await page.evaluate(() => {
          const card = document.querySelector('.setup-application');
          card?.querySelector('button')?.click();
          card?.scrollIntoView();
        });
        await sleep(400);
        await shot('98-reglages-suivi');
        // Competences: declare one, then see it on a fiche.
        await page.evaluate(() => {
          const card = document.querySelector('.setup-skills');
          card?.querySelector('button')?.click();
          card?.scrollIntoView();
        });
        await sleep(300);
        await page.type('input[name="new-skill"]', 'Permis B');
        await page.keyboard.press('Enter');
        await sleep(400);
        await shot('100-reglages-competences');
        await tab('Personnes');
        await page.evaluate(() => document.querySelector('tr[data-person^="benevole|"] td:nth-child(2)')?.click());
        await sleep(400);
        await page.evaluate(() => document.querySelector('.skill-picker')?.scrollIntoView({ block: 'center' }));
        await sleep(300);
        await shot('101-personnes-fiche-competences');
        // Teams: switch the mode on, make a team of three, then select one of them on the grid.
        await tab('Équipes');
        await page.click('input[name="teams-enabled"]');
        await clickButton(/^Ajouter une équipe$/);
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => {
            const select = document.querySelector('select[name^="team-add-"]');
            const option = select?.options[1];
            if (select && option) {
              const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
              setter.call(select, option.value);
              select.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
          await sleep(300);
        }
        await shot('102-logistique-equipes');
        // Side activities: declare one, tick it on a fiche, read the list back.
        await tab('Activités annexes');
        await page.type('input[name="new-side-activity"]', 'Pré-montage');
        await page.keyboard.press('Enter');
        await sleep(300);
        await tab('Personnes');
        await page.evaluate(() => document.querySelector('tr[data-person^="benevole|"] td:nth-child(2)')?.click());
        await sleep(400);
        await page.evaluate(() => document.querySelector('input[name^="fiche-activity-"]')?.click());
        await sleep(300);
        await tab('Activités annexes');
        await shot('103-logistique-activites');
      }
      if (want('magasin')) {
        // Le Magasin: two lines, one of them lent and out.
        await tab('Magasin');
        await clickButton(/^Ajouter du matériel$/);
        await clickButton(/^Ajouter du matériel$/);
        await page.type('input[name="equipment-name-materiel-1"]', 'Tonnelle 3x3');
        await page.type('input[name="equipment-lender-materiel-1"]', 'Mairie');
        await page.select('select[name="equipment-status-materiel-1"]', 'sorti');
        await page.type('input[name="equipment-holder-materiel-1"]', 'Bar');
        await page.type('input[name="equipment-name-materiel-2"]', 'Rallonges 25 m');
        await sleep(400);
        await shot('104-magasin');
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
