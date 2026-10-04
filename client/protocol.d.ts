import type { JsonObject, Manifest } from "../lib/manifest.js";

export interface FrameConfig {
  prismal: 1;
  choices: Record<string, string>;
  state: JsonObject;
  route: string;
}

export interface FrameRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ElementSelection {
  name: string;
  route: string;
  index: number;
  text: string;
  group?: string;
  what?: string;
}

export interface InventoryItem {
  name: string;
  group: string;
  count: number;
}

export interface Highlight {
  selector: string;
  label?: string;
}

export type ClientEvent =
  | { type: "ready"; title: string; route: string }
  | { type: "size"; width: number; height: number }
  | ({ type: "rect" } & FrameRect)
  | { type: "error"; message: string }
  | { type: "inventory"; items: InventoryItem[]; route: string }
  | ({ type: "picked" } & ElementSelection);

export type ShellCommand =
  | {
      type: "init";
      elements?: Manifest["elements"];
      inspect?: boolean;
      focus?: string;
      highlight?: Highlight | null;
    }
  | { type: "inspect"; on: boolean }
  | ({ type: "highlight" } & Highlight)
  | { type: "select"; name: string; index: number };
