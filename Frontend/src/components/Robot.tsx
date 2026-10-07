import { useId } from "react";

export function Robot({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const id = useId().replaceAll(":", "");
  return (
    <svg
      className={"robot " + className}
      viewBox={compact ? "28 18 188 146" : "0 0 240 255"}
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={id + "body"}
          x1="55"
          y1="60"
          x2="200"
          y2="225"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--ai-shell-highlight)" />
          <stop offset=".5" stopColor="var(--ai-shell)" />
          <stop offset="1" stopColor="var(--ai-shell-shade)" />
        </linearGradient>
        <linearGradient id={id + "ear"}>
          <stop stopColor="#9bd8b6" />
          <stop offset="1" stopColor="#3f8860" />
        </linearGradient>
        <radialGradient id={id + "eye"}>
          <stop stopColor="#e6ffef" />
          <stop offset="1" stopColor="#72dca1" />
        </radialGradient>
      </defs>
      <ellipse cx="121" cy="239" rx="61" ry="9" fill="#49775b" opacity=".17" />
      <path
        d="M99 193l-7 27q1 14 14 13l13-32M133 199l6 27q9 12 19 3l-7-34"
        fill={"url(#" + id + "body)"}
        stroke="#79a18a"
        strokeWidth="2"
      />
      <path
        d="M81 159q-28 5-31 30q4 10 15 6l23-23"
        fill={"url(#" + id + "body)"}
      />
      <path
        d="M161 164q24 1 30-21l1-18q8-5 13 4q7 34-28 54"
        fill={"url(#" + id + "body)"}
      />
      <rect
        x="82"
        y="144"
        width="83"
        height="64"
        rx="29"
        fill={"url(#" + id + "body)"}
        stroke="#79a18a"
        strokeWidth="2"
      />
      <path d="M98 148l23 19 27-17" stroke="#83aa92" strokeWidth="3" />
      <text
        x="109"
        y="188"
        fill="#256348"
        fontSize="15"
        fontWeight="800"
        fontFamily="sans-serif"
      >
        SIU
      </text>
      <path
        d="M100 61l-7-29q0-10 8-8q9 7 10 37M129 61l8-35q5-8 11-1q3 12-7 39"
        fill={"url(#" + id + "ear)"}
      />
      <rect
        x="39"
        y="86"
        width="24"
        height="47"
        rx="12"
        fill={"url(#" + id + "ear)"}
      />
      <rect
        x="181"
        y="83"
        width="24"
        height="47"
        rx="12"
        fill={"url(#" + id + "ear)"}
      />
      <path
        d="M58 81q13-28 65-27q52 0 66 28l5 43q-4 32-71 34q-67 0-72-35z"
        fill={"url(#" + id + "body)"}
        stroke="var(--ai-shell-highlight)"
        strokeWidth="3"
      />
      <rect x="67" y="78" width="112" height="64" rx="29" fill="#132a20" />
      <path
        d="M80 89q25-14 68-7"
        stroke="#49745a"
        strokeWidth="4"
        strokeLinecap="round"
        opacity=".7"
      />
      <ellipse cx="99" cy="110" rx="9" ry="13" fill={"url(#" + id + "eye)"} />
      <ellipse cx="149" cy="110" rx="9" ry="13" fill={"url(#" + id + "eye)"} />
      <path
        d="M116 126q8 7 16-1"
        stroke="#9de5bb"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="77" cy="126" r="5" fill="#68b487" opacity=".6" />
      <circle cx="171" cy="126" r="5" fill="#68b487" opacity=".6" />
      <path
        d="M215 53v14m-7-7h14M34 151v10m-5-5h10"
        stroke="#89b69a"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
