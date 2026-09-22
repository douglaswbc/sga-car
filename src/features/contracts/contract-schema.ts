import { z } from "zod";

const rentalContractBaseSchema = z.object({
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid("Selecione o locatário."),
  vehicleId: z.string().uuid("Selecione o veículo."),
  startsOn: z.string().date("Informe a data de início."),
  expectedReturnOn: z.string().date("Informe a previsão de retorno."),
  dailyRate: z.coerce.number().positive("A diária deve ser maior que zero.").max(9_999_999),
  depositAmount: z.coerce.number().min(0, "A caução não pode ser negativa.").max(9_999_999).optional(),
  billingFrequency: z.enum(["daily", "weekly", "fortnightly", "monthly", "custom"]),
  billingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe um horário válido."),
  customInterval: z.coerce.number().int().min(1).max(365).optional(),
  customUnit: z.enum(["day", "week", "month"]).optional(),
});

const billingScheduleRefinement = <T extends { billingFrequency: string; customInterval?: number; customUnit?: string }>(data: T) => data.billingFrequency !== "custom" || (data.customInterval && data.customUnit);

export const rentalContractSchema = rentalContractBaseSchema.refine((data) => data.expectedReturnOn >= data.startsOn, { message: "O retorno deve ser igual ou posterior ao início.", path: ["expectedReturnOn"] }).refine(billingScheduleRefinement, { message: "Defina o intervalo personalizado.", path: ["customInterval"] });

export const rentalContractUpdateSchema = rentalContractBaseSchema.pick({ expectedReturnOn: true, dailyRate: true, billingFrequency: true, billingTime: true, customInterval: true, customUnit: true }).extend({ organizationId: z.string().uuid(), contractId: z.string().uuid(), status: z.enum(["active", "completed", "cancelled"]), actualReturnOn: z.string().date().optional().or(z.literal("")) }).refine(billingScheduleRefinement, { message: "Defina o intervalo personalizado.", path: ["customInterval"] });
