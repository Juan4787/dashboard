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
          operationName?: string
          query?: string
          variables?: Json
          extensions?: Json
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
      allowed_emails: {
        Row: {
          created_at: string
          email: string
          enabled: boolean
          id: string
          onboarding_mode: string
        }
        Insert: {
          created_at?: string
          email: string
          enabled?: boolean
          id?: string
          onboarding_mode?: string
        }
        Update: {
          created_at?: string
          email?: string
          enabled?: boolean
          id?: string
          onboarding_mode?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          attended_at: string | null
          blocking_ends_at: string
          blocking_starts_at: string
          buffer_after_minutes_snapshot: number
          buffer_before_minutes_snapshot: number
          business_id: string
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
        }
        Insert: {
          attended_at?: string | null
          blocking_ends_at: string
          blocking_starts_at: string
          buffer_after_minutes_snapshot?: number
          buffer_before_minutes_snapshot?: number
          business_id: string
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
        }
        Update: {
          attended_at?: string | null
          blocking_ends_at?: string
          blocking_starts_at?: string
          buffer_after_minutes_snapshot?: number
          buffer_before_minutes_snapshot?: number
          business_id?: string
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
      business_users: {
        Row: {
          business_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          role?: string
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
          allow_same_day_booking: boolean
          cancellation_policy: string | null
          created_at: string
          email: string | null
          id: string
          industry: string
          is_active: boolean
          logo_url: string | null
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
          allow_same_day_booking?: boolean
          cancellation_policy?: string | null
          created_at?: string
          email?: string | null
          id?: string
          industry: string
          is_active?: boolean
          logo_url?: string | null
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
          allow_same_day_booking?: boolean
          cancellation_policy?: string | null
          created_at?: string
          email?: string | null
          id?: string
          industry?: string
          is_active?: boolean
          logo_url?: string | null
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
          description: string
          entry_type: string
          id: string
          internal_note: string | null
          owner_id: string | null
          patient_id: string
          teeth: string | null
          updated_at: string
        }
        Insert: {
          amount?: number | null
          archived_at?: string | null
          business_id?: string | null
          created_at?: string
          description: string
          entry_type: string
          id?: string
          internal_note?: string | null
          owner_id?: string | null
          patient_id: string
          teeth?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number | null
          archived_at?: string | null
          business_id?: string | null
          created_at?: string
          description?: string
          entry_type?: string
          id?: string
          internal_note?: string | null
          owner_id?: string | null
          patient_id?: string
          teeth?: string | null
          updated_at?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_business_user_by_email: {
        Args: {
          target_business_id: string
          target_email: string
          target_role: string
        }
        Returns: string
      }
      ensure_user_default_business: {
        Args: { p_name?: string; p_industry?: string }
        Returns: {
          business_id: string
          role: string
        }[]
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
      is_email_enabled: {
        Args: { p_email: string }
        Returns: boolean
      }
      list_business_users: {
        Args: { target_business_id: string }
        Returns: {
          id: string
          business_id: string
          user_id: string
          email: string
          role: string
          created_at: string
        }[]
      }
      normalize_phone_e164: {
        Args: { value: string }
        Returns: string
      }
      patients_counts_by_business: {
        Args: { p_business: string }
        Returns: {
          total_count: number
          active_count: number
          archived_count: number
        }[]
      }
      patients_counts_by_owner: {
        Args: { p_owner: string }
        Returns: {
          total_count: number
          active_count: number
          archived_count: number
        }[]
      }
      professional_update_appointment_status: {
        Args: {
          target_business_id: string
          target_appointment_id: string
          target_status: string
        }
        Returns: undefined
      }
      slugify_business_slug: {
        Args: { value: string }
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
      user_can_read_patient: {
        Args: { target_business_id: string; target_patient_id: string }
        Returns: boolean
      }
      user_can_read_professional_schedule: {
        Args: { target_business_id: string; target_professional_id: string }
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
          allowed_mime_types: string[] | null
          avif_autodetection: boolean | null
          created_at: string | null
          file_size_limit: number | null
          id: string
          name: string
          owner: string | null
          owner_id: string | null
          public: boolean | null
          updated_at: string | null
        }
        Insert: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id: string
          name: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
          updated_at?: string | null
        }
        Update: {
          allowed_mime_types?: string[] | null
          avif_autodetection?: boolean | null
          created_at?: string | null
          file_size_limit?: number | null
          id?: string
          name?: string
          owner?: string | null
          owner_id?: string | null
          public?: boolean | null
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
          level: number | null
          metadata: Json | null
          name: string | null
          owner: string | null
          owner_id: string | null
          path_tokens: string[] | null
          updated_at: string | null
          user_metadata: Json | null
          version: string | null
        }
        Insert: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          level?: number | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
        }
        Update: {
          bucket_id?: string | null
          created_at?: string | null
          id?: string
          last_accessed_at?: string | null
          level?: number | null
          metadata?: Json | null
          name?: string | null
          owner?: string | null
          owner_id?: string | null
          path_tokens?: string[] | null
          updated_at?: string | null
          user_metadata?: Json | null
          version?: string | null
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
      prefixes: {
        Row: {
          bucket_id: string
          created_at: string | null
          level: number
          name: string
          updated_at: string | null
        }
        Insert: {
          bucket_id: string
          created_at?: string | null
          level?: number
          name: string
          updated_at?: string | null
        }
        Update: {
          bucket_id?: string
          created_at?: string | null
          level?: number
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prefixes_bucketId_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads: {
        Row: {
          bucket_id: string
          created_at: string
          id: string
          in_progress_size: number
          key: string
          owner_id: string | null
          upload_signature: string
          user_metadata: Json | null
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          id: string
          in_progress_size?: number
          key: string
          owner_id?: string | null
          upload_signature: string
          user_metadata?: Json | null
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          id?: string
          in_progress_size?: number
          key?: string
          owner_id?: string | null
          upload_signature?: string
          user_metadata?: Json | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
        ]
      }
      s3_multipart_uploads_parts: {
        Row: {
          bucket_id: string
          created_at: string
          etag: string
          id: string
          key: string
          owner_id: string | null
          part_number: number
          size: number
          upload_id: string
          version: string
        }
        Insert: {
          bucket_id: string
          created_at?: string
          etag: string
          id?: string
          key: string
          owner_id?: string | null
          part_number: number
          size?: number
          upload_id: string
          version: string
        }
        Update: {
          bucket_id?: string
          created_at?: string
          etag?: string
          id?: string
          key?: string
          owner_id?: string | null
          part_number?: number
          size?: number
          upload_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "s3_multipart_uploads_parts_bucket_id_fkey"
            columns: ["bucket_id"]
            isOneToOne: false
            referencedRelation: "buckets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "s3_multipart_uploads_parts_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "s3_multipart_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_prefixes: {
        Args: { _bucket_id: string; _name: string }
        Returns: undefined
      }
      can_insert_object: {
        Args: { bucketid: string; name: string; owner: string; metadata: Json }
        Returns: undefined
      }
      delete_prefix: {
        Args: { _bucket_id: string; _name: string }
        Returns: boolean
      }
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
      get_level: {
        Args: { name: string }
        Returns: number
      }
      get_prefix: {
        Args: { name: string }
        Returns: string
      }
      get_prefixes: {
        Args: { name: string }
        Returns: string[]
      }
      get_size_by_bucket: {
        Args: Record<PropertyKey, never>
        Returns: {
          size: number
          bucket_id: string
        }[]
      }
      list_multipart_uploads_with_delimiter: {
        Args: {
          bucket_id: string
          prefix_param: string
          delimiter_param: string
          max_keys?: number
          next_key_token?: string
          next_upload_token?: string
        }
        Returns: {
          key: string
          id: string
          created_at: string
        }[]
      }
      list_objects_with_delimiter: {
        Args: {
          bucket_id: string
          prefix_param: string
          delimiter_param: string
          max_keys?: number
          start_after?: string
          next_token?: string
        }
        Returns: {
          name: string
          id: string
          metadata: Json
          updated_at: string
        }[]
      }
      operation: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      search: {
        Args: {
          prefix: string
          bucketname: string
          limits?: number
          levels?: number
          offsets?: number
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          name: string
          id: string
          updated_at: string
          created_at: string
          last_accessed_at: string
          metadata: Json
        }[]
      }
      search_legacy_v1: {
        Args: {
          prefix: string
          bucketname: string
          limits?: number
          levels?: number
          offsets?: number
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          name: string
          id: string
          updated_at: string
          created_at: string
          last_accessed_at: string
          metadata: Json
        }[]
      }
      search_v1_optimised: {
        Args: {
          prefix: string
          bucketname: string
          limits?: number
          levels?: number
          offsets?: number
          search?: string
          sortcolumn?: string
          sortorder?: string
        }
        Returns: {
          name: string
          id: string
          updated_at: string
          created_at: string
          last_accessed_at: string
          metadata: Json
        }[]
      }
      search_v2: {
        Args: {
          prefix: string
          bucket_name: string
          limits?: number
          levels?: number
          start_after?: string
        }
        Returns: {
          key: string
          name: string
          id: string
          updated_at: string
          created_at: string
          metadata: Json
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
