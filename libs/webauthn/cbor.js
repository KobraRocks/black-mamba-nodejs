// Minimal CBOR decoder for WebAuthn needs (ESM)
export function decodeCbor(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let offset = 0;

  function read(n) {
    const v = data.subarray(offset, offset + n);
    offset += n;
    return v;
  }

  function readUint(ai) {
    if (ai < 24) return ai;
    if (ai === 24) return data[offset++];
    if (ai === 25) { const v = (data[offset] << 8) | data[offset + 1]; offset += 2; return v; }
    if (ai === 26) { const v = data.readUInt32BE(offset); offset += 4; return v; }
    throw new Error('Unsupported integer length');
  }

  function decodeItem() {
    const ib = data[offset++];
    const major = ib >> 5;
    const ai = ib & 31;

    switch (major) {
      case 0: return readUint(ai); // positive int
      case 1: return -1 - readUint(ai); // negative int
      case 2: return Buffer.from(read(readUint(ai))); // byte string
      case 3: return Buffer.from(read(readUint(ai))).toString('utf8'); // text
      case 4: {
        const len = readUint(ai);
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(decodeItem());
        return arr;
      }
      case 5: {
        const len = readUint(ai);
        const map = {};
        for (let i = 0; i < len; i++) {
          const k = decodeItem();
          const v = decodeItem();
          map[k] = v;
        }
        return map;
      }
      default:
        throw new Error('Unsupported CBOR type: ' + major);
    }
  }

  return decodeItem();
}
