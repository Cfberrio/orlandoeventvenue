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
      availability_block_reminders: {
        Row: {
          block_id: string
          booking_id: string
          channel: string | null
          created_at: string
          error_message: string | null
          id: string
          metadata: Json | null
          reminder_type: string
          sent_at: string
          status: string
          updated_at: string
        }
        Insert: {
          block_id: string
          booking_id: string
          channel?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          reminder_type: string
          sent_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          block_id?: string
          booking_id?: string
          channel?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          reminder_type?: string
          sent_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_block_reminders_block_id_fkey"
            columns: ["block_id"]
            isOneToOne: false
            referencedRelation: "availability_blocks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_block_reminders_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
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
      booking_addon_invoices: {
        Row: {
          booking_id: string
          created_at: string
          created_by: string | null
          id: string
          optional_services_cost: number
          package: string
          package_cost: number
          package_end_time: string | null
          package_start_time: string | null
          paid_at: string | null
          payment_status: string
          payment_url: string | null
          setup_breakdown: boolean
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          tablecloth_quantity: number
          tablecloths: boolean
          total_amount: number
        }
        Insert: {
          booking_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          optional_services_cost?: number
          package?: string
          package_cost?: number
          package_end_time?: string | null
          package_start_time?: string | null
          paid_at?: string | null
          payment_status?: string
          payment_url?: string | null
          setup_breakdown?: boolean
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tablecloth_quantity?: number
          tablecloths?: boolean
          total_amount: number
        }
        Update: {
          booking_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          optional_services_cost?: number
          package?: string
          package_cost?: number
          package_end_time?: string | null
          package_start_time?: string | null
          paid_at?: string | null
          payment_status?: string
          payment_url?: string | null
          setup_breakdown?: boolean
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          tablecloth_quantity?: number
          tablecloths?: boolean
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_addon_invoices_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "booking_custodial_staff"
            referencedColumns: ["staff_id"]
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
            referencedRelation: "booking_custodial_staff"
            referencedColumns: ["staff_id"]
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
      booking_policies: {
        Row: {
          auto_lifecycle_transitions: boolean | null
          created_at: string | null
          description: string | null
          id: string
          include_host_report: boolean | null
          policy_name: string
          requires_payment: boolean | null
          requires_staff_assignment: boolean | null
          send_balance_emails: boolean | null
          send_cleaning_report: boolean | null
          send_customer_confirmation: boolean | null
          send_deposit_emails: boolean | null
          send_pre_event_1d: boolean | null
          send_pre_event_30d: boolean | null
          send_pre_event_7d: boolean | null
          send_staff_assignment_emails: boolean | null
          updated_at: string | null
        }
        Insert: {
          auto_lifecycle_transitions?: boolean | null
          created_at?: string | null
          description?: string | null
          id?: string
          include_host_report?: boolean | null
          policy_name: string
          requires_payment?: boolean | null
          requires_staff_assignment?: boolean | null
          send_balance_emails?: boolean | null
          send_cleaning_report?: boolean | null
          send_customer_confirmation?: boolean | null
          send_deposit_emails?: boolean | null
          send_pre_event_1d?: boolean | null
          send_pre_event_30d?: boolean | null
          send_pre_event_7d?: boolean | null
          send_staff_assignment_emails?: boolean | null
          updated_at?: string | null
        }
        Update: {
          auto_lifecycle_transitions?: boolean | null
          created_at?: string | null
          description?: string | null
          id?: string
          include_host_report?: boolean | null
          policy_name?: string
          requires_payment?: boolean | null
          requires_staff_assignment?: boolean | null
          send_balance_emails?: boolean | null
          send_cleaning_report?: boolean | null
          send_customer_confirmation?: boolean | null
          send_deposit_emails?: boolean | null
          send_pre_event_1d?: boolean | null
          send_pre_event_30d?: boolean | null
          send_pre_event_7d?: boolean | null
          send_staff_assignment_emails?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      booking_revenue_items: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          description: string | null
          id: string
          is_historical: boolean | null
          item_category: string
          item_type: string | null
          metadata: Json | null
          payment_date: string | null
          payment_split: string | null
          quantity: number | null
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_historical?: boolean | null
          item_category: string
          item_type?: string | null
          metadata?: Json | null
          payment_date?: string | null
          payment_split?: string | null
          quantity?: number | null
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_historical?: boolean | null
          item_category?: string
          item_type?: string | null
          metadata?: Json | null
          payment_date?: string | null
          payment_split?: string | null
          quantity?: number | null
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_revenue_items_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
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
          assignment_type: string | null
          booking_id: string | null
          celebration_surcharge: number | null
          cleaning_type: string | null
          completed_at: string | null
          created_at: string
          hours_worked: number | null
          id: string
          notes: string | null
          reminder_sent_at: string | null
          scheduled_date: string | null
          scheduled_end_time: string | null
          scheduled_start_time: string | null
          staff_id: string
          started_at: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          assignment_role: string
          assignment_type?: string | null
          booking_id?: string | null
          celebration_surcharge?: number | null
          cleaning_type?: string | null
          completed_at?: string | null
          created_at?: string
          hours_worked?: number | null
          id?: string
          notes?: string | null
          reminder_sent_at?: string | null
          scheduled_date?: string | null
          scheduled_end_time?: string | null
          scheduled_start_time?: string | null
          staff_id: string
          started_at?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          assignment_role?: string
          assignment_type?: string | null
          booking_id?: string | null
          celebration_surcharge?: number | null
          cleaning_type?: string | null
          completed_at?: string | null
          created_at?: string
          hours_worked?: number | null
          id?: string
          notes?: string | null
          reminder_sent_at?: string | null
          scheduled_date?: string | null
          scheduled_end_time?: string | null
          scheduled_start_time?: string | null
          staff_id?: string
          started_at?: string | null
          status?: string | null
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
            referencedRelation: "booking_custodial_staff"
            referencedColumns: ["staff_id"]
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
          beer_wine_service: boolean
          booking_origin: Database["public"]["Enums"]["booking_origin"]
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
          policy_id: string
          pre_event_ready: string
          reservation_number: string | null
          setup_breakdown: boolean
          signature: string
          signature_date: string
          signer_name: string
          source: string | null
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
          beer_wine_service?: boolean
          booking_origin?: Database["public"]["Enums"]["booking_origin"]
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
          policy_id: string
          pre_event_ready?: string
          reservation_number?: string | null
          setup_breakdown?: boolean
          signature: string
          signature_date: string
          signer_name: string
          source?: string | null
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
          beer_wine_service?: boolean
          booking_origin?: Database["public"]["Enums"]["booking_origin"]
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
          policy_id?: string
          pre_event_ready?: string
          reservation_number?: string | null
          setup_breakdown?: boolean
          signature?: string
          signature_date?: string
          signer_name?: string
          source?: string | null
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
        Relationships: [
          {
            foreignKeyName: "bookings_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "booking_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_coupons: {
        Row: {
          applies_to: string
          applies_to_daily: boolean | null
          applies_to_hourly: boolean | null
          code: string
          created_at: string | null
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          id: string
          is_active: boolean | null
          updated_at: string | null
        }
        Insert: {
          applies_to?: string
          applies_to_daily?: boolean | null
          applies_to_hourly?: boolean | null
          code: string
          created_at?: string | null
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Update: {
          applies_to?: string
          applies_to_daily?: boolean | null
          applies_to_hourly?: boolean | null
          code?: string
          created_at?: string | null
          discount_type?: Database["public"]["Enums"]["discount_type"]
          discount_value?: number
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ghl_calendar_sync_config: {
        Row: {
          function_url: string
          id: number
          secret: string | null
          updated_at: string | null
        }
        Insert: {
          function_url: string
          id?: number
          secret?: string | null
          updated_at?: string | null
        }
        Update: {
          function_url?: string
          id?: number
          secret?: string | null
          updated_at?: string | null
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
      invoices: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          customer_email: string
          customer_name: string | null
          description: string | null
          id: string
          invoice_number: string
          line_items: Json | null
          paid_at: string | null
          payment_status: string
          payment_url: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          customer_email: string
          customer_name?: string | null
          description?: string | null
          id?: string
          invoice_number?: string
          line_items?: Json | null
          paid_at?: string | null
          payment_status?: string
          payment_url?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_email?: string
          customer_name?: string | null
          description?: string | null
          id?: string
          invoice_number?: string
          line_items?: Json | null
          paid_at?: string | null
          payment_status?: string
          payment_url?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
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
      popup_leads: {
        Row: {
          coupon_code: string | null
          created_at: string | null
          email: string
          email_1_sent_at: string | null
          email_2_sent_at: string | null
          email_3_sent_at: string | null
          full_name: string
          id: string
          is_converted: boolean | null
          preferred_event_date: string | null
        }
        Insert: {
          coupon_code?: string | null
          created_at?: string | null
          email: string
          email_1_sent_at?: string | null
          email_2_sent_at?: string | null
          email_3_sent_at?: string | null
          full_name: string
          id?: string
          is_converted?: boolean | null
          preferred_event_date?: string | null
        }
        Update: {
          coupon_code?: string | null
          created_at?: string | null
          email?: string
          email_1_sent_at?: string | null
          email_2_sent_at?: string | null
          email_3_sent_at?: string | null
          full_name?: string
          id?: string
          is_converted?: boolean | null
          preferred_event_date?: string | null
        }
        Relationships: []
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
          hourly_rate: number
          id: string
          is_active: boolean
          payroll_type: string
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          hourly_rate?: number
          id?: string
          is_active?: boolean
          payroll_type?: string
          phone?: string | null
          role: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          hourly_rate?: number
          id?: string
          is_active?: boolean
          payroll_type?: string
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      staff_payroll_items: {
        Row: {
          amount: number
          assignment_id: string
          created_at: string
          description: string | null
          hours: number | null
          id: string
          is_historical: boolean | null
          metadata: Json | null
          paid_at: string | null
          paid_status: string
          pay_category: string
          pay_type: string | null
          rate: number | null
          staff_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          assignment_id: string
          created_at?: string
          description?: string | null
          hours?: number | null
          id?: string
          is_historical?: boolean | null
          metadata?: Json | null
          paid_at?: string | null
          paid_status?: string
          pay_category: string
          pay_type?: string | null
          rate?: number | null
          staff_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          assignment_id?: string
          created_at?: string
          description?: string | null
          hours?: number | null
          id?: string
          is_historical?: boolean | null
          metadata?: Json | null
          paid_at?: string | null
          paid_status?: string
          pay_category?: string
          pay_type?: string | null
          rate?: number | null
          staff_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_payroll_items_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "booking_staff_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_payroll_items_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "booking_custodial_staff"
            referencedColumns: ["staff_id"]
          },
          {
            foreignKeyName: "staff_payroll_items_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      standalone_cleaning_reports: {
        Row: {
          assignment_id: string
          clean_check_bathrooms_cleaned: boolean | null
          clean_check_deep_cleaning_done: boolean | null
          clean_check_equipment_stored: boolean | null
          clean_check_floors_swept_mopped: boolean | null
          clean_check_front_door_locked: boolean | null
          clean_check_kitchen_cleaned: boolean | null
          clean_check_lights_off: boolean | null
          clean_check_office_door_locked: boolean | null
          clean_check_tables_chairs_arranged: boolean | null
          clean_check_trash_removed: boolean | null
          cleaner_id: string
          cleaner_name: string
          cleaner_role: string
          completed_at: string | null
          created_at: string
          damage_description: string | null
          damage_found: boolean | null
          id: string
          inventory_items: Json | null
          inventory_update_needed: boolean | null
          issues_found: boolean | null
          issues_notes: string | null
          media_bathrooms: Json | null
          media_deep_cleaning: Json | null
          media_front_door: Json | null
          media_kitchen: Json | null
          media_main_area: Json | null
          media_rack: Json | null
          status: string | null
          updated_at: string
        }
        Insert: {
          assignment_id: string
          clean_check_bathrooms_cleaned?: boolean | null
          clean_check_deep_cleaning_done?: boolean | null
          clean_check_equipment_stored?: boolean | null
          clean_check_floors_swept_mopped?: boolean | null
          clean_check_front_door_locked?: boolean | null
          clean_check_kitchen_cleaned?: boolean | null
          clean_check_lights_off?: boolean | null
          clean_check_office_door_locked?: boolean | null
          clean_check_tables_chairs_arranged?: boolean | null
          clean_check_trash_removed?: boolean | null
          cleaner_id: string
          cleaner_name: string
          cleaner_role: string
          completed_at?: string | null
          created_at?: string
          damage_description?: string | null
          damage_found?: boolean | null
          id?: string
          inventory_items?: Json | null
          inventory_update_needed?: boolean | null
          issues_found?: boolean | null
          issues_notes?: string | null
          media_bathrooms?: Json | null
          media_deep_cleaning?: Json | null
          media_front_door?: Json | null
          media_kitchen?: Json | null
          media_main_area?: Json | null
          media_rack?: Json | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          assignment_id?: string
          clean_check_bathrooms_cleaned?: boolean | null
          clean_check_deep_cleaning_done?: boolean | null
          clean_check_equipment_stored?: boolean | null
          clean_check_floors_swept_mopped?: boolean | null
          clean_check_front_door_locked?: boolean | null
          clean_check_kitchen_cleaned?: boolean | null
          clean_check_lights_off?: boolean | null
          clean_check_office_door_locked?: boolean | null
          clean_check_tables_chairs_arranged?: boolean | null
          clean_check_trash_removed?: boolean | null
          cleaner_id?: string
          cleaner_name?: string
          cleaner_role?: string
          completed_at?: string | null
          created_at?: string
          damage_description?: string | null
          damage_found?: boolean | null
          id?: string
          inventory_items?: Json | null
          inventory_update_needed?: boolean | null
          issues_found?: boolean | null
          issues_notes?: string | null
          media_bathrooms?: Json | null
          media_deep_cleaning?: Json | null
          media_front_door?: Json | null
          media_kitchen?: Json | null
          media_main_area?: Json | null
          media_rack?: Json | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "standalone_cleaning_reports_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "booking_staff_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standalone_cleaning_reports_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "booking_custodial_staff"
            referencedColumns: ["staff_id"]
          },
          {
            foreignKeyName: "standalone_cleaning_reports_cleaner_id_fkey"
            columns: ["cleaner_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_event_log: {
        Row: {
          booking_id: string | null
          event_id: string
          event_type: string
          id: string
          metadata: Json | null
          processed_at: string | null
        }
        Insert: {
          booking_id?: string | null
          event_id: string
          event_type: string
          id?: string
          metadata?: Json | null
          processed_at?: string | null
        }
        Update: {
          booking_id?: string | null
          event_id?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stripe_event_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
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
      booking_custodial_staff: {
        Row: {
          booking_id: string | null
          staff_email: string | null
          staff_id: string | null
          staff_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_staff_assignments_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      add_internal_note: {
        Args: { _author_id: string; _booking_id: string; _note: string }
        Returns: undefined
      }
      count_bookings_without_balance_jobs: { Args: never; Returns: number }
      count_bookings_without_host_jobs: { Args: never; Returns: number }
      generate_reservation_number: { Args: never; Returns: string }
      get_daily_generated_revenue: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: {
          addon_generated: number
          baseline_generated: number
          booking_count: number
          cleaning_generated: number
          discount_generated: number
          generated_date: string
          production_generated: number
          tax_generated: number
          total_generated: number
        }[]
      }
      get_daily_revenue: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: {
          addon_revenue: number
          baseline_revenue: number
          booking_count: number
          cleaning_revenue: number
          discount_amount: number
          fee_revenue: number
          production_revenue: number
          revenue_date: string
          tax_amount: number
          total_revenue: number
        }[]
      }
      get_monthly_revenue: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: {
          addon_revenue: number
          baseline_revenue: number
          booking_count: number
          cleaning_revenue: number
          production_revenue: number
          revenue_month: string
          total_revenue: number
          year_month: string
        }[]
      }
      get_payroll_by_role: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: {
          assignment_count: number
          avg_per_assignment: number
          avg_per_staff: number
          hours_worked: number
          payroll_type: string
          staff_count: number
          staff_role: string
          total_amount: number
        }[]
      }
      get_payroll_by_staff: {
        Args: { p_end_date: string; p_staff_id?: string; p_start_date: string }
        Returns: {
          assignment_count: number
          avg_per_assignment: number
          hours_worked: number
          payroll_type: string
          staff_id: string
          staff_name: string
          staff_role: string
          total_amount: number
        }[]
      }
      get_payroll_line_items_export: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: {
          amount: number
          assignment_date: string
          assignment_status: string
          assignment_type: string
          booking_id: string
          created_at: string
          description: string
          hours: number
          paid_at: string
          paid_status: string
          pay_category: string
          pay_type: string
          payroll_item_id: string
          payroll_type: string
          rate: number
          reservation_number: string
          staff_name: string
          staff_role: string
        }[]
      }
      get_revenue_by_category: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: {
          category: string
          item_count: number
          item_type: string
          total_amount: number
        }[]
      }
      get_revenue_by_segment: {
        Args: {
          p_end_date: string
          p_segment_by?: string
          p_start_date: string
        }
        Returns: {
          avg_revenue: number
          booking_count: number
          segment: string
          total_revenue: number
        }[]
      }
      get_revenue_line_items_export: {
        Args: { p_end_date: string; p_start_date: string }
        Returns: {
          amount: number
          booking_origin: string
          booking_type: string
          created_at: string
          description: string
          event_date: string
          event_type: string
          guest_name: string
          item_category: string
          item_type: string
          payment_date: string
          payment_split: string
          quantity: number
          reservation_number: string
        }[]
      }
      get_staff_payroll_line_items: {
        Args: { p_end_date: string; p_staff_id: string; p_start_date: string }
        Returns: {
          amount: number
          assignment_date: string
          assignment_status: string
          assignment_type: string
          booking_id: string
          created_at: string
          description: string
          hours: number
          paid_at: string
          paid_status: string
          pay_category: string
          pay_type: string
          payroll_item_id: string
          payroll_type: string
          rate: number
          reservation_number: string
          staff_name: string
          staff_role: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin_or_staff: { Args: { _user_id: string }; Returns: boolean }
      populate_booking_revenue_items: {
        Args: { p_booking_id: string; p_is_historical?: boolean }
        Returns: undefined
      }
      populate_staff_payroll_items: {
        Args: { p_assignment_id: string; p_is_historical?: boolean }
        Returns: undefined
      }
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
      booking_origin: "website" | "internal" | "external"
      booking_status:
        | "pending_review"
        | "confirmed"
        | "cancelled"
        | "completed"
        | "needs_info"
        | "needs_payment"
        | "declined"
      booking_type: "hourly" | "daily"
      discount_type: "percentage" | "fixed_amount"
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
      booking_origin: ["website", "internal", "external"],
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
      discount_type: ["percentage", "fixed_amount"],
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
