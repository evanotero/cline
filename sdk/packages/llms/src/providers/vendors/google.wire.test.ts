// Wire-contract tests for Google (Gemini API and Vertex AI) client
// identification, exercised through the *real* `@ai-sdk/google` and
// `@ai-sdk/google-vertex` packages with a stubbed fetch. They pin down what
// actually goes out on the wire when the headers produced by
// `resolveProviderRequestHeaders` are handed to the vendor modules:
//
//   1. `User-Agent` starts with `Cline/<ver>` and the AI SDK still appends its
//      own `ai-sdk/...` token (SDK attribution is preserved, not replaced);
//   2. `X-Goog-Api-Client` carries `cline/<ver>`;
//   3. `X-Session-Id` / `x-session-affinity` carry the session (task) ID.
import type {
	LanguageModelV4CallOptions,
	LanguageModelV4Prompt,
} from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { resolveProviderRequestHeaders } from "../request-headers";
import { createGoogleProviderModule } from "./google";
import { createVertexProviderModule } from "./vertex";

const SSE_BODY = `data: ${JSON.stringify({
	candidates: [
		{
			content: { role: "model", parts: [{ text: "hi" }] },
			finishReason: "STOP",
		},
	],
	usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
})}\n\n`;

const PROMPT: LanguageModelV4Prompt = [
	{ role: "user", content: [{ type: "text", text: "hello" }] },
];

function resolveHeaders(providerId: string, sessionId: string) {
	return resolveProviderRequestHeaders({
		providerId,
		sessionId,
		source: "core",
		defaultSource: "core",
		client: { name: "VSCode Extension", version: "3.40.0" },
		coreVersion: "0.2.0",
	});
}

function context(providerId: string): GatewayProviderContext {
	return {
		provider: {
			id: providerId,
			name: providerId,
			defaultModelId: "gemini-2.5-pro",
			models: [],
		},
		model: {
			providerId,
			id: "gemini-2.5-pro",
			name: "Gemini 2.5 Pro",
		},
	} as unknown as GatewayProviderContext;
}

async function captureRequestHeaders(
	create: (
		config: GatewayResolvedProviderConfig,
		context: GatewayProviderContext,
	) => Promise<{
		operations: {
			language: (modelId: string) => {
				doStream: (options: LanguageModelV4CallOptions) => Promise<unknown>;
			};
		};
	}>,
	config: Omit<GatewayResolvedProviderConfig, "fetch">,
): Promise<Headers[]> {
	const captured: Headers[] = [];
	const fetchStub = (async (_input, init) => {
		captured.push(new Headers(init?.headers));
		return new Response(SSE_BODY, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}) as typeof fetch;

	const module = await create(
		{ ...config, fetch: fetchStub } as GatewayResolvedProviderConfig,
		context(config.providerId),
	);
	await module.operations
		.language("gemini-2.5-pro")
		.doStream({ prompt: PROMPT } as LanguageModelV4CallOptions);
	return captured;
}

describe("google wire contract: client identification headers", () => {
	it("sends Cline identification and session headers to the Gemini API", async () => {
		const [headers] = await captureRequestHeaders(createGoogleProviderModule, {
			providerId: "gemini",
			apiKey: "test-api-key",
			headers: resolveHeaders("gemini", "01JTASKULID"),
		});

		expect(headers.get("user-agent")).toMatch(
			/^Cline\/3\.40\.0 .*ai-sdk\/google\//,
		);
		expect(headers.get("x-goog-api-client")).toBe("cline/3.40.0");
		expect(headers.get("x-session-id")).toBe("01JTASKULID");
		expect(headers.get("x-session-affinity")).toBe("01JTASKULID");
		expect(headers.get("x-goog-api-key")).toBe("test-api-key");
	});

	it("sends Cline identification and session headers to Vertex AI Gemini models", async () => {
		const [headers] = await captureRequestHeaders(createVertexProviderModule, {
			providerId: "vertex",
			apiKey: "test-api-key",
			headers: resolveHeaders("vertex", "01JTASKULID"),
		});

		expect(headers.get("user-agent")).toMatch(/^Cline\/3\.40\.0 .*ai-sdk\//);
		expect(headers.get("x-goog-api-client")).toBe("cline/3.40.0");
		expect(headers.get("x-session-id")).toBe("01JTASKULID");
		expect(headers.get("x-session-affinity")).toBe("01JTASKULID");
	});
});
