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
	var MARK_CHAR = '\u00A7'; // §

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

	// Text preceding an inline anchor within its block; falls back to the whole
	// block text and finally to the anchor id.
	function anchorLabel(anchor) {
		var block = anchor.closest('p,li,td,th,div,blockquote,h1,h2,h3,h4,h5,h6') || anchor.parentElement;
		if (block) {
			try {
				var range = document.createRange();
				range.setStart(block, 0);
				range.setEndBefore(anchor);
				var before = range.toString().replace(/\s+/g, ' ').trim();
				if (before) return before;
			} catch (e) { /* ignore */ }
			var whole = blockText(block);
			if (whole) return whole;
		}
		return anchor.id;
	}

	function showCopied(span) {
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
		span.textContent = MARK_CHAR;
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
