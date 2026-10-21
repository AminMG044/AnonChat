"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import type { ChatMessage } from "@/components/chat-message-bubble";
import { MAX_BULK_MESSAGES, validRoomId } from "@/lib/messages/bulk";

type Props = {
  roomId: string;
  userId: string | null;
  messages: ChatMessage[];
  visibleMessages: ChatMessage[];
  renderMessage: (message: ChatMessage) => React.ReactNode;
  onDeleted: (ids: string[]) => void;
};

/** Mount with a room/user key so a conversation or identity change discards selection. */
export function MessageSelection({ roomId, userId, messages, visibleMessages, renderMessage, onDeleted }: Props) {
  const [selecting, setSelecting] = useState(false);
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  const [canDelete, setCanDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const available = useMemo(() => new Map(messages.map(message => [message.id, message])), [messages]);
  const selected = useMemo(() => messages.filter(message => ids.has(message.id)), [messages, ids]);
  const selectedIds = useMemo(() => new Set(selected.map(message => message.id)), [selected]);
  const ownOnly = selected.length > 0 && selected.every(message =>
    userId && message.senderId === userId && message.status !== "sending" && validRoomId(message.id));
  const deletable = canDelete && ownOnly && selected.length <= MAX_BULK_MESSAGES;
  const reason = !canDelete ? "Deletion is unavailable until the backend verifies your room permissions."
    : !ownOnly ? "Only your own saved messages can be deleted. Remove other messages from the selection."
      : selected.length > MAX_BULK_MESSAGES ? `Delete at most ${MAX_BULK_MESSAGES} messages at a time.` : "";

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setCanDelete(false);
    if (userId) void fetch(`/api/messages/bulk?room_id=${encodeURIComponent(roomId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => response.ok ? response.json() : null)
      .then(data => { if (!controller.signal.aborted) setCanDelete(data?.canDeleteOwnMessages === true); })
      .catch(() => {});
    return () => controller.abort();
  }, [roomId, userId]);
  useEffect(() => {
    // Drop expired/deleted rows without losing selections hidden by a search filter.
    setIds(previous => {
      const next = new Set([...previous].filter(id => available.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [available]);

  function exit() {
    if (busy) return;
    setSelecting(false); setIds(new Set()); setFeedback(""); setError("");
    toggleRef.current?.focus();
  }
  async function copy() {
    setError(""); setFeedback(""); setBusy(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable. Use a secure browser window and allow clipboard access.");
      await navigator.clipboard.writeText(selected.map(message => message.text).join("\n"));
      if (mounted.current) setFeedback(`Copied ${selected.length} message${selected.length === 1 ? "" : "s"}.`);
    } catch {
      if (mounted.current) setError("Could not copy messages. Allow clipboard access in a secure browser window and try again. Your selection is kept.");
    } finally { if (mounted.current) setBusy(false); }
  }
  async function remove() {
    setConfirming(false); setError(""); setFeedback("");
    if (!deletable) { setError("Permissions or selected messages changed. Refresh and select again."); return; }
    const requested = new Set(selected.map(message => message.id));
    setBusy(true);
    try {
      const response = await fetch("/api/messages/bulk", {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, ids: [...requested] }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (mounted.current && [401, 403, 404, 405].includes(response.status)) setCanDelete(false);
        throw new Error(data.error || "Messages could not be deleted. Try again.");
      }
      if (!Array.isArray(data.deletedIds) || data.deletedIds.some((id: unknown) => typeof id !== "string" || !requested.has(id))) {
        throw new Error("The backend returned an invalid deletion result. Refresh the conversation.");
      }
      const deleted: string[] = [...new Set<string>(data.deletedIds)];
      // A completion for another room cannot update this toolbar after unmount.
      onDeleted(deleted);
      if (!mounted.current) return;
      setIds(previous => new Set([...previous].filter(id => !deleted.includes(id))));
      if (deleted.length !== requested.size) setError(`Deleted ${deleted.length} messages. Some messages could not be deleted; they remain selected. Refresh permissions and try again.`);
      else setFeedback(`Deleted ${deleted.length} message${deleted.length === 1 ? "" : "s"}.`);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Messages could not be deleted. Try again.");
    } finally { if (mounted.current) setBusy(false); }
  }

  return <div className="space-y-3" onKeyDown={event => {
    if (event.key === "Escape" && !confirming) { event.stopPropagation(); exit(); }
  }}>
    <div className="sticky top-0 z-20 rounded-lg border border-border bg-background p-3 space-y-2">
      <button ref={toggleRef} type="button" className="rounded-md border border-border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" disabled={busy || messages.length === 0}
        onClick={() => selecting ? exit() : setSelecting(true)} aria-pressed={selecting}>
        {selecting ? "Exit selection" : "Select messages"}
      </button>
      {selecting && <p className="text-xs text-muted-foreground">Select messages below. Escape exits selection.</p>}
      {selecting && selected.length > 0 && <div role="group" aria-label="Selected message actions" className="flex flex-wrap items-center gap-2">
        <span role="status" className="text-sm">{selected.length} selected</span>
        <button type="button" className="rounded-md border border-border px-3 py-2 text-sm" disabled={busy} onClick={() => void copy()}>{busy ? "Working…" : "Copy selected"}</button>
        <button type="button" className="rounded-md border border-border px-3 py-2 text-sm" disabled={busy} onClick={() => { setIds(new Set()); setError(""); setFeedback("Selection cleared."); }}>Clear selection</button>
        <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
          <AlertDialog.Trigger asChild><button type="button" className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive disabled:opacity-50" disabled={busy || !deletable} aria-describedby={reason ? "delete-selection-reason" : undefined}>Delete selected</button></AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
            <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-5 shadow-xl">
              <AlertDialog.Title className="font-semibold">Delete {selected.length} selected messages?</AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-sm text-muted-foreground">This permanently removes your selected messages for everyone in this conversation. This cannot be undone.</AlertDialog.Description>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <AlertDialog.Cancel className="rounded-md border border-border px-3 py-2">Keep messages</AlertDialog.Cancel>
                <AlertDialog.Action className="rounded-md bg-destructive px-3 py-2 text-destructive-foreground" disabled={!deletable} onClick={() => void remove()}>Confirm deletion</AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
        {reason && <p id="delete-selection-reason" className="w-full text-xs text-muted-foreground">{reason}</p>}
      </div>}
      {feedback && <p role="status" className="text-sm">{feedback}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
    {visibleMessages.map(message => <div key={message.id} className={selectedIds.has(message.id) ? "rounded-lg bg-primary/10 ring-2 ring-primary p-2" : "p-2"}>
      {selecting && <label className="mb-2 inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={selectedIds.has(message.id)} disabled={busy || confirming} aria-label={`Select message ${message.id}`}
          onChange={() => { setIds(previous => { const next = new Set(previous); if (next.has(message.id)) next.delete(message.id); else next.add(message.id); return next; }); setError(""); setFeedback(""); }} />
        Select message from {message.author === "me" ? "you" : message.senderName || "another member"} at {message.time}
      </label>}
      {renderMessage(message)}
    </div>)}
  </div>;
}
