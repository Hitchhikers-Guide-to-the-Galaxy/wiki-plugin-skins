/* skins item — lists every skin installed on this site as a button that
 * shows the current lineup in that skin. The item text is a short note shown
 * above the buttons. */
;(function () {
  function withKit (fn) {
    if (window.SkinKit) return fn(window.SkinKit)
    var s = document.createElement('script')
    s.src = '/plugins/skins/skin-kit.js'
    s.onload = function () { fn(window.SkinKit) }
    document.head.appendChild(s)
  }
  function esc (s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] }) }
  function emit ($item, item) {
    $item.html('<div class="skins-item" style="background:#f6f7f9;padding:10px 12px;border-radius:6px">' +
      '<p style="margin:0 0 8px">' + (window.wiki ? wiki.resolveLinks(item.text || '') : esc(item.text)) + '</p>' +
      '<div class="skins-list">Looking for skins…</div></div>')
  }
  function bind ($item, item) {
    var list = $item[0].querySelector('.skins-list')
    withKit(function (kit) {
      kit.listSkins().then(function (skins) {
        list.innerHTML = skins.map(function (s, i) {
          return '<button data-i="' + i + '" title="' + esc(s.about) + '" style="margin:0 6px 6px 0">' + esc(s.label) +
            (s.trust === 'guest' ? ' <small>(guest)</small>' : '') + '</button>'
        }).join('') + (skins.length < 2 ? '<p style="margin:4px 0 0;color:#6a737d">Only Classic is installed here.</p>' : '')
        list.onclick = function (ev) {
          var b = ev.target.closest('button'); if (!b) return
          kit.switchTo(skins[Number(b.getAttribute('data-i'))], location.pathname === '/' ? '/view/welcome-visitors' : location.pathname)
        }
      })
    })
    $item.on('dblclick', function () { return wiki.textEditor($item, item) })
  }
  window.plugins = window.plugins || {}
  window.plugins.skins = { emit: emit, bind: bind }
})()
