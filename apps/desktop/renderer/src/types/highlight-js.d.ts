declare module 'highlight.js/lib/core' {
  import hljs = require('highlight.js');
  export default hljs;
}

declare module 'highlight.js/lib/languages/*' {
  const language: (hljs?: unknown) => unknown;
  export default language;
}
