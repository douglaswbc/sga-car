import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/observability/logger";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().regex(/^[a-z][a-z0-9_]{2,511}$/),
  category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]),
  language: z.string().trim().min(2).max(20),
  body: z.string().trim().min(1).max(1024),
  examples: z.array(z.string().trim().min(1).max(1024)).max(20),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revise os campos do modelo de mensagem." }, { status: 422 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });

  const { error } = await supabase.rpc("create_organization_zernio_whatsapp_template", {
    target_organization_id: parsed.data.organizationId,
    template_name: parsed.data.name,
    template_category: parsed.data.category,
    template_language: parsed.data.language,
    template_body: parsed.data.body,
    template_examples: parsed.data.examples,
  });
  if (error) {
    logger.error("zernio_template.create_failed", { message: error.message, organizationId: parsed.data.organizationId });
    return NextResponse.json({ error: error.message || "Não foi possível criar o modelo." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
