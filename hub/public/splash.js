// Rosemont Games — shared brand splash.
// Served by the hub at /splash.js and loaded synchronously right after <body>
// on every page (hub + each game), replacing per-game loading screens so the
// whole platform opens the same way.
//
// Timeline (~2.6s): "ROSEMONT GAMES" tracks in on the brand-red field and
// collapses into the center; the field goes dark and the site logo (red R
// tile, white letter) pops in; then the logo FLIES to the header's brand mark
// (measured at runtime) and docks onto it as the overlay turns transparent,
// revealing the page. Pages without a header mark (e.g. UNO's lobby) fall
// back to a recede-and-fade. Skipped for prefers-reduced-motion.
(function () {
  try {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Skip the intro when hopping back to the hub from inside the platform
    // (e.g. the "← Hub" links in games) — it should only greet arrivals,
    // not punctuate every internal hop.
    if (document.referrer) {
      var ref = new URL(document.referrer);
      var here = location.pathname.replace(/index\.html$/, '');
      if (ref.origin === location.origin && (here === '/' || here === '') &&
          ref.pathname.replace(/index\.html$/, '') !== here) return;
    }
  } catch (e) {}
  if (document.getElementById('rg-splash')) return;

  // Hub load-in cascade waits for the splash via this class (see catalog.css).
  document.documentElement.classList.add('splash-on');

  var css =
    '#rg-splash{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;' +
      'background:#d11f2d;pointer-events:none;' +
      'animation:rgsBgShift .45s ease 1.05s forwards,rgsBgOut .45s ease 1.9s forwards;' +
      "font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;}" +
    '#rg-splash .rgs-word{color:#fff;font-size:clamp(26px,6.5vw,64px);font-weight:800;' +
      'letter-spacing:.18em;white-space:nowrap;text-shadow:0 2px 24px rgba(0,0,0,.25);' +
      'animation:rgsWordIn .85s cubic-bezier(.16,1,.3,1) both,' +
      'rgsWordCollapse .45s cubic-bezier(.55,0,.85,.4) 1.05s forwards;}' +
    '#rg-splash .rgs-mark{position:absolute;width:64px;height:84px;border-radius:10px;' +
      'background:#d11f2d;color:#fff;display:grid;place-items:center;' +
      'font-size:34px;font-weight:900;box-shadow:0 12px 44px rgba(209,31,45,.5);opacity:0;' +
      'animation:rgsMarkIn .5s cubic-bezier(.34,1.56,.64,1) 1.3s both;}' +
    '#rg-splash .rgs-mark.rgs-dock{transition:transform .55s cubic-bezier(.3,.8,.3,1),' +
      'box-shadow .55s ease,border-radius .55s ease;box-shadow:0 2px 10px rgba(209,31,45,.35);}' +
    '#rg-splash .rgs-mark.rgs-fade{transition:transform .5s ease,opacity .5s ease;}' +
    '@keyframes rgsBgShift{to{background:#0a0a0a;}}' +
    '@keyframes rgsBgOut{from{background:#0a0a0a;}to{background:rgba(10,10,10,0);}}' +
    '@keyframes rgsWordIn{from{opacity:0;letter-spacing:.55em;transform:translateY(12px);}}' +
    '@keyframes rgsWordCollapse{to{transform:scale(.1);opacity:0;letter-spacing:0;filter:blur(2px);}}' +
    '@keyframes rgsMarkIn{from{opacity:0;transform:scale(2.3);}to{opacity:1;transform:scale(1);}}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var el = document.createElement('div');
  el.id = 'rg-splash';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="rgs-word">ROSEMONT&nbsp;GAMES</div><div class="rgs-mark">R</div>';
  document.body.appendChild(el);

  // Fly the logo to the page's header brand mark, if it has one on screen.
  setTimeout(function () {
    var mark = el.querySelector('.rgs-mark');
    if (!mark) return;
    // Kill the pop-in animation so its fill-mode stops overriding inline styles.
    mark.style.animation = 'none';
    mark.style.opacity = '1';
    var target = document.querySelector('.brand .mark');
    var r = target ? target.getBoundingClientRect() : null;
    if (r && r.width > 0 && r.top >= 0 && r.top < window.innerHeight) {
      // Hide the real mark while its stand-in flies over, so there's only
      // ever one logo on screen; restore it the moment the splash is dropped.
      target.style.visibility = 'hidden';
      setTimeout(function () { target.style.visibility = ''; }, 2600 - 1900);
      var m = mark.getBoundingClientRect();
      var dx = (r.left + r.width / 2) - (m.left + m.width / 2);
      var dy = (r.top + r.height / 2) - (m.top + m.height / 2);
      mark.classList.add('rgs-dock');
      mark.style.transform =
        'translate(' + dx + 'px,' + dy + 'px) scale(' + (r.width / m.width) + ',' + (r.height / m.height) + ')';
    } else {
      mark.classList.add('rgs-fade');
      mark.style.transform = 'scale(.55)';
      mark.style.opacity = '0';
    }
  }, 1900);

  // Drop the overlay once the logo has docked and the field is transparent.
  setTimeout(function () {
    try { el.remove(); style.remove(); } catch (e) {}
  }, 2600);
})();
