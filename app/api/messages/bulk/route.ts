import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MAX_BULK_MESSAGES, validBulkMessageIds, validRoomId } from "@/lib/messages/bulk";

// Uses the caller's session and database RLS; never a service-role client.
export async function GET(request: NextRequest) {
  try {
    const roomId = request.nextUrl.searchParams.get("room_id");
    if (!validRoomId(roomId)) return NextResponse.json({ error: "Invalid room." }, { status: 400 });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in to manage messages." }, { status: 401 });
    const { data, error } = await supabase.from("room_members").select("user_id")
      .eq("room_id", roomId).eq("user_id", user.id).is("removed_at", null).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Room access is no longer available." }, { status: 403 });
    return NextResponse.json({ canDeleteOwnMessages: true, maxMessages: MAX_BULK_MESSAGES }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "Message permissions could not be verified." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
  }
  const input = body as { room_id?: unknown; ids?: unknown } | null;
  if (!input || !validRoomId(input.room_id) || !validBulkMessageIds(input.ids)) {
    return NextResponse.json({ error: `Select between 1 and ${MAX_BULK_MESSAGES} distinct saved messages in one room.` }, { status: 400 });
  }
  const { room_id: roomId, ids } = input;
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in to delete messages." }, { status: 401 });
    const { data: membership, error: membershipError } = await supabase.from("room_members").select("user_id")
      .eq("room_id", roomId).eq("user_id", user.id).is("removed_at", null).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return NextResponse.json({ error: "Room access is no longer available." }, { status: 403 });

    // Reject mixed-owner, missing, expired and cross-room selections before deleting anything.
    const { data: owned, error: readError } = await supabase.from("messages").select("id")
      .eq("room_id", roomId).eq("user_id", user.id).in("id", ids);
    if (readError) throw readError;
    if (!owned || owned.length !== ids.length) {
      return NextResponse.json({ error: "Some selected messages are unavailable or not yours. Refresh the conversation and select again." }, { status: 403 });
    }
    const { data: deleted, error: deleteError } = await supabase.from("messages").delete()
      .eq("room_id", roomId).eq("user_id", user.id).in("id", ids).select("id");
    if (deleteError) throw deleteError;
    // Only acknowledge rows actually deleted; the UI retains any protected/stale rows.
    return NextResponse.json({ deletedIds: (deleted ?? []).map((row) => row.id) });
  } catch {
    return NextResponse.json({ error: "Messages could not be deleted. Your selection has been kept; refresh permissions and try again." }, { status: 503 });
  }
}
