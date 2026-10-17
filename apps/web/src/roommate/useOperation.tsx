import { useContext, useEffect, useRef, useState } from "react";
import { RoommateError } from "./client";
import { useRoommateClient } from "./useRoommateClient";
import { ErrorNotice } from "./ErrorNotice";
import { rt } from "./text";
import { RoommateFeatures } from "./Features";
type Result = Record<string, unknown>;
type Pending = {
  path: string;
  method: string;
  body: Record<string, unknown>;
  done: (result: Result) => void;
};
export function useOperation() {
  const roommate = useRoommateClient();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const draftsEnabled =
    useContext(RoommateFeatures).includes("operation_drafts");
  const current = useRef<Pending | null>(null),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [uncertain, setUncertain] = useState(false),
    [notFound, setNotFound] = useState(false);
  async function execute(operation: Pending) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setNotFound(false);
    try {
      if (draftsEnabled)
        await roommate("/operation-drafts", "PUT", {
          path: operation.path,
          method: operation.method,
          body: operation.body,
        });
      if (!active.current) return;
      const result = await roommate<Result>(
        operation.path,
        operation.method,
        operation.body,
      );
      if (!active.current) return;
      current.current = null;
      setUncertain(false);
      operation.done(result);
    } catch (e) {
      if (!active.current) return;
      setError(e);
      const unknown =
        e instanceof RoommateError && e.code === "operation_unknown";
      setUncertain(unknown);
      if (!unknown) {
        current.current = null;
        if (draftsEnabled)
          void roommate(
            "/operation-drafts/" + operation.body.operation_key,
            "DELETE",
          ).catch(() => {});
      }
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  function run(
    path: string,
    method: string,
    body: Record<string, unknown>,
    done: Pending["done"],
  ) {
    if (locked.current || current.current) return;
    const operation = {
      path,
      method,
      body: { ...body, operation_key: crypto.randomUUID() },
      done,
    };
    current.current = operation;
    void execute(operation);
  }
  async function check() {
    const operation = current.current;
    if (!operation || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const response = await roommate<{ status: string; result?: Result }>(
        "/operations/" + operation.body.operation_key,
      );
      if (!active.current) return;
      if (response.status === "completed" && response.result) {
        current.current = null;
        setUncertain(false);
        setError(null);
        operation.done(response.result);
      } else setNotFound(true);
    } catch (e) {
      if (!active.current) return;
      setError(e);
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  }
  const notice = (
    <>
      <ErrorNotice error={error} />
      {uncertain && (
        <div className="rm-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void check()}
          >
            {rt("Kiểm tra trạng thái", "Check status")}
          </button>
          {notFound && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => current.current && void execute(current.current)}
            >
              {rt("Gửi lại cùng yêu cầu", "Retry the same request")}
            </button>
          )}
        </div>
      )}
    </>
  );
  return { run, busy, uncertain, notice, disabled: busy || uncertain };
}
