/** Shared by JSON and binary clients. Permission failures must not become login loops. */
export function requestSignIn() {
  window.dispatchEvent(new CustomEvent("relohome-login-required"));
}

// Only read loaders subscribe. Successful login must never replay a mutation.
export const AUTH_RESTORED = "relohome-auth-restored";

export function reportAuthFailure(
  path: string,
  status: number,
  data: unknown,
  isJson = true,
) {
  if (path.startsWith("/auth/") || path === "/session") return;
  const body =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const detail =
    body.detail && typeof body.detail === "object"
      ? (body.detail as Record<string, unknown>)
      : {};
  const code = body.code || detail.code;
  if (code === "guest_expired") {
    window.dispatchEvent(new CustomEvent("relohome-guest-expired"));
  } else if (code === "authentication_required" || (isJson && status === 401)) {
    requestSignIn();
  }
}
