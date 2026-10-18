export type TourKind = "housing" | "moving";
export type TourContext = "chat" | "housing-map" | "moving-form" | "other";
export type TourCopy = readonly [string, string];
export interface TourStep {
  target: string;
  title: TourCopy;
  body: TourCopy;
}

// Stable UI anchors, not translated text or provider data. These steps never invoke application actions.
export function tourSteps(kind: TourKind, context: TourContext): TourStep[] {
  if (kind === "housing" && context === "housing-map")
    return [
      {
        target: '[data-tour="housing-map"]',
        title: ["Khám phá các căn trên bản đồ", "Explore homes on the map"],
        body: [
          "Bấm một căn hoặc điểm trên bản đồ để xem thông tin. Nhiều căn có thể chung một điểm.",
          "Open a home or map marker to see its details. Several homes may share one marker.",
        ],
      },
      {
        target: '[data-tour="housing-filters"]',
        title: ["Điều chỉnh tiêu chí", "Adjust your filters"],
        body: [
          "Dùng bộ lọc để đổi giá, loại nhà hoặc phòng ngủ. Bạn không cần bắt đầu lại cuộc trò chuyện.",
          "Use filters to change price, home type or bedrooms without starting a new conversation.",
        ],
      },
      {
        target: '[data-tour="workspace-chat"]',
        title: ["Tiếp tục nhắn ngay tại đây", "Keep chatting here"],
        body: [
          "Mở chat để nói như: Đổi sang Cầu Giấy, giữ mức giá. Bản đồ vẫn là nơi bạn xem kết quả.",
          "Open chat and say, for example: Change to Cau Giay, keep the budget. Your results stay on the map.",
        ],
      },
      {
        target: '[data-tour="plan"]',
        title: ["Chọn căn rồi hẹn xem", "Choose homes, then arrange viewings"],
        body: [
          "Chọn căn bạn quan tâm. Mở Kế hoạch để xem các lựa chọn và tiếp tục hẹn xem khi tính năng khả dụng; chọn căn chưa phải chốt thuê.",
          "Select homes you like. Open Plan to review your choices and arrange viewings when available; selecting a home is not a rental agreement.",
        ],
      },
    ];
  if (kind === "moving" && context === "moving-form")
    return [
      {
        target: '[data-moving-section="locations"]',
        title: ["Chốt hai điểm A và B", "Confirm pickup A and destination B"],
        body: [
          "Tìm địa chỉ hoặc ghim trên bản đồ, rồi kiểm tra lại điểm lấy và điểm giao trước khi báo giá.",
          "Search for an address or pin it on the map, then check both locations before requesting a quote.",
        ],
      },
      {
        target: '[data-moving-section="schedule"]',
        title: [
          "Chọn lịch và khai đồ cần chuyển",
          "Choose a time and describe your items",
        ],
        body: [
          "Chọn ngày, giờ xe đến. Ở mục Hàng hóa, thêm khối lượng và kích thước nếu có để hãng kiểm tra.",
          "Choose the pickup date and time. Under Items, add weight and dimensions when available for the provider to check.",
        ],
      },
      {
        target: '[data-moving-section="vehicle"]',
        title: [
          "Chọn xe hoặc để ReloHome gợi ý",
          "Choose a vehicle or ask ReloHome",
        ],
        body: [
          "Danh mục phụ thuộc điểm A. Bạn có thể chọn gói cụ thể hoặc để ReloHome đề xuất; ghi rõ yêu cầu đặc biệt trong ghi chú.",
          "The catalog depends on pickup A. Choose a service or let ReloHome suggest options; include special requirements in your notes.",
        ],
      },
      {
        target: '[data-tour="moving-quote"]',
        title: [
          "Xem báo giá trước khi quyết định",
          "Review quotes before deciding",
        ],
        body: [
          "Chỉ khi bạn bấm xác nhận, hệ thống mới gửi yêu cầu báo giá. Báo giá chưa phải đặt đơn hay thanh toán. Hướng dẫn không bấm thay bạn.",
          "A quote request is sent only when you confirm. A quote is not a booking or payment. This guide never confirms for you.",
        ],
      },
    ];
  if (kind === "moving")
    return [
      {
        target: '.quick-card[data-service="relocation"]',
        title: ["Bắt đầu từ Chuyển đồ", "Start with Moving"],
        body: [
          "Sau khi đóng hướng dẫn, bấm Chuyển đồ để mở form chọn điểm A/B, lịch chuyển và gói xe.",
          "After closing this guide, choose Moving to open the form for your locations, schedule and vehicle.",
        ],
      },
      {
        target: '[data-tour="chat-composer"]',
        title: [
          "Hoặc kể nhu cầu bằng tin nhắn",
          "Or describe your move in chat",
        ],
        body: [
          "Bạn cũng có thể nhắn cho ReloHome. Chưa đủ thông tin thì hệ thống sẽ hỏi thêm, không tự đặt đơn.",
          "You can also message ReloHome. If details are missing, it will ask rather than place an order.",
        ],
      },
      {
        target: '[data-tour="plan"]',
        title: ["Xem lại trong Kế hoạch", "Review your Plan"],
        body: [
          "Các phương án đã chọn nằm trong Kế hoạch. Trong form chuyển đồ, bấm nút dấu hỏi nếu muốn xem hướng dẫn đúng từng mục.",
          "Your selected options appear in Plan. In the moving form, use the help button for a guide to each section.",
        ],
      },
    ];
  return [
    {
      target: '[data-tour="chat-composer"]',
      title: ["Nói khu vực và ngân sách", "Tell us your area and budget"],
      body: [
        "Ví dụ: Tìm nhà ở Cầu Giấy dưới 5 triệu. Bạn tự nhập và gửi khi sẵn sàng; hướng dẫn không gửi tin nhắn.",
        "For example: Find a home in Cau Giay under 5 million VND. Type and send when ready; this guide never sends a message.",
      ],
    },
    {
      target: '.quick-card[data-service="property"]',
      title: ["Thích điền form? Bắt đầu ở đây", "Prefer a form? Start here"],
      body: [
        "Nút Tìm nhà mở form tiêu chí. Chọn cách nhắn hoặc điền form, không cần làm cả hai.",
        "Find a home opens the search form. Choose chat or the form; you do not need to do both.",
      ],
    },
    {
      target: '[data-tour="plan"]',
      title: [
        "Tìm xong, khám phá trên bản đồ",
        "After searching, explore the map",
      ],
      body: [
        "Khi có kết quả, xem căn và đổi bộ lọc trên bản đồ. Kế hoạch giữ các lựa chọn của bạn. Nút dấu hỏi trên bản đồ sẽ chỉ tiếp từng chỗ.",
        "When results arrive, explore homes and adjust filters on the map. Plan keeps your choices. Use the map's help button for the next steps.",
      ],
    },
  ];
}

export const ONBOARDING_SEEN_KEY = "relohome.onboarding.v1.seen";
let seenInMemory = false;
export function hasSeenOnboarding(): boolean {
  try {
    return seenInMemory || localStorage.getItem(ONBOARDING_SEEN_KEY) === "1";
  } catch {
    return seenInMemory;
  }
}
export function rememberOnboarding() {
  seenInMemory = true;
  try {
    localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
  } catch {
    /* Optional device preference. */
  }
}
