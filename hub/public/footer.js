// Rosemont Games — shared site footer.
// Served by the hub at /footer.js and included by every page (hub + each game),
// so the footer stays identical everywhere. Links are root-absolute because the
// games live under /uno/ and /holdem/ on the same origin.
//
// Styling is intentionally theme-agnostic: everything derives from currentColor
// + opacity so it looks right on the hub's light/dark themes and inside the
// (dark) game UIs without depending on any app's CSS variables.
(function () {
  if (document.getElementById('rg-footer')) return;

  var COLS = [
    {
      title: 'Games',
      links: [
        ['UNO', '/uno/'],
        ['Texas Hold’em', '/holdem/'],
        ['All games', '/#catalog'],
      ],
    },
    {
      title: 'Community',
      links: [
        ['Messages', '/#community'],
        ['Friends', '/#community'],
        ['Find players', '/#community'],
      ],
    },
    {
      title: 'Account',
      links: [
        ['Sign in', '/#signin'],
        ['Play as guest', '/#signin'],
        ['Settings', '/#community'],
      ],
    },
    {
      title: 'Platform',
      links: [
        ['Game Hub', '/'],
        ['Themes', '/#community'],
        ['Live activity', '/#catalog'],
      ],
    },
  ];

  var css =
    '#rg-footer{margin-top:56px;border-top:1px solid rgba(128,128,128,.22);' +
      'padding:36px clamp(16px,5vw,48px) 26px;font-size:13px;color:inherit;}' +
    '#rg-footer .rgf-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));' +
      'gap:28px 20px;max-width:1100px;margin:0 auto;}' +
    '#rg-footer .rgf-col h4{margin:0 0 10px;font-size:12px;font-weight:600;' +
      'letter-spacing:.03em;opacity:.42;}' +
    '#rg-footer .rgf-col a{display:block;color:inherit;text-decoration:none;' +
      'opacity:.68;padding:5px 0;transition:opacity .12s;}' +
    '#rg-footer .rgf-col a:hover{opacity:1;}' +
    '#rg-footer .rgf-bottom{display:flex;justify-content:space-between;align-items:center;' +
      'gap:12px;flex-wrap:wrap;max-width:1100px;margin:30px auto 0;font-size:12px;opacity:.42;}' +
    '@media (max-width:560px){#rg-footer .rgf-cols{grid-template-columns:repeat(2,1fr);}}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var footer = document.createElement('footer');
  footer.id = 'rg-footer';

  var colsHtml = COLS.map(function (col) {
    var links = col.links.map(function (l) {
      return '<a href="' + l[1] + '">' + l[0] + '</a>';
    }).join('');
    return '<div class="rgf-col"><h4>' + col.title + '</h4>' + links + '</div>';
  }).join('');

  footer.innerHTML =
    '<div class="rgf-cols">' + colsHtml + '</div>' +
    '<div class="rgf-bottom">' +
      '<span>Rosemont Games &copy; 2026 William Wagg</span>' +
      '<span>rosemont.place</span>' +
    '</div>';

  document.body.appendChild(footer);
})();
