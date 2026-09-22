import { z } from "zod";
import { isValidDocument } from "@/features/tenants/registration-schema";

const digits = (value: string) => value.replace(/\D/g, "");
const namePattern = /^[\p{L}][\p{L}\p{M}' -]*$/u;
const cnhCategoryPattern = /^[A-E]{1,5}$/;

export function formatCnh(value: string) {
  return digits(value).slice(0, 11);
}

export function isEmptyOrValidDocument(value: string) {
  return value === "" || isValidDocument(value);
}

export function isValidCnh(value: string) {
  const cnh = digits(value);
  if (cnh.length !== 11 || /^(\d)\1{10}$/.test(cnh)) return false;
  let sum = 0;
  for (let index = 0, weight = 9; index < 9; index += 1, weight -= 1) sum += Number(cnh[index]) * weight;
  let first = sum % 11;
  let decrement = 0;
  if (first >= 10) {
    first = 0;
    decrement = 2;
  }
  sum = 0;
  for (let index = 0, weight = 1; index < 9; index += 1, weight += 1) sum += Number(cnh[index]) * weight;
  const remainder = sum % 11;
  const second = remainder >= 10 ? 0 : remainder - decrement;
  return `${first}${second}` === cnh.slice(-2);
}

export function isValidCnhCategory(value: string) {
  return cnhCategoryPattern.test(value) && new Set(value).size === value.length;
}

export const tenantUpdateSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  fullName: z.string().trim().min(2, "Nome deve ter ao menos 2 caracteres.").max(160, "Nome deve ter no máximo 160 caracteres.").regex(namePattern, "Nome contém caracteres inválidos."),
  documentNumber: z.string().trim().transform(digits).refine(isEmptyOrValidDocument, "Informe um CPF ou CNPJ válido."),
  email: z.union([z.literal(""), z.string().trim().email("Informe um e-mail válido.").max(254)]),
  phone: z.string().trim().transform(digits).refine((value) => value === "" || (/^\d{11}$/.test(value) && value[2] === "9"), "Informe um celular com DDD e 9 dígitos."),
  status: z.enum(["active", "inactive"]),
});

export const tenantDocumentSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  type: z.enum(["cnh", "proof_of_address", "other"]),
  name: z.string().trim().max(120),
  url: z.union([z.literal(""), z.string().trim().url("Informe uma URL válida.").max(500)]),
  identifier: z.string().trim().transform(digits),
  category: z.string().trim().transform((value) => value.toUpperCase()),
  expiresOn: z.union([z.literal(""), z.string().date("Informe uma data válida.")]),
}).superRefine((data, ctx) => {
  if (data.name.length < 2) ctx.addIssue({ code: "custom", path: ["name"], message: "Informe um nome para o documento." });
  if (data.type !== "cnh") return;
  if (!isValidCnh(data.identifier)) ctx.addIssue({ code: "custom", path: ["identifier"], message: "Informe uma CNH válida com 11 dígitos." });
  if (!isValidCnhCategory(data.category)) ctx.addIssue({ code: "custom", path: ["category"], message: "Informe a categoria da CNH (A–E)." });
  if (!data.expiresOn) ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "Informe a validade da CNH." });
});
