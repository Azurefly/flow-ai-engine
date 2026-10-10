import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clearAccountQueries } from "@/lib/account-query-isolation";

export function useAccountQueryIsolation(userId: number | null) {
  const client = useQueryClient();
  const [isolatedId, setIsolatedId] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    void clearAccountQueries(client).then(() => {
      if (current) setIsolatedId(userId);
    });
    return () => { current = false; };
  }, [client, userId]);
  return isolatedId === userId;
}
