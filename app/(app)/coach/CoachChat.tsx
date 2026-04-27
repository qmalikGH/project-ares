"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

type ChatMessage = { role: "user" | "assistant"; content: string };

type ConversationListItem = {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
};

export default function CoachChat() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load conversation list
  const loadList = useCallback(async () => {
    try {
      const r = await fetch("/api/coach/conversations");
      if (r.ok) {
        const data = await r.json();
        setConversations(data.items ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // Load a specific conversation when activeId changes
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    fetch(`/api/coach/conversations/${activeId}`)
      .then((r) => r.json())
      .then((data) => {
        setMessages((data.messages ?? []) as ChatMessage[]);
      })
      .catch(() => {
        /* ignore */
      });
  }, [activeId]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  function newConversation() {
    setActiveId(null);
    setMessages([]);
    setInput("");
    setError(null);
  }

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmed },
    ];
    setMessages(newMessages);
    setInput("");
    try {
      const r = await fetch("/api/coach/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, message: trimmed }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setActiveId(data.conversationId);
      setMessages([
        ...newMessages,
        { role: "assistant", content: data.reply },
      ]);
      // Refresh list so new conversation appears
      loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setMessages([
        ...newMessages,
        {
          role: "assistant",
          content: `[Fehler: ${e instanceof Error ? e.message : "unknown"}]`,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-3.5rem)] lg:h-screen">
      {/* Conversation history sidebar */}
      <aside className="lg:w-72 border-b lg:border-b-0 lg:border-r bg-card/30 flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold">Gespräche</h2>
          <button
            onClick={newConversation}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Neu
          </button>
        </div>
        <div className="flex-1 overflow-y-auto max-h-40 lg:max-h-none">
          {conversations.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              Noch keine Gespräche. Stell unten eine Frage.
            </p>
          ) : (
            <ul>
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setActiveId(c.id)}
                    className={`w-full text-left px-4 py-2 text-xs border-l-2 transition-colors ${
                      c.id === activeId
                        ? "bg-accent border-l-primary"
                        : "border-l-transparent hover:bg-accent/50"
                    }`}
                  >
                    <div className="line-clamp-2 text-foreground">{c.title}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {c.messageCount} Nachrichten ·{" "}
                      {new Date(c.updatedAt).toLocaleDateString("de-DE")}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Main chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="px-6 py-4 border-b">
          <h1 className="text-xl font-semibold tracking-tight">Coach</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sparring-Partner für Trainingsfragen, Reflexion, Plan-Verständnis.
          </p>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 ? (
            <div className="max-w-2xl mx-auto py-12 text-center">
              <p className="text-sm text-muted-foreground">
                Frag mich z.B. nach deinem Plan für heute, deinem HRV-Trend, oder
                warum eine Modifikation aktiv ist.
              </p>
              <ul className="mt-6 inline-flex flex-col gap-2 text-left text-sm text-muted-foreground">
                <li>· &bdquo;Welche Übungen mache ich heute im Strength A?&ldquo;</li>
                <li>· &bdquo;Wie waren meine letzten Workouts?&ldquo;</li>
                <li>· &bdquo;Was kommt nächste Woche?&ldquo;</li>
                <li>· &bdquo;Was bedeutet Therapy-Phase DISREPAIR?&ldquo;</li>
              </ul>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto flex flex-col gap-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`text-sm whitespace-pre-line rounded-md p-4 ${
                    m.role === "user"
                      ? "bg-primary/10 ml-12"
                      : "bg-muted/50 mr-12"
                  }`}
                >
                  {m.content}
                </div>
              ))}
              {busy && (
                <div className="text-xs text-muted-foreground italic mr-12 px-4">
                  Coach denkt nach…
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t p-4 bg-card/50">
          <div className="max-w-3xl mx-auto flex flex-col gap-2">
            {error && <p className="text-xs text-destructive">{error}</p>}
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="Deine Frage… (Enter = Senden, Shift+Enter = neue Zeile)"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={busy}
            />
            <Button onClick={send} disabled={busy || !input.trim()} size="sm" className="self-end">
              {busy ? "sende…" : "Senden"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
