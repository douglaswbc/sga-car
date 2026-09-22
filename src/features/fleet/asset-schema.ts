import { z } from "zod";
export const documentSchema=z.object({organizationId:z.string().uuid(),type:z.enum(["crlv","insurance","inspection","other"]),name:z.string().trim().min(2).max(120),url:z.string().url(),expiresOn:z.string().date().optional().or(z.literal(""))});
export const accessorySchema=z.object({organizationId:z.string().uuid(),name:z.string().trim().min(2).max(120)});
