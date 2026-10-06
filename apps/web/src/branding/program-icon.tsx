import { useId } from "react";
import type { ProgramId } from "../desktop/contracts.js";

/** Original dimensional vector artwork shares a silhouette language at every shell size. */
export function ProgramIcon({
  program = "channels",
  size = 48,
}: {
  program?: ProgramId | "logo";
  size?: number;
}) {
  const id = useId();
  const blue = `${id}-blue`,
    gold = `${id}-gold`,
    silver = `${id}-silver`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="program-icon"
    >
      <defs>
        <linearGradient id={blue} x2=".3" y2="1">
          <stop stopColor="#9dd9ff" />
          <stop offset=".4" stopColor="#3988e2" />
          <stop offset="1" stopColor="#114791" />
        </linearGradient>
        <linearGradient id={gold} x2=".2" y2="1">
          <stop stopColor="#fff4a2" />
          <stop offset=".45" stopColor="#f7c94b" />
          <stop offset="1" stopColor="#c7811a" />
        </linearGradient>
        <linearGradient id={silver} x2=".2" y2="1">
          <stop stopColor="#fafaff" />
          <stop offset=".5" stopColor="#c7d7e5" />
          <stop offset="1" stopColor="#6886a7" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="58" rx="25" ry="4" fill="#14375e" opacity=".25" />
      {program === "logo" ||
      program === "channels" ||
      program === "plex" ||
      program === "monitor" ? (
        <>
          <path
            d="M23 9 17 3m24 6 6-6"
            stroke="#b7d3e9"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <rect
            x="5"
            y="11"
            width="54"
            height="41"
            rx="7"
            fill={`url(#${blue})`}
            stroke="#163c72"
            strokeWidth="2"
          />
          <rect
            x="10"
            y="16"
            width="39"
            height="30"
            rx="5"
            fill="#15364b"
            stroke="#bbd9f4"
          />
          {program === "monitor" ? (
            <path
              d="M13 32h7l4-10 6 18 5-12 4 4h7"
              fill="none"
              stroke="#a7fb73"
              strokeWidth="3"
            />
          ) : (
            <>
              <path d="M14 21h13v9H14z" fill="#f96646" />
              <path d="M30 21h13v9H30z" fill="#88cc4f" />
              <path d="M14 33h13v9H14z" fill="#4fb7ee" />
              <path d="M30 33h13v9H30z" fill="#f9d451" />
            </>
          )}
          <path d="M13 18h31" stroke="white" opacity=".45" />
          <circle cx="54" cy="23" r="2" fill="#e6f6fd" />
          <circle cx="54" cy="31" r="2" fill="#e6f6fd" />
          <path d="M17 53v4m29-4v4" stroke="#1d4674" strokeWidth="4" />
          {program === "plex" && (
            <path
              d="m48 38 8 7-8 8h-6l8-8-8-7z"
              fill="#ffd662"
              stroke="#a56d18"
            />
          )}
        </>
      ) : program === "guide" ? (
        <>
          <rect
            x="10"
            y="9"
            width="44"
            height="46"
            rx="3"
            fill={`url(#${silver})`}
            stroke="#4b6682"
            strokeWidth="2"
          />
          <path d="M11 11h42v12H11z" fill={`url(#${blue})`} />
          <path
            d="M21 5v12m22-12v12"
            stroke="#364963"
            strokeWidth="4"
            strokeLinecap="round"
          />
          {[0, 1, 2].map((row) =>
            [0, 1, 2].map((col) => (
              <rect
                key={`${row}-${col}`}
                x={17 + col * 11}
                y={29 + row * 7}
                width="7"
                height="4"
                fill={row === 1 && col === 1 ? "#df7040" : "#6084a9"}
              />
            )),
          )}
        </>
      ) : (
        <>
          {program === "collections" && (
            <path
              d="M13 9h18l5 5h21v36H13z"
              fill={`url(#${blue})`}
              stroke="#245480"
              strokeWidth="2"
            />
          )}
          <path
            d="M6 19h19l5 5h25v30H6z"
            fill={`url(#${gold})`}
            stroke="#a77423"
            strokeWidth="2"
          />
          <path
            d="M7 27h49l-6 28H5z"
            fill={`url(#${gold})`}
            stroke="#ab7a2f"
            strokeWidth="2"
          />
          {program === "media" ? (
            <>
              <circle
                cx="40"
                cy="39"
                r="12"
                fill={`url(#${silver})`}
                stroke="#4a657e"
              />
              <circle cx="40" cy="39" r="3" fill="#617995" />
              {[0, 1, 2, 3].map((n) => (
                <circle
                  key={n}
                  cx={40 + Math.cos((n * Math.PI) / 2) * 7}
                  cy={39 + Math.sin((n * Math.PI) / 2) * 7}
                  r="2.5"
                  fill="#405674"
                />
              ))}
            </>
          ) : (
            <path
              d="M20 35h22m-22 6h18m-18 6h14"
              stroke="#8c691c"
              strokeWidth="3"
            />
          )}
        </>
      )}
    </svg>
  );
}
