import { createServerFn } from "@tanstack/react-start";

export type GroupOption = { level: string; rotation: string; label: string };

/**
 * Groups configured in the DB (via the list_groups RPC — level/rotation/label
 * only, chat_id never leaves the server). Empty array on any failure so the
 * form renders with a "no groups" notice instead of crashing.
 */
export const listGroups = createServerFn({ method: "GET" }).handler(
  async (): Promise<GroupOption[]> => {
    const url =
      import.meta.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"];
    const key =
      import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
      process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return [];

    try {
      const res = await fetch(`${url}/rest/v1/rpc/list_groups`, {
        method: "POST",
        headers: {
          apikey: key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) return [];
      return (await res.json()) as GroupOption[];
    } catch {
      return [];
    }
  },
);
