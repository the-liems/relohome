import { useCallback, useContext } from "react";
import { RoommateIdentity } from "./Features";
import { roommate } from "./client";

// The gateway validates this against the cookie; it never trusts it as identity.
export function useRoommateClient(viewerId?: string) {
  const identity = useContext(RoommateIdentity);
  const expected = viewerId || identity.id;
  return useCallback(
    function call<T>(
      path: string,
      method = "GET",
      body?: unknown,
      signal?: AbortSignal,
    ) {
      return roommate<T>(path, method, body, signal, expected);
    },
    [expected],
  );
}
