import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() { const secret = process.env.INTEGRATION_ENCRYPTION_KEY; if (!secret || secret.length < 32) throw new Error("INTEGRATION_ENCRYPTION_KEY deve ter ao menos 32 caracteres."); return Buffer.from(secret.slice(0, 32)); }
export function encryptConnectionSecret(value: string) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv); return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64"); }
export function decryptConnectionSecret(value: string) { const raw = Buffer.from(value, "base64"); const iv = raw.subarray(0, 12); const tag = raw.subarray(raw.length - 16); const decipher = createDecipheriv("aes-256-gcm", key(), iv); return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8"); }
