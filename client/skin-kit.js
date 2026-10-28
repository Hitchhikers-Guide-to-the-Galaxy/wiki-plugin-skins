/* skin-kit.js — the Skin Contract in code.
 *
 *   The page is the truth; the skin is a lens.
 *
 * A skin is any web page that reads a lineup of wiki pages and draws them its
 * own way. This kit gives every skin the same three doors:
 *
 *   READ    SkinKit.onLineup(fn)       the lineup from the address, now and on change
 *           SkinKit.fetchPage(site, slug)
 *   RENDER  SkinKit.renderPage(page, site)   or renderItem / resolveLinks / markdown
 *   RETURN  SkinKit.returnAction(site, slug, action)   a journaled edit, never an overwrite
 *
 * plus SkinKit.mountSwitcher(el) — the "Skin" dropdown — and SkinKit.wear(),
 * which hosts a guest skin in a sandbox.
 *
 * It is a plain script (not a module) so a guest skin inside a sandboxed iframe
 * can load it with one <script src> tag. Load it with:
 *   <script src="/plugins/skins/skin-kit.js"></script>
 */
;(function () {
  if (window.SkinKit) return

  // ── where am I? ──────────────────────────────────────────────────────────
  // A guest skin runs in a sandboxed iframe with an opaque ("null") origin:
  // it cannot read cookies or write, so it asks its host for everything.
  var guest = false
  try { guest = window.parent !== window && String(window.origin) === 'null' } catch (e) { guest = true }

  var home = guest ? '' : location.host          // the wiki site this skin is served from
  var current = []                               // the lineup, [{site, slug}]
  var listeners = []
  var skinsFromHost = null

  // ── small helpers ────────────────────────────────────────────────────────
  function esc (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    })
  }
  // The same slug rule as the classic client: spaces to dashes, drop the rest.
  function asSlug (title) {
    return String(title).replace(/\s/g, '-').replace(/[^A-Za-z0-9-]/g, '').toLowerCase()
  }
  function local (site) { return /(^|\.)(localhost|local|test)(:\d+)?$/.test(site) || /^[\d.]+(:\d+)?$/.test(site) }
  function siteUrl (site, path, other) {
    if (!site || site === home || site === 'view' || site === 'origin') return path
    var proto = local(site) ? 'http:' : 'https:'
    if (other) proto = proto === 'http:' ? 'https:' : 'http:'
    return proto + '//' + site + path
  }

  // ── READ ─────────────────────────────────────────────────────────────────
  // The lineup is the address: "/view/a/site.org/b" means page a from this
  // site, then page b from site.org. Skins carry it in the URL hash.
  function readLineup (text) {
    var s = String(text == null ? location.hash || location.pathname : text)
    s = s.replace(/^#/, '').replace(/[?#].*$/, '')
    var parts = s.split('/').filter(Boolean)
    var out = []
    for (var i = 0; i + 1 < parts.length; i += 2) {
      var loc = parts[i]
      if (loc === 'local') continue                // browser-only drafts: not readable here
      out.push({ site: (loc === 'view' || loc === 'origin') ? home : loc, slug: parts[i + 1] })
    }
    return out
  }
  function lineupPath (lineup) {
    var list = lineup || current
    if (!list.length) return '/view/welcome-visitors'
    return list.map(function (p) {
      return '/' + (!p.site || p.site === home ? 'view' : p.site) + '/' + p.slug
    }).join('')
  }
  // Clicking a link in column i keeps columns 0..i and adds the new page,
  // which is how the classic lineup behaves.
  function nextLineup (lineup, fromIndex, page) {
    var keep = fromIndex == null || fromIndex < 0 ? lineup.slice() : lineup.slice(0, fromIndex + 1)
    return keep.concat([page])
  }

  function onLineup (fn) {
    listeners.push(fn)
    if (!guest || current.length) fn(current.slice())
  }
  function setLineup (list) {
    current = list
    listeners.forEach(function (fn) { try { fn(current.slice()) } catch (e) { console.error('[skin-kit] onLineup', e) } })
  }
  function navigate (lineup) {
    var path = lineupPath(lineup)
    if (guest) return ask('navigate', { lineup: path })
    if (location.hash.replace(/^#/, '') === path) return
    location.hash = path                           // hashchange → setLineup
  }

  // One page from one site. Remote sites are fetched over CORS, which every
  // federated wiki allows for page json.
  function fetchPage (site, slug) {
    if (guest) return ask('fetch', { site: site, slug: slug }).then(function (r) { return r.page })
    var mine = !site || site === home
    function get (other) { return fetch(siteUrl(site, '/' + slug + '.json', other), { credentials: mine ? 'same-origin' : 'omit' }) }
    return get(false).catch(function (e) { if (mine) throw e; return get(true) })
      .then(function (res) {
        if (!res.ok) throw new Error(res.status + ' for ' + slug + ' on ' + (site || home))
        return res.json()
      })
  }
  // Try each site in turn — the page's own site first, then home.
  function findPage (slug, sites) {
    var list = (sites || []).concat([home]).filter(function (s, i, a) { return a.indexOf(s) === i })
    var i = 0
    function next (err) {
      if (i >= list.length) return Promise.reject(err || new Error('not found: ' + slug))
      var site = list[i++]
      return fetchPage(site, slug).then(function (page) { return { site: site, page: page } }, next)
    }
    return next()
  }

  // ── RENDER ───────────────────────────────────────────────────────────────
  // A page's context is the sites a link on it may point to, in the order the
  // classic client tries them: its own site, then the sites in its journal
  // (newest first), then the sites its reference items name.
  function pageContext (page, site) {
    var list = [site || home]
    ;(page.journal || []).slice().reverse().forEach(function (a) { if (a.site) list.push(a.site) })
    ;(page.story || []).forEach(function (i) { if (i.type === 'reference' && i.site) list.push(i.site) })
    return list.filter(function (s, i, a) { return s && a.indexOf(s) === i })
  }
  function resolveLinks (text, site, context) {
    var s = esc(text)
    var ctx = esc((context || [site || home]).join(' '))
    s = s.replace(/\[\[([^\]]+)\]\]/g, function (m, title) {
      return '<a class="internal" data-skin-link href="#" data-slug="' + asSlug(title) + '" data-site="' + esc(site || home) +
        '" data-context="' + ctx + '" title="' + esc(title) + '">' + title + '</a>'
    })
    s = s.replace(/\[((?:https?:\/\/|\/)[^\s\]]+)\s+([^\]]+)\]/g, function (m, url, label) {
      return '<a class="external" href="' + url + '" target="_blank" rel="noopener">' + label + '</a>'
    })
    return s
  }
  function inline (text, site, context) {
    return resolveLinks(text, site, context)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  }
  // Enough markdown for wiki pages: headings, lists, task boxes, quotes, code.
  function markdown (text, site, context) {
    var html = '', list = false, code = null
    function close () { if (list) { html += '</ul>'; list = false } }
    String(text || '').split('\n').forEach(function (raw) {
      var line = raw.replace(/\s+$/, ''), m
      if (/^```/.test(line)) {
        if (code === null) { close(); code = '' } else { html += '<pre>' + esc(code) + '</pre>'; code = null }
        return
      }
      if (code !== null) { code += raw + '\n'; return }
      if ((m = line.match(/^(#{1,3})\s+(.*)/))) { close(); html += '<h' + (m[1].length + 1) + '>' + inline(m[2], site, context) + '</h' + (m[1].length + 1) + '>'; return }
      if ((m = line.match(/^[-*]\s+\[( |x)\]\s+(.*)/i))) {
        if (!list) { html += '<ul class="tasks">'; list = true }
        html += '<li><input type="checkbox" disabled' + (m[1] === ' ' ? '' : ' checked') + '> ' + inline(m[2], site, context) + '</li>'; return
      }
      if ((m = line.match(/^[-*]\s+(.*)/))) { if (!list) { html += '<ul>'; list = true } html += '<li>' + inline(m[1], site, context) + '</li>'; return }
      if ((m = line.match(/^>\s?(.*)/))) { close(); html += '<blockquote>' + inline(m[1], site, context) + '</blockquote>'; return }
      if (/^---+$/.test(line)) { close(); html += '<hr>'; return }
      if (line === '') { close(); return }
      close(); html += '<p>' + inline(line, site, context) + '</p>'
    })
    if (code !== null) html += '<pre>' + esc(code) + '</pre>'
    close()
    return html
  }
  function assetUrl (url, site) {
    if (!url) return ''
    if (/^(https?:|data:)/.test(url)) return url
    return siteUrl(site, url.charAt(0) === '/' ? url : '/' + url)
  }
  function stripTags (html) {
    var t = document.createElement('template')
    t.innerHTML = String(html || '')
    return t.content.textContent || ''
  }

  // Core item types are drawn here. Any other type gets a quiet labelled box,
  // so a skin never breaks on a plugin it does not know.
  function renderItem (item, site, context) {
    var t = item.type, text = item.text || ''
    var open = '<div class="item ' + esc(t) + '" data-id="' + esc(item.id) + '">'
    var body
    if (t === 'paragraph') body = '<p>' + inline(text, site, context) + '</p>'
    else if (t === 'markdown') body = markdown(text, site, context)
    else if (t === 'html') body = '<p>' + inline(stripTags(text), site, context) + '</p>'
    else if (t === 'code') body = '<pre>' + esc(text) + '</pre>'
    else if (t === 'image') {
      body = '<figure><img src="' + esc(assetUrl(item.url, site)) + '" alt="">' +
        (text ? '<figcaption>' + inline(text, site, context) + '</figcaption>' : '') + '</figure>'
    } else if (t === 'reference') {
      body = '<p class="reference">→ <a class="internal" data-skin-link href="#" data-slug="' + esc(item.slug) + '" data-site="' + esc(item.site || site) +
        '">' + esc(item.title || item.slug) + '</a> ' + inline(text, item.site || site) + '</p>'
    } else if (t === 'factory' || t === 'future') body = ''
    else {
      body = '<div class="unknown"><span class="type">' + esc(t) + '</span> ' + esc(stripTags(text).split('\n')[0].slice(0, 140)) + '</div>'
    }
    return body ? open + body + '</div>' : ''
  }
  function renderStory (page, site) {
    var context = pageContext(page, site)
    return (page.story || []).map(function (item) { return renderItem(item, site, context) }).join('')
  }
  function renderPage (page, site) {
    return '<h1 class="title">' + esc(page.title || '') + '</h1>' + renderStory(page, site)
  }

  // Internal links: a skin marks each column with data-lineup-index and the
  // kit turns a click into the next lineup. A skin can take over by setting
  // SkinKit.onInternalLink = function (link, index) { ... }.
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[data-skin-link]')
    if (!a) return
    ev.preventDefault()
    var col = a.closest('[data-lineup-index]')
    var index = col ? Number(col.getAttribute('data-lineup-index')) : current.length - 1
    var link = { slug: a.getAttribute('data-slug'), site: a.getAttribute('data-site') || home,
      context: (a.getAttribute('data-context') || '').split(' ').filter(Boolean) }
    if (kit.onInternalLink) return kit.onInternalLink(link, index)
    follow(link, index)
  })
  // Find which site really has the page (its context, then the sites already
  // in the lineup, then home), then add it to the lineup after column `index`.
  function follow (link, index) {
    var sites = (link.context || [link.site]).concat(current.map(function (p) { return p.site }))
    return findPage(link.slug, sites).then(
      function (found) { navigate(nextLineup(current, index, { site: found.site, slug: link.slug })) },
      function () { navigate(nextLineup(current, index, { site: link.site, slug: link.slug })) })
  }

  // ── RETURN ───────────────────────────────────────────────────────────────
  // Changes go back as journal actions — add, edit, move, remove — through the
  // same door the classic client uses. Only the site this skin is served from,
  // and only when the owner is logged in. A guest skin can only ask.
  function returnAction (site, slug, action) {
    if (guest) return ask('return', { site: site, slug: slug, action: action })
    if (site && site !== home) return Promise.reject(new Error('a skin can only write to ' + home))
    var a = Object.assign({ date: Date.now() }, action)
    return fetch('/page/' + encodeURIComponent(slug) + '/action', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=' + encodeURIComponent(JSON.stringify(a))
    }).then(function (res) {
      if (!res.ok) throw new Error('write refused (' + res.status + ') — are you logged in as the owner?')
      return { ok: true }
    })
  }

  // ── SKINS ────────────────────────────────────────────────────────────────
  // A skin is an installed plugin named skin-<id> that ships client/skin.json:
  //   {"id": "triptych", "label": "Triptych", "entry": "skin.html", "trust": "guest"}
  // Classic — the ordinary wiki client — is always first.
  var CLASSIC = { id: 'classic', label: 'Classic', trust: 'trusted', plugin: null }
  var skinsCache = null
  function listSkins () {
    if (guest) return Promise.resolve(skinsFromHost || [CLASSIC])
    if (skinsCache) return skinsCache
    skinsCache = fetch('/system/plugins.json', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : [] })
      .then(function (names) {
        var skins = (names || []).filter(function (n) { return /^skin-/.test(n) })
        return Promise.all(skins.map(function (name) {
          return fetch('/plugins/' + name + '/skin.json').then(function (res) {
            if (!res.ok) return null
            return res.json().then(function (m) {
              return { id: m.id || name.slice(5), label: m.label || name.slice(5), entry: m.entry || 'skin.html',
                trust: m.trust === 'trusted' ? 'trusted' : 'guest', about: m.about || '', plugin: name }
            })
          }).catch(function () { return null })
        }))
      })
      .then(function (found) { return [CLASSIC].concat(found.filter(Boolean)) })
      .catch(function () { return [CLASSIC] })
    return skinsCache
  }
  // Where to go to wear a skin, carrying the lineup in the hash.
  function skinUrl (skin, path) {
    path = path || lineupPath()
    if (!skin || skin.id === 'classic') return path
    if (skin.trust === 'trusted') return '/plugins/' + skin.plugin + '/' + skin.entry + '#' + path
    return '/plugins/skins/wear.html?skin=' + encodeURIComponent(skin.plugin) + '#' + path
  }
  function switchTo (skin, path) {
    if (guest) return ask('switch', { to: skin.plugin || 'classic' })
    location.assign(skinUrl(skin, path))
  }

  // The dropdown. `current` is the id of the skin being worn; `pathFn` returns
  // the lineup to carry (the classic client reads it from its own URL).
  function mountSwitcher (el, opts) {
    opts = opts || {}
    var wrap = document.createElement('label')
    wrap.className = 'skin-switcher'
    wrap.innerHTML = '<span>Skin</span> <select aria-label="Skin"><option>…</option></select>'
    el.appendChild(wrap)
    var select = wrap.querySelector('select')
    listSkins().then(function (skins) {
      select.innerHTML = skins.map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (s.id === (opts.current || 'classic') ? ' selected' : '') + '>' +
          esc(s.label) + (s.trust === 'guest' ? ' (guest)' : '') + '</option>'
      }).join('')
      select.onchange = function () {
        var skin = skins.filter(function (s) { return s.id === select.value })[0]
        switchTo(skin, opts.pathFn ? opts.pathFn() : lineupPath())
      }
    })
    return wrap
  }

  // ── GUEST ↔ HOST ─────────────────────────────────────────────────────────
  // Guest side: every request is a postMessage to the host with an id; the
  // host answers with the same id.
  var pending = {}, seq = 0
  function ask (kind, body) {
    return new Promise(function (resolve, reject) {
      var id = ++seq
      pending[id] = { resolve: resolve, reject: reject }
      window.parent.postMessage(Object.assign({ skin: kind, id: id }, body), '*')
    })
  }
  if (guest) {
    window.addEventListener('message', function (ev) {
      if (ev.source !== window.parent) return
      var m = ev.data || {}
      if (m.skin === 'lineup') {
        home = m.home
        skinsFromHost = m.skins
        setLineup(readLineup(m.lineup))
      } else if (m.skin === 'reply' && pending[m.id]) {
        var p = pending[m.id]; delete pending[m.id]
        if (m.ok) p.resolve(m) ; else p.reject(new Error(m.error || 'refused'))
      }
    })
    window.parent.postMessage({ skin: 'ready' }, '*')
  } else {
    setLineup(readLineup(location.hash ? location.hash : (/^\/(view|[^/]+\.[^/]+)\//.test(location.pathname) ? location.pathname : '')))
    window.addEventListener('hashchange', function () { setLineup(readLineup(location.hash)) })
  }

  // Host side: wear(opts) puts a guest skin in a sandboxed iframe and answers
  // its requests. Reads are served freely; a write shows the owner an
  // Allow / Deny bar first.
  function wear (opts) {
    var frame = opts.frame
    var skin = opts.skin
    function send (m) { frame.contentWindow.postMessage(m, '*') }
    function sendLineup () {
      listSkins().then(function (skins) {
        send({ skin: 'lineup', lineup: lineupPath(), home: home, skins: skins })
      })
    }
    function reply (id, ok, extra) { send(Object.assign({ skin: 'reply', id: id, ok: ok }, extra || {})) }
    window.addEventListener('message', function (ev) {
      if (ev.source !== frame.contentWindow) return
      var m = ev.data || {}
      if (m.skin === 'ready') return sendLineup()
      if (m.skin === 'fetch') {
        return fetchPage(m.site, m.slug).then(
          function (page) { reply(m.id, true, { page: page }) },
          function (e) { reply(m.id, false, { error: e.message }) })
      }
      if (m.skin === 'navigate') { navigate(readLineup(m.lineup)); return reply(m.id, true) }
      if (m.skin === 'switch') {
        return listSkins().then(function (skins) {
          switchTo(skins.filter(function (s) { return (s.plugin || 'classic') === m.to })[0] || CLASSIC)
        })
      }
      if (m.skin === 'return') {
        var ok = opts.approve ? opts.approve(skin, m) : Promise.resolve(false)
        return Promise.resolve(ok).then(function (yes) {
          if (!yes) return reply(m.id, false, { error: 'the owner said no' })
          return returnAction(m.site, m.slug, m.action).then(
            function () { reply(m.id, true) },
            function (e) { reply(m.id, false, { error: e.message }) })
        })
      }
    })
    onLineup(function () { if (frame.contentWindow) sendLineup() })
  }

  var kit = window.SkinKit = {
    version: '0.1.0',
    guest: guest,
    get home () { return home },
    get lineup () { return current.slice() },
    // read
    readLineup: readLineup, lineupPath: lineupPath, nextLineup: nextLineup,
    onLineup: onLineup, navigate: navigate, follow: follow, pageContext: pageContext, fetchPage: fetchPage, findPage: findPage, asSlug: asSlug,
    // render
    renderPage: renderPage, renderStory: renderStory, renderItem: renderItem,
    resolveLinks: resolveLinks, markdown: markdown, assetUrl: assetUrl, esc: esc,
    onInternalLink: null,
    // return
    returnAction: returnAction,
    // skins
    listSkins: listSkins, skinUrl: skinUrl, switchTo: switchTo, mountSwitcher: mountSwitcher, wear: wear
  }
})()
