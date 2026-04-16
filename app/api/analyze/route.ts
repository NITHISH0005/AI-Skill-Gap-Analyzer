import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const OLLAMA_REQUEST_TIMEOUT_MS = Number(process.env.OLLAMA_REQUEST_TIMEOUT_MS ?? "120000");
const OLLAMA_MODEL_DISCOVERY_TIMEOUT_MS = Number(process.env.OLLAMA_MODEL_DISCOVERY_TIMEOUT_MS ?? "10000");
const FORCE_FALLBACK_ANALYSIS = process.env.FORCE_FALLBACK_ANALYSIS === "true";
const PREFERRED_MODELS = ["orca-mini", "neural-chat", "mistral", "llama2", "dolphin-mixtral"];

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

const skillAnalysisSchema = z.object({
  overallScore: z.number().min(0).max(100),
  currentSkills: z.array(
    z.object({
      name: z.string(),
      level: z.enum(["beginner", "intermediate", "advanced"]),
      yearsOfExperience: z.number().nullable(),
    })
  ),
  requiredSkills: z.array(
    z.object({
      name: z.string(),
      importance: z.enum(["critical", "important", "nice-to-have"]),
      currentLevel: z.enum(["none", "beginner", "intermediate", "advanced"]),
      targetLevel: z.enum(["beginner", "intermediate", "advanced"]),
    })
  ),
  skillGaps: z.array(
    z.object({
      skill: z.string(),
      gap: z.enum(["large", "medium", "small"]),
      priority: z.number().min(1).max(10),
      recommendation: z.string(),
    })
  ),
  learningPath: z.array(
    z.object({
      phase: z.number(),
      title: z.string(),
      duration: z.string(),
      skills: z.array(z.string()),
      resources: z.array(
        z.object({
          type: z.enum(["course", "tutorial", "documentation", "project"]),
          name: z.string(),
          url: z.string().nullable(),
          estimatedTime: z.string(),
        })
      ),
    })
  ),
  strengths: z.array(z.string()),
  areasForImprovement: z.array(z.string()),
  interviewTopics: z.array(
    z.object({
      topic: z.string(),
      importance: z.enum(["high", "medium", "low"]),
      preparationTips: z.array(z.string()),
    })
  ),
  summary: z.string(),
});

export type SkillAnalysis = z.infer<typeof skillAnalysisSchema>;

function extractJsonObject(content: string): string | null {
  const trimmedContent = content.trim();

  const fencedMatch = trimmedContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fencedMatch?.[1] ?? trimmedContent).trim();

  const startIndex = candidate.indexOf("{");
  const endIndex = candidate.lastIndexOf("}");

  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  return candidate.slice(startIndex, endIndex + 1);
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : String(item ?? "")).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\n|,|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  const found = allowed.find((item) => item === normalized);
  return found ?? fallback;
}

