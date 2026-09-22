import type { OrganizationRole } from "@/features/auth/permissions";

export type Organization = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

export type OrganizationMembership = Organization & {
  role: OrganizationRole;
  status: "pending" | "active" | "suspended";
};

export type PendingOrganization = {
  id: string;
  name: string;
  created_at: string;
  owner_name: string;
};

export type OrganizationMember = {
  user_id: string;
  full_name: string;
  email: string;
  role: OrganizationRole;
  created_at: string;
};

export type OrganizationInvitation = {
  id: string;
  email: string;
  role: OrganizationRole;
  expires_at: string;
  created_at: string;
};

export type OrganizationInvitationDetails = {
  id: string;
  organization_id: string;
  organization_name: string;
  email: string;
  role: OrganizationRole;
  expires_at: string;
  accepted_at: string | null;
};

export type OrganizationApiToken = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type AuditLog = {
  id: string;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type Tenant = {
  id: string;
  full_name: string;
  document_number: string | null;
  email: string | null;
  phone: string | null;
  status: "active" | "inactive";
  is_eligible: boolean;
  created_at: string;
};

export type TenantDocument = {
  id: string;
  type: "cnh" | "proof_of_address" | "other";
  name: string;
  url: string | null;
  identifier: string | null;
  category: string | null;
  expires_on: string | null;
  created_at: string;
};

export type TenantPayment = {
  id: string;
  invoice_id: string;
  paid_on: string;
  amount: number;
  method: "cash" | "pix" | "bank_transfer" | "credit_card" | "debit_card" | "other";
  receipt_url: string | null;
  note: string | null;
  created_at: string;
};

export type MessageChannel = "email" | "whatsapp";
export type MessageEvent = "member_invite" | "invoice_created" | "payment_receipt" | "invoice_due_soon" | "invoice_overdue";
export type MessageStatus = "pending" | "processing" | "sent" | "failed" | "cancelled";

export type Message = {
  id: string;
  tenant_id: string | null;
  tenant_name: string | null;
  channel: MessageChannel;
  event: MessageEvent;
  recipient: string;
  subject: string | null;
  body: string | null;
  status: MessageStatus;
  attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  created_at: string;
  sent_at: string | null;
};

export type TenantCommunication = {
  id: string;
  channel: MessageChannel;
  event: MessageEvent;
  recipient: string;
  subject: string | null;
  body: string | null;
  status: MessageStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};

export type MessageTemplate = {
  channel: MessageChannel;
  event: MessageEvent;
  subject: string | null;
  body: string;
  provider_template_name: string | null;
  provider_template_language: string | null;
  is_custom: boolean;
};

export type TenantPreferences = {
  email_opt_in: boolean;
  whatsapp_opt_in: boolean;
  consent_at: string | null;
};

export type TenantAddress = {
  postal_code: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
};

export type Vehicle = {
  id: string; plate: string; brand: string; model: string; category: string | null; model_year: number | null; color: string | null; odometer_km: number; status: "available" | "rented" | "maintenance" | "inactive"; created_at: string;
};

export type DepositStatus = "none" | "pending" | "held" | "refunded" | "retained";
export type RentalContract = { id: string; tenant_id: string; tenant_name: string; vehicle_id: string; vehicle_brand: string; vehicle_model: string; vehicle_plate: string; starts_on: string; expected_return_on: string; actual_return_on: string | null; daily_rate: number; billing_frequency: "daily" | "weekly" | "fortnightly" | "monthly" | "custom"; billing_time: string; billing_custom_interval: number | null; billing_custom_unit: "day" | "week" | "month" | null; status: "active" | "completed" | "cancelled"; security_deposit_amount: number; security_deposit_status: DepositStatus; created_at: string };
export type ContractFee = { id: string; organization_id: string; contract_id: string; name: string; amount: number; recurrence: "one_time" | "recurring"; created_at: string };
export type ContractRenewal = { id: string; organization_id: string; contract_id: string; previous_return_on: string; new_return_on: string; previous_daily_rate: number; new_daily_rate: number; created_at: string };
export type ContractSignature = { id: string; organization_id: string; contract_id: string; signer_role: "tenant" | "company"; signer_name: string; signer_document: string | null; signed_at: string; created_at: string };
export type InvoiceItem = { id: string; organization_id: string; invoice_id: string; type: "base" | "discount" | "additional" | "fine" | "interest" | "fee" | "deposit" | "deposit_refund" | "extra_daily" | "damage"; description: string; quantity: number; unit_amount: number; amount: number; created_at: string };
export type ContractInspection = { id: string; type: "pickup" | "return"; inspected_on: string; odometer_km: number; fuel_level: number; accessories: string[]; notes: string | null; photo_urls: string[]; damage_count: number; damage_cost: number };
export type Invoice = { id: string; contract_id: string | null; tenant_id: string; tenant_name: string; due_on: string; subtotal: number; discount_amount: number; additional_amount: number; fine_amount: number; interest_amount: number; deposit_amount: number; fee_amount: number; extra_amount: number; amount_due: number; amount_paid: number; status: "pending" | "paid" | "overdue" | "cancelled" | "reversed"; description: string | null; created_at: string };
export type DashboardReport = { id: string; name: string; starts_on: string; ends_on: string; created_at: string };

export type Database = {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: {
      request_organization: {
        Args: { organization_name: string };
        Returns: Organization;
      };
      get_my_organizations: {
        Args: Record<never, never>;
        Returns: OrganizationMembership[];
      };
      set_active_organization: { Args: { target_organization_id: string }; Returns: undefined };
      is_platform_administrator: {
        Args: Record<never, never>;
        Returns: boolean;
      };
      list_pending_organizations: {
        Args: Record<never, never>;
        Returns: PendingOrganization[];
      };
      list_active_organizations: {
        Args: Record<never, never>;
        Returns: PendingOrganization[];
      };
      approve_organization: {
        Args: { target_organization_id: string };
        Returns: Organization;
      };
      suspend_organization: {
        Args: { target_organization_id: string };
        Returns: Organization;
      };
      reactivate_organization: { Args: { target_organization_id: string }; Returns: Organization };
      list_suspended_organizations: { Args: Record<never, never>; Returns: PendingOrganization[] };
      list_organization_members: { Args: { target_organization_id: string }; Returns: OrganizationMember[] };
      add_organization_member: { Args: { target_organization_id: string; member_email: string; member_role: OrganizationMember["role"] }; Returns: undefined };
      update_organization_member_role: { Args: { target_organization_id: string; target_user_id: string; member_role: OrganizationMember["role"] }; Returns: undefined };
      remove_organization_member: { Args: { target_organization_id: string; target_user_id: string }; Returns: undefined };
      create_organization_invitation: { Args: { target_organization_id: string; member_email: string; member_role: OrganizationMember["role"]; invitation_token_hash: string; invitation_expires_at: string }; Returns: OrganizationInvitation };
      list_organization_invitations: { Args: { target_organization_id: string }; Returns: OrganizationInvitation[] };
      revoke_organization_invitation: { Args: { target_organization_id: string; target_invitation_id: string }; Returns: undefined };
      get_organization_invitation: { Args: { invitation_token_hash: string }; Returns: OrganizationInvitationDetails[] };
      accept_organization_invitation: { Args: { invitation_token_hash: string }; Returns: string };
      enqueue_organization_invite: { Args: { target_organization_id: string; member_email: string; member_name: string; invite_url: string }; Returns: undefined };
      record_audit_event: { Args: { target_organization_id: string | null; audit_action: string; audit_entity_type: string; audit_entity_id: string | null; audit_summary: string; audit_metadata: Record<string, unknown> }; Returns: undefined };
      list_audit_logs: { Args: { target_organization_id: string; filter_limit: number }; Returns: AuditLog[] };
      create_organization_api_token: { Args: { target_organization_id: string; token_name: string; token_hash: string; token_prefix_value: string; token_scopes: string[]; token_expires_at: string | null }; Returns: OrganizationApiToken[] };
      list_organization_api_tokens: { Args: { target_organization_id: string }; Returns: OrganizationApiToken[] };
      revoke_organization_api_token: { Args: { target_organization_id: string; target_token_id: string }; Returns: undefined };
      resolve_organization_api_token: { Args: { presented_token_hash: string }; Returns: { token_id: string; organization_id: string; scopes: string[] }[] };
      get_organization_messaging_settings: { Args: { target_organization_id: string }; Returns: { whatsapp_delivery: string }[] };
      set_organization_messaging_settings: { Args: { target_organization_id: string; delivery: string }; Returns: undefined };
      list_tenants: { Args: { target_organization_id: string }; Returns: Tenant[] };
      create_tenant: { Args: { target_organization_id: string; tenant_full_name: string; tenant_document_number: string; tenant_email: string; tenant_phone: string }; Returns: Tenant };
      create_tenant_with_address: { Args: { target_organization_id: string; tenant_full_name: string; tenant_document_number: string; tenant_email: string; tenant_phone: string; address_postal_code: string; address_street: string; address_number: string; address_complement: string; address_neighborhood: string; address_city: string; address_state: string }; Returns: Tenant };
      tenant_phone_exists: { Args: { target_organization_id: string; tenant_phone: string }; Returns: boolean };
      get_tenant_address: { Args: { target_organization_id: string; target_tenant_id: string }; Returns: TenantAddress[] };
      upsert_tenant_address: { Args: { target_organization_id: string; target_tenant_id: string; address_postal_code: string; address_street: string; address_number: string; address_complement: string; address_neighborhood: string; address_city: string; address_state: string }; Returns: undefined };
      update_tenant: { Args: { target_organization_id: string; target_tenant_id: string; tenant_full_name: string; tenant_document_number: string; tenant_email: string; tenant_phone: string; tenant_status: Tenant["status"] }; Returns: Tenant };
      delete_tenant: { Args: { target_organization_id: string; target_tenant_id: string }; Returns: undefined };
      export_tenant_data: { Args: { target_organization_id: string; target_tenant_id: string }; Returns: Record<string, unknown> };
      anonymize_tenant: { Args: { target_organization_id: string; target_tenant_id: string }; Returns: undefined };
      list_tenant_documents: { Args: { target_organization_id: string; target_tenant_id: string }; Returns: TenantDocument[] };
      add_tenant_document: { Args: { target_organization_id: string; target_tenant_id: string; document_type: TenantDocument["type"]; document_name: string; document_url: string; document_identifier: string; document_category: string; document_expires_on: string | null }; Returns: TenantDocument };
      delete_tenant_document: { Args: { target_organization_id: string; target_tenant_id: string; target_document_id: string }; Returns: undefined };
      list_tenant_payments: { Args: { target_organization_id: string; target_tenant_id: string }; Returns: TenantPayment[] };
      list_message_templates: { Args: { target_organization_id: string }; Returns: MessageTemplate[] };
      upsert_message_template: { Args: { target_organization_id: string; template_channel: MessageChannel; template_event: MessageEvent; template_subject: string; template_body: string; template_provider_name: string; template_provider_language: string }; Returns: undefined };
      list_messages: { Args: { target_organization_id: string; filter_status: MessageStatus | null; filter_channel: MessageChannel | null }; Returns: Message[] };
      list_tenant_communications: { Args: { target_organization_id: string; target_tenant_id: string }; Returns: TenantCommunication[] };
      retry_message: { Args: { target_organization_id: string; target_message_id: string }; Returns: undefined };
      enqueue_member_invite: { Args: { target_organization_id: string; member_email: string; member_name: string }; Returns: undefined };
      get_tenant_preferences: { Args: { target_organization_id: string; target_tenant_id: string }; Returns: TenantPreferences[] };
      upsert_tenant_preferences: { Args: { target_organization_id: string; target_tenant_id: string; preference_email_opt_in: boolean; preference_whatsapp_opt_in: boolean; preference_consent: boolean }; Returns: undefined };
      list_vehicles: { Args: { target_organization_id: string }; Returns: Vehicle[] };
      create_vehicle: { Args: { target_organization_id: string; vehicle_plate: string; vehicle_brand: string; vehicle_model: string; vehicle_category: string; vehicle_model_year: number | null; vehicle_color: string; vehicle_odometer_km: number }; Returns: Vehicle };
      update_vehicle: { Args: { target_organization_id: string; target_vehicle_id: string; vehicle_plate: string; vehicle_brand: string; vehicle_model: string; vehicle_category: string; vehicle_model_year: number | null; vehicle_color: string; vehicle_odometer_km: number; vehicle_status: Vehicle["status"] }; Returns: Vehicle };
      delete_vehicle: { Args: { target_organization_id: string; target_vehicle_id: string }; Returns: undefined };
      record_vehicle_odometer: { Args: { target_organization_id: string; target_vehicle_id: string; entry_date: string; entry_odometer_km: number; entry_note: string }; Returns: undefined };
      create_vehicle_maintenance: { Args: { target_organization_id: string; target_vehicle_id: string; maintenance_type: "preventive" | "corrective"; maintenance_title: string; maintenance_scheduled_on: string; maintenance_scheduled_odometer_km: number | null; maintenance_cost: number; maintenance_notes: string }; Returns: undefined };
      list_vehicle_odometer_entries: { Args: { target_organization_id: string; target_vehicle_id: string }; Returns: { id: string; recorded_on: string; odometer_km: number; note: string | null; created_at: string }[] };
      list_vehicle_maintenance: { Args: { target_organization_id: string; target_vehicle_id: string }; Returns: { id: string; type: "preventive" | "corrective"; status: "scheduled" | "in_progress" | "completed" | "cancelled"; title: string; scheduled_on: string; completed_on: string | null; scheduled_odometer_km: number | null; cost: number; notes: string | null }[] };
      update_vehicle_maintenance_status: { Args: { target_organization_id: string; target_maintenance_id: string; target_status: "completed" | "cancelled"; completion_date: string | null; completion_odometer_km: number | null }; Returns: undefined };
      list_vehicle_documents: { Args: { target_organization_id: string; target_vehicle_id: string }; Returns: { id: string; type: "crlv" | "insurance" | "inspection" | "other"; name: string; url: string; expires_on: string | null }[] };
      list_vehicle_accessories: { Args: { target_organization_id: string; target_vehicle_id: string }; Returns: { id: string; name: string }[] };
      add_vehicle_document: { Args: { target_organization_id:string; target_vehicle_id:string; document_type:string; document_name:string; document_url:string; document_expires_on:string|null }; Returns: undefined };
      add_vehicle_accessory: { Args: { target_organization_id:string; target_vehicle_id:string; accessory_name:string }; Returns: undefined };
      list_rental_contracts: { Args: { target_organization_id: string }; Returns: RentalContract[] };
      create_rental_contract: { Args: { target_organization_id: string; target_tenant_id: string; target_vehicle_id: string; contract_starts_on: string; contract_expected_return_on: string; contract_daily_rate: number; contract_billing_frequency: RentalContract["billing_frequency"]; contract_billing_time: string; contract_billing_custom_interval: number | null; contract_billing_custom_unit: "day" | "week" | "month" | null }; Returns: RentalContract };
      update_rental_contract: { Args: { target_organization_id: string; target_contract_id: string; contract_expected_return_on: string; contract_daily_rate: number; contract_billing_frequency: RentalContract["billing_frequency"]; contract_billing_time: string; contract_billing_custom_interval: number | null; contract_billing_custom_unit: "day" | "week" | "month" | null; contract_status: RentalContract["status"]; contract_actual_return_on: string | null }; Returns: RentalContract };
      delete_rental_contract: { Args: { target_organization_id: string; target_contract_id: string }; Returns: undefined };
      list_contract_inspections: { Args: { target_organization_id: string; target_contract_id: string }; Returns: ContractInspection[] };
      upsert_contract_inspection: { Args: { target_organization_id: string; target_contract_id: string; inspection_type: "pickup" | "return"; inspection_date: string; inspection_odometer_km: number; inspection_fuel_level: number; inspection_accessories: string[]; inspection_notes: string; inspection_photo_urls: string[]; inspection_damages: { description: string; estimatedCost: number }[] }; Returns: ContractInspection };
      list_invoices: { Args: { target_organization_id: string }; Returns: Invoice[] };
      list_invoice_items: { Args: { target_organization_id: string; target_invoice_id: string }; Returns: InvoiceItem[] };
      add_invoice_fee: { Args: { target_organization_id: string; target_invoice_id: string; fee_description: string; fee_amount: number }; Returns: Invoice };
      set_contract_deposit: { Args: { target_organization_id: string; target_contract_id: string; deposit_amount: number }; Returns: RentalContract };
      charge_contract_deposit: { Args: { target_organization_id: string; target_contract_id: string; deposit_due_on: string; deposit_description: string }; Returns: Invoice };
      settle_contract_deposit: { Args: { target_organization_id: string; target_contract_id: string; deposit_resolution: DepositStatus; deposit_note: string }; Returns: RentalContract };
      add_contract_fee: { Args: { target_organization_id: string; target_contract_id: string; fee_name: string; fee_amount: number; fee_recurrence: "one_time" | "recurring" }; Returns: ContractFee };
      remove_contract_fee: { Args: { target_organization_id: string; target_fee_id: string }; Returns: undefined };
      list_contract_fees: { Args: { target_organization_id: string; target_contract_id: string }; Returns: ContractFee[] };
      extend_rental_contract: { Args: { target_organization_id: string; target_contract_id: string; new_return_on: string; new_daily_rate: number | null }; Returns: RentalContract };
      list_contract_renewals: { Args: { target_organization_id: string; target_contract_id: string }; Returns: ContractRenewal[] };
      sign_rental_contract: { Args: { target_organization_id: string; target_contract_id: string; signer_role: "tenant" | "company"; signer_name: string; signer_document: string }; Returns: ContractSignature };
      list_contract_signatures: { Args: { target_organization_id: string; target_contract_id: string }; Returns: ContractSignature[] };
      settle_contract_return: { Args: { target_organization_id: string; target_contract_id: string; target_actual_return_on: string; settlement_due_on: string }; Returns: Invoice };
      generate_contract_invoices: { Args: { target_organization_id: string; generate_until: string }; Returns: number };
      create_manual_invoice: { Args: { target_organization_id: string; target_tenant_id: string; target_contract_id: string | null; invoice_due_on: string; invoice_amount: number; invoice_description: string }; Returns: Invoice };
      record_invoice_payment: { Args: { target_organization_id: string; target_invoice_id: string; payment_paid_on: string; payment_amount: number; payment_method: "cash" | "pix" | "bank_transfer" | "credit_card" | "debit_card" | "other"; payment_receipt_url: string; payment_note: string }; Returns: undefined };
      apply_invoice_adjustment: { Args: { target_organization_id: string; target_invoice_id: string; adjustment_type: "discount" | "additional" | "fine" | "interest"; adjustment_amount: number; adjustment_description: string }; Returns: Invoice };
      renegotiate_invoice: { Args: { target_organization_id: string; target_invoice_id: string; renegotiated_due_on: string; renegotiated_amount: number; renegotiation_description: string }; Returns: Invoice };
      dashboard_received_amount: { Args: { target_organization_id: string; period_starts_on: string; period_ends_on: string }; Returns: number };
      list_dashboard_reports: { Args: { target_organization_id: string }; Returns: DashboardReport[] };
      save_dashboard_report: { Args: { target_organization_id: string; report_name: string; period_starts_on: string; period_ends_on: string }; Returns: DashboardReport };
      ensure_organization_meta_whatsapp_templates: { Args: { target_organization_id: string }; Returns: undefined };
      list_organization_meta_whatsapp_templates: { Args: { target_organization_id: string }; Returns: { id: string; code: string; name: string; body: string; scheduled_at: string; status: string; rejection_reason: string | null; last_synced_at: string | null }[] };
      get_organization_whatsapp_connection_status: { Args: { target_organization_id: string }; Returns: { business_account_id: string; phone_number_id: string; configured: boolean }[] };
      create_organization_meta_whatsapp_template: { Args: { target_organization_id: string; template_name: string; template_category: "UTILITY" | "MARKETING" | "AUTHENTICATION"; template_language: string; template_body: string; template_examples: string[] }; Returns: undefined };
    };
    Enums: {
      organization_status: "pending" | "active" | "suspended";
    };
    CompositeTypes: Record<never, never>;
  };
};
