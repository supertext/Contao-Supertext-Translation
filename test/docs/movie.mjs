#!/usr/bin/env node
/**
 * Records the demo movie (docs/images/demo.gif and an MP4) from a FRESH demo whose
 * SUPERTEXT_API_URL points at the stand-in API (stand-in.mjs), like screenshots.mjs.
 * The editor opens "About us" in English, translates it with Supertext into German and
 * French and checks the German copy. See "Demo movie" in docs/DEVELOPER.md.
 *
 *   CONTAO_URL=http://127.0.0.1:8080 EDITOR_EMAIL=… EDITOR_PASSWORD=… node test/docs/movie.mjs
 *
 * Voice: Piper (pip install piper-tts), voice "alba" downloaded once into movie/voice-cache/
 * (git-ignored); MOVIE_VOICE=0 makes a silent movie. MOVIE_OUT: where the MP4 goes (default test/docs/movie/out/Contao-Supertext-Translation.mp4,
 * git-ignored; the MP4 is not committed). Needs ffmpeg.
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MovieKit } from './movie/movie-kit.mjs';

const B = (process.env.CONTAO_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const out = process.env.MOVIE_OUT ?? here('movie/out/Contao-Supertext-Translation.mp4');
const gif = here('../../docs/images/demo.gif');
const need = (name) => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'en-US' });

// Sign in as the demo editor (not recorded).
await page.goto(`${B}/contao/login`);
await page.fill('input[name=username]', need('EDITOR_EMAIL'));
await page.fill('input[name=password]', need('EDITOR_PASSWORD'));
await Promise.all([page.waitForNavigation(), page.click('button[type=submit], input[type=submit]')]);

/** The site structure with every node expanded. */
async function siteStructure() {
	await page.goto(`${B}/contao?do=page&ptg=all`);
	if (!(await page.getByText('About us', { exact: true }).first().isVisible().catch(() => false))) await page.goto(`${B}/contao?do=page&ptg=all`);
	await page.getByText('About us', { exact: true }).first().waitFor();
}

/** The tree row of the page titled `title`. */
const row = (title) => page.locator('.tl_file, .tl_folder').filter({ has: page.locator('.tl_left').getByText(title, { exact: true }) }).first();

/** The article row titled `title` in the Articles module (all nodes expanded). */
async function articles() {
	await page.goto(`${B}/contao?do=article&ptg=all`);
	await page.locator('.tl_listing').first().waitFor();
}
const articleRow = (title) => page.locator('li.tl_file').filter({ hasText: `${title} [` }).first();

await siteStructure(); // expands the tree (Contao remembers it)
await articles();
const aboutContent = await articleRow('About us').locator('a[href*="table=tl_content"]').first().evaluate((a) => a.href);

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contao-movie-'));
await page.goto(aboutContent);
const kit = await MovieKit.start(page, { workDir, assets: here('movie/assets'), voiceCache: here('movie/voice-cache') });

// 1. The English page in the back end.
await kit.say("Here's a page in English, “About us”, in the Contao back end.", { caption: 'A page in English: “About us”' });

// 2. Site structure → Translate with Supertext.
await kit.say('Open the site structure, under Pages.', {
	caption: 'Open the site structure: <b>Pages</b>',
	during: async () => {
		await kit.click(page.locator('#tl_navigation a, nav a').filter({ hasText: /^\s*Pages\s*$/ }).first());
		await page.getByText('About us', { exact: true }).first().waitFor();
		await kit.sync();
	},
});
const translate = row('About us').locator('a[href*="/supertext/translate/"]:visible').first();
await kit.say('Next to the page, click Translate with Supertext.', {
	caption: 'Click <b>Translate with Supertext</b> on the page',
	during: async () => {
		await translate.waitFor({ state: 'visible' });
		await kit.moveTo(translate);
		await translate.hover(); // Contao's tooltip names the operation
		await kit.hold(700);
		await page.evaluate(([x, y]) => window.__stk?.ripple(x, y), [kit.cursor.x, kit.cursor.y]);
		await Promise.all([page.waitForURL(/supertext\/translate/), translate.click()]);
		await kit.sync();
	},
});

// 3. Pick the languages and start.
const form = page.locator('form.supertext-translate');
await kit.say('Keep German and French, and untick Italian.', {
	caption: 'Choose the languages: <b>Deutsch</b> and <b>Français</b>',
	during: async () => {
		await kit.hold(800);
		await kit.click(form.locator('label', { hasText: 'Italiano' }));
	},
});
const submit = form.locator('button.tl_submit, input.tl_submit').first();
await kit.say('Then click Translate.', { caption: 'Click <b>Translate</b>', during: () => kit.moveTo(submit), after: 0 });

// The stand-in answers at once: send the request only after the progress state has been seen.
let release;
const released = new Promise((resolve) => (release = resolve));
await page.route(/supertext\/translate\/\d+/, async (route) => {
	if (route.request().method() === 'POST') await released;
	await route.continue();
});
await page.evaluate(([x, y]) => window.__stk?.ripple(x, y), [kit.cursor.x, kit.cursor.y]);
const done = page.waitForURL(/supertext\/translate/, { waitUntil: 'load', timeout: 300_000 }).then(() => page.waitForSelector('.tl_confirm', { timeout: 300_000 }));
await kit.say('Supertext translates the content.', {
	caption: 'Supertext translates the content…',
	during: async () => {
		await submit.click({ noWaitAfter: true });
		await kit.hold(1300);
		release();
	},
});
kit.pause();
await done;
kit.resume();
await kit.sync();

// 4. The result: open the German copy.
await kit.say('A few seconds later, the German and French pages are there, saved unpublished.', { caption: 'Done: German and French pages, unpublished' });
const german = page.locator('.tl_confirm').first().locator('a', { hasText: 'Über uns' });
await kit.say("Let's open the German page and check it.", {
	caption: 'Open the German page to check it',
	during: async () => {
		await kit.click(german);
		await page.waitForLoadState('load');
		await kit.sync();
		await kit.hold(500);
		await kit.click(articleRow('Über uns').locator('a[href*="table=tl_content"]:visible').first());
		await page.waitForLoadState('load');
		await kit.sync();
	},
});
await kit.say('The German version is ready. Review it, and publish it as usual.', { caption: 'The German version is ready – review it and publish' });
await kit.caption('');

fs.mkdirSync(path.dirname(out), { recursive: true });
await kit.finish(out, { system: 'Contao', repo: 'Contao-Supertext-Translation', gif });
await browser.close();
fs.rmSync(workDir, { recursive: true, force: true });
console.log(`Saved ${out} and ${gif} (${(fs.statSync(gif).size / 1e6).toFixed(2)} MB)`);
