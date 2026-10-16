import { createContext, useContext } from "react";

export const AccountAccess = createContext<{
  isGuest: boolean;
  requireAccount: () => boolean;
}>({
  isGuest: false,
  requireAccount: () => true,
});
export const useAccountAccess = () => useContext(AccountAccess);
