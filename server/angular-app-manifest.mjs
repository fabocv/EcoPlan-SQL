
export default {
  bootstrap: () => import('./main.server.mjs').then(m => m.default),
  inlineCriticalCss: true,
  baseHref: '/EcoPlan/',
  locale: undefined,
  routes: [
  {
    "renderMode": 2,
    "redirectTo": "/EcoPlan/dash",
    "route": "/EcoPlan"
  },
  {
    "renderMode": 2,
    "route": "/EcoPlan/dash"
  }
],
  entryPointToBrowserMapping: undefined,
  assets: {
    'index.csr.html': {size: 5073, hash: '2caf194c84622158e5fa3f3083f6e834c98981701c49e769d84f84070c5beed6', text: () => import('./assets-chunks/index_csr_html.mjs').then(m => m.default)},
    'index.server.html': {size: 953, hash: '9779da14c22b5ddf86560d81f99b5a512024e88796dd81688d9dde70ffe36912', text: () => import('./assets-chunks/index_server_html.mjs').then(m => m.default)},
    'dash/index.html': {size: 18753, hash: 'ff06c934185296a11b0264792c91aec25abc036a45551a81f62a15fc983fb472', text: () => import('./assets-chunks/dash_index_html.mjs').then(m => m.default)},
    'styles-BND3Z56T.css': {size: 16686, hash: 'rhP9SihOZBU', text: () => import('./assets-chunks/styles-BND3Z56T_css.mjs').then(m => m.default)}
  },
};
