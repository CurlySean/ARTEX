/* Byte-preserving display/edit helpers; usable in the browser and node:test. */
(function (root) {
  "use strict";
  const utf8 = new TextEncoder();
  function latin1(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 32768) out += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return out;
  }
  function encoding(bytes) {
    try { new TextDecoder("utf-8", {fatal: true}).decode(bytes); return "utf8"; }
    catch (_) { return "latin1"; }
  }
  function decode(bytes, enc = encoding(bytes)) {
    return enc === "utf8" ? new TextDecoder("utf-8", {ignoreBOM: true}).decode(bytes) : latin1(bytes);
  }
  const normalize = text => text.replace(/\r\n?/g, "\n");
  function encode(text, enc) {
    if (enc === "utf8") return utf8.encode(text);
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) > 255) throw new Error("原报文包含非 UTF-8 字节，不能直接混入 Unicode；请先切换为 UTF-8 报文。");
      out[i] = text.charCodeAt(i);
    }
    return out;
  }
  function split(bytes) {
    const raw = latin1(bytes);
    let at = raw.indexOf("\r\n\r\n"), size = 4;
    if (at < 0) { at = raw.indexOf("\n\n"); size = 2; }
    return at < 0 ? {head: bytes, body: new Uint8Array(), separator: false}
      : {head: bytes.slice(0, at), body: bytes.slice(at + size), separator: true};
  }
  function concat(...arrays) {
    const result = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0));
    let offset = 0;
    arrays.forEach(a => { result.set(a, offset); offset += a.length; });
    return result;
  }
  function edit(original, text) {
    const enc = encoding(original);
    const normalized = normalize(text);
    if (normalized === normalize(decode(original, enc))) return original.slice();
    const at = normalized.indexOf("\n\n");
    if (at < 0) return encode(normalized.replace(/\n/g, "\r\n"), enc);
    const head = encode(normalized.slice(0, at).replace(/\n/g, "\r\n"), enc);
    const before = split(original), bodyText = normalized.slice(at + 2);
    // Editing headers must not transcode or normalize an untouched binary body.
    const body = bodyText === normalize(decode(before.body, enc)) ? before.body : encode(bodyText, enc);
    return concat(head, utf8.encode("\r\n\r\n"), body);
  }
  function fixContentLength(bytes) {
    const parts = split(bytes);
    if (!parts.separator || !parts.body.length) return bytes.slice();
    const head = latin1(parts.head);
    const fixed = head.replace(/(^|\r?\n)(content-length:)[^\r\n]*/i, (_, lead, key) => lead + key + " " + parts.body.length);
    if (head === fixed) return bytes.slice();
    return concat(encode(fixed, "latin1"), utf8.encode("\r\n\r\n"), parts.body);
  }
  function b64encode(bytes) {
    if (typeof btoa === "function") return btoa(latin1(bytes));
    return Buffer.from(bytes).toString("base64");
  }
  function b64decode(text) {
    if (typeof atob === "function") return Uint8Array.from(atob(text), c => c.charCodeAt(0));
    return new Uint8Array(Buffer.from(text, "base64"));
  }
  function hex(bytes) {
    const lines = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const row = bytes.subarray(i, i + 16);
      const pairs = Array.from(row, n => n.toString(16).padStart(2, "0"));
      const numbers = pairs.slice(0, 8).join(" ").padEnd(23) + "  " + pairs.slice(8).join(" ").padEnd(23);
      const chars = Array.from(row, n => n >= 32 && n < 127 ? String.fromCharCode(n) : ".").join("");
      lines.push(i.toString(16).padStart(8, "0") + "  " + numbers + "  " + chars);
    }
    return lines.join("\n");
  }
  const api = {latin1, encoding, decode, encode, normalize, split, concat, edit, fixContentLength, b64encode, b64decode, hex};
  root.WeburpBytes = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
