"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { rateLimit } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(72),
});

const signUpSchema = credentialsSchema.extend({
  fullName: z.string().trim().min(2).max(160),
});

function readFormData(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

function readNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function toLoginError(message: string, next: string): never {
  redirect(`/login?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`);
}

export async function signIn(formData: FormData) {
  const next = readNext(formData.get("next"));
  const parsedCredentials = credentialsSchema.safeParse(readFormData(formData));

  if (!parsedCredentials.success) {
    toLoginError("Informe um e-mail válido e uma senha de pelo menos 12 caracteres.", next);
  }

  const limit = rateLimit(`login:${parsedCredentials.data.email}`, 10, 15 * 60 * 1000);
  if (!limit.ok) {
    toLoginError("Muitas tentativas de login. Aguarde alguns minutos e tente novamente.", next);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsedCredentials.data);

  if (error) {
    toLoginError("E-mail ou senha inválidos.", next);
  }

  redirect(next);
}

export async function signUp(formData: FormData) {
  const next = readNext(formData.get("next"));
  const parsedSignUp = signUpSchema.safeParse(readFormData(formData));

  if (!parsedSignUp.success) {
    redirect(
      `/criar-conta?error=${encodeURIComponent("Preencha seu nome, e-mail válido e uma senha de pelo menos 12 caracteres.")}&next=${encodeURIComponent(next)}`,
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    throw new Error("NEXT_PUBLIC_SITE_URL precisa estar configurada.");
  }

  const signUpLimit = rateLimit(`signup:${parsedSignUp.data.email}`, 5, 60 * 60 * 1000);
  if (!signUpLimit.ok) {
    redirect(`/criar-conta?error=${encodeURIComponent("Muitas tentativas de cadastro. Tente novamente mais tarde.")}&next=${encodeURIComponent(next)}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signUp({
    email: parsedSignUp.data.email,
    password: parsedSignUp.data.password,
    options: {
      data: { full_name: parsedSignUp.data.fullName, invite_next: next },
      emailRedirectTo: new URL("/auth/confirm", siteUrl).toString(),
    },
  });

  if (error) {
    redirect(`/criar-conta?error=${encodeURIComponent("Não foi possível criar a conta.")}&next=${encodeURIComponent(next)}`);
  }

  redirect(`/login?notice=${encodeURIComponent("Enviamos um link de confirmação para o seu e-mail.")}&next=${encodeURIComponent(next)}`);
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(formData: FormData) {
  const email = z.string().trim().email().max(254).safeParse(formData.get("email"));

  if (!email.success) {
    redirect(`/recuperar-senha?error=${encodeURIComponent("Informe um e-mail válido.")}`);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    throw new Error("NEXT_PUBLIC_SITE_URL precisa estar configurada.");
  }

  const resetLimit = rateLimit(`password-reset:${email.data}`, 5, 60 * 60 * 1000);
  if (!resetLimit.ok) {
    redirect(`/recuperar-senha?error=${encodeURIComponent("Muitas solicitações. Tente novamente mais tarde.")}`);
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: new URL("/auth/confirm", siteUrl).toString(),
  });

  redirect(`/recuperar-senha?notice=${encodeURIComponent("Se o e-mail existir, enviaremos um link para redefinir a senha.")}`);
}

export async function updatePassword(formData: FormData) {
  const password = z.string().min(12, "Use pelo menos 12 caracteres.").max(72).safeParse(formData.get("password"));
  const confirmation = formData.get("confirmation");

  if (!password.success) {
    redirect(`/redefinir-senha?error=${encodeURIComponent(password.error.issues[0]?.message ?? "Senha inválida.")}`);
  }
  if (password.data !== confirmation) {
    redirect(`/redefinir-senha?error=${encodeURIComponent("As senhas não coincidem.")}`);
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?error=${encodeURIComponent("Link expirado. Solicite a redefinição novamente.")}`);
  }

  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) {
    redirect(`/redefinir-senha?error=${encodeURIComponent("Não foi possível redefinir a senha.")}`);
  }

  await supabase.auth.signOut();
  redirect(`/login?notice=${encodeURIComponent("Senha redefinida. Entre com a nova senha.")}`);
}
