// editor/index.ts
//
// CodeMirror content script entry point. Quick Links Plus targets the modern
// CodeMirror 6 Markdown editor; the legacy CodeMirror 5 editor is not supported.

import { PluginContext } from './types';
import codeMirror6Plugin from './codeMirror6Plugin';

module.exports = {
	default: function (context: PluginContext) {
		return {
			plugin: (CodeMirror: any) => {
				if (CodeMirror.cm6) {
					return codeMirror6Plugin(context, CodeMirror);
				}
				// Legacy CodeMirror 5 editor: nothing to do.
			},
			assets: function () {
				return [
					{ name: 'editorStyles.css' },
				];
			},
		};
	},
};
