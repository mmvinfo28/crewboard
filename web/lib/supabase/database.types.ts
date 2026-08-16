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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activity_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: number
          metadata: Json
          party_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: never
          metadata?: Json
          party_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: never
          metadata?: Json
          party_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_events_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          capabilities: Json
          created_at: string
          current_task_summary: string | null
          device_id: string | null
          id: string
          model: string
          name: string
          owner_id: string
          party_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          capabilities?: Json
          created_at?: string
          current_task_summary?: string | null
          device_id?: string | null
          id?: string
          model: string
          name: string
          owner_id: string
          party_id: string
          provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          capabilities?: Json
          created_at?: string
          current_task_summary?: string | null
          device_id?: string | null
          id?: string
          model?: string
          name?: string
          owner_id?: string
          party_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          device_id: string
          expires_at: string
          id: string
          kind: string
          manifest: Json
          manifest_hash: string
          party_id: string
          requested_by_session_id: string
          run_id: string
          status: string
          task_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          device_id: string
          expires_at: string
          id?: string
          kind: string
          manifest: Json
          manifest_hash: string
          party_id: string
          requested_by_session_id: string
          run_id: string
          status?: string
          task_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          device_id?: string
          expires_at?: string
          id?: string
          kind?: string
          manifest?: Json
          manifest_hash?: string
          party_id?: string
          requested_by_session_id?: string
          run_id?: string
          status?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_requested_by_session_id_fkey"
            columns: ["requested_by_session_id"]
            isOneToOne: false
            referencedRelation: "device_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "task_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      device_folders: {
        Row: {
          created_at: string
          device_id: string
          enabled: boolean
          id: string
          label: string
          party_id: string
          path_fingerprint: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_id: string
          enabled?: boolean
          id?: string
          label: string
          party_id: string
          path_fingerprint: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string
          enabled?: boolean
          id?: string
          label?: string
          party_id?: string
          path_fingerprint?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_folders_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_folders_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      device_pairings: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_party_id: string | null
          attempts: number
          connector_version: string
          created_at: string
          device_name: string
          expires_at: string
          id: string
          platform: string
          redeemed_at: string | null
          status: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_party_id?: string | null
          attempts?: number
          connector_version: string
          created_at?: string
          device_name: string
          expires_at: string
          id?: string
          platform: string
          redeemed_at?: string | null
          status?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_party_id?: string | null
          attempts?: number
          connector_version?: string
          created_at?: string
          device_name?: string
          expires_at?: string
          id?: string
          platform?: string
          redeemed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_pairings_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_pairings_approved_party_id_fkey"
            columns: ["approved_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      device_sessions: {
        Row: {
          created_at: string
          device_id: string
          expires_at: string
          id: string
          last_used_at: string | null
          owner_id: string
          party_id: string
          revoked_at: string | null
          token_generation: number
        }
        Insert: {
          created_at?: string
          device_id: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          owner_id: string
          party_id: string
          revoked_at?: string | null
          token_generation?: number
        }
        Update: {
          created_at?: string
          device_id?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          owner_id?: string
          party_id?: string
          revoked_at?: string | null
          token_generation?: number
        }
        Relationships: [
          {
            foreignKeyName: "device_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_sessions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_sessions_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          connector_version: string | null
          created_at: string
          id: string
          last_seen_at: string | null
          name: string
          owner_id: string
          party_id: string
          platform: string
          status: string
        }
        Insert: {
          connector_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name: string
          owner_id: string
          party_id: string
          platform?: string
          status?: string
        }
        Update: {
          connector_version?: string | null
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name?: string
          owner_id?: string
          party_id?: string
          platform?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          code_hash: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          max_uses: number
          party_id: string
          revoked_at: string | null
          role: string
          use_count: number
        }
        Insert: {
          code_hash: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          max_uses?: number
          party_id: string
          revoked_at?: string | null
          role?: string
          use_count?: number
        }
        Update: {
          code_hash?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          max_uses?: number
          party_id?: string
          revoked_at?: string | null
          role?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      parties: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parties_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      party_members: {
        Row: {
          joined_at: string
          party_id: string
          role: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          party_id: string
          role?: string
          user_id: string
        }
        Update: {
          joined_at?: string
          party_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "party_members_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "party_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          created_by: string
          description: string
          id: string
          name: string
          party_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string
          id?: string
          name: string
          party_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          name?: string
          party_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      task_runs: {
        Row: {
          agent_id: string | null
          attempt: number
          created_at: string
          device_id: string
          error_code: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          last_heartbeat_at: string
          lease_expires_at: string
          party_id: string
          result_summary: string | null
          session_id: string
          started_at: string
          status: string
          task_id: string
        }
        Insert: {
          agent_id?: string | null
          attempt: number
          created_at?: string
          device_id: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          last_heartbeat_at?: string
          lease_expires_at: string
          party_id: string
          result_summary?: string | null
          session_id: string
          started_at?: string
          status?: string
          task_id: string
        }
        Update: {
          agent_id?: string | null
          attempt?: number
          created_at?: string
          device_id?: string
          error_code?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          last_heartbeat_at?: string
          lease_expires_at?: string
          party_id?: string
          result_summary?: string | null
          session_id?: string
          started_at?: string
          status?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_runs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_runs_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_runs_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "device_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_runs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_agent_id: string | null
          assigned_device_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          party_id: string
          priority: string
          project_id: string | null
          required_capabilities: Json
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_agent_id?: string | null
          assigned_device_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string
          id?: string
          party_id: string
          priority?: string
          project_id?: string | null
          required_capabilities?: Json
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_agent_id?: string | null
          assigned_device_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          party_id?: string
          priority?: string
          project_id?: string | null
          required_capabilities?: Json
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_agent_id_fkey"
            columns: ["assigned_agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_device_id_fkey"
            columns: ["assigned_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          actor_id: string
          agent_id: string | null
          cached_input_tokens: number
          cost_usd: number
          created_at: string
          device_id: string | null
          duration_ms: number
          id: number
          input_tokens: number
          model: string
          output_tokens: number
          party_id: string
          provider: string
          task_id: string | null
        }
        Insert: {
          actor_id: string
          agent_id?: string | null
          cached_input_tokens?: number
          cost_usd?: number
          created_at?: string
          device_id?: string | null
          duration_ms?: number
          id?: never
          input_tokens?: number
          model: string
          output_tokens?: number
          party_id: string
          provider: string
          task_id?: string | null
        }
        Update: {
          actor_id?: string
          agent_id?: string | null
          cached_input_tokens?: number
          cost_usd?: number
          created_at?: string
          device_id?: string | null
          duration_ms?: number
          id?: never
          input_tokens?: number
          model?: string
          output_tokens?: number
          party_id?: string
          provider?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_device_pairing: {
        Args: { p_code_hash: string; p_party_id: string; p_user_id: string }
        Returns: {
          device_name: string
          expires_at: string
          pairing_id: string
          platform: string
        }[]
      }
      claim_next_task: {
        Args: {
          p_agent_id: string
          p_capabilities: Json
          p_device_id: string
          p_idempotency_key: string
          p_lease_seconds?: number
        }
        Returns: {
          description: string
          folder_id: string
          lease_expires_at: string
          party_id: string
          priority: string
          project_id: string
          run_id: string
          task_id: string
          title: string
        }[]
      }
      complete_task_run: {
        Args: {
          p_device_id: string
          p_error_code?: string
          p_result_summary?: string
          p_run_id: string
          p_status: string
        }
        Returns: boolean
      }
      connector_heartbeat: {
        Args: {
          p_connector_version?: string
          p_device_id: string
          p_lease_seconds?: number
          p_run_id?: string
        }
        Returns: {
          device_status: string
          renewed_lease_expires_at: string
        }[]
      }
      connector_pair_redeem: {
        Args: {
          p_code_hash: string
          p_pairing_secret_hash: string
          p_refresh_token_hash: string
        }
        Returns: {
          connector_version: string
          device_id: string
          owner_id: string
          party_id: string
          session_expires_at: string
          session_id: string
        }[]
      }
      connector_pair_start: {
        Args: {
          p_code_hash: string
          p_connector_version: string
          p_device_name: string
          p_pairing_secret_hash: string
          p_platform: string
          p_request_ip_hash: string
        }
        Returns: {
          expires_at: string
          pairing_id: string
        }[]
      }
      connector_rotate_session: {
        Args: {
          p_connector_version: string
          p_next_refresh_token_hash: string
          p_refresh_token_hash: string
        }
        Returns: {
          device_id: string
          owner_id: string
          party_id: string
          session_expires_at: string
          session_id: string
          token_generation: number
        }[]
      }
      create_party: {
        Args: { party_name: string; party_slug: string }
        Returns: string
      }
      decide_task_approval: {
        Args: { p_approval_id: string; p_decision: string }
        Returns: {
          approval_id: string
          run_id: string
          status: string
          task_id: string
        }[]
      }
      reap_expired_task_leases: {
        Args: never
        Returns: {
          expired_approvals: number
          requeued_runs: number
        }[]
      }
      request_task_approval: {
        Args: {
          p_device_id: string
          p_expires_seconds?: number
          p_kind: string
          p_manifest: Json
          p_run_id: string
        }
        Returns: {
          approval_id: string
          expires_at: string
          manifest_hash: string
          status: string
        }[]
      }
      revoke_device_session: {
        Args: { p_session_id: string; p_user_id: string }
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
    Enums: {},
  },
} as const
