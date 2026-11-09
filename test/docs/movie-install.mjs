#!/usr/bin/env node
/**
 * Records the install and configuration movie (MP4 only, no GIF) from a FRESH demo whose
 * SUPERTEXT_API_URL points at the stand-in API (stand-in.mjs), like movie.mjs. An administrator
 * installs the bundle (terminal: Composer, database update, API key in .env.local, cache),
 * sees the API key check, sets the German website root's Supertext language and shows where
 * editors find "Translate with Supertext". See "Demo movie" in docs/DEVELOPER.md.
 *
 *   CONTAO_URL=http://127.0.0.1:8080 ADMIN_EMAIL=… ADMIN_PASSWORD=… node test/docs/movie-install.mjs
 *
 * The demo's API key should be a made-up one (the stand-in accepts any key); the terminal shows
 * st-demo-0000-0000-0000. MOVIE_VOICE=0 makes a silent movie. MOVIE_OUT: where the MP4 goes
 * (default test/docs/movie/out/Contao-Supertext-Translation-install.mp4, git-ignored). Needs ffmpeg.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MovieKit } from './movie/movie-kit.mjs';

const B = (process.env.CONTAO_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = process.env.MOVIE_OUT ?? here('movie/out/Contao-Supertext-Translation-install.mp4');
const need = (name) => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const FAKE_KEY = 'st-demo-0000-0000-0000';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'en-US' });

// Sign in as the demo administrator (not recorded): configuration is an administrator's task.
await page.goto(`${B}/contao/login`);
await page.fill('input[name=username]', need('ADMIN_EMAIL'));
await page.fill('input[name=password]', need('ADMIN_PASSWORD'));
await Promise.all([page.waitForNavigation(), page.click('button[type=submit], input[type=submit]')]);

/** The site structure with every node expanded. */
async function siteStructure() {
	await page.goto(`${B}/contao?do=page&ptg=all`);
	if (!(await page.getByText('About us', { exact: true }).first().isVisible().catch(() => false))) await page.goto(`${B}/contao?do=page&ptg=all`);
	await page.getByText('About us', { exact: true }).first().waitFor();
}
/** The tree row of the page titled `title`. */
const row = (title) => page.locator('.tl_file, .tl_folder').filter({ has: page.locator('.tl_left').getByText(title, { exact: true }) }).first();
const pagesNav = () => page.locator('#tl_navigation a, nav a').filter({ hasText: /^\s*Pages\s*$/ }).first();

await siteStructure(); // expands the tree (Contao remembers it)
// Open the translate screen once, so the automatic API key check has run (it runs after the page is sent).
await page.goto(`${B}/contao/supertext/translate/${await row('About us').locator('a[href*="/supertext/translate/"]').first().evaluate((a) => a.href.split('/').pop())}`);
await page.waitForTimeout(1500);

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contao-movie-install-'));
await page.goto('about:blank');
const kit = await MovieKit.start(page, { workDir, assets: here('movie/assets'), voiceCache: here('movie/voice-cache') });

/** More commands in the terminal kit.terminal() opened (same look; kit.terminal() would start a new one). */
async function typeMore(lines) {
	await page.evaluate(() => document.querySelector('#x > .p.c:last-child')?.remove());
	for (const l of lines) {
		if (l.cmd !== undefined) {
			await page.evaluate(() => { const x = document.getElementById('x');
				const p = document.createElement('span'); p.className = 'p'; p.textContent = '$ '; x.appendChild(p);
				const c = document.createElement('span'); c.className = 'c'; x.appendChild(c); });
			for (const ch of l.cmd) { await page.evaluate((ch) => { document.querySelector('#x .c').textContent += ch; }, ch); await page.waitForTimeout(38); }
			await page.waitForTimeout(450);
			await page.evaluate(() => { document.querySelector('#x .c').classList.remove('c'); document.getElementById('x').append('\n'); });
		} else {
			await page.evaluate((o) => { const s = document.createElement('span'); s.className = 'o'; s.textContent = o + '\n'; document.getElementById('x').appendChild(s); }, l.out ?? '');
			await page.waitForTimeout(l.wait ?? 180);
		}
	}
	await page.evaluate(() => { const c = document.createElement('span'); c.className = 'p c'; c.textContent = '$ '; document.getElementById('x').appendChild(c); });
}

// 1. Terminal: the commands from docs/INSTALLATION.md (output shortened).
await kit.say('First, add the bundle to your Contao installation with Composer.', {
	caption: 'Add the bundle with <b>Composer</b>',
	during: () => kit.terminal({ title: 'my-site', lines: [
		{ cmd: 'composer require supertext/contao-supertext-translation' },
		{ out: 'Package operations: 1 install, 0 updates, 0 removals' },
		{ out: '  - Installing supertext/contao-supertext-translation (v0.1.0)' },
	] }),
});
await kit.say('Then update the database. This adds a few columns and a small table.', {
	caption: 'Update the database: <b>contao:migrate</b>',
	during: () => typeMore([
		{ cmd: 'vendor/bin/contao-console contao:migrate' },
		{ out: 'Pending database migrations' },
		{ out: ' * ALTER TABLE tl_page ADD supertext_source …, ADD supertext_language …' },
		{ out: ' * CREATE TABLE tl_supertext_state (…)' },
		{ out: ' [OK] All migrations completed.' },
	]),
});
await kit.say('Generate your API key at supertext.com, under Integrations, A P I. No account yet? Create one at supertext.com.', {
	caption: 'API key: <b>supertext.com → Integrations → API</b> (Admin role)<br>No account yet? Create one at <b>supertext.com</b>',
	during: async () => { await kit.hold(1200); await typeMore([{ cmd: `echo 'SUPERTEXT_API_KEY=${FAKE_KEY}' >> .env.local` }]); },
});
await kit.say("Then clear Contao's cache, so that the key is used.", {
	caption: 'Key in <b>.env.local</b>, then clear the cache',
	during: () => typeMore([
		{ cmd: 'vendor/bin/contao-console cache:clear' },
		{ out: ' [OK] Cache for the "prod" environment was successfully cleared.' },
	]),
});
await kit.hold(300);

