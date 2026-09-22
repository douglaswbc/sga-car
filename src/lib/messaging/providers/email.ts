type SendEmailInput = { to: string; subject: string | null; body: string };

export async function sendEmail({ to, subject, body }: SendEmailInput): Promise<{ id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.SGA_EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Resend não está configurado.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": "sga/1.0" },
    body: JSON.stringify({ from, to, subject: subject ?? "SGA", text: body, reply_to: process.env.SGA_EMAIL_REPLY_TO || undefined }),
  });
  const data: { id?: string; message?: string } | null = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? "Falha ao enviar e-mail.");
  return { id: data?.id };
}
