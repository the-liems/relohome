import { reportAuthFailure } from "../authEvents";

export class RoommateError extends Error {
  constructor(
    public code: string,
    public status: number,
    public retryAt?: string,
    public reasons: string[] = [],
  ) {
    super(code);
  }
}
export async function roommate<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  expectedActor?: string,
): Promise<T> {
  let response: Response;
  const write =
    method !== "GET" &&
    !["/search", "/map/rooms", "/me/profile/preview"].includes(path);
  try {
    response = await fetch("/web/api/roommate" + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: signal || AbortSignal.timeout(30000),
      headers: {
        "Content-Type": "application/json",
        "X-SIU-Request": "1",
        ...(expectedActor ? { "X-Roommate-Actor": expectedActor } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new RoommateError(
      write ? "operation_unknown" : "service_unavailable",
      503,
    );
  }
  let data;
  try {
    data = response.status === 204 ? null : await response.json();
  } catch {
    throw new RoommateError(
      write ? "operation_unknown" : "service_unavailable",
      502,
    );
  }
  if (!response.ok) {
    reportAuthFailure("/roommate" + path, response.status, data);
    const detail = data?.detail;
    throw new RoommateError(
      detail?.code ||
        data?.code ||
        (response.status === 401 ? "authentication_required" : "invalid_input"),
      response.status,
      detail?.retry_at,
      detail?.reasons,
    );
  }
  return data as T;
}
