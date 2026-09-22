import { z } from "zod";

const states = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
const namePattern = /^[\p{L}][\p{L}\p{M}' -]*$/u;

function isValidCpf(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const digit = (length: number) => {
    const sum = digits.slice(0, length).split("").reduce((total, current, index) => total + Number(current) * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return digit(9) === Number(digits[9]) && digit(10) === Number(digits[10]);
}

export const tenantSchema = z.object({
  organizationId: z.string().uuid(),
  fullName: z.string().trim().min(2, "Nome deve ter ao menos 2 caracteres.").max(160, "Nome deve ter no máximo 160 caracteres.").regex(namePattern, "Nome contém caracteres inválidos."),
  documentNumber: z.string().trim().refine((value) => !value || isValidCpf(value), "Informe um CPF válido com 11 dígitos.").transform((value) => value.replace(/\D/g, "")),
  email: z.union([z.literal(""), z.string().trim().email("Informe um e-mail válido.").max(254)]),
  phone: z.string().trim().refine((value) => !value || /^\d{10,11}$/.test(value.replace(/\D/g, "")), "Telefone deve ter DDD e 10 ou 11 dígitos.").transform((value) => value.replace(/\D/g, "")),
});

export const tenantAddressSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  postalCode: z.string().trim().transform((value) => value.replace(/\D/g, "")).refine((value) => /^\d{8}$/.test(value), "CEP deve conter 8 dígitos."),
  street: z.string().trim().min(3, "Logradouro deve ter ao menos 3 caracteres.").max(160),
  number: z.string().trim().min(1, "Número é obrigatório.").max(32),
  complement: z.string().trim().max(120),
  neighborhood: z.string().trim().min(2, "Bairro deve ter ao menos 2 caracteres.").max(120),
  city: z.string().trim().min(2, "Cidade deve ter ao menos 2 caracteres.").max(120).regex(namePattern, "Cidade contém caracteres inválidos."),
  state: z.string().trim().toUpperCase().pipe(z.enum(states, "Selecione uma UF válida.")),
});

export function firstValidationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Confira os dados informados.";
}
