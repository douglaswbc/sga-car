import { z } from "zod";

const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().default("");

export function normalizePlate(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 7);
}

export function formatPlate(value: string) {
  const plate = normalizePlate(value);
  return plate.length === 7 ? `${plate.slice(0, 3)}-${plate.slice(3)}` : plate;
}

export const vehicleRegistrationSchema = z.object({
  organizationId: z.string().uuid(),
  plate: z.string().transform(normalizePlate).pipe(z.string().regex(/^[A-Z0-9]{7}$/, "Informe uma placa com 7 caracteres.")),
  brand: z.string().trim().min(2, "Informe a marca.").max(60),
  model: z.string().trim().min(2, "Informe o modelo.").max(100),
  category: optionalText(60),
  modelYear: z.coerce.number().int().min(1900).max(2100).optional(),
  color: optionalText(40),
  odometerKm: z.coerce.number().int().min(0, "A quilometragem não pode ser negativa.").max(9_999_999),
});

export type VehicleRegistration = z.infer<typeof vehicleRegistrationSchema>;

export const vehicleUpdateSchema = vehicleRegistrationSchema.extend({
  vehicleId: z.string().uuid(),
  status: z.enum(["available", "rented", "maintenance", "inactive"]),
});
