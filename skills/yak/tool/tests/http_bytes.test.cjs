const {test} = require('node:test');
const assert = require('node:assert/strict');
const B = require('../assets/yakit/http-bytes.js');
const enc = s => new TextEncoder().encode(s);

test('未编辑的 UTF-8、CRLF、二进制报文逐字节保留', () => {
  for (const bytes of [enc('POST /中文 HTTP/1.1\r\nHost: localhost\r\n\r\n你好\r\n'),
    B.concat(enc('POST / HTTP/1.1\r\nHost: localhost\r\n\r\n'),new Uint8Array([0,255,128,13,10,13]))]) {
    assert.deepEqual(B.edit(bytes,B.normalize(B.decode(bytes))),bytes);
    assert.deepEqual(B.b64decode(B.b64encode(bytes)),bytes);
  }
});
test('只编辑请求头时不改动二进制体与换行', () => {
  const body = new Uint8Array([0,255,128,13,10,13,10,65]);
  const before = B.concat(enc('POST / HTTP/1.1\r\nHost: old\r\n\r\n'),body);
  const after = B.edit(before,B.normalize(B.decode(before)).replace('Host: old','Host: new'));
  assert.deepEqual(B.split(after).body,body);
  assert.match(B.latin1(B.split(after).head),/Host: new/);
});
test('Unicode 请求体的 Content-Length 使用字节数', () => {
  const before = enc('POST / HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1\r\n\r\n你好');
  const after = B.fixContentLength(before);
  assert.match(B.latin1(B.split(after).head),/Content-Length: 6/);
  assert.deepEqual(B.split(after).body,enc('你好'));
});
test('空请求体和无 Content-Length 报文保持原样', () => {
  for(const text of ['GET / HTTP/1.1\r\nHost: localhost\r\n\r\n','POST / HTTP/1.1\r\n\r\nabc']) {
    assert.deepEqual(B.fixContentLength(enc(text)),enc(text));
  }
});
test('Latin-1 报文不静默截断 Unicode 编辑', () => {
  const original = new Uint8Array([255,10,10,65]);
  assert.throws(()=>B.edit(original,'中文\n\nA'),/Unicode/);
});
test('UTF-8 BOM 与 Hex 的二进制边界保留', () => {
  const original = new Uint8Array([239,187,191,65]);
  assert.deepEqual(B.edit(original,B.decode(original)),original);
  assert.match(B.hex(new Uint8Array([0,65,255])),/00 41 ff/);
  assert.match(B.hex(new Uint8Array([0,65,255])),/\.A\./);
});
