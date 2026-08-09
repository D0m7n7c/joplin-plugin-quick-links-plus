import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseOutline, slugify, matchWindow, OutlineEntry } from '../src/noteParser';

// Small helpers so the assertions below read like intent, not plumbing.
const headings = (body: string): OutlineEntry[] => parseOutline(body).filter(e => e.kind === 'heading');
const anchors = (body: string): OutlineEntry[] => parseOutline(body).filter(e => e.kind === 'anchor');
const firstAnchorText = (body: string): string | undefined => anchors(body)[0]?.text;

// --------------------------------------------------------------------------
// Heading detection
// --------------------------------------------------------------------------

test('heading: 0-3 leading spaces are headings, 4+ are an indented code block', () => {
	assert.equal(headings('# A').length, 1, '0 spaces');
	assert.equal(headings('   # B').length, 1, '3 spaces');
	assert.equal(headings('    # C').length, 0, '4 spaces = code block');
	assert.equal(headings('\t# D').length, 0, 'tab = code block');
});

test('heading: levels 1..6, but not 7 hashes', () => {
	assert.equal(headings('###### Six').length, 1);
	assert.deepEqual(headings('###### Six').map(h => h.level), [6]);
	assert.equal(headings('####### Seven').length, 0);
});

test('heading: a bare "#" or an empty "# " produces no usable heading', () => {
	assert.equal(headings('#').length, 0, 'no space, not a heading at all');
	assert.equal(headings('# ').length, 0, 'empty text, skipped as unusable');
});

test('heading: an empty heading does not add an empty breadcrumb to children', () => {
	const child = headings('# \n## Child').find(h => h.text === 'Child');
	assert.deepEqual(child?.breadcrumb, []);
});

test('heading: trailing closing hashes are stripped from the text', () => {
	assert.deepEqual(headings('## Title ##').map(h => h.text), ['Title']);
});

test('heading: breadcrumb collects ancestor headings from outer to inner', () => {
	const body = '# Top\n## Middle\n### Leaf';
	const leaf = headings(body).find(h => h.text === 'Leaf');
	assert.deepEqual(leaf?.breadcrumb, ['Top', 'Middle']);
});

// --------------------------------------------------------------------------
// Fenced code blocks (regression guard: content inside must be ignored)
// --------------------------------------------------------------------------

test('fence: a "#" line inside a ``` block is not treated as a heading', () => {
	const body = '# Real\n```\n# not a heading\n```\n## Also real';
	assert.deepEqual(headings(body).map(h => h.text), ['Real', 'Also real']);
});

test('fence: ~~~ fences are handled like ``` fences', () => {
	const body = '~~~\n# hidden\n~~~\n# visible';
	assert.deepEqual(headings(body).map(h => h.text), ['visible']);
});

test('fence: an anchor inside a code block is ignored', () => {
	const body = '```\nsome code <a id="c1"></a>\n```\ntext <a id="c2"></a>';
	assert.deepEqual(anchors(body).map(a => a.anchor), ['c2']);
});

// --------------------------------------------------------------------------
// Inline anchors — label extraction per container
// --------------------------------------------------------------------------

test('anchor: plain paragraph uses the text before the anchor', () => {
	assert.equal(firstAnchorText('Some sentence.<a id="a1"></a>'), 'Some sentence.');
});

test('anchor: list marker is stripped from the label', () => {
	assert.equal(firstAnchorText('- Item text<a id="a1"></a>'), 'Item text');
	assert.equal(firstAnchorText('* Star item<a id="a1"></a>'), 'Star item');
	assert.equal(firstAnchorText('1. Numbered<a id="a1"></a>'), 'Numbered');
});

test('anchor: task checkbox is stripped after the list marker', () => {
	assert.equal(firstAnchorText('- [ ] Todo<a id="a1"></a>'), 'Todo');
	assert.equal(firstAnchorText('- [x] Done<a id="a1"></a>'), 'Done');
	assert.equal(firstAnchorText('- [X] Big X<a id="a1"></a>'), 'Big X');
	assert.equal(firstAnchorText('1. [ ] Numbered todo<a id="a1"></a>'), 'Numbered todo');
});

test('anchor: a "[ ]" in the middle of prose is NOT treated as a checkbox', () => {
	assert.equal(firstAnchorText('Prose with [ ] inside<a id="a1"></a>'), 'Prose with [ ] inside');
});

test('anchor: quote prefix is stripped', () => {
	assert.equal(firstAnchorText('> Quoted line<a id="a1"></a>'), 'Quoted line');
});

