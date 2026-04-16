"use client";

import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { RoleSelector } from "@/components/analyzer/role-selector";
import type { TargetRole } from "@/lib/types";
import {
  Send,
  Play,
  RotateCcw,
  User,
  Bot,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface SavedInterviewQuestion {
  question: string;
  type: "technical" | "behavioral" | "situational";
  answer?: string;
}

function createMessageId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function InterviewPage() {
  const [targetRole, setTargetRole] = useState<TargetRole | "">("");
  const [interviewStarted, setInterviewStarted] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const mapMessagesToQuestions = (chatMessages: ChatMessage[]): SavedInterviewQuestion[] => {
    const questions: SavedInterviewQuestion[] = [];
    let currentQuestionIndex = -1;

    for (const msg of chatMessages) {
      if (msg.role === "assistant") {
        questions.push({
          question: msg.text,
          type: "technical",
        });
        currentQuestionIndex = questions.length - 1;
      } else if (msg.role === "user" && currentQuestionIndex >= 0) {
        if (!questions[currentQuestionIndex].answer) {
          questions[currentQuestionIndex].answer = msg.text;
        }
      }
    }

    return questions;
  };

  const persistInterview = async (chatMessages: ChatMessage[]) => {
    if (!targetRole) return;

    const questions = mapMessagesToQuestions(chatMessages);
    const latestAssistant = [...chatMessages].reverse().find((m) => m.role === "assistant");

    if (!interviewId) {
      const createRes = await fetch("/api/interview/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRole,
          questions,
          status: "in_progress",
          feedback: latestAssistant?.text ?? null,
        }),
      });

      if (!createRes.ok) {
        const text = await createRes.text();
        throw new Error(text || "Failed to save interview");
      }

      const created = await createRes.json();
      if (created?.id) {
        setInterviewId(created.id);
      }
      return;
    }

    const updateRes = await fetch("/api/interview/save", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: interviewId,
        questions,
        status: "in_progress",
        feedback: latestAssistant?.text ?? null,
      }),
    });

    if (!updateRes.ok) {
      const text = await updateRes.text();
      throw new Error(text || "Failed to update interview");
    }
  };

  const sendInterviewMessage = async (text: string) => {
    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      text,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetRole,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.text })),
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to get interview response");
      }

      const data = await response.json();
      const assistantText =
        typeof data?.message === "string" && data.message.trim()
          ? data.message.trim()
          : "Let's continue. Can you elaborate on your last answer?";

      const assistantMessage: ChatMessage = {
        id: createMessageId(),
        role: "assistant",
        text: assistantText,
      };

      const savedMessages = [...nextMessages, assistantMessage];

      setMessages(savedMessages);

      try {
        await persistInterview(savedMessages);
      } catch (saveError) {
        console.warn("Interview save failed:", saveError);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startInterview = async () => {
    if (!targetRole) return;
    setInterviewStarted(true);
    await sendInterviewMessage(
      `Hello! I'm ready for my mock interview for the ${targetRole} position.`
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const text = inputValue;
    setInputValue("");
    await sendInterviewMessage(text);
  };

  const resetInterview = () => {
    setMessages([]);
    setInterviewStarted(false);
    setInputValue("");
    setError(null);
    setInterviewId(null);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Mock Interview</h1>
        <p className="mt-1 text-muted-foreground">
          Practice your interview skills with our AI interviewer.
        </p>
      </div>

      {!interviewStarted ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Start a New Interview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <RoleSelector value={targetRole} onChange={setTargetRole} />

            <div className="rounded-lg bg-muted/50 p-4">
              <h4 className="font-medium text-foreground">
                What to expect:
              </h4>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>• 5-8 interview questions tailored to your role</li>
                <li>• Mix of technical, behavioral, and situational questions</li>
                <li>• Real-time feedback and tips</li>
                <li>• Final score and improvement suggestions</li>
              </ul>
            </div>

            <Button
              onClick={startInterview}
              disabled={!targetRole}
              className="w-full gap-2"
              size="lg"
            >
              <Play className="h-4 w-4" />
              Start Interview
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="flex h-150 flex-col">
          <CardHeader className="border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">AI Interviewer</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {targetRole} Interview
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={resetInterview}>
                <RotateCcw className="mr-2 h-4 w-4" />
                New Interview
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex flex-1 flex-col overflow-hidden p-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                {messages.map((message) => {
                  const isUser = message.role === "user";
                  const text = message.text;

                  return (
                    <div
                      key={message.id}
                      className={cn(
                        "flex gap-3",
                        isUser ? "flex-row-reverse" : ""
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                          isUser ? "bg-primary/10" : "bg-accent/10"
                        )}
                      >
                        {isUser ? (
                          <User className="h-4 w-4 text-primary" />
                        ) : (
                          <Bot className="h-4 w-4 text-accent" />
                        )}
                      </div>
                      <div
                        className={cn(
                          "max-w-[80%] rounded-lg px-4 py-2",
                          isUser
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        )}
                      >
                        <p className="whitespace-pre-wrap text-sm">{text}</p>
                      </div>
                    </div>
                  );
                })}

                {isLoading && (
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10">
                      <Bot className="h-4 w-4 text-accent" />
                    </div>
                    <div className="rounded-lg bg-muted px-4 py-2">
                      <Spinner className="h-4 w-4" />
                    </div>
                  </div>
                )}

                {error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-border p-4">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <Textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Type your answer..."
                  className="min-h-20 resize-none"
                  disabled={isLoading}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={!inputValue.trim() || isLoading}
                  className="h-20 w-12"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
              <p className="mt-2 text-xs text-muted-foreground">
                Press Enter to send, Shift+Enter for new line
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
