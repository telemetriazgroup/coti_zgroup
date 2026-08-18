/**
 * Codificador / decodificador XML-RPC mínimo (Odoo /xmlrpc/2).
 * Sin dependencia externa para controlar timeouts y tipos (False, nil, struct).
 */

class XmlrpcFault extends Error {
  constructor(faultCode, faultString) {
    super(String(faultString || 'XML-RPC fault'));
    this.name = 'XmlrpcFault';
    this.faultCode = faultCode;
    this.faultString = String(faultString || '');
    this.odooErrorKind = classifyOdooFault(this.faultString);
  }
}

function classifyOdooFault(faultString) {
  const s = String(faultString || '');
  if (s.includes('AccessError') || s.includes('Access Denied')) return 'AccessError';
  if (s.includes('ValidationError')) return 'ValidationError';
  if (s.includes('MissingError')) return 'MissingError';
  if (s.includes('UserError')) return 'UserError';
  if (/access denied/i.test(s)) return 'AccessError';
  return 'Fault';
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function encodeValue(v) {
  if (v === null || v === undefined) {
    return '<value><nil/></value>';
  }
  if (typeof v === 'boolean') {
    return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) {
      throw new TypeError('XML-RPC no admite números no finitos');
    }
    if (Number.isInteger(v)) {
      return `<value><int>${v}</int></value>`;
    }
    return `<value><double>${v}</double></value>`;
  }
  if (typeof v === 'string') {
    return `<value><string>${escapeXml(v)}</string></value>`;
  }
  if (v instanceof Date) {
    const iso = v.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
    return `<value><dateTime.iso8601>${iso}</dateTime.iso8601></value>`;
  }
  if (Buffer.isBuffer(v)) {
    return `<value><base64>${v.toString('base64')}</base64></value>`;
  }
  if (Array.isArray(v)) {
    return `<value><array><data>${v.map(encodeValue).join('')}</data></array></value>`;
  }
  if (typeof v === 'object') {
    const members = Object.entries(v)
      .map(([k, val]) => `<member><name>${escapeXml(k)}</name>${encodeValue(val)}</member>`)
      .join('');
    return `<value><struct>${members}</struct></value>`;
  }
  throw new TypeError(`Tipo XML-RPC no soportado: ${typeof v}`);
}

function encodeMethodCall(method, params) {
  const encoded = (params || []).map((p) => `<param>${encodeValue(p)}</param>`).join('');
  return (
    `<?xml version="1.0"?>\n` +
    `<methodCall><methodName>${escapeXml(method)}</methodName>` +
    `<params>${encoded}</params></methodCall>`
  );
}

class XmlCursor {
  constructor(xml) {
    this.s = xml;
    this.i = 0;
  }

  skipWs() {
    const m = this.s.slice(this.i).match(/^\s+/);
    if (m) this.i += m[0].length;
  }

  startsWith(prefix) {
    return this.s.startsWith(prefix, this.i);
  }

  rest() {
    return this.s.slice(this.i);
  }
}

function parseOpenTag(cur) {
  cur.skipWs();
  const m = cur.rest().match(/^<([a-zA-Z0-9._:-]+)(\s[^>]*)?(\/)?>/);
  if (!m) {
    throw new SyntaxError(`XML-RPC: se esperaba tag de apertura en pos ${cur.i}`);
  }
  cur.i += m[0].length;
  return { name: m[1], selfClosing: Boolean(m[3]) };
}

function parseCloseTag(cur, name) {
  cur.skipWs();
  const expected = `</${name}>`;
  if (!cur.startsWith(expected)) {
    throw new SyntaxError(`XML-RPC: se esperaba ${expected} en pos ${cur.i}`);
  }
  cur.i += expected.length;
}

function parseTextUntilTag(cur) {
  const idx = cur.s.indexOf('<', cur.i);
  if (idx < 0) {
    const text = cur.s.slice(cur.i);
    cur.i = cur.s.length;
    return unescapeXml(text);
  }
  const text = cur.s.slice(cur.i, idx);
  cur.i = idx;
  return unescapeXml(text);
}

