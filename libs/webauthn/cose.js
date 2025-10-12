// COSE (CBOR) public key to PEM conversion (ESM)
export function coseToPem(coseKey) {
  const kty = coseKey[1];
  const alg = coseKey[3];

  // EC2 / ES256 (P-256)
  if (kty === 2 && alg === -7) {
    const x = Buffer.from(coseKey[-2]);
    const y = Buffer.from(coseKey[-3]);
    const pub = Buffer.concat([Buffer.from([0x04]), x, y]);
    const header = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
    const spki = Buffer.concat([header, pub]);
    const b64 = spki.toString('base64').match(/.{1,64}/g).join('\n');
    return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
  }

  // RSA / RS256
  if (kty === 3 && alg === -257) {
    const n = Buffer.from(coseKey[-1]);
    const e = Buffer.from(coseKey[-2]);

    function derLen(len) {
      if (len < 0x80) return Buffer.from([len]);
      const bytes = [];
      let l = len;
      while (l > 0) { bytes.unshift(l & 0xff); l >>= 8; }
      return Buffer.from([0x80 | bytes.length, ...bytes]);
    }
    function derInt(b) {
      let v = Buffer.from(b);
      if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0x00]), v]);
      return Buffer.concat([Buffer.from([0x02]), derLen(v.length), v]);
    }

    const bitString = (() => {
      const pubSeq = Buffer.concat([
        derInt(n),
        derInt(e)
      ]);
      const pubSeqWrapped = Buffer.concat([
        Buffer.from([0x30]), derLen(pubSeq.length), pubSeq
      ]);
      const bitStr = Buffer.concat([Buffer.from([0x00]), pubSeqWrapped]);
      return Buffer.concat([Buffer.from([0x03]), derLen(bitStr.length), bitStr]);
    })();

    const algId = Buffer.from('300d06092a864886f70d0101010500', 'hex'); // rsaEncryption OID
    const spkiSeq = Buffer.concat([
      Buffer.from([0x30]),
      derLen(algId.length + bitString.length),
      algId,
      bitString
    ]);

    const b64 = spkiSeq.toString('base64').match(/.{1,64}/g).join('\n');
    return `-----BEGIN PUBLIC KEY-----\n${b64}\n-----END PUBLIC KEY-----`;
  }

  throw new Error('Unsupported COSE key type');
}