function normalizeAnalysisPayload(
  payload: unknown,
  targetRole: string,
  resumeText: string
): SkillAnalysis {
  const base = buildFallbackAnalysis(targetRole, resumeText);
  const source = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};

  const currentSkills = Array.isArray(source.currentSkills)
    ? source.currentSkills
        .map((item) => {
          if (typeof item === "string") {
            return {
              name: item,
              level: "beginner" as const,
              yearsOfExperience: null,
            };
          }

          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const yearsRaw = obj.yearsOfExperience ?? obj.years ?? obj.experience;
            const years = typeof yearsRaw === "number" ? yearsRaw : null;
            return {
              name: String(obj.name ?? obj.skill ?? obj.title ?? "").trim(),
              level: pickEnum(obj.level, ["beginner", "intermediate", "advanced"] as const, "beginner"),
              yearsOfExperience: years,
            };
          }

          return null;
        })
        .filter((item): item is SkillAnalysis["currentSkills"][number] => Boolean(item?.name))
    : [];

  const requiredSkills = Array.isArray(source.requiredSkills)
    ? source.requiredSkills
        .map((item) => {
          if (typeof item === "string") {
            return {
              name: item,
              importance: "important" as const,
              currentLevel: "none" as const,
              targetLevel: "intermediate" as const,
            };
          }

          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            return {
              name: String(obj.name ?? obj.skill ?? obj.title ?? "").trim(),
              importance: pickEnum(
                obj.importance,
                ["critical", "important", "nice-to-have"] as const,
                "important"
              ),
              currentLevel: pickEnum(
                obj.currentLevel,
                ["none", "beginner", "intermediate", "advanced"] as const,
                "none"
              ),
              targetLevel: pickEnum(
                obj.targetLevel,
                ["beginner", "intermediate", "advanced"] as const,
                "intermediate"
              ),
            };
          }

          return null;
        })
        .filter((item): item is SkillAnalysis["requiredSkills"][number] => Boolean(item?.name))
    : [];

  const skillGaps = Array.isArray(source.skillGaps)
    ? source.skillGaps
        .map((item) => {
          if (typeof item === "string") {
            return {
              skill: item,
              gap: "medium" as const,
              priority: 7,
              recommendation: `Practice ${item} with guided exercises and projects.`,
            };
          }

          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const rawPriority = typeof obj.priority === "number" ? obj.priority : 7;
            return {
              skill: String(obj.skill ?? obj.name ?? "").trim(),
              gap: pickEnum(obj.gap, ["large", "medium", "small"] as const, "medium"),
              priority: Math.max(1, Math.min(10, rawPriority)),
              recommendation: String(
                obj.recommendation ??
                  `Practice ${String(obj.skill ?? obj.name ?? "this skill")} with guided exercises and projects.`
              ),
            };
          }

          return null;
        })
        .filter((item): item is SkillAnalysis["skillGaps"][number] => Boolean(item?.skill))
    : [];

  const learningPath = Array.isArray(source.learningPath)
    ? source.learningPath
        .map((item, index) => {
          if (typeof item === "string") {
            return {
              phase: index + 1,
              title: item,
              duration: "1-2 weeks",
              skills: [],
              resources: [],
            };
          }

          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const resources = Array.isArray(obj.resources)
              ? obj.resources
                  .map((resource) => {
                    if (typeof resource === "string") {
                      return {
                        type: "tutorial" as const,
                        name: resource,
                        url: null,
                        estimatedTime: "2 hours",
                      };
                    }

                    if (resource && typeof resource === "object") {
                      const resObj = resource as Record<string, unknown>;
                      return {
                        type: pickEnum(
                          resObj.type,
                          ["course", "tutorial", "documentation", "project"] as const,
                          "tutorial"
                        ),
                        name: String(resObj.name ?? "Learning Resource").trim(),
                        url: typeof resObj.url === "string" ? resObj.url : null,
                        estimatedTime: String(resObj.estimatedTime ?? "2 hours"),
                      };
                    }

                    return null;
                  })
                  .filter(
                    (resource): resource is SkillAnalysis["learningPath"][number]["resources"][number] =>
                      Boolean(resource?.name)
                  )
              : [];

            return {
              phase: typeof obj.phase === "number" ? obj.phase : index + 1,
              title: String(obj.title ?? `Phase ${index + 1}`).trim(),
              duration: String(obj.duration ?? "1-2 weeks"),
              skills: toStringArray(obj.skills),
              resources,
            };
          }

          return null;
        })
        .filter((item): item is SkillAnalysis["learningPath"][number] => Boolean(item?.title))
    : [];

  const interviewTopics = Array.isArray(source.interviewTopics)
    ? source.interviewTopics
        .map((item) => {
          if (typeof item === "string") {
            return {
              topic: item,
              importance: "medium" as const,
              preparationTips: ["Review fundamentals", "Practice with mock answers"],
            };
          }

          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const tips = toStringArray(obj.preparationTips);
            return {
              topic: String(obj.topic ?? obj.name ?? "Interview Topic").trim(),
              importance: pickEnum(obj.importance, ["high", "medium", "low"] as const, "medium"),
              preparationTips: tips.length > 0 ? tips : ["Review fundamentals", "Practice with mock answers"],
            };
          }

          return null;
        })
        .filter((item): item is SkillAnalysis["interviewTopics"][number] => Boolean(item?.topic))
    : [];

  const overallScore = typeof source.overallScore === "number"
    ? Math.max(0, Math.min(100, source.overallScore))
    : base.overallScore;

  const summary = typeof source.summary === "string" && source.summary.trim().length > 0
    ? source.summary.trim()
    : base.summary;

  return {
    overallScore,
    currentSkills: currentSkills.length > 0 ? currentSkills : base.currentSkills,
    requiredSkills: requiredSkills.length > 0 ? requiredSkills : base.requiredSkills,
    skillGaps: skillGaps.length > 0 ? skillGaps : base.skillGaps,
    learningPath: learningPath.length > 0 ? learningPath : base.learningPath,
    strengths: toStringArray(source.strengths).length > 0 ? toStringArray(source.strengths) : base.strengths,
    areasForImprovement:
      toStringArray(source.areasForImprovement).length > 0
        ? toStringArray(source.areasForImprovement)
        : base.areasForImprovement,
    interviewTopics: interviewTopics.length > 0 ? interviewTopics : base.interviewTopics,
    summary,
  };
}

