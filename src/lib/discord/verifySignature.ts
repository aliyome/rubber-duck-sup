const encoder = new TextEncoder();

function hexToUint8Array(hex: string): Uint8Array {
	const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
	if (normalized.length % 2 !== 0) {
		throw new Error("Hex string must have an even length");
	}
	const array = new Uint8Array(normalized.length / 2);
	for (let i = 0; i < array.length; i++) {
		const byte = normalized.slice(i * 2, i * 2 + 2);
		array[i] = Number.parseInt(byte, 16);
	}
	return array;
}

async function importPublicKey(publicKeyHex: string): Promise<CryptoKey> {
	const rawKey = hexToUint8Array(publicKeyHex);
	try {
		return await crypto.subtle.importKey("raw", rawKey, { name: "Ed25519" }, false, ["verify"]);
	} catch (_error) {
		const alg = {
			name: "NODE-ED25519",
			namedCurve: "NODE-ED25519",
		} as SubtleCryptoImportKeyAlgorithm;
		return await crypto.subtle.importKey("raw", rawKey, alg, false, ["verify"]);
	}
}

function toUint8Array(data: string | ArrayBuffer | Uint8Array): Uint8Array {
	if (typeof data === "string") {
		return encoder.encode(data);
	}
	if (data instanceof Uint8Array) {
		return data;
	}
	return new Uint8Array(data);
}

function buildMessageBytes(
	timestamp: string,
	rawBody: string | ArrayBuffer | Uint8Array,
): Uint8Array {
	const timestampBytes = encoder.encode(timestamp);
	const bodyBytes = toUint8Array(rawBody);
	const messageBytes = new Uint8Array(timestampBytes.length + bodyBytes.length);
	messageBytes.set(timestampBytes, 0);
	messageBytes.set(bodyBytes, timestampBytes.length);
	return messageBytes;
}

export interface VerifyDiscordSignatureInput {
	signature: string;
	timestamp: string;
	publicKey: string;
	rawBody: string | ArrayBuffer | Uint8Array;
}

/**
 * Verify a Discord interaction request signature.
 */
export async function verifyDiscordSignature({
	signature,
	timestamp,
	publicKey,
	rawBody,
}: VerifyDiscordSignatureInput): Promise<boolean> {
	if (!signature || !timestamp || !publicKey) {
		return false;
	}

	try {
		const key = await importPublicKey(publicKey);
		const signatureBytes = hexToUint8Array(signature);
		const messageBytes = buildMessageBytes(timestamp, rawBody);
		return await crypto.subtle.verify({ name: "Ed25519" }, key, signatureBytes, messageBytes);
	} catch {
		return false;
	}
}
