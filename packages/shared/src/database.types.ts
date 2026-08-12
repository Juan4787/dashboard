export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          query?: string
          extensions?: Json
          variables?: Json
          operationName?: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      access_grants: {
        Row: {
          admin_email: string | null
          admin_id: string | null
          amount: number | null
          business_id: string
          created_at: string
          duration_seconds: number | null
          duration_unit: string | null
          enabled_after: boolean | null
          enabled_before: boolean | null
          grace_until_after: string | null
          grace_until_before: string | null
          id: string
          idempotency_key: string
          is_permanent_after: boolean | null
          is_permanent_before: boolean | null
          is_permanent_grant: boolean
          note: string | null
          operation: string
          paid_until_after: string | null
          paid_until_before: string | null
          restricted_until_after: string | null
          restricted_until_before: string | null
          source: string
          status_after: string | null
          status_before: string | null
        }
        Insert: {
          admin_email?: string | null
          admin_id?: string | null
          amount?: number | null
          business_id: string
          created_at?: string
          duration_seconds?: number | null
          duration_unit?: string | null
          enabled_after?: boolean | null
          enabled_before?: boolean | null
          grace_until_after?: string | null
          grace_until_before?: string | null
          id?: string
          idempotency_key: string
          is_permanent_after?: boolean | null
          is_permanent_before?: boolean | null
          is_permanent_grant?: boolean
          note?: string | null
          operation: string
          paid_until_after?: string | null
          paid_until_before?: string | null
          restricted_until_after?: string | null
          restricted_until_before?: string | null
          source?: string
          status_after?: string | null
          status_before?: string | null
        }
        Update: {
          admin_email?: string | null
          admin_id?: string | null
          amount?: number | null
          business_id?: string
          created_at?: string
          duration_seconds?: number | null
          duration_unit?: string | null
          enabled_after?: boolean | null
          enabled_before?: boolean | null
          grace_until_after?: string | null
          grace_until_before?: string | null
          id?: string
          idempotency_key?: string
          is_permanent_after?: boolean | null
          is_permanent_before?: boolean | null
          is_permanent_grant?: boolean
          note?: string | null
          operation?: string
          paid_until_after?: string | null
          paid_until_before?: string | null
          restricted_until_after?: string | null
          restricted_until_before?: string | null
          source?: string
          status_after?: string | null
          status_before?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      account_assistance_grants: {
        Row: {
          business_id: string
          created_at: string
          dismissed_at: string | null
          dismissed_by_user_id: string | null
          expires_at: string
          id: string
          requested_by_user_id: string
          revoked_at: string | null
          revoked_by_user_id: string | null
          starts_at: string
          status: string
          support_user_id: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          dismissed_at?: string | null
          dismissed_by_user_id?: string | null
          expires_at: string
          id?: string
          requested_by_user_id: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          starts_at?: string
          status?: string
          support_user_id: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          dismissed_at?: string | null
          dismissed_by_user_id?: string | null
          expires_at?: string
          id?: string
          requested_by_user_id?: string
          revoked_at?: string | null
          revoked_by_user_id?: string | null
          starts_at?: string
          status?: string
          support_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_assistance_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      account_assistance_support_users: {
        Row: {
          created_at: string
          email: string
          enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      allowed_emails: {
        Row: {
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_reason: string | null
          email: string
          enabled: boolean
          id: string
          note: string | null
          onboarding_mode: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          email: string
          enabled?: boolean
          id?: string
          note?: string | null
          onboarding_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          email?: string
          enabled?: boolean
          id?: string
          note?: string | null
          onboarding_mode?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      appointment_google_calendar_events: {
        Row: {
          appointment_id: string
          attempt_count: number
          business_id: string
          calendar_id: string
          claimed_at: string | null
          connection_id: string
          created_at: string
          event_id: string | null
          id: string
          last_attempt_at: string | null
          last_error_at: string | null
          last_error_code: string | null
          last_synced_at: string | null
          next_attempt_at: string
          sync_status: string
          synced_sequence: number
          updated_at: string
        }
        Insert: {
          appointment_id: string
          attempt_count?: number
          business_id: string
          calendar_id?: string
          claimed_at?: string | null
          connection_id: string
          created_at?: string
          event_id?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          last_synced_at?: string | null
          next_attempt_at?: string
          sync_status?: string
          synced_sequence?: number
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          attempt_count?: number
          business_id?: string
          calendar_id?: string
          claimed_at?: string | null
          connection_id?: string
          created_at?: string
          event_id?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error_at?: string | null
          last_error_code?: string | null
          last_synced_at?: string | null
          next_attempt_at?: string
          sync_status?: string
          synced_sequence?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_google_calendar_eve_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "appointment_google_calendar_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointment_google_calendar_events_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "google_calendar_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_professionals: {
        Row: {
          appointment_id: string
          base_blocking_ends_at: string
          base_blocking_starts_at: string
          blocking_ends_at: string
          blocking_starts_at: string
          break_minutes_snapshot: number
          business_id: string
          created_at: string
          ends_at: string
          id: string
          ignore_break: boolean
          is_primary: boolean
          position: number
          professional_id: string
          professional_name_snapshot: string
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          base_blocking_ends_at: string
          base_blocking_starts_at: string
          blocking_ends_at: string
          blocking_starts_at: string
          break_minutes_snapshot?: number
          business_id: string
          created_at?: string
          ends_at: string
          id?: string
          ignore_break?: boolean
          is_primary?: boolean
          position: number
          professional_id: string
          professional_name_snapshot: string
          starts_at: string
          status: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          base_blocking_ends_at?: string
          base_blocking_starts_at?: string
          blocking_ends_at?: string
          blocking_starts_at?: string
          break_minutes_snapshot?: number
          business_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          ignore_break?: boolean
          is_primary?: boolean
          position?: number
          professional_id?: string
          professional_name_snapshot?: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_professionals_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "appointment_professionals_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      appointments: {
        Row: {
          attended_at: string | null
          blocking_ends_at: string
          blocking_starts_at: string
          break_minutes_snapshot: number
          buffer_after_minutes_snapshot: number
          buffer_before_minutes_snapshot: number
          business_id: string
          calendar_action_at: string | null
          calendar_action_count: number
          calendar_action_status: string
          calendar_offered_at: string | null
          calendar_provider: string | null
          calendar_sequence: number
          calendar_update_required_at: string | null
          cancelled_at: string | null
          cancelled_by_user_id: string | null
          cancelled_reason: string | null
          confirmation_token: string
          confirmed_at: string | null
          created_at: string
          created_by_user_id: string | null
          duration_minutes_snapshot: number
          ends_at: string
          id: string
          ignore_break: boolean
          internal_note: string | null
          no_show_at: string | null
          patient_id: string
          professional_id: string
          professional_name_snapshot: string
          reminder_due_at: string | null
          reschedule_requested_at: string | null
          service_id: string
          service_name_snapshot: string
          source: string
          starts_at: string
          status: string
          updated_at: string
          updated_by_user_id: string | null
          whatsapp_opt_in_at: string | null
          whatsapp_opt_in_source: string | null
          whatsapp_opt_in_text: string | null
          whatsapp_reminder_marked_sent_at: string | null
          whatsapp_reminder_marked_sent_by: string | null
          whatsapp_reminder_opened_at: string | null
          whatsapp_reminder_opened_by: string | null
        }
        Insert: {
          attended_at?: string | null
          blocking_ends_at: string
          blocking_starts_at: string
          break_minutes_snapshot?: number
          buffer_after_minutes_snapshot?: number
          buffer_before_minutes_snapshot?: number
          business_id: string
          calendar_action_at?: string | null
          calendar_action_count?: number
          calendar_action_status?: string
          calendar_offered_at?: string | null
          calendar_provider?: string | null
          calendar_sequence?: number
          calendar_update_required_at?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          cancelled_reason?: string | null
          confirmation_token?: string
          confirmed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          duration_minutes_snapshot: number
          ends_at: string
          id?: string
          ignore_break?: boolean
          internal_note?: string | null
          no_show_at?: string | null
          patient_id: string
          professional_id: string
          professional_name_snapshot: string
          reminder_due_at?: string | null
          reschedule_requested_at?: string | null
          service_id: string
          service_name_snapshot: string
          source?: string
          starts_at: string
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
          whatsapp_opt_in_at?: string | null
          whatsapp_opt_in_source?: string | null
          whatsapp_opt_in_text?: string | null
          whatsapp_reminder_marked_sent_at?: string | null
          whatsapp_reminder_marked_sent_by?: string | null
          whatsapp_reminder_opened_at?: string | null
          whatsapp_reminder_opened_by?: string | null
        }
        Update: {
          attended_at?: string | null
          blocking_ends_at?: string
          blocking_starts_at?: string
          break_minutes_snapshot?: number
          buffer_after_minutes_snapshot?: number
          buffer_before_minutes_snapshot?: number
          business_id?: string
          calendar_action_at?: string | null
          calendar_action_count?: number
          calendar_action_status?: string
          calendar_offered_at?: string | null
          calendar_provider?: string | null
          calendar_sequence?: number
          calendar_update_required_at?: string | null
          cancelled_at?: string | null
          cancelled_by_user_id?: string | null
          cancelled_reason?: string | null
          confirmation_token?: string
          confirmed_at?: string | null
          created_at?: string
          created_by_user_id?: string | null
          duration_minutes_snapshot?: number
          ends_at?: string
          id?: string
          ignore_break?: boolean
          internal_note?: string | null
          no_show_at?: string | null
          patient_id?: string
          professional_id?: string
          professional_name_snapshot?: string
          reminder_due_at?: string | null
          reschedule_requested_at?: string | null
          service_id?: string
          service_name_snapshot?: string
          source?: string
          starts_at?: string
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
          whatsapp_opt_in_at?: string | null
          whatsapp_opt_in_source?: string | null
          whatsapp_opt_in_text?: string | null
          whatsapp_reminder_marked_sent_at?: string | null
          whatsapp_reminder_marked_sent_by?: string | null
          whatsapp_reminder_opened_at?: string | null
          whatsapp_reminder_opened_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_business_id_patient_id_fkey"
            columns: ["business_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "appointments_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "appointments_business_id_service_id_fkey"
            columns: ["business_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          business_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_exceptions: {
        Row: {
          business_id: string
          created_at: string
          ends_at: string
          id: string
          professional_id: string | null
          reason: string | null
          starts_at: string
          type: string
        }
        Insert: {
          business_id: string
          created_at?: string
          ends_at: string
          id?: string
          professional_id?: string | null
          reason?: string | null
          starts_at: string
          type: string
        }
        Update: {
          business_id?: string
          created_at?: string
          ends_at?: string
          id?: string
          professional_id?: string | null
          reason?: string | null
          starts_at?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_exceptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_exceptions_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          break_minutes: number
          business_id: string
          created_at: string
          end_time: string
          id: string
          is_active: boolean
          professional_id: string
          slot_interval_minutes: number
          start_time: string
          weekday: number
        }
        Insert: {
          break_minutes?: number
          business_id: string
          created_at?: string
          end_time: string
          id?: string
          is_active?: boolean
          professional_id: string
          slot_interval_minutes?: number
          start_time: string
          weekday: number
        }
        Update: {
          break_minutes?: number
          business_id?: string
          created_at?: string
          end_time?: string
          id?: string
          is_active?: boolean
          professional_id?: string
          slot_interval_minutes?: number
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_rules_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      business_data_revisions: {
        Row: {
          business_id: string
          patients_revision: number
          realtime_topic_token: string
          updated_at: string
        }
        Insert: {
          business_id: string
          patients_revision?: number
          realtime_topic_token?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          patients_revision?: number
          realtime_topic_token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_data_revisions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_subscriptions: {
        Row: {
          access_note: string | null
          access_source: string
          access_starts_at: string
          archived_at: string | null
          business_id: string
          commercial_access_enabled: boolean
          created_at: string
          expiration_notice_enabled: boolean
          grace_until: string | null
          id: string
          is_permanent: boolean
          last_grant_duration_seconds: number | null
          last_payment_amount: number | null
          last_payment_at: string | null
          paid_until: string | null
          restricted_until: string | null
          subscription_status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          access_note?: string | null
          access_source?: string
          access_starts_at?: string
          archived_at?: string | null
          business_id: string
          commercial_access_enabled?: boolean
          created_at?: string
          expiration_notice_enabled?: boolean
          grace_until?: string | null
          id?: string
          is_permanent?: boolean
          last_grant_duration_seconds?: number | null
          last_payment_amount?: number | null
          last_payment_at?: string | null
          paid_until?: string | null
          restricted_until?: string | null
          subscription_status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          access_note?: string | null
          access_source?: string
          access_starts_at?: string
          archived_at?: string | null
          business_id?: string
          commercial_access_enabled?: boolean
          created_at?: string
          expiration_notice_enabled?: boolean
          grace_until?: string | null
          id?: string
          is_permanent?: boolean
          last_grant_duration_seconds?: number | null
          last_payment_amount?: number | null
          last_payment_at?: string | null
          paid_until?: string | null
          restricted_until?: string | null
          subscription_status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_user_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          business_id: string
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          professional_id: string | null
          role: string
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          business_id: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          professional_id?: string | null
          role: string
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          business_id?: string
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          professional_id?: string | null
          role?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_user_invites_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_user_invites_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "business_user_invites_business_professional_fk"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      business_users: {
        Row: {
          accepted_at: string | null
          business_id: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_reason: string | null
          id: string
          role: string
          status: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          id?: string
          role: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_reason?: string | null
          id?: string
          role?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address: string | null
          address_instructions: string | null
          allow_same_day_booking: boolean
          cancellation_policy: string | null
          created_at: string
          email: string | null
          id: string
          industry: string
          is_active: boolean
          logo_url: string | null
          maps_url: string | null
          max_booking_days_ahead: number
          min_booking_notice_minutes: number
          name: string
          phone: string | null
          public_booking_enabled: boolean
          slug: string
          timezone: string
          updated_at: string
          whatsapp_enabled: boolean
        }
        Insert: {
          address?: string | null
          address_instructions?: string | null
          allow_same_day_booking?: boolean
          cancellation_policy?: string | null
          created_at?: string
          email?: string | null
          id?: string
          industry: string
          is_active?: boolean
          logo_url?: string | null
          maps_url?: string | null
          max_booking_days_ahead?: number
          min_booking_notice_minutes?: number
          name: string
          phone?: string | null
          public_booking_enabled?: boolean
          slug: string
          timezone?: string
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Update: {
          address?: string | null
          address_instructions?: string | null
          allow_same_day_booking?: boolean
          cancellation_policy?: string | null
          created_at?: string
          email?: string | null
          id?: string
          industry?: string
          is_active?: boolean
          logo_url?: string | null
          maps_url?: string | null
          max_booking_days_ahead?: number
          min_booking_notice_minutes?: number
          name?: string
          phone?: string | null
          public_booking_enabled?: boolean
          slug?: string
          timezone?: string
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Relationships: []
      }
      clinical_entries: {
        Row: {
          amount: number | null
          archived_at: string | null
          business_id: string | null
          created_at: string
          created_by_professional_id: string | null
          created_by_user_id: string | null
          description: string
          entry_type: string
          id: string
          internal_note: string | null
          locked_after: string | null
          owner_id: string | null
          patient_id: string
          teeth: string | null
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          amount?: number | null
          archived_at?: string | null
          business_id?: string | null
          created_at?: string
          created_by_professional_id?: string | null
          created_by_user_id?: string | null
          description: string
          entry_type: string
          id?: string
          internal_note?: string | null
          locked_after?: string | null
          owner_id?: string | null
          patient_id: string
          teeth?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          amount?: number | null
          archived_at?: string | null
          business_id?: string | null
          created_at?: string
          created_by_professional_id?: string | null
          created_by_user_id?: string | null
          description?: string
          entry_type?: string
          id?: string
          internal_note?: string | null
          locked_after?: string | null
          owner_id?: string | null
          patient_id?: string
          teeth?: string | null
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_entries_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      clinical_entry_costs: {
        Row: {
          amount: number | null
          business_id: string
          clinical_entry_id: string
          created_at: string
          created_by: string | null
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount?: number | null
          business_id: string
          clinical_entry_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number | null
          business_id?: string
          clinical_entry_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinical_entry_costs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinical_entry_costs_clinical_entry_id_fkey"
            columns: ["clinical_entry_id"]
            isOneToOne: false
            referencedRelation: "clinical_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_connections: {
        Row: {
          connected_email: string | null
          created_at: string
          owner_id: string
          provider: string
          root_folder_id: string | null
          updated_at: string
        }
        Insert: {
          connected_email?: string | null
          created_at?: string
          owner_id: string
          provider?: string
          root_folder_id?: string | null
          updated_at?: string
        }
        Update: {
          connected_email?: string | null
          created_at?: string
          owner_id?: string
          provider?: string
          root_folder_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      follow_ups: {
        Row: {
          assigned_professional_id: string | null
          business_id: string
          created_at: string
          created_by: string | null
          done_at: string | null
          id: string
          message: string | null
          patient_id: string
          remind_on: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_professional_id?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          id?: string
          message?: string | null
          patient_id: string
          remind_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_professional_id?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          done_at?: string | null
          id?: string
          message?: string | null
          patient_id?: string
          remind_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_assigned_professional_id_fkey"
            columns: ["assigned_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_connections: {
        Row: {
          created_at: string
          google_subject: string
          granted_scopes: string[]
          id: string
          last_error_code: string | null
          last_refresh_at: string | null
          oauth_client_key: string
          refresh_token_ciphertext: string | null
          revoked_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          google_subject: string
          granted_scopes?: string[]
          id?: string
          last_error_code?: string | null
          last_refresh_at?: string | null
          oauth_client_key: string
          refresh_token_ciphertext?: string | null
          revoked_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          google_subject?: string
          granted_scopes?: string[]
          id?: string
          last_error_code?: string | null
          last_refresh_at?: string | null
          oauth_client_key?: string
          refresh_token_ciphertext?: string | null
          revoked_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      google_calendar_oauth_attempts: {
        Row: {
          appointment_id: string
          business_id: string
          code_verifier_ciphertext: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          force_consent: boolean
          id: string
          state_hash: string
        }
        Insert: {
          appointment_id: string
          business_id: string
          code_verifier_ciphertext: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          force_consent?: boolean
          id?: string
          state_hash: string
        }
        Update: {
          appointment_id?: string
          business_id?: string
          code_verifier_ciphertext?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          force_consent?: boolean
          id?: string
          state_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_oauth_attempts_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "google_calendar_oauth_attempts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      inbound_messages: {
        Row: {
          business_id: string
          created_at: string
          from_phone_e164: string
          id: string
          messaging_account_id: string | null
          provider: string
          provider_message_id: string
          raw_payload: Json | null
          received_at: string
          requires_human: boolean
          text: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          from_phone_e164: string
          id?: string
          messaging_account_id?: string | null
          provider?: string
          provider_message_id: string
          raw_payload?: Json | null
          received_at?: string
          requires_human?: boolean
          text?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          from_phone_e164?: string
          id?: string
          messaging_account_id?: string | null
          provider?: string
          provider_message_id?: string
          raw_payload?: Json | null
          received_at?: string
          requires_human?: boolean
          text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inbound_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inbound_messages_business_id_messaging_account_id_fkey"
            columns: ["business_id", "messaging_account_id"]
            isOneToOne: false
            referencedRelation: "messaging_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      message_dispatches: {
        Row: {
          appointment_id: string | null
          attempts: number
          business_id: string
          cancelled_at: string | null
          channel: string
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          human_error_message: string | null
          id: string
          last_error_code: string | null
          last_error_message: string | null
          max_attempts: number
          message_body: string | null
          messaging_account_id: string | null
          metadata: Json | null
          patient_id: string | null
          provider: string
          provider_message_id: string | null
          queued_at: string | null
          raw_request: Json | null
          raw_response: Json | null
          read_at: string | null
          scheduled_for: string | null
          sending_at: string | null
          sent_at: string | null
          skipped_at: string | null
          status: string
          template_id: string | null
          template_variables: Json
          to_phone_e164: string
          type: string
          updated_at: string
        }
        Insert: {
          appointment_id?: string | null
          attempts?: number
          business_id: string
          cancelled_at?: string | null
          channel?: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          human_error_message?: string | null
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          max_attempts?: number
          message_body?: string | null
          messaging_account_id?: string | null
          metadata?: Json | null
          patient_id?: string | null
          provider?: string
          provider_message_id?: string | null
          queued_at?: string | null
          raw_request?: Json | null
          raw_response?: Json | null
          read_at?: string | null
          scheduled_for?: string | null
          sending_at?: string | null
          sent_at?: string | null
          skipped_at?: string | null
          status?: string
          template_id?: string | null
          template_variables?: Json
          to_phone_e164: string
          type: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string | null
          attempts?: number
          business_id?: string
          cancelled_at?: string | null
          channel?: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          human_error_message?: string | null
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          max_attempts?: number
          message_body?: string | null
          messaging_account_id?: string | null
          metadata?: Json | null
          patient_id?: string | null
          provider?: string
          provider_message_id?: string | null
          queued_at?: string | null
          raw_request?: Json | null
          raw_response?: Json | null
          read_at?: string | null
          scheduled_for?: string | null
          sending_at?: string | null
          sent_at?: string | null
          skipped_at?: string | null
          status?: string
          template_id?: string | null
          template_variables?: Json
          to_phone_e164?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_dispatches_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "message_dispatches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_dispatches_business_id_messaging_account_id_fkey"
            columns: ["business_id", "messaging_account_id"]
            isOneToOne: false
            referencedRelation: "messaging_accounts"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "message_dispatches_business_id_patient_id_fkey"
            columns: ["business_id", "patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "message_dispatches_business_id_template_id_fkey"
            columns: ["business_id", "template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          business_id: string
          category: string
          created_at: string
          id: string
          language: string
          name: string
          provider: string
          provider_template_id: string | null
          rejection_reason: string | null
          status: string
          updated_at: string
        }
        Insert: {
          body: string
          business_id: string
          category: string
          created_at?: string
          id?: string
          language?: string
          name: string
          provider?: string
          provider_template_id?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          body?: string
          business_id?: string
          category?: string
          created_at?: string
          id?: string
          language?: string
          name?: string
          provider?: string
          provider_template_id?: string | null
          rejection_reason?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      messaging_accounts: {
        Row: {
          access_token_secret_name: string | null
          bot_enabled: boolean
          business_id: string
          created_at: string
          display_name: string | null
          id: string
          last_error: string | null
          phone_number: string | null
          phone_number_id: string | null
          provider: string
          reminders_enabled: boolean
          status: string
          updated_at: string
          waba_id: string | null
        }
        Insert: {
          access_token_secret_name?: string | null
          bot_enabled?: boolean
          business_id: string
          created_at?: string
          display_name?: string | null
          id?: string
          last_error?: string | null
          phone_number?: string | null
          phone_number_id?: string | null
          provider?: string
          reminders_enabled?: boolean
          status?: string
          updated_at?: string
          waba_id?: string | null
        }
        Update: {
          access_token_secret_name?: string | null
          bot_enabled?: boolean
          business_id?: string
          created_at?: string
          display_name?: string | null
          id?: string
          last_error?: string | null
          phone_number?: string | null
          phone_number_id?: string | null
          provider?: string
          reminders_enabled?: boolean
          status?: string
          updated_at?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messaging_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_subscriptions: {
        Row: {
          business_id: string
          created_at: string
          currency_id: string | null
          id: string
          last_synced_at: string
          next_charge_at: string | null
          payer_email: string | null
          preapproval_id: string
          raw: Json | null
          status: string
          transaction_amount: number | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          currency_id?: string | null
          id?: string
          last_synced_at?: string
          next_charge_at?: string | null
          payer_email?: string | null
          preapproval_id: string
          raw?: Json | null
          status?: string
          transaction_amount?: number | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          currency_id?: string | null
          id?: string
          last_synced_at?: string
          next_charge_at?: string | null
          payer_email?: string | null
          preapproval_id?: string
          raw?: Json | null
          status?: string
          transaction_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mp_subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_webhook_events: {
        Row: {
          action: string | null
          business_id: string | null
          credited_grant_id: string | null
          id: string
          live_mode: boolean | null
          processing_detail: string | null
          processing_status: string
          raw: Json | null
          received_at: string
          request_id: string | null
          requires_attention: boolean
          resource_id: string | null
          signature_valid: boolean
          topic: string | null
        }
        Insert: {
          action?: string | null
          business_id?: string | null
          credited_grant_id?: string | null
          id?: string
          live_mode?: boolean | null
          processing_detail?: string | null
          processing_status?: string
          raw?: Json | null
          received_at?: string
          request_id?: string | null
          requires_attention?: boolean
          resource_id?: string | null
          signature_valid?: boolean
          topic?: string | null
        }
        Update: {
          action?: string | null
          business_id?: string | null
          credited_grant_id?: string | null
          id?: string
          live_mode?: boolean | null
          processing_detail?: string | null
          processing_status?: string
          raw?: Json | null
          received_at?: string
          request_id?: string | null
          requires_attention?: boolean
          resource_id?: string | null
          signature_valid?: boolean
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mp_webhook_events_credited_grant_id_fkey"
            columns: ["credited_grant_id"]
            isOneToOne: false
            referencedRelation: "access_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_clinical_profiles: {
        Row: {
          allergies: string | null
          background: string | null
          business_id: string
          clinical_alert_note: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json | null
          id: string
          medication: string | null
          notes: string | null
          patient_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          allergies?: string | null
          background?: string | null
          business_id: string
          clinical_alert_note?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json | null
          id?: string
          medication?: string | null
          notes?: string | null
          patient_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          allergies?: string | null
          background?: string | null
          business_id?: string
          clinical_alert_note?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json | null
          id?: string
          medication?: string | null
          notes?: string | null
          patient_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_clinical_profiles_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_clinical_profiles_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_profile_change_events: {
        Row: {
          business_id: string
          changed_by_name: string
          changed_by_professional_id: string | null
          changed_by_user_id: string | null
          changed_fields: Json
          created_at: string
          id: string
          patient_id: string
          summary: string
        }
        Insert: {
          business_id: string
          changed_by_name: string
          changed_by_professional_id?: string | null
          changed_by_user_id?: string | null
          changed_fields?: Json
          created_at?: string
          id?: string
          patient_id: string
          summary: string
        }
        Update: {
          business_id?: string
          changed_by_name?: string
          changed_by_professional_id?: string | null
          changed_by_user_id?: string | null
          changed_fields?: Json
          created_at?: string
          id?: string
          patient_id?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_profile_change_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_profile_change_events_changed_by_professional_id_fkey"
            columns: ["changed_by_professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_profile_change_events_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_radiographs: {
        Row: {
          business_id: string | null
          bytes: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          drive_file_id: string | null
          id: string
          mime_type: string | null
          note: string | null
          original_filename: string | null
          owner_id: string
          patient_id: string
          sha256: string | null
          status: string
          taken_at: string | null
        }
        Insert: {
          business_id?: string | null
          bytes?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          drive_file_id?: string | null
          id?: string
          mime_type?: string | null
          note?: string | null
          original_filename?: string | null
          owner_id: string
          patient_id: string
          sha256?: string | null
          status?: string
          taken_at?: string | null
        }
        Update: {
          business_id?: string | null
          bytes?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          drive_file_id?: string | null
          id?: string
          mime_type?: string | null
          note?: string | null
          original_filename?: string | null
          owner_id?: string
          patient_id?: string
          sha256?: string | null
          status?: string
          taken_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_radiographs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patient_radiographs_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
        ]
      }
      patients: {
        Row: {
          address: string | null
          allergies: string | null
          archived_at: string | null
          background: string | null
          birth_date: string | null
          blocked: boolean
          business_id: string | null
          created_at: string
          custom_fields: Json | null
          dni: string | null
          drive_folder_id: string | null
          email: string | null
          full_name: string
          id: string
          insurance: string | null
          insurance_plan: string | null
          last_entry_at: string | null
          medication: string | null
          notes: string | null
          owner_id: string | null
          phone: string | null
          phone_e164: string | null
          phone_raw: string | null
          spam_score: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          allergies?: string | null
          archived_at?: string | null
          background?: string | null
          birth_date?: string | null
          blocked?: boolean
          business_id?: string | null
          created_at?: string
          custom_fields?: Json | null
          dni?: string | null
          drive_folder_id?: string | null
          email?: string | null
          full_name: string
          id?: string
          insurance?: string | null
          insurance_plan?: string | null
          last_entry_at?: string | null
          medication?: string | null
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          phone_e164?: string | null
          phone_raw?: string | null
          spam_score?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          allergies?: string | null
          archived_at?: string | null
          background?: string | null
          birth_date?: string | null
          blocked?: boolean
          business_id?: string | null
          created_at?: string
          custom_fields?: Json | null
          dni?: string | null
          drive_folder_id?: string | null
          email?: string | null
          full_name?: string
          id?: string
          insurance?: string | null
          insurance_plan?: string | null
          last_entry_at?: string | null
          medication?: string | null
          notes?: string | null
          owner_id?: string | null
          phone?: string | null
          phone_e164?: string | null
          phone_raw?: string | null
          spam_score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_patient_links: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          business_id: string
          created_at: string
          created_by: string | null
          disabled_at: string | null
          disabled_by: string | null
          disabled_reason: string | null
          id: string
          is_active: boolean
          patient_id: string
          professional_id: string
          source: string
          source_entity_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          id?: string
          is_active?: boolean
          patient_id: string
          professional_id: string
          source?: string
          source_entity_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          disabled_at?: string | null
          disabled_by?: string | null
          disabled_reason?: string | null
          id?: string
          is_active?: boolean
          patient_id?: string
          professional_id?: string
          source?: string
          source_entity_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_patient_links_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_patient_links_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_patient_links_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_services: {
        Row: {
          business_id: string
          created_at: string
          id: string
          professional_id: string
          service_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          professional_id: string
          service_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          professional_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_services_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_services_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "professional_services_business_id_service_id_fkey"
            columns: ["business_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      professional_users: {
        Row: {
          business_id: string
          created_at: string
          id: string
          professional_id: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          professional_id: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          professional_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "professional_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_users_business_id_professional_id_fkey"
            columns: ["business_id", "professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
      professionals: {
        Row: {
          avatar_url: string | null
          business_id: string
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          is_public: boolean
          name: string
          phone: string | null
          sort_order: number
          specialty: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          business_id: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_public?: boolean
          name: string
          phone?: string | null
          sort_order?: number
          specialty?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          business_id?: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_public?: boolean
          name?: string
          phone?: string | null
          sort_order?: number
          specialty?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "professionals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      public_booking_attempts: {
        Row: {
          action: string
          business_id: string | null
          created_at: string
          error_code: string | null
          id: string
          ip_hash: string | null
          metadata: Json | null
          phone_e164: string | null
          success: boolean
          user_agent: string | null
        }
        Insert: {
          action: string
          business_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          ip_hash?: string | null
          metadata?: Json | null
          phone_e164?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Update: {
          action?: string
          business_id?: string | null
          created_at?: string
          error_code?: string | null
          id?: string
          ip_hash?: string | null
          metadata?: Json | null
          phone_e164?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "public_booking_attempts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      push_delivery_attempts: {
        Row: {
          accepted_at: string | null
          appointment_id: string
          business_id: string
          clicked_at: string | null
          created_at: string
          displayed_at: string | null
          expires_at: string
          failed_at: string | null
          failure_kind: string | null
          id: string
          kind: string
          push_service_status: number | null
          receipt_token_hash: string
          received_at: string | null
          request_key_hash: string | null
          subscription_id: string
          superseded_at: string | null
          updated_at: string
          user_confirmed_at: string | null
          user_reported_missing_at: string | null
        }
        Insert: {
          accepted_at?: string | null
          appointment_id: string
          business_id: string
          clicked_at?: string | null
          created_at?: string
          displayed_at?: string | null
          expires_at: string
          failed_at?: string | null
          failure_kind?: string | null
          id?: string
          kind: string
          push_service_status?: number | null
          receipt_token_hash: string
          received_at?: string | null
          request_key_hash?: string | null
          subscription_id: string
          superseded_at?: string | null
          updated_at?: string
          user_confirmed_at?: string | null
          user_reported_missing_at?: string | null
        }
        Update: {
          accepted_at?: string | null
          appointment_id?: string
          business_id?: string
          clicked_at?: string | null
          created_at?: string
          displayed_at?: string | null
          expires_at?: string
          failed_at?: string | null
          failure_kind?: string | null
          id?: string
          kind?: string
          push_service_status?: number | null
          receipt_token_hash?: string
          received_at?: string | null
          request_key_hash?: string | null
          subscription_id?: string
          superseded_at?: string | null
          updated_at?: string
          user_confirmed_at?: string | null
          user_reported_missing_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_delivery_attempts_business_id_appointment_id_fkey"
            columns: ["business_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["business_id", "id"]
          },
          {
            foreignKeyName: "push_delivery_attempts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_delivery_attempts_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "push_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          appointment_id: string
          auth: string
          business_id: string
          created_at: string
          endpoint: string
          failed_count: number
          id: string
          p256dh: string
          push_24h_claimed_at: string | null
          push_24h_sent_at: string | null
          push_2h_claimed_at: string | null
          push_2h_sent_at: string | null
          revoked_at: string | null
          updated_at: string
          user_agent: string | null
          verified_at: string | null
        }
        Insert: {
          appointment_id: string
          auth: string
          business_id: string
          created_at?: string
          endpoint: string
          failed_count?: number
          id?: string
          p256dh: string
          push_24h_claimed_at?: string | null
          push_24h_sent_at?: string | null
          push_2h_claimed_at?: string | null
          push_2h_sent_at?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          verified_at?: string | null
        }
        Update: {
          appointment_id?: string
          auth?: string
          business_id?: string
          created_at?: string
          endpoint?: string
          failed_count?: number
          id?: string
          p256dh?: string
          push_24h_claimed_at?: string | null
          push_24h_sent_at?: string | null
          push_2h_claimed_at?: string | null
          push_2h_sent_at?: string | null
          revoked_at?: string | null
          updated_at?: string
          user_agent?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      server_rate_limit_events: {
        Row: {
          action: string
          created_at: string
          id: string
          subject_hash: string
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          subject_hash: string
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          subject_hash?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          buffer_after_minutes: number
          buffer_before_minutes: number
          business_id: string
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          is_public: boolean
          name: string
          price_label: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          business_id: string
          created_at?: string
          description?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          is_public?: boolean
          name: string
          price_label?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          business_id?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          is_public?: boolean
          name?: string
          price_label?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_webhook_events: {
        Row: {
          business_id: string | null
          created_at: string
          event_type: string
          id: string
          messaging_account_id: string | null
          payload: Json
          processed: boolean
          processed_at: string | null
          processing_error: string | null
          provider: string
          provider_event_id: string | null
          received_at: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          messaging_account_id?: string | null
          payload: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_event_id?: string | null
          received_at?: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          messaging_account_id?: string | null
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          provider?: string
          provider_event_id?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_webhook_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_webhook_events_business_id_messaging_account_id_fkey"
            columns: ["business_id", "messaging_account_id"]
            isOneToOne: false
            referencedRelation: "messaging_accounts"
            referencedColumns: ["business_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_account_assistance: {
        Args: { target_support_user_id: string; target_business_id: string }
        Returns: {
          created_at: string
          revoked_at: string
          expires_at: string
          starts_at: string
          status: string
          support_user_id: string
          requested_by_user_id: string
          business_id: string
          id: string
          updated_at: string
          dismissed_at: string
        }[]
      }
      add_business_user_by_email: {
        Args: {
          target_business_id: string
          target_email: string
          target_role: string
        }
        Returns: string
      }
      assert_email_available_for_business: {
        Args: { target_business_id: string; target_email: string }
        Returns: undefined
      }
      audit_security_event: {
        Args: {
          p_metadata: Json
          p_entity_id: string
          p_outcome: string
          p_reason: string
          p_business_id: string
          p_actor_id: string
          p_action: string
          p_entity_type: string
        }
        Returns: undefined
      }
      authorize_google_calendar_event: {
        Args: {
          p_oauth_client_key: string
          p_appointment_id: string
          p_google_subject: string
          p_refresh_token_ciphertext: string
          p_granted_scopes: string[]
          p_now?: string
        }
        Returns: {
          connection_row_id: string
          event_row_id: string
        }[]
      }
      business_allows_operation: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      business_allows_owner_restricted_read: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      cancel_business_role_invite: {
        Args: { target_invite_id: string }
        Returns: undefined
      }
      claim_due_push_reminders: {
        Args: { claim_limit?: number; claim_now: string }
        Returns: {
          auth: string
          endpoint: string
          business_id: string
          appointment_id: string
          subscription_id: string
          p256dh: string
          reminder_kind: string
        }[]
      }
      claim_google_calendar_sync_jobs: {
        Args: { claim_now: string; claim_limit?: number }
        Returns: {
          event_row_id: string
        }[]
      }
      claim_queued_message_dispatches: {
        Args: { claim_limit?: number; claim_now?: string }
        Returns: {
          appointment_id: string | null
          attempts: number
          business_id: string
          cancelled_at: string | null
          channel: string
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          human_error_message: string | null
          id: string
          last_error_code: string | null
          last_error_message: string | null
          max_attempts: number
          message_body: string | null
          messaging_account_id: string | null
          metadata: Json | null
          patient_id: string | null
          provider: string
          provider_message_id: string | null
          queued_at: string | null
          raw_request: Json | null
          raw_response: Json | null
          read_at: string | null
          scheduled_for: string | null
          sending_at: string | null
          sent_at: string | null
          skipped_at: string | null
          status: string
          template_id: string | null
          template_variables: Json
          to_phone_e164: string
          type: string
          updated_at: string
        }[]
      }
      clear_patient_drive_folders_safely: {
        Args: { p_business_id: string }
        Returns: undefined
      }
      complete_google_calendar_event_delete: {
        Args: { p_now?: string; p_event_row_id: string }
        Returns: string
      }
      complete_google_calendar_event_sync: {
        Args: {
          p_google_event_id: string
          p_event_row_id: string
          p_now?: string
          p_synced_sequence: number
        }
        Returns: string
      }
      compute_business_subscription_status: {
        Args: {
          p_archived_at: string
          p_commercial_access_enabled: boolean
          p_paid_until: string
          p_restricted_until: string
          p_grace_until: string
          p_is_permanent: boolean
        }
        Returns: string
      }
      consume_google_calendar_oauth_attempt: {
        Args: { p_state_hash: string; p_now?: string }
        Returns: {
          appointment_id: string
          code_verifier_ciphertext: string
          force_consent: boolean
          business_id: string
          attempt_id: string
        }[]
      }
      consume_server_rate_limit: {
        Args: {
          p_action: string
          p_subject_hash: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
          used: number
        }[]
      }
      consume_server_rate_limits: {
        Args: { p_action: string; p_windows: Json; p_subject_hash: string }
        Returns: {
          allowed: boolean
          retry_after_seconds: number
          used: number
        }[]
      }
      count_active_business_owners: {
        Args: { target_business_id: string }
        Returns: number
      }
      create_clinical_entry_safely: {
        Args: {
          p_business_id: string
          p_patient_id: string
          p_internal_note?: string
          p_teeth?: string
          p_created_at?: string
          p_amount?: number
          p_entry_type: string
          p_description: string
        }
        Returns: string
      }
      create_joint_appointment: {
        Args: {
          p_internal_note?: string
          p_professional_ids: string[]
          p_service_id: string
          p_patient_id: string
          p_business_id: string
          p_created_by_user_id?: string
          p_ignore_break?: boolean
          p_starts_at: string
        }
        Returns: {
          professional_name_snapshot: string
          service_name_snapshot: string
          ends_at: string
          starts_at: string
          confirmation_token: string
          id: string
        }[]
      }
      create_joint_appointment_with_source: {
        Args: {
          p_business_id: string
          p_patient_id: string
          p_service_id: string
          p_professional_ids: string[]
          p_starts_at: string
          p_internal_note: string
          p_created_by_user_id: string
          p_ignore_break: boolean
          p_source: string
        }
        Returns: {
          service_name_snapshot: string
          professional_name_snapshot: string
          id: string
          ends_at: string
          starts_at: string
          confirmation_token: string
        }[]
      }
      current_user_professional_id: {
        Args: { target_business_id: string }
        Returns: string
      }
      dismiss_account_assistance_notice: {
        Args: { target_grant_id: string; target_business_id: string }
        Returns: undefined
      }
      ensure_user_default_business: {
        Args: { p_industry?: string; p_name?: string }
        Returns: {
          role: string
          business_id: string
        }[]
      }
      fail_google_calendar_event_sync: {
        Args: {
          p_error_code: string
          p_next_attempt_at: string
          p_now?: string
          p_failure_category: string
          p_event_row_id: string
        }
        Returns: string
      }
      gbt_bit_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_bool_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_bool_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_bpchar_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_bytea_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_cash_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_cash_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_date_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_date_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_decompress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_enum_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_enum_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_float4_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_float4_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_float8_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_float8_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_inet_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int2_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int2_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int4_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int4_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int8_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_int8_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_intv_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_intv_decompress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_intv_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_macad_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_macad_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_macad8_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_macad8_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_numeric_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_oid_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_oid_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_text_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_time_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_time_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_timetz_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_ts_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_ts_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_tstz_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_uuid_compress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_uuid_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_var_decompress: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbt_var_fetch: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey_var_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey_var_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey16_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey16_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey2_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey2_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey32_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey32_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey4_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey4_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey8_in: {
        Args: { "": unknown }
        Returns: unknown
      }
      gbtreekey8_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      get_availability_snapshot: {
        Args: { p_from: string; p_business_id: string; p_to: string }
        Returns: Json
      }
      get_patient_data_revision: {
        Args: { p_business_id: string }
        Returns: {
          viewer_role: string
          can_create_patient: boolean
          business_id: string
          patients_revision: number
          realtime_topic: string
        }[]
      }
      get_patient_drive_folder_safely: {
        Args: { p_patient_id: string; p_business_id: string }
        Returns: string
      }
      get_public_booking_active_future_count_by_name: {
        Args: { p_business_id: string; p_now?: string; p_patient_name: string }
        Returns: number
      }
      grant_business_access: {
        Args: {
          p_duration_seconds: number
          p_idempotency_key: string
          p_admin_email: string
          p_admin_id: string
          p_note: string
          p_source: string
          p_amount: number
          p_is_permanent: boolean
          p_business_id: string
          p_operation: string
          p_duration_unit: string
        }
        Returns: {
          status_after: string
          paid_until_after: string
          paid_until_before: string
          grant_id: string
          applied: boolean
        }[]
      }
      is_email_enabled: {
        Args: { p_email: string }
        Returns: boolean
      }
      list_business_role_access: {
        Args: { target_business_id: string }
        Returns: {
          role: string
          email: string
          created_at: string
          professional_id: string
          id: string
          status: string
          business_id: string
          user_id: string
        }[]
      }
      list_business_users: {
        Args: { target_business_id: string }
        Returns: {
          created_at: string
          role: string
          email: string
          id: string
          business_id: string
          user_id: string
        }[]
      }
      list_user_business_contexts: {
        Args: Record<PropertyKey, never>
        Returns: {
          subscription: Json
          assistance: Json
          role: string
          business: Json
        }[]
      }
      normalize_phone_e164: {
        Args: { value: string }
        Returns: string
      }
      normalized_patient_name: {
        Args: { value: string }
        Returns: string
      }
      patients_counts_by_business: {
        Args: { p_business: string }
        Returns: {
          archived_count: number
          active_count: number
          total_count: number
        }[]
      }
      patients_counts_by_owner: {
        Args: { p_owner: string }
        Returns: {
          archived_count: number
          total_count: number
          active_count: number
        }[]
      }
      professional_break_minutes_at: {
        Args: {
          target_business_id: string
          target_professional_id: string
          target_starts_at: string
        }
        Returns: number
      }
      professional_update_appointment_status: {
        Args: {
          target_business_id: string
          target_appointment_id: string
          target_status: string
        }
        Returns: undefined
      }
      record_calendar_action: {
        Args: { p_action: string; p_appointment_id: string; p_provider: string }
        Returns: undefined
      }
      record_push_notification_click: {
        Args: {
          click_time?: string
          target_appointment_id: string
          target_delivery_id: string
          target_receipt_token_hash: string
        }
        Returns: boolean
      }
      record_push_test_feedback: {
        Args: {
          target_appointment_id: string
          target_delivery_id: string
          feedback_visible: boolean
          feedback_time?: string
        }
        Returns: boolean
      }
      remove_business_role_access: {
        Args: { target_access_id: string }
        Returns: undefined
      }
      replace_professional_availability_rules: {
        Args: {
          p_professional_id: string
          p_weekdays: number[]
          p_ranges: Json
          p_slot_interval_minutes: number
          p_business_id: string
        }
        Returns: {
          break_minutes: number
          business_id: string
          created_at: string
          end_time: string
          id: string
          is_active: boolean
          professional_id: string
          slot_interval_minutes: number
          start_time: string
          weekday: number
        }[]
      }
      request_google_calendar_event_deletion: {
        Args: { p_appointment_id: string; p_now?: string }
        Returns: string
      }
      revoke_account_assistance: {
        Args: { target_business_id: string }
        Returns: {
          support_user_id: string
          id: string
          business_id: string
          requested_by_user_id: string
          status: string
          starts_at: string
          expires_at: string
          revoked_at: string
          dismissed_at: string
          created_at: string
          updated_at: string
        }[]
      }
      set_patient_archive_state_safely: {
        Args: {
          p_patient_id: string
          p_archived: boolean
          p_business_id: string
        }
        Returns: undefined
      }
      set_patient_drive_folder_safely: {
        Args: {
          p_business_id: string
          p_patient_id: string
          p_drive_folder_id: string
        }
        Returns: undefined
      }
      slugify_business_slug: {
        Args: { value: string }
        Returns: string
      }
      update_business_role_access: {
        Args: { target_role: string; target_access_id: string }
        Returns: undefined
      }
      update_clinical_entry_safely: {
        Args: {
          p_entry_type: string
          p_amount?: number
          p_internal_note?: string
          p_teeth?: string
          p_business_id: string
          p_patient_id: string
          p_entry_id: string
          p_description: string
        }
        Returns: undefined
      }
      upsert_business_role_access: {
        Args: {
          target_email: string
          target_role: string
          target_business_id: string
          target_professional_id?: string
        }
        Returns: {
          status: string
          membership_id: string
          invite_id: string
          user_id: string
        }[]
      }
      upsert_patient_clinical_profile_safely: {
        Args: {
          p_patient_id: string
          p_allergies?: string
          p_medication?: string
          p_background?: string
          p_clinical_alert_note?: string
          p_notes?: string
          p_custom_fields?: Json
          p_business_id: string
        }
        Returns: string
      }
      user_business_role: {
        Args: { target_business_id: string }
        Returns: string
      }
      user_can_manage_business: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_can_operate_business: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_can_read_appointment: {
        Args: { target_business_id: string; target_appointment_id: string }
        Returns: boolean
      }
      user_can_read_basic_patient: {
        Args: { target_patient_id: string; target_business_id: string }
        Returns: boolean
      }
      user_can_read_clinical_patient: {
        Args: { target_patient_id: string; target_business_id: string }
        Returns: boolean
      }
      user_can_read_patient: {
        Args: { target_patient_id: string; target_business_id: string }
        Returns: boolean
      }
      user_can_read_professional_schedule: {
        Args: { target_business_id: string; target_professional_id: string }
        Returns: boolean
      }
      user_can_read_radiology_reference: {
        Args: { target_business_id: string; target_patient_id: string }
        Returns: boolean
      }
      user_can_view_costs: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_has_active_account_assistance: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_has_active_professional_patient_link: {
        Args: { target_patient_id: string; target_business_id: string }
        Returns: boolean
      }
      user_has_business_access: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      user_is_professional_for: {
        Args: { target_professional_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  storage: {
    Tables: {
      buckets: {
        Row: {
          created_at: string | null
          id: string
          name: string
          owner: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id: string
          name: string
          owner?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          owner?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      migrations: {
        Row: {
          executed_at: string | null
          hash: string
          id: number
          name: string
        }
        Insert: {
          executed_at?: string | null
          hash: string
          id: number
          name: string
        }
        Update: {
          executed_at?: string | null
          hash?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      objects: {
        Row: {
          bucket_id: string | null
          created_at: string | null
          id: string
          last_accessed_at: string | null
          metadata: Json | null
          name: string | null
          owner: string | null
          updated_at: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          updated_at?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objects_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      extension: {
        Args: { name: string }
        Returns: string
      }
      filename: {
        Args: { name: string }
        Returns: string
      }
      foldername: {
        Args: { name: string }
        Returns: string[]
      }
      search: {
        Args: {
          offsets?: number
          levels?: number
          limits?: number
          bucketname: string
          prefix: string
        }
        Returns: {
          metadata: Json
          created_at: string
          updated_at: string
          id: string
          name: string
          last_accessed_at: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  storage: {
    Enums: {},
  },
} as const
