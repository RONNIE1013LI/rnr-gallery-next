// Synthetic authenticator for tests only. Production verification is exclusively
// performed by SimpleWebAuthn through the Better Auth Passkey plugin.
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

export function syntheticAuthenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const idBytes = randomBytes(32);
  const id = idBytes.toString("base64url");
  let counter = 0;
  const hash = (value: string | Buffer) => createHash("sha256").update(value).digest();
  function data(rpId: string, flags: number) {
    const count = Buffer.alloc(4); count.writeUInt32BE(counter++);
    return Buffer.concat([hash(rpId), Buffer.from([flags]), count]);
  }
  return {
    register(challenge: string, origin: string, rpId: string, verified = true) {
      const client = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin, crossOrigin: false }));
      const length = Buffer.alloc(2); length.writeUInt16BE(idBytes.length);
      const cose = new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]);
      const authData = Buffer.concat([data(rpId, verified ? 0x45 : 0x41), Buffer.alloc(16), length, idBytes, isoCBOR.encode(cose)]);
      const attestation = isoCBOR.encode(new Map<string, string | Map<never, never> | Uint8Array>([["fmt", "none"], ["attStmt", new Map<never, never>()], ["authData", authData]]));
      return { id, rawId: id, type: "public-key" as const, clientExtensionResults: {}, response: { clientDataJSON: client.toString("base64url"), attestationObject: Buffer.from(attestation).toString("base64url"), transports: ["internal" as const] } };
    },
    authenticate(challenge: string, origin: string, rpId: string, verified = true) {
      const client = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin, crossOrigin: false }));
      const authData = data(rpId, verified ? 5 : 1);
      return { id, rawId: id, type: "public-key" as const, clientExtensionResults: {}, response: { clientDataJSON: client.toString("base64url"), authenticatorData: authData.toString("base64url"), signature: sign("sha256", Buffer.concat([authData, hash(client)]), privateKey).toString("base64url") } };
    },
  };
}