test('anchor on a heading line: the line is a heading; the inline anchor is absorbed', () => {
	const entries = parseOutline('## Section<a id="a1"></a>');
	assert.equal(entries.length, 1);
	assert.equal(entries[0].kind, 'heading');
	assert.equal(entries[0].text, 'Section');
	assert.equal(entries[0].anchor, 'section');
});

test('anchor: two anchors on one line each read back only to the previous anchor', () => {
	const body = 'First<a id="a1"></a> then second<a id="a2"></a>';
	assert.deepEqual(anchors(body).map(a => a.text), ['First', 'then second']);
});

test('anchor: id and name attributes are both recognised', () => {
	assert.deepEqual(anchors('x<a id="byid"></a> y<a name="byname"></a>').map(a => a.anchor),
		['byid', 'byname']);
});

// --------------------------------------------------------------------------
// Inline formatting is stripped from labels (via heading text)
// --------------------------------------------------------------------------

test('label: bold/italic/strikethrough/code markers are stripped', () => {
	assert.equal(headings('## **Bold**')[0].text, 'Bold');
	assert.equal(headings('## *Italic*')[0].text, 'Italic');
	assert.equal(headings('## ~~Struck~~')[0].text, 'Struck');
	assert.equal(headings('## `code`')[0].text, 'code');
});

test('label: == highlight markers are stripped', () => {
	assert.equal(headings('## ==Mark==')[0].text, 'Mark');
	assert.equal(headings('## ==A== and ==B==')[0].text, 'A and B');
});

test('label: footnote references [^x] and inline footnotes ^[x] are stripped', () => {
	assert.equal(headings('## Title[^1]')[0].text, 'Title');
	assert.equal(headings('## Title[^note]')[0].text, 'Title');
	assert.equal(headings('## A[^1] and B[^2]')[0].text, 'A and B');
	assert.equal(headings('## Title^[an inline note]')[0].text, 'Title');
	assert.equal(headings('## Value 2^10')[0].text, 'Value 2^10');
});

test('label: ordinary square brackets and links are not mistaken for footnotes', () => {
	assert.equal(headings('## See [Chapter]')[0].text, 'See [Chapter]');
	assert.equal(headings('## [Link](:/abc)')[0].text, 'Link');
});

test('label: a single "=" is preserved (not a highlight marker)', () => {
	assert.equal(headings('## a = b')[0].text, 'a = b');
});

// --------------------------------------------------------------------------
// slugify (+ Joplin-style duplicate handling via parseOutline)
// --------------------------------------------------------------------------

test('slugify: lowercases, trims, spaces to hyphens', () => {
	assert.equal(slugify('  Hello World  '), 'hello-world');
});

test('slugify: drops punctuation but keeps letters, numbers, hyphens', () => {
	assert.equal(slugify('C++ & C#: a guide!'), 'c-c-a-guide');
	assert.equal(slugify('already-hyphenated'), 'already-hyphenated');
});

test('slugify: collapses repeated and edge hyphens', () => {
	assert.equal(slugify('a -- b'), 'a-b');
	assert.equal(slugify('-edge-'), 'edge');
});

test('slugify: keeps unicode letters', () => {
	assert.equal(slugify('Über Grüße'), 'über-grüße');
});

test('duplicate headings get -1, -2 suffixes on the anchor (Joplin behaviour)', () => {
	const body = '# Intro\n# Intro\n# Intro';
	assert.deepEqual(headings(body).map(h => h.anchor), ['intro', 'intro-1', 'intro-2']);
});

// --------------------------------------------------------------------------
// matchWindow (snippet display)
// --------------------------------------------------------------------------

test('matchWindow: short text is returned unchanged', () => {
	const s = 'short text';
	assert.equal(matchWindow(s, 0, 5), s);
});

test('matchWindow: long text is trimmed with ellipses around the match', () => {
	const long = 'x'.repeat(40) + ' NEEDLE ' + 'y'.repeat(40);
	const idx = long.indexOf('NEEDLE');
	const out = matchWindow(long, idx, 'NEEDLE'.length);
	assert.ok(out.length <= 60 + 4, 'stays near the cap (plus ellipses)');
	assert.ok(out.includes('NEEDLE'), 'the match itself is always visible');
	assert.ok(out.includes('…'), 'shows an ellipsis where text was cut');
});

test('matchWindow: an out-of-range match index falls back to a capped label', () => {
	const long = 'z'.repeat(100);
	const out = matchWindow(long, -1, 3);
	assert.ok(out.length < long.length, 'returns a capped label, not the whole string');
});
