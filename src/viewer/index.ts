// viewer/index.ts
//
// Markdown-It content script. It does not transform the Markdown itself; it only
// ships the assets (CSS + JS) that run inside the rendered note viewer and add
// the clickable "§" copy marks to headings and inline anchors.

module.exports = {
	default: function () {
		return {
			plugin: function (_markdownIt: any) {
				// No Markdown transformation required.
			},
			assets: function () {
				return [
					{ name: 'anchorMark.css' },
					{ name: 'anchorMark.js' },
				];
			},
		};
	},
};
