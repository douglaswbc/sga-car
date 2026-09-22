import { z } from "zod";

export const inspectionSchema = z.object({
  organizationId: z.string().uuid(),
  contractId: z.string().uuid(),
  type: z.enum(["pickup", "return"]),
  inspectedOn: z.string().date(),
  odometerKm: z.coerce.number().int().min(0),
  fuelLevel: z.coerce.number().int().min(0).max(100),
  accessories: z.array(z.string().trim().min(1).max(100)).max(30),
  photoUrls: z.array(z.string().url("Informe URLs de fotos válidas.")).max(20),
  notes: z.string().max(2000).optional(),
  damages: z.array(z.object({ description: z.string().trim().min(1).max(500), estimatedCost: z.coerce.number().min(0).max(9_999_999) })).max(30),
});
