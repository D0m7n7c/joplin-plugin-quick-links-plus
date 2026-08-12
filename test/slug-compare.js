/*
 * Slug comparison harness (dev tool, not part of `npm test`).
 *
 * Compares the plugin's slugify() against Joplin's real slug function — uslug
 * from @joplin/fork-uslug, exactly what Joplin's renderer uses for heading anchors
 * (uslug(text), no options). Run it to see every case, matches and mismatches:
 *
 *     npm run slug-compare
 *
 * It needs the compiled parser, so `npm run pretest` runs first via the script.
 * Requires the devDependency @joplin/fork-uslug.
 *
 * Green = the plugin matches Joplin. Red = it differs. Colour is disabled
 * automatically when the output is not a TTY (e.g. piped to a file).
 */
'use strict';

const path = require('path');
const plugin = require(path.join(__dirname, '..', 'dist-test', 'src', 'noteParser.js')).slugify;
const joplin = require('@joplin/fork-uslug');

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const green = s => (useColour ? `\x1b[32m${s}\x1b[0m` : s);
const red = s => (useColour ? `\x1b[31m${s}\x1b[0m` : s);
const dim = s => (useColour ? `\x1b[2m${s}\x1b[0m` : s);

const groups = {
	'ASCII / basics': ['Hello World', 'Hello   World', '  trim me  ', 'UPPER case', 'already-hyphen'],
	'Numbers / symbols': ['Chapter 1', '2 + 2 = 4', 'C++ & C#', '50% off', 'price $5', 'a_b_c', 'under_score', 'a__b'],
	'Punctuation': ['Hello, World!', 'What? Really...', '"quoted"', '(parens)', 'a.b.c', 'semi;colon', 'slash/here'],
	'Hyphen edges': ['a---b', '-leading', 'trailing-', '---', '...dots...'],
	'German': ['Über uns', 'Größe', 'Weiß', 'Straße', 'Öl'],
	'French': ['Café', 'Élève', 'Château', 'Cœur'],
	'Spanish': ['Niño', 'Mañana', '¿Qué?', 'España'],
	'Nordic': ['Åse', 'Smørrebrød', 'Æble', 'Ångström'],
	'Polish': ['Łódź', 'Żaba', 'Ćma', 'Wąż'],
	'Turkish': ['İstanbul', 'Şeker', 'Iğdır'],
	'Cyrillic': ['Привет мир', 'Москва'],
	'Greek': ['Καλημέρα', 'Ελλάδα'],
	'Chinese': ['你好世界', '北京'],
	'Japanese': ['こんにちは', '東京タワー'],
	'Korean': ['안녕하세요', '한국어'],
	'Arabic': ['مرحبا', 'العربية'],
	'Hebrew': ['שלום', 'עברית'],
	'Thai': ['สวัสดี'],
	'Devanagari': ['नमस्ते'],
	'Vietnamese': ['Tiếng Việt'],
	'Combining accents (NFD)': ['cafe\u0301', 'e\u0301'],
	'Compatibility (ligatures, numerals)': ['\uFB01le', '\u01C5', '\u2167'],
	'Emoji (Joplin fork feature)': ['Hello \u{1F44B} World', 'Star \u2B50 rating', 'caf\u00E9 \u2615 time'],
	'Symbols only': ['!!!', '***', '@#$%'],
	'Underscores': ['_überschrift', '_leading', 'trailing_', '__double__', 'a_b', 'snake_case', 'my_var_name', '___triple', 'API_KEY', 'get_user_by_id', 'a_1_b', 'café_bar', '_'],
	'Real headings': ['TODO: fix bug', 'Part 1: Introduction', 'v1.2.3', 'foo.bar()', 'README.md', 'src/index.ts', 'Q&A', 'Step 1 - Setup', 'user@example.com'],
	'Punctuation combos': ['a & b', 'a/b/c', 'a|b', 'a:b', 'a;b', 'a=b', 'a+b', 'a*b', 'a~b', 'a^b', 'a\u2014b', 'a\u2026b'],
	'Quotes / brackets': ["'single'", '\u00ABguillemets\u00BB', '[bracket]', '{brace}', '<angle>'],
	'Numbers / fractions': ['1.5', '1,000', '3.14', '\u00BD', 'No. 5', '100%', '1st place'],
	'Currency / math': ['$5', '\u20AC10', '\u00A320', '5\u00D73', 'a\u00F7b', '\u00B15'],
	'Case styles': ['HELLO', 'camelCase', 'PascalCase', 'ALL_CAPS', 'iOS App', 'macOS'],
	'Hyphen variants': ['a-b', 'a--b', 'a - b', '-a-', 'a-', '-a', 'a\u2010b', 'a\u2013b', 'a\u2014b'],
};

const show = s => JSON.stringify(s);
let total = 0, match = 0, differ = 0;

for (const [group, inputs] of Object.entries(groups)) {
	console.log(`\n[${group}]`);
	for (const input of inputs) {
		total++;
		const p = plugin(input), j = joplin(input);
		if (p === j) {
			match++;
			console.log(`  ${green('✓')} ${show(input)} ${dim('→')} ${show(p)}`);
		} else {
			differ++;
			console.log(`  ${red('✗')} ${show(input)}`);
			console.log(`      plugin: ${red(show(p))}`);
			console.log(`      joplin: ${green(show(j))}`);
		}
	}
}

const line = `${total} cases — ${match} match, ${differ} differ`;
console.log('\n' + (useColour ? `\x1b[1m${line}\x1b[0m` : line) + '\n');
