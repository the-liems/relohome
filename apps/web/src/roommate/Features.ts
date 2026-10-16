import { createContext } from "react";
export const RoommateFeatures = createContext<readonly string[]>([]);
export const RoommateIdentity = createContext({ id: "", name: "" });
