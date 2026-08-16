import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportJWK, generateKeyPair } from "jose";

const outputDirectory = path.join(process.cwd(), ".crewboard-secrets");
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
const kid = randomUUID();
const privateJwk = {
  ...(await exportJWK(privateKey)),
  kid,
  alg: "ES256",
  use: "sig",
};
const publicJwk = {
  ...(await exportJWK(publicKey)),
  kid,
  alg: "ES256",
  use: "sig",
};

const privateKeyPath = path.join(outputDirectory, "connector-private.jwk.json");
const publicKeyPath = path.join(outputDirectory, "connector-public.jwk.json");
const pepperPath = path.join(outputDirectory, "pairing-pepper.txt");

const options = { encoding: "utf8", mode: 0o600, flag: "wx" };
try {
  await writeFile(privateKeyPath, `${JSON.stringify(privateJwk)}\n`, options);
  await writeFile(publicKeyPath, `${JSON.stringify(publicJwk, null, 2)}\n`, options);
  await writeFile(pepperPath, `${randomBytes(32).toString("base64url")}\n`, options);
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
    throw new Error(
      "Connector secrets already exist. Move the .crewboard-secrets folder before rotating keys.",
    );
  }
  throw error;
}

console.log("Generated connector secrets without printing their values.");
console.log(`Private signing key: ${privateKeyPath}`);
console.log(`Public verification key: ${publicKeyPath}`);
console.log(`Pairing pepper: ${pepperPath}`);
console.log("Follow README.md to import and upload them securely.");
