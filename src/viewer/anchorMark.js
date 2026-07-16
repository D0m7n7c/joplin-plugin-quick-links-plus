// viewer/anchorMark.js
//
// Runs inside the rendered note viewer. Adds a small "§" mark after every
// heading and inline anchor. Clicking a mark copies a Joplin link to that
// target and briefly shows "Copied!". The mark is hidden until its host line is
// hovered (light gray) and turns dark when the pointer is over the mark.
//
// The actual clipboard write happens in the plugin main process (via
// joplin.clipboard), which is reliable; the viewer only computes a label and
// posts the request. The main process also resolves the current note id itself,
// so there is no note-id timing issue here.
//
// Injection is self-healing and re-runs on Joplin's "joplin-noteDidUpdate"
// event as well as on DOM mutations, because Joplin re-renders (and may strip
// injected nodes) on every change.
//
// Plain JavaScript on purpose: copied verbatim into the plugin and executed in
// the viewer, where `webviewApi` is available.

(function () {
	'use strict';

	var CONTENT_SCRIPT_ID = 'quickLinksPlusViewer';
	// Inline link icon (outline, thick stroke). Uses currentColor so it follows
	// the same gray/dark states as the old "§" via CSS `color`.
	var MARK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
		+ '<path d="M10 13a5 5 0 0 0 7.54 .54l3 -3a5 5 0 0 0 -7.07 -7.07l-1.72 1.71"/>'
		+ '<path d="M14 11a5 5 0 0 0 -7.54 -.54l-3 3a5 5 0 0 0 7.07 7.07l1.71 -1.71"/>'
		+ '</svg>';

	var enabled = true;
	var copiedDurationMs = 900;
	var observer = null;
	var scheduled = false;

	function loadConfig() {
		try {
			return webviewApi
				.postMessage(CONTENT_SCRIPT_ID, { command: 'getConfig' })
				.then(function (cfg) {
					enabled = !cfg || cfg.enabled !== false;
					if (cfg && typeof cfg.copiedDurationMs === 'number' && cfg.copiedDurationMs > 0) {
						copiedDurationMs = cfg.copiedDurationMs;
					}
				})
				.catch(function () { enabled = true; });
		} catch (e) {
			enabled = true;
			return Promise.resolve();
		}
	}

	function rootElement() {
		return document.getElementById('rendered-md') || document.body;
	}

	// Heading text without the injected mark.
	function headingLabel(heading) {
		var text = '';
		heading.childNodes.forEach(function (node) {
			var isMark = node.nodeType === 1 && node.classList && node.classList.contains('qlp-mark');
			if (!isMark) text += node.textContent;
		});
		return text.replace(/\s+/g, ' ').trim();
	}

	// Text content of a block, ignoring any injected marks.
	function blockText(block) {
		var clone = block.cloneNode(true);
		clone.querySelectorAll('.qlp-mark').forEach(function (m) { m.remove(); });
		return (clone.textContent || '').replace(/\s+/g, ' ').trim();
	}

	// Text preceding an inline anchor on its visual line. To match the editor's
	// line-based label, the range starts after the last <br> before the anchor (a
	// soft line break inside the block), or at the block start when there is none.
	// Falls back to the whole block text and finally to the anchor id.
	function anchorLabel(anchor) {
		var block = anchor.closest('p,li,td,th,div,blockquote,h1,h2,h3,h4,h5,h6') || anchor.parentElement;
		if (block) {
			try {
				var range = document.createRange();

				var brs = block.querySelectorAll('br');
				var startBr = null;
				for (var i = 0; i < brs.length; i++) {
					if (anchor.compareDocumentPosition(brs[i]) & Node.DOCUMENT_POSITION_PRECEDING) {
						startBr = brs[i]; // keep the closest <br> before the anchor
					}
				}

				if (startBr) range.setStartAfter(startBr);
				else range.setStart(block, 0);
				range.setEndBefore(anchor);

				var before = range.toString().replace(/\s+/g, ' ').trim();
				if (before) return before;
			} catch (e) { /* ignore */ }
			var whole = blockText(block);
			if (whole) return whole;
		}
		return anchor.id;
	}

	// The "Copied!" chip uses a fixed blue, with a lighter shade on dark themes.
	// The theme is detected by measuring the rendered text color of the mark: light
	// text means a dark theme. No CSS variables, no link probing — just the two
	// blue pairs, so the chip looks the same everywhere and can't break.
	function isDarkTheme(span) {
		var m = String(window.getComputedStyle(span).color).match(/(\d+)\D+(\d+)\D+(\d+)/);
		if (!m) return false;
		var brightness = (Number(m[1]) * 299 + Number(m[2]) * 587 + Number(m[3]) * 114) / 1000;
		return brightness > 127; // light text -> dark theme
	}

	function showCopied(span) {
		try {
			if (isDarkTheme(span)) {
				span.style.setProperty('--qlp-chip-bg', '#7d9de7');
				span.style.setProperty('--qlp-chip-fg', '#1e1f22');
			} else {
				span.style.setProperty('--qlp-chip-bg', '#3c67d9');
				span.style.setProperty('--qlp-chip-fg', '#ffffff');
			}
		} catch (e) { /* leave the CSS defaults in place */ }

		span.classList.add('qlp-copied');
		window.setTimeout(function () { span.classList.remove('qlp-copied'); }, copiedDurationMs);
	}

	function requestCopy(span, targetId, label) {
		try {
			webviewApi
				.postMessage(CONTENT_SCRIPT_ID, { command: 'copyLink', anchor: targetId, label: label })
				.then(function (res) { if (res && res.ok) showCopied(span); })
				.catch(function () { /* ignore */ });
		} catch (e) { /* ignore */ }
	}

	function makeMark(targetId, getLabel) {
		var span = document.createElement('span');
		span.className = 'qlp-mark';
		span.innerHTML = MARK_SVG;
		span.setAttribute('role', 'button');
		span.setAttribute('aria-label', 'Copy anchor link');
		span.setAttribute('title', 'Copy anchor link');
		span.addEventListener('click', function (ev) {
			ev.preventDefault();
			ev.stopPropagation();
			var label = (getLabel() || targetId).replace(/\s+/g, ' ').trim();
			requestCopy(span, targetId, label);
		});
		return span;
	}

	function ensureHeadingMark(heading) {
		if (!heading.id) return;
		if (heading.querySelector(':scope > .qlp-mark')) return; // self-heal
		heading.classList.add('qlp-host');
		heading.appendChild(makeMark(heading.id, function () { return headingLabel(heading); }));
	}

	function ensureAnchorMark(anchor) {
		if (anchor.closest('h1,h2,h3,h4,h5,h6')) return; // heading already handled
		var next = anchor.nextElementSibling;
		if (next && next.classList && next.classList.contains('qlp-mark')) return; // self-heal

		var block = anchor.closest('p,li,td,th,div,blockquote') || anchor.parentElement;
		if (block) block.classList.add('qlp-host');

		var mark = makeMark(anchor.id, function () { return anchorLabel(anchor); });
		if (anchor.nextSibling) anchor.parentNode.insertBefore(mark, anchor.nextSibling);
		else anchor.parentNode.appendChild(mark);
	}

	function inject() {
		if (!enabled) return;
		var root = rootElement();
		if (!root) return;
		root.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(ensureHeadingMark);
		root.querySelectorAll('a[id]').forEach(ensureAnchorMark);
	}

	// Run injection without our own DOM changes re-triggering the observer.
	function runInject() {
		if (observer) observer.disconnect();
		try { inject(); } finally { connectObserver(); }
	}

	function connectObserver() {
		if (!window.MutationObserver) return;
		var root = rootElement();
		if (!root) return;
		if (!observer) observer = new MutationObserver(schedule);
		observer.observe(root, { childList: true, subtree: true });
	}

	function schedule() {
		if (scheduled) return;
		scheduled = true;
		window.requestAnimationFrame(function () {
			scheduled = false;
			runInject();
		});
	}

	function start() {
		if (!enabled) return;
		runInject();
	}

	function init() {
		loadConfig().then(function () {
			if (!enabled) return;
			runInject();
			// Official Joplin event fired whenever the rendered note updates.
			document.addEventListener('joplin-noteDidUpdate', schedule);
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
