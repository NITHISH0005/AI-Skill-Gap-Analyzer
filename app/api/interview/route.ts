import { createClient } from "@/lib/supabase/server";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_REQUEST_TIMEOUT_MS = Number(process.env.OLLAMA_REQUEST_TIMEOUT_MS ?? "45000");
const OLLAMA_MODEL_DISCOVERY_TIMEOUT_MS = Number(process.env.OLLAMA_MODEL_DISCOVERY_TIMEOUT_MS ?? "10000");
const PREFERRED_MODELS = ["orca-mini", "neural-chat", "mistral", "llama2", "dolphin-mixtral"];
const MAX_HISTORY_MESSAGES = Number(process.env.INTERVIEW_MAX_HISTORY_MESSAGES ?? "8");
const MAX_MESSAGE_CHARS = Number(process.env.INTERVIEW_MAX_MESSAGE_CHARS ?? "1200");
const INTERVIEW_MAX_TOKENS = Number(process.env.INTERVIEW_MAX_TOKENS ?? "180");

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = OLLAMA_REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getAvailableModel(): Promise<string> {
  try {
    const res = await fetchWithTimeout(
      `${OLLAMA_BASE_URL}/api/tags`,
      {},
      OLLAMA_MODEL_DISCOVERY_TIMEOUT_MS
    );
    if (!res.ok) return PREFERRED_MODELS[0];

    const data = await res.json() as any;
    const models = data.models?.map((m: any) => m.name.split(":")[0]) || [];

    for (const preferred of PREFERRED_MODELS) {
      if (models.includes(preferred)) {
        return preferred;
      }
    }

    return models[0] || PREFERRED_MODELS[0];
  } catch (error) {
    console.warn("Failed to detect Ollama models:", error);
    return PREFERRED_MODELS[0];
  }
}

function extractMessageText(message: any): string {
  if (!message) return "";

  if (typeof message.content === "string") {
    return message.content;
  }

  if (typeof message.text === "string") {
    return message.text;
  }

  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part: any) => (part?.type === "text" ? part.text : ""))
      .filter(Boolean)
      .join("");
  }

  return "";
}

function resolveTargetRole(payload: any, incomingMessages: any[]): string {
  const directRole =
    payload?.targetRole ?? payload?.role ?? payload?.body?.targetRole ?? payload?.body?.role;

  const normalizedDirectRole = typeof directRole === "string" ? directRole.trim() : "";
  if (normalizedDirectRole) {
    return normalizedDirectRole;
  }

  const firstUserText = incomingMessages.map(extractMessageText).find((text, index) => {
    const role = incomingMessages[index]?.role;
    return role === "user" && Boolean(text.trim());
  }) ?? "";

  const roleMatch = firstUserText.match(/for the\s+(.+?)\s+position/i) || firstUserText.match(/for a\s+(.+?)\s+role/i);
  if (roleMatch?.[1]) {
    return roleMatch[1].trim();
  }

  return "Software Developer";
}

function extractJsonObject(content: string): string | null {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fencedMatch?.[1] ?? trimmed).trim();

  const startIndex = candidate.indexOf("{");
  const endIndex = candidate.lastIndexOf("}");

  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  return candidate.slice(startIndex, endIndex + 1);
}

function normalizeInterviewMessage(content: unknown): string {
  if (typeof content !== "string") {
    return "I'm ready to continue. What's your answer?";
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return "I'm ready to continue. What's your answer?";
  }

  const jsonText = extractJsonObject(trimmed);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as { message?: string; reply?: string; text?: string };
      const extracted = parsed.message ?? parsed.reply ?? parsed.text;
      if (typeof extracted === "string" && extracted.trim()) {
        return extracted.trim();
      }
    } catch {
      // Continue with plain text flow if parsing fails.
    }
  }

  const fencedMatch = trimmed.match(/```(?:text|markdown)?\s*([\s\S]*?)\s*```/i);
  return (fencedMatch?.[1] ?? trimmed).trim();
}

function sanitizeMessageContent(content: unknown): string {
  if (typeof content !== "string") return "";
  return content.trim().slice(0, MAX_MESSAGE_CHARS);
}

function buildTrimmedHistory(
  systemPrompt: string,
  incomingMessages: Array<{ role?: string; content?: unknown; text?: unknown }>
): Array<{ role: string; content: string }> {
  const recentMessages = incomingMessages.slice(-MAX_HISTORY_MESSAGES);

  const mapped = recentMessages
    .map((m) => ({
      role: m.role || "user",
      content: sanitizeMessageContent(m.content ?? m.text),
    }))
    .filter((m) => Boolean(m.content));

  return [{ role: "system", content: systemPrompt }, ...mapped];
}

export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const incomingMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const targetRole = resolveTargetRole(payload, incomingMessages);

  const systemPrompt = `You are an expert technical interviewer conducting a mock interview for a ${targetRole} position. Your role is to:\n\n1. Ask relevant interview questions one at a time (mix of technical, behavioral, and situational)\n2. Wait for the candidate's response before asking the next question\n3. Provide constructive feedback on answers when appropriate\n4. Adapt difficulty based on the candidate's performance\n5. Be encouraging but honest\n\nStart by introducing yourself and asking the first question. Keep questions relevant to a fresh graduate applying for a ${targetRole} role.\n\nAfter each answer, you may:\n- Acknowledge the answer briefly\n- Ask a follow-up question OR move to a new topic\n- Provide brief tips if the answer could be improved\n\nAfter about 5-8 questions, wrap up the interview with:\n1. A brief summary of strengths observed\n2. Areas for improvement\n3. An overall score out of 100\n4. Final encouragement\n\nFormat your final feedback clearly with headers.`;

  const history = buildTrimmedHistory(systemPrompt, incomingMessages);

  try {
    const model = await getAvailableModel();

    const ollamaRes = await fetchWithTimeout(
      `${OLLAMA_BASE_URL}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: history,
          max_tokens: INTERVIEW_MAX_TOKENS,
        }),
      },
      OLLAMA_REQUEST_TIMEOUT_MS
    );

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text();
      console.warn("Ollama returned an error, using fallback response:", text);
      return new Response(
        JSON.stringify({
          message: `I'm currently experiencing technical difficulties with my AI backend. Let me ask you a question instead: Can you tell me about a recent project you've worked on and what made it challenging?\n\n(Note: For the best experience, please ensure Ollama is running locally at ${OLLAMA_BASE_URL} with a supported model like Mistral or Neural-Chat)`,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const data = await ollamaRes.json();
    const rawContent = data.choices?.[0]?.message?.content;
    const botMessage = normalizeInterviewMessage(rawContent);

    return new Response(JSON.stringify({ message: botMessage }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    if (isTimeout) {
      console.warn(`Interview request timed out after ${OLLAMA_REQUEST_TIMEOUT_MS}ms; returning fallback message.`);
    } else {
      console.warn("Interview fetch failed; returning fallback message.", error);
    }
    return new Response(
      JSON.stringify({
        message: `I'm experiencing connection issues. Let me ask you this: What attracted you to the ${targetRole} role?\n\n(Note: For the full AI experience, please ensure Ollama is running at ${OLLAMA_BASE_URL}.)`,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
