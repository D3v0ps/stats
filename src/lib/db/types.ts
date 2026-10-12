// Hand-written Database type for supabase-js, in the shape `supabase gen types` emits.
// It mirrors supabase/migrations exactly: supabase/tests/types-drift.test.ts checks
// every table, column (type, nullability, insert optionality), foreign key and RPC
// signature against the migrated schema, so this file cannot silently drift.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "13";
  };
  public: {
    Tables: {
      account_group_ranges: {
        Row: {
          from_account: number;
          group_key: string;
          id: number;
          to_account: number;
        };
        Insert: {
          from_account: number;
          group_key: string;
          id?: number;
          to_account: number;
        };
        Update: {
          from_account?: number;
          group_key?: string;
          id?: number;
          to_account?: number;
        };
        Relationships: [
          {
            foreignKeyName: "account_group_ranges_group_key_fkey";
            columns: ["group_key"];
            isOneToOne: false;
            referencedRelation: "account_groups";
            referencedColumns: ["key"];
          },
        ];
      };
      account_groups: {
        Row: {
          key: string;
          name: string;
          sign: number;
          sort: number;
        };
        Insert: {
          key: string;
          name: string;
          sign: number;
          sort?: number;
        };
        Update: {
          key?: string;
          name?: string;
          sign?: number;
          sort?: number;
        };
        Relationships: [];
      };
      app_users: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          action: string;
          actor: string | null;
          at: string;
          detail: Json;
          entity: string;
          entity_id: string | null;
          id: number;
        };
        Insert: {
          action: string;
          actor?: string | null;
          at?: string;
          detail?: Json;
          entity: string;
          entity_id?: string | null;
          id?: never;
        };
        Update: {
          action?: string;
          actor?: string | null;
          at?: string;
          detail?: Json;
          entity?: string;
          entity_id?: string | null;
          id?: never;
        };
        Relationships: [];
      };
      board_reports: {
        Row: {
          anchor_month: string;
          frozen_at: string;
          id: string;
          schema_version: number;
          snapshot: Json;
          template_id: string | null;
          title: string;
        };
        Insert: {
          anchor_month: string;
          frozen_at?: string;
          id?: string;
          schema_version?: number;
          snapshot: Json;
          template_id?: string | null;
          title: string;
        };
        Update: {
          anchor_month?: string;
          frozen_at?: string;
          id?: string;
          schema_version?: number;
          snapshot?: Json;
          template_id?: string | null;
          title?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          code: string;
          fiscal_start_month: number;
          id: number;
          legal_name: string;
          org_nr: string;
          short_name: string;
        };
        Insert: {
          code: string;
          fiscal_start_month?: number;
          id: number;
          legal_name: string;
          org_nr: string;
          short_name: string;
        };
        Update: {
          code?: string;
          fiscal_start_month?: number;
          id?: number;
          legal_name?: string;
          org_nr?: string;
          short_name?: string;
        };
        Relationships: [];
      };
      dashboards: {
        Row: {
          id: string;
          is_default: boolean;
          name: string;
          spec: Json;
          updated_at: string;
        };
        Insert: {
          id?: string;
          is_default?: boolean;
          name: string;
          spec: Json;
          updated_at?: string;
        };
        Update: {
          id?: string;
          is_default?: boolean;
          name?: string;
          spec?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      dataset_dimensions: {
        Row: {
          dataset_id: number;
          dimension_id: number;
        };
        Insert: {
          dataset_id: number;
          dimension_id: number;
        };
        Update: {
          dataset_id?: number;
          dimension_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "dataset_dimensions_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dataset_dimensions_dimension_id_fkey";
            columns: ["dimension_id"];
            isOneToOne: false;
            referencedRelation: "dimensions";
            referencedColumns: ["id"];
          },
        ];
      };
      datasets: {
        Row: {
          id: number;
          key: string;
          kind: string;
          name: string;
        };
        Insert: {
          id?: number;
          key: string;
          kind: string;
          name: string;
        };
        Update: {
          id?: number;
          key?: string;
          kind?: string;
          name?: string;
        };
        Relationships: [];
      };
      dimension_aliases: {
        Row: {
          alias_norm: string;
          dimension_id: number;
          value_id: number;
        };
        Insert: {
          alias_norm: string;
          dimension_id: number;
          value_id: number;
        };
        Update: {
          alias_norm?: string;
          dimension_id?: number;
          value_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "dimension_aliases_dimension_id_fkey";
            columns: ["dimension_id"];
            isOneToOne: false;
            referencedRelation: "dimensions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dimension_aliases_value_id_dimension_id_fkey";
            columns: ["value_id", "dimension_id"];
            isOneToOne: false;
            referencedRelation: "dimension_values";
            referencedColumns: ["id", "dimension_id"];
          },
        ];
      };
      dimension_values: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          dimension_id: number;
          id: number;
          label: string;
          sort: number;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          dimension_id: number;
          id?: number;
          label: string;
          sort?: number;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          dimension_id?: number;
          id?: number;
          label?: string;
          sort?: number;
        };
        Relationships: [
          {
            foreignKeyName: "dimension_values_dimension_id_fkey";
            columns: ["dimension_id"];
            isOneToOne: false;
            referencedRelation: "dimensions";
            referencedColumns: ["id"];
          },
        ];
      };
      dimensions: {
        Row: {
          id: number;
          is_personal: boolean;
          key: string;
          label: string;
          unknown_policy: string;
        };
        Insert: {
          id?: number;
          is_personal?: boolean;
          key: string;
          label: string;
          unknown_policy?: string;
        };
        Update: {
          id?: number;
          is_personal?: boolean;
          key?: string;
          label?: string;
          unknown_policy?: string;
        };
        Relationships: [];
      };
      import_template_versions: {
        Row: {
          config: Json;
          created_at: string;
          template_id: string;
          version: number;
        };
        Insert: {
          config: Json;
          created_at?: string;
          template_id: string;
          version: number;
        };
        Update: {
          config?: Json;
          created_at?: string;
          template_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "import_template_versions_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "import_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      import_templates: {
        Row: {
          created_at: string;
          current_version: number;
          dataset_id: number;
          header_signature: Json;
          id: string;
          kind: string;
          name: string;
          sheet_hint: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          current_version?: number;
          dataset_id: number;
          header_signature?: Json;
          id?: string;
          kind: string;
          name: string;
          sheet_hint?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          current_version?: number;
          dataset_id?: number;
          header_signature?: Json;
          id?: string;
          kind?: string;
          name?: string;
          sheet_hint?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "import_templates_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_accounts: {
        Row: {
          account: number;
          company_id: number;
          name: string;
        };
        Insert: {
          account: number;
          company_id: number;
          name: string;
        };
        Update: {
          account?: number;
          company_id?: number;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_balances: {
        Row: {
          account: number;
          amount: number;
          company_id: number;
          dim_no: number | null;
          id: number;
          month: string;
          object_value_id: number | null;
          source: string;
          upload_id: string;
          year_offset: number;
        };
        Insert: {
          account: number;
          amount: number;
          company_id: number;
          dim_no?: number | null;
          id?: never;
          month: string;
          object_value_id?: number | null;
          source: string;
          upload_id: string;
          year_offset?: number;
        };
        Update: {
          account?: number;
          amount?: number;
          company_id?: number;
          dim_no?: number | null;
          id?: never;
          month?: string;
          object_value_id?: number | null;
          source?: string;
          upload_id?: string;
          year_offset?: number;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_balances_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_balances_object_value_id_fkey";
            columns: ["object_value_id"];
            isOneToOne: false;
            referencedRelation: "dimension_values";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_balances_upload_id_fkey";
            columns: ["upload_id"];
            isOneToOne: false;
            referencedRelation: "uploads";
            referencedColumns: ["id"];
          },
        ];
      };
      metric_values: {
        Row: {
          company_id: number;
          dims: Json;
          id: number;
          metric_id: number;
          month: string;
          source_rows: number[] | null;
          upload_id: string;
          value: number;
        };
        Insert: {
          company_id: number;
          dims?: Json;
          id?: never;
          metric_id: number;
          month: string;
          source_rows?: number[] | null;
          upload_id: string;
          value: number;
        };
        Update: {
          company_id?: number;
          dims?: Json;
          id?: never;
          metric_id?: number;
          month?: string;
          source_rows?: number[] | null;
          upload_id?: string;
          value?: number;
        };
        Relationships: [
          {
            foreignKeyName: "metric_values_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "metric_values_metric_id_fkey";
            columns: ["metric_id"];
            isOneToOne: false;
            referencedRelation: "metrics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "metric_values_upload_id_fkey";
            columns: ["upload_id"];
            isOneToOne: false;
            referencedRelation: "uploads";
            referencedColumns: ["id"];
          },
        ];
      };
      metrics: {
        Row: {
          account_group_key: string | null;
          base_metric_id: number | null;
          dataset_id: number | null;
          decimals: number | null;
          description: string | null;
          distinct_dimension_id: number | null;
          formula: string | null;
          headline_subject: string | null;
          higher_is_better: boolean | null;
          id: number;
          is_system: boolean;
          key: string;
          kind: string;
          name: string;
          snapshot_rollup: string | null;
          unit: string;
        };
        Insert: {
          account_group_key?: string | null;
          base_metric_id?: number | null;
          dataset_id?: number | null;
          decimals?: number | null;
          description?: string | null;
          distinct_dimension_id?: number | null;
          formula?: string | null;
          headline_subject?: string | null;
          higher_is_better?: boolean | null;
          id?: number;
          is_system?: boolean;
          key: string;
          kind: string;
          name: string;
          snapshot_rollup?: string | null;
          unit: string;
        };
        Update: {
          account_group_key?: string | null;
          base_metric_id?: number | null;
          dataset_id?: number | null;
          decimals?: number | null;
          description?: string | null;
          distinct_dimension_id?: number | null;
          formula?: string | null;
          headline_subject?: string | null;
          higher_is_better?: boolean | null;
          id?: number;
          is_system?: boolean;
          key?: string;
          kind?: string;
          name?: string;
          snapshot_rollup?: string | null;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "metrics_account_group_key_fkey";
            columns: ["account_group_key"];
            isOneToOne: false;
            referencedRelation: "account_groups";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "metrics_base_metric_id_fkey";
            columns: ["base_metric_id"];
            isOneToOne: false;
            referencedRelation: "metrics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "metrics_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "metrics_distinct_dimension_id_fkey";
            columns: ["distinct_dimension_id"];
            isOneToOne: false;
            referencedRelation: "dimensions";
            referencedColumns: ["id"];
          },
        ];
      };
      period_status: {
        Row: {
          closed_at: string;
          company_id: number;
          month: string;
        };
        Insert: {
          closed_at?: string;
          company_id: number;
          month: string;
        };
        Update: {
          closed_at?: string;
          company_id?: number;
          month?: string;
        };
        Relationships: [
          {
            foreignKeyName: "period_status_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      report_templates: {
        Row: {
          id: string;
          name: string;
          slides: Json;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slides?: Json;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slides?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      settings: {
        Row: {
          key: string;
          updated_at: string;
          value: Json;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value: Json;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: Json;
        };
        Relationships: [];
      };
      share_links: {
        Row: {
          board_report_id: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          label: string | null;
          last_viewed_at: string | null;
          revoked_at: string | null;
          token_hash: string;
          view_count: number;
        };
        Insert: {
          board_report_id: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          label?: string | null;
          last_viewed_at?: string | null;
          revoked_at?: string | null;
          token_hash: string;
          view_count?: number;
        };
        Update: {
          board_report_id?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          label?: string | null;
          last_viewed_at?: string | null;
          revoked_at?: string | null;
          token_hash?: string;
          view_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "share_links_board_report_id_fkey";
            columns: ["board_report_id"];
            isOneToOne: false;
            referencedRelation: "board_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      upload_slices: {
        Row: {
          company_id: number;
          dataset_id: number;
          is_current: boolean;
          month: string;
          priority: number;
          scenario: string;
          upload_id: string;
        };
        Insert: {
          company_id: number;
          dataset_id: number;
          is_current?: boolean;
          month: string;
          priority?: number;
          scenario: string;
          upload_id: string;
        };
        Update: {
          company_id?: number;
          dataset_id?: number;
          is_current?: boolean;
          month?: string;
          priority?: number;
          scenario?: string;
          upload_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "upload_slices_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "upload_slices_upload_id_dataset_id_scenario_fkey";
            columns: ["upload_id", "dataset_id", "scenario"];
            isOneToOne: false;
            referencedRelation: "uploads";
            referencedColumns: ["id", "dataset_id", "scenario"];
          },
        ];
      };
      uploads: {
        Row: {
          as_of_date: string | null;
          content_hash: string;
          created_at: string;
          dataset_id: number;
          engine_version: number;
          file_name: string;
          file_sha256: string;
          file_size: number;
          id: string;
          parse_report: Json;
          published_at: string | null;
          retract_reason: string | null;
          retracted_at: string | null;
          scenario: string;
          status: string;
          template_id: string | null;
          template_version: number | null;
          totals: Json;
        };
        Insert: {
          as_of_date?: string | null;
          content_hash: string;
          created_at?: string;
          dataset_id: number;
          engine_version: number;
          file_name: string;
          file_sha256: string;
          file_size: number;
          id?: string;
          parse_report?: Json;
          published_at?: string | null;
          retract_reason?: string | null;
          retracted_at?: string | null;
          scenario: string;
          status?: string;
          template_id?: string | null;
          template_version?: number | null;
          totals?: Json;
        };
        Update: {
          as_of_date?: string | null;
          content_hash?: string;
          created_at?: string;
          dataset_id?: number;
          engine_version?: number;
          file_name?: string;
          file_sha256?: string;
          file_size?: number;
          id?: string;
          parse_report?: Json;
          published_at?: string | null;
          retract_reason?: string | null;
          retracted_at?: string | null;
          scenario?: string;
          status?: string;
          template_id?: string | null;
          template_version?: number | null;
          totals?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "uploads_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "datasets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "uploads_template_id_template_version_fkey";
            columns: ["template_id", "template_version"];
            isOneToOne: false;
            referencedRelation: "import_template_versions";
            referencedColumns: ["template_id", "version"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      discard_stale_uploads: {
        Args: { p_older_than_hours?: number };
        Returns: number;
      };
      keepalive: {
        Args: { [_ in never]: never };
        Returns: string;
      };
      discard_upload: {
        Args: { p_upload_id: string };
        Returns: Json;
      };
      ensure_dimension_values: {
        Args: { p_dimension: string; p_force?: boolean; p_labels: string[] };
        Returns: { id: number | null; label: string }[];
      };
      freeze_report: {
        Args: {
          p_anchor: string;
          p_snapshot: Json;
          p_template_id: string | null;
          p_title: string;
        };
        Returns: string;
      };
      ledger_monthly: {
        Args: {
          p_company_codes: string[] | null;
          p_from: string;
          p_group_by?: string[];
          p_group_keys: string[];
          p_to: string;
        };
        Returns: { group_key: string; grp: Json; month: string; value: number }[];
      };
      login_gate: {
        Args: { p_ip_hash: string };
        Returns: Json;
      };
      login_record: {
        Args: { p_attempt_id: string; p_ok: boolean };
        Returns: undefined;
      };
      merge_dimension_values: {
        Args: { p_from: number; p_into: number };
        Returns: Json;
      };
      metric_coverage: {
        Args: {
          p_company_codes: string[] | null;
          p_from: string;
          p_metric_keys: string[];
          p_scenario: string;
          p_to: string;
        };
        Returns: { metric_key: string; month: string }[];
      };
      metric_distinct: {
        Args: {
          p_base_metric_key: string;
          p_company_codes: string[] | null;
          p_dimension: string;
          p_filters?: Json;
          p_from: string;
          p_group_by?: string[];
          p_per_month?: boolean;
          p_scenario: string;
          p_to: string;
        };
        Returns: { cnt: number; grp: Json; month: string | null }[];
      };
      metric_monthly: {
        Args: {
          p_company_codes: string[] | null;
          p_filters?: Json;
          p_from: string;
          p_group_by?: string[];
          p_metric_keys: string[];
          p_scenario: string;
          p_to: string;
        };
        Returns: { grp: Json; metric_key: string; month: string; value: number }[];
      };
      metric_sources: {
        Args: {
          p_company_codes: string[] | null;
          p_from: string;
          p_metric_keys: string[];
          p_to: string;
        };
        Returns: {
          dataset_key: string;
          file_name: string;
          months: string[];
          published_at: string;
          template_name: string | null;
          template_version: number | null;
          upload_id: string;
        }[];
      };
      publish_upload: {
        Args: { p_upload_id: string };
        Returns: Json;
      };
      retract_upload: {
        Args: { p_reason?: string; p_upload_id: string };
        Returns: Json;
      };
      review_compare: {
        Args: { p_upload_id: string };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];

export type TableName = keyof PublicSchema["Tables"];
export type Tables<T extends TableName> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends TableName> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends TableName> = PublicSchema["Tables"][T]["Update"];

export type FunctionName = keyof PublicSchema["Functions"];
export type FunctionArgs<F extends FunctionName> = PublicSchema["Functions"][F]["Args"];
export type FunctionReturns<F extends FunctionName> = PublicSchema["Functions"][F]["Returns"];
