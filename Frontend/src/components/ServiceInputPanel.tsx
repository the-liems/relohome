import { useState } from "react";
import { ArrowRight, ListFilter, X } from "lucide-react";
import { t as uiText } from "../uiPreferences";
import {
  guidedReplyText,
  requestDefaults,
  type FormService,
} from "../serviceRequest";
import type { Thread } from "../types";
import { TaskForm } from "./Forms";

const names: Record<FormService, string> = {
  flight: "Thông tin chuyến bay",
  property: "Tiêu chí tìm nhà",
  map: "Thông tin đường đi",
};

export function ServiceInputPanel({
  services,
  thread,
  disabled,
  onSubmit,
  onChat,
}: {
  services: FormService[];
  thread: Thread;
  disabled: boolean;
  onSubmit: (text: string) => Promise<void>;
  onChat: () => void;
}) {
  const [active, setActive] = useState(services[0]),
    [closed, setClosed] = useState(false);
  const selected = services.includes(active) ? active : services[0];
  if (!selected) return null;
  const close = () => {
    setClosed(true);
    onChat();
  };
  const reply = [...thread.messages]
    .reverse()
    .find((m) => m.role === "assistant")?.content.response;
  const questions = (reply?.questions || []).filter(
    (q) => q.text && guidedReplyText(String(q.text), [q], services) === "",
  );
  return (
    <>
      <section
        className="guided-service-panel"
        hidden={closed}
        data-service={selected}
        aria-label={uiText("Bổ sung thông tin dịch vụ")}
      >
        <div className="guided-panel-title">
          <ListFilter size={18} aria-hidden="true" />
          <h2>{uiText("Điền thông tin để tiếp tục")}</h2>
          <button
            type="button"
            className="icon-button"
            disabled={disabled}
            aria-label={uiText("Tiếp tục bằng chat")}
            onClick={close}
          >
            <X size={18} />
          </button>
        </div>
        {services.length > 1 && (
          <div
            className="guided-panel-tabs"
            role="group"
            aria-label={uiText("Dịch vụ cần bổ sung")}
          >
            {services.map((s) => (
              <button
                key={s}
                className={selected === s ? "primary" : "secondary"}
                aria-pressed={selected === s}
                disabled={disabled}
                onClick={() => setActive(s)}
              >
                {uiText(names[s])}
              </button>
            ))}
          </div>
        )}
        {services.map((service) => (
          <div
            key={service}
            hidden={selected !== service}
            className="request-pane"
          >
            <TaskForm
              kind={service}
              embedded
              known={requestDefaults(thread, service)}
              questions={reply?.questions || []}
              disabled={disabled}
              onSubmit={onSubmit}
              onClose={close}
            />
          </div>
        ))}
      </section>
      {closed && (
        <div>
          <p className="prose">{questions.map((q) => q.text).join("\n")}</p>
          <button
            className="secondary guided-reopen"
            disabled={disabled}
            onClick={() => setClosed(false)}
          >
            <ListFilter size={16} />
            {uiText("Điền thông tin bằng biểu mẫu")}
            <ArrowRight size={15} />
          </button>
        </div>
      )}
    </>
  );
}
