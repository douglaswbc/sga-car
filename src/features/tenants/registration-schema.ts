import { z } from "zod";

const states = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
const digits = (value: string) => value.replace(/\D/g, "");
const namePattern = /^[\p{L}][\p{L}\p{M}' -]*$/u;

function hasValidCheckDigits(value: string, weights: number[]) {
  const sum = value.slice(0, weights.length).split("").reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
  const remainder = sum % 11;
  const expected = remainder < 2 ? 0 : 11 - remainder;
  return expected === Number(value[weights.length]);
}

export function isValidDocument(value: string) {
  const document = digits(value);
  if (/^(\d)\1+$/.test(document)) return false;
  if (document.length === 11) return hasValidCheckDigits(document, [10, 9, 8, 7, 6, 5, 4, 3, 2]) && hasValidCheckDigits(document, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (document.length === 14) return hasValidCheckDigits(document, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) && hasValidCheckDigits(document, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return false;
}

export function formatDocument(value: string) {
  const document = digits(value).slice(0, 14);
  if (document.length <= 11) return document.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return document.replace(/^(\d{2})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1/$2").replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function formatPhone(value: string) {
  const rawPhone = digits(value);
  const phone = (rawPhone.length > 11 && rawPhone.startsWith("55") ? rawPhone.slice(2) : rawPhone).slice(0, 11);
  return phone.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

export function normalizeBrazilMobile(value: string) {
  const phone = digits(value);
  return phone.length === 13 && phone.startsWith("55") ? phone.slice(2) : phone;
}

export const tenantIdentitySchema = z.object({
  fullName: z.string().trim().min(2, "Nome deve ter ao menos 2 caracteres.").max(160).regex(namePattern, "Nome contém caracteres inválidos."),
  documentNumber: z.string().trim().refine(isValidDocument, "Informe um CPF ou CNPJ válido.").transform(digits),
  email: z.union([z.literal(""), z.string().trim().email("Informe um e-mail válido.").max(254)]),
  phone: z.string().trim().transform(digits).refine((value) => /^\d{2}9\d{8}$/.test(value), "Informe celular com DDD e 9 dígitos."),
});

export const addressSchema = z.object({
  postalCode: z.string().trim().transform(digits).refine((value) => /^\d{8}$/.test(value), "CEP deve conter 8 dígitos."),
  street: z.string().trim().min(3).max(160),
  number: z.string().trim().min(1).max(32),
  complement: z.string().trim().max(120),
  neighborhood: z.string().trim().min(2).max(120),
  city: z.string().trim().min(2).max(120).regex(namePattern, "Cidade contém caracteres inválidos."),
  state: z.string().trim().toUpperCase().pipe(z.enum(states)),
});

export const tenantRegistrationSchema = tenantIdentitySchema.merge(addressSchema).extend({ organizationId: z.string().uuid() });
export const brazilStates = states;
export const validationMessage = (error: z.ZodError) => error.issues[0]?.message ?? "Confira os dados informados.";
