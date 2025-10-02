import { describe, expect, it } from "vitest";
import { verifyDiscordSignature } from "../src/lib/discord/verifySignature";

const encoder = new TextEncoder();

function toHex(data: ArrayBuffer | Uint8Array): string {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("verifyDiscordSignature", () => {
	it("returns true for a valid Ed25519 signature", async () => {
		const { publicKey, privateKey } = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
			"sign",
			"verify",
		])) as CryptoKeyPair;
		const publicKeyHex = toHex((await crypto.subtle.exportKey("raw", publicKey)) as ArrayBuffer);

		const body = JSON.stringify({ type: 2, data: { name: "progress" } });
		const timestamp = "1730467200"; // 2025-11-01T00:00:00Z equivalent epoch seconds
		const message = encoder.encode(timestamp + body);
		const signatureHex = toHex(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, message));

		const result = await verifyDiscordSignature({
			signature: signatureHex,
			timestamp,
			publicKey: publicKeyHex,
			rawBody: body,
		});

		expect(result).toBe(true);
	});

	it("returns false for an invalid signature", async () => {
		const { publicKey, privateKey } = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
			"sign",
			"verify",
		])) as CryptoKeyPair;
		const publicKeyHex = toHex((await crypto.subtle.exportKey("raw", publicKey)) as ArrayBuffer);

		const body = JSON.stringify({ type: 2, data: { name: "progress" } });
		const timestamp = "1730467200";
		const message = encoder.encode(timestamp + body);
		const signatureBytes = new Uint8Array(
			await crypto.subtle.sign({ name: "Ed25519" }, privateKey, message),
		);
		signatureBytes[0] = signatureBytes[0] ^ 0b00000001; // flip a bit to invalidate the signature
		const tamperedSignatureHex = toHex(signatureBytes);

		const result = await verifyDiscordSignature({
			signature: tamperedSignatureHex,
			timestamp,
			publicKey: publicKeyHex,
			rawBody: body,
		});

		expect(result).toBe(false);
	});

	it("returns false when required fields are missing", async () => {
		const result = await verifyDiscordSignature({
			signature: "",
			timestamp: "",
			publicKey: "",
			rawBody: "{}",
		});

		expect(result).toBe(false);
	});
});
