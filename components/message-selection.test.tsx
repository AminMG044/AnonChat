import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessageSelection } from "./message-selection";
import type { ChatMessage } from "./chat-message-bubble";
const room = "10000000-0000-4000-8000-000000000001";
const first = "20000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000002";
const own: ChatMessage = { id: first, text: "First line\nSecond line", author: "me", senderId: "owner", time: "12:00", status: "sent" };
const other: ChatMessage = { ...own, id: second, text: "Other person's text", author: "them", senderId: "other" };
const writeText = vi.fn();
const fetchMock = vi.fn();
const deleted = vi.fn();
const baseProps = { roomId: room, userId: "owner", messages: [own, other], visibleMessages: [own, other], renderMessage: (message: ChatMessage) => <p>{message.text}</p>, onDeleted: deleted };
function select(id = first) { fireEvent.click(screen.getByRole("checkbox", { name: `Select message ${id}` })); }
async function start() {
  fireEvent.click(screen.getByRole("button", { name: "Select messages" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ canDeleteOwnMessages: true }) });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  writeText.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("message selection", () => {
  it("enters selection mode, toggles accessible checkboxes and exits with Escape", async () => {
    render(<MessageSelection {...baseProps} />); await start(); select();
    expect(screen.getByText("1 selected")).toBeDefined();
    expect((screen.getByRole("checkbox", { name: `Select message ${first}` }) as HTMLInputElement).checked).toBe(true);
    select(); expect(screen.queryByRole("group", { name: "Selected message actions" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("checkbox", { name: `Select message ${first}` }), { key: "Escape" });
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("copies selected contents in conversation order and preserves multiline text", async () => {
    render(<MessageSelection {...baseProps} />); await start(); select(second); select(first);
    fireEvent.click(screen.getByRole("button", { name: "Copy selected" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(own.text + "\n" + other.text));
    expect(await screen.findByText("Copied 2 messages.")).toBeDefined();
  });
  it("clears selections without exiting selection mode", async () => {
    render(<MessageSelection {...baseProps} />); await start(); select();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByRole("group", { name: "Selected message actions" })).toBeNull();
  });
  it("keeps selection and reports clipboard failure", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<MessageSelection {...baseProps} />); await start(); select();
    fireEvent.click(screen.getByRole("button", { name: "Copy selected" }));
    expect(await screen.findByRole("alert")).toBeDefined(); expect(screen.getByText("1 selected")).toBeDefined();
  });
  it("protects other people's messages and ignores a forged display author", async () => {
    render(<MessageSelection {...baseProps} messages={[own, { ...other, author: "me" }]} />); await start(); select(second);
    expect((screen.getByRole("button", { name: "Delete selected" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("fails closed when the backend does not support deletion", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    render(<MessageSelection {...baseProps} />); await start(); select();
    expect((screen.getByRole("button", { name: "Delete selected" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Copy selected" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("requires confirmation and removes only server-confirmed IDs", async () => {
    fetchMock.mockImplementation(async (_url, options) => options?.method === "DELETE"
      ? { ok: true, json: async () => ({ deletedIds: [first] }) }
      : { ok: true, json: async () => ({ canDeleteOwnMessages: true }) });
    render(<MessageSelection {...baseProps} />); await start(); select();
    await waitFor(() => expect((screen.getByRole("button", { name: "Delete selected" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    expect(screen.getByRole("alertdialog")).toBeDefined(); expect(deleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep messages" })); expect(deleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(deleted).toHaveBeenCalledWith([first]));
    expect(fetchMock).toHaveBeenCalledWith("/api/messages/bulk", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ room_id: room, ids: [first] }) }));
  });
  it("retains messages and shows a server permission failure", async () => {
    fetchMock.mockImplementation(async (_url, options) => options?.method === "DELETE"
      ? { ok: false, status: 403, json: async () => ({ error: "Room access revoked" }) }
      : { ok: true, json: async () => ({ canDeleteOwnMessages: true }) });
    render(<MessageSelection {...baseProps} />); await start(); select();
    await waitFor(() => expect((screen.getByRole("button", { name: "Delete selected" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected" })); fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    expect(await screen.findByText("Room access revoked")).toBeDefined(); expect(deleted).not.toHaveBeenCalled();
    expect(screen.getByText("1 selected")).toBeDefined();
  });
  it("drops removed messages and preserves selections hidden by a search", async () => {
    const view = render(<MessageSelection {...baseProps} />); await start(); select();
    view.rerender(<MessageSelection {...baseProps} visibleMessages={[other]} />);
    expect(screen.getByText("1 selected")).toBeDefined();
    view.rerender(<MessageSelection {...baseProps} messages={[other]} visibleMessages={[other]} />);
    expect(screen.queryByRole("group", { name: "Selected message actions" })).toBeNull();
  });
  it("discards selection when the conversation/user scope key changes", async () => {
    const view = render(<MessageSelection key="room-a:owner" {...baseProps} />); await start(); select();
    view.rerender(<MessageSelection key="room-b:owner" {...baseProps} roomId="10000000-0000-4000-8000-000000000002" />);
    expect(screen.queryByRole("checkbox")).toBeNull(); expect(screen.getByRole("button", { name: "Select messages" })).toBeDefined();
  });
});
