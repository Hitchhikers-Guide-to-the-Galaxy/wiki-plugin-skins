/* skin-switcher.js — puts the "Skin" dropdown into the classic wiki footer.
 * Loaded on every page by the farm's client layer (the security module's
 * script list). It loads the kit, then mounts the dropdown; the lineup it
 * carries is read from the classic client's own URL at the moment you choose.
 */
;(function () {
  if (document.getElementById('skin-switcher-mounted')) return
  function mount () {
    var footer = document.querySelector('footer')
    if (!footer || !window.SkinKit) return
    var slot = document.createElement('span')
    slot.id = 'skin-switcher-mounted'
    slot.className = 'footer-item'
    slot.style.cssText = 'margin-left:.6em;font-size:smaller'
    var security = document.getElementById('security')
    if (security && security.nextSibling) footer.insertBefore(slot, security.nextSibling)
    else footer.appendChild(slot)
    SkinKit.mountSwitcher(slot, {
      current: 'classic',
      pathFn: function () { return location.pathname === '/' ? '/view/welcome-visitors' : location.pathname }
    })
  }
  if (window.SkinKit) return mount()
  var s = document.createElement('script')
  s.src = '/plugins/skins/skin-kit.js'
  s.onload = mount
  ;(document.head || document.documentElement).appendChild(s)
})()
