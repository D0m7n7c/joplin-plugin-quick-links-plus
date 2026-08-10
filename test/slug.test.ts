import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { slugify } from '../src/noteParser';

// Golden slug cases. Expected values were generated from Joplin's real slug
// function (uslug in @joplin/fork-uslug) and frozen here, so the suite runs in
// CI without that dependency. Regenerate with `npm run slug-compare` as the
// oracle if Joplin ever changes its slug. Emoji is intentionally NOT covered
// here — Joplin ships it disabled by default and the plugin does not support it
// (see the separate "known differences" test below).
const GOLDEN: [string, string][] = [
	["Hello World", "hello-world"],
	["Hello   World", "hello-world"],
	["UPPER case", "upper-case"],
	["already-hyphen", "already-hyphen"],
	["Chapter 1", "chapter-1"],
	["_überschrift", "_überschrift"],
	["_leading", "_leading"],
	["trailing_", "trailing_"],
	["__double__", "__double__"],
	["a_b", "a_b"],
	["snake_case", "snake_case"],
	["my_var_name", "my_var_name"],
	["___triple", "___triple"],
	["API_KEY", "api_key"],
	["get_user_by_id", "get_user_by_id"],
	["café_bar", "café_bar"],
	["_", "_"],
	["a~b", "a~b"],
	["a & b", "a-b"],
	["a/b/c", "abc"],
	["a:b", "ab"],
	["a=b", "ab"],
	["2 + 2 = 4", "2-2-4"],
	["C++ & C#", "c-c"],
	["price $5", "price-5"],
	["ﬁle", "file"],
	["½", "12"],
	["Ⅷ", "viii"],
	["ǅ", "dž"],
	["Über uns", "über-uns"],
	["Straße", "straße"],
	["Café", "café"],
	["Élève", "élève"],
	["Niño", "niño"],
	["Åse", "åse"],
	["Łódź", "łódź"],
	["İstanbul", "i̇stanbul"],
	["Привет мир", "привет-мир"],
	["Καλημέρα", "καλημέρα"],
	["你好世界", "你好世界"],
	["こんにちは", "こんにちは"],
	["안녕하세요", "안녕하세요"],
	["สวัสดี", "สวัสดี"],
	["नमस्ते", "नमस्ते"],
	["Tiếng Việt", "tiếng-việt"],
	["café", "café"],
	["-a-", "-a-"],
	["a-", "a-"],
	["-a", "-a"],
	["---", "-"],
	["a---b", "a-b"],
];

for (const [input, expected] of GOLDEN) {
	test(`slug: ${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
		assert.equal(slugify(input), expected);
	});
}

// Deliberate divergence from Joplin: emoji is default-off in Joplin, so the
// plugin strips it rather than transliterating to names. This test documents
// that choice; it asserts the plugin's behaviour, not Joplin's.
test('slug: emoji is stripped (deliberate, not Joplin-matched)', () => {
	assert.equal(slugify('Hello 👋 World'), 'hello-world');
	assert.equal(slugify('Star ⭐ rating'), 'star-rating');
});
