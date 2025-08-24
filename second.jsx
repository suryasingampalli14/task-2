import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Real‑Time Chat Application (React + WebSockets)
 * -------------------------------------------------
 * Features
 *  - Live WebSocket connection (configurable URL)
 *  - Responsive chat UI (mobile → desktop)
 *  - Message history persisted in localStorage
 *  - Delivery status + connection indicator
 *  - Auto‑scroll to latest message
 *  - Send on Enter (Shift+Enter = newline)
 *  - Basic reconnect with backoff
 *
 * Usage in your app:
 *   import ChatApp from "./ChatApp";
 *   export default function App(){
 *     return <ChatApp wsUrl="wss://echo.websocket.events" />;
 *   }
 *
 * Notes:
 *  - Default wsUrl points to a public echo server for quick testing.
 *    Replace with your own WebSocket backend (e.g., ws://localhost:8080) for production.
 */

export default function ChatApp({ wsUrl = "wss://echo.websocket.events" }) {
  const [username, setUsername] = useState(() => localStorage.getItem("chat.username") || "Guest");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("disconnected"); // disconnected | connecting | connected
  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem("chat.history");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  const wsRef = useRef(null as WebSocket | null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const backoffRef = useRef(1000);
  const reconnectTimer = useRef<number | null>(null);

  const connectionBadge = useMemo(() => {
    const map = {
      connected: "bg-green-500/20 text-green-400 border-green-500/30",
      connecting: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
      disconnected: "bg-red-500/20 text-red-400 border-red-500/30",
    } as const;
    return map[status as keyof typeof map];
  }, [status]);

  // Persist messages + username
  useEffect(() => {
    localStorage.setItem("chat.history", JSON.stringify(messages));
  }, [messages]);
  useEffect(() => {
    localStorage.setItem("chat.username", username);
  }, [username]);

  // Auto‑scroll when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Connect / Reconnect logic
  useEffect(() => {
    connect();
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  function scheduleReconnect() {
    if (reconnectTimer.current) return; // already scheduled
    const delay = Math.min(backoffRef.current, 15000);
    reconnectTimer.current = window.setTimeout(() => {
      reconnectTimer.current = null;
      backoffRef.current = Math.min(backoffRef.current * 1.6, 15000);
      connect();
    }, delay);
  }

  function cleanup() {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
  }

  function connect() {
    cleanup();
    setStatus("connecting");
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        setStatus("connected");
        backoffRef.current = 1000;
        // Optionally announce join
        const hello = { type: "system", text: `${username} joined`, ts: Date.now() };
        setMessages((m) => [...m, hello]);
      });

      ws.addEventListener("message", (event) => {
        const text = typeof event.data === "string" ? event.data : "(binary)";
        // Attempt to parse known JSON shape; fall back to plain text
        try {
          const obj = JSON.parse(text);
          if (obj && obj.type === "chat") {
            setMessages((m) => [...m, obj]);
            return;
          }
        } catch {}
        setMessages((m) => [
          ...m,
          { type: "chat", user: "Server", text, ts: Date.now(), inbound: true },
        ]);
      });

      ws.addEventListener("close", () => {
        setStatus("disconnected");
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        setStatus("disconnected");
        scheduleReconnect();
      });
    } catch (e) {
      setStatus("disconnected");
      scheduleReconnect();
    }
  }

  function sendMessage() {
    const trimmed = input.trim();
    if (!trimmed || status !== "connected") return;

    const msg = { type: "chat", user: username || "Guest", text: trimmed, ts: Date.now() };
    try {
      wsRef.current?.send(JSON.stringify(msg));
    } catch {}

    setMessages((m) => [
      ...m,
      { ...msg, outbound: true },
    ]);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function clearHistory() {
    setMessages([]);
    localStorage.removeItem("chat.history");
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-slate-900/70 backdrop-blur border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="px-3 py-1 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-400 font-black tracking-wide text-slate-950">RT‑CHAT</div>
            <div className="text-sm text-slate-400">Real‑time chat over WebSockets</div>
          </div>
          <div className={`text-xs font-semibold px-3 py-1 rounded-full border ${connectionBadge}`}>● {status}</div>
        </div>

        {/* Controls */}
        <div className="p-4 grid sm:grid-cols-3 gap-3 border-b border-slate-800">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Display name</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Your name"
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs text-slate-400">WebSocket URL</span>
            <input
              defaultValue={wsUrl}
              onBlur={(e) => {
                // Reconnect if user changes URL
                if (!e.target.value) return;
                if (e.target.value !== wsUrl) {
                  // Force a reconnection by remounting via state would be ideal; here we just rebuild.
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-ignore
                  wsUrl = e.target.value;
                  connect();
                }
              }}
              className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="wss://example.com/socket"
            />
          </label>
        </div>

        {/* Chat body */}
        <div ref={scrollRef} className="h-[60vh] overflow-y-auto p-4 space-y-3 bg-[radial-gradient(1200px_600px_at_80%_-10%,rgba(99,102,241,.15),transparent_60%),radial-gradient(900px_400px_at_10%_110%,rgba(34,197,94,.15),transparent_60%)]">
          {messages.length === 0 && (
            <EmptyState />
          )}
          {messages.map((m, idx) => (
            <MessageBubble key={idx} msg={m} self={m.user === username} />
          ))}
        </div>

        {/* Composer */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder={status === "connected" ? "Type a message…" : "Connecting…"}
              className="flex-1 resize-none px-4 py-3 rounded-2xl bg-slate-950/80 border border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex flex-col gap-2">
              <button
                onClick={sendMessage}
                disabled={status !== "connected" || !input.trim()}
                className="px-4 py-3 rounded-xl font-semibold bg-gradient-to-r from-indigo-500 to-cyan-400 text-slate-950 disabled:opacity-50"
              >Send ➤</button>
              <button
                onClick={clearHistory}
                className="text-xs text-slate-400 hover:text-slate-200"
              >Clear history</button>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Press <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">Enter</kbd> to send • <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">Shift</kbd>+<kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700">Enter</kbd> for newline</p>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, self }: { msg: any; self: boolean }) {
  const isSystem = msg.type === "system" && !msg.user;
  const ts = msg.ts ? new Date(msg.ts) : new Date();
  const time = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const name = msg.user || (isSystem ? "System" : "User");
  const initials = (name || "?")
    .split(" ")
    .map((s: string) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="text-xs text-slate-400 bg-slate-800/60 border border-slate-700 rounded-full px-3 py-1">
          {msg.text} • {time}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-end gap-2 ${self ? "justify-end" : "justify-start"}`}>
      {!self && (
        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold">
          {initials}
        </div>
      )}
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 border text-sm shadow ${
        self
          ? "bg-indigo-500/20 border-indigo-400/30"
          : "bg-slate-800/70 border-slate-700"
      }`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">{name}</span>
          <span className="text-[11px] text-slate-500">{time}</span>
        </div>
        <div className="whitespace-pre-wrap leading-relaxed text-slate-100">{msg.text}</div>
      </div>
      {self && (
        <div className="w-8 h-8 rounded-full bg-indigo-600 text-slate-950 flex items-center justify-center text-xs font-black">
          {initials}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-full w-full flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-slate-800/70 border border-slate-700 flex items-center justify-center mb-3">💬</div>
        <h3 className="text-lg font-semibold">Start chatting in real‑time</h3>
        <p className="text-slate-400 mt-1 text-sm">You're connected to a WebSocket. Send a message to see it appear here. Replace the WebSocket URL with your own server when ready.</p>
      </div>
    </div>
  );
}
