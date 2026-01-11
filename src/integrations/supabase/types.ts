export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      availability_blocks: {
        Row: {
          block_type: string
          booking_id: string | null
          created_at: string
          end_date: string
          end_time: string | null
          id: string
          notes: string | null
          source: string
          start_date: string
          start_time: string | null
        }
        Insert: {
          block_type: string
          booking_id?: string | null
          created_at?: string
          end_date: string
          end_time?: string | null
          id?: string
          notes?: string | null
          source: string
          start_date: string
          start_time?: string | null
        }
        Update: {
          block_type?: string
          booking_id?: string | null
          created_at?: string
          end_date?: string
          end_time?: string | null
          id?: string
          notes?: string | null
          source?: string
          start_date?: string
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_blocks_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      blackout_dates: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          reason: string | null
          start_date: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          reason?: string | null
          start_date: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          reason?: string | null
          start_date?: string
        }
        Relationships: []
      }
      booking_attachments: {
        Row: {
          booking_id: string
          category: string
          content_type: string
          created_at: string
          description: string | null
          filename: string
          id: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          booking_id: string
          category?: string
          content_type: string
          created_at?: string
          description?: string | null
          filename: string
          id?: string
          size_bytes: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          booking_id?: string
          category?: string
          content_type?: string
          created_at?: string
          description?: string | null
          filename?: string
          id?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_attachments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_cleaning_reports: {
        Row: {
          booking_id: string
          clean_check_bathrooms: boolean | null
          clean_check_deep_cleaning_done: boolean | null
          clean_check_door_locked: boolean | null
          clean_check_equipment_stored: boolean | null
          clean_check_floors: boolean | null
          clean_check_kitchen: boolean | null
          clean_check_lights_off: boolean | null
          clean_check_office_door_closed: boolean | null
          clean_check_tables_chairs_positioned: boolean | null
          clean_check_trash_removed: boolean | null
          clean_issues_notes: string | null
          cleaner_id: string | null
          cleaner_name: string | null
          cleaner_role: string | null
          completed_at: string | null
          created_at: string
          damage_found: boolean | null
          damage_notes: string | null
          floors_clean: boolean | null
          id: string
          inventory_items: Json | null
          inventory_update_needed: boolean | null
          media_bathrooms: Json | null
          media_deep_cleaning: Json | null
          media_front_door: Json | null
          media_kitchen: Json | null
          media_main_area: Json | null
          media_rack: Json | null
          restrooms_clean: boolean | null
          scheduled_end: string | null
          scheduled_start: string | null
          started_at: string | null
          status: string
          surfaces_clean: boolean | null
          trash_removed: boolean | null
          updated_at: string
        }
        Insert: {
          booking_id: string
          clean_check_bathrooms?: boolean | null
          clean_check_deep_cleaning_done?: boolean | null
          clean_check_door_locked?: boolean | null
          clean_check_equipment_stored?: boolean | null
          clean_check_floors?: boolean | null
          clean_check_kitchen?: boolean | null
          clean_check_lights_off?: boolean | null
          clean_check_office_door_closed?: boolean | null
          clean_check_tables_chairs_positioned?: boolean | null
          clean_check_trash_removed?: boolean | null
          clean_issues_notes?: string | null
          cleaner_id?: string | null
          cleaner_name?: string | null
          cleaner_role?: string | null
          completed_at?: string | null
          created_at?: string
          damage_found?: boolean | null
          damage_notes?: string | null
          floors_clean?: boolean | null
          id?: string
          inventory_items?: Json | null
          inventory_update_needed?: boolean | null
          media_bathrooms?: Json | null
          media_deep_cleaning?: Json | null
          media_front_door?: Json | null
          media_kitchen?: Json | null
          media_main_area?: Json | null
          media_rack?: Json | null
          restrooms_clean?: boolean | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          started_at?: string | null
          status?: string
          surfaces_clean?: boolean | null
          trash_removed?: boolean | null
          updated_at?: string
        }
        Update: {
          booking_id?: string
          clean_check_bathrooms?: boolean | null
          clean_check_deep_cleaning_done?: boolean | null
          clean_check_door_locked?: boolean | null
          clean_check_equipment_stored?: boolean | null
          clean_check_floors?: boolean | null
          clean_check_kitchen?: boolean | null
          clean_check_lights_off?: boolean | null
          clean_check_office_door_closed?: boolean | null
          clean_check_tables_chairs_positioned?: boolean | null
          clean_check_trash_removed?: boolean | null
          clean_issues_notes?: string | null
          cleaner_id?: string | null
          cleaner_name?: string | null
          cleaner_role?: string | null
          completed_at?: string | null
          created_at?: string
          damage_found?: boolean | null
          damage_notes?: string | null
          floors_clean?: boolean | null
          id?: string
          inventory_items?: Json | null
          inventory_update_needed?: boolean | null
          media_bathrooms?: Json | null
          media_deep_cleaning?: Json | null
          media_front_door?: Json | null
          media_kitchen?: Json | null
          media_main_area?: Json | null
          media_rack?: Json | null
          restrooms_clean?: boolean | null
          scheduled_end?: string | null
          scheduled_start?: string | null
          started_at?: string | null
          status?: string
          surfaces_clean?: boolean | null
          trash_removed?: boolean | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_cleaning_reports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_cleaning_reports_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_events: {
        Row: {
          booking_id: string
          channel: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          booking_id: string
          channel?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          booking_id?: string
          channel?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_events_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_host_reports: {
        Row: {
          booking_id: string
          created_at: string
          guest_confirm_area_clean: boolean | null
          guest_confirm_bathrooms_ok: boolean | null
          guest_confirm_door_closed: boolean | null
          guest_confirm_trash_bagged: boolean | null
          guest_email: string | null
          guest_name: string | null
          guest_phone: string | null
          has_issue: boolean | null
          id: string
          issue_description: string | null
          notes: string | null
          reviewed_at: string | null
          reviewed_by_id: string | null
          status: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          guest_confirm_area_clean?: boolean | null
          guest_confirm_bathrooms_ok?: boolean | null
          guest_confirm_door_closed?: boolean | null
          guest_confirm_trash_bagged?: boolean | null
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          has_issue?: boolean | null
          id?: string
          issue_description?: string | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by_id?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          guest_confirm_area_clean?: boolean | null
          guest_confirm_bathrooms_ok?: boolean | null
          guest_confirm_door_closed?: boolean | null
          guest_confirm_trash_bagged?: boolean | null
          guest_email?: string | null
          guest_name?: string | null
          guest_phone?: string | null
          has_issue?: boolean | null
          id?: string
          issue_description?: string | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by_id?: string | null
          status?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_host_reports_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_host_reports_reviewed_by_id_fkey"
            columns: ["reviewed_by_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_reviews: {
        Row: {
          booking_id: string
          comment: string | null
          created_at: string
          id: string
          rating: number
          review_url: string | null
          reviewer_name: string | null
          source: string
        }
        Insert: {
          booking_id: string
          comment?: string | null
          created_at?: string
          id?: string
          rating: number
          review_url?: string | null
          reviewer_name?: string | null
          source: string
        }
        Update: {
          booking_id?: string
          comment?: string | null
          created_at?: string
          id?: string
          rating?: number
          review_url?: string | null
          reviewer_name?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_staff_assignments: {
        Row: {
          assignment_role: string
          booking_id: string
          created_at: string
          id: string
          notes: string | null
          staff_id: string
          updated_at: string
        }
        Insert: {
          assignment_role: string
          booking_id: string
          created_at?: string
          id?: string
          notes?: string | null
          staff_id: string
          updated_at?: string
        }
        Update: {
          assignment_role?: string
          booking_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_staff_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_staff_assignments_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          agree_to_rules: boolean
          balance_amount: number
          balance_link_expires_at: string | null
          balance_paid_at: string | null
          balance_payment_url: string | null
          base_rental: number
          booking_type: Database["public"]["Enums"]["booking_type"]
          cancelled_at: string | null
          cleaning_fee: number
          client_notes: string | null
          company: string | null
          confirmed_at: string | null
          contract_version: string | null
          created_at: string
          deposit_amount: number
          deposit_paid_at: string | null
          discount_amount: number | null
          discount_code: string | null
          email: string
          end_time: string | null
          event_date: string
          event_type: string
          event_type_other: string | null
          full_name: string
          ghl_appointment_end_at: string | null
          ghl_appointment_id: string | null
          ghl_appointment_start_at: string | null
          ghl_assigned_user_id: string | null
          ghl_blocked_slot_id: string | null
          ghl_calendar_id: string | null
          ghl_contact_id: string | null
          host_report_step: string | null
          id: string
          initials: string
          internal_notes: Json | null
          ip_address: unknown
          lead_source: string | null
          lifecycle_status: string
          number_of_guests: number
          optional_services: number
          package: Database["public"]["Enums"]["package_type"]
          package_cost: number
          package_end_time: string | null
          package_start_time: string | null
          payment_status: Database["public"]["Enums"]["payment_status"]
          phone: string
          pre_event_ready: string
          reservation_number: string | null
          setup_breakdown: boolean
          signature: string
          signature_date: string
          signer_name: string
          start_time: string | null
          status: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          tablecloth_quantity: number
          tablecloths: boolean
          taxes_fees: number
          total_amount: number
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          agree_to_rules?: boolean
          balance_amount: number
          balance_link_expires_at?: string | null
          balance_paid_at?: string | null
          balance_payment_url?: string | null
          base_rental: number
          booking_type: Database["public"]["Enums"]["booking_type"]
          cancelled_at?: string | null
          cleaning_fee?: number
          client_notes?: string | null
          company?: string | null
          confirmed_at?: string | null
          contract_version?: string | null
          created_at?: string
          deposit_amount: number
          deposit_paid_at?: string | null
          discount_amount?: number | null
          discount_code?: string | null
          email: string
          end_time?: string | null
          event_date: string
          event_type: string
          event_type_other?: string | null
          full_name: string
          ghl_appointment_end_at?: string | null
          ghl_appointment_id?: string | null
          ghl_appointment_start_at?: string | null
          ghl_assigned_user_id?: string | null
          ghl_blocked_slot_id?: string | null
          ghl_calendar_id?: string | null
          ghl_contact_id?: string | null
          host_report_step?: string | null
          id?: string
          initials: string
          internal_notes?: Json | null
          ip_address?: unknown
          lead_source?: string | null
          lifecycle_status?: string
          number_of_guests: number
          optional_services?: number
          package?: Database["public"]["Enums"]["package_type"]
          package_cost?: number
          package_end_time?: string | null
          package_start_time?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          phone: string
          pre_event_ready?: string
          reservation_number?: string | null
          setup_breakdown?: boolean
          signature: string
          signature_date: string
          signer_name: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tablecloth_quantity?: number
          tablecloths?: boolean
          taxes_fees?: number
          total_amount: number
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          agree_to_rules?: boolean
          balance_amount?: number
          balance_link_expires_at?: string | null
          balance_paid_at?: string | null
          balance_payment_url?: string | null
          base_rental?: number
          booking_type?: Database["public"]["Enums"]["booking_type"]
          cancelled_at?: string | null
          cleaning_fee?: number
          client_notes?: string | null
          company?: string | null
          confirmed_at?: string | null
          contract_version?: string | null
          created_at?: string
          deposit_amount?: number
          deposit_paid_at?: string | null
          discount_amount?: number | null
          discount_code?: string | null
          email?: string
          end_time?: string | null
          event_date?: string
          event_type?: string
          event_type_other?: string | null
          full_name?: string
          ghl_appointment_end_at?: string | null
          ghl_appointment_id?: string | null
          ghl_appointment_start_at?: string | null
          ghl_assigned_user_id?: string | null
          ghl_blocked_slot_id?: string | null
          ghl_calendar_id?: string | null
          ghl_contact_id?: string | null
          host_report_step?: string | null
          id?: string
          initials?: string
          internal_notes?: Json | null
          ip_address?: unknown
          lead_source?: string | null
          lifecycle_status?: string
          number_of_guests?: number
          optional_services?: number
          package?: Database["public"]["Enums"]["package_type"]
          package_cost?: number
          package_end_time?: string | null
          package_start_time?: string | null
          payment_status?: Database["public"]["Enums"]["payment_status"]
          phone?: string
          pre_event_ready?: string
          reservation_number?: string | null
          setup_breakdown?: boolean
          signature?: string
          signature_date?: string
          signer_name?: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tablecloth_quantity?: number
          tablecloths?: boolean
          taxes_fees?: number
          total_amount?: number
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      inventory_locations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_products: {
        Row: {
          created_at: string
          default_min_level: number
          id: string
          is_active: boolean
          name: string
          unit: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_min_level?: number
          id?: string
          is_active?: boolean
          name: string
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_min_level?: number
          id?: string
          is_active?: boolean
          name?: string
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      inventory_stock: {
        Row: {
          current_level: number
          id: string
          location_id: string
          min_level: number | null
          notes: string | null
          photo_url: string | null
          product_id: string
          shelf_label: string | null
          status: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          current_level?: number
          id?: string
          location_id: string
          min_level?: number | null
          notes?: string | null
          photo_url?: string | null
          product_id: string
          shelf_label?: string | null
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          current_level?: number
          id?: string
          location_id?: string
          min_level?: number | null
          notes?: string | null
          photo_url?: string | null
          product_id?: string
          shelf_label?: string | null
          status?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "inventory_products"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_tickets: {
        Row: {
          booking_id: string | null
          created_at: string
          description: string | null
          id: string
          issue_type: string | null
          priority: string
          reported_by_role: string | null
          resolved_at: string | null
          status: string
          title: string
          updated_at: string
          venue_area: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          issue_type?: string | null
          priority?: string
          reported_by_role?: string | null
          resolved_at?: string | null
          status?: string
          title: string
          updated_at?: string
          venue_area?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          issue_type?: string | null
          priority?: string
          reported_by_role?: string | null
          resolved_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          venue_area?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_tickets_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      scheduled_jobs: {
        Row: {
          attempts: number
          booking_id: string
          completed_at: string | null
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          run_at: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          booking_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          job_type: string
          last_error?: string | null
          run_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          booking_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          job_type?: string
          last_error?: string | null
          run_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_jobs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_members: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          is_active: boolean
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          phone?: string | null
          role: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      venue_config: {
        Row: {
          description: string | null
          id: string
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_internal_note: {
        Args: { _author_id: string; _booking_id: string; _note: string }
        Returns: undefined
      }
      generate_reservation_number: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_staff: { Args: { _user_id: string }; Returns: boolean }
      reschedule_booking: {
        Args: {
          p_actor_id?: string
          p_booking_id: string
          p_new_date: string
          p_new_end_time?: string
          p_new_start_time?: string
          p_reason?: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "staff"
      booking_status:
        | "pending_review"
        | "confirmed"
        | "cancelled"
        | "completed"
        | "needs_info"
        | "needs_payment"
        | "declined"
      booking_type: "hourly" | "daily"
      package_type: "none" | "basic" | "led" | "workshop"
      payment_status:
        | "pending"
        | "deposit_paid"
        | "fully_paid"
        | "failed"
        | "refunded"
        | "invoiced"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "staff"],
      booking_status: [
        "pending_review",
        "confirmed",
        "cancelled",
        "completed",
        "needs_info",
        "needs_payment",
        "declined",
      ],
      booking_type: ["hourly", "daily"],
      package_type: ["none", "basic", "led", "workshop"],
      payment_status: [
        "pending",
        "deposit_paid",
        "fully_paid",
        "failed",
        "refunded",
        "invoiced",
      ],
    },
  },
} as const
