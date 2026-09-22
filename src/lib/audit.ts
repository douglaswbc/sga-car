import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type AuditInput = {
  organizationId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(supabase: SupabaseClient, input: AuditInput) {
  try {
    await supabase.rpc("record_audit_event", {
      target_organization_id: input.organizationId,
      audit_action: input.action,
      audit_entity_type: input.entityType,
      audit_entity_id: input.entityId ?? null,
      audit_summary: input.summary,
      audit_metadata: input.metadata ?? {},
    });
  } catch {
    // A auditoria nunca deve interromper a operação principal.
  }
}
