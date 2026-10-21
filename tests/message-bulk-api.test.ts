// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mock.createClient }));
import { DELETE, GET } from "@/app/api/messages/bulk/route";
import { MAX_BULK_MESSAGES } from "@/lib/messages/bulk";
const room = "10000000-0000-4000-8000-000000000001";
const ids = ["20000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000002"];
let member: boolean, user: { id: string } | null, owned: { id: string }[], deleted: { id: string }[];
let deleteError: unknown, readError: unknown;
let calls: Array<[string, ...unknown[]]>;
function chain(table: string) {
  let deleting = false;
  const builder = {
    select: (columns: string) => { calls.push([table, "select", columns]); return builder; },
    eq: (column: string, value: unknown) => { calls.push([table, "eq", column, value]); return builder; },
    is: (column: string, value: unknown) => { calls.push([table, "is", column, value]); return builder; },
    in: (column: string, value: unknown) => { calls.push([table, "in", column, value]); return builder; },
    delete: () => { deleting = true; calls.push([table, "delete"]); return builder; },
    maybeSingle: async () => ({ data: member ? { user_id: "owner" } : null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: deleting ? deleted : owned, error: deleting ? deleteError : readError }).then(resolve),
  };
  return builder;
}
function request(body: unknown = { room_id: room, ids }) {
  return new NextRequest("http://localhost/api/messages/bulk", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  member = true; user = { id: "owner" }; owned = ids.map(id => ({ id })); deleted = owned;
  deleteError = null; readError = null; calls = [];
  mock.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) }, from: chain });
});
describe("bulk message API authorization", () => {
  it("advertises permission only to an authenticated active member", async () => {
    const response = await GET(new NextRequest(`http://localhost/api/messages/bulk?room_id=${room}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ canDeleteOwnMessages: true, maxMessages: MAX_BULK_MESSAGES });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls).toContainEqual(["room_members", "is", "removed_at", null]);
  });
  it("denies capability when room membership was revoked", async () => {
    member = false;
    expect((await GET(new NextRequest(`http://localhost/api/messages/bulk?room_id=${room}`))).status).toBe(403);
  });
  it("requires authentication", async () => {
    user = null; expect((await DELETE(request())).status).toBe(401);
    expect(calls).toEqual([]);
  });
  it("rejects a removed member before reading or deleting messages", async () => {
    member = false; expect((await DELETE(request())).status).toBe(403);
    expect(calls.some(call => call[0] === "messages")).toBe(false);
  });
  it.each([[], [ids[0], ids[0]], ["temporary"], Array(MAX_BULK_MESSAGES + 1).fill(ids[0])])("rejects invalid ID sets %j", async value => {
    expect((await DELETE(request({ room_id: room, ids: value }))).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it("rejects malformed JSON without performing database work", async () => {
    expect((await DELETE(new NextRequest("http://localhost/api/messages/bulk", { method: "DELETE", body: "{" }))).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it("rejects a mixed-owner, cross-room or missing selection before any deletion", async () => {
    owned = [{ id: ids[0] }];
    expect((await DELETE(request())).status).toBe(403);
    expect(calls).not.toContainEqual(["messages", "delete"]);
  });
  it("filters both reads and deletes by authenticated owner and requested room", async () => {
    const response = await DELETE(request());
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ deletedIds: ids });
    expect(calls.filter(call => call[0] === "messages" && call[1] === "eq")).toEqual([
      ["messages", "eq", "room_id", room], ["messages", "eq", "user_id", "owner"],
      ["messages", "eq", "room_id", room], ["messages", "eq", "user_id", "owner"],
    ]);
  });
  it("acknowledges only actual deletions after a concurrent state change", async () => {
    deleted = [{ id: ids[0] }];
    expect(await (await DELETE(request())).json()).toEqual({ deletedIds: [ids[0]] });
  });
  it("does not delete when the ownership read fails", async () => {
    readError = new Error("offline"); expect((await DELETE(request())).status).toBe(503);
    expect(calls).not.toContainEqual(["messages", "delete"]);
  });
  it("returns a meaningful failure when database permissions reject deletion", async () => {
    deleteError = new Error("RLS"); const response = await DELETE(request());
    expect(response.status).toBe(503); expect((await response.json()).error).toContain("selection has been kept");
  });
});
