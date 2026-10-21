"use client";
import React, { useState } from "react";
import { MessageSelection } from "@/components/message-selection";
import { ChatMessageBubble, type ChatMessage } from "@/components/chat-message-bubble";
const rows: ChatMessage[] = [
  { id: "20000000-0000-4000-8000-000000000001", senderId: "owner", author: "me", text: "Here is the project update.\nThe meeting is confirmed for tomorrow.", time: "12:00", status: "read" },
  { id: "20000000-0000-4000-8000-000000000002", senderId: "member", author: "them", text: "Thanks! I will bring the draft notes.", time: "12:01", status: "read", senderName: "Team member" },
  { id: "20000000-0000-4000-8000-000000000003", senderId: "owner", author: "me", text: "See you then.", time: "12:02", status: "read" },
];
export default function Review() {
  const [messages, setMessages] = useState(rows);
  return <main className="mx-auto max-w-3xl p-4 space-y-4 bg-background text-foreground">
    <h1 className="text-xl font-semibold">Message selection — isolated review fixture</h1>
    <p className="text-sm text-muted-foreground">Synthetic messages and mocked permissions; no live user data or deletion.</p>
    <MessageSelection key="fixture:owner" roomId="10000000-0000-4000-8000-000000000001" userId="owner" messages={messages} visibleMessages={messages}
      renderMessage={(message, selecting) => <ChatMessageBubble message={message} selectionMode={selecting} />} onDeleted={ids => setMessages(previous => previous.filter(message => !ids.includes(message.id)))} />
  </main>;
}
