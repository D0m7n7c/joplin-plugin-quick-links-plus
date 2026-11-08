import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { pinRecent } from '../src/noteOrder';

// Notes in context order (as getNotes sorts them), each with an edit time.
// "far" is the most recently edited note but sits last by context.
const SORTED = [
	{ id: 'near1', updated_time: 300 },
	{ id: 'near2', updated_time: 100 },
	{ id: 'mid', updated_time: 200 },
	{ id: 'far', updated_time: 900 },
];

const ids = (list: { note: { id: string } }[]) => list.map(x => x.note.id);
const marked = (list: { note: { id: string }; recent: boolean }[]) =>
	list.filter(x => x.recent).map(x => x.note.id);

test('pinRecent: 0 keeps the context order and marks nothing', () => {
	const out = pinRecent(SORTED, 0);
	assert.deepEqual(ids(out), ['near1', 'near2', 'mid', 'far']);
	assert.deepEqual(marked(out), []);
});

test('pinRecent: 1 moves the most recently edited note to the top and marks it', () => {
	const out = pinRecent(SORTED, 1);
	assert.deepEqual(ids(out), ['far', 'near1', 'near2', 'mid']);
	assert.deepEqual(marked(out), ['far']);
});

test('pinRecent: N pins the N most recent notes, newest first, rest keeps context order', () => {
	const out = pinRecent(SORTED, 2);
	assert.deepEqual(ids(out), ['far', 'near1', 'near2', 'mid']);
	assert.deepEqual(marked(out), ['far', 'near1']);
});

test('pinRecent: a pinned note is not repeated below the line', () => {
	const out = pinRecent(SORTED, 3);
	assert.deepEqual(ids(out), ['far', 'near1', 'mid', 'near2']);
	assert.equal(new Set(ids(out)).size, out.length);
});

test('pinRecent: pinning every note gives plain recency order without markers', () => {
	for (const n of [4, 21]) {
		const out = pinRecent(SORTED, n);
		assert.deepEqual(ids(out), ['far', 'near1', 'mid', 'near2']);
		assert.deepEqual(marked(out), [], `no markers for ${n}`);
	}
});

test('pinRecent: equal edit times keep their context order', () => {
	const tied = [
		{ id: 'a', updated_time: 5 },
		{ id: 'b', updated_time: 5 },
		{ id: 'c', updated_time: 1 },
	];
	assert.deepEqual(ids(pinRecent(tied, 2)), ['a', 'b', 'c']);
});

test('pinRecent: invalid or negative counts behave like 0', () => {
	for (const n of [-3, NaN, undefined as unknown as number]) {
		const out = pinRecent(SORTED, n);
		assert.deepEqual(ids(out), ['near1', 'near2', 'mid', 'far']);
		assert.deepEqual(marked(out), []);
	}
});

test('pinRecent: an empty list stays empty', () => {
	assert.deepEqual(pinRecent([], 3), []);
});
