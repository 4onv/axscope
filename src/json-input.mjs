// JSON.parse silently keeps the last duplicate key. Capture evidence must not
// disappear that way, including when two spellings decode to the same key.
export function parseJsonInput(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 4 * 1024 * 1024) {
    throw new Error('JSON input exceeds the supported size.');
  }
  let at = 0;
  function fail() { throw new SyntaxError('Invalid or ambiguous JSON input.'); }
  function space() { while (at < text.length && /[\x20\t\r\n]/.test(text[at])) at++; }
  function quoted() {
    const start = at++;
    while (at < text.length) {
      if (text[at] === '\\') { at += 2; continue; }
      if (text[at++] === '"') {
        try { return JSON.parse(text.slice(start, at)); } catch { fail(); }
      }
    }
    fail();
  }
  function value(depth) {
    // Each tree level uses an object plus a children array. 300 accommodates
    // the supported 128 tree levels and envelope without unbounded recursion.
    if (depth > 300) fail();
    space();
    if (text[at] === '"') return quoted();
    if (text[at] === '{') {
      at++;
      const result = Object.create(null);
      const keys = new Set();
      space();
      if (text[at] === '}') { at++; return result; }
      while (at < text.length) {
        space();
        if (text[at] !== '"') fail();
        const key = quoted();
        if (keys.has(key)) fail();
        keys.add(key);
        space();
        if (text[at++] !== ':') fail();
        result[key] = value(depth + 1);
        space();
        if (text[at] === '}') { at++; return result; }
        if (text[at++] !== ',') fail();
      }
      fail();
    }
    if (text[at] === '[') {
      at++;
      const result = [];
      space();
      if (text[at] === ']') { at++; return result; }
      while (at < text.length) {
        result.push(value(depth + 1));
        space();
        if (text[at] === ']') { at++; return result; }
        if (text[at++] !== ',') fail();
      }
      fail();
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(at));
    if (!token) fail();
    at += token[0].length;
    const result = JSON.parse(token[0]);
    if (typeof result === 'number' && !Number.isFinite(result)) fail();
    return result;
  }
  const result = value(0);
  space();
  if (at !== text.length) fail();
  return result;
}