function buildFallbackAnalysis(targetRole: string, resumeText: string): SkillAnalysis {
  const keywordMatches = [
    "JavaScript",
    "TypeScript",
    "React",
    "Next.js",
    "Node.js",
    "HTML",
    "CSS",
    "SQL",
    "Git",
    "REST APIs",
  ].filter((skill) => new RegExp(skill.replace(/\./g, "\\."), "i").test(resumeText));

  const currentSkills: SkillAnalysis["currentSkills"] = (
    keywordMatches.length > 0 ? keywordMatches : ["Communication", "Problem Solving", "Teamwork"]
  ).map((name) => ({
    name,
    level: name === "Communication" || name === "Problem Solving" || name === "Teamwork" ? "intermediate" : "beginner",
    yearsOfExperience: null,
  }));

  const targetKeywords = targetRole.toLowerCase().includes("data")
    ? ["SQL", "Python", "Data Analysis", "Statistics"]
    : targetRole.toLowerCase().includes("designer")
      ? ["Figma", "Prototyping", "User Research", "Accessibility"]
      : targetRole.toLowerCase().includes("devops") || targetRole.toLowerCase().includes("cloud")
        ? ["Linux", "Docker", "CI/CD", "Cloud Platforms"]
        : ["JavaScript", "TypeScript", "System Design", "Testing"];

  return {
    overallScore: 68,
    currentSkills,
    requiredSkills: targetKeywords.map((name, index) => ({
      name,
      importance: index < 2 ? "critical" : "important",
      currentLevel: index === 0 ? "beginner" : "none",
      targetLevel: index < 2 ? "advanced" : "intermediate",
    })),
    skillGaps: targetKeywords.map((name, index) => ({
      skill: name,
      gap: index < 2 ? "large" : "medium",
      priority: 10 - index,
      recommendation: `Build a small project and practice ${name} basics regularly.`,
    })),
    learningPath: [
      {
        phase: 1,
        title: "Strengthen core skills",
        duration: "1-2 weeks",
        skills: targetKeywords.slice(0, 2),
        resources: [
          {
            type: "course",
            name: `${targetKeywords[0]} fundamentals course`,
            url: null,
            estimatedTime: "3 hours",
          },
          {
            type: "tutorial",
            name: `${targetKeywords[1]} beginner tutorial`,
            url: null,
            estimatedTime: "4 hours",
          },
        ],
      },
      {
        phase: 2,
        title: "Apply through projects",
        duration: "2-3 weeks",
        skills: targetKeywords.slice(2),
        resources: [
          {
            type: "project",
            name: `Role-specific portfolio project for ${targetRole}`,
            url: null,
            estimatedTime: "8 hours",
          },
        ],
      },
    ],
    strengths: ["Willingness to learn", "Transferable problem-solving skills", "Career readiness"],
    areasForImprovement: [
      `Deepen practical experience for ${targetRole}`,
      "Practice explaining projects clearly",
      "Prepare concise behavioral examples",
    ],
    interviewTopics: [
      {
        topic: `Fundamentals for ${targetRole}`,
        importance: "high",
        preparationTips: ["Review core concepts", "Practice explaining basics clearly"],
      },
      {
        topic: "Projects and hands-on experience",
        importance: "high",
        preparationTips: ["Describe one project end-to-end", "Highlight challenges and tradeoffs"],
      },
      {
        topic: "Behavioral questions",
        importance: "medium",
        preparationTips: ["Use STAR answers", "Show ownership and collaboration"],
      },
    ],
    summary: `Fallback analysis generated because the local model was unavailable. This is a practical starting point for a ${targetRole} application, but you should rerun it once Ollama is running for a deeper review.`,
  };
}

export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { resumeText, targetRole } = await req.json();

  if (!resumeText || !targetRole) {
    return new Response("Missing resume text or target role", { status: 400 });
  }

  if (FORCE_FALLBACK_ANALYSIS) {
    const fallback = buildFallbackAnalysis(targetRole, resumeText);
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-analysis-source": "fallback",
      },
    });
  }

  const prompt = `You are an expert career counselor and skill gap analyzer. Analyze the following resume for a fresh graduate targeting a ${targetRole} position.\n\nRESUME:\n${resumeText}\n\nTARGET ROLE: ${targetRole}\n\nProvide a comprehensive skill gap analysis in JSON format with fields: overallScore, currentSkills, requiredSkills, skillGaps, learningPath, strengths, areasForImprovement, interviewTopics, summary. Return only valid JSON.`;

  try {
    const model = await getAvailableModel();

    const ollamaRes = await fetchWithTimeout(
      `${OLLAMA_BASE_URL}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: prompt }],
          max_tokens: 800,
        }),
      },
      OLLAMA_REQUEST_TIMEOUT_MS
    );

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text();
      console.warn("Ollama returned an error, using fallback analysis:", text);
      const fallback = buildFallbackAnalysis(targetRole, resumeText);
      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await ollamaRes.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      const fallback = buildFallbackAnalysis(targetRole, resumeText);
      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const jsonText = extractJsonObject(content);

      if (!jsonText) {
        throw new Error("Model response did not contain a valid JSON object");
      }

      const parsedContent = JSON.parse(jsonText);
      const normalized = normalizeAnalysisPayload(parsedContent, targetRole, resumeText);
      const analysis = skillAnalysisSchema.parse(normalized);
      return new Response(JSON.stringify(analysis), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.warn("Failed to parse model response, using fallback analysis:", error);
      const fallback = buildFallbackAnalysis(targetRole, resumeText);
      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    console.warn(
      isTimeout
        ? `Ollama request timed out after ${OLLAMA_REQUEST_TIMEOUT_MS}ms, using fallback analysis:`
        : "Ollama fetch failed, using fallback analysis:",
      error
    );
    const fallback = buildFallbackAnalysis(targetRole, resumeText);
    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}
