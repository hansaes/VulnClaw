import { useEffect, useRef, useState } from "react";
import { sendChatMessage, type ChatReply } from "../api/web";
import { useT } from "../i18n";

interface ChatPageProps {
  onOpenTaskDetail: (taskId: string) => void;
}

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  taskId?: string;
}

let nextId = 1;

export function ChatPage({ onOpenTaskDetail }: ChatPageProps) {
  const { t } = useT();
  const [messages, setMessages] = useState<Msg[]>([
    { id: nextId++, role: "assistant", text: t("chat.welcome") },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function handleSend(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
    setBusy(true);
    const userMsg: Msg = { id: nextId++, role: "user", text: content };
    setMessages((p) => [...p, userMsg]);
    try {
      const res: ChatReply = await sendChatMessage(content);
      setMessages((p) => [...p, { id: nextId++, role: "assistant", text: res.reply, taskId: res.task_id }]);
    } catch (err) {
      setMessages((p) => [...p, {
        id: nextId++,
        role: "assistant",
        text: err instanceof Error ? err.message : t("chat.failed"),
      }]);
    } finally {
      setBusy(false);
    }
  }

  const suggestions = [t("chat.sug_scan"), t("chat.sug_progress"), t("chat.sug_vuln")];

  return (
    <div className="vw-chat">
      <div className="vw-page-head">
        <div>
          <h1>{t("chat.title")}</h1>
          <p>{t("chat.subtitle")}</p>
        </div>
      </div>
      <div className="vw-chat-list">
        {messages.map((m) => (
          <div key={m.id} className={`vw-chat-msg ${m.role}`}>
            <div className="vw-chat-bubble">
              {m.text.split("\n").map((line, i) => <p key={i}>{line}</p>)}
              {m.taskId && (
                <button
                  type="button"
                  className="vw-btn vw-btn-primary vw-btn-xs"
                  style={{ marginTop: 8 }}
                  onClick={() => onOpenTaskDetail(m.taskId!)}
                >
                  {t("chat.view_task")}
                </button>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="vw-chat-msg assistant">
            <div className="vw-chat-bubble vw-chat-typing"><span /><span /><span /></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      {messages.length <= 1 && (
        <div className="vw-chat-sugs">
          {suggestions.map((s) => (
            <button key={s} type="button" className="vw-chip" onClick={() => handleSend(s)}>{s}</button>
          ))}
        </div>
      )}
      <form
        className="vw-chat-input"
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
      >
        <input
          className="vw-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("chat.placeholder")}
        />
        <button className="vw-btn vw-btn-primary" type="submit" disabled={busy || !input.trim()}>
          {t("chat.send")}
        </button>
      </form>
    </div>
  );
}
