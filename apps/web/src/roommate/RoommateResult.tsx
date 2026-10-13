import { Link } from "react-router-dom";
import { UsersRound, ArrowRight } from "lucide-react";
import { rt } from "./text";
import type { Data } from "../types";
export function RoommateResult({ data }: { data: Data }) {
  return (
    <section className="result-group">
      <div className="section-heading">
        <span className="service-icon mint">
          <UsersRound size={21} aria-hidden="true" />
        </span>
        <div>
          <h3>{rt("Tìm người ở cùng", "Roommate discovery")}</h3>
          <p>
            {rt(
              "Bạn xem hồ sơ và tự quyết định kết nối.",
              "Explore profiles and decide who to connect with.",
            )}
          </p>
        </div>
      </div>
      <p>
        {data.availability === "disabled"
          ? rt("Dịch vụ chưa được bật.", "The service is not enabled yet.")
          : data.availability === "ready"
            ? rt(
                "Mở Roommate để xem hồ sơ theo quyền hiện tại và điều chỉnh tiêu chí.",
                "Open Roommate to view currently available profiles and refine your criteria.",
              )
            : rt(
                "Chọn tiêu chí trong Roommate để bắt đầu. Không cần đăng hồ sơ công khai.",
                "Choose criteria in Roommate to get started. No public profile is required.",
              )}
      </p>
      <Link
        className="secondary"
        to="/roommate"
        state={{ criteria: data.criteria || undefined }}
      >
        {rt("Mở tìm người ở cùng", "Open roommate discovery")}
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </section>
  );
}
