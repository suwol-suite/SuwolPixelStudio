import type { SVGProps } from "react";

export type IconName =
  | "app"
  | "command"
  | "document"
  | "layers"
  | "palette"
  | "properties"
  | "preview"
  | "timeline"
  | "tools"
  | "pencil"
  | "eraser"
  | "eyedropper"
  | "select"
  | "zoom"
  | "reset"
  | "close"
  | "eye"
  | "lock"
  | "add"
  | "delete"
  | "duplicate"
  | "up"
  | "down"
  | "swap"
  | "fill"
  | "line"
  | "rectangle"
  | "ellipse"
  | "move";

const paths: Record<IconName, readonly string[]> = {
  app: [
    "M4 4h16v16H4z",
    "M8 8h3v3H8z",
    "M13 8h3v3h-3z",
    "M8 13h3v3H8z",
    "M13 13h3v3h-3z",
  ],
  command: [
    "M9 6H6a3 3 0 1 0 3 3V6Zm6 0h3a3 3 0 1 1-3 3V6ZM9 18H6a3 3 0 1 1 3-3v3Zm6 0h3a3 3 0 1 0-3-3v3ZM9 9h6v6H9z",
  ],
  document: ["M6 3h8l4 4v14H6z", "M14 3v5h5", "M9 12h6", "M9 16h6"],
  layers: ["m12 3 9 5-9 5-9-5 9-5Z", "m3 12 9 5 9-5", "m3 16 9 5 9-5"],
  palette: [
    "M12 3a9 9 0 0 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a1.5 1.5 0 0 1 0-3h1a8 8 0 0 0-1-16Z",
    "M7.5 10h.01",
    "M9.5 6.5h.01",
    "M14 6.5h.01",
    "M17 10h.01",
  ],
  properties: [
    "M4 6h10",
    "M18 6h2",
    "M14 4v4",
    "M4 12h3",
    "M11 12h9",
    "M7 10v4",
    "M4 18h8",
    "M16 18h4",
    "M12 16v4",
  ],
  preview: [
    "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z",
    "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
  ],
  timeline: ["M4 5h16v14H4z", "M8 5v14", "M16 5v14", "M4 10h16", "M4 15h16"],
  tools: [
    "M14.5 6.5 17.5 3.5a2.1 2.1 0 0 1 3 3l-3 3",
    "m16 8-9.5 9.5L3 21l3.5-3.5L16 8Z",
  ],
  pencil: ["m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z", "m14 7 3 3"],
  eraser: [
    "m4 15 8-10a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-7 7H8l-4-4a2 2 0 0 1 0-3Z",
    "M12 19h9",
  ],
  eyedropper: [
    "m19 3 2 2-5 5-2-2 5-5Z",
    "m15 9-8.5 8.5L3 21l3.5-3.5L15 9Z",
    "M5 17l2 2",
  ],
  fill: ["m5 13 7-9 7 7-7 9-7-7Z", "M3 21h18"],
  line: ["M4 20 20 4"],
  rectangle: ["M4 5h16v14H4z"],
  ellipse: ["M3 12a9 6 0 1 0 18 0 9 6 0 1 0-18 0Z"],
  move: [
    "M12 2v20",
    "m8 6 4-4 4 4",
    "m8 12-4-4-4 4",
    "m8 12 4 4 4-4",
    "m8 18 4 4 4-4",
  ],
  select: ["M5 3h5", "M14 3h5v5", "M19 14v5h-5", "M10 19H5v-5", "M5 10V3"],
  zoom: [
    "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z",
    "m16 16 5 5",
    "M8 11h6",
    "M11 8v6",
  ],
  reset: ["M4 4v6h6", "M5.5 15a8 8 0 1 0 1-8L4 10"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  eye: [
    "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z",
    "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
  ],
  lock: ["M6 10h12v10H6z", "M8 10V7a4 4 0 0 1 8 0v3"],
  add: ["M12 5v14", "M5 12h14"],
  delete: ["M4 7h16", "M9 7V4h6v3", "m7 7 1 13h8l1-13", "M10 11v5", "M14 11v5"],
  duplicate: ["M8 8h12v12H8z", "M4 16V4h12"],
  up: ["m6 15 6-6 6 6"],
  down: ["m6 9 6 6 6-6"],
  swap: ["M7 7h12l-3-3", "m19 7-3 3", "M17 17H5l3-3", "m5 17 3 3"],
};

export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { readonly name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name].map((path, index) => (
        <path d={path} key={`${name}-${index}`} />
      ))}
    </svg>
  );
}