// 2. The back end as administrator: the website roots, one per language (loading time cut).
kit.pause();
await siteStructure();
await kit.sync();
kit.resume();
await kit.say('Now sign in to the Contao back end as an administrator. Each language has its own website root, under Pages.', {
	caption: 'One website root per language: <b>Content → Pages</b>',
	during: async () => { await kit.hold(900); await kit.moveTo(row('Deutsch').locator('.tl_left')); },
});

// 3. The API key check, on the translate screen.
const translate = row('About us').locator('a[href*="/supertext/translate/"]:visible').first();
await kit.say('Click Translate with Supertext next to a page.', {
	caption: 'Click <b>Translate with Supertext</b>',
	during: async () => {
		await kit.moveTo(translate);
		await translate.hover();
		await kit.hold(500);
		await page.evaluate(([x, y]) => window.__stk?.ripple(x, y), [kit.cursor.x, kit.cursor.y]);
		await Promise.all([page.waitForURL(/supertext\/translate/), translate.click()]);
		await kit.sync();
	},
});
const keyCheck = page.getByText('the connection to Supertext works', { exact: false }).first();
await kit.say('At the bottom, the API key check shows that the connection to Supertext works.', {
	caption: 'API key check: <b>the connection to Supertext works</b>',
	during: async () => { await kit.hold(400); await kit.moveTo(keyCheck); },
});

// 4. Language setup: the German website root → Supertext.
await kit.say('Next, the Supertext language of each website root. Go back to Pages, and edit the root Deutsch.', {
	caption: '<b>Pages</b> → edit the website root <b>Deutsch</b>',
	during: async () => {
		await kit.click(pagesNav());
		await page.getByText('About us', { exact: true }).first().waitFor();
		await kit.sync();
		const edit = row('Deutsch').locator('a[href*="act=edit"]:visible').first();
		await kit.moveTo(edit);
		await page.evaluate(([x, y]) => window.__stk?.ripple(x, y), [kit.cursor.x, kit.cursor.y]);
		await Promise.all([page.waitForURL(/act=edit/), edit.click()]);
		await page.locator('#ctrl_supertext_language').waitFor({ state: 'attached' });
		await kit.sync();
	},
});
const section = page.locator('#pal_supertext_legend');
const choices = section.locator('.choices').first();
await kit.say('In the section Supertext, the Supertext language is already preselected.', {
	caption: 'Section <b>Supertext</b> → <b>Supertext language</b>',
	during: async () => {
		await section.evaluate((el) => window.scrollBy({ top: el.getBoundingClientRect().top - 140, behavior: 'smooth' }));
		await kit.hold(900);
		await kit.moveTo(choices);
	},
});
await kit.say('Open it to pick another variant if you need one. We keep German, Switzerland.', {
	caption: 'Choose <b>German (Switzerland) (de-CH)</b>',
	during: async () => {
		await kit.click(choices);
		const search = section.locator('input.choices__input--cloned').first();
		if (await search.isVisible().catch(() => false)) await search.pressSequentially('German', { delay: 90 });
		await kit.hold(700);
		const option = section.locator('.choices__list--dropdown .choices__item--choice', { hasText: '(de-CH)' }).first();
		await kit.moveTo(option);
		await option.hover();
		await kit.hold(400);
		await page.evaluate(([x, y]) => window.__stk?.ripple(x, y), [kit.cursor.x, kit.cursor.y]);
		await option.click();
		await page.waitForLoadState('load');
		await kit.sync();
	},
});
const review = page.locator('#pal_supertext_legend').locator('label', { hasText: 'Translation review' }).first();
await kit.say('Translation review can be switched on per language. We leave it off.', {
	caption: '<b>Translation review</b>: optional, per language (left off)',
	during: async () => { await kit.hold(300); await kit.moveTo(review); },
});
const save = page.locator('button[name="save"], #save').first();
await kit.say('Save, and do the same in the French and Italian website roots.', {
	caption: 'Click <b>Save</b>, then the same for the other website roots',
	during: async () => {
		await kit.moveTo(save);
		await page.evaluate(([x, y]) => window.__stk?.ripple(x, y), [kit.cursor.x, kit.cursor.y]);
		await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), save.click()]);
		await page.waitForLoadState('load');
		await kit.sync();
		await kit.hold(300);
		await kit.moveTo(pagesNav());
		await page.evaluate(([x, y]) => window.__stk?.ripple(x, y), [kit.cursor.x, kit.cursor.y]);
		await Promise.all([page.waitForURL((u) => !/act=edit/.test(u.href)), pagesNav().click()]);
		await row('Services').waitFor();
		await kit.sync();
	},
});

// 5. Where editors find it.
await kit.say("That's it. Editors now find Translate with Supertext next to every page in the site structure.", {
	caption: 'Done: editors find <b>Translate with Supertext</b> next to every page',
	during: async () => {
		const icon = row('Services').locator('a[href*="/supertext/translate/"]:visible').first();
		await kit.moveTo(icon);
		await icon.hover();
	},
	after: 200,
});
await kit.caption('');

fs.mkdirSync(path.dirname(out), { recursive: true });
await kit.finish(out, { system: 'Contao', repo: 'Contao-Supertext-Translation', kind: 'install' });
await browser.close();
fs.rmSync(workDir, { recursive: true, force: true });
console.log(`Saved ${out}`);
