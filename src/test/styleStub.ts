// Jest stub for CSS/SCSS module imports.
// Returns a Proxy so any `s.foo` access yields the literal string 'foo',
// which is enough for class-name assertions in unit tests.
const handler: ProxyHandler<Record<string, string>> = {
  get: (_target, prop) => (typeof prop === 'string' ? prop : ''),
};

const styleProxy = new Proxy({}, handler);
export default styleProxy;
