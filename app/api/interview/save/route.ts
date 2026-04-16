import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { targetRole, questions, status, score, feedback, analysisId } =
    await req.json();

  if (!targetRole) {
    return NextResponse.json(
      { error: "Missing required field: targetRole" },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await supabase
      .from("mock_interviews")
      .insert({
        user_id: user.id,
        analysis_id: analysisId || null,
        target_role: targetRole,
        questions: questions || [],
        status: status || "in_progress",
        score: score || null,
        feedback: feedback || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Database error saving interview:", error);
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: data.id });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Unexpected error saving interview:", errorMessage);
    return NextResponse.json(
      { error: "Failed to save interview", details: errorMessage },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, questions, status, score, feedback } = await req.json();

  if (!id) {
    return NextResponse.json(
      { error: "Missing required field: id" },
      { status: 400 }
    );
  }

  try {
    const { error } = await supabase
      .from("mock_interviews")
      .update({
        questions,
        status,
        score,
        feedback,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      console.error("Database error updating interview:", error);
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Unexpected error updating interview:", errorMessage);
    return NextResponse.json(
      { error: "Failed to update interview", details: errorMessage },
      { status: 500 }
    );
  }
}
