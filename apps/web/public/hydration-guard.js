// Security/antivirus extensions (Bitdefender, Avast…) stamp attributes such as bis_skin_checked onto every element
// before React hydrates, which React reports as a hydration mismatch. This file is loaded by next/script with the
// beforeInteractive strategy, so it runs before the app code and is not part of the tree React compares.
// Each element is cleaned at most three times (an extension that keeps re-adding its mark cannot cause a loop), and
// the observer stops a few seconds after load because later attributes no longer matter to hydration.
(function () {
  'use strict';
  var names = ['bis_skin_checked', 'bis_register', 'bis_id'];
  var selector = '[bis_skin_checked],[bis_register],[bis_id]';
  var seen = new WeakMap();
  function clean(el) {
    if (!el || el.nodeType !== 1) return;
    var count = seen.get(el) || 0;
    if (count >= 3) return;
    var hit = false;
    for (var i = 0; i < names.length; i++) if (el.hasAttribute(names[i])) { el.removeAttribute(names[i]); hit = true; }
    if (hit) seen.set(el, count + 1);
  }
  function sweep(root) { var list = root.querySelectorAll(selector); for (var i = 0; i < list.length; i++) clean(list[i]); }
  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (record.type === 'attributes') clean(record.target);
      else for (var j = 0; j < record.addedNodes.length; j++) { var node = record.addedNodes[j]; if (node.nodeType === 1) { clean(node); sweep(node); } }
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: names });
  sweep(document);
  function stopLater() { sweep(document); setTimeout(function () { observer.disconnect(); }, 5000); }
  if (document.readyState === 'complete') stopLater(); else window.addEventListener('load', stopLater);
})();