function parseValue(cur) {
  cur.skipWs();
  const open = parseOpenTag(cur);
  if (open.name !== 'value') {
    throw new SyntaxError(`XML-RPC: se esperaba <value>, llegó <${open.name}>`);
  }
  if (open.selfClosing) return '';
  cur.skipWs();
  if (cur.startsWith('</value>')) {
    parseCloseTag(cur, 'value');
    return '';
  }
  if (!cur.startsWith('<')) {
    const text = parseTextUntilTag(cur);
    parseCloseTag(cur, 'value');
    return text;
  }
  const inner = parseOpenTag(cur);
  let result;
  if (inner.selfClosing && (inner.name === 'nil' || inner.name === 'ex:nil')) {
    result = null;
  } else if (inner.name === 'nil' || inner.name === 'ex:nil') {
    parseCloseTag(cur, inner.name);
    result = null;
  } else if (inner.name === 'int' || inner.name === 'i4' || inner.name === 'i8') {
    result = parseInt(parseTextUntilTag(cur).trim(), 10);
    parseCloseTag(cur, inner.name);
  } else if (inner.name === 'boolean') {
    result = parseTextUntilTag(cur).trim() === '1';
    parseCloseTag(cur, inner.name);
  } else if (inner.name === 'string') {
    result = parseTextUntilTag(cur);
    parseCloseTag(cur, inner.name);
  } else if (inner.name === 'double') {
    result = Number(parseTextUntilTag(cur).trim());
    parseCloseTag(cur, inner.name);
  } else if (inner.name === 'dateTime.iso8601') {
    result = parseTextUntilTag(cur).trim();
    parseCloseTag(cur, inner.name);
  } else if (inner.name === 'base64') {
    result = parseTextUntilTag(cur).trim();
    parseCloseTag(cur, inner.name);
  } else if (inner.name === 'array') {
    cur.skipWs();
    const dataTag = parseOpenTag(cur);
    if (dataTag.name !== 'data') {
      throw new SyntaxError('XML-RPC: array sin <data>');
    }
    const items = [];
    if (!dataTag.selfClosing) {
      for (;;) {
        cur.skipWs();
        if (cur.startsWith('</data>')) break;
        items.push(parseValue(cur));
      }
      parseCloseTag(cur, 'data');
    }
    parseCloseTag(cur, 'array');
    result = items;
  } else if (inner.name === 'struct') {
    const obj = {};
    if (!inner.selfClosing) {
      for (;;) {
        cur.skipWs();
        if (cur.startsWith('</struct>')) break;
        const mem = parseOpenTag(cur);
        if (mem.name !== 'member') {
          throw new SyntaxError('XML-RPC: struct sin <member>');
        }
        cur.skipWs();
        const nameTag = parseOpenTag(cur);
        if (nameTag.name !== 'name') {
          throw new SyntaxError('XML-RPC: member sin <name>');
        }
        const key = parseTextUntilTag(cur);
        parseCloseTag(cur, 'name');
        obj[key] = parseValue(cur);
        parseCloseTag(cur, 'member');
      }
      parseCloseTag(cur, 'struct');
    }
    result = obj;
  } else {
    throw new SyntaxError(`XML-RPC: tipo no soportado <${inner.name}>`);
  }
  parseCloseTag(cur, 'value');
  return result;
}

function decodeMethodResponse(xml) {
  const stripped = String(xml).replace(/<\?xml[^?]*\?>/, '');
  const cur = new XmlCursor(stripped);
  cur.skipWs();
  const root = parseOpenTag(cur);
  if (root.name !== 'methodResponse') {
    throw new SyntaxError('XML-RPC: raíz no es methodResponse');
  }
  cur.skipWs();
  if (cur.startsWith('<fault>')) {
    parseOpenTag(cur);
    const faultVal = parseValue(cur);
    parseCloseTag(cur, 'fault');
    parseCloseTag(cur, 'methodResponse');
    throw new XmlrpcFault(faultVal.faultCode, faultVal.faultString);
  }
  const paramsTag = parseOpenTag(cur);
  if (paramsTag.name !== 'params') {
    throw new SyntaxError('XML-RPC: methodResponse sin params/fault');
  }
  cur.skipWs();
  let result = null;
  if (!paramsTag.selfClosing && !cur.startsWith('</params>')) {
    const paramTag = parseOpenTag(cur);
    if (paramTag.name !== 'param') {
      throw new SyntaxError('XML-RPC: params sin param');
    }
    result = parseValue(cur);
    parseCloseTag(cur, 'param');
    parseCloseTag(cur, 'params');
  } else if (!paramsTag.selfClosing) {
    parseCloseTag(cur, 'params');
  }
  parseCloseTag(cur, 'methodResponse');
  return result;
}

module.exports = {
  XmlrpcFault,
  classifyOdooFault,
  encodeValue,
  encodeMethodCall,
  decodeMethodResponse,
};
