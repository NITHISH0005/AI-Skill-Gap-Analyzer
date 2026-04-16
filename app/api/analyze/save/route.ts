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

  const { targetRole, resumeText, analysis } = await req.json();

  if (!targetRole || !analysis) {
    return NextResponse.json(
      { error: "Missing required fields: targetRole and analysis" },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await supabase
      .from("skill_analyses")
      .insert({
        user_id: user.id,
        target_role: targetRole,
        resume_text: resumeText || null,
        analysis_result: analysis,
      })
      .select()
      .single();

    if (error) {
      console.error("Database error saving analysis:", error);
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 }
      );
    }

    return NextResponse.json({ id: data.id });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Unexpected error saving analysis:", errorMessage);
    return NextResponse.json(
      { error: "Failed to save analysis", details: errorMessage },
      { status: 500 }
    );
  }
}
