import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const organizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const parsedPayload = organizationSchema.safeParse(payload);

  if (!parsedPayload.success) {
    return NextResponse.json(
      { error: "Informe um nome de organização entre 2 e 120 caracteres." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Autenticação obrigatória." }, { status: 401 });
  }

  const { data: organization, error: organizationError } = await supabase.rpc(
    "request_organization",
    { organization_name: parsedPayload.data.name },
  );

  if (organizationError || !organization) {
    return NextResponse.json(
      { error: "Não foi possível enviar a solicitação da organização." },
      { status: 500 },
    );
  }

  return NextResponse.json({ organization, status: "pending" }, { status: 201 });
}
